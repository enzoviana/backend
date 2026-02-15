const mongoose = require('mongoose');
const { Schema } = mongoose;

/**
 * Référentiel des domaines de diagnostic
 * Définit les différents types de diagnostics disponibles
 */
const DomaineActiviteSchema = new Schema({
  code: {
    type: String,
    enum: [
      'DPE',
      'AMIANTE',
      'PLOMB',
      'TERMITES',
      'GAZ',
      'ELECTRICITE',
      'ERP',
      'CARREZ',
      'BOUTIN',
      'SURFACE',
      'ASSAINISSEMENT',
      'MESURAGE',
      'MERULES'
    ],
    required: true,
    unique: true
  },

  nom: {
    type: String,
    required: true
  },

  description: {
    type: String,
    default: ''
  },

  // Exception: SURFACE n'a pas besoin de certification
  requiresCertification: {
    type: Boolean,
    default: true
  },

  // Pour les cas particuliers comme DPE avec mention locaux commerciaux
  mentionsSpeciales: [{
    code: String,
    libelle: String,
    description: String
  }],

  actif: {
    type: Boolean,
    default: true
  }
}, { timestamps: true });

// Index pour recherche rapide
DomaineActiviteSchema.index({ code: 1, actif: 1 });

module.exports = mongoose.model('DomaineActivite', DomaineActiviteSchema);
