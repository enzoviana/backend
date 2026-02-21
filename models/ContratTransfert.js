const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const ContratTransfertSchema = new Schema({
  agence: {
    type: Schema.Types.ObjectId,
    ref: 'Agency',
    required: true,
    unique: true
  },

  // Informations de signature
  dateSignature: {
    type: Date,
    default: null
  },

  isValide: {
    type: Boolean,
    default: false
  },

  // Choix du pack de maintenance
  packMaintenance: {
    type: String,
    enum: ['serenite', 'evolution', 'aucun'],
    required: true
  },

  // Tarif préférentiel si signé directement
  tarifPreferentiel: {
    type: Boolean,
    default: true
  },

  // Détails des packs
  detailsPack: {
    nom: String,
    prixMensuel: Number,
    fonctionnalites: [String]
  },

  // Signature électronique
  signature: {
    nom: String,
    prenom: String,
    fonction: String,
    accepteConditions: {
      type: Boolean,
      default: false
    }
  },

  // Conditions générales
  conditionsAcceptees: {
    type: Boolean,
    default: false
  },

  // IP de signature
  ipSignature: String,

  // Version du contrat
  versionContrat: {
    type: String,
    default: '1.0'
  }

}, { timestamps: true });

// Méthode pour valider le contrat
ContratTransfertSchema.methods.valider = async function(signatureData, ip) {
  this.isValide = true;
  this.dateSignature = new Date();
  this.signature = signatureData;
  this.ipSignature = ip;
  this.conditionsAcceptees = true;

  await this.save();

  // Mettre à jour l'agence
  const Agency = mongoose.model('Agency');
  await Agency.findByIdAndUpdate(this.agence, {
    'contratTransfert.signe': true,
    'contratTransfert.dateSingature': this.dateSignature,
    'contratTransfert.packMaintenance': this.packMaintenance
  });

  return this;
};

// Méthode statique pour récupérer ou créer un contrat pour une agence
ContratTransfertSchema.statics.getOrCreateForAgency = async function(agenceId) {
  let contrat = await this.findOne({ agence: agenceId });

  if (!contrat) {
    contrat = new this({
      agence: agenceId,
      packMaintenance: 'aucun',
      tarifPreferentiel: true,
      isValide: false
    });
    await contrat.save();
  }

  return contrat;
};

module.exports = mongoose.model('ContratTransfert', ContratTransfertSchema);
