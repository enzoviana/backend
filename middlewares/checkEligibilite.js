const eligibiliteService = require('../services/eligibiliteService');
const JournalEligibilite = require('../models/JournalEligibilite');

/**
 * Middleware pour vérifier l'éligibilité avant acceptation de commande
 * Doit être après diagnostiqueurAuth
 */
const checkEligibilite = async (req, res, next) => {
  try {
    // Vérifie que req.diagnostiqueur existe
    if (!req.diagnostiqueur) {
      return res.status(401).json({ message: 'Authentification requise.' });
    }

    // Récupérer devisId depuis les params ou le body
    const devisId = req.body.devisId || req.params.devisId;

    if (!devisId) {
      return res.status(400).json({ message: 'devisId manquant.' });
    }

    console.log(`🔍 Vérification éligibilité: diagnostiqueur ${req.diagnostiqueur._id} pour devis ${devisId}`);

    // Vérifier l'éligibilité
    const resultat = await eligibiliteService.verifierEligibilite(req.diagnostiqueur._id, devisId);

    // Enregistrer dans le journal
    await JournalEligibilite.create({
      diagnostiqueur: req.diagnostiqueur._id,
      devis: devisId,
      eligible: resultat.eligible,
      diagnosticsVerifies: resultat.diagnosticsVerifies,
      packsVerifies: resultat.packsVerifies,
      raisonsIneligibilite: resultat.raisonsIneligibilite,
      certificationsManquantes: resultat.certificationsManquantes,
      assurances: resultat.assurancesVerifiees,
      action: resultat.eligible ? 'commande_acceptee' : 'commande_refusee'
    });

    // Si non éligible, bloquer avec détails
    if (!resultat.eligible) {
      return res.status(403).json({
        message: 'Vous n\'êtes pas éligible pour cette commande.',
        eligible: false,
        raisons: resultat.raisonsIneligibilite,
        certificationsManquantes: resultat.certificationsManquantes,
        assurances: resultat.assurancesVerifiees
      });
    }

    // Injecter le résultat dans req pour utilisation ultérieure
    req.eligibiliteVerifiee = true;
    req.resultatEligibilite = resultat;

    console.log(`✅ Éligibilité vérifiée avec succès`);

    next();

  } catch (error) {
    console.error('Erreur checkEligibilite:', error);
    res.status(500).json({ message: 'Erreur lors de la vérification de l\'éligibilité.' });
  }
};

module.exports = checkEligibilite;
