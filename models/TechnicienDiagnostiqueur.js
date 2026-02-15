const mongoose = require('mongoose');
const { Schema } = mongoose;

/**
 * Techniciens rattachés à une entreprise de diagnostic
 */
const TechnicienDiagnostiqueurSchema = new Schema({
  // Lien avec l'entreprise
  diagnostiqueur: {
    type: Schema.Types.ObjectId,
    ref: 'Diagnostiqueur',
    required: true
  },

  // Identité
  nom: { type: String, required: true },
  prenom: { type: String, required: true },
  email: { type: String, required: true },
  telephone: { type: String, required: true },

  // Photo
  photo: { type: String, default: null },

  // Certifications du technicien (référence)
  certifications: [{
    type: Schema.Types.ObjectId,
    ref: 'Certification'
  }],

  // Statut
  actif: { type: Boolean, default: true },

  // Informations supplémentaires
  dateEmbauche: { type: Date, default: Date.now },
  notes: { type: String, default: '' }

}, { timestamps: true });

// Index pour recherche rapide
TechnicienDiagnostiqueurSchema.index({ diagnostiqueur: 1, actif: 1 });
TechnicienDiagnostiqueurSchema.index({ email: 1, diagnostiqueur: 1 });

module.exports = mongoose.model('TechnicienDiagnostiqueur', TechnicienDiagnostiqueurSchema);
