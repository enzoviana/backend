const mongoose = require('mongoose');
const { Schema } = mongoose;

/**
 * Sous-schéma Facture
 */
const FactureSchema = new Schema({
  stripeInvoiceId: { type: String, required: true },
  montant: { type: Number, required: true },
  statut: {
    type: String,
    enum: ['paid', 'open', 'void', 'uncollectible'],
    required: true
  },
  dateFacture: { type: Date, required: true },
  pdfUrl: { type: String, default: null }
}, { _id: true });

/**
 * Sous-schéma Historique abonnement
 */
const HistoriqueAbonnementSchema = new Schema({
  action: {
    type: String,
    enum: ['creation', 'upgrade', 'downgrade', 'renouvellement', 'annulation', 'suspension'],
    required: true
  },
  ancienType: {
    type: String,
    enum: ['STANDARD', 'PRO', null],
    default: null
  },
  nouveauType: {
    type: String,
    enum: ['STANDARD', 'PRO'],
    required: true
  },
  date: { type: Date, default: Date.now },
  par: { type: String, default: 'système' },
  raison: { type: String, default: '' }
}, { _id: true });

/**
 * Gestion des abonnements Stripe pour diagnostiqueurs
 */
const AbonnementDiagnostiqueurSchema = new Schema({
  // Lien avec le diagnostiqueur
  diagnostiqueur: {
    type: Schema.Types.ObjectId,
    ref: 'Diagnostiqueur',
    required: true,
    unique: true
  },

  // Type d'abonnement
  type: {
    type: String,
    enum: ['STANDARD', 'PRO'],
    required: true,
    default: 'STANDARD'
  },

  // Informations Stripe
  stripeSubscriptionId: { type: String, default: null },
  stripePriceId: { type: String, default: null },
  stripeInvoiceId: { type: String, default: null },

  // Statut Stripe
  statut: {
    type: String,
    enum: ['active', 'canceled', 'past_due', 'unpaid', 'trialing', 'incomplete', 'incomplete_expired'],
    default: 'active'
  },

  // Dates
  dateDebut: { type: Date, default: Date.now },
  dateFin: { type: Date, default: null },
  prochainePeriode: { type: Date, default: null },

  // Factures
  factures: [FactureSchema],

  // Historique
  historique: [HistoriqueAbonnementSchema]

}, { timestamps: true });

// Index pour recherche rapide
AbonnementDiagnostiqueurSchema.index({ diagnostiqueur: 1 });
AbonnementDiagnostiqueurSchema.index({ type: 1, statut: 1 });
AbonnementDiagnostiqueurSchema.index({ stripeSubscriptionId: 1 });

/**
 * Méthode pour ajouter une facture
 */
AbonnementDiagnostiqueurSchema.methods.ajouterFacture = function(factureData) {
  this.factures.push(factureData);
  return this.save();
};

/**
 * Méthode pour ajouter un événement à l'historique
 */
AbonnementDiagnostiqueurSchema.methods.ajouterHistorique = function(historiqueData) {
  this.historique.push(historiqueData);
  return this.save();
};

module.exports = mongoose.model('AbonnementDiagnostiqueur', AbonnementDiagnostiqueurSchema);
