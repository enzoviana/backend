const mongoose = require("mongoose");

// Schéma pour les tarifs selon la surface (maisons)
const tarifSurfaceSchema = new mongoose.Schema({
  surfaceMin: { type: Number, required: true },
  surfaceMax: { type: Number, required: true },
  tarifs: {
    var: { type: Number, required: true },
    herault: { type: Number, required: true },
    autre: { type: Number, default: 0 },
  },
});

// Schéma pour les tarifs selon le type d'appartement
const tarifAppartementSchema = new mongoose.Schema({
  typeAppartement: { 
    type: String, 
    enum: ["<20m2", "T1", "T2", "T3", "T4", "T5"], 
    required: true 
  },
  tarifs: {
    var: { type: Number, required: true },
    herault: { type: Number, required: true },
    autre: { type: Number, default: 0 },
  },
});

// Schéma principal Pack
const packSchema = new mongoose.Schema({
  nom: { type: String, required: true, trim: true },

  // Type de bien et type d'opération
  typeBien: { type: String, enum: ["maison", "appartement", "audit"], required: true },
  typeOperation: { type: String, enum: ["vente", "location"], required: true },

  // Tranche d'année
  trancheAnnee: [{
    type: String,
    enum: ["avant_1949", "1949_1997", "1juillet1997_plus15", "moins_15", "toutes"],
    required: true,
  }],

  // Diagnostics associés
  diagnostics: [{ type: mongoose.Schema.Types.ObjectId, ref: "Diagnostic" }],

  // Tarifs selon le type de bien
  tarifsParSurface: { type: [tarifSurfaceSchema], default: undefined },       // pour maisons
  tarifsParAppartement: { type: [tarifAppartementSchema], default: undefined }, // pour appartements

  // Champ global tarifs si besoin
  tarifs: {
    var: { type: Number, default: 0 },
    herault: { type: Number, default: 0 },
    autre: { type: Number, default: 0 },
  },

  // Diagnostics obligatoires dans des packs
  obligatoireDansPacks: [{ type: mongoose.Schema.Types.ObjectId, ref: "Diagnostic" }],

  // ERP offert ou non
  erpOffert: { type: Boolean, default: false },

  // Référence aux suppléments disponibles
  supplementsDisponibles: [{ type: String }]
}, { timestamps: true });

module.exports = mongoose.model("Pack", packSchema);
