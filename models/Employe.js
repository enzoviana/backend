const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const { Schema } = mongoose;

/**
 * 💰 Historique des transactions de cagnotte
 */
const TransactionCagnotteSchema = new Schema({
  montant: { type: Number, required: true }, // + ou -
  type: { 
    type: String, 
  enum: ['gain', 'retrait', 'ajustement', 'en_attente'], 
    required: true 
  },
  description: { type: String, default: '' },
  reference: { type: Schema.Types.ObjectId, default: null }, // ex: devis, mission...
  date: { type: Date, default: Date.now }
}, { _id: false });


const EmployeSchema = new Schema({
  agence: { type: Schema.Types.ObjectId, ref: 'Agence', required: true },

  nom: { type: String, required: true },
  prenom: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  mot_de_passe: { type: String, required: true },
  telephone_portable: { type: String, required: false },

  // ✅ Rôle fixé (pas modifiable)
  role: { type: String, default: 'employe', immutable: true },

  photo_profil: { type: String, default: null },

  // 💰 Cagnotte individuelle
  cagnotte: { type: Number, default: 0 },

      cagnotteEnAttente: { type: Number, default: 0 },


  // 🧾 Historique de cagnotte
  transactions_cagnotte: [TransactionCagnotteSchema],

  // ✅ Statut de l'employé
  statut: {
    type: String,
    enum: ['actif', 'en_conge', 'bloque', 'suspendu', 'en_attente'],
    default: 'actif'
  },

  // 🔹 Reset password
  resetPasswordToken: { type: String, default: null },
  resetPasswordExpires: { type: Date, default: null }

}, { timestamps: true });


// 🔐 Hash du mot de passe
EmployeSchema.pre('save', async function (next) {
  if (this.isModified('mot_de_passe')) {
    this.mot_de_passe = await bcrypt.hash(this.mot_de_passe, 10);
  }
  next();
});

EmployeSchema.methods.ajouterCagnotte = async function({ montant, type, description, reference }) {
  try {
    if (!montant || isNaN(montant)) throw new Error("Montant invalide");

    // 🔹 Arrondi à l'entier le plus proche
    montant = Math.round(montant);

    // Ajouter la transaction à l'historique
    this.transactions_cagnotte.push({
      montant,
      type,
      description,
      reference,
      date: new Date()
    });

    // Mise à jour de la cagnotte
    if (type === 'gain' || type === 'ajustement') {
      this.cagnotte += montant;
    } else if (type === 'retrait') {
      this.cagnotte -= montant;
    }

    await this.save();
    return this;
  } catch (error) {
    console.error("Erreur ajouterCagnotte:", error);
    throw error;
  }
};


// ✅ Méthode pour comparer le mot de passe au login
EmployeSchema.methods.comparePassword = function (password) {
  return bcrypt.compare(password, this.mot_de_passe);
};

module.exports = mongoose.model('Employe', EmployeSchema);
