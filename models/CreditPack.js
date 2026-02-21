const mongoose = require('mongoose');
const { Schema } = mongoose;

/**
 * Modèle pour les packs de crédits IA
 * Les agences peuvent acheter des packs pour utiliser la génération de devis par IA
 */
const CreditPackSchema = new Schema({
  nom: {
    type: String,
    required: true,
    trim: true
  },

  description: {
    type: String,
    default: ''
  },

  // Nombre de crédits dans ce pack
  nombreCredits: {
    type: Number,
    required: true,
    min: 1
  },

  // Prix du pack en centimes (pour Stripe)
  prixCentimes: {
    type: Number,
    required: true,
    min: 0
  },

  // Prix du pack en euros (pour affichage)
  prixEuros: {
    type: Number,
    required: true,
    min: 0
  },

  // Économie en pourcentage par rapport au prix unitaire (optionnel)
  economie: {
    type: Number,
    default: 0,
    min: 0,
    max: 100
  },

  // Badge à afficher (ex: "POPULAIRE", "MEILLEURE OFFRE")
  badge: {
    type: String,
    default: null
  },

  // Couleur du badge (ex: "blue", "green", "purple")
  badgeColor: {
    type: String,
    default: 'blue'
  },

  // Stripe Price ID pour ce pack
  stripePriceId: {
    type: String,
    default: null
  },

  // Stripe Product ID pour ce pack
  stripeProductId: {
    type: String,
    default: null
  },

  // Le pack est-il actif ?
  actif: {
    type: Boolean,
    default: true
  },

  // Ordre d'affichage (pour trier les packs)
  ordre: {
    type: Number,
    default: 0
  },

  // Fonctionnalités incluses (tableau de strings)
  fonctionnalites: {
    type: [String],
    default: []
  }

}, { timestamps: true });

/**
 * Méthode pour calculer le prix par crédit
 */
CreditPackSchema.methods.getPrixParCredit = function() {
  if (this.nombreCredits === 0) return 0;
  return (this.prixEuros / this.nombreCredits).toFixed(2);
};

module.exports = mongoose.model('CreditPack', CreditPackSchema);
