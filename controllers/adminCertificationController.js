const Certification = require('../models/Certification');
const Diagnostiqueur = require('../models/Diagnostiqueur');
const TechnicienDiagnostiqueur = require('../models/TechnicienDiagnostiqueur');
const DomaineActivite = require('../models/DomaineActivite');
const sendEmail = require('../utils/sendEmails');

/**
 * GET - Liste des certifications en attente d'approbation
 */
const getCertificationsEnAttente = async (req, res) => {
  try {
    const certifications = await Certification.find({
      'approbation.statutApprobation': 'en_attente'
    })
    .populate('diagnostiqueur', 'nom_entreprise admin.email')
    .populate('technicien', 'prenom nom')
    .populate('domaine', 'nom code')
    .sort({ createdAt: -1 });

    res.json({ certifications });
  } catch (error) {
    console.error('Erreur getCertificationsEnAttente:', error);
    res.status(500).json({ message: error.message });
  }
};

/**
 * GET - Toutes les certifications avec filtres optionnels
 */
const getToutesCertifications = async (req, res) => {
  try {
    const { statutApprobation, diagnostiqueurId } = req.query;
    const query = {};

    if (statutApprobation) {
      query['approbation.statutApprobation'] = statutApprobation;
    }
    if (diagnostiqueurId) {
      query.diagnostiqueur = diagnostiqueurId;
    }

    const certifications = await Certification.find(query)
      .populate('diagnostiqueur', 'nom_entreprise admin.email')
      .populate('technicien', 'prenom nom')
      .populate('domaine', 'nom code')
      .sort({ createdAt: -1 });

    res.json({ certifications });
  } catch (error) {
    console.error('Erreur getToutesCertifications:', error);
    res.status(500).json({ message: error.message });
  }
};

/**
 * PUT - Approuver une certification
 */
const approuverCertification = async (req, res) => {
  try {
    const { certificationId } = req.params;
    const { commentaireAdmin } = req.body;
    const adminId = req.user.id;

    const certification = await Certification.findById(certificationId);
    if (!certification) {
      return res.status(404).json({ message: 'Certification non trouvée' });
    }

    // Mettre à jour l'approbation
    certification.approbation.statutApprobation = 'approuve';
    certification.approbation.approuvePar = adminId;
    certification.approbation.dateApprobation = new Date();
    certification.approbation.commentaireAdmin = commentaireAdmin || null;
    certification.approbation.raisonRejet = null;

    // Recalculer le statut (valide/expire/a_renouveler)
    if (typeof certification.calculerStatut === 'function') {
        certification.calculerStatut();
    }

    await certification.save();

    const certificationPopulated = await Certification.findById(certificationId)
      .populate('diagnostiqueur', 'nom_entreprise admin.email')
      .populate('technicien', 'prenom nom')
      .populate('domaine', 'nom code')
      .populate('approbation.approuvePar', 'nom prenom');

    // Envoyer un email de notification au diagnostiqueur
    try {
      const dateExpiration = new Date(certificationPopulated.dateExpiration).toLocaleDateString('fr-FR');

      await sendEmail({
        to: certificationPopulated.diagnostiqueur.admin.email,
        subject: '✅ Certification approuvée - Dimotec Contrôles',
        template: 'CertificationApprouvee.html',
        variables: {
          nomDiagnostiqueur: certificationPopulated.diagnostiqueur.nom_entreprise,
          nomDomaine: certificationPopulated.domaine.nom,
          codeDomaine: certificationPopulated.domaine.code,
          nomTechnicien: `${certificationPopulated.technicien.prenom} ${certificationPopulated.technicien.nom}`,
          numeroCertification: certificationPopulated.numeroCertification,
          organisme: certificationPopulated.organisme,
          dateExpiration: dateExpiration,
          commentaireAdmin: commentaireAdmin || '',
          commentaireDisplay: commentaireAdmin ? '' : 'display: none;'
        }
      });

      console.log('✅ Email de certification approuvée envoyé avec succès');
    } catch (emailError) {
      console.error('❌ Erreur envoi email certification approuvée:', emailError);
      // Ne pas bloquer la réponse si l'email échoue
    }

    res.json({
      message: 'Certification approuvée avec succès',
      certification: certificationPopulated
    });
  } catch (error) {
    console.error('Erreur approuverCertification:', error);
    res.status(500).json({ message: error.message });
  }
};

/**
 * PUT - Rejeter une certification
 */
