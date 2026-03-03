const eligibiliteService = require('../services/eligibiliteService');
const JournalEligibilite = require('../models/JournalEligibilite');

/**
 * Middleware pour vérifier l'éligibilité avant acceptation de commande
 * Doit être après diagnostiqueurAuth ou authMiddleware (admin)
 */
const checkEligibilite = async (req, res, next) => {
  try {
    console.log('================= CHECK ELIGIBILITE START =================');

    // 🔎 1. Inspecter le contenu du req
    console.log('➡️ req.user:', req.user);
    console.log('➡️ req.diagnostiqueur:', req.diagnostiqueur);
    console.log('➡️ req.body:', req.body);
    console.log('➡️ req.params:', req.params);

    // Déterminer l'ID utilisateur (admin ou diagnostiqueur)
    const userId = req.diagnostiqueur?._id || req.user?.id;
    const userType = req.diagnostiqueur ? 'diagnostiqueur' : 'admin';

    console.log('➡️ userType détecté:', userType);
    console.log('➡️ userId détecté:', userId);

    if (!userId) {
      console.log('❌ Aucun userId détecté - problème authentification');
      return res.status(401).json({ message: 'Authentification requise.' });
    }

    // 🔎 2. Récupération devisId
    const devisId = req.body.devisId || req.params.devisId;
    console.log('➡️ devisId détecté:', devisId);

    if (!devisId) {
      console.log('❌ devisId manquant');
      return res.status(400).json({ message: 'devisId manquant.' });
    }

    console.log(`🔍 Vérification éligibilité: ${userType} ${userId} pour devis ${devisId}`);

    // 🔎 3. Appel service
    const resultat = await eligibiliteService.verifierEligibilite(userId, devisId);

    console.log('➡️ Résultat complet retourné par verifierEligibilite:');
    console.log(JSON.stringify(resultat, null, 2));

    if (!resultat) {
      console.log('❌ verifierEligibilite retourne undefined ou null');
      return res.status(500).json({ message: 'Erreur interne - résultat éligibilité vide.' });
    }

    // 🔎 4. Vérification bypass admin
    console.log('➡️ bypassAdmin:', resultat.bypassAdmin);

    if (resultat.bypassAdmin) {
      console.log('✅ Admin bypass - Éligibilité automatique');
      req.eligibiliteVerifiee = true;
      req.resultatEligibilite = resultat;
      console.log('================= CHECK ELIGIBILITE END (BYPASS) =================');
      return next();
    }

    // 🔎 5. Vérification champ eligible
    console.log('➡️ resultat.eligible:', resultat.eligible);
    console.log('➡️ raisonsIneligibilite:', resultat.raisonsIneligibilite);
    console.log('➡️ certificationsManquantes:', resultat.certificationsManquantes);
    console.log('➡️ assurancesVerifiees:', resultat.assurancesVerifiees);

    // 🔎 6. Journalisation
    console.log('📝 Enregistrement dans JournalEligibilite...');
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
    console.log('✅ Journal enregistré');

    // 🔎 7. Blocage si non éligible
    if (!resultat.eligible) {
      console.log('⛔ BLOQUÉ - Utilisateur non éligible');
      console.log('================= CHECK ELIGIBILITE END (REFUS) =================');

      return res.status(403).json({
        message: 'Vous n\'êtes pas éligible pour cette commande.',
        eligible: false,
        raisons: resultat.raisonsIneligibilite,
        certificationsManquantes: resultat.certificationsManquantes,
        assurances: resultat.assurancesVerifiees,
        actionRequise: 'Veuillez ajouter les certifications manquantes et vous assurer que vos assurances sont à jour.'
      });
    }

    // ✅ OK
    req.eligibiliteVerifiee = true;
    req.resultatEligibilite = resultat;

    console.log('✅ Éligibilité vérifiée avec succès');
    console.log('================= CHECK ELIGIBILITE END (SUCCESS) =================');

    next();

  } catch (error) {
    console.error('💥 Erreur checkEligibilite:', error);
    console.log('================= CHECK ELIGIBILITE END (ERROR) =================');
    res.status(500).json({ message: 'Erreur lors de la vérification de l\'éligibilité.' });
  }
};

module.exports = checkEligibilite;
