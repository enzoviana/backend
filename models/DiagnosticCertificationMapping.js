const mongoose = require('mongoose');
const { Schema } = mongoose;

/**
 * Mapping entre diagnostics et certifications requises
 * Permet à l'admin de configurer quelles certifications sont nécessaires pour chaque diagnostic
 */
const DiagnosticCertificationMappingSchema = new Schema({
  // Diagnostic concerné
  diagnostic: {
    type: Schema.Types.ObjectId,
    ref: 'Diagnostic',
    required: true,
    unique: true
  },

  // Domaines de certification requis
  domainesCertification: [{
    domaine: {
      type: Schema.Types.ObjectId,
      ref: 'DomaineActivite',
      required: true
    },
    obligatoire: {
      type: Boolean,
      default: true
    },
    mentionSpecialeRequise: {
      type: String,
      default: null
    }
  }],

  // Actif ou non
  actif: {
    type: Boolean,
    default: true
  }

}, { timestamps: true });

// Index pour performance
DiagnosticCertificationMappingSchema.index({ diagnostic: 1 });
DiagnosticCertificationMappingSchema.index({ actif: 1 });

module.exports = mongoose.model('DiagnosticCertificationMapping', DiagnosticCertificationMappingSchema);
