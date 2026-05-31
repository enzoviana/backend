# 🔄 Synchronisation MongoDB Atlas ↔ Docker Local

Ce système permet de copier intégralement votre base de données MongoDB Atlas (production) vers votre MongoDB Docker local (développement).

## 📋 Vue d'ensemble

### Source (MONGO_LIVE)
- MongoDB Atlas (Cloud)
- Base de données de production
- URI: `mongodb+srv://contact_db_use...`

### Destination (MONGO_URI)
- MongoDB sur Docker (Local)
- Base de données de développement
- URI: `mongodb://localhost:27017/monbackend`

## ⚠️ ATTENTION

**Cette opération ÉCRASE complètement la base de données locale !**
- ✅ Un backup automatique est créé avant l'écrasement
- ✅ Vous pouvez désactiver le backup si nécessaire
- ⚠️ Toutes les données locales seront remplacées par les données Atlas

## 🚀 Méthode 1 : Script en ligne de commande

### Utilisation basique

```bash
cd backend
npm run sync:databases
```

Le script vous demandera confirmation avant de procéder :
```
⚠️  Voulez-vous vraiment écraser la BDD locale avec la BDD Atlas ? (oui/non):
```

Tapez `oui` pour confirmer.

### Sortie attendue

```
🚀 SYNCHRONISATION MONGO_LIVE → MONGO_URI

⚠️  ATTENTION: Cette opération va ÉCRASER la base locale !

======================================================================

🔌 Création des connexions aux bases de données...

📡 Source (Atlas):       mongodb+srv://contact_db_use...
💾 Destination (Docker): mongodb://localhost:27017/monbackend

✅ Connecté à MongoDB Atlas (source)
✅ Connecté à MongoDB Docker (destination)

💾 Création d'un backup de la BDD locale...
✅ Backup créé: backup_2025-01-15T10-30-45-123Z (1247 documents)

🗑️  Suppression des collections de la destination...
  ✓ Supprimé: clients
  ✓ Supprimé: devis
  ✓ Supprimé: diagnostiqueurs
  ...
✅ Destination vidée

📦 12 collection(s) à copier:

   - clients
   - devis
   - diagnostiqueurs
   - ordremissions
   - packs
   - diagnostics
   - supplements
   - agencies
   - employes
   - configurations
   - factures
   - documents

🔄 Copie des collections...

[1/12] clients
  ✅ clients: 234 documents copiés
[2/12] devis
  ✅ devis: 567 documents copiés
[3/12] diagnostiqueurs
  ✅ diagnostiqueurs: 45 documents copiés
...

======================================================================
📊 RAPPORT DE SYNCHRONISATION
======================================================================
⏱️  Durée totale: 12.45 secondes

📚 Collections:
   Total:      12
   ✅ Réussies: 12
   ❌ Erreurs:  0

📄 Documents:
   Total:      1534
   ✅ Copiés:   1534
   ❌ Erreurs:  0

📋 Détails par collection:
   ✅ clients: 234/234 documents
   ✅ devis: 567/567 documents
   ✅ diagnostiqueurs: 45/45 documents
   ...
======================================================================
✅ SYNCHRONISATION TERMINÉE AVEC SUCCÈS !
======================================================================

👋 Déconnexion de MongoDB Atlas
👋 Déconnexion de MongoDB Docker

🎉 Script terminé
```

## 🌐 Méthode 2 : Via API (Postman ou Frontend)

### 1. Vérifier la configuration

**GET** `/api/admin/sync/check-config`

Headers:
```
Authorization: Bearer <votre-token-admin>
```

Réponse:
```json
{
  "success": true,
  "config": {
    "mongoLive": {
      "configured": true,
      "uri": "mongodb+srv://contact_db_use..."
    },
    "mongoUri": {
      "configured": true,
      "uri": "mongodb://localhost:27017/monbackend"
    }
  },
  "peutSynchroniser": true,
  "message": "Configuration OK - Synchronisation possible"
}
```

### 2. Démarrer la synchronisation (Mode asynchrone - recommandé)

**POST** `/api/admin/sync/start`

Headers:
```
Authorization: Bearer <votre-token-admin>
Content-Type: application/json
```

Body (optionnel):
```json
{
  "avecBackup": true,
  "viderAvant": true,
  "copierIndexes": true
}
```

