const { synchroniserBases } = require('../scripts/syncDatabases');

/**
 * Contrôleur pour la synchronisation des bases de données
 * Réservé aux administrateurs uniquement
 */

// Map pour stocker les synchronisations en cours
const synchronisationsEnCours = new Map();

/**
 * @desc    Déclenche la synchronisation MONGO_LIVE → MONGO_URI
 * @route   POST /api/admin/sync/start
 * @access  Admin only
 */
exports.demarrerSync = async (req, res) => {
  try {
    // Vérifier qu'il n'y a pas déjà une sync en cours
    if (synchronisationsEnCours.size > 0) {
      return res.status(409).json({
        success: false,
        message: 'Une synchronisation est déjà en cours',
        syncEnCours: Array.from(synchronisationsEnCours.keys())
      });
    }

    const {
      avecBackup = true,
      viderAvant = true,
      copierIndexes = true
    } = req.body;

    // Créer un ID unique pour cette sync
    const syncId = `sync_${Date.now()}`;

    // Stocker l'état de la sync
    synchronisationsEnCours.set(syncId, {
      debut: new Date(),
      status: 'en_cours',
      progression: 0,
      stats: {
        collections: { total: 0, reussies: 0, erreurs: 0 },
        documents: { total: 0, copies: 0, erreurs: 0 }
      }
    });

    // Répondre immédiatement
    res.json({
      success: true,
      message: 'Synchronisation démarrée',
      syncId,
      avertissement: 'Cette opération peut prendre plusieurs minutes selon la taille de la base'
    });

    // Lancer la sync en arrière-plan
    synchroniserBases({
      avecBackup,
      viderAvant,
      copierIndexes,
      progressCallback: (progress) => {
        // Mettre à jour la progression
        const sync = synchronisationsEnCours.get(syncId);
        if (sync) {
          sync.progression = Math.round((progress.current / progress.total) * 100);
          sync.collectionActuelle = progress.collection;
          sync.stats = progress.stats;
        }
      }
    })
      .then((resultat) => {
        // Mise à jour finale
        const sync = synchronisationsEnCours.get(syncId);
        if (sync) {
          sync.status = resultat.success ? 'termine' : 'erreur';
          sync.fin = new Date();
          sync.resultat = resultat;
          sync.progression = 100;
        }

        console.log(`✅ Synchronisation ${syncId} terminée:`, resultat.success ? 'SUCCÈS' : 'ÉCHEC');
      })
      .catch((error) => {
        const sync = synchronisationsEnCours.get(syncId);
        if (sync) {
          sync.status = 'erreur';
          sync.fin = new Date();
          sync.erreur = error.message;
        }

        console.error(`❌ Erreur synchronisation ${syncId}:`, error);
      });

  } catch (error) {
    console.error('Erreur démarrage synchronisation:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors du démarrage de la synchronisation',
      error: error.message
    });
  }
};

/**
 * @desc    Récupère le statut d'une synchronisation
 * @route   GET /api/admin/sync/status/:syncId
 * @access  Admin only
 */
exports.getStatusSync = async (req, res) => {
  try {
    const { syncId } = req.params;

    const sync = synchronisationsEnCours.get(syncId);

    if (!sync) {
      return res.status(404).json({
        success: false,
        message: 'Synchronisation non trouvée ou expirée'
      });
    }

    res.json({
      success: true,
      syncId,
      status: sync.status,
      progression: sync.progression,
      collectionActuelle: sync.collectionActuelle,
      debut: sync.debut,
      fin: sync.fin,
      stats: sync.stats,
      resultat: sync.resultat,
      erreur: sync.erreur
    });

  } catch (error) {
    console.error('Erreur récupération status:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la récupération du statut',
      error: error.message
    });
  }
};

/**
 * @desc    Liste toutes les synchronisations (en cours et terminées)
 * @route   GET /api/admin/sync/list
 * @access  Admin only
 */
exports.listerSyncs = async (req, res) => {
  try {
    const syncs = Array.from(synchronisationsEnCours.entries()).map(([id, sync]) => ({
      syncId: id,
      status: sync.status,
      progression: sync.progression,
      debut: sync.debut,
      fin: sync.fin,
      stats: sync.stats
    }));

    res.json({
      success: true,
      total: syncs.length,
      synchronisations: syncs
    });

  } catch (error) {
    console.error('Erreur liste syncs:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la récupération de la liste',
      error: error.message
    });
  }
};

