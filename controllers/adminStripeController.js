const stripeAdminService = require('../services/stripeAdminService');
const Diagnostiqueur = require('../models/Diagnostiqueur');

/**
 * Créer un abonnement PRO pour un diagnostiqueur
 */
exports.creerAbonnementDiagnostiqueur = async (req, res) => {
  try {
    const { diagnostiqueurId } = req.params;
    const adminId = req.user.id;

    const result = await stripeAdminService.creerAbonnementPourDiagnostiqueur(diagnostiqueurId, adminId);

    res.json({
      message: 'Abonnement PRO créé avec succès',
      ...result
    });
  } catch (error) {
    console.error('Erreur creerAbonnementDiagnostiqueur:', error);
    res.status(500).json({ message: error.message });
  }
};

/**
 * Annuler un abonnement (downgrade vers STANDARD)
 */
exports.annulerAbonnementDiagnostiqueur = async (req, res) => {
  try {
    const { diagnostiqueurId } = req.params;
    const { raison } = req.body;
    const adminId = req.user.id;

    const result = await stripeAdminService.annulerAbonnementDiagnostiqueur(diagnostiqueurId, adminId, raison);

    res.json({
      message: 'Abonnement annulé, diagnostiqueur passé en STANDARD',
      ...result
    });
  } catch (error) {
    console.error('Erreur annulerAbonnementDiagnostiqueur:', error);
    res.status(500).json({ message: error.message });
  }
};

/**
 * Modifier les fonctionnalités/limites d'un diagnostiqueur
 */
exports.modifierFonctionnalites = async (req, res) => {
  try {
    const { diagnostiqueurId } = req.params;
    const { fonctionnalites, limites } = req.body;

    const diagnostiqueur = await Diagnostiqueur.findById(diagnostiqueurId);
    if (!diagnostiqueur) {
      return res.status(404).json({ message: 'Diagnostiqueur non trouvé' });
    }

    // Modifier les fonctionnalités
    if (fonctionnalites) {
      if (!diagnostiqueur.fonctionnalitesPremium) {
        diagnostiqueur.fonctionnalitesPremium = {};
      }
      Object.assign(diagnostiqueur.fonctionnalitesPremium, fonctionnalites);
    }

    // Modifier les limites
    if (limites) {
      await stripeAdminService.modifierLimitesDiagnostiqueur(diagnostiqueurId, limites);
    }

    await diagnostiqueur.save();

    res.json({
      message: 'Fonctionnalités mises à jour',
      diagnostiqueur
    });
  } catch (error) {
    console.error('Erreur modifierFonctionnalites:', error);
    res.status(500).json({ message: error.message });
  }
};

module.exports = {
  creerAbonnementDiagnostiqueur,
  annulerAbonnementDiagnostiqueur,
  modifierFonctionnalites
};
