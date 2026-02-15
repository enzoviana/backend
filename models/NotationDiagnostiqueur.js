const mongoose = require('mongoose');
const { Schema } = mongoose;

/**
 * Sous-schéma Critères détaillés
 */
const CriteresSchema = new Schema({
  ponctualite: { type: Number, min: 1, max: 5, required: true },
  professionnalisme: { type: Number, min: 1, max: 5, required: true },
  qualiteRapport: { type: Number, min: 1, max: 5, required: true },
  communication: { type: Number, min: 1, max: 5, required: true }
}, { _id: false });

/**
 * Sous-schéma Réponse du diagnostiqueur
 */
const ReponseSchema = new Schema({
  texte: { type: String, required: true },
  date: { type: Date, default: Date.now },
  auteur: { type: String, required: true } // nom + prénom de l'admin diagnostiqueur
}, { _id: false });

/**
 * Évaluations des diagnostiqueurs par les agences
 * Note: L'agence note le diagnostiqueur, pas le client vendeur directement
 */
const NotationDiagnostiqueurSchema = new Schema({
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
  ordreMission: {
    type: Schema.Types.ObjectId,
    ref: 'OrdreMission',
    required: true,
    unique: true // Une seule notation par mission
  },

  // Note globale (1-5 étoiles)
  note: {
    type: Number,
    min: 1,
    max: 5,
    required: true
  },

  // Commentaire
  commentaire: { type: String, default: '' },

  // Critères détaillés
  criteres: CriteresSchema,

  // Réponse du diagnostiqueur (droit de réponse)
  reponse: { type: ReponseSchema, default: null },

  // Statut
  statut: {
    type: String,
    enum: ['brouillon', 'publie', 'masque', 'signale'],
    default: 'publie'
  },

  // Métadonnées
  dateNotation: { type: Date, default: Date.now }

}, { timestamps: true });

// Index pour recherche rapide
NotationDiagnostiqueurSchema.index({ diagnostiqueur: 1, statut: 1 });
NotationDiagnostiqueurSchema.index({ agence: 1 });
NotationDiagnostiqueurSchema.index({ ordreMission: 1 }, { unique: true });

/**
 * Méthode pour ajouter une réponse
 */
NotationDiagnostiqueurSchema.methods.ajouterReponse = function(texte, auteur) {
  this.reponse = { texte, auteur, date: new Date() };
  return this.save();
};

module.exports = mongoose.model('NotationDiagnostiqueur', NotationDiagnostiqueurSchema);
