const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const { Schema } = mongoose;

/**
 * Sous-schema Admin pour l'agence
 */
const AdminSchema = new Schema({
  nom: { type: String, required: true },
  prenom: { type: String, default: 'Admin' },
  email: { type: String, required: true, unique: true }, // Email pour connexion
  mot_de_passe: { type: String, required: true },
  telephone_portable: { type: String, required: true },
  role: { type: String, default: 'admin' },
  photo_profil: { type: String, default: null } // ✅ Nouvelle propriété optionnelle
}, { _id: true });

// Hash du mot de passe admin avant sauvegarde
AdminSchema.pre('save', async function (next) {
  if (this.isModified('mot_de_passe')) {
    this.mot_de_passe = await bcrypt.hash(this.mot_de_passe, 10);
  }
  next();
});

/**
 * Schéma principal Agence
 */
const AgenceSchema = new Schema({
  nom_commercial: { type: String, required: true },
  nom_responsable: { type: String, required: true },
  adresse: { type: String, required: true },

  alerte_secteur: { 
    type: String, 
    enum: ['Var', 'Hérault', 'Autre'], 
    required: true, 
    default: 'Autre' 
  },

  siret: { type: String, required: true },
  telephone_fixe: { type: String, required: false },

  activite: {
    type: String,
    enum: ['Notaire', 'Agence immobilière', 'Agent immobilier indépendant', 'Syndic', 'Huissier', 'Autre'],
    required: true
  },

  // ✅ Simplification des emails de contact
  emails_contact: [
    {
      email: { type: String, required: true }
    }
  ],

  // ✅ Logo entreprise (optionnel)
  logo: { type: String, default: null },

  // ✅ Statut de gestion
  statut: {
    type: String,
    enum: ['actif', 'bloqué', 'en_attente', 'suspendu'],
    default: 'en_attente'
  },

  admin: { type: AdminSchema, required: true },

  clients: [{ type: Schema.Types.ObjectId, ref: 'Client' }],
  devis: [{ type: Schema.Types.ObjectId, ref: 'Devis' }],

  // Données de suivi interne
  ca_estime: { type: Number, default: 0 },
  cagnotte: { type: Number, default: 0 },
  reduction: { type: Number, default: 0, min: 0, max: 100 }

}, { timestamps: true });

/**
 * Virtuals et statistiques calculées
 */
AgenceSchema.virtual('nombreDevis').get(function () {
  return this.devis.length;
});

AgenceSchema.virtual('CA').get(function () {
  return this.devis.reduce((total, d) => total + (d.montant || 0), 0);
});

AgenceSchema.virtual('tauxAcceptation').get(function () {
  if (this.devis.length === 0) return 0;
  const accepts = this.devis.filter(d => d.statut === 'accepte').length;
  return (accepts / this.devis.length) * 100;
});

module.exports = mongoose.model('Agence', AgenceSchema);