Réponse immédiate:
```json
{
  "success": true,
  "message": "Synchronisation démarrée",
  "syncId": "sync_1705315845123",
  "avertissement": "Cette opération peut prendre plusieurs minutes selon la taille de la base"
}
```

### 3. Vérifier la progression

**GET** `/api/admin/sync/status/:syncId`

Headers:
```
Authorization: Bearer <votre-token-admin>
```

Réponse pendant l'exécution:
```json
{
  "success": true,
  "syncId": "sync_1705315845123",
  "status": "en_cours",
  "progression": 65,
  "collectionActuelle": "devis",
  "debut": "2025-01-15T10:30:45.123Z",
  "stats": {
    "collections": {
      "total": 12,
      "reussies": 7,
      "erreurs": 0
    },
    "documents": {
      "total": 1234,
      "copies": 890,
      "erreurs": 0
    }
  }
}
```

Réponse une fois terminée:
```json
{
  "success": true,
  "syncId": "sync_1705315845123",
  "status": "termine",
  "progression": 100,
  "debut": "2025-01-15T10:30:45.123Z",
  "fin": "2025-01-15T10:31:02.568Z",
  "stats": {
    "collections": {
      "total": 12,
      "reussies": 12,
      "erreurs": 0
    },
    "documents": {
      "total": 1534,
      "copies": 1534,
      "erreurs": 0
    }
  },
  "resultat": {
    "success": true,
    "stats": { ... },
    "backupName": "backup_2025-01-15T10-30-45-123Z",
    "duree": "17.45"
  }
}
```

### 4. Mode bloquant (attend la fin - déconseillé)

**POST** `/api/admin/sync/execute`

⚠️ **ATTENTION**: Cette route peut prendre plusieurs minutes à répondre !

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

Réponse (après plusieurs minutes):
```json
{
  "success": true,
  "message": "Synchronisation terminée avec succès",
  "stats": {
    "collections": {
      "total": 12,
      "reussies": 12,
      "erreurs": 0
    },
    "documents": {
      "total": 1534,
      "copies": 1534,
      "erreurs": 0
    }
  },
  "backupName": "backup_2025-01-15T10-30-45-123Z",
  "duree": "17.45"
}
```

## 🎨 Exemple d'intégration Frontend (React)

### Composant de synchronisation

```javascript
import { useState } from 'react';

function SyncDatabase() {
  const [syncing, setSyncing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [syncId, setSyncId] = useState(null);
  const [result, setResult] = useState(null);

  const startSync = async () => {
    try {
      setSyncing(true);
      setProgress(0);

      // 1. Démarrer la sync
      const response = await fetch('/api/admin/sync/start', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          avecBackup: true,
          viderAvant: true,
          copierIndexes: true
        })
      });

      const data = await response.json();

      if (!data.success) {
        throw new Error(data.message);
      }

      setSyncId(data.syncId);

      // 2. Vérifier la progression toutes les 2 secondes
      const interval = setInterval(async () => {
        const statusResponse = await fetch(
          `/api/admin/sync/status/${data.syncId}`,
          {
            headers: {
              'Authorization': `Bearer ${localStorage.getItem('token')}`
            }
          }
        );

        const statusData = await statusResponse.json();

        if (statusData.success) {
          setProgress(statusData.progression);

          if (statusData.status === 'termine' || statusData.status === 'erreur') {
            clearInterval(interval);
            setSyncing(false);
            setResult(statusData);
          }
        }
      }, 2000);

    } catch (error) {
      console.error('Erreur:', error);
      setSyncing(false);
      alert('Erreur: ' + error.message);
    }
  };

  return (
    <div className="sync-database">
      <h2>Synchronisation Base de Données</h2>

      <div className="alert alert-warning">
        ⚠️ Cette opération écrase la BDD locale avec les données Atlas
      </div>

      <button
        onClick={startSync}
        disabled={syncing}
        className="btn btn-primary"
      >
        {syncing ? 'Synchronisation en cours...' : 'Synchroniser Atlas → Local'}
      </button>

      {syncing && (
        <div className="progress-bar">
          <div className="progress" style={{ width: `${progress}%` }}>
            {progress}%
          </div>
        </div>
      )}

      {result && result.status === 'termine' && (
        <div className="alert alert-success">
          ✅ Synchronisation terminée !
          <ul>
            <li>Collections: {result.stats.collections.reussies}/{result.stats.collections.total}</li>
            <li>Documents: {result.stats.documents.copies}</li>
            <li>Durée: {result.resultat.duree}s</li>
          </ul>
        </div>
      )}
    </div>
  );
}

export default SyncDatabase;
```

