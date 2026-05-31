# 📝 Instructions d'intégration des routes Documents

## 1️⃣ Ajouter les routes dans server.js

Dans le fichier `/Users/enzo/Desktop/DataFuse/Dimotec/backend/server.js`, ajoutez l'import et la route :

### Étape 1 : Ajouter l'import (ligne ~13, avec les autres imports de routes)

```javascript
const documentRoutes = require('./routes/documentRoutes');
```

### Étape 2 : Ajouter la route (ligne ~56, avec les autres app.use)

```javascript
app.use('/api/documents', documentRoutes);
```

### Exemple complet :

```javascript
// ... autres imports ...
const adminRoutes = require('./routes/adminRoutes');
const agencyRoutes = require('./routes/agencyRoutes');
const devisRoutes = require('./routes/devisRoutes');
const dashboardRoutes = require('./routes/dashboardRoutes');
const chatbotRoutes = require('./routes/chatbotRoutes');
const diagnostiqueurRoutes = require('./routes/diagnostiqueurRoutes');
const stripeRoutes = require('./routes/stripeRoutes');
const documentRoutes = require('./routes/documentRoutes'); // ← NOUVEAU

// ... configuration CORS, middlewares, etc ...

// Routes
app.use('/api/admin', adminRoutes);
app.use('/api/agency', agencyRoutes);
app.use('/api/client', devisRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/devis', devisRoutes);
app.use('/api/chatbot', chatbotRoutes);
app.use('/api/diagnostiqueur', diagnostiqueurRoutes);
app.use('/api/documents', documentRoutes); // ← NOUVEAU
```

## 2️⃣ Tester les routes

Après avoir ajouté les routes et redémarré le serveur :

```bash
# Démarrer le serveur
npm start

# Dans un autre terminal, tester les routes
curl http://localhost:3000/api/documents/admin/stats
```

## 3️⃣ Exemples d'utilisation dans vos contrôleurs existants

### Exemple 1 : Récupérer les documents d'un diagnostiqueur

Dans `controllers/diagnostiqueurController.js` ou similaire :

```javascript
const { getDocumentsDiagnostiqueur } = require('../utils/documentHelper');

// Dans une route GET /api/diagnostiqueur/:id/documents
exports.getDocuments = async (req, res) => {
  try {
    const { id } = req.params;
    const documents = await getDocumentsDiagnostiqueur(id);

    res.json({
      success: true,
      documents: documents.map(doc => ({
        id: doc._id,
        nom: doc.nom,
        type: doc.type,
        taille: doc.getTailleFormatee(),
        dateDepot: doc.dateDepot
      }))
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
```

### Exemple 2 : Upload d'un nouveau document

```javascript
const { saveDocument } = require('../utils/documentHelper');

// Route POST /api/diagnostiqueur/:id/upload-document
exports.uploadDocument = async (req, res) => {
  try {
    const { id } = req.params;
    const file = req.file; // Via multer

    const document = await saveDocument({
      nom: file.originalname,
      type: req.body.type, // 'kbis', 'assurance_rc', etc.
      buffer: file.buffer,
      contentType: file.mimetype,
      relatedModel: 'Diagnostiqueur',
      relatedId: id,
      relatedField: 'documents',
      metadata: {
        dateExpiration: req.body.dateExpiration,
        statut: 'en_attente'
      }
    });

    res.status(201).json({
      success: true,
      message: 'Document uploadé avec succès',
      documentId: document._id
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
```

### Exemple 3 : Récupérer le PDF d'un devis

