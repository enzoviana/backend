const NotationDiagnostiqueur = require('../models/NotationDiagnostiqueur');
const Diagnostiqueur = require('../models/Diagnostiqueur');
const OrdreMission = require('../models/OrdreMission');
const nodemailer = require('nodemailer');

/**
 * Configuration de l'email
 */
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: process.env.SMTP_PORT || 587,
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  }
});

/**
 * Crée une notation
 * Note: L'agence note le diagnostiqueur après une mission terminée
 */
async function creerNotation(agenceId, diagnostiqueurId, ordreMissionId, data) {
  try {
    // Vérifier que la mission existe et est terminée
    const mission = await OrdreMission.findById(ordreMissionId);
    if (!mission) {
      throw new Error('Mission non trouvée');
    }

    // Vérifier que la mission est au moins "Traité" pour être notée
    if (mission.statut !== 'Traité' && mission.statut !== 'Payée') {
      throw new Error('La mission doit être traitée ou payée pour être notée');
    }

    // Vérifier qu'il n'existe pas déjà une notation pour cette mission
    const notationExistante = await NotationDiagnostiqueur.findOne({ ordreMission: ordreMissionId });
    if (notationExistante) {
      throw new Error('Cette mission a déjà été notée');
    }

    // Créer la notation
    const notation = await NotationDiagnostiqueur.create({
      agence: agenceId,
      diagnostiqueur: diagnostiqueurId,
      ordreMission: ordreMissionId,
      note: data.note,
      commentaire: data.commentaire || '',
      criteres: {
        ponctualite: data.criteres.ponctualite,
        professionnalisme: data.criteres.professionnalisme,
        qualiteRapport: data.criteres.qualiteRapport,
        communication: data.criteres.communication
      },
      statut: 'publie',
      dateNotation: new Date()
    });

    // Recalculer la note globale du diagnostiqueur (ne pas bloquer si échec)
    try {
      await recalculerNoteGlobale(diagnostiqueurId);
    } catch (err) {
      console.error('⚠️ Erreur lors du recalcul de la note globale (non bloquant):', err);
    }

    // Notifier le diagnostiqueur (ne pas bloquer si échec)
    try {
      await notifierDiagnostiqueurNouvelleNotation(notation);
    } catch (err) {
      console.error('⚠️ Erreur lors de la notification email (non bloquant):', err);
    }

    return notation;

  } catch (error) {
    console.error('Erreur creerNotation:', error);
    throw error;
  }
}

/**
 * Recalcule la note globale d'un diagnostiqueur
 */
async function recalculerNoteGlobale(diagnostiqueurId) {
  try {
    const diagnostiqueur = await Diagnostiqueur.findById(diagnostiqueurId);
    if (!diagnostiqueur) {
      throw new Error('Diagnostiqueur non trouvé');
    }

    // Récupérer toutes les notations publiées
    const notations = await NotationDiagnostiqueur.find({
      diagnostiqueur: diagnostiqueurId,
      statut: 'publie'
    });

    if (notations.length === 0) {
      diagnostiqueur.noteGlobale = 0;
      diagnostiqueur.nombreEvaluations = 0;
    } else {
      const somme = notations.reduce((acc, n) => acc + n.note, 0);
      diagnostiqueur.noteGlobale = Math.round((somme / notations.length) * 10) / 10; // Arrondi à 1 décimale
      diagnostiqueur.nombreEvaluations = notations.length;
    }

    await diagnostiqueur.save();

    console.log(`✅ Note globale recalculée pour diagnostiqueur ${diagnostiqueurId}: ${diagnostiqueur.noteGlobale}/5 (${diagnostiqueur.nombreEvaluations} évaluations)`);

    return diagnostiqueur;

  } catch (error) {
    console.error('Erreur recalculerNoteGlobale:', error);
    throw error;
  }
}

/**
 * Ajoute une réponse du diagnostiqueur à une notation
 */
async function ajouterReponse(notationId, diagnostiqueurId, texte) {
  try {
    const notation = await NotationDiagnostiqueur.findById(notationId).populate('diagnostiqueur');

    if (!notation) {
      throw new Error('Notation non trouvée');
    }

    if (notation.diagnostiqueur._id.toString() !== diagnostiqueurId.toString()) {
      throw new Error('Non autorisé');
    }

    if (notation.reponse) {
      throw new Error('Une réponse a déjà été ajoutée');
    }

    // Récupérer le diagnostiqueur pour obtenir le nom de l'admin
    const diagnostiqueur = await Diagnostiqueur.findById(diagnostiqueurId);
    const auteur = `${diagnostiqueur.admin.prenom} ${diagnostiqueur.admin.nom}`;

    await notation.ajouterReponse(texte, auteur);

    console.log(`✅ Réponse ajoutée à la notation ${notationId}`);

    return notation;

  } catch (error) {
    console.error('Erreur ajouterReponse:', error);
    throw error;
  }
}

