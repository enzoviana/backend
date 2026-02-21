// models/ContratTransfert.js
const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const ContratTransfertSchema = new Schema({
  adminId: {
    type: Schema.Types.ObjectId,
    ref: 'Admin',
    required: true,
    unique: true // Un seul contrat par compte SuperAdmin
  },

  // État du contrat
  isValide: { type: Boolean, default: false },
  dateSignature: { type: Date, default: null },

  // Maintenance & Offre
  packMaintenance: {
    type: String,
    enum: ['serenite', 'evolution', 'aucun'],
    required: true
  },
  tarifPreferentiel: { type: Boolean, default: true },
  
  detailsPack: {
    nom: String,
    prixMensuel: Number,
    fonctionnalites: [String]
  },

  // Données de signature (Valeur légale)
  signature: {
    nom: String,
    prenom: String,
    accepteConditions: { type: Boolean, default: false },
    signatureCanvas: String, // Image base64 de la signature manuscrite
    dateSignature: Date
  },

  // 📧 Vérification par email
  codeVerification: { type: String, select: false },
  dateCodeEnvoye: Date,
  codeVerifie: { type: Boolean, default: false },
  dateCodeVerifie: Date,

  // 💳 Informations Stripe pour l'abonnement
  stripeSubscriptionId: { type: String, default: null },
  stripeCustomerId: { type: String, default: null },
  statutPaiement: {
    type: String,
    enum: ['en_attente', 'actif', 'suspendu', 'annule'],
    default: 'en_attente'
  },
  dateDebutAbonnement: { type: Date, default: null },
  dateFinEngagement: { type: Date, default: null }, // Engagement 1 an
  dateProchaineFacture: { type: Date, default: null },

  // 🔒 Informations légales obligatoires (France - Article 1316-1 du Code civil)
  informationsLegales: {
    ipSignature: String,
    userAgent: String,
    navigateur: String,
    systemeExploitation: String,
    horodatageComplet: Date,
    emailContact: String,
    telephoneContact: String,
    adresseComplete: String
  },

  versionContrat: { type: String, default: '1.0' }

}, { timestamps: true });

// Méthode de validation
ContratTransfertSchema.methods.valider = async function(signatureData, informationsLegales) {
  this.isValide = true;
  this.dateSignature = new Date();
  this.signature = {
    ...signatureData,
    accepteConditions: true,
    dateSignature: new Date()
  };
  this.codeVerifie = true;
  this.dateCodeVerifie = new Date();
  this.informationsLegales = informationsLegales;

  return await this.save();
};

// Méthode pour générer un code de vérification
ContratTransfertSchema.methods.genererCodeVerification = function() {
  // Générer un code à 6 chiffres
  const code = Math.floor(100000 + Math.random() * 900000).toString();
  this.codeVerification = code;
  this.dateCodeEnvoye = new Date();
  this.codeVerifie = false;
  return code;
};

// Méthode pour vérifier le code
ContratTransfertSchema.methods.verifierCode = function(code) {
  // Vérifier que le code n'a pas expiré (10 minutes)
  const maintenant = new Date();
  const expiration = new Date(this.dateCodeEnvoye);
  expiration.setMinutes(expiration.getMinutes() + 10);

  if (maintenant > expiration) {
    return { valide: false, message: 'Code expiré. Veuillez en demander un nouveau.' };
  }

  if (this.codeVerification !== code) {
    return { valide: false, message: 'Code de vérification incorrect.' };
  }

  return { valide: true };
};

// Récupération automatique
ContratTransfertSchema.statics.getOrCreateForAdmin = async function(adminId) {
  let contrat = await this.findOne({ adminId });
  if (!contrat) {
    contrat = new this({
      adminId,
      packMaintenance: 'serenite', // Par défaut sur le pack recommandé
      tarifPreferentiel: true
    });
    await contrat.save();
  }
  return contrat;
};

module.exports = mongoose.model('ContratTransfert', ContratTransfertSchema);