```javascript
const { getDocumentsDevis } = require('../utils/documentHelper');

// Dans une route GET /api/devis/:id/pdf
exports.getPDF = async (req, res) => {
  try {
    const { id } = req.params;
    const documents = await getDocumentsDevis(id);

    const pdfDoc = documents.find(doc => doc.type === 'devis_pdf');

    if (!pdfDoc) {
      return res.status(404).json({ message: 'PDF non trouvé' });
    }

    // Renvoyer le PDF
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${pdfDoc.nom}"`,
    });

    res.send(pdfDoc.data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
```

## 4️⃣ Mise à jour du frontend

### Afficher une image depuis la BDD

```javascript
// React/Vue/Angular
const afficherImage = async (documentId) => {
  try {
    const response = await fetch(`/api/documents/${documentId}?format=base64`);
    const data = await response.json();

    // data.dataUrl = "data:image/png;base64,iVBORw0KGgo..."
    imageElement.src = data.dataUrl;
  } catch (error) {
    console.error('Erreur chargement image:', error);
  }
};
```

### Télécharger un document

```javascript
const telechargerDocument = async (documentId, nomFichier) => {
  try {
    const response = await fetch(`/api/documents/${documentId}`);
    const blob = await response.blob();

    // Créer un lien de téléchargement
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = nomFichier;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
  } catch (error) {
    console.error('Erreur téléchargement:', error);
  }
};
```

### Visualiser un PDF dans un nouvel onglet

```javascript
const visualiserPDF = async (documentId) => {
  try {
    const response = await fetch(`/api/documents/${documentId}/view`);
    const blob = await response.blob();

    const url = window.URL.createObjectURL(blob);
    window.open(url, '_blank');
  } catch (error) {
    console.error('Erreur visualisation PDF:', error);
  }
};
```

### Uploader un nouveau document

```javascript
const uploaderDocument = async (file, type, relatedModel, relatedId) => {
  try {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('nom', file.name);
    formData.append('type', type);
    formData.append('relatedModel', relatedModel);
    formData.append('relatedId', relatedId);
    formData.append('relatedField', 'documents');
    formData.append('metadata', JSON.stringify({
      dateExpiration: '2025-12-31',
      statut: 'en_attente'
    }));

    const response = await fetch('/api/documents/upload', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`
      },
      body: formData
    });

    const data = await response.json();
    console.log('Document uploadé:', data);
  } catch (error) {
    console.error('Erreur upload:', error);
  }
};
```

## 5️⃣ Avantages de ce système

✅ **Autonomie** : Tous vos documents sont dans votre BDD, pas chez un tiers
✅ **Performance** : Pas d'appels externes à Cloudinary
✅ **Sécurité** : Contrôle total sur l'accès aux documents
✅ **Coût** : Pas de frais Cloudinary pour le stockage et la bande passante
✅ **Simplicité** : Une seule source de vérité (MongoDB)
✅ **Traçabilité** : Tous les documents sont liés à leur entité (Diagnostiqueur, Devis, etc.)

## 6️⃣ Checklist d'intégration

- [ ] Ajouter l'import dans server.js
- [ ] Ajouter la route dans server.js
- [ ] Redémarrer le serveur
- [ ] Tester avec `curl http://localhost:3000/api/documents/admin/stats`
- [ ] Lancer la migration avec `npm run migrate:cloudinary`
- [ ] Vérifier avec `npm run verify:migration`
- [ ] Mettre à jour le frontend pour utiliser les nouvelles routes
- [ ] Tester l'upload de nouveaux documents
- [ ] Configurer les backups MongoDB

## ❓ Questions fréquentes

**Q: Dois-je modifier mes modèles existants (Diagnostiqueur, Devis, etc.) ?**
R: Non ! Le système fonctionne en parallèle. Vous pouvez garder les références Cloudinary pour l'instant.

**Q: Comment gérer les nouveaux uploads ?**
R: Utilisez la route `POST /api/documents/upload` au lieu de Cloudinary.

**Q: Puis-je continuer à utiliser Cloudinary ?**
R: Oui, les deux systèmes peuvent coexister.

**Q: Quelle est la limite de taille des fichiers ?**
R: 50 MB par défaut (configurable dans multer).

## 📞 Support

Pour plus de détails, consultez :
- `scripts/README_MIGRATION.md` - Documentation complète
- `scripts/QUICK_START.md` - Guide de démarrage rapide
