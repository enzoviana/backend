const mongoose = require('mongoose');
require('dotenv').config();

const Document = require('../models/Document');
const Diagnostiqueur = require('../models/Diagnostiqueur');
const Devis = require('../models/Devis');
const OrdreMission = require('../models/OrdreMission');

/**
 * Script de vérification de la migration Cloudinary → MongoDB
 * Compare le nombre de documents dans Cloudinary vs MongoDB
 */

const stats = {
  cloudinary: {
    diagnostiqueurs: {
      documents: 0,
      logos: 0,
      photos: 0
    },
    devis: {
      pdfs: 0,
      signatures: 0
    },
    missions: {
      consentements: 0,
      fichiers: 0
    },
    total: 0
  },
  mongodb: {
    total: 0,
    byType: {},
    byModel: {}
  },
  differences: []
};

/**
 * Compte les documents dans Cloudinary (depuis les modèles)
 */
async function compterDocumentsCloudinary() {
  console.log('📊 Comptage des documents dans Cloudinary...\n');

  // Diagnostiqueurs
  const diagnostiqueurs = await Diagnostiqueur.find({});
  for (const diag of diagnostiqueurs) {
    stats.cloudinary.diagnostiqueurs.documents += diag.documents?.length || 0;
    if (diag.logo) stats.cloudinary.diagnostiqueurs.logos++;
    if (diag.admin?.photo_profil) stats.cloudinary.diagnostiqueurs.photos++;
  }

  // Devis
  const devis = await Devis.find({
    $or: [
      { pdfUrl: { $ne: null } },
      { signatureUrl: { $ne: null } }
    ]
  });
  for (const dev of devis) {
    if (dev.pdfUrl) stats.cloudinary.devis.pdfs++;
    if (dev.signatureUrl) stats.cloudinary.devis.signatures++;
  }

  // Ordres de mission
  const missions = await OrdreMission.find({
    $or: [
      { 'consentementPdf.url': { $exists: true, $ne: null } },
      { fichiersClient: { $exists: true, $ne: [] } }
    ]
  });
  for (const mission of missions) {
    if (mission.consentementPdf?.url) stats.cloudinary.missions.consentements++;
    stats.cloudinary.missions.fichiers += mission.fichiersClient?.length || 0;
  }

  // Calculer le total
  stats.cloudinary.total =
    stats.cloudinary.diagnostiqueurs.documents +
    stats.cloudinary.diagnostiqueurs.logos +
    stats.cloudinary.diagnostiqueurs.photos +
    stats.cloudinary.devis.pdfs +
    stats.cloudinary.devis.signatures +
    stats.cloudinary.missions.consentements +
    stats.cloudinary.missions.fichiers;

  console.log('✅ Comptage Cloudinary terminé\n');
}

/**
 * Compte les documents dans MongoDB
 */
async function compterDocumentsMongoDB() {
  console.log('📊 Comptage des documents dans MongoDB...\n');

  // Total
  stats.mongodb.total = await Document.countDocuments();

  // Par type
  const byType = await Document.aggregate([
    {
      $group: {
        _id: '$type',
        count: { $sum: 1 }
      }
    }
  ]);

  byType.forEach(item => {
    stats.mongodb.byType[item._id] = item.count;
  });

  // Par modèle
  const byModel = await Document.aggregate([
    {
      $group: {
        _id: '$relatedTo.model',
        count: { $sum: 1 }
      }
    }
  ]);

  byModel.forEach(item => {
    stats.mongodb.byModel[item._id] = item.count;
  });

  console.log('✅ Comptage MongoDB terminé\n');
}

/**
 * Compare les statistiques
 */
function comparerStatistiques() {
  console.log('🔍 Comparaison des statistiques...\n');

  // Comparaison globale
  if (stats.cloudinary.total !== stats.mongodb.total) {
    stats.differences.push({
      type: 'TOTAL',
      cloudinary: stats.cloudinary.total,
      mongodb: stats.mongodb.total,
      difference: stats.mongodb.total - stats.cloudinary.total
    });
  }

  // Comparaison par type
  const mappings = {
    'kbis': stats.cloudinary.diagnostiqueurs.documents,
    'assurance_rc': stats.cloudinary.diagnostiqueurs.documents,
    'assurance_decennale': stats.cloudinary.diagnostiqueurs.documents,
    'logo_entreprise': stats.cloudinary.diagnostiqueurs.logos,
    'photo_profil': stats.cloudinary.diagnostiqueurs.photos,
    'devis_pdf': stats.cloudinary.devis.pdfs,
    'signature_client': stats.cloudinary.devis.signatures,
    'consentement_pdf': stats.cloudinary.missions.consentements,
    'fichier_client': stats.cloudinary.missions.fichiers
  };

  // Note: La comparaison par type est approximative car les documents administratifs
  // sont regroupés dans Cloudinary mais séparés par type dans MongoDB
}

/**
 * Affiche le rapport
 */
