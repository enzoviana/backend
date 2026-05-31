# 🚀 Guide de démarrage rapide - Migration Cloudinary → MongoDB

## Résumé

Ce système permet de transférer tous vos documents Cloudinary dans votre base de données MongoDB, vous donnant un contrôle total sur vos fichiers sans dépendre d'un service tiers.

## ⚡ Migration en 3 étapes

### 1️⃣ Préparer l'environnement

```bash
cd backend
npm install
```

Vérifiez votre fichier `.env` :
```env
MONGO_URI=mongodb://localhost:27017/monbackend
CLOUDINARY_CLOUD_NAME=votre-cloud-name
CLOUDINARY_API_KEY=votre-api-key
CLOUDINARY_API_SECRET=votre-api-secret
```

### 2️⃣ Lancer la migration

```bash
npm run migrate:cloudinary
```

Le script va :
- ✅ Se connecter à Cloudinary et MongoDB
- ✅ Télécharger tous les documents depuis Cloudinary
- ✅ Les stocker dans la collection `documents` de MongoDB
- ✅ Afficher un rapport détaillé

**Temps estimé :** 2-5 secondes par document

### 3️⃣ Vérifier la migration

```bash
npm run verify:migration
```

Ce script affiche :
- ✅ Nombre de documents dans Cloudinary vs MongoDB
- ✅ Statistiques par type de document
- ✅ Vérification de l'intégrité des données
- ✅ Détection de documents orphelins

## 📊 Que se passe-t-il ?

### Avant (Cloudinary)
```
Diagnostiqueur.documents[0].url = "https://res.cloudinary.com/xxx/..."
Devis.pdfUrl = "https://res.cloudinary.com/xxx/..."
```

### Après (MongoDB)
```javascript
// Nouvelle collection "documents"
{
  _id: "507f...",
  nom: "kbis.pdf",
  type: "kbis",
  data: Buffer, // Fichier stocké en BDD
  relatedTo: {
    model: "Diagnostiqueur",
    id: "507f..."
  }
}
```

## 🔌 Utiliser les nouveaux documents

### Dans le backend (server.js)

Ajoutez les routes :
```javascript
const documentRoutes = require('./routes/documentRoutes');
app.use('/api/documents', documentRoutes);
```

### Dans vos contrôleurs

```javascript
const { getDocumentsDiagnostiqueur } = require('../utils/documentHelper');

// Récupérer tous les documents d'un diagnostiqueur
const documents = await getDocumentsDiagnostiqueur(diagnostiqueurId);

// Récupérer uniquement les KBIS
const kbis = await getDocumentsDiagnostiqueur(diagnostiqueurId, { type: 'kbis' });
```

### Dans le frontend

```javascript
// Télécharger un document
fetch(`/api/documents/${documentId}`)
  .then(res => res.blob())
  .then(blob => {
    const url = URL.createObjectURL(blob);
    window.open(url);
  });

// Afficher une image en Base64
fetch(`/api/documents/${documentId}?format=base64`)
  .then(res => res.json())
  .then(data => {
    imageElement.src = data.dataUrl;
  });
```

## 📋 Routes API disponibles

```
GET    /api/documents/:id              - Télécharger un document
GET    /api/documents/:id/view         - Visualiser un document
GET    /api/documents/diagnostiqueur/:id - Documents d'un diagnostiqueur
GET    /api/documents/devis/:id        - Documents d'un devis
GET    /api/documents/mission/:id      - Documents d'une mission
GET    /api/documents/search           - Rechercher des documents
POST   /api/documents/upload           - Upload un nouveau document
PATCH  /api/documents/:id/metadata     - Modifier les métadonnées
DELETE /api/documents/:id              - Supprimer un document
GET    /api/documents/admin/stats      - Statistiques (admin)
```

## ✅ Vérification de succès

Après la migration, vous devriez voir :

```
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
   - devis_pdf: 87
   ...
============================================================

💾 Espace total utilisé: 45.23 MB pour 125 documents

✅ Migration terminée avec succès !
```

## 🔄 Re-migration

Le script est **idempotent** : vous pouvez le relancer sans problème.
- Les documents déjà migrés seront détectés et ignorés
- Seuls les nouveaux documents seront ajoutés

## ❓ FAQ

### Q: Puis-je continuer à utiliser Cloudinary après la migration ?
**R:** Oui ! Les deux systèmes peuvent coexister. La migration ne supprime rien de Cloudinary.

### Q: Comment migrer de nouveaux documents ajoutés après la première migration ?
**R:** Relancez simplement `npm run migrate:cloudinary`. Le script détectera et migrera uniquement les nouveaux documents.

### Q: Que faire si j'ai des erreurs ?
**R:** Vérifiez :
1. Connexion MongoDB active
2. Credentials Cloudinary valides
3. Espace disque disponible
4. Logs du script pour plus de détails

### Q: Puis-je annuler la migration ?
**R:** Oui, supprimez simplement la collection :
```javascript
const Document = require('./models/Document');
await Document.deleteMany({});
```

## 🎯 Prochaines étapes recommandées

1. ✅ Migrer tous les documents
2. ✅ Vérifier avec `npm run verify:migration`
3. ✅ Intégrer les routes dans server.js
4. ✅ Mettre à jour le frontend
5. ✅ Tester les uploads de nouveaux documents
6. ✅ Configurer des backups MongoDB réguliers

## 📞 Support

Pour plus de détails, consultez le fichier `README_MIGRATION.md` dans le même dossier.