/**
 * @desc    Nettoie les synchronisations terminées
 * @route   DELETE /api/admin/sync/clean
 * @access  Admin only
 */
exports.nettoyerSyncs = async (req, res) => {
  try {
    let count = 0;

    synchronisationsEnCours.forEach((sync, id) => {
      if (sync.status === 'termine' || sync.status === 'erreur') {
        synchronisationsEnCours.delete(id);
        count++;
      }
    });

    res.json({
      success: true,
      message: `${count} synchronisation(s) nettoyée(s)`,
      restantes: synchronisationsEnCours.size
    });

  } catch (error) {
    console.error('Erreur nettoyage syncs:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors du nettoyage',
      error: error.message
    });
  }
};

/**
 * @desc    Vérifie la configuration des BDD (test de connexion)
 * @route   GET /api/admin/sync/check-config
 * @access  Admin only
 */
exports.verifierConfig = async (req, res) => {
  // Un log dès que la fonction est appelée pour savoir que la requête est arrivée
  console.log('\n▶▶▶ [CONFIG CHECK] Début de la vérification de la configuration...');
  
  try {
    // Log des variables d'environnement brutes reçues par Node.js
    console.log('[CONFIG CHECK] État brut de process.env :');
    console.log('  - process.env.MONGO_LIVE :', process.env.MONGO_LIVE ? 'Présent (Masqué pour sécurité)' : 'ABSENT ❌');
    console.log('  - process.env.MONGO_URI  :', process.env.MONGO_URI || 'ABSENT ❌');

    const config = {
      mongoLive: {
        configured: !!process.env.MONGO_LIVE,
        uri: process.env.MONGO_LIVE ?
          process.env.MONGO_LIVE.substring(0, 30) + '...' :
          'Non configuré'
      },
      mongoUri: {
        configured: !!process.env.MONGO_URI,
        uri: process.env.MONGO_URI || 'Non configuré'
      }
    };

    const peutSynchroniser = config.mongoLive.configured && config.mongoUri.configured;

    // Log de l'objet de configuration finalisé et du résultat du booléen
    console.log('[CONFIG CHECK] Résultat du diagnostic :');
    console.log('  - Config construite :', JSON.stringify(config, null, 2));
    console.log(`  - Synchronisation possible ? ➔ ${peutSynchroniser ? 'OUI ✅' : 'NON ❌'}`);

    console.log('◀◀◀ [CONFIG CHECK] Fin de la vérification - Réponse envoyée au client avec succès.\n');

    res.json({
      success: true,
      config,
      peutSynchroniser,
      message: peutSynchroniser
        ? 'Configuration OK - Synchronisation possible'
        : 'Configuration incomplète - Vérifiez vos variables d\'environnement'
    });

  } catch (error) {
    // Ce log y était déjà, mais on s'assure qu'il ressorte bien en cas de crash inattendu
    console.error('❌ ❌ [CONFIG CHECK] ERREUR CRITIQUE lors de la vérification :', error);
    
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la vérification',
      error: error.message
    });
  }
};

/**
 * @desc    Exécute une synchronisation synchrone (ATTENTION: peut bloquer longtemps)
 * @route   POST /api/admin/sync/execute
 * @access  Admin only
 */
exports.executerSyncBloquante = async (req, res) => {
  try {
    const {
      avecBackup = true,
      viderAvant = true,
      copierIndexes = true
    } = req.body;

    console.log('🚀 Début de synchronisation synchrone...');

    const resultat = await synchroniserBases({
      avecBackup,
      viderAvant,
      copierIndexes
    });

    if (resultat.success) {
      res.json({
        success: true,
        message: 'Synchronisation terminée avec succès',
        stats: resultat.stats,
        backupName: resultat.backupName,
        duree: resultat.duree
      });
    } else {
      res.status(500).json({
        success: false,
        message: 'Erreur lors de la synchronisation',
        error: resultat.error,
        stats: resultat.stats
      });
    }

  } catch (error) {
    console.error('Erreur synchronisation bloquante:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de l\'exécution de la synchronisation',
      error: error.message
    });
  }
};