function afficherRapport() {
  console.log('\n' + '='.repeat(70));
  console.log('📊 RAPPORT DE VÉRIFICATION DE MIGRATION');
  console.log('='.repeat(70));

  console.log('\n📁 CLOUDINARY (sources)');
  console.log('-'.repeat(70));
  console.log('Diagnostiqueurs:');
  console.log(`  - Documents administratifs: ${stats.cloudinary.diagnostiqueurs.documents}`);
  console.log(`  - Logos:                    ${stats.cloudinary.diagnostiqueurs.logos}`);
  console.log(`  - Photos profil:            ${stats.cloudinary.diagnostiqueurs.photos}`);
  console.log('\nDevis:');
  console.log(`  - PDFs:                     ${stats.cloudinary.devis.pdfs}`);
  console.log(`  - Signatures:               ${stats.cloudinary.devis.signatures}`);
  console.log('\nOrdres de mission:');
  console.log(`  - Consentements:            ${stats.cloudinary.missions.consentements}`);
  console.log(`  - Fichiers clients:         ${stats.cloudinary.missions.fichiers}`);
  console.log('\n' + '-'.repeat(70));
  console.log(`TOTAL CLOUDINARY:             ${stats.cloudinary.total}`);

  console.log('\n💾 MONGODB (destination)');
  console.log('-'.repeat(70));
  console.log('Par type:');
  Object.entries(stats.mongodb.byType).forEach(([type, count]) => {
    console.log(`  - ${type.padEnd(25)}: ${count}`);
  });
  console.log('\nPar modèle:');
  Object.entries(stats.mongodb.byModel).forEach(([model, count]) => {
    console.log(`  - ${model.padEnd(25)}: ${count}`);
  });
  console.log('\n' + '-'.repeat(70));
  console.log(`TOTAL MONGODB:                ${stats.mongodb.total}`);

  console.log('\n' + '='.repeat(70));

  // Résultat de la comparaison
  if (stats.cloudinary.total === stats.mongodb.total) {
    console.log('✅ MIGRATION COMPLÈTE - Tous les documents ont été migrés !');
  } else if (stats.mongodb.total > stats.cloudinary.total) {
    const diff = stats.mongodb.total - stats.cloudinary.total;
    console.log(`⚠️  ATTENTION - ${diff} documents en plus dans MongoDB`);
    console.log('   (Possible si certains documents ont été ajoutés après la migration)');
  } else {
    const diff = stats.cloudinary.total - stats.mongodb.total;
    console.log(`❌ MIGRATION INCOMPLÈTE - ${diff} documents manquants dans MongoDB`);
    console.log('   Relancez le script de migration pour compléter.');
  }

  console.log('='.repeat(70));
}

/**
 * Vérifie l'intégrité des documents (sampling)
 */
async function verifierIntegrite() {
  console.log('\n🔍 Vérification d\'intégrité (échantillon)...\n');

  const sample = await Document.find({})
    .limit(10)
    .select('nom type taille contentType relatedTo cloudinaryPublicId');

  console.log('Échantillon de 10 documents:');
  sample.forEach((doc, i) => {
    console.log(`\n${i + 1}. ${doc.nom}`);
    console.log(`   Type:         ${doc.type}`);
    console.log(`   Taille:       ${(doc.taille / 1024).toFixed(2)} KB`);
    console.log(`   Content-Type: ${doc.contentType}`);
    console.log(`   Lié à:        ${doc.relatedTo.model} (${doc.relatedTo.id})`);
    console.log(`   Cloudinary:   ${doc.cloudinaryPublicId ? '✅' : '❌'}`);
  });

  console.log('\n✅ Vérification d\'intégrité terminée\n');
}

/**
 * Vérifie les documents orphelins (sans relation valide)
 */
async function verifierOrphelins() {
  console.log('🔍 Vérification des documents orphelins...\n');

  const orphelins = [];

  // Vérifier chaque document
  const documents = await Document.find({}).select('nom relatedTo');

  for (const doc of documents) {
    const { model, id } = doc.relatedTo;
    let exists = false;

    try {
      switch (model) {
        case 'Diagnostiqueur':
          exists = await Diagnostiqueur.exists({ _id: id });
          break;
        case 'Devis':
          exists = await Devis.exists({ _id: id });
          break;
        case 'OrdreMission':
          exists = await OrdreMission.exists({ _id: id });
          break;
      }

      if (!exists) {
        orphelins.push({
          nom: doc.nom,
          model,
          id: id.toString()
        });
      }
    } catch (error) {
      orphelins.push({
        nom: doc.nom,
        model,
        id: id.toString(),
        error: error.message
      });
    }
  }

  if (orphelins.length === 0) {
    console.log('✅ Aucun document orphelin trouvé\n');
  } else {
    console.log(`⚠️  ${orphelins.length} document(s) orphelin(s) trouvé(s):\n`);
    orphelins.forEach((orph, i) => {
      console.log(`${i + 1}. ${orph.nom} (${orph.model}:${orph.id})`);
      if (orph.error) console.log(`   Erreur: ${orph.error}`);
    });
    console.log();
  }
}

/**
 * Script principal
 */
async function verifierMigration() {
  try {
    console.log('🚀 Vérification de la migration Cloudinary → MongoDB\n');
    console.log('='.repeat(70));

    // Connexion
    await mongoose.connect(process.env.MONGO_URI || process.env.MONGO_LIVE);
    console.log('✅ Connecté à MongoDB\n');

    // Comptages
    await compterDocumentsCloudinary();
    await compterDocumentsMongoDB();

    // Comparaison
    comparerStatistiques();

    // Rapport
    afficherRapport();

    // Intégrité
    await verifierIntegrite();

    // Orphelins
    await verifierOrphelins();

    console.log('✅ Vérification terminée !\n');

  } catch (error) {
    console.error('❌ Erreur lors de la vérification:', error);
    throw error;
  } finally {
    await mongoose.disconnect();
    console.log('👋 Déconnexion de MongoDB\n');
  }
}

// Exécuter
if (require.main === module) {
  verifierMigration()
    .then(() => {
      console.log('🎉 Script terminé');
      process.exit(0);
    })
    .catch((error) => {
      console.error('💥 Erreur fatale:', error);
      process.exit(1);
    });
}

module.exports = { verifierMigration };