## 📝 Options de synchronisation

### avecBackup (boolean, défaut: true)
- `true`: Crée un backup de la BDD locale avant l'écrasement
- `false`: Pas de backup (dangereux !)

### viderAvant (boolean, défaut: true)
- `true`: Vide complètement la BDD locale avant la copie
- `false`: Fusionne avec les données existantes (peut créer des doublons)

### copierIndexes (boolean, défaut: true)
- `true`: Copie aussi les index de la BDD Atlas
- `false`: Ne copie que les données

## 🔧 Configuration requise

Dans votre fichier `.env` :

```env
# Base de données Atlas (source)
MONGO_LIVE=mongodb+srv://contact_db_use:password@cluster.mongodb.net/dbname

# Base de données Docker locale (destination)
MONGO_URI=mongodb://localhost:27017/monbackend
```

## 🛡️ Sécurité

**IMPORTANT**: Ces routes doivent être protégées !

Les routes de synchronisation utilisent le middleware `protect` qui doit vérifier :
1. L'utilisateur est authentifié
2. L'utilisateur est un administrateur
3. L'utilisateur a les droits de gestion de la BDD

Exemple de middleware de sécurité renforcé:

```javascript
const protectSyncRoutes = (req, res, next) => {
  // 1. Vérifier l'authentification
  if (!req.user) {
    return res.status(401).json({ message: 'Non authentifié' });
  }

  // 2. Vérifier le rôle admin
  if (req.user.role !== 'admin' && req.user.role !== 'super_admin') {
    return res.status(403).json({ message: 'Accès refusé - Admin requis' });
  }

  // 3. Optionnel: IP whitelist
  const allowedIPs = ['127.0.0.1', '::1'];
  const clientIP = req.ip || req.connection.remoteAddress;

  if (!allowedIPs.includes(clientIP)) {
    console.warn(`⚠️  Tentative de sync depuis IP non autorisée: ${clientIP}`);
    return res.status(403).json({ message: 'IP non autorisée' });
  }

  next();
};
```

## 📊 Cas d'usage

### 1. Développement local
Récupérer une copie de la production pour développer/tester localement
```bash
npm run sync:databases
```

### 2. Tests avec données réelles
Tester une nouvelle fonctionnalité avec les vraies données
```bash
npm run sync:databases
# Ensuite lancer vos tests
npm test
```

### 3. Debugging
Reproduire un bug de production localement
```bash
npm run sync:databases
# Ensuite débugger localement
```

## ⚡ Performance

Temps estimés (dépend de votre connexion internet):
- Petite base (< 1000 docs): 5-10 secondes
- Base moyenne (1000-10000 docs): 15-30 secondes
- Grande base (> 10000 docs): 1-5 minutes

## 🔍 Troubleshooting

### Erreur: "MONGO_LIVE non défini"
Vérifiez votre fichier `.env`

### Erreur: "Connexion refusée"
Vérifiez que Docker est lancé et que MongoDB tourne

### Erreur: "Timeout"
Votre base Atlas est peut-être trop volumineuse, augmentez le timeout

### Les données ne correspondent pas
Vérifiez que vous utilisez bien la bonne base sur Atlas

## 📦 Package.json

Ajoutez ce script dans `package.json`:

```json
{
  "scripts": {
    "sync:databases": "node scripts/syncDatabases.js"
  }
}
```

## ✅ Checklist avant synchronisation

- [ ] Docker est lancé
- [ ] MongoDB Docker tourne (vérifier avec `docker ps`)
- [ ] Variables MONGO_LIVE et MONGO_URI configurées dans `.env`
- [ ] Vous avez bien compris que la BDD locale sera écrasée
- [ ] Vous êtes authentifié en tant qu'admin

## 🎯 Prochaines étapes

1. Intégrer les routes dans `server.js`
2. Ajouter le bouton de sync dans le dashboard admin
3. Tester avec Postman
4. Configurer des alertes pour les syncs échouées
