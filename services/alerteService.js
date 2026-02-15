const Diagnostiqueur = require('../models/Diagnostiqueur');
const Certification = require('../models/Certification');
const AlerteDocument = require('../models/AlerteDocument');
const nodemailer = require('nodemailer');

/**
 * Configuration de l'email (à adapter selon votre configuration)
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
 * Seuils d'alerte en jours
 */
const SEUILS = {
  INFO: 60,
  AVERTISSEMENT: 30,
  CRITIQUE: 7,
  EXPIRE: 0
};

/**
 * Vérifie tous les documents de tous les diagnostiqueurs
 */
async function verifierTousLesDocuments() {
  try {
    console.log('🔍 Début vérification documents...');

    await verifierCertifications();
    await verifierAssurances();

    console.log('✅ Vérification documents terminée');

  } catch (error) {
    console.error('❌ Erreur verifierTousLesDocuments:', error);
    throw error;
  }
}

/**
 * Vérifie toutes les certifications
 */
async function verifierCertifications() {
  try {
    const certifications = await Certification.find({
      statut: { $ne: 'expire' }
    }).populate('diagnostiqueur technicien domaine');

    const maintenant = new Date();

    for (const cert of certifications) {
      const joursRestants = Math.ceil((cert.dateExpiration - maintenant) / (1000 * 60 * 60 * 24));

      // Calculer et sauvegarder le statut
      cert.calculerStatut();
      await cert.save();

      // Gérer les alertes
      await gererAlerteCertification(cert, joursRestants);
    }

    console.log(`✅ ${certifications.length} certifications vérifiées`);

  } catch (error) {
    console.error('Erreur verifierCertifications:', error);
    throw error;
  }
}

/**
 * Gère une alerte pour une certification
 */
async function gererAlerteCertification(cert, joursRestants) {
  try {
    // Déterminer le niveau d'alerte
    let niveau;
    if (joursRestants < 0) niveau = 'expire';
    else if (joursRestants <= SEUILS.CRITIQUE) niveau = 'critique';
    else if (joursRestants <= SEUILS.AVERTISSEMENT) niveau = 'avertissement';
    else if (joursRestants <= SEUILS.INFO) niveau = 'info';
    else return; // Pas d'alerte nécessaire

    // Chercher une alerte existante
    let alerte = await AlerteDocument.findOne({
      documentRef: cert._id,
      documentModel: 'Certification',
      statut: 'active'
    });

    if (alerte) {
      // Mettre à jour l'alerte existante
      alerte.joursRestants = joursRestants;
      alerte.niveau = niveau;
      alerte.dateExpiration = cert.dateExpiration;
      await alerte.save();
    } else {
      // Créer nouvelle alerte
      alerte = await AlerteDocument.create({
        diagnostiqueur: cert.diagnostiqueur._id,
        type: 'certification',
        documentRef: cert._id,
        documentModel: 'Certification',
        nomDocument: `Certification ${cert.domaine?.nom || 'inconnu'} - ${cert.technicien?.nom || 'inconnu'}`,
        dateExpiration: cert.dateExpiration,
        joursRestants,
        niveau,
        statut: 'active'
      });
    }

    // Envoyer notifications selon les seuils
    await envoyerNotificationsSeuilCertification(alerte, joursRestants, cert);

  } catch (error) {
    console.error('Erreur gererAlerteCertification:', error);
    throw error;
  }
}

/**
 * Envoie les notifications pour une certification selon les seuils
 */
async function envoyerNotificationsSeuilCertification(alerte, joursRestants, cert) {
  try {
    const seuils = [60, 30, 15, 7, 0];

    for (const seuil of seuils) {
      if (joursRestants <= seuil && !alerte.notificationDejaEnvoyee(seuil)) {
        // Envoyer email
        await envoyerEmailAlerte(
          cert.diagnostiqueur,
          'certification',
          alerte.nomDocument,
          joursRestants,
          cert.dateExpiration
        );

        // Enregistrer la notification
        await alerte.ajouterNotification('email', seuil);

        console.log(`📧 Notification envoyée pour certification (J-${seuil}): ${alerte.nomDocument}`);
      }
    }

  } catch (error) {
    console.error('Erreur envoyerNotificationsSeuilCertification:', error);
    throw error;
  }
}

/**
 * Vérifie les assurances de tous les diagnostiqueurs
 */
