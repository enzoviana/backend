require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const mongoose = require('mongoose');

/**
 * Script de synchronisation de bases de données
 * Copie intégralement MONGO_LIVE (Atlas) → MONGO_URI (Docker local)
 *
 * ATTENTION : Ce script ÉCRASE la base de données locale !
 */

const stats = {
  collections: { total: 0, reussies: 0, erreurs: 0 },
  documents: { total: 0, copies: 0, erreurs: 0 },
  detailsParCollection: {},
  debut: null,
  fin: null
};

let connexionSource = null;
let connexionDestination = null;

/**
 * Crée deux connexions distinctes (source et destination)
 */
async function creerConnexions() {
  console.log('🔌 Création des connexions aux bases de données...\n');

  const sourceUri = process.env.MONGO_LIVE;
  const destUri = process.env.MONGO_URI;

  if (!sourceUri || !destUri) {
    throw new Error('❌ MONGO_LIVE ou MONGO_URI non défini dans le fichier .env');
  }

  console.log(`📡 Source (Atlas):       ${sourceUri.substring(0, 30)}...`);
  console.log(`💾 Destination (Docker): ${destUri}\n`);

  try {
    connexionSource = await mongoose.createConnection(sourceUri, {
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 5000,
    }).asPromise();
    console.log('✅ Connecté à MongoDB Atlas (source)\n');

    connexionDestination = await mongoose.createConnection(destUri, {
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 5000,
    }).asPromise();
    console.log('✅ Connecté à MongoDB Docker (destination)\n');

  } catch (error) {
    throw new Error(`Erreur de connexion: ${error.message}`);
  }
}

/**
 * Liste toutes les collections de la base source (en excluant le système et les backups)
 */
async function listerCollections() {
  const collections = await connexionSource.db.listCollections().toArray();
  return collections
    .map(col => col.name)
    .filter(name => !name.startsWith('system.') && !name.startsWith('backup_'));
}

/**
 * Crée un backup de la BDD destination avant écrasement
 */
async function creerBackup() {
  console.log('💾 Création d\'un backup de la BDD locale...\n');

  try {
    const collections = await connexionDestination.db.listCollections().toArray();
    const backupName = `backup_${new Date().toISOString().replace(/[:.]/g, '-')}`;

    let totalDocs = 0;

    for (const col of collections) {
      // EXCLUSION : On ne ré-essaye pas de sauvegarder d'anciens backups ou fichiers système
      if (col.name.startsWith('system.') || col.name.startsWith('backup_')) continue;

      const sourceCollection = connexionDestination.db.collection(col.name);
      const backupCollection = connexionDestination.db.collection(`${backupName}_${col.name}`);

      const docs = await sourceCollection.find({}).toArray();
      if (docs.length > 0) {
        await backupCollection.insertMany(docs);
        totalDocs += docs.length;
      }
    }

    console.log(`✅ Backup créé: ${backupName} (${totalDocs} documents)\n`);
    return backupName;

  } catch (error) {
    console.warn(`⚠️  Impossible de créer un backup: ${error.message}\n`);
    return null;
  }
}

/**
 * Supprime toutes les collections de la destination (hors backups et système)
 */
async function viderDestination() {
  console.log('🗑️  Suppression des collections de la destination...\n');

  const collections = await connexionDestination.db.listCollections().toArray();

  for (const col of collections) {
    if (col.name.startsWith('system.') || col.name.startsWith('backup_')) {
      continue; 
    }

    try {
      await connexionDestination.db.collection(col.name).drop();
      console.log(`  ✓ Supprimé: ${col.name}`);
    } catch (error) {
      console.warn(`  ⚠️  Erreur suppression ${col.name}: ${error.message}`);
    }
  }

  console.log('\n✅ Destination vidée\n');
}

/**
 * Copie une collection de la source vers la destination
 */
async function copierCollection(nomCollection) {
  try {
    const sourceCollection = connexionSource.db.collection(nomCollection);
    const destCollection = connexionDestination.db.collection(nomCollection);

    const count = await sourceCollection.countDocuments();

    if (count === 0) {
      console.log(`  ⏭️  ${nomCollection}: vide (ignoré)`);
      stats.detailsParCollection[nomCollection] = { total: 0, copies: 0 };
      return;
    }

    const documents = await sourceCollection.find({}).toArray();

    // ordered: false permet de continuer l'insertion même si un document provoque une erreur (ex: doublon d'index)
    await destCollection.insertMany(documents, { ordered: false });

    stats.collections.reussies++;
    stats.documents.total += count;
    stats.documents.copies += documents.length;
    stats.detailsParCollection[nomCollection] = {
      total: count,
      copies: documents.length
    };

    console.log(`  ✅ ${nomCollection}: ${documents.length} documents copiés`);

  } catch (error) {
    stats.collections.erreurs++;
    stats.detailsParCollection[nomCollection] = {
      total: 0,
      copies: 0,
      erreur: error.message
    };
    console.error(`  ❌ ${nomCollection}: ${error.message}`);
  }
}

