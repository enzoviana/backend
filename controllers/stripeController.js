const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const stripeService = require('../services/stripeService');

/**
 * Webhook Stripe
 * Gère les événements envoyés par Stripe
 */
exports.handleWebhook = async (req, res) => {
  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event;

  try {
    // Vérifier la signature du webhook
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
  } catch (err) {
    console.error('⚠️ Erreur validation webhook Stripe:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  console.log(`✅ Webhook Stripe reçu: ${event.type}`);

  // Gérer les différents événements
  try {
    switch (event.type) {
      case 'checkout.session.completed':
        await stripeService.handleCheckoutCompleted(event.data.object);
        break;

      case 'customer.subscription.updated':
        await stripeService.handleSubscriptionUpdated(event.data.object);
        break;

      case 'customer.subscription.deleted':
        await stripeService.handleSubscriptionUpdated(event.data.object);
        break;

      case 'invoice.payment_succeeded':
        await stripeService.handleInvoicePaymentSucceeded(event.data.object);
        break;

      case 'invoice.payment_failed':
        console.log('❌ Échec paiement facture:', event.data.object.id);
        // TODO: Gérer l'échec de paiement (notifier diagnostiqueur, etc.)
        break;

      default:
        console.log(`Événement non géré: ${event.type}`);
    }

    res.json({ received: true });

  } catch (error) {
    console.error('❌ Erreur traitement webhook:', error);
    res.status(500).json({ error: 'Erreur traitement webhook' });
  }
};

/**
 * Créer une session Checkout
 */
exports.createCheckoutSession = async (req, res) => {
  try {
    const { diagnostiqueurId, returnUrl, cancelUrl } = req.body;

    const session = await stripeService.creerCheckoutSession(diagnostiqueurId, returnUrl, cancelUrl);

    res.json({
      sessionId: session.id,
      sessionUrl: session.url
    });

  } catch (error) {
    console.error('Erreur createCheckoutSession:', error);
    res.status(500).json({ message: 'Erreur lors de la création de la session Stripe.' });
  }
};

/**
 * Créer une session Portal
 */
exports.createPortalSession = async (req, res) => {
  try {
    // 1. Sécurisation contre le req.body undefined (évite le crash de destructuration)
    const { diagnostiqueurId, returnUrl } = req.body || {};

    // 2. Récupération intelligente de l'ID :
    // Si le front-end a envoyé 'null', on prend l'ID extrait du token JWT par votre middleware auth (req.diagnostiqueur)
    const finalDiagnostiqueurId = diagnostiqueurId || (req.diagnostiqueur && req.diagnostiqueur._id);

    // 3. Validation de sécurité
    if (!finalDiagnostiqueurId) {
      console.error('[Backend] ❌ Impossible de créer le portail : Aucun ID de diagnostiqueur trouvé (body ou token).');
      return res.status(400).json({ 
        message: 'Identification du diagnostiqueur impossible. Vérifiez votre session.' 
      });
    }

    console.log(`[Backend] 🔄 Demande de session Portal Stripe pour le diagnostiqueur ID : ${finalDiagnostiqueurId}`);
    console.log(`[Backend] ↩️ URL de retour configurée : ${returnUrl}`);

    // Appel de votre service Stripe (qui attend l'ID corrigé)
    const session = await stripeService.creerPortalSession(finalDiagnostiqueurId, returnUrl);

    // Renvoi de l'URL au front-end Vue
    res.json({
      sessionUrl: session.url
    });

  } catch (error) {
    // Log ultra-précis pour voir si Stripe rejette la demande (ex: si le customer ID n'existe pas chez eux)
    console.error('❌ Erreur critique createPortalSession:', error.message);
    console.error(error.stack);
    
    res.status(500).json({ 
      message: 'Erreur lors de la création de la session portal.',
      error: error.message 
    });
  }
};

module.exports = exports;
