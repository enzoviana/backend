/**
 * Script de migration: Créer un technicien par défaut pour tous les diagnostiqueurs
 * qui n'en ont pas encore.
 *
 * Usage: node scripts/initTechniciensDefaut.js
 */

require('dotenv').config();
const mongoose = require('mongoose');
const Diagnostiqueur = require('../models/Diagnostiqueur');
const TechnicienDiagnostiqueur = require('../models/TechnicienDiagnostiqueur');

async function initTechniciensDefaut() {
  try {
    console.log('🚀 Connexion à MongoDB...');
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connecté à MongoDB\n');

    // Récupérer tous les diagnostiqueurs
    const diagnostiqueurs = await Diagnostiqueur.find({});
    console.log(`📊 ${diagnostiqueurs.length} diagnostiqueur(s) trouvé(s)\n`);

    let nbCreated = 0;
    let nbSkipped = 0;
    let nbErrors = 0;

    for (const diagnostiqueur of diagnostiqueurs) {
      try {
        // Vérifier si le diagnostiqueur a déjà des techniciens
        const techniciensExistants = await TechnicienDiagnostiqueur.countDocuments({
          diagnostiqueur: diagnostiqueur._id
        });

        if (techniciensExistants > 0) {
          console.log(`⏭️  ${diagnostiqueur.nom_entreprise} a déjà ${techniciensExistants} technicien(s)`);
          nbSkipped++;
          continue;
        }

        // Créer un technicien par défaut avec les infos du diagnostiqueur
        const technicienData = {
          diagnostiqueur: diagnostiqueur._id,
          nom: diagnostiqueur.admin?.nom || 'Nom',
          prenom: diagnostiqueur.admin?.prenom || 'Prénom',
          email: diagnostiqueur.admin?.email || 'email@example.com',
          telephone: diagnostiqueur.admin?.telephone || '0000000000',
          actif: true
        };

        const technicien = await TechnicienDiagnostiqueur.create(technicienData);

        console.log(`✅ Technicien créé pour ${diagnostiqueur.nom_entreprise} (${technicien.prenom} ${technicien.nom})`);
        nbCreated++;

      } catch (error) {
        console.error(`❌ Erreur pour ${diagnostiqueur.nom_entreprise}:`, error.message);
        nbErrors++;
      }
    }

    console.log('\n📈 Résumé:');
    console.log(`   ✅ Créés: ${nbCreated}`);
    console.log(`   ⏭️  Ignorés: ${nbSkipped}`);
    console.log(`   ❌ Erreurs: ${nbErrors}`);
    console.log(`   📊 Total: ${diagnostiqueurs.length}`);

    await mongoose.disconnect();
    console.log('\n✅ Déconnecté de MongoDB');
    process.exit(0);

  } catch (error) {
    console.error('❌ Erreur lors de la migration:', error);
    process.exit(1);
  }
}

initTechniciensDefaut();
