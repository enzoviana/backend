const eligibiliteService = require('../services/eligibiliteService');
const JournalEligibilite = require('../models/JournalEligibilite');

/**
 * Middleware pour vérifier l'éligibilité avant acceptation de commande
 * Doit être après diagnostiqueurAuth ou authMiddleware (admin)
 */
const checkEligibilite = async (req, res, next) => {
  try {
    // Déterminer l'ID utilisateur (admin ou diagnostiqueur)
    const userId = req.diagnostiqueur?._id || req.user?.id;
    const userType = req.diagnostiqueur ? 'diagnostiqueur' : 'admin';

    if (!userId) {
      return res.status(401).json({ message: 'Authentification requise.' });
    }

    // Récupérer devisId depuis les params ou le body
    const devisId = req.body.devisId || req.params.devisId;

    if (!devisId) {
      return res.status(400).json({ message: 'devisId manquant.' });
    }

    console.log(`🔍 Vérification éligibilité: ${userType} ${userId} pour devis ${devisId}`);

    // Vérifier l'éligibilité (avec bypass automatique pour admin)
    const resultat = await eligibiliteService.verifierEligibilite(userId, devisId);

    // Bypass admin - passer directement
    if (resultat.bypassAdmin) {
      console.log('✅ Admin bypass - Éligibilité automatique');
      req.eligibiliteVerifiee = true;
      req.resultatEligibilite = resultat;
      return next();
    }

    // Enregistrer dans le journal (seulement pour diagnostiqueurs)
    await JournalEligibilite.create({
      diagnostiqueur: userId,
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
        assurances: resultat.assurancesVerifiees,
        actionRequise: 'Veuillez ajouter les certifications manquantes et vous assurer que vos assurances sont à jour.'
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
