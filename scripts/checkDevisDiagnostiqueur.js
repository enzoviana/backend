/**
 * Script de vérification des devis assignés aux diagnostiqueurs
 *
 * Usage: node scripts/checkDevisDiagnostiqueur.js
 */

require('dotenv').config();
const mongoose = require('mongoose');
const Devis = require('../models/Devis');
const Diagnostiqueur = require('../models/Diagnostiqueur');

async function checkDevisDiagnostiqueur() {
  try {
    console.log('🔌 Connexion à MongoDB...');
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connecté à MongoDB\n');

    // 1. Compter tous les devis
    const totalDevis = await Devis.countDocuments();
    console.log(`📊 Total de devis en base: ${totalDevis}`);

    // 2. Compter les devis avec diagnostiqueurAssigne
    const devisAvecDiag = await Devis.countDocuments({
      diagnostiqueurAssigne: { $exists: true, $ne: null }
    });
    console.log(`✅ Devis avec diagnostiqueurAssigne: ${devisAvecDiag}`);
    console.log(`❌ Devis sans diagnostiqueurAssigne: ${totalDevis - devisAvecDiag}\n`);

    // 3. Lister tous les diagnostiqueurs
    const diagnostiqueurs = await Diagnostiqueur.find({})
      .select('_id nom_entreprise admin.email')
      .limit(20);

    console.log('👥 Liste des diagnostiqueurs:');
    diagnostiqueurs.forEach((diag, index) => {
      console.log(`  ${index + 1}. ${diag.nom_entreprise} (${diag.admin.email})`);
      console.log(`     ID: ${diag._id}`);
    });
    console.log('');

    // 4. Pour chaque diagnostiqueur, vérifier ses devis
    console.log('🔍 Vérification des devis par diagnostiqueur:\n');

    for (const diag of diagnostiqueurs) {
      const devisDuDiag = await Devis.find({
        diagnostiqueurAssigne: diag._id
      })
        .select('numero dateCreation statut')
        .limit(10);

      console.log(`📋 ${diag.nom_entreprise}:`);
      console.log(`   ID: ${diag._id}`);
      console.log(`   Nombre de devis: ${devisDuDiag.length}`);

      if (devisDuDiag.length > 0) {
        console.log('   Devis:');
        devisDuDiag.forEach(d => {
          console.log(`     - ${d.numero} (${d.statut}) - ${new Date(d.dateCreation).toLocaleDateString('fr-FR')}`);
        });
      }
      console.log('');
    }

    // 5. Lister les 10 derniers devis créés avec leur diagnostiqueurAssigne
    console.log('📅 10 derniers devis créés:\n');
    const derniersDevis = await Devis.find({})
      .select('numero dateCreation diagnostiqueurAssigne agenceId statut')
      .populate('diagnostiqueurAssigne', 'nom_entreprise')
      .populate('agenceId', 'nom_entreprise')
      .sort({ dateCreation: -1 })
      .limit(10);

    derniersDevis.forEach((devis, index) => {
      console.log(`${index + 1}. ${devis.numero}`);
      console.log(`   Date: ${new Date(devis.dateCreation).toLocaleDateString('fr-FR')}`);
      console.log(`   Statut: ${devis.statut}`);
      console.log(`   Agence: ${devis.agenceId?.nom_entreprise || 'N/A'}`);
      console.log(`   Diagnostiqueur: ${devis.diagnostiqueurAssigne?.nom_entreprise || '❌ NON ASSIGNÉ'}`);
      console.log(`   ID diagnostiqueur: ${devis.diagnostiqueurAssigne?._id || 'NULL'}`);
      console.log('');
    });

    console.log('✅ Vérification terminée');

  } catch (error) {
    console.error('❌ Erreur:', error);
  } finally {
    await mongoose.disconnect();
    console.log('🔌 Déconnecté de MongoDB');
  }
}

checkDevisDiagnostiqueur();
