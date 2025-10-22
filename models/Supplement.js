const mongoose = require("mongoose");

const supplementSchema = new mongoose.Schema({
  nom: { type: String, required: true, trim: true },
  typeBien: {
    type: String,
    enum: ["maison", "appartement", "audit"], // limitation aux types existants
    required: true,
  },
  tarifs: {
    var: { type: Number, required: true },
    herault: { type: Number, required: true },
    autre: { type: Number, default: 0 },
  },
}, { timestamps: true });

module.exports = mongoose.model("Supplement", supplementSchema);
