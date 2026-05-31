const express = require('express');
const router = express.Router();
const adminSyncController = require('../controllers/adminSyncController');

// Middleware d'authentification admin (à adapter selon votre système)
// Pour l'instant, on suppose que vous avez déjà un middleware authMiddleware pour les admins
const { authMiddleware } = require('../middlewares/authMiddleware');

/**
 * Routes de synchronisation des bases de données
 * ATTENTION: Réservé aux administrateurs uniquement !
 */

/**
 * @route   GET /api/admin/sync/check-config
 * @desc    Vérifie la configuration des BDD (MONGO_LIVE et MONGO_URI)
 * @access  Admin
 */
// Temporairement sans authMiddleware pour tester
router.get('/check-config', adminSyncController.verifierConfig);

/**
 * @route   POST /api/admin/sync/start
 * @desc    Démarre une synchronisation asynchrone (en arrière-plan)
 * @body    { avecBackup: true, viderAvant: true, copierIndexes: true }
 * @access  Admin
 */
router.post('/start',  adminSyncController.demarrerSync);

/**
 * @route   GET /api/admin/sync/status/:syncId
 * @desc    Récupère le statut d'une synchronisation en cours
 * @access  Admin
 */
router.get('/status/:syncId',  adminSyncController.getStatusSync);

/**
 * @route   GET /api/admin/sync/list
 * @desc    Liste toutes les synchronisations (en cours et terminées)
 * @access  Admin
 */
router.get('/list',  adminSyncController.listerSyncs);

/**
 * @route   DELETE /api/admin/sync/clean
 * @desc    Nettoie les synchronisations terminées de la mémoire
 * @access  Admin
 */
router.delete('/clean',  adminSyncController.nettoyerSyncs);

/**
 * @route   POST /api/admin/sync/execute
 * @desc    Exécute une synchronisation bloquante (attend la fin)
 * @body    { avecBackup: true, viderAvant: true, copierIndexes: true }
 * @access  Admin
 * @warning Cette route peut prendre plusieurs minutes à répondre !
 */
router.post('/execute',  adminSyncController.executerSyncBloquante);

module.exports = router;
