const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const Diagnostiqueur = require('../models/Diagnostiqueur');
const AbonnementDiagnostiqueur = require('../models/AbonnementDiagnostiqueur');
const creditsController = require('../controllers/creditsController');
const googleCalendarController = require('../controllers/googleCalendarController');

/**
 * Configuration des plans
 */
const PLANS = {
  STANDARD: {
    priceId: null, // Gratuit
    montant: 0
  },
  PRO: {
    priceId: process.env.STRIPE_PRICE_PRO, // ID du prix dans Stripe
    montant: 2900 // 29€ en centimes
  }
};

/**
 * Crée un customer Stripe pour un diagnostiqueur
 */
async function creerCustomer(diagnostiqueur) {
  try {
    const customer = await stripe.customers.create({
      email: diagnostiqueur.admin.email,
      name: diagnostiqueur.nom_entreprise,
      metadata: {
        diagnostiqueurId: diagnostiqueur._id.toString(),
        siret: diagnostiqueur.siret
      }
    });

    // Mettre à jour le diagnostiqueur avec l'ID Stripe
    diagnostiqueur.stripeCustomerId = customer.id;
    await diagnostiqueur.save();

    return customer;

  } catch (error) {
    console.error('Erreur creerCustomer:', error);
    throw error;
  }
}

/**
 * Crée une session Checkout pour upgrade PRO
 */
async function creerCheckoutSession(diagnostiqueurId, returnUrl, cancelUrl) {
  try {
    const diagnostiqueur = await Diagnostiqueur.findById(diagnostiqueurId);
    if (!diagnostiqueur) {
      throw new Error('Diagnostiqueur non trouvé');
    }

    // Créer customer Stripe s'il n'existe pas
    if (!diagnostiqueur.stripeCustomerId) {
      await creerCustomer(diagnostiqueur);
    }

    // Créer session Checkout
    const session = await stripe.checkout.sessions.create({
      customer: diagnostiqueur.stripeCustomerId,
      payment_method_types: ['card'],
      mode: 'subscription',
      line_items: [
        {
          price: PLANS.PRO.priceId,
          quantity: 1
        }
      ],
      success_url: `${returnUrl}?session_id={CHECKOUT_SESSION_ID}&success=true`,
      cancel_url: `${cancelUrl}?canceled=true`,
      metadata: {
        diagnostiqueurId: diagnostiqueurId.toString()
      }
    });

    return session;

  } catch (error) {
    console.error('Erreur creerCheckoutSession:', error);
    throw error;
  }
}

/**
 * Crée une session Portal pour gérer l'abonnement
 */
async function creerPortalSession(diagnostiqueurId, returnUrl) {
  try {
    const diagnostiqueur = await Diagnostiqueur.findById(diagnostiqueurId);
    if (!diagnostiqueur || !diagnostiqueur.stripeCustomerId) {
      throw new Error('Customer Stripe non trouvé');
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: diagnostiqueur.stripeCustomerId,
      return_url: returnUrl
    });

    return session;

  } catch (error) {
    console.error('Erreur creerPortalSession:', error);
    throw error;
  }
}

/**
 * Gère l'événement checkout.session.completed
 */
