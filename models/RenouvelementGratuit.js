const mongoose = require('mongoose');
const { Schema } = mongoose;

/**
 * Sous-schéma Détails de vérification d'éligibilité
 */
const VerificationDetailsSchema = new Schema({
  ageEnMois: { type: Number, required: true },
  seuilAtteint: { type: Boolean, required: true }, // >= 6 mois
  dejaUtilise: { type: Boolean, required: true },
  diagnostiqueurPRO: { type: Boolean, required: true }
}, { _id: false });

/**
 * Renouvellements gratuits Termite/ERP (PRO uniquement)
 */
const RenouvelementGratuitSchema = new Schema({
  // Liens
  agence: {
    type: Schema.Types.ObjectId,
    ref: 'Agence',
    required: true
  },
  diagnostiqueur: {
    type: Schema.Types.ObjectId,
    ref: 'Diagnostiqueur',
    required: true
  },
  ordreMissionOriginal: {
    type: Schema.Types.ObjectId,
    ref: 'OrdreMission',
    required: true
  },
  client: {
    type: Schema.Types.ObjectId,
    ref: 'Client',
    required: true
  },

  // Type de renouvellement
  type: {
    type: String,
    enum: ['TERMITES', 'ERP'],
    required: true
  },

  // Éligibilité
  eligible: { type: Boolean, required: true },
  verificationDetails: VerificationDetailsSchema,

  // Statut
  statut: {
    type: String,
    enum: ['en_attente', 'approuve', 'refuse', 'traite', 'annule'],
    default: 'en_attente'
  },

  // Raison si refusé
  raisonRefus: { type: String, default: null },

  // Résultat
  nouvelOrdreMission: {
    type: Schema.Types.ObjectId,
    ref: 'OrdreMission',
    default: null
  },

  // Dates
  dateDemande: { type: Date, default: Date.now },
  dateTraitement: { type: Date, default: null },

  // Notes
  notes: { type: String, default: '' }

}, { timestamps: true });

// Index pour recherche rapide
RenouvelementGratuitSchema.index({ diagnostiqueur: 1, statut: 1 });
RenouvelementGratuitSchema.index({ agence: 1, statut: 1 });
RenouvelementGratuitSchema.index({ ordreMissionOriginal: 1, type: 1 });

module.exports = mongoose.model('RenouvelementGratuit', RenouvelementGratuitSchema);