/**
 * Notifie le diagnostiqueur d'une nouvelle notation
 */
async function notifierDiagnostiqueurNouvelleNotation(notation) {
  try {
    const diagnostiqueur = await Diagnostiqueur.findById(notation.diagnostiqueur);
    if (!diagnostiqueur) {
      return;
    }

    const sujet = `Nouvelle évaluation - ${notation.note}/5 étoiles`;
    const message = `
      <h2>Vous avez reçu une nouvelle évaluation</h2>
      <p>Bonjour ${diagnostiqueur.admin.prenom} ${diagnostiqueur.admin.nom},</p>
      <p>Une agence vient de vous évaluer suite à une mission:</p>
      <ul>
        <li><strong>Note:</strong> ${notation.note}/5 étoiles</li>
        <li><strong>Ponctualité:</strong> ${notation.criteres.ponctualite}/5</li>
        <li><strong>Professionnalisme:</strong> ${notation.criteres.professionnalisme}/5</li>
        <li><strong>Qualité du rapport:</strong> ${notation.criteres.qualiteRapport}/5</li>
        <li><strong>Communication:</strong> ${notation.criteres.communication}/5</li>
      </ul>
      ${notation.commentaire ? `<p><strong>Commentaire:</strong> ${notation.commentaire}</p>` : ''}
      <p>Vous pouvez répondre à cette évaluation depuis votre espace diagnostiqueur.</p>
      <p><strong>Votre note globale:</strong> ${diagnostiqueur.noteGlobale}/5 (${diagnostiqueur.nombreEvaluations} évaluations)</p>
    `;

    await transporter.sendMail({
      from: process.env.SMTP_FROM || 'noreply@dimotec.fr',
      to: diagnostiqueur.admin.email,
      subject: sujet,
      html: message
    });

    console.log(`✅ Email de notification envoyé à ${diagnostiqueur.admin.email}`);

  } catch (error) {
    console.error('Erreur notifierDiagnostiqueurNouvelleNotation:', error);
    // Ne pas bloquer si l'email échoue
  }
}

/**
 * Récupère les statistiques de notation d'un diagnostiqueur
 */
async function getStatistiquesNotation(diagnostiqueurId) {
  try {
    const notations = await NotationDiagnostiqueur.find({
      diagnostiqueur: diagnostiqueurId,
      statut: 'publie'
    });

    if (notations.length === 0) {
      return {
        total: 0,
        noteGlobale: 0,
        repartition: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
        moyennesCriteres: {
          ponctualite: 0,
          professionnalisme: 0,
          qualiteRapport: 0,
          communication: 0
        }
      };
    }

    // Répartition par note
    const repartition = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    notations.forEach(n => {
      repartition[n.note]++;
    });

    // Moyennes des critères
    const sommeCriteres = notations.reduce((acc, n) => ({
      ponctualite: acc.ponctualite + n.criteres.ponctualite,
      professionnalisme: acc.professionnalisme + n.criteres.professionnalisme,
      qualiteRapport: acc.qualiteRapport + n.criteres.qualiteRapport,
      communication: acc.communication + n.criteres.communication
    }), { ponctualite: 0, professionnalisme: 0, qualiteRapport: 0, communication: 0 });

    const moyennesCriteres = {
      ponctualite: Math.round((sommeCriteres.ponctualite / notations.length) * 10) / 10,
      professionnalisme: Math.round((sommeCriteres.professionnalisme / notations.length) * 10) / 10,
      qualiteRapport: Math.round((sommeCriteres.qualiteRapport / notations.length) * 10) / 10,
      communication: Math.round((sommeCriteres.communication / notations.length) * 10) / 10
    };

    const sommeNotes = notations.reduce((acc, n) => acc + n.note, 0);
    const noteGlobale = Math.round((sommeNotes / notations.length) * 10) / 10;

    return {
      total: notations.length,
      noteGlobale,
      repartition,
      moyennesCriteres
    };

  } catch (error) {
    console.error('Erreur getStatistiquesNotation:', error);
    throw error;
  }
}

module.exports = {
  creerNotation,
  recalculerNoteGlobale,
  ajouterReponse,
  notifierDiagnostiqueurNouvelleNotation,
  getStatistiquesNotation
};