async function handleCheckoutCompleted(session) {
  try {
    // Vérifier si c'est un achat de pack de crédits (Admin ou Agence)
    if (session.metadata && (session.metadata.type === 'credit_pack_purchase' || session.metadata.type === 'credit_pack_purchase_admin')) {
      console.log('📦 Traitement achat pack de crédits');
      await creditsController.handlePaymentSuccess(session);
      return;
    }

    // Vérifier si c'est un achat de l'option Google Calendar
    if (session.metadata && session.metadata.type === 'google_calendar_option_admin') {
      console.log('📅 Traitement achat option Google Calendar');
      await googleCalendarController.handleGoogleCalendarPaymentSuccess(session);
      return;
    }

    // Vérifier si c'est un abonnement de contrat de maintenance
    if (session.metadata && session.metadata.type === 'contrat_maintenance') {
      console.log('📄 Traitement abonnement contrat de maintenance');
      const contratController = require('../controllers/contratController');
      await contratController.handleContratStripeWebhook(session);
      return;
    }

    // Sinon, c'est un abonnement diagnostiqueur
    const diagnostiqueurId = session.metadata.diagnostiqueurId;
    const subscriptionId = session.subscription;

    // Récupérer l'abonnement Stripe
    const subscription = await stripe.subscriptions.retrieve(subscriptionId);

    // Mettre à jour le diagnostiqueur
    const diagnostiqueur = await Diagnostiqueur.findById(diagnostiqueurId);
    if (!diagnostiqueur) {
      throw new Error('Diagnostiqueur non trouvé');
    }

    diagnostiqueur.typeAbonnement = 'PRO';
    diagnostiqueur.stripeSubscriptionId = subscriptionId;
    diagnostiqueur.stripeSubscriptionStatus = subscription.status;
    await diagnostiqueur.save();

    // 🌟 SÉCURISATION DES DATES CONTRE LES VALEURS UNDEFINED / NaN 🌟
    const dateDebut = subscription.current_period_start 
      ? new Date(subscription.current_period_start * 1000) 
      : new Date();

    const prochainePeriode = subscription.current_period_end 
      ? new Date(subscription.current_period_end * 1000) 
      : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // + 30 jours par défaut

    // Créer ou mettre à jour l'abonnement
    let abonnement = await AbonnementDiagnostiqueur.findOne({ diagnostiqueur: diagnostiqueurId });

    if (!abonnement) {
      abonnement = new AbonnementDiagnostiqueur({
        diagnostiqueur: diagnostiqueurId,
        type: 'PRO',
        stripeSubscriptionId: subscriptionId,
        stripePriceId: PLANS.PRO.priceId,
        statut: subscription.status,
        dateDebut: dateDebut,
        prochainePeriode: prochainePeriode
      });
    } else {
      abonnement.type = 'PRO';
      abonnement.stripeSubscriptionId = subscriptionId;
      abonnement.stripePriceId = PLANS.PRO.priceId;
      abonnement.statut = subscription.status;
      abonnement.dateDebut = dateDebut;
      abonnement.prochainePeriode = prochainePeriode;
    }

    // Ajouter à l'historique
    abonnement.historique.push({
      action: 'upgrade',
      ancienType: 'STANDARD',
      nouveauType: 'PRO',
      date: new Date(),
      par: 'diagnostiqueur'
    });

    await abonnement.save();

    console.log(`✅ Abonnement PRO activé pour diagnostiqueur ${diagnostiqueurId}`);

  } catch (error) {
    console.error('Erreur handleCheckoutCompleted:', error);
    throw error;
  }
}

/**
 * Gère l'événement customer.subscription.updated
 */
async function handleSubscriptionUpdated(subscription) {
  try {
    if (subscription.metadata && subscription.metadata.type === 'contrat_maintenance') {
      console.log('📄 Mise à jour abonnement contrat de maintenance');
      const contratController = require('../controllers/contratController');
      await contratController.handleContratSubscriptionUpdated(subscription);
      return;
    }

    const diagnostiqueur = await Diagnostiqueur.findOne({ stripeSubscriptionId: subscription.id });

    if (!diagnostiqueur) {
      console.warn(`Diagnostiqueur non trouvé pour subscription ${subscription.id}`);
      return;
    }

    diagnostiqueur.stripeSubscriptionStatus = subscription.status;

    if (subscription.status === 'canceled' || subscription.status === 'incomplete_expired') {
      diagnostiqueur.typeAbonnement = 'STANDARD';
      diagnostiqueur.stripeSubscriptionId = null;
    }

    await diagnostiqueur.save();

    const abonnement = await AbonnementDiagnostiqueur.findOne({ diagnostiqueur: diagnostiqueur._id });

    if (abonnement) {
      abonnement.statut = subscription.status;
      
      // 🌟 Sécurisation de la date de prochaine période
      if (subscription.current_period_end) {
        abonnement.prochainePeriode = new Date(subscription.current_period_end * 1000);
      }

      if (subscription.status === 'canceled') {
        abonnement.type = 'STANDARD';
        abonnement.dateFin = new Date();

        abonnement.historique.push({
          action: 'downgrade',
          ancienType: 'PRO',
          nouveauType: 'STANDARD',
          date: new Date(),
          par: 'système',
          raison: 'Abonnement annulé'
        });
      }

      await abonnement.save();
    }

    console.log(`✅ Abonnement mis à jour pour diagnostiqueur ${diagnostiqueur._id}, statut: ${subscription.status}`);

  } catch (error) {
    console.error('Erreur handleSubscriptionUpdated:', error);
    throw error;
  }
}

