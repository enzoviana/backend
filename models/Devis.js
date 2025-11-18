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
    parcelle: { type: String, default: null } // <-- Nouveau champ pour maisons

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
    ref: "Agence",
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

  chauffageGaz: {
  type: Boolean,
  default: false,
},

  copropriete: {          // ✅ Nouveau champ pour savoir si la copropriété est incluse
    type: Boolean,
    default: false,
  },
  tarifCopropriete: {     // ✅ Nouveau champ pour stocker le tarif copro
    type: Number,
    default: 0,
  },

    // ✅ Créateur du devis : soit employé, soit agence
  creePar: {
    id: { type: mongoose.Schema.Types.ObjectId, required: true },
    type: { type: String, enum: ["Employe", "Agence"], required: true }
  },



  /* 🔐 Consentements */
cgvAccepted: {
  type: Boolean,
  default: false,
},
rgpdAccepted: {
  type: Boolean,
  default: false,
},
dateAcceptation: {
  type: Date,
  default: null,
},

/* 📍 Lieu où le devis a été fait */
faitA: {
  type: String,
  default: "", // vide par défaut, à remplir lors de l'acceptation
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

  /* 📄 PDF généré et stocké sur Cloudinary */
  pdfUrl: {
    type: String,
    default: null, // sera rempli après upload sur Cloudinary
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
