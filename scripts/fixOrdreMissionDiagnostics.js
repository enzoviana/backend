/**
 * 🔧 SCRIPT DE MIGRATION : Synchronisation Devis → Ordre de Mission
 *
 * Problème : Les OrdreMission ne stockaient pas de copie des diagnostics du Devis.
 * Les diagnostics affichés étaient lus dynamiquement depuis le Devis, créant une
 * désynchronisation si le Devis était modifié après la création de l'OM.
 *
 * Solution : Ce script copie les diagnostics du Devis dans chaque OM existant.
 *
 * Usage :
 *   node backend/scripts/fixOrdreMissionDiagnostics.js
 *
 * Options :
 *   --dry-run    Analyse sans modification (rapport uniquement)
 *   --verbose    Affichage détaillé
 */

require('dotenv').config();
const mongoose = require('mongoose');
const OrdreMission = require('../models/OrdreMission');
const Devis = require('../models/Devis');

// Configuration
const DRY_RUN = process.argv.includes('--dry-run');
const VERBOSE = process.argv.includes('--verbose');

// Statistiques
const stats = {
  total: 0,
  alreadySynced: 0,
  needsSync: 0,
  synced: 0,
  errors: 0,
  devisNotFound: 0,
  mismatches: []
};

/**
 * Compare les diagnostics entre un Devis et son OM
 */
function compareDiagnostics(devis, om) {
  const differences = [];

  // Comparer pack
  const devisPack = devis.pack?.toString() || null;
  const omPack = om.pack?.toString() || null;
  if (devisPack !== omPack) {
    differences.push({
      field: 'pack',
      devisValue: devisPack,
      omValue: omPack
    });
  }

  // Comparer diagnosticsSelectionnes
  const devisDiags = (devis.diagnosticsSelectionnes || []).map(d => d.toString()).sort();
  const omDiags = (om.diagnosticsSelectionnes || []).map(d => d.toString()).sort();
  if (JSON.stringify(devisDiags) !== JSON.stringify(omDiags)) {
    differences.push({
      field: 'diagnosticsSelectionnes',
      devisValue: devisDiags.length,
      omValue: omDiags.length,
      devisList: devisDiags,
      omList: omDiags
    });
  }

  // Comparer supplementsSelectionnes
  const devisSupps = (devis.supplementsSelectionnes || []).map(s => s.toString()).sort();
  const omSupps = (om.supplementsSelectionnes || []).map(s => s.toString()).sort();
  if (JSON.stringify(devisSupps) !== JSON.stringify(omSupps)) {
    differences.push({
      field: 'supplementsSelectionnes',
      devisValue: devisSupps.length,
      omValue: omSupps.length,
      devisList: devisSupps,
      omList: omSupps
    });
  }

  return differences;
}

/**
 * Vérifie si un OM a besoin de synchronisation
 */
function needsSync(om) {
  // Si aucun diagnostic n'est défini dans l'OM, il a besoin de sync
  return !om.pack &&
         (!om.diagnosticsSelectionnes || om.diagnosticsSelectionnes.length === 0) &&
         (!om.supplementsSelectionnes || om.supplementsSelectionnes.length === 0);
}

/**
 * Synchronise un OM avec son Devis
 */
async function syncOrdreMission(om, devis) {
  const update = {
    pack: devis.pack || null,
    diagnosticsSelectionnes: devis.diagnosticsSelectionnes || [],
    supplementsSelectionnes: devis.supplementsSelectionnes || [],
    chauffageGaz: devis.chauffageGaz || false,
    tarifGaz: devis.tarifGaz || 0,
    copropriete: devis.copropriete || false,
    tarifCopropriete: devis.tarifCopropriete || 0
  };

  if (DRY_RUN) {
    console.log(`  [DRY-RUN] OM ${om.numero} serait synchronisé avec :`);
    console.log(`    - Pack: ${update.pack || 'aucun'}`);
    console.log(`    - Diagnostics: ${update.diagnosticsSelectionnes.length}`);
    console.log(`    - Suppléments: ${update.supplementsSelectionnes.length}`);
    return true;
  }

  try {
    await OrdreMission.findByIdAndUpdate(om._id, update);
    return true;
  } catch (error) {
    console.error(`  ❌ Erreur sync OM ${om.numero}:`, error.message);
    return false;
  }
}

/**
 * Analyse et synchronise tous les OM
 */
