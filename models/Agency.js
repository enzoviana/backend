const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const { Schema } = mongoose;


// 🔹 Sous-schema pour l'historique de la cagnotte
const CagnotteHistoriqueSchema = new Schema({
  type: {
    type: String,
    enum: ['ajout', 'retrait', 'en_attente', 'validation', 'transfert', 'autre', 'gain'],
    required: true
  },
  montant: { type: Number, required: true },
  description: { type: String, default: '' },
  par: { type: String, default: 'système' }, // ex: 'admin', 'client', 'système'
  date: { type: Date, default: Date.now }
}, { _id: false });

// 🔹 Sous-schema pour l'historique des crédits IA
const CreditsHistoriqueSchema = new Schema({
  type: {
    type: String,
    enum: ['achat', 'utilisation', 'ajustement', 'cadeau'],
    required: true
  },
  nombreCredits: { type: Number, required: true }, // Positif pour ajout, négatif pour utilisation
  description: { type: String, default: '' },
  packAchete: { type: Schema.Types.ObjectId, ref: 'CreditPack', default: null },
  stripePaymentId: { type: String, default: null }, // ID du paiement Stripe
  devisGenere: { type: Schema.Types.ObjectId, ref: 'Devis', default: null }, // Si utilisation pour un devis
  par: { type: String, default: 'système' },
  date: { type: Date, default: Date.now }
}, { _id: false });

/**
 * Sous-schema Admin pour l'agence
 */
const AdminSchema = new Schema({
  nom: { type: String, required: true },
  prenom: { type: String, default: 'Admin' },
  email: { type: String, required: true, unique: true },
  mot_de_passe: { type: String, required: true },
  telephone_portable: { type: String, required: true },
  role: { type: String, default: 'admin' },
  photo_profil: { type: String, default: null },

  // 🔹 Champs pour la réinitialisation du mot de passe
  resetPasswordToken: { type: String, default: null },
  resetPasswordExpires: { type: Date, default: null }

}, { _id: true });

// Hash du mot de passe admin avant sauvegarde
AdminSchema.pre('save', async function (next) {
  if (this.isModified('mot_de_passe')) {
    this.mot_de_passe = await bcrypt.hash(this.mot_de_passe, 10);
  }
  next();
});

/**
 * Schéma principal Agence
 */
const AgenceSchema = new Schema({
  nom_commercial: { type: String, required: true },
  nom_responsable: { type: String, required: true },
  adresse: { type: String, required: true },

  alerte_secteur: { 
    type: String, 
    enum: ['Var', 'Hérault', 'Autre'], 
    required: true, 
    default: 'Autre' 
  },

  siret: { type: String, required: true },
  telephone_fixe: { type: String, required: false },

  activite: {
    type: String,
    enum: ['Notaire', 'Agence immobilière', 'Agent immobilier indépendant', 'Syndic', 'Huissier', 'Autre'],
    required: true
  },

  emails_contact: [
    { email: { type: String, required: true } }
  ],

  logo: { type: String, default: null },

  statut: {
    type: String,
    enum: ['actif', 'bloqué', 'en_attente', 'suspendu'],
    default: 'en_attente'
  },

  admin: { type: AdminSchema, required: true },

  clients: [{ type: Schema.Types.ObjectId, ref: 'Client' }],
  devis: [{ type: Schema.Types.ObjectId, ref: 'Devis' }],

  ca_estime: { type: Number, default: 0 },
  cagnotte: { type: Number, default: 0 },
    cagnotteEnAttente: { type: Number, default: 0 },
historiqueCagnotte: {
  type: [CagnotteHistoriqueSchema],
  default: []   // ✅ tableau vide par défaut
},    type_cagnotte: {
    type: String,
    enum: ['partagee', 'individuelle'],
    default: 'partagee',
    required: true
  },
  partage_devis: {
    type: Boolean,
    default: true,
    required: false
  },
  reduction: { type: Number, default: 0, min: 0, max: 100 },

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

  // 📄 Contrat de transfert
  contratTransfert: {
    signe: { type: Boolean, default: false },
    dateSignature: { type: Date, default: null },
    packMaintenance: {
      type: String,
      enum: ['serenite', 'evolution', 'aucun'],
      default: null
    }
  },

  // Diagnostiqueur
  diagnostiqueurParDefaut: {
    type: Schema.Types.ObjectId,
    ref: 'Diagnostiqueur',
    default: null
  },
  diagnostiqueursUtilises: [{
    diagnostiqueur: { type: Schema.Types.ObjectId, ref: 'Diagnostiqueur' },
    nombreCommandes: { type: Number, default: 0 },
    derniereCommande: { type: Date }
  }]

}, { timestamps: true });

/**
 * Virtuals et statistiques calculées
 */
AgenceSchema.virtual('nombreDevis').get(function () {
  return this.devis.length;
});

AgenceSchema.virtual('CA').get(function () {
  return this.devis.reduce((total, d) => total + (d.montant || 0), 0);
});

AgenceSchema.virtual('tauxAcceptation').get(function () {
  if (this.devis.length === 0) return 0;
  const accepts = this.devis.filter(d => d.statut === 'accepte').length;
  return (accepts / this.devis.length) * 100;
});


// 🔹 Méthode d'ajout mouvement cagnotte
AgenceSchema.methods.ajouterMouvementCagnotte = async function({ type, montant, description, par }) {
  try {
    if (!montant || isNaN(montant)) throw new Error("Montant invalide");

    // 🔹 Arrondi à l'entier le plus proche
    montant = Math.round(montant);

    this.historiqueCagnotte.push({
      type,
      montant,
      description,
      par,
      date: new Date()
    });

    // 🔹 Mise à jour du solde
    if (type === 'ajout' || type === 'validation') {
      this.cagnotte += montant;
    } else if (type === 'retrait' || type === 'en_attente') {
      this.cagnotte -= montant;
    }

    await this.save();
    return this;
  } catch (error) {
    console.error("Erreur ajouterMouvementCagnotte:", error);
    throw error;
  }
};

// 🔹 Méthode pour gérer les crédits IA
AgenceSchema.methods.ajouterCreditsIA = async function({
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

// 🔹 Méthode pour vérifier si l'agence a assez de crédits
AgenceSchema.methods.aAssezDeCredits = function(nombreRequis = 1) {
  return this.creditsIA >= nombreRequis;
};

// 📅 Méthode pour connecter Google Calendar
AgenceSchema.methods.connectGoogleCalendar = async function({
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
      tokenExpiry: new Date(tokenExpiry),
      email,
      connectedAt: new Date(),
      lastSync: new Date()
    };

    await this.save();
    console.log(`✅ Google Calendar connecté pour ${this.nom_commercial} (${email})`);
    return this;
  } catch (error) {
    console.error("Erreur connectGoogleCalendar:", error);
    throw error;
  }
};

// 📅 Méthode pour déconnecter Google Calendar
AgenceSchema.methods.disconnectGoogleCalendar = async function() {
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
    console.log(`✅ Google Calendar déconnecté pour ${this.nom_commercial}`);
    return this;
  } catch (error) {
    console.error("Erreur disconnectGoogleCalendar:", error);
    throw error;
  }
};

// 📅 Méthode pour vérifier si le token Google est expiré
AgenceSchema.methods.isGoogleTokenExpired = function() {
  if (!this.googleCalendar.tokenExpiry) return true;
  return new Date() >= new Date(this.googleCalendar.tokenExpiry);
};


module.exports = mongoose.model('Agence', AgenceSchema);
