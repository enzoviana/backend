# 🚀 Guide d'intégration - Synchronisation BDD

## 📝 Étape 1 : Ajouter les routes dans server.js

### Méthode 1 : Routes séparées (Recommandé)

Ouvrez `/Users/enzo/Desktop/DataFuse/Dimotec/backend/server.js`

**1. Ajoutez l'import** (ligne ~12, avec les autres imports de routes):

```javascript
const adminSyncRoutes = require('./routes/adminSyncRoutes');
```

**2. Ajoutez la route** (ligne ~56, avec les autres app.use):

```javascript
app.use('/api/admin/sync', adminSyncRoutes);
```

### Exemple complet :

```javascript
// ... imports existants ...
const adminRoutes = require('./routes/adminRoutes');
const agencyRoutes = require('./routes/agencyRoutes');
const devisRoutes = require('./routes/devisRoutes');
const dashboardRoutes = require('./routes/dashboardRoutes');
const chatbotRoutes = require('./routes/chatbotRoutes');
const diagnostiqueurRoutes = require('./routes/diagnostiqueurRoutes');
const stripeRoutes = require('./routes/stripeRoutes');
const documentRoutes = require('./routes/documentRoutes');
const adminSyncRoutes = require('./routes/adminSyncRoutes'); // ← NOUVEAU

// ... configuration middlewares ...

// Routes
app.use('/api/admin', adminRoutes);
app.use('/api/admin/sync', adminSyncRoutes); // ← NOUVEAU
app.use('/api/agency', agencyRoutes);
app.use('/api/client', devisRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/devis', devisRoutes);
app.use('/api/chatbot', chatbotRoutes);
app.use('/api/diagnostiqueur', diagnostiqueurRoutes);
app.use('/api/documents', documentRoutes);
```

### Méthode 2 : Intégrer dans adminRoutes existant

Si vous préférez garder toutes les routes admin ensemble, ajoutez dans `/routes/adminRoutes.js`:

```javascript
const adminSyncController = require('../controllers/adminSyncController');

// Routes de synchronisation BDD
router.get('/sync/check-config', adminSyncController.verifierConfig);
router.post('/sync/start', adminSyncController.demarrerSync);
router.get('/sync/status/:syncId', adminSyncController.getStatusSync);
router.get('/sync/list', adminSyncController.listerSyncs);
router.delete('/sync/clean', adminSyncController.nettoyerSyncs);
router.post('/sync/execute', adminSyncController.executerSyncBloquante);
```

## 🧪 Étape 2 : Tester avec Postman

### 1. Vérifier la configuration

**GET** `http://localhost:3000/api/admin/sync/check-config`

Headers:
```
Authorization: Bearer <votre-token-admin>
```

### 2. Démarrer une synchronisation

**POST** `http://localhost:3000/api/admin/sync/start`

Headers:
```
Authorization: Bearer <votre-token-admin>
Content-Type: application/json
```

Body:
```json
{
  "avecBackup": true,
  "viderAvant": true,
  "copierIndexes": true
}
```

### 3. Vérifier la progression

**GET** `http://localhost:3000/api/admin/sync/status/sync_1705315845123`

Remplacez `sync_1705315845123` par le `syncId` retourné à l'étape 2.

## 🎨 Étape 3 : Intégration Frontend

### Composant React complet

Créez `frontend/src/components/Admin/SyncDatabase.jsx`:

```jsx
import React, { useState, useEffect } from 'react';
import axios from 'axios';

const SyncDatabase = () => {
  const [config, setConfig] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [syncId, setSyncId] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [currentCollection, setCurrentCollection] = useState('');

  // Vérifier la config au chargement
  useEffect(() => {
    checkConfig();
  }, []);

  // Poll la progression pendant la sync
  useEffect(() => {
    if (!syncId || !syncing) return;

    const interval = setInterval(async () => {
      try {
        const response = await axios.get(
          `/api/admin/sync/status/${syncId}`,
          {
            headers: {
              Authorization: `Bearer ${localStorage.getItem('token')}`
            }
          }
        );

        const data = response.data;

        if (data.success) {
          setProgress(data.progression);
          setCurrentCollection(data.collectionActuelle || '');

          if (data.status === 'termine') {
            clearInterval(interval);
            setSyncing(false);
            setResult(data);
            setError(null);
          } else if (data.status === 'erreur') {
            clearInterval(interval);
            setSyncing(false);
            setError(data.erreur || 'Erreur inconnue');
          }
        }
      } catch (err) {
        console.error('Erreur polling:', err);
      }
    }, 2000); // Poll toutes les 2 secondes

    return () => clearInterval(interval);
  }, [syncId, syncing]);

  const checkConfig = async () => {
    try {
      const response = await axios.get('/api/admin/sync/check-config', {
        headers: {
          Authorization: `Bearer ${localStorage.getItem('token')}`
        }
      });

      setConfig(response.data);
    } catch (err) {
      console.error('Erreur vérification config:', err);
      setError('Erreur lors de la vérification de la configuration');
    }
  };

  const startSync = async () => {
    if (!window.confirm(
      '⚠️ ATTENTION: Cette opération va ÉCRASER complètement votre base de données locale avec les données d\'Atlas.\n\n' +
      'Un backup sera créé automatiquement.\n\n' +
      'Voulez-vous continuer ?'
    )) {
      return;
    }

    try {
      setError(null);
      setResult(null);
      setSyncing(true);
      setProgress(0);

      const response = await axios.post(
        '/api/admin/sync/start',
        {
          avecBackup: true,
          viderAvant: true,
          copierIndexes: true
        },
        {
          headers: {
            Authorization: `Bearer ${localStorage.getItem('token')}`,
            'Content-Type': 'application/json'
          }
        }
      );

      if (response.data.success) {
        setSyncId(response.data.syncId);
      } else {
        throw new Error(response.data.message);
      }
    } catch (err) {
      console.error('Erreur démarrage sync:', err);
      setError(err.response?.data?.message || err.message);
      setSyncing(false);
    }
  };

  return (
    <div className="sync-database-container">
      <div className="card">
        <div className="card-header">
          <h2>🔄 Synchronisation Base de Données</h2>
          <p className="text-muted">Atlas (Production) → Docker (Local)</p>
        </div>

        <div className="card-body">
          {/* Configuration */}
          {config && (
            <div className="config-section mb-4">
              <h5>Configuration</h5>
              <div className="row">
                <div className="col-md-6">
                  <div className={`alert ${config.config.mongoLive.configured ? 'alert-success' : 'alert-danger'}`}>
                    <strong>Source (Atlas):</strong><br />
                    {config.config.mongoLive.configured ? '✅ Configuré' : '❌ Non configuré'}
                  </div>
                </div>
                <div className="col-md-6">
                  <div className={`alert ${config.config.mongoUri.configured ? 'alert-success' : 'alert-danger'}`}>
                    <strong>Destination (Docker):</strong><br />
                    {config.config.mongoUri.configured ? '✅ Configuré' : '❌ Non configuré'}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Avertissement */}
          <div className="alert alert-warning">
            <strong>⚠️ ATTENTION:</strong>
            <ul className="mb-0 mt-2">
              <li>Cette opération <strong>ÉCRASE</strong> complètement la BDD locale</li>
              <li>Un backup automatique sera créé avant l'écrasement</li>
              <li>L'opération peut prendre plusieurs minutes</li>
              <li>Ne fermez pas la page pendant la synchronisation</li>
            </ul>
          </div>

          {/* Bouton de synchronisation */}
          <div className="text-center mb-4">
            <button
              onClick={startSync}
              disabled={syncing || !config?.peutSynchroniser}
              className="btn btn-primary btn-lg"
            >
              {syncing ? (
                <>
                  <span className="spinner-border spinner-border-sm me-2"></span>
                  Synchronisation en cours...
                </>
              ) : (
                '🚀 Lancer la synchronisation'
              )}
            </button>
          </div>

          {/* Barre de progression */}
          {syncing && (
            <div className="progress-section">
              <div className="mb-2">
                <strong>Progression: {progress}%</strong>
                {currentCollection && (
                  <span className="text-muted ms-2">
                    (Collection: {currentCollection})
                  </span>
                )}
              </div>
              <div className="progress" style={{ height: '30px' }}>
                <div
                  className="progress-bar progress-bar-striped progress-bar-animated"
                  role="progressbar"
                  style={{ width: `${progress}%` }}
                >
                  {progress}%
                </div>
              </div>
            </div>
          )}

          {/* Résultat */}
          {result && result.status === 'termine' && (
            <div className="alert alert-success mt-4">
              <h5>✅ Synchronisation terminée avec succès !</h5>
              <hr />
              <div className="row">
                <div className="col-md-4">
                  <strong>Collections:</strong><br />
                  {result.stats.collections.reussies} / {result.stats.collections.total}
                </div>
                <div className="col-md-4">
                  <strong>Documents:</strong><br />
                  {result.stats.documents.copies.toLocaleString()}
                </div>
                <div className="col-md-4">
                  <strong>Durée:</strong><br />
                  {result.resultat.duree}s
                </div>
              </div>
              {result.resultat.backupName && (
                <div className="mt-3">
                  <small className="text-muted">
                    Backup créé: {result.resultat.backupName}
                  </small>
                </div>
              )}
            </div>
          )}

          {/* Erreur */}
          {error && (
            <div className="alert alert-danger mt-4">
              <strong>❌ Erreur:</strong><br />
              {error}
            </div>
          )}
        </div>
      </div>

      {/* Style */}
      <style jsx>{`
        .sync-database-container {
          max-width: 900px;
          margin: 0 auto;
          padding: 20px;
        }
        .card {
          box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }
        .card-header {
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          color: white;
          padding: 20px;
        }
        .card-header h2 {
          margin: 0;
          font-size: 24px;
        }
        .progress-section {
          background: #f8f9fa;
          padding: 20px;
          border-radius: 8px;
        }
      `}</style>
    </div>
  );
};

export default SyncDatabase;
```

