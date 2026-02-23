const mongoose = require('mongoose');

const PlanAbonnementSchema = new mongoose.Schema({
  nom: {
    type: String,
    required: true,
    unique: true,
    enum: ['STANDARD', 'PRO', 'ENTERPRISE']
  },

  // Tarification
  tarification: {
    prixMensuel: { type: Number, required: true, default: 0 },
    prixAnnuel: { type: Number, default: 0 },
    devise: { type: String, default: 'EUR' },
    stripePriceId: { type: String, default: null }, // ID du prix dans Stripe
    stripePriceIdAnnuel: { type: String, default: null }
  },

  // Engagement
  engagement: {
    dureeMinimumMois: { type: Number, default: 0 }, // 0 = sans engagement
    fraisResiliation: { type: Number, default: 0 },
    periodeEssaiJours: { type: Number, default: 0 }
  },

  // Fonctionnalités incluses
  fonctionnalites: {
    googleCalendarSync: { type: Boolean, default: false },
    exportsAvances: { type: Boolean, default: false },
    apiAccess: { type: Boolean, default: false },
    supportPrioritaire: { type: Boolean, default: false },
    formationPersonnalisee: { type: Boolean, default: false },
    gestionEquipe: { type: Boolean, default: false },
    statistiquesAvancees: { type: Boolean, default: false },
    personnalisationInterface: { type: Boolean, default: false }
  },

  // Limites d'utilisation
  limites: {
    maxMissionsParMois: { type: Number, default: null }, // null = illimité
    maxTechniciens: { type: Number, default: null },
    maxStockageGo: { type: Number, default: null },
    maxClientsActifs: { type: Number, default: null },
    maxDevisParMois: { type: Number, default: null }
  },

  // Apparence et mise en avant
  affichage: {
    couleur: { type: String, default: '#64748b' }, // Couleur du badge
    badge: { type: String, default: null }, // Ex: "Populaire", "Meilleure valeur"
    ordre: { type: Number, default: 0 }, // Ordre d'affichage
    recommande: { type: Boolean, default: false }
  },

  // Description et avantages
  description: {
    courte: { type: String, default: '' },
    longue: { type: String, default: '' },
    avantages: [{ type: String }] // Liste des avantages à afficher
  },

  // Statut
  actif: { type: Boolean, default: true },
  visible: { type: Boolean, default: true } // Visible pour les nouveaux clients

}, {
  timestamps: true
});

// Index pour optimiser les requêtes
PlanAbonnementSchema.index({ nom: 1 });
PlanAbonnementSchema.index({ actif: 1 });
PlanAbonnementSchema.index({ 'affichage.ordre': 1 });

module.exports = mongoose.model('PlanAbonnement', PlanAbonnementSchema);
