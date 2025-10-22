const mongoose = require('mongoose');

const FactureSchema = new mongoose.Schema({
  devisId: { type: mongoose.Schema.Types.ObjectId, ref: 'Devis', required: true },
  agenceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Agency', required: true }, // ajout agenceId
  numero: { type: String, required: true, unique: true },
  clientId: { type: mongoose.Schema.Types.ObjectId, ref: 'Client', required: true },
  montantHT: { type: Number, required: true },
  montantTTC: { type: Number, required: true },
  dateCreation: { type: Date, default: Date.now },
  statut: { type: String, enum: ['Brouillon', 'Envoyée', 'Payée'], default: 'Brouillon' },
  datePaiement: { type: Date }
});

module.exports = mongoose.model('Facture', FactureSchema);