### Vue.js Alternative

Si vous utilisez Vue.js, créez `frontend/src/components/Admin/SyncDatabase.vue`:

```vue
<template>
  <div class="sync-database">
    <div class="card">
      <div class="card-header">
        <h2>🔄 Synchronisation Base de Données</h2>
        <p>Atlas (Production) → Docker (Local)</p>
      </div>

      <div class="card-body">
        <!-- Configuration -->
        <div v-if="config" class="config-section">
          <h5>Configuration</h5>
          <div class="alert" :class="config.peutSynchroniser ? 'alert-success' : 'alert-danger'">
            {{ config.message }}
          </div>
        </div>

        <!-- Avertissement -->
        <div class="alert alert-warning">
          <strong>⚠️ ATTENTION:</strong> Cette opération ÉCRASE la BDD locale
        </div>

        <!-- Bouton -->
        <button
          @click="startSync"
          :disabled="syncing || !config?.peutSynchroniser"
          class="btn btn-primary"
        >
          {{ syncing ? 'Synchronisation en cours...' : '🚀 Lancer la synchronisation' }}
        </button>

        <!-- Progression -->
        <div v-if="syncing" class="progress mt-3">
          <div
            class="progress-bar"
            :style="{ width: progress + '%' }"
          >
            {{ progress }}%
          </div>
        </div>

        <!-- Résultat -->
        <div v-if="result" class="alert alert-success mt-3">
          ✅ Synchronisation terminée !
          <div>Documents copiés: {{ result.stats.documents.copies }}</div>
        </div>

        <!-- Erreur -->
        <div v-if="error" class="alert alert-danger mt-3">
          ❌ {{ error }}
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import axios from 'axios';

export default {
  name: 'SyncDatabase',
  data() {
    return {
      config: null,
      syncing: false,
      progress: 0,
      syncId: null,
      result: null,
      error: null,
      pollInterval: null
    };
  },
  mounted() {
    this.checkConfig();
  },
  beforeUnmount() {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
    }
  },
  methods: {
    async checkConfig() {
      try {
        const response = await axios.get('/api/admin/sync/check-config', {
          headers: {
            Authorization: `Bearer ${localStorage.getItem('token')}`
          }
        });
        this.config = response.data;
      } catch (err) {
        this.error = 'Erreur de configuration';
      }
    },

    async startSync() {
      if (!confirm('⚠️ Voulez-vous vraiment écraser la BDD locale ?')) {
        return;
      }

      try {
        this.syncing = true;
        this.error = null;
        this.result = null;

        const response = await axios.post(
          '/api/admin/sync/start',
          {
            avecBackup: true,
            viderAvant: true,
            copierIndexes: true
          },
          {
            headers: {
              Authorization: `Bearer ${localStorage.getItem('token')}`
            }
          }
        );

        this.syncId = response.data.syncId;
        this.pollProgress();
      } catch (err) {
        this.error = err.response?.data?.message || err.message;
        this.syncing = false;
      }
    },

    pollProgress() {
      this.pollInterval = setInterval(async () => {
        try {
          const response = await axios.get(
            `/api/admin/sync/status/${this.syncId}`,
            {
              headers: {
                Authorization: `Bearer ${localStorage.getItem('token')}`
              }
            }
          );

          const data = response.data;
          this.progress = data.progression;

          if (data.status === 'termine' || data.status === 'erreur') {
            clearInterval(this.pollInterval);
            this.syncing = false;
            this.result = data;
          }
        } catch (err) {
          console.error('Erreur polling:', err);
        }
      }, 2000);
    }
  }
};
</script>
```

## ✅ Checklist d'intégration

- [ ] Routes ajoutées dans `server.js`
- [ ] Serveur redémarré
- [ ] Test avec Postman réussi
- [ ] Composant frontend créé
- [ ] Authentification admin vérifiée
- [ ] Variables d'environnement configurées
- [ ] Docker MongoDB lancé
- [ ] Premier test de synchronisation effectué

## 🔒 Sécurité - Important !

Renforcez la protection des routes de sync dans `routes/adminSyncRoutes.js`:

```javascript
// Middleware de sécurité renforcé
const protectSync = (req, res, next) => {
  // Vérifier que l'utilisateur est admin
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({
      success: false,
      message: 'Accès refusé - Droits administrateur requis'
    });
  }

  // Log de sécurité
  console.log(`🔐 Sync BDD demandée par: ${req.user.email} (${req.ip})`);

  next();
};

// Appliquer à toutes les routes
router.use(protectSync);
```

## 📞 Support

Pour toute question, consultez la documentation complète dans `scripts/README_SYNC_BDD.md`.