/**
 * Gère l'événement invoice.payment_succeeded
 */
async function handleInvoicePaymentSucceeded(invoice) {
  try {
    const subscriptionId = invoice.subscription;

    if (!subscriptionId) {
      return;
    }

    const diagnostiqueur = await Diagnostiqueur.findOne({ stripeSubscriptionId: subscriptionId });

    if (!diagnostiqueur) {
      console.warn(`Diagnostiqueur non trouvé pour subscription ${subscriptionId}`);
      return;
    }

    const abonnement = await AbonnementDiagnostiqueur.findOne({ diagnostiqueur: diagnostiqueur._id });

    if (abonnement) {
      // 🌟 Sécurisation de la date de facture
      const dateFacture = invoice.created ? new Date(invoice.created * 1000) : new Date();

      const factureData = {
        stripeInvoiceId: invoice.id,
        montant: invoice.amount_paid,
        statut: invoice.status,
        dateFacture: dateFacture,
        pdfUrl: invoice.invoice_pdf
      };

      abonnement.factures.push(factureData);
      await abonnement.save();

      console.log(`✅ Facture ajoutée pour diagnostiqueur ${diagnostiqueur._id}`);
    }

  } catch (error) {
    console.error('Erreur handleInvoicePaymentSucceeded:', error);
    throw error;
  }
}

/**
 * Annule un abonnement (à la fin de la période)
 */
async function annulerAbonnement(diagnostiqueurId) {
  try {
    const diagnostiqueur = await Diagnostiqueur.findById(diagnostiqueurId);

    if (!diagnostiqueur || !diagnostiqueur.stripeSubscriptionId) {
      throw new Error('Abonnement non trouvé');
    }

    await stripe.subscriptions.update(diagnostiqueur.stripeSubscriptionId, {
      cancel_at_period_end: true
    });

    const abonnement = await AbonnementDiagnostiqueur.findOne({ diagnostiqueur: diagnostiqueurId });

    if (abonnement) {
      abonnement.historique.push({
        action: 'annulation',
        ancienType: 'PRO',
        nouveauType: 'STANDARD',
        date: new Date(),
        par: 'diagnostiqueur',
        raison: 'Annulation volontaire'
      });

      await abonnement.save();
    }

    console.log(`✅ Abonnement annulé pour diagnostiqueur ${diagnostiqueurId}`);

  } catch (error) {
    console.error('Erreur annulerAbonnement:', error);
    throw error;
  }
}

/**
 * Récupère les factures d'un diagnostiqueur
 */
async function getFactures(diagnostiqueurId) {
  try {
    const abonnement = await AbonnementDiagnostiqueur.findOne({ diagnostiqueur: diagnostiqueurId });

    if (!abonnement) {
      return [];
    }

    return abonnement.factures;

  } catch (error) {
    console.error('Erreur getFactures:', error);
    throw error;
  }
}

module.exports = {
  PLANS,
  creerCustomer,
  creerCheckoutSession,
  creerPortalSession,
  handleCheckoutCompleted,
  handleSubscriptionUpdated,
  handleInvoicePaymentSucceeded,
  annulerAbonnement,
  getFactures
};