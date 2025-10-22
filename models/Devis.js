const mongoose = require("mongoose");
const crypto = require("crypto");

const devisSchema = new mongoose.Schema({
  /* 🔢 Numéro du devis auto-généré */
  numero: {
    type: String,
    unique: true,
  },

  /* 👤 Informations du client */
  client: {
    nom: { type: String, required: true },
    prenom: { type: String, required: true },
    email: { type: String, required: true },
    tel: { type: String, required: true },
    adresse: { type: String },
    ville: { type: String },
    codePostal: { type: String },
    pays: { type: String },
    societe: { type: String },
    siret: { type: String },
    remarques: { type: String },
  },

  /* 🏠 Informations sur le bien concerné */
  bien: {
    type: String,
    enum: ["maison", "appartement", "local commercial", "terrain"],
    required: true,
  },
  transaction: {
    type: String,
    enum: ["vente", "location", "autre"],
    required: true,
  },
  adresseBien: {
    adresse: { type: String },
    codePostal: { type: String },
    ville: { type: String },
    etage: { type: String },
    complement: { type: String },
  },

  /* 🏘️ Surface selon le type de bien */
surfaceMaison: {
  type: String,
  set: val => {
    if (!val) return val;
    return val.replace(/\s*-\s*/, " - ").replace(/m²$/, " m²");
  },
},
  surfaceAppartement: {
    type: String,
    enum: ["T1", "T2", "T3", "T4", "T5", "T6 et +"],
  },

  anneeConstruction: {
    type: String,
  },

  /* 📦 Type de formule */
  type: {
    type: String,
    enum: ["pack_complet", "diagnostic", "audit"],
    required: true,
  },

  /* 🧾 Numéro fiscal du bien (nouveau champ) */
  numeroFiscalBien: { type: String, default: null },

  /* 📝 Note libre sur le devis (nouveau champ) */
  note: { type: String, default: "" },

  /* 🔧 Références */
  pack: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Pack",
  },
  diagnosticsSelectionnes: [
    {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Diagnostic",
    },
  ],
  supplementsSelectionnes: [
  {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Supplement",
  },
],
  agenceId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Agency",
    required: true,
  },

  /* 💰 Financier : totaux et réduction */
  totalAvantRemise: { type: Number },
  reductionPourcent: { type: Number },
  montantCagnotteUtilisee: { type: Number },
  totalApresReduction: { type: Number },
  totalFinal: { type: Number },

  payer: { type: String, enum: ["client", "agence"], default: "client" },

  /* 💾 Compatibilité (ancien champ) */
  montantTTC: { type: Number },

  /* 📄 Autres champs */
  numeroAdeme: { type: String },
  statut: {
    type: String,
    enum: ["Brouillon", "Envoyé", "Accepté", "Refusé"],
    default: "Envoyé",
  },
  derniereRelance: { type: Date },
  dateCreation: {
    type: Date,
    default: Date.now,
  },

  /* 🔐 Accès client */
  accesClientKey: {
    type: String,
    unique: true,
    default: () => crypto.randomBytes(16).toString("hex"),
  },
  accesClientExpire: {
    type: Date,
    default: () => new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 jours
  },
});

/* 🧮 Génération automatique du numéro de devis */
devisSchema.pre("save", async function (next) {
  if (!this.numero) {
    const count = await mongoose.model("Devis").countDocuments();
    this.numero = "DV-" + String(count + 1).padStart(4, "0");
  }
  next();
});

module.exports = mongoose.model("Devis", devisSchema);
