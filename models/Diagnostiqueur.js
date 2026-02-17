const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const { Schema } = mongoose;

/**
 * Sous-schéma Admin du diagnostiqueur
 */
const AdminDiagnostiqueurSchema = new Schema({
  nom: { type: String, required: true },
  prenom: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  mot_de_passe: { type: String, required: true },
  telephone: { type: String, required: true },
  photo_profil: { type: String, default: null },

  // Champs pour réinitialisation mot de passe
  resetPasswordToken: { type: String, default: null },
  resetPasswordExpires: { type: Date, default: null }
}, { _id: true });

// Hash du mot de passe admin avant sauvegarde
AdminDiagnostiqueurSchema.pre('save', async function (next) {
  if (this.isModified('mot_de_passe')) {
    this.mot_de_passe = await bcrypt.hash(this.mot_de_passe, 10);
  }
  next();
});

/**
 * Sous-schéma Documents administratifs
 */
const DocumentAdministratifSchema = new Schema({
  type: {
    type: String,
    enum: ['kbis', 'assurance_rc', 'assurance_decennale', 'autre'],
    required: true
  },
  nom: { type: String, required: true },
  url: { type: String, required: true },
  public_id: { type: String, required: true },
  dateExpiration: { type: Date, default: null },
  dateDepot: { type: Date, default: Date.now },
  statut: {
    type: String,
    enum: ['valide', 'expire', 'a_renouveler', 'en_attente'],
    default: 'valide'
  }
}, { _id: true });

/**
 * Sous-schéma Historique diagnostiqueurs utilisés
 */
const DiagnostiqueurUtiliseSchema = new Schema({
  agence: { type: Schema.Types.ObjectId, ref: 'Agence', required: true },
  nombreCommandes: { type: Number, default: 0 },
  derniereCommande: { type: Date, default: Date.now }
}, { _id: false });

/**
 * Schéma principal Diagnostiqueur
 * Entreprise de diagnostic avec admin, documents, abonnement
 */
const DiagnostiqueurSchema = new Schema({
  // Informations entreprise
  nom_entreprise: { type: String, required: true },
  siret: { type: String, required: true, unique: true },
  adresse: { type: String, required: true },
  email_entreprise: { type: String, required: true },
  logo: { type: String, default: null },
  description: { type: String, default: null },

  // Admin de l'entreprise (sous-document)
  admin: { type: AdminDiagnostiqueurSchema, required: true },

  // Documents administratifs
  documents: [DocumentAdministratifSchema],

  // Statut du compte
  statut: {
    type: String,
    enum: ['en_attente', 'actif', 'bloqué', 'suspendu', 'inactif'],
    default: 'en_attente'
  },

  // Abonnement
  typeAbonnement: {
    type: String,
    enum: ['STANDARD', 'PRO'],
    default: 'STANDARD'
  },
  stripeCustomerId: { type: String, default: null },
  stripeSubscriptionId: { type: String, default: null },
  stripeSubscriptionStatus: { type: String, default: null },

  // Secteurs d'intervention
  secteursIntervention: [{
    type: String,
    enum: ['Var', 'Hérault', 'Autre']
  }],

  // Notation
  noteGlobale: { type: Number, default: 0, min: 0, max: 5 },
  nombreEvaluations: { type: Number, default: 0 },

  // Relations
  agencesPartenaires: [{
    type: Schema.Types.ObjectId,
    ref: 'Agence'
  }],

  // Validation par admin
  validePar: {
    type: Schema.Types.ObjectId,
    ref: 'Admin',
    default: null
  },
  dateValidation: { type: Date, default: null },

  // Historique utilisation par agences
  historiqueUtilisation: [DiagnostiqueurUtiliseSchema]

}, { timestamps: true });

// Index pour recherche rapide
DiagnostiqueurSchema.index({ statut: 1, typeAbonnement: 1 });
DiagnostiqueurSchema.index({ siret: 1 });
DiagnostiqueurSchema.index({ 'admin.email': 1 });
DiagnostiqueurSchema.index({ secteursIntervention: 1 });

/**
 * Méthode pour recalculer la note globale
 */
DiagnostiqueurSchema.methods.recalculerNoteGlobale = async function() {
  const NotationDiagnostiqueur = mongoose.model('NotationDiagnostiqueur');

  const notations = await NotationDiagnostiqueur.find({
    diagnostiqueur: this._id,
    statut: 'publie'
  });

  if (notations.length === 0) {
    this.noteGlobale = 0;
    this.nombreEvaluations = 0;
  } else {
    const somme = notations.reduce((acc, n) => acc + n.note, 0);
    this.noteGlobale = Math.round((somme / notations.length) * 10) / 10; // Arrondi à 1 décimale
    this.nombreEvaluations = notations.length;
  }

  await this.save();
  return this;
};

/**
 * Méthode pour vérifier si un document est expiré ou va expirer
 */
DiagnostiqueurSchema.methods.verifierExpirationDocuments = function() {
  const maintenant = new Date();
  const alertes = [];

  this.documents.forEach(doc => {
    if (doc.dateExpiration) {
      const joursRestants = Math.ceil((doc.dateExpiration - maintenant) / (1000 * 60 * 60 * 24));

      if (joursRestants < 0) {
        doc.statut = 'expire';
        alertes.push({ type: doc.type, joursRestants, niveau: 'expire' });
      } else if (joursRestants <= 7) {
        doc.statut = 'a_renouveler';
        alertes.push({ type: doc.type, joursRestants, niveau: 'critique' });
      } else if (joursRestants <= 30) {
        doc.statut = 'a_renouveler';
        alertes.push({ type: doc.type, joursRestants, niveau: 'avertissement' });
      } else if (joursRestants <= 60) {
        doc.statut = 'valide';
        alertes.push({ type: doc.type, joursRestants, niveau: 'info' });
      } else {
        doc.statut = 'valide';
      }
    }
  });

  return alertes;
};

module.exports = mongoose.model('Diagnostiqueur', DiagnostiqueurSchema);
