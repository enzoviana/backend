const mongoose = require("mongoose");

const packSchema = new mongoose.Schema({
  nom: { type: String, required: true },
  typeBien: { type: String, enum: ["maison", "appartement", "audit"], required: true },
  typeOperation: { type: String, enum: ["vente", "location"], required: true },
  trancheAnnee: { type: String, required: true },
  diagnostics: [{ type: mongoose.Schema.Types.ObjectId, ref: "Diagnostic" }],

  // Nouveau champ
  tarifsParSurface: [
    {
      surfaceMin: { type: Number, required: true },
      surfaceMax: { type: Number, required: true },
      tarifs: {
        var: { type: Number, required: true },
        herault: { type: Number, required: true },
        autre: { type: Number, default: 0 }
      }
    }
  ],

  // Tu peux garder le champ global si besoin
  tarifs: {
    var: { type: Number },
    herault: { type: Number },
    autre: { type: Number, default: 0 },
  },

  obligatoireDansPacks: [{ type: mongoose.Schema.Types.ObjectId, ref: "Diagnostic" }],
  erpOffert: { type: Boolean, default: false },
  supplementsDisponibles: [{ type: String }]
}, { timestamps: true });

module.exports = mongoose.model("Pack", packSchema);
