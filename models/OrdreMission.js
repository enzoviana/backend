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

  // 📎 Fichiers déposés par le client via la clé du devis
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
