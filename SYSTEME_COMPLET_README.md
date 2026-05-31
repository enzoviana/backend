# 🎯 Système Complet - Gestion de BDD et Documents

## 📦 Résumé du système

Vous disposez maintenant de **2 systèmes puissants** :

### 1. 🔄 Synchronisation BDD (Atlas ↔ Docker)
Copie intégrale de votre base MongoDB Atlas vers votre MongoDB Docker local

### 2. 📁 Migration Documents (Cloudinary → MongoDB)
Transfert de tous vos documents Cloudinary vers votre base de données MongoDB

---

## 🚀 Démarrage rapide

### Option A : Synchroniser votre BDD Atlas → Docker

```bash
cd backend
npm run sync:databases
```

**Résultat :** Votre BDD locale Docker contiendra exactement les mêmes données que votre BDD Atlas.

### Option B : Migrer vos documents Cloudinary → MongoDB

```bash
cd backend
npm run migrate:cloudinary
```

**Résultat :** Tous vos documents Cloudinary seront stockés dans une collection `documents` dans MongoDB.

---

## 📂 Fichiers créés

### 🔄 Système de Synchronisation BDD

```
backend/
├── scripts/
│   ├── syncDatabases.js              # Script principal de synchronisation
│   ├── README_SYNC_BDD.md            # Documentation complète
│   └── TEST_SYNC_QUICK.md            # Guide de test rapide
├── controllers/
│   └── adminSyncController.js        # Contrôleur API pour la sync
├── routes/
│   └── adminSyncRoutes.js            # Routes API
├── INTEGRATION_SYNC_BDD.md           # Guide d'intégration
└── package.json                      # Script npm ajouté
```

### 📁 Système de Migration Documents

```
backend/
├── models/
│   └── Document.js                   # Modèle MongoDB pour les documents
├── scripts/
│   ├── migrateCloudinaryToDatabase.js # Script de migration
│   ├── verifyMigration.js            # Script de vérification
│   ├── README_MIGRATION.md           # Documentation complète
│   └── QUICK_START.md                # Guide de démarrage rapide
├── controllers/
│   └── documentController.js         # Contrôleur API pour les documents
├── routes/
│   └── documentRoutes.js             # Routes API pour les documents
├── utils/
│   └── documentHelper.js             # Fonctions utilitaires
├── INTEGRATION_DOCUMENTS.md          # Guide d'intégration
└── package.json                      # Scripts npm ajoutés
```

---

## 🎯 Cas d'usage recommandés

### Scénario 1 : Développement local avec données de production

**Objectif :** Travailler localement avec des données réelles sans risque

**Étapes :**
```bash
# 1. Synchroniser la BDD
npm run sync:databases

# 2. Lancer votre serveur local
npm start

# 3. Développer et tester localement
```

**Avantages :**
- ✅ Données réelles pour tester
- ✅ Pas de risque pour la production
- ✅ Performance locale optimale
- ✅ Travail hors-ligne possible

### Scénario 2 : Migration complète Cloudinary → MongoDB

**Objectif :** Ne plus dépendre de Cloudinary, tout stocker en BDD

**Étapes :**
```bash
# 1. Migrer les documents
npm run migrate:cloudinary

# 2. Vérifier la migration
npm run verify:migration

# 3. Intégrer les routes dans server.js
# (voir INTEGRATION_DOCUMENTS.md)

# 4. Mettre à jour le frontend
# (voir INTEGRATION_DOCUMENTS.md)
```

