const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const Diagnostiqueur = require('../models/Diagnostiqueur');
const AbonnementDiagnostiqueur = require('../models/AbonnementDiagnostiqueur');

// Prix des abonnements (à configurer dans .env)
const PLANS = {
  STANDARD: { priceId: null, montant: 0 },
  PRO: { priceId: process.env.STRIPE_PRICE_PRO, montant: 2900 }
};

/**
 * Créer un abonnement PRO pour un diagnostiqueur (depuis admin)
 */
async function creerAbonnementPourDiagnostiqueur(diagnostiqueurId, adminId) {
  try {
    const diagnostiqueur = await Diagnostiqueur.findById(diagnostiqueurId);
    if (!diagnostiqueur) {
      throw new Error('Diagnostiqueur non trouvé');
    }

    // Créer customer Stripe si n'existe pas
    if (!diagnostiqueur.stripeCustomerId) {
      const customer = await stripe.customers.create({
        email: diagnostiqueur.admin.email,
        name: diagnostiqueur.nom_entreprise,
        metadata: {
          diagnostiqueurId: diagnostiqueur._id.toString(),
          siret: diagnostiqueur.siret,
          createdBy: 'admin',
          adminId: adminId.toString()
        }
      });

      diagnostiqueur.stripeCustomerId = customer.id;
      await diagnostiqueur.save();
    }

    // Créer l'abonnement
    const subscription = await stripe.subscriptions.create({
      customer: diagnostiqueur.stripeCustomerId,
      items: [{ price: PLANS.PRO.priceId }],
      metadata: {
        diagnostiqueurId: diagnostiqueur._id.toString(),
        createdBy: 'admin',
        adminId: adminId.toString()
      },
      payment_behavior: 'default_incomplete',
      payment_settings: {
        save_default_payment_method: 'on_subscription'
      },
      expand: ['latest_invoice.payment_intent']
    });

    // Mettre à jour le diagnostiqueur
    diagnostiqueur.typeAbonnement = 'PRO';
    diagnostiqueur.stripeSubscriptionId = subscription.id;
    diagnostiqueur.stripeSubscriptionStatus = subscription.status;
    await diagnostiqueur.save();

    // Créer/mettre à jour AbonnementDiagnostiqueur
    let abonnement = await AbonnementDiagnostiqueur.findOne({ diagnostiqueur: diagnostiqueurId });
    if (!abonnement) {
      abonnement = new AbonnementDiagnostiqueur({
        diagnostiqueur: diagnostiqueurId,
        type: 'PRO',
        stripeSubscriptionId: subscription.id,
        stripePriceId: PLANS.PRO.priceId,
        statut: subscription.status,
        dateDebut: new Date(subscription.current_period_start * 1000),
        prochainePeriode: new Date(subscription.current_period_end * 1000)
      });
    } else {
      abonnement.type = 'PRO';
      abonnement.stripeSubscriptionId = subscription.id;
      abonnement.statut = subscription.status;
    }

    abonnement.historique.push({
      action: 'upgrade_admin',
      ancienType: 'STANDARD',
      nouveauType: 'PRO',
      date: new Date(),
      par: adminId,
      raison: 'Créé par admin'
    });

    await abonnement.save();

    return {
      success: true,
      subscription,
      clientSecret: subscription.latest_invoice?.payment_intent?.client_secret
    };
  } catch (error) {
    console.error('Erreur création abonnement:', error);
    throw error;
  }
}

/**
 * Annuler un abonnement PRO (downgrade vers STANDARD)
 */
async function annulerAbonnementDiagnostiqueur(diagnostiqueurId, adminId, raison) {
  try {
    const diagnostiqueur = await Diagnostiqueur.findById(diagnostiqueurId);
    if (!diagnostiqueur) {
      throw new Error('Diagnostiqueur non trouvé');
    }

    if (!diagnostiqueur.stripeSubscriptionId) {
      throw new Error('Aucun abonnement Stripe actif');
    }

    // Annuler l'abonnement immédiatement
    const subscription = await stripe.subscriptions.cancel(diagnostiqueur.stripeSubscriptionId);

    // Downgrade vers STANDARD
    diagnostiqueur.typeAbonnement = 'STANDARD';
    diagnostiqueur.stripeSubscriptionStatus = 'canceled';
    await diagnostiqueur.save();

    // Mettre à jour AbonnementDiagnostiqueur
    const abonnement = await AbonnementDiagnostiqueur.findOne({ diagnostiqueur: diagnostiqueurId });
    if (abonnement) {
      abonnement.type = 'STANDARD';
      abonnement.statut = 'canceled';
      abonnement.dateFin = new Date();

      abonnement.historique.push({
        action: 'downgrade_admin',
        ancienType: 'PRO',
        nouveauType: 'STANDARD',
        date: new Date(),
        par: adminId,
        raison: raison || 'Annulé par admin'
      });

      await abonnement.save();
    }

    return { success: true, subscription };
  } catch (error) {
    console.error('Erreur annulation abonnement:', error);
    throw error;
  }
}

/**
 * Modifier les limites d'utilisation d'un diagnostiqueur
 */
async function modifierLimitesDiagnostiqueur(diagnostiqueurId, limites) {
  try {
    const diagnostiqueur = await Diagnostiqueur.findById(diagnostiqueurId);
    if (!diagnostiqueur) {
      throw new Error('Diagnostiqueur non trouvé');
    }

    // Initialiser limites si nécessaire
    if (!diagnostiqueur.limites) {
      diagnostiqueur.limites = {};
    }

    Object.assign(diagnostiqueur.limites, limites);
    await diagnostiqueur.save();

    return { success: true, limites: diagnostiqueur.limites };
  } catch (error) {
    console.error('Erreur modification limites:', error);
    throw error;
  }
}

module.exports = {
  creerAbonnementPourDiagnostiqueur,
  annulerAbonnementDiagnostiqueur,
  modifierLimitesDiagnostiqueur
};
