# Migration Cloudinary → MongoDB

Ce guide explique comment migrer tous les documents stockés sur Cloudinary vers la base de données MongoDB.

## 📋 Vue d'ensemble

Le script de migration `migrateCloudinaryToDatabase.js` permet de :
- ✅ Télécharger tous les documents depuis Cloudinary
- ✅ Les stocker dans une nouvelle collection `documents` dans MongoDB
- ✅ Conserver toutes les métadonnées (dates, statuts, relations)
- ✅ Maintenir la traçabilité avec les public_id Cloudinary originaux
- ✅ Supporter tous les types de documents (PDF, images, documents Office, archives)

## 🗂️ Types de documents migrés

### Diagnostiqueur
- Documents administratifs (KBIS, assurances RC/décennale)
- Logo d'entreprise
- Photo de profil admin

### Devis
- PDF du devis
- Signature client

### Ordre de Mission
- PDF de consentement
- Fichiers clients (multiples)

## 🚀 Étapes de migration

### 1. Vérifier les prérequis

```bash
# Vérifier que les dépendances sont installées
npm install
```

### 2. Configurer l'environnement

Assurez-vous que votre fichier `.env` contient :

```env
# MongoDB
MONGO_URI=mongodb://localhost:27017/monbackend
# ou
MONGO_LIVE=mongodb+srv://...

# Cloudinary (pour télécharger les documents)
CLOUDINARY_CLOUD_NAME=your-cloud-name
CLOUDINARY_API_KEY=your-api-key
CLOUDINARY_API_SECRET=your-api-secret
```

### 3. Lancer la migration

```bash
cd backend
node scripts/migrateCloudinaryToDatabase.js
```

### 4. Vérifier les résultats

Le script affiche :
- ✅ Nombre de documents traités
- ✅ Nombre de réussites
- ✅ Nombre d'erreurs
- ✅ Statistiques par type de document
- ✅ Espace total utilisé en BDD

Exemple de sortie :
```
🚀 Début de la migration Cloudinary → MongoDB

============================================================
✅ Connecté à MongoDB

📦 MIGRATION DES DIAGNOSTIQUEURS
============================================================
Trouvé 5 diagnostiqueur(s)

📋 Diagnostiqueur: ABC Diagnostics (507f1f77bcf86cd799439011)
📥 Téléchargement: kbis.pdf depuis https://res.cloudinary.com/...
✅ Migré: kbis.pdf (245.32 KB)
...

============================================================
📊 STATISTIQUES DE MIGRATION
============================================================
Total documents traités:    127
✅ Réussis:                 125
⏭️  Déjà existants (skip):   2
❌ Erreurs:                 0

📈 Détails par type:
   - kbis: 5
   - assurance_rc: 5
   - assurance_decennale: 5
   - devis_pdf: 87
   - signature_client: 23
   - fichier_client: 2
============================================================

💾 Espace total utilisé: 45.23 MB pour 125 documents

✅ Migration terminée avec succès !
```

## 📊 Structure de la collection Documents

```javascript
{
  _id: ObjectId,
  nom: "kbis.pdf",
  type: "kbis", // Enum des types de documents
  data: Buffer, // Données binaires du fichier
  contentType: "application/pdf",
  taille: 245320, // en bytes
  extension: "pdf",

  // Traçabilité Cloudinary
  cloudinaryPublicId: "dimotec/1234567890-kbis",
  cloudinaryUrl: "https://res.cloudinary.com/...",

  // Relations
  relatedTo: {
    model: "Diagnostiqueur",
    id: ObjectId("507f1f77bcf86cd799439011"),
    field: "documents"
  },

  // Métadonnées
  metadata: {
    dateExpiration: Date,
    statut: "valide",
    // ...
  },

  dateDepot: Date,
  dateMigration: Date,
  createdAt: Date,
  updatedAt: Date
}
```

## 🔌 API Routes

Après la migration, utilisez les nouvelles routes pour accéder aux documents :

