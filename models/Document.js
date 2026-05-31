const mongoose = require('mongoose');

/**
 * Modèle Document - Pour stocker tous les fichiers/documents dans MongoDB
 * Ce modèle remplace le stockage Cloudinary
 */
const DocumentSchema = new mongoose.Schema({
  // Informations de base
  nom: {
    type: String,
    required: true,
    index: true
  },

  // Type de document
  type: {
    type: String,
    enum: [
      // Documents diagnostiqueur
      'kbis',
      'assurance_rc',
      'assurance_decennale',
      'photo_profil',
      'logo_entreprise',
      'autre',
      // Documents devis/missions
      'devis_pdf',
      'signature_client',
      'consentement_pdf',
      'fichier_client'
    ],
    required: true,
    index: true
  },

  // Données binaires du fichier (stockées directement en BDD)
  data: {
    type: Buffer,
    required: true
  },

  // Métadonnées du fichier
  contentType: {
    type: String,
    required: true
  }, // ex: image/png, application/pdf

  taille: {
    type: Number,
    required: true
  }, // en bytes

  extension: {
    type: String,
    required: true
  }, // ex: pdf, png, jpg

  // Référence à l'ancien public_id Cloudinary (pour traçabilité)
  cloudinaryPublicId: {
    type: String,
    default: null,
    index: true
  },

  cloudinaryUrl: {
    type: String,
    default: null
  },

  // Relations - quel modèle utilise ce document
  relatedTo: {
    model: {
      type: String,
      enum: ['Diagnostiqueur', 'Devis', 'OrdreMission'],
      required: true,
      index: true
    },
    id: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      index: true
    },
    field: {
      type: String,
      required: true
    } // ex: 'documents', 'logo', 'pdfUrl', etc.
  },

  // Métadonnées supplémentaires
  metadata: {
    dateExpiration: { type: Date, default: null },
    dateValidation: { type: Date, default: null },
    statut: {
      type: String,
      enum: ['valide', 'expire', 'a_renouveler', 'en_attente', 'rejete'],
      default: 'valide'
    },
    raisonRefus: { type: String, default: null }
  },

  // Dates
  dateDepot: {
    type: Date,
    default: Date.now,
    index: true
  },

  dateMigration: {
    type: Date,
    default: Date.now
  }

}, { timestamps: true });

// Index composés pour optimiser les recherches
DocumentSchema.index({ 'relatedTo.model': 1, 'relatedTo.id': 1 });
DocumentSchema.index({ type: 1, dateDepot: -1 });

/**
 * Méthode pour obtenir l'URL en base64 (pour affichage direct)
 */
DocumentSchema.methods.getBase64Url = function() {
  return `data:${this.contentType};base64,${this.data.toString('base64')}`;
};

/**
 * Méthode pour obtenir la taille formatée
 */
DocumentSchema.methods.getTailleFormatee = function() {
  const bytes = this.taille;
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
};

module.exports = mongoose.model('Document', DocumentSchema);
