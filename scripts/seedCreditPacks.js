/**
 * Script pour initialiser les packs de crédits IA dans la base de données
 *
 * Exécuter avec: node backend/scripts/seedCreditPacks.js
 */

require('dotenv').config();
const mongoose = require('mongoose');
const CreditPack = require('../models/CreditPack');

const PACKS = [
  {
    nom: "Pack Starter",
    description: "Parfait pour commencer avec l'IA",
    nombreCredits: 10,
    prixEuros: 9.99,
    prixCentimes: 999,
    economie: 0,
    badge: null,
    badgeColor: "blue",
    ordre: 1,
    actif: true,
    fonctionnalites: [
      "10 générations de devis par IA",
      "Valable sans limite de temps",
      "Support client inclus"
    ]
  },
  {
    nom: "Pack Pro",
    description: "Le plus populaire pour les professionnels",
    nombreCredits: 50,
    prixEuros: 39.99,
    prixCentimes: 3999,
    economie: 20,
    badge: "POPULAIRE",
    badgeColor: "purple",
    ordre: 2,
    actif: true,
    fonctionnalites: [
      "50 générations de devis par IA",
      "Économisez 20% par crédit",
      "Support prioritaire",
      "Valable sans limite de temps"
    ]
  },
  {
    nom: "Pack Business",
    description: "Pour les agences et les gros volumes",
    nombreCredits: 150,
    prixEuros: 99.99,
    prixCentimes: 9999,
    economie: 33,
    badge: "MEILLEURE OFFRE",
    badgeColor: "green",
    ordre: 3,
    actif: true,
    fonctionnalites: [
      "150 générations de devis par IA",
      "Économisez 33% par crédit",
      "Support VIP 24/7",
      "Accès anticipé aux nouvelles fonctionnalités",
      "Valable sans limite de temps"
    ]
  },
  {
    nom: "Pack Enterprise",
    description: "Solution illimitée pour les grandes structures",
    nombreCredits: 500,
    prixEuros: 249.99,
    prixCentimes: 24999,
    economie: 50,
    badge: "BEST VALUE",
    badgeColor: "orange",
    ordre: 4,
    actif: true,
    fonctionnalites: [
      "500 générations de devis par IA",
      "Économisez 50% par crédit",
      "Support dédié personnalisé",
      "Formation à l'utilisation de l'IA",
      "Accès anticipé aux nouvelles fonctionnalités",
      "Valable sans limite de temps"
    ]
  }
];

async function seedCreditPacks() {
  try {
    console.log('🔌 Connexion à MongoDB...');
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connecté à MongoDB');

    console.log('🗑️  Suppression des anciens packs...');
    await CreditPack.deleteMany({});

    console.log('📦 Création des nouveaux packs...');
    const createdPacks = await CreditPack.insertMany(PACKS);

    console.log(`✅ ${createdPacks.length} packs créés avec succès:`);
    createdPacks.forEach(pack => {
      console.log(`   - ${pack.nom}: ${pack.nombreCredits} crédits pour ${pack.prixEuros}€`);
    });

    console.log('\n🎉 Initialisation terminée !');
    process.exit(0);

  } catch (error) {
    console.error('❌ Erreur lors de l\'initialisation:', error);
    process.exit(1);
  }
}

// Exécuter le script
seedCreditPacks();
