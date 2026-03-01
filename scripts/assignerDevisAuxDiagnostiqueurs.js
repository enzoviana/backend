/**
 * Script de migration : Assigner les devis existants aux diagnostiqueurs
 *
 * Ce script assigne automatiquement les devis sans diagnostiqueurAssigne
 * au diagnostiqueur par défaut de l'agence
 *
 * Usage: node scripts/assignerDevisAuxDiagnostiqueurs.js
 */

require('dotenv').config();
const mongoose = require('mongoose');
const Devis = require('../models/Devis');
const Agence = require('../models/Agency');

async function assignerDevisAuxDiagnostiqueurs() {
  try {
    console.log('🔌 Connexion à MongoDB...');
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connecté à MongoDB\n');

    // 1. Trouver tous les devis sans diagnostiqueurAssigne
    const devisSansDiag = await Devis.find({
      $or: [
        { diagnostiqueurAssigne: null },
        { diagnostiqueurAssigne: { $exists: false } }
      ]
    })
      .populate('agenceId')
      .limit(100);

    console.log(`📊 Nombre de devis sans diagnostiqueur: ${devisSansDiag.length}\n`);

    if (devisSansDiag.length === 0) {
      console.log('✅ Tous les devis ont déjà un diagnostiqueur assigné');
      return;
    }

    let updated = 0;
    let skipped = 0;

    // 2. Pour chaque devis, assigner le diagnostiqueur par défaut de l'agence
    for (const devis of devisSansDiag) {
      console.log(`\n📋 Traitement du devis ${devis.numero}...`);

      if (!devis.agenceId) {
        console.log(`   ⚠️  Pas d'agence associée - Ignoré`);
        skipped++;
        continue;
      }

      const agence = await Agence.findById(devis.agenceId);

      if (!agence) {
        console.log(`   ❌ Agence introuvable - Ignoré`);
        skipped++;
        continue;
      }

      const diagnostiqueurId = agence.diagnostiqueurParDefaut;

      if (!diagnostiqueurId) {
        console.log(`   ⚠️  Agence ${agence.nom_entreprise} n'a pas de diagnostiqueur par défaut - Ignoré`);
        skipped++;
        continue;
      }

      // Assigner le diagnostiqueur
      devis.diagnostiqueurAssigne = diagnostiqueurId;
      await devis.save();

      console.log(`   ✅ Assigné à diagnostiqueur ${diagnostiqueurId}`);
      console.log(`   📍 Agence: ${agence.nom_entreprise}`);
      updated++;
    }

    console.log('\n' + '='.repeat(60));
    console.log('📊 RÉSUMÉ');
    console.log('='.repeat(60));
    console.log(`✅ Devis mis à jour: ${updated}`);
    console.log(`⚠️  Devis ignorés: ${skipped}`);
    console.log(`📋 Total traité: ${devisSansDiag.length}`);
    console.log('='.repeat(60));

  } catch (error) {
    console.error('❌ Erreur:', error);
  } finally {
    await mongoose.disconnect();
    console.log('\n🔌 Déconnecté de MongoDB');
  }
}

assignerDevisAuxDiagnostiqueurs();
