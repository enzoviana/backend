// models/admin.js
const mongoose = require('mongoose');
const { Schema } = mongoose;

/**
 * Schéma pour les informations de l'entreprise (sous-document)
 * _id: false pour ne pas créer d'id distinct pour le sous-document
 */
const CompanySchema = new Schema({
  name: { type: String, trim: true }, // nom de l'entreprise (optionnel si tu le veux)
  logo: { type: String, trim: true }, // URL ou chemin vers le logo
  siret: {
    type: String,
    trim: true,
    validate: {
      validator: v => !v || /^\d{14}$/.test(v), // SIRET = 14 chiffres (si renseigné)
      message: props => `${props.value} n'est pas un SIRET valide (14 chiffres).`
    }
  },
  adresse: {
    rue: { type: String, trim: true },
    codePostal: { type: String, trim: true },
    ville: { type: String, trim: true },
    pays: { type: String, trim: true, default: 'France' }
  },
  telephone: {
    type: String,
    trim: true
    // Option: ajouter un validate si tu veux une regex stricte pour les numéros
  },
  numeroTVA: {
    type: String,
    trim: true
    // Pas de validation stricte ici car formats internationaux varient
  }
}, { _id: false });

/**
 * Schéma Admin
 */
const AdminSchema = new Schema({
  nom: { type: String, required: true, trim: true },
  prenom: { type: String, required: true, trim: true },
  email: {
    type: String,
    required: true,
    trim: true,
    lowercase: true,
    unique: true,
    index: true,
    validate: {
      validator: v => /^\S+@\S+\.\S+$/.test(v),
      message: props => `${props.value} n'est pas un email valide.`
    }
  },
  mot_de_passe: { type: String, required: true },
  telephone: {
    type: String,
    trim: true
    // Option: ajouter validate: { validator: v => /.../.test(v) } si tu veux
  },

  // OPTION A: entreprise embarquée (sous-document)
  entreprise: {
    type: CompanySchema,
    required: true
  },

  // champs utiles supplémentaires
  role: { type: String, default: 'admin' },
  isActive: { type: Boolean, default: true }
}, {
  timestamps: true // createdAt, updatedAt
});

/**
 * Hooks / méthodes utiles
 */
AdminSchema.pre('save', function(next) {
  // Exemple : nettoyer l'email et téléphone
  if (this.email) this.email = this.email.toLowerCase().trim();
  if (this.telephone) this.telephone = this.telephone.trim();
  next();
});

// Exemple de méthode d'instance
AdminSchema.methods.displayName = function() {
  return `${this.prenom} ${this.nom}`;
};

module.exports = mongoose.model('Admin', AdminSchema);
