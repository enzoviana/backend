// models/configuration.js
const mongoose = require('mongoose');
const { Schema } = mongoose;

/**
 * Schéma Diagnostic
 */
const DiagnosticSchema = new Schema({
  nom: { type: String, required: true, trim: true },
  tarif: { type: Number, required: true, min: 0 }
}, { _id: true }); // chaque diagnostic a son propre _id

/**
 * Schéma Pack
 */
const PackSchema = new Schema({
  nom: { type: String, required: true, trim: true },
  tarif: { type: Number, required: true, min: 0 },
  diagnostics: [{ type: Schema.Types.ObjectId, ref: 'Diagnostic' }] // références aux diagnostics
}, { _id: true });

/**
 * Schéma Configuration
 * Une seule configuration peut exister pour l'application, ou plusieurs si besoin
 */
const ConfigurationSchema = new Schema({
  diagnostics: [DiagnosticSchema],
  packs: [PackSchema]
}, { timestamps: true });

module.exports = mongoose.model('Configuration', ConfigurationSchema);
