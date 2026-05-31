const express = require('express');
const router = express.Router();
const stripeController = require('../controllers/stripeController');
const diagnostiqueurAuth = require('../middlewares/diagnostiqueurAuth'); 
/**
 * IMPORTANT: Cette route doit recevoir le raw body
 * Le middleware express.json() ne doit PAS être appliqué ici
 * Voir server.js pour la configuration
 */
router.post('/webhook', express.raw({ type: 'application/json' }), stripeController.handleWebhook);

/**
 * Routes pour créer des sessions (avec authentification dans les contrôleurs si nécessaire)
 */
router.post('/create-checkout-session', stripeController.createCheckoutSession);
router.post('/create-portal-session', diagnostiqueurAuth, stripeController.createPortalSession);
module.exports = router;