const rejeterCertification = async (req, res) => {
  try {
    const { certificationId } = req.params;
    const { raisonRejet, commentaireAdmin } = req.body;
    const adminId = req.user.id;

    if (!raisonRejet) {
      return res.status(400).json({ message: 'Raison du rejet requise' });
    }

    const certification = await Certification.findById(certificationId);
    if (!certification) {
      return res.status(404).json({ message: 'Certification non trouvée' });
    }

    // Mettre à jour l'approbation
    certification.approbation.statutApprobation = 'rejete';
    certification.approbation.approuvePar = adminId;
    certification.approbation.dateApprobation = new Date();
    certification.approbation.raisonRejet = raisonRejet;
    certification.approbation.commentaireAdmin = commentaireAdmin || null;
    certification.statut = 'rejete';

    await certification.save();

    const certificationPopulated = await Certification.findById(certificationId)
      .populate('diagnostiqueur', 'nom_entreprise admin.email')
      .populate('technicien', 'prenom nom')
      .populate('domaine', 'nom code')
      .populate('approbation.approuvePar', 'nom prenom');

    // Envoyer un email de notification au diagnostiqueur
    try {
      await sendEmail({
        to: certificationPopulated.diagnostiqueur.admin.email,
        subject: '❌ Certification non approuvée - Dimotec Contrôles',
        template: 'CertificationRejetee.html',
        variables: {
          nomDiagnostiqueur: certificationPopulated.diagnostiqueur.nom_entreprise,
          nomDomaine: certificationPopulated.domaine.nom,
          codeDomaine: certificationPopulated.domaine.code,
          nomTechnicien: `${certificationPopulated.technicien.prenom} ${certificationPopulated.technicien.nom}`,
          numeroCertification: certificationPopulated.numeroCertification,
          organisme: certificationPopulated.organisme,
          raisonRejet: raisonRejet,
          commentaireAdmin: commentaireAdmin || '',
          commentaireDisplay: commentaireAdmin ? '' : 'display: none;'
        }
      });

      console.log('✅ Email de certification rejetée envoyé avec succès');
    } catch (emailError) {
      console.error('❌ Erreur envoi email certification rejetée:', emailError);
      // Ne pas bloquer la réponse si l'email échoue
    }

    res.json({
      message: 'Certification rejetée',
      certification: certificationPopulated
    });
  } catch (error) {
    console.error('Erreur rejeterCertification:', error);
    res.status(500).json({ message: error.message });
  }
};

/**
 * DELETE - Supprimer une certification
 */
const supprimerCertification = async (req, res) => {
  try {
    const { certificationId } = req.params;

    const certification = await Certification.findById(certificationId);
    if (!certification) {
      return res.status(404).json({ message: 'Certification non trouvée' });
    }

    await Certification.findByIdAndDelete(certificationId);

    res.json({
      message: 'Certification supprimée avec succès'
    });
  } catch (error) {
    console.error('Erreur supprimerCertification:', error);
    res.status(500).json({ message: error.message });
  }
};

/**
 * GET - Télécharger le document d'une certification (proxy Cloudinary sécurisé)
 */
/**
 * GET - Télécharger le document d'une certification (proxy Cloudinary sécurisé)
 */
const cloudinary = require('cloudinary').v2;

const telechargerDocumentCertification = async (req, res) => {
  try {
    const { certificationId } = req.params;
    const certification = await Certification.findById(certificationId);

    if (!certification || !certification.document || !certification.document.public_id) {
      return res.status(404).json({ message: "Document introuvable" });
    }

    const publicId = certification.document.public_id;
    console.log('🔗 Génération du lien pour public_id:', publicId);

    // 1. On génère l'URL signée comme avant
    const downloadUrl = cloudinary.url(publicId, {
      resource_type: 'raw',
      sign_url: true,
      type: 'upload', 
      attachment: true, 
      expires_at: Math.floor(Date.now() / 1000) + (60 * 10) 
    });

    console.log('✅ URL générée:', downloadUrl);
    
    // --- LE CHANGEMENT EST ICI ---
    // Au lieu de res.redirect(downloadUrl);
    // On renvoie un JSON pour que le fetch() côté Vue.js puisse le lire sans erreur
    res.json({ 
      success: true,
      url: downloadUrl,
      nomFichier: certification.document.nom || `certification-${certificationId}.pdf`
    });
    // -----------------------------

  } catch (error) {
    console.error('❌ Erreur:', error);
    res.status(500).json({ message: "Erreur lors de la génération du lien" });
  }
};
// Exportation groupée de toutes les fonctions
module.exports = {
  getCertificationsEnAttente,
  getToutesCertifications,
  approuverCertification,
  rejeterCertification,
  supprimerCertification,
  telechargerDocumentCertification
};