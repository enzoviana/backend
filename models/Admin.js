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
 * Schéma pour l'historique des crédits IA
 */
const CreditsHistoriqueSchema = new Schema({
  type: {
    type: String,
    enum: ['achat', 'utilisation', 'ajustement', 'cadeau'],
    required: true
  },
  nombreCredits: { type: Number, required: true },
  description: { type: String, default: '' },
  packAchete: { type: Schema.Types.ObjectId, ref: 'CreditPack', default: null },
  stripePaymentId: { type: String, default: null },
  devisGenere: { type: Schema.Types.ObjectId, ref: 'Devis', default: null },
  par: { type: String, default: 'système' },
  date: { type: Date, default: Date.now }
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
  },
  photoProfil: {
    type: String,
    trim: true,
    default: null
  },

  // OPTION A: entreprise embarquée (sous-document)
  entreprise: {
    type: CompanySchema,
    required: true
  },

  // champs utiles supplémentaires
  role: { type: String, default: 'admin' },
  isActive: { type: Boolean, default: true },

  // 🔹 Champs pour la réinitialisation du mot de passe
  resetPasswordToken: { type: String, default: null },
  resetPasswordExpires: { type: Date, default: null },

  // 🤖 Crédits IA pour la génération de devis
  creditsIA: {
    type: Number,
    default: 0,
    min: 0
  },

  historiqueCreditsIA: {
    type: [CreditsHistoriqueSchema],
    default: []
  },

  // 📅 Intégration Google Calendar
  googleCalendar: {
    isConnected: { type: Boolean, default: false },
    accessToken: { type: String, default: null, select: false }, // Masqué par défaut pour sécurité
    refreshToken: { type: String, default: null, select: false },
    tokenExpiry: { type: Date, default: null },
    email: { type: String, default: null }, // Email du compte Google connecté
    connectedAt: { type: Date, default: null },
    lastSync: { type: Date, default: null }
  },

  // 💼 Options payantes achetées
  optionsAchetees: {
    googleCalendar: {
      actif: { type: Boolean, default: false },
      dateAchat: { type: Date, default: null },
      dateExpiration: { type: Date, default: null }, // null = illimité
      prixPaye: { type: Number, default: 0 }
    }
  },

  // 📄 Contrat de maintenance
  contratMaintenance: {
    actif: { type: Boolean, default: false },
    type: {
      type: String,
      enum: ['serenite', 'evolution', 'aucun'],
      default: 'aucun'
    },
    dateDebut: { type: Date, default: null },
    dateExpiration: { type: Date, default: null }
  }
},

{
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

/**
 * 🔹 Méthode pour gérer les crédits IA
 */
AdminSchema.methods.ajouterCreditsIA = async function({
  type,
  nombreCredits,
  description,
  packAchete = null,
  stripePaymentId = null,
  devisGenere = null,
  par = 'système'
}) {
  try {
    if (!nombreCredits || isNaN(nombreCredits)) {
      throw new Error("Nombre de crédits invalide");
    }

    // Ajouter à l'historique
    this.historiqueCreditsIA.push({
      type,
      nombreCredits,
      description,
      packAchete,
      stripePaymentId,
      devisGenere,
      par,
      date: new Date()
    });

    // Mettre à jour le solde selon le type
    if (type === 'achat' || type === 'cadeau' || type === 'ajustement') {
      this.creditsIA += Math.abs(nombreCredits);
    } else if (type === 'utilisation') {
      this.creditsIA = Math.max(0, this.creditsIA - Math.abs(nombreCredits));
    }

    await this.save();
    return this;
  } catch (error) {
    console.error("Erreur ajouterCreditsIA:", error);
    throw error;
  }
};

/**
 * 🔹 Méthode pour vérifier si l'admin a assez de crédits
 */
AdminSchema.methods.aAssezDeCredits = function(nombreRequis = 1) {
  return this.creditsIA >= nombreRequis;
};

/**
 * 🔹 Méthode pour vérifier l'accès à Google Calendar
 * Retourne true si :
 * - L'option Google Calendar est achetée ET active
 * OU
 * - Le contrat de maintenance est "Pack Evolutions"
 */
AdminSchema.methods.aAccesGoogleCalendar = function() {
  // Option 1 : Option Google Calendar achetée
  const optionActive = this.optionsAchetees?.googleCalendar?.actif === true;

  // Vérifier expiration si date définie
  if (optionActive && this.optionsAchetees.googleCalendar.dateExpiration) {
    const maintenant = new Date();
    if (maintenant > new Date(this.optionsAchetees.googleCalendar.dateExpiration)) {
      return false; // Option expirée
    }
  }

  // Option 2 : Contrat Pack Evolutions
  const packEvolution = this.contratMaintenance?.actif &&
                       this.contratMaintenance?.type === 'evolution';

  return optionActive || packEvolution;
};

/**
 * 🔹 Méthodes Google Calendar
 */
AdminSchema.methods.connectGoogleCalendar = async function({
  accessToken,
  refreshToken,
  tokenExpiry,
  email
}) {
  try {
    this.googleCalendar = {
      isConnected: true,
      accessToken,
      refreshToken,
      tokenExpiry: tokenExpiry ? new Date(tokenExpiry) : null,
      email,
      connectedAt: new Date(),
      lastSync: null
    };

    await this.save();
    return this;
  } catch (error) {
    console.error("Erreur connectGoogleCalendar:", error);
    throw error;
  }
};

AdminSchema.methods.disconnectGoogleCalendar = async function() {
  try {
    this.googleCalendar = {
      isConnected: false,
      accessToken: null,
      refreshToken: null,
      tokenExpiry: null,
      email: null,
      connectedAt: null,
      lastSync: null
    };

    await this.save();
    return this;
  } catch (error) {
    console.error("Erreur disconnectGoogleCalendar:", error);
    throw error;
  }
};

AdminSchema.methods.isGoogleTokenExpired = function() {
  if (!this.googleCalendar.tokenExpiry) return true;
  return new Date() >= new Date(this.googleCalendar.tokenExpiry);
};

module.exports = mongoose.model('Admin', AdminSchema);
