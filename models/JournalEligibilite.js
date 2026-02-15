const mongoose = require('mongoose');
const { Schema } = mongoose;

/**
 * Traçabilité des décisions d'éligibilité
 */
const JournalEligibiliteSchema = new Schema({
  // Contexte
  diagnostiqueur: {
    type: Schema.Types.ObjectId,
    ref: 'Diagnostiqueur',
    required: true
  },
  ordreMission: {
    type: Schema.Types.ObjectId,
    ref: 'OrdreMission',
    default: null
  },
  devis: {
    type: Schema.Types.ObjectId,
    ref: 'Devis',
    required: true
  },

  // Résultat
  eligible: { type: Boolean, required: true },

  // Détails vérification
  diagnosticsVerifies: [{
    diagnosticId: { type: Schema.Types.ObjectId, ref: 'Diagnostic' },
    nom: String,
    domaineCode: String,
    eligible: Boolean,
    certificationTrouvee: Boolean
  }],

  packsVerifies: [{
    packId: { type: Schema.Types.ObjectId, ref: 'Pack' },
    nom: String,
    eligible: Boolean
  }],

  raisonsIneligibilite: [String],

  certificationsManquantes: [{
    domaineCode: String,
    nomDomaine: String
  }],

  // Vérification assurances
  assurances: {
    rc: {
      valide: Boolean,
      dateExpiration: Date
    },
    decennale: {
      valide: Boolean,
      dateExpiration: Date
    }
  },

  // Action effectuée
  action: {
    type: String,
    enum: ['commande_acceptee', 'commande_refusee', 'verification_simple'],
    required: true
  },

  // Performance
  dureeMsCalcul: { type: Number, default: 0 },

  // Date
  dateVerification: { type: Date, default: Date.now }

}, { timestamps: true });

// Index pour recherche rapide
JournalEligibiliteSchema.index({ diagnostiqueur: 1, dateVerification: -1 });
JournalEligibiliteSchema.index({ ordreMission: 1 });
JournalEligibiliteSchema.index({ devis: 1 });

module.exports = mongoose.model('JournalEligibilite', JournalEligibiliteSchema);
