const mongoose = require("mongoose");

const clientSchema = new mongoose.Schema(
  {
    nom: { type: String, required: true },
    prenom: { type: String, required: true },
    email: { type: String, required: true },
    telephone: { type: String, required: false },
    adresse: { type: String, required: true },
    ville: { type: String },
    codePostal: { type: String },
    pays: { type: String },
    societe: { type: String },
    siret: { type: String },
    remarques: { type: String },

    // 🔗 Relations
    devis: [{ type: mongoose.Schema.Types.ObjectId, ref: "Devis" }],
    ordresMission: [{ type: mongoose.Schema.Types.ObjectId, ref: "OrdreMission" }],

    agences: [{ type: mongoose.Schema.Types.ObjectId, ref: "Agency" }], // <- un client peut avoir plusieurs agences
  },
  { timestamps: true }
);


module.exports = mongoose.model("Client", clientSchema);
