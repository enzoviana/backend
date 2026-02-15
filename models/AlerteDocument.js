const mongoose = require('mongoose');
const { Schema } = mongoose;

/**
 * Sous-schéma Notification
 */
const NotificationSchema = new Schema({
  type: {
    type: String,
    enum: ['email', 'plateforme'],
    required: true
  },
  date: { type: Date, default: Date.now },
  seuil: {
    type: Number,
    required: true // Nombre de jours au moment de l'envoi
  }
}, { _id: true });

/**
 * Alertes d'expiration de documents
 */
const AlerteDocumentSchema = new Schema({
  // Lien avec le diagnostiqueur
  diagnostiqueur: {
    type: Schema.Types.ObjectId,
    ref: 'Diagnostiqueur',
    required: true
  },

  // Type de document
  type: {
    type: String,
    enum: ['certification', 'assurance_rc', 'assurance_decennale', 'kbis'],
    required: true
  },

  // Référence au document (polymorphique)
  documentRef: {
    type: Schema.Types.ObjectId,
    required: true,
    refPath: 'documentModel'
  },
  documentModel: {
    type: String,
    enum: ['Certification', 'Diagnostiqueur'],
    required: true
  },

  // Informations document
  nomDocument: { type: String, required: true },

  // Dates
  dateExpiration: { type: Date, required: true },
  joursRestants: { type: Number, required: true },

  // Niveau d'alerte
  niveau: {
    type: String,
    enum: ['info', 'avertissement', 'critique', 'expire'],
    required: true
  },

  // Notifications envoyées
  notifications: [NotificationSchema],

  // Statut
  statut: {
    type: String,
    enum: ['active', 'resolue', 'ignoree'],
    default: 'active'
  },

  // Date de résolution
  dateResolution: { type: Date, default: null }

}, { timestamps: true });

// Index pour recherche rapide
AlerteDocumentSchema.index({ diagnostiqueur: 1, statut: 1 });
AlerteDocumentSchema.index({ dateExpiration: 1, statut: 1 });
AlerteDocumentSchema.index({ niveau: 1, statut: 1 });

/**
 * Méthode pour ajouter une notification
 */
AlerteDocumentSchema.methods.ajouterNotification = function(type, seuil) {
  this.notifications.push({ type, seuil, date: new Date() });
  return this.save();
};

/**
 * Méthode pour vérifier si une notification a déjà été envoyée pour un seuil
 */
AlerteDocumentSchema.methods.notificationDejaEnvoyee = function(seuil) {
  return this.notifications.some(n => n.seuil === seuil);
};

module.exports = mongoose.model('AlerteDocument', AlerteDocumentSchema);