async function analyzeAndSync() {
  console.log('\n🔍 ANALYSE DE LA BASE DE DONNÉES');
  console.log('='.repeat(60));
  console.log(`Mode: ${DRY_RUN ? '🔎 DRY-RUN (lecture seule)' : '✏️  MODIFICATION'}`);
  console.log('='.repeat(60));

  // Récupérer tous les OM avec leur Devis
  const ordres = await OrdreMission.find()
    .populate('devisId')
    .sort({ dateCreation: -1 });

  stats.total = ordres.length;
  console.log(`\n📊 Total des Ordres de Mission: ${stats.total}\n`);

  for (const om of ordres) {
    const omNum = om.numero;

    // Vérifier que le devis existe
    if (!om.devisId) {
      console.log(`⚠️  OM ${omNum}: Devis introuvable`);
      stats.devisNotFound++;
      continue;
    }

    const devis = om.devisId;

    // Vérifier si l'OM a besoin de sync
    if (!needsSync(om)) {
      stats.alreadySynced++;
      if (VERBOSE) {
        console.log(`✅ OM ${omNum}: Déjà synchronisé`);
      }

      // Comparer pour détecter les désynchronisations
      const differences = compareDiagnostics(devis, om);
      if (differences.length > 0) {
        stats.mismatches.push({
          om: omNum,
          devis: devis.numero,
          differences
        });
        console.log(`⚠️  OM ${omNum}: Divergence détectée avec le devis ${devis.numero}`);
        if (VERBOSE) {
          differences.forEach(diff => {
            console.log(`    - ${diff.field}: Devis=${diff.devisValue}, OM=${diff.omValue}`);
          });
        }
      }
      continue;
    }

    // L'OM a besoin de synchronisation
    stats.needsSync++;
    console.log(`🔄 OM ${omNum} → Devis ${devis.numero}: Synchronisation nécessaire`);

    if (VERBOSE) {
      console.log(`    Devis actuel:`);
      console.log(`      - Pack: ${devis.pack || 'aucun'}`);
      console.log(`      - Diagnostics: ${devis.diagnosticsSelectionnes?.length || 0}`);
      console.log(`      - Suppléments: ${devis.supplementsSelectionnes?.length || 0}`);
    }

    // Synchroniser
    const success = await syncOrdreMission(om, devis);
    if (success) {
      stats.synced++;
    } else {
      stats.errors++;
    }
  }

  // Rapport final
  console.log('\n' + '='.repeat(60));
  console.log('📋 RAPPORT FINAL');
  console.log('='.repeat(60));
  console.log(`Total OM analysés:                ${stats.total}`);
  console.log(`OM déjà synchronisés:             ${stats.alreadySynced}`);
  console.log(`OM nécessitant une sync:          ${stats.needsSync}`);
  console.log(`OM synchronisés:                  ${stats.synced}`);
  console.log(`Devis introuvables:               ${stats.devisNotFound}`);
  console.log(`Erreurs:                          ${stats.errors}`);
  console.log(`Désynchronisations détectées:     ${stats.mismatches.length}`);

  if (stats.mismatches.length > 0) {
    console.log('\n⚠️  DÉSYNCHRONISATIONS DÉTECTÉES:');
    console.log('Ces OM ont des diagnostics différents de leur Devis:');
    stats.mismatches.forEach(m => {
      console.log(`\n  OM ${m.om} ↔ Devis ${m.devis}:`);
      m.differences.forEach(diff => {
        console.log(`    - ${diff.field}:`);
        console.log(`        Devis: ${diff.devisValue}`);
        console.log(`        OM:    ${diff.omValue}`);
      });
    });
  }

  if (DRY_RUN) {
    console.log('\n💡 Exécutez sans --dry-run pour appliquer les modifications.');
  } else {
    console.log('\n✅ Synchronisation terminée.');
  }
}

/**
 * Point d'entrée
 */
async function main() {
  try {
    // Connexion MongoDB
    const MONGO_URI = process.env.MONGO_URI;
    if (!MONGO_URI) {
      throw new Error('MONGO_URI non définie dans .env');
    }

    console.log('🔌 Connexion à MongoDB...');
    await mongoose.connect(MONGO_URI);
    console.log('✅ Connecté à MongoDB\n');

    // Analyse et synchronisation
    await analyzeAndSync();

    // Déconnexion
    await mongoose.disconnect();
    console.log('\n🔌 Déconnecté de MongoDB');

    process.exit(0);
  } catch (error) {
    console.error('\n❌ ERREUR FATALE:', error);
    process.exit(1);
  }
}

// Lancement
main();
