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
const telechargerDocumentCertification = async (req, res) => {
  try {
    const { certificationId } = req.params;

    const certification = await Certification.findById(certificationId);
    if (!certification) {
      return res.status(404).json({ message: 'Certification non trouvée' });
    }

    if (!certification.document || !certification.document.url) {
      return res.status(404).json({ message: 'Aucun document associé à cette certification' });
    }

    const documentUrl = certification.document.url;
    const documentNom = certification.document.nom || `certification-${certificationId}.pdf`;

    // Récupérer le fichier depuis Cloudinary
    const https = require('https');
    const http = require('http');
    const url = require('url');

    const parsedUrl = url.parse(documentUrl);
    const protocol = parsedUrl.protocol === 'https:' ? https : http;

    protocol.get(documentUrl, (cloudinaryResponse) => {
      if (cloudinaryResponse.statusCode !== 200) {
        return res.status(cloudinaryResponse.statusCode).json({
          message: 'Erreur lors de la récupération du document depuis Cloudinary'
        });
      }

      // Définir les headers pour le téléchargement
      res.setHeader('Content-Type', cloudinaryResponse.headers['content-type'] || 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(documentNom)}"`);
      res.setHeader('Content-Length', cloudinaryResponse.headers['content-length']);

      // Pipe la réponse de Cloudinary vers le client
      cloudinaryResponse.pipe(res);
    }).on('error', (error) => {
      console.error('Erreur téléchargement depuis Cloudinary:', error);
      res.status(500).json({ message: 'Erreur lors du téléchargement du document' });
    });

  } catch (error) {
    console.error('Erreur telechargerDocumentCertification:', error);
    res.status(500).json({ message: error.message });
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