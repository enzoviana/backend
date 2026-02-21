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
    fonction: String,
    accepteConditions: { type: Boolean, default: false }
  },
  ipSignature: String,
  versionContrat: { type: String, default: '1.0' }

}, { timestamps: true });

// Méthode de validation
ContratTransfertSchema.methods.valider = async function(signatureData, ip) {
  this.isValide = true;
  this.dateSignature = new Date();
  this.signature = { ...signatureData, accepteConditions: true };
  this.ipSignature = ip;
  
  return await this.save();
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