const mongoose = require("mongoose");

const clientSchema = new mongoose.Schema(
  {
    nom: { type: String, required: true },
    prenom: { type: String, required: true },
    email: { type: String, required: true },
    telephone: { type: String, required: true },
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

// Optionnel : index composé pour éviter doublon d’email dans la même agence
clientSchema.index({ email: 1, agences: 1 }, { unique: true });

module.exports = mongoose.model("Client", clientSchema);