async function verifierAssurances() {
  try {
    const diagnostiqueurs = await Diagnostiqueur.find({ statut: 'actif' });
    const maintenant = new Date();

    for (const diag of diagnostiqueurs) {
      // Vérifier RC
      const assuranceRC = diag.documents.find(doc => doc.type === 'assurance_rc');
      if (assuranceRC && assuranceRC.dateExpiration) {
        const joursRestants = Math.ceil((assuranceRC.dateExpiration - maintenant) / (1000 * 60 * 60 * 24));
        await gererAlerteAssurance(diag, assuranceRC, joursRestants, 'assurance_rc');
      }

      // Vérifier décennale
      const assuranceDecennale = diag.documents.find(doc => doc.type === 'assurance_decennale');
      if (assuranceDecennale && assuranceDecennale.dateExpiration) {
        const joursRestants = Math.ceil((assuranceDecennale.dateExpiration - maintenant) / (1000 * 60 * 60 * 24));
        await gererAlerteAssurance(diag, assuranceDecennale, joursRestants, 'assurance_decennale');
      }

      // Vérifier KBIS
      const kbis = diag.documents.find(doc => doc.type === 'kbis');
      if (kbis && kbis.dateExpiration) {
        const joursRestants = Math.ceil((kbis.dateExpiration - maintenant) / (1000 * 60 * 60 * 24));
        await gererAlerteAssurance(diag, kbis, joursRestants, 'kbis');
      }
    }

    console.log(`✅ ${diagnostiqueurs.length} diagnostiqueurs vérifiés pour assurances`);

  } catch (error) {
    console.error('Erreur verifierAssurances:', error);
    throw error;
  }
}

/**
 * Gère une alerte pour une assurance
 */
async function gererAlerteAssurance(diagnostiqueur, document, joursRestants, typeDoc) {
  try {
    // Déterminer le niveau d'alerte
    let niveau;
    if (joursRestants < 0) niveau = 'expire';
    else if (joursRestants <= SEUILS.CRITIQUE) niveau = 'critique';
    else if (joursRestants <= SEUILS.AVERTISSEMENT) niveau = 'avertissement';
    else if (joursRestants <= SEUILS.INFO) niveau = 'info';
    else return;

    // Chercher une alerte existante
    let alerte = await AlerteDocument.findOne({
      documentRef: document._id,
      documentModel: 'Diagnostiqueur',
      statut: 'active'
    });

    if (alerte) {
      alerte.joursRestants = joursRestants;
      alerte.niveau = niveau;
      alerte.dateExpiration = document.dateExpiration;
      await alerte.save();
    } else {
      alerte = await AlerteDocument.create({
        diagnostiqueur: diagnostiqueur._id,
        type: typeDoc,
        documentRef: document._id,
        documentModel: 'Diagnostiqueur',
        nomDocument: document.nom || typeDoc,
        dateExpiration: document.dateExpiration,
        joursRestants,
        niveau,
        statut: 'active'
      });
    }

    // Envoyer notifications
    await envoyerNotificationsSeuilAssurance(alerte, joursRestants, diagnostiqueur, typeDoc);

  } catch (error) {
    console.error('Erreur gererAlerteAssurance:', error);
    throw error;
  }
}

/**
 * Envoie les notifications pour une assurance selon les seuils
 */
async function envoyerNotificationsSeuilAssurance(alerte, joursRestants, diagnostiqueur, typeDoc) {
  try {
    const seuils = [60, 30, 15, 7, 0];

    for (const seuil of seuils) {
      if (joursRestants <= seuil && !alerte.notificationDejaEnvoyee(seuil)) {
        await envoyerEmailAlerte(
          diagnostiqueur,
          typeDoc,
          alerte.nomDocument,
          joursRestants,
          alerte.dateExpiration
        );

        await alerte.ajouterNotification('email', seuil);

        console.log(`📧 Notification envoyée pour ${typeDoc} (J-${seuil}): ${alerte.nomDocument}`);
      }
    }

  } catch (error) {
    console.error('Erreur envoyerNotificationsSeuilAssurance:', error);
    throw error;
  }
}

/**
 * Envoie un email d'alerte
 */
