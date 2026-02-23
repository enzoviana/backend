const Certification = require('../models/Certification');
const Diagnostiqueur = require('../models/Diagnostiqueur');
const TechnicienDiagnostiqueur = require('../models/TechnicienDiagnostiqueur');
const DomaineActivite = require('../models/DomaineActivite');

/**
 * GET - Liste des certifications en attente d'approbation
 */
exports.getCertificationsEnAttente = async (req, res) => {
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
exports.getToutesCertifications = async (req, res) => {
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
exports.approuverCertification = async (req, res) => {
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
    certification.calculerStatut();

    await certification.save();

    const certificationPopulated = await Certification.findById(certificationId)
      .populate('diagnostiqueur', 'nom_entreprise admin.email')
      .populate('technicien', 'prenom nom')
      .populate('domaine', 'nom code')
      .populate('approbation.approuvePar', 'nom prenom');

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
exports.rejeterCertification = async (req, res) => {
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

    // TODO: Envoyer une notification au diagnostiqueur

    res.json({
      message: 'Certification rejetée',
      certification: certificationPopulated
    });
  } catch (error) {
    console.error('Erreur rejeterCertification:', error);
    res.status(500).json({ message: error.message });
  }
};

module.exports = {
  getCertificationsEnAttente,
  getToutesCertifications,
  approuverCertification,
  rejeterCertification
};
