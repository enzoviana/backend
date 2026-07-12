const mongoose = require("mongoose");
const crypto = require("crypto");

const devisSchema = new mongoose.Schema({
  /* 🔢 Numéro du devis auto-généré */
  numero: {
    type: String,
    unique: true,
  },

  raisonRefus: String,

  /* 🔗 Référence au client dans la collection Client */
  clientId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Client",
    required: false, // Optionnel pour compatibilité avec anciens devis
  },

  /* 👤 Informations du client (embedded pour historique) */
  client: {
    nom: { type: String, required: true },
    prenom: { type: String, required: true },
    email: { type: String, required: true },
    tel: { type: String, required: false },
    adresse: { type: String },
    ville: { type: String },
    codePostal: { type: String },
    pays: { type: String },
    societe: { type: String },
    siret: { type: String },
    remarques: { type: String },
  },

  /* 🏠 Informations du locataire (optionnel) */
  locataire: {
    nom: { type: String },
    prenom: { type: String },
    tel: { type: String }
  },

  /* 📞 Contact principal */
  contactLocataire: {
    type: Boolean,
    default: false
  },

  /* 🔑 Clefs en agence */
  clefEnAgence: {
    type: Boolean,
    default: false
  },

  lignes: [
  {
    description: { type: String, required: true },
    quantite: { type: Number, required: true, default: 1 },
    tarifUnitaire: { type: Number, required: true },
    totalLigne: {
      type: Number,
      default: function () {
        return this.quantite * this.tarifUnitaire;
      }
    }
  }
],


/* 🏠 Informations sur le bien concerné */
bien: {
  type: String,
  required: true, // tu peux garder l'obligation ou l'enlever selon ton besoin
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

  typeSurfaceMaison: {
    type: String,
    required: false,
  },

  /* 🏘️ Surface selon le type de bien */
surfaceMaison: {
  type: String,
  set: val => {
    if (!val) return val;

    // ✅ FIX BUG SURFACE : Normaliser tous les formats possibles
    // Gérer : "250", "250m2", "250m²", "250 m²", "71-90m²", etc.

    // 1. Si c'est déjà au bon format, on garde
    if (val.match(/^\d+(\s*-\s*\d+)?\s*m²$/)) {
      return val.replace(/\s*-\s*/, " - "); // Juste normaliser les tirets
    }

    // 2. Enlever "m2" ou "m²" existants et espaces à la fin
    let cleaned = val.trim().replace(/\s*m2?²?\s*$/i, '');

    // 3. Normaliser les tirets pour les tranches
    cleaned = cleaned.replace(/\s*-\s*/, " - ");

    // 4. Ajouter " m²" à la fin
    return cleaned + " m²";
  },
},

  surfaceAppartement: {
    type: String,
    enum: ["T1", "T2", "T3", "T4", "T5", "T6 et +", "moins 20m²", "<20m2"],
  },

  anneeConstruction: {
    type: String,
  },

  /* 📦 Type de formule */
  type: {
    type: String,
    enum: ["pack_complet", "diagnostic", "audit", "manuel"],
    required: true,
  },

  /* 🧾 Numéro fiscal du bien (nouveau champ) */
  numeroFiscalBien: { type: String, default: null },

  /* 📝 Note libre sur le devis (nouveau champ) */
  note: { type: String, default: "" },

  /* 📋 Informations complémentaires (visibles sur le PDF) */
  informationsComplementaires: { type: String, default: "" },

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
    required: false,
  },
  diagnostiqueurAssigne: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Diagnostiqueur",
    default: null,
  },
  consentementFile: { type: Boolean, default: false },


  shareAgency : {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Agence",
    required: false,
  },

  // 🆕 Nom de l'agence de partage (pour les nouvelles agences qui n'existent pas encore)
  shareAgencyName: {
    type: String,
    required: false,
  },

  secteur: { type: String },

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
    enum: ["Brouillon", "Envoyé", "Accepté", "Refusé", "ouvert", "Email_Errone", "Envoi_En_Cours"],
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
  tarifGaz: {
  type: Number,
  default: 0,
},

emailNonDelivre: { type: Boolean, default: false },
emailClientErrone: { type: String, default: null },


  copropriete: {          // ✅ Nouveau champ pour savoir si la copropriété est incluse
    type: Boolean,
    default: false,
  },
  tarifCopropriete: {     // ✅ Nouveau champ pour stocker le tarif copro
    type: Number,
    default: 0,
  },

  fraisDeplacementAppliques: { // 🆕 Nouveau champ pour savoir si les frais de déplacement sont appliqués
    type: Boolean,
    default: false,
  },

    // ✅ Créateur du devis : soit employé, soit agence
creePar: {
    id: { type: mongoose.Schema.Types.ObjectId, required: true },
    type: { type: String, enum: ["Employe", "Agence", "Admin"], required: true }
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
  sparse: true, // 💡 INDISPENSABLE : autorise plusieurs valeurs null/absentes
  default: () => crypto.randomBytes(16).toString("hex"),
},
accesClientExpire: {
  type: Date,
  default: () => new Date(Date.now() + 60 * 24 * 60 * 60 * 1000), // 60 jours
},


  /* 📄 PDF généré et stocké sur Cloudinary */
  pdfUrl: {
    type: String,
    default: null, // sera rempli après upload sur Cloudinary
  },

  /* ✍️ Signature du client */
  signatureUrl: {
    type: String,
    default: null, // URL de l'image de signature sur Cloudinary
  },
  signatureVille: {
    type: String,
    default: null, // Ville de signature
  },
  signatureDate: {
    type: Date,
    default: null, // Date de signature
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