async function envoyerEmailAlerte(diagnostiqueur, typeAlerte, nomDoc, joursRestants, dateExp) {
  try {
    let sujet, message;

    if (joursRestants < 0) {
      sujet = `⚠️ URGENT: Document expiré - ${nomDoc}`;
      message = `
        <h2>Document expiré</h2>
        <p>Bonjour ${diagnostiqueur.admin.prenom} ${diagnostiqueur.admin.nom},</p>
        <p><strong>Le document suivant est expiré:</strong></p>
        <ul>
          <li><strong>Type:</strong> ${typeAlerte}</li>
          <li><strong>Document:</strong> ${nomDoc}</li>
          <li><strong>Date d'expiration:</strong> ${dateExp.toLocaleDateString('fr-FR')}</li>
          <li><strong>Expiré depuis:</strong> ${Math.abs(joursRestants)} jours</li>
        </ul>
        <p><strong>Action requise:</strong> Veuillez renouveler ce document immédiatement.</p>
        <p>Connectez-vous à votre espace diagnostiqueur pour mettre à jour vos documents.</p>
      `;
    } else if (joursRestants <= 7) {
      sujet = `🚨 CRITIQUE: Document expire dans ${joursRestants} jours - ${nomDoc}`;
      message = `
        <h2>Document expirant bientôt</h2>
        <p>Bonjour ${diagnostiqueur.admin.prenom} ${diagnostiqueur.admin.nom},</p>
        <p><strong>Le document suivant expire dans ${joursRestants} jours:</strong></p>
        <ul>
          <li><strong>Type:</strong> ${typeAlerte}</li>
          <li><strong>Document:</strong> ${nomDoc}</li>
          <li><strong>Date d'expiration:</strong> ${dateExp.toLocaleDateString('fr-FR')}</li>
        </ul>
        <p><strong>Action urgente requise:</strong> Veuillez renouveler ce document rapidement.</p>
      `;
    } else if (joursRestants <= 30) {
      sujet = `⚠️ Document à renouveler - ${nomDoc}`;
      message = `
        <h2>Rappel de renouvellement</h2>
        <p>Bonjour ${diagnostiqueur.admin.prenom} ${diagnostiqueur.admin.nom},</p>
        <p>Le document suivant expire dans ${joursRestants} jours:</p>
        <ul>
          <li><strong>Type:</strong> ${typeAlerte}</li>
          <li><strong>Document:</strong> ${nomDoc}</li>
          <li><strong>Date d'expiration:</strong> ${dateExp.toLocaleDateString('fr-FR')}</li>
        </ul>
        <p>Pensez à le renouveler prochainement.</p>
      `;
    } else {
      sujet = `📋 Information: Document à renouveler - ${nomDoc}`;
      message = `
        <h2>Information de renouvellement</h2>
        <p>Bonjour ${diagnostiqueur.admin.prenom} ${diagnostiqueur.admin.nom},</p>
        <p>Le document suivant expire dans ${joursRestants} jours:</p>
        <ul>
          <li><strong>Type:</strong> ${typeAlerte}</li>
          <li><strong>Document:</strong> ${nomDoc}</li>
          <li><strong>Date d'expiration:</strong> ${dateExp.toLocaleDateString('fr-FR')}</li>
        </ul>
      `;
    }

    await transporter.sendMail({
      from: process.env.SMTP_FROM || 'noreply@dimotec.fr',
      to: diagnostiqueur.admin.email,
      subject: sujet,
      html: message
    });

    console.log(`✅ Email envoyé à ${diagnostiqueur.admin.email}`);

  } catch (error) {
    console.error('Erreur envoyerEmailAlerte:', error);
    throw error;
  }
}

/**
 * Récupère les alertes actives d'un diagnostiqueur
 */
async function getAlertesActives(diagnostiqueurId) {
  try {
    const alertes = await AlerteDocument.find({
      diagnostiqueur: diagnostiqueurId,
      statut: 'active'
    }).sort({ niveau: -1, joursRestants: 1 });

    return alertes;

  } catch (error) {
    console.error('Erreur getAlertesActives:', error);
    throw error;
  }
}

module.exports = {
  verifierTousLesDocuments,
  verifierCertifications,
  verifierAssurances,
  gererAlerteCertification,
  gererAlerteAssurance,
  envoyerNotificationsSeuilCertification,
  envoyerNotificationsSeuilAssurance,
  envoyerEmailAlerte,
  getAlertesActives
};
