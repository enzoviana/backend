const mongoose = require('mongoose');
const OrdreMissionSchema = new mongoose.Schema({
  devisId: { type: mongoose.Schema.Types.ObjectId, ref: 'Devis', required: true },
  agenceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Agence', required: true },
  numero: { type: String, required: true, unique: true },
  clientId: { type: mongoose.Schema.Types.ObjectId, ref: 'Client', required: true },
  description: { type: String },
  dateCreation: { type: Date, default: Date.now },

  statut: { 
    type: String, 
    enum: ['Commande', 'En Cours', 'Traité', 'Payée'], 
    default: 'Commande' 
  },

 // ✅ Créateur : peut être un employé OU l’agence elle-même
  creePar: {
    id: { type: mongoose.Schema.Types.ObjectId, required: true },
    type: { type: String, enum: ['Employe', 'Agence'], required: true } // Discriminateur
  },

  // ✅ Employés collaborateurs (même agence)
  partageAvec: [
    { type: mongoose.Schema.Types.ObjectId, ref: 'Employe' }
  ],

  // ✅ Date et heure du RDV
  rdvDate: { type: Date, default: null },

  fichiersClient: [
    {
      nom: String,
      url: String,
      public_id: String,   
      dateDepot: { type: Date, default: Date.now },
    }
  ]
});
module.exports = mongoose.model('OrdreMission', OrdreMissionSchema);