/**
 * Copie les index d'une collection
 */
async function copierIndex(nomCollection) {
  try {
    const sourceCollection = connexionSource.db.collection(nomCollection);
    const destCollection = connexionDestination.db.collection(nomCollection);

    const indexes = await sourceCollection.indexes();

    for (const index of indexes) {
      if (index.name === '_id_') continue; 

      try {
        await destCollection.createIndex(index.key, {
          name: index.name,
          unique: index.unique,
          sparse: index.sparse,
          background: true
        });
      } catch (error) {
        // Ignoré si l'index existe déjà
      }
    }

  } catch (error) {
    console.warn(`  ⚠️  Erreur copie index ${nomCollection}: ${error.message}`);
  }
}

/**
 * Affiche le rapport final
 */
function afficherRapport() {
  const duree = ((stats.fin - stats.debut) / 1000).toFixed(2);

  console.log('\n' + '='.repeat(70));
  console.log('📊 RAPPORT DE SYNCHRONISATION');
  console.log('='.repeat(70));
  console.log(`⏱️  Durée totale: ${duree} secondes\n`);

  console.log('📚 Collections:');
  console.log(`   Total:      ${stats.collections.total}`);
  console.log(`   ✅ Réussies: ${stats.collections.reussies}`);
  console.log(`   ❌ Erreurs:  ${stats.collections.erreurs}\n`);

  console.log('📄 Documents:');
  console.log(`   Total:      ${stats.documents.total}`);
  console.log(`   ✅ Copiés:   ${stats.documents.copies}`);
  console.log(`   ❌ Erreurs:  ${stats.documents.erreurs}\n`);

  console.log('📋 Détails par collection:');
  Object.entries(stats.detailsParCollection).forEach(([nom, detail]) => {
    if (detail.erreur) {
      console.log(`   ❌ ${nom}: ${detail.erreur}`);
    } else if (detail.total > 0) {
      console.log(`   ✅ ${nom}: ${detail.copies}/${detail.total} documents`);
    }
  });

  console.log('='.repeat(70));
  console.log(stats.collections.erreurs === 0 
    ? '✅ SYNCHRONISATION TERMINÉE AVEC SUCCÈS !' 
    : `⚠️  SYNCHRONISATION TERMINÉE AVEC ${stats.collections.erreurs} ERREUR(S)`
  );
  console.log('='.repeat(70) + '\n');
}

/**
 * Script principal de synchronisation
 */
async function synchroniserBases(options = {}) {
  const {
    avecBackup = true,
    viderAvant = true,
    copierIndexes = true,
    progressCallback = null
  } = options;

  stats.debut = Date.now();

  try {
    console.log('🚀 SYNCHRONISATION MONGO_LIVE → MONGO_URI\n');
    console.log('⚠️  ATTENTION: Cette opération va ÉCRASER la base locale !\n');
    console.log('='.repeat(70) + '\n');

    await creerConnexions();

    let backupName = null;
    if (avecBackup) {
      backupName = await creerBackup();
    }

    if (viderAvant) {
      await viderDestination();
    }

    const collections = await listerCollections();
    stats.collections.total = collections.length;

    console.log(`📦 ${collections.length} collection(s) à copier:\n`);
    collections.forEach(col => console.log(`   - ${col}`));
    console.log();

    console.log('🔄 Copie des collections...\n');

    for (let i = 0; i < collections.length; i++) {
      const collection = collections[i];
      console.log(`[${i + 1}/${collections.length}] ${collection}`);

      await copierCollection(collection);

      if (copierIndexes) {
        await copierIndex(collection);
      }

      if (progressCallback) {
        progressCallback({
          collection,
          current: i + 1,
          total: collections.length,
          stats
        });
      }
    }

    stats.fin = Date.now();
    afficherRapport();

    return {
      success: true,
      stats,
      backupName,
      duree: ((stats.fin - stats.debut) / 1000).toFixed(2)
    };

  } catch (error) {
    console.error('\n❌ ERREUR FATALE:', error.message);
    return { success: false, error: error.message, stats };

  } finally {
    if (connexionSource) await connexionSource.close();
    if (connexionDestination) await connexionDestination.close();
    console.log('👋 Connexions MongoDB fermées proprement.\n');
  }
}

/**
 * Confirmation interactive
 */
async function demanderConfirmation() {
  const readline = require('readline').createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise((resolve) => {
    readline.question(
      '⚠️  Voulez-vous vraiment écraser la BDD locale avec la BDD Atlas ? (oui/non): ',
      (answer) => {
        readline.close();
        resolve(answer.toLowerCase() === 'oui');
      }
    );
  });
}

if (require.main === module) {
  (async () => {
    const confirme = await demanderConfirmation();

    if (!confirme) {
      console.log('\n❌ Synchronisation annulée par l\'utilisateur\n');
      process.exit(0);
    }

    const resultat = await synchroniserBases({
      avecBackup: true,
      viderAvant: true,
      copierIndexes: true
    });

    process.exit(resultat.success ? 0 : 1);
  })();
}

module.exports = { synchroniserBases };