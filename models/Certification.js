const mongoose = require('mongoose');
const { Schema } = mongoose;

/**
 * Sous-schéma Document de certification
 */
const DocumentCertificationSchema = new Schema({
  nom: { type: String, required: true },
  url: { type: String, required: true },
  public_id: { type: String, required: true },
  dateDepot: { type: Date, default: Date.now }
}, { _id: false });

/**
 * Certifications des techniciens
 */
const CertificationSchema = new Schema({
  // Liens
  technicien: {
    type: Schema.Types.ObjectId,
    ref: 'TechnicienDiagnostiqueur',
    required: true
  },
  diagnostiqueur: {
    type: Schema.Types.ObjectId,
    ref: 'Diagnostiqueur',
    required: true
  },
  domaine: {
    type: Schema.Types.ObjectId,
    ref: 'DomaineActivite',
    required: true
  },

  // Détails certification
  numeroCertification: { type: String, required: true },
  organisme: { type: String, required: true },
  dateObtention: { type: Date, required: true },
  dateExpiration: { type: Date, required: true },

  // Mention spéciale (ex: DPE locaux commerciaux)
  mentionSpeciale: { type: String, default: null },

  // Document
  document: DocumentCertificationSchema,

  // Statut calculé automatiquement
  statut: {
    type: String,
    enum: ['valide', 'expire', 'a_renouveler', 'en_attente', 'rejete'],
    default: 'valide'
  },

  // Notes
  notes: { type: String, default: '' },

  // Système d'approbation manuelle
  approbation: {
    statutApprobation: {
      type: String,
      enum: ['en_attente', 'approuve', 'rejete'],
      default: 'en_attente'
    },
    approuvePar: {
      type: Schema.Types.ObjectId,
      ref: 'Admin',
      default: null
    },
    dateApprobation: {
      type: Date,
      default: null
    },
    raisonRejet: {
      type: String,
      default: null
    },
    commentaireAdmin: {
      type: String,
      default: null
    }
  }

}, { timestamps: true });

// Index pour recherche rapide
CertificationSchema.index({ diagnostiqueur: 1, domaine: 1, statut: 1 });
CertificationSchema.index({ technicien: 1, statut: 1 });
CertificationSchema.index({ dateExpiration: 1 });
CertificationSchema.index({ 'approbation.statutApprobation': 1 });

/**
 * Méthode pour calculer le statut en fonction de la date d'expiration et de l'approbation
 */
CertificationSchema.methods.calculerStatut = function() {
  // Si pas encore approuvée, le statut dépend de l'approbation
  if (this.approbation.statutApprobation === 'en_attente') {
    this.statut = 'en_attente';
    return this.statut;
  }

  if (this.approbation.statutApprobation === 'rejete') {
    this.statut = 'rejete';
    return this.statut;
  }

  // Si approuvée, calculer le statut basé sur la date d'expiration
  if (this.approbation.statutApprobation === 'approuve') {
    const maintenant = new Date();
    const joursRestants = Math.ceil((this.dateExpiration - maintenant) / (1000 * 60 * 60 * 24));

    if (joursRestants < 0) {
      this.statut = 'expire';
    } else if (joursRestants <= 30) {
      this.statut = 'a_renouveler';
    } else {
      this.statut = 'valide';
    }
  }

  return this.statut;
};

/**
 * Hook pre-save pour calculer automatiquement le statut
 */
CertificationSchema.pre('save', function(next) {
  this.calculerStatut();
  next();
});

module.exports = mongoose.model('Certification', CertificationSchema);