```javascript
// Récupérer un document
GET /api/documents/:id
GET /api/documents/:id/view (visualisation inline)

// Récupérer les documents par entité
GET /api/documents/diagnostiqueur/:id
GET /api/documents/devis/:id
GET /api/documents/mission/:id

// Recherche
GET /api/documents/search?nom=kbis&type=kbis

// Upload (nouveau système)
POST /api/documents/upload

// Statistiques
GET /api/documents/admin/stats
```

## 🛠️ Utilisation dans le code

### Récupérer les documents d'un diagnostiqueur

```javascript
const { getDocumentsDiagnostiqueur } = require('../utils/documentHelper');

// Tous les documents
const documents = await getDocumentsDiagnostiqueur(diagnostiqueurId);

// Filtrer par type
const kbis = await getDocumentsDiagnostiqueur(diagnostiqueurId, { type: 'kbis' });

// Filtrer par field
const docs = await getDocumentsDiagnostiqueur(diagnostiqueurId, { field: 'documents' });
```

### Afficher un document

```javascript
// En Base64 (pour affichage web)
const { getDocumentAsBase64 } = require('../utils/documentHelper');
const doc = await getDocumentAsBase64(documentId);
// doc.dataUrl = "data:application/pdf;base64,JVBERi0xLjQK..."

// En Buffer (pour téléchargement)
const { getDocumentAsBuffer } = require('../utils/documentHelper');
const doc = await getDocumentAsBuffer(documentId);
res.send(doc.buffer);
```

### Sauvegarder un nouveau document

```javascript
const { saveDocument } = require('../utils/documentHelper');

const document = await saveDocument({
  nom: 'nouveau_kbis.pdf',
  type: 'kbis',
  buffer: fileBuffer,
  contentType: 'application/pdf',
  relatedModel: 'Diagnostiqueur',
  relatedId: diagnostiqueurId,
  relatedField: 'documents',
  metadata: {
    dateExpiration: new Date('2025-12-31'),
    statut: 'valide'
  }
});
```

## ⚠️ Points importants

### 1. Idempotence
Le script est idempotent : si vous le relancez, il ne migrera pas deux fois les mêmes documents (détection via `cloudinaryPublicId`).

### 2. Gestion des erreurs
Si un document échoue, le script continue et affiche un rapport complet à la fin.

### 3. Taille des documents
Le stockage direct en BDD convient pour des documents jusqu'à 16 MB (limite BSON MongoDB). Pour des fichiers plus volumineux, le script utilise des Buffers qui peuvent gérer jusqu'à 50 MB.

### 4. Performance
- Le script télécharge les documents un par un pour éviter de surcharger la mémoire
- Temps estimé : ~2-5 secondes par document (selon la taille et la connexion)

## 🔍 Vérification post-migration

### Compter les documents

```javascript
const Document = require('./models/Document');

// Total
const total = await Document.countDocuments();

// Par type
const stats = await Document.aggregate([
  { $group: { _id: '$type', count: { $sum: 1 } } }
]);
```

### Vérifier l'espace utilisé

```bash
# Dans MongoDB shell
use monbackend
db.documents.stats()
```

## 📝 Intégration avec le server.js

Ajoutez les routes dans `server.js` :

```javascript
const documentRoutes = require('./routes/documentRoutes');

// ...

app.use('/api/documents', documentRoutes);
```

## 🚨 Rollback (retour en arrière)

Si vous souhaitez supprimer tous les documents migrés :

```javascript
// ⚠️ ATTENTION : Ceci supprime TOUTES les données de la collection !
const Document = require('./models/Document');
await Document.deleteMany({});
```

## 📞 Support

Pour toute question ou problème :
1. Vérifier les logs du script
2. Vérifier la connexion à MongoDB
3. Vérifier les credentials Cloudinary
4. Vérifier l'espace disque disponible

## 🎯 Prochaines étapes

Après la migration :
1. ✅ Mettre à jour le code frontend pour utiliser les nouvelles routes
2. ✅ Tester les uploads de nouveaux documents
3. ✅ Supprimer les anciens uploads Cloudinary (optionnel)
4. ✅ Configurer des backups MongoDB réguliers
