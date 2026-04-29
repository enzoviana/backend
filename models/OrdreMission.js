const mongoose = require('mongoose');
const OrdreMissionSchema = new mongoose.Schema({
  devisId: { type: mongoose.Schema.Types.ObjectId, ref: 'Devis', required: true },
  agenceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Agence', required: false },
  numero: { type: String, required: true, unique: true },
  clientId: { type: mongoose.Schema.Types.ObjectId, ref: 'Client', required: true },
  description: { type: String },
  dateCreation: { type: Date, default: Date.now },

statut: {
  type: String,
  enum: ['Commande', 'En Attente', 'En Cours', 'Traité', 'Payée', 'Payé', 'Annulé'],
  default: 'Commande'
},

 // ✅ Créateur : peut être un employé OU l’agence elle-même
creePar: {
    id: { type: mongoose.Schema.Types.ObjectId, required: true },
    type: { type: String, enum: ["Employe", "Agence", "Admin"], required: true }
},

  // ✅ Employés collaborateurs (même agence)
  partageAvec: [
    { type: mongoose.Schema.Types.ObjectId, ref: 'Employe' }
  ],
  consentementPdf: {
  nom: String,      // Nom du fichier, ex: Consentement.pdf
  url: String,      // Chemin ou URL du fichier stocké
  public_id: String, 
  dateDepot: { type: Date, default: Date.now }
},

  // ✅ Date et heure du RDV
  rdvDate: { type: Date, default: null },

  fichiersClient: [
    {
      nom: String,
      url: String,
      public_id: String,
      dateDepot: { type: Date, default: Date.now },
    }
  ],

  // Diagnostiqueur assigné
  diagnostiqueur: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Diagnostiqueur',
    default: null
  },

  // Statut d'acceptation de la mission par le diagnostiqueur
  statutAcceptation: {
    type: String,
    enum: ['en_attente', 'accepte', 'refuse', 'termine'],
    default: 'en_attente'
  },

  dateAcceptation: { type: Date, default: null },
  dateRefus: { type: Date, default: null },
  raisonRefus: { type: String, default: null },

  // Notation par le client
  noteClient: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'NotationDiagnostiqueur',
    default: null
  }
});
module.exports = mongoose.model('OrdreMission', OrdreMissionSchema);