**Avantages :**
- ✅ Autonomie totale (pas de service tiers)
- ✅ Économies (plus de frais Cloudinary)
- ✅ Performance (pas d'appels externes)
- ✅ Sécurité renforcée

### Scénario 3 : Synchronisation régulière + Documents migrés

**Objectif :** Système complet autonome avec sync régulière

**Étapes :**
```bash
# 1. Synchroniser la BDD Atlas → Docker
npm run sync:databases

# 2. Migrer les documents Cloudinary → MongoDB
npm run migrate:cloudinary

# 3. Planifier des syncs régulières (optionnel)
# Créer un cron job ou utiliser l'API
```

**Avantages :**
- ✅ Base locale toujours à jour
- ✅ Tous les documents en BDD
- ✅ Indépendance totale
- ✅ Backups automatiques

---

## 📋 Scripts NPM disponibles

```json
{
  "scripts": {
    // Synchronisation BDD
    "sync:databases": "node scripts/syncDatabases.js",

    // Migration documents
    "migrate:cloudinary": "node scripts/migrateCloudinaryToDatabase.js",
    "verify:migration": "node scripts/verifyMigration.js"
  }
}
```

---

## 🔌 Routes API disponibles

### Synchronisation BDD

```
GET    /api/admin/sync/check-config      # Vérifier la configuration
POST   /api/admin/sync/start             # Démarrer une sync (async)
GET    /api/admin/sync/status/:syncId    # Vérifier la progression
GET    /api/admin/sync/list              # Liste des syncs
DELETE /api/admin/sync/clean             # Nettoyer les syncs terminées
POST   /api/admin/sync/execute           # Sync bloquante (attend la fin)
```

### Documents

```
GET    /api/documents/:id                # Télécharger un document
GET    /api/documents/:id/view           # Visualiser un document
GET    /api/documents/diagnostiqueur/:id # Documents d'un diagnostiqueur
GET    /api/documents/devis/:id          # Documents d'un devis
GET    /api/documents/mission/:id        # Documents d'une mission
GET    /api/documents/search             # Rechercher des documents
POST   /api/documents/upload             # Upload un nouveau document
PATCH  /api/documents/:id/metadata       # Modifier les métadonnées
DELETE /api/documents/:id                # Supprimer un document
GET    /api/documents/admin/stats        # Statistiques (admin)
```

---

## 🔧 Configuration requise

### Fichier .env

```env
# MongoDB Atlas (Production)
MONGO_LIVE=mongodb+srv://contact_db_use:password@cluster.mongodb.net/dbname

# MongoDB Docker (Local)
MONGO_URI=mongodb://localhost:27017/monbackend

# Cloudinary (pour migration documents)
CLOUDINARY_CLOUD_NAME=your-cloud-name
CLOUDINARY_API_KEY=your-api-key
CLOUDINARY_API_SECRET=your-api-secret
```

---

## 🎨 Intégration dans server.js

```javascript
// Imports
const documentRoutes = require('./routes/documentRoutes');
const adminSyncRoutes = require('./routes/adminSyncRoutes');

// Routes
app.use('/api/documents', documentRoutes);
app.use('/api/admin/sync', adminSyncRoutes);
```

---

## 📊 Commandes utiles

### Vérifier que tout fonctionne

```bash
# 1. Vérifier Docker
docker ps

# 2. Vérifier les variables d'environnement
cat .env | grep MONGO

# 3. Vérifier la connexion Atlas
mongosh "mongodb+srv://contact_db_use:..."

# 4. Vérifier la connexion Docker
mongosh "mongodb://localhost:27017/monbackend"
```

### Tester les systèmes

```bash
# Test sync BDD
npm run sync:databases

# Test migration documents
npm run migrate:cloudinary

# Vérification migration
npm run verify:migration
```

### Monitoring

```bash
# Voir les logs du serveur
npm start

# Voir les logs Docker
docker logs <nom-conteneur-mongodb>

# Voir l'espace utilisé MongoDB
docker exec -it <nom-conteneur> mongosh
> use monbackend
> db.stats()
```

---

## 🔒 Sécurité

**IMPORTANT :** Les routes de synchronisation doivent être protégées !

```javascript
// Dans vos middlewares
const protectAdminOnly = (req, res, next) => {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ message: 'Accès refusé' });
  }
  next();
};

// Appliquer aux routes sensibles
app.use('/api/admin/sync', protectAdminOnly, adminSyncRoutes);
```

---

## 📖 Documentation détaillée

### Synchronisation BDD
- 📘 **README_SYNC_BDD.md** - Documentation complète
- 🚀 **TEST_SYNC_QUICK.md** - Guide de test rapide
- 🔧 **INTEGRATION_SYNC_BDD.md** - Guide d'intégration

### Migration Documents
- 📗 **README_MIGRATION.md** - Documentation complète
- ⚡ **QUICK_START.md** - Guide de démarrage rapide
- 🔧 **INTEGRATION_DOCUMENTS.md** - Guide d'intégration

---

## ✅ Checklist complète

### Installation
- [ ] Variables d'environnement configurées dans `.env`
- [ ] Docker installé et MongoDB actif
- [ ] Dependencies npm installées (`npm install`)

### Synchronisation BDD
- [ ] Routes `adminSyncRoutes` ajoutées dans `server.js`
- [ ] Test ligne de commande réussi (`npm run sync:databases`)
- [ ] Test API Postman réussi
- [ ] Composant frontend créé (optionnel)

### Migration Documents
- [ ] Modèle `Document.js` créé
- [ ] Routes `documentRoutes` ajoutées dans `server.js`
- [ ] Migration initiale effectuée (`npm run migrate:cloudinary`)
- [ ] Vérification réussie (`npm run verify:migration`)
- [ ] Frontend mis à jour pour utiliser les nouvelles routes

---

## 🎯 Prochaines étapes recommandées

### Court terme (aujourd'hui)
1. ✅ Tester la synchronisation BDD
2. ✅ Tester la migration documents
3. ✅ Intégrer les routes dans server.js
4. ✅ Vérifier que tout fonctionne

### Moyen terme (cette semaine)
1. Créer le composant frontend pour la sync BDD
2. Mettre à jour le frontend pour utiliser les documents en BDD
3. Planifier des syncs régulières (cron job)
4. Configurer des backups MongoDB

### Long terme (ce mois)
1. Migrer complètement de Cloudinary vers MongoDB
2. Optimiser les index MongoDB pour la performance
3. Mettre en place un monitoring des syncs
4. Documenter les processus pour l'équipe

---

## 🆘 Support et troubleshooting

### Problème de connexion MongoDB
```bash
# Vérifier Docker
docker ps
docker restart <nom-conteneur-mongodb>

# Vérifier les logs
docker logs <nom-conteneur-mongodb>
```

### Problème de synchronisation
```bash
# Vérifier la configuration
curl http://localhost:3000/api/admin/sync/check-config

# Relancer en mode verbose
NODE_DEBUG=* npm run sync:databases
```

### Problème de migration documents
```bash
# Vérifier Cloudinary
echo $CLOUDINARY_CLOUD_NAME

# Vérifier la migration
npm run verify:migration
```

---

## 🎉 Conclusion

Vous disposez maintenant d'un système complet qui vous permet :

1. **Synchronisation BDD** : Copier Atlas → Docker en un clic
2. **Migration Documents** : Stocker tous vos fichiers en MongoDB
3. **API complète** : Gérer tout depuis le frontend ou Postman
4. **Autonomie** : Ne plus dépendre de services tiers
5. **Sécurité** : Contrôle total sur vos données

**Commencez par :**
```bash
npm run sync:databases
npm run migrate:cloudinary
```

Et consultez les documentations détaillées dans le dossier `scripts/` pour aller plus loin ! 🚀
