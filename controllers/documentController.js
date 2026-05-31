const Document = require('../models/Document');
const {
  getDocumentsByEntity,
  getDocumentsDiagnostiqueur,
  getDocumentsDevis,
  getDocumentsOrdreMission,
  saveDocument,
  deleteDocument,
  updateDocumentMetadata,
  getDocumentsStats,
  getDocumentAsBase64,
  getDocumentAsBuffer,
  searchDocuments
} = require('../utils/documentHelper');

/**
 * @desc    Récupère un document par son ID et le renvoie
 * @route   GET /api/documents/:id
 * @access  Private
 */
exports.getDocument = async (req, res) => {
  try {
    const { id } = req.params;
    const { format = 'buffer' } = req.query; // buffer ou base64

    const document = format === 'base64'
      ? await getDocumentAsBase64(id)
      : await getDocumentAsBuffer(id);

    if (!document) {
      return res.status(404).json({ message: 'Document non trouvé' });
    }

    if (format === 'base64') {
      return res.json(document);
    }

    // Renvoyer le fichier en téléchargement
    res.set({
      'Content-Type': document.contentType,
      'Content-Disposition': `attachment; filename="${document.nom}"`,
      'Content-Length': document.buffer.length
    });

    return res.send(document.buffer);

  } catch (error) {
    console.error('Erreur récupération document:', error);
    res.status(500).json({ message: 'Erreur serveur', error: error.message });
  }
};

/**
 * @desc    Visualise un document dans le navigateur
 * @route   GET /api/documents/:id/view
 * @access  Private
 */
exports.viewDocument = async (req, res) => {
  try {
    const { id } = req.params;
    const document = await getDocumentAsBuffer(id);

    if (!document) {
      return res.status(404).json({ message: 'Document non trouvé' });
    }

    // Renvoyer le fichier pour affichage inline
    res.set({
      'Content-Type': document.contentType,
      'Content-Disposition': `inline; filename="${document.nom}"`,
      'Content-Length': document.buffer.length
    });

    return res.send(document.buffer);

  } catch (error) {
    console.error('Erreur visualisation document:', error);
    res.status(500).json({ message: 'Erreur serveur', error: error.message });
  }
};

/**
 * @desc    Récupère les documents d'un diagnostiqueur
 * @route   GET /api/documents/diagnostiqueur/:id
 * @access  Private
 */
exports.getDocumentsDiagnostiqueur = async (req, res) => {
  try {
    const { id } = req.params;
    const { type, field } = req.query;

    const documents = await getDocumentsDiagnostiqueur(id, { type, field });

    // Ne pas renvoyer les données binaires, juste les métadonnées
    const documentsMetadata = documents.map(doc => ({
      id: doc._id,
      nom: doc.nom,
      type: doc.type,
      contentType: doc.contentType,
      taille: doc.taille,
      tailleFormatee: doc.getTailleFormatee(),
      extension: doc.extension,
      relatedTo: doc.relatedTo,
      metadata: doc.metadata,
      dateDepot: doc.dateDepot,
      createdAt: doc.createdAt
    }));

    res.json({ documents: documentsMetadata, count: documentsMetadata.length });

  } catch (error) {
    console.error('Erreur récupération documents diagnostiqueur:', error);
    res.status(500).json({ message: 'Erreur serveur', error: error.message });
  }
};

/**
 * @desc    Récupère les documents d'un devis
 * @route   GET /api/documents/devis/:id
 * @access  Private
 */
exports.getDocumentsDevis = async (req, res) => {
  try {
    const { id } = req.params;
    const documents = await getDocumentsDevis(id);

    const documentsMetadata = documents.map(doc => ({
      id: doc._id,
      nom: doc.nom,
      type: doc.type,
      contentType: doc.contentType,
      taille: doc.taille,
      tailleFormatee: doc.getTailleFormatee(),
      extension: doc.extension,
      relatedTo: doc.relatedTo,
      dateDepot: doc.dateDepot,
      createdAt: doc.createdAt
    }));

    res.json({ documents: documentsMetadata, count: documentsMetadata.length });

  } catch (error) {
    console.error('Erreur récupération documents devis:', error);
    res.status(500).json({ message: 'Erreur serveur', error: error.message });
  }
};

/**
 * @desc    Récupère les documents d'un ordre de mission
 * @route   GET /api/documents/mission/:id
 * @access  Private
 */
exports.getDocumentsOrdreMission = async (req, res) => {
  try {
    const { id } = req.params;
    const { type } = req.query;

    const documents = await getDocumentsOrdreMission(id, { type });

    const documentsMetadata = documents.map(doc => ({
      id: doc._id,
      nom: doc.nom,
      type: doc.type,
      contentType: doc.contentType,
      taille: doc.taille,
      tailleFormatee: doc.getTailleFormatee(),
      extension: doc.extension,
      relatedTo: doc.relatedTo,
      dateDepot: doc.dateDepot,
      createdAt: doc.createdAt
    }));

    res.json({ documents: documentsMetadata, count: documentsMetadata.length });

  } catch (error) {
    console.error('Erreur récupération documents mission:', error);
    res.status(500).json({ message: 'Erreur serveur', error: error.message });
  }
};

/**
 * @desc    Upload un nouveau document
 * @route   POST /api/documents/upload
 * @access  Private
 */
exports.uploadDocument = async (req, res) => {
  try {
    const { nom, type, relatedModel, relatedId, relatedField, metadata } = req.body;

    if (!req.file) {
      return res.status(400).json({ message: 'Aucun fichier fourni' });
    }

    const document = await saveDocument({
      nom: nom || req.file.originalname,
      type,
      buffer: req.file.buffer,
      contentType: req.file.mimetype,
      relatedModel,
      relatedId,
      relatedField,
      metadata: metadata ? JSON.parse(metadata) : {}
    });

    res.status(201).json({
      message: 'Document uploadé avec succès',
      document: {
        id: document._id,
        nom: document.nom,
        type: document.type,
        taille: document.getTailleFormatee(),
        dateDepot: document.dateDepot
      }
    });

  } catch (error) {
    console.error('Erreur upload document:', error);
    res.status(500).json({ message: 'Erreur serveur', error: error.message });
  }
};

/**
 * @desc    Supprime un document
 * @route   DELETE /api/documents/:id
 * @access  Private
 */
exports.deleteDocument = async (req, res) => {
  try {
    const { id } = req.params;

    const document = await deleteDocument(id);

    if (!document) {
      return res.status(404).json({ message: 'Document non trouvé' });
    }

    res.json({ message: 'Document supprimé avec succès' });

  } catch (error) {
    console.error('Erreur suppression document:', error);
    res.status(500).json({ message: 'Erreur serveur', error: error.message });
  }
};

/**
 * @desc    Met à jour les métadonnées d'un document
 * @route   PATCH /api/documents/:id/metadata
 * @access  Private
 */
exports.updateMetadata = async (req, res) => {
  try {
    const { id } = req.params;
    const metadata = req.body;

    const document = await updateDocumentMetadata(id, metadata);

    if (!document) {
      return res.status(404).json({ message: 'Document non trouvé' });
    }

    res.json({
      message: 'Métadonnées mises à jour',
      document: {
        id: document._id,
        nom: document.nom,
        metadata: document.metadata
      }
    });

  } catch (error) {
    console.error('Erreur mise à jour métadonnées:', error);
    res.status(500).json({ message: 'Erreur serveur', error: error.message });
  }
};

/**
 * @desc    Obtient les statistiques des documents
 * @route   GET /api/documents/stats
 * @access  Private (Admin)
 */
exports.getStats = async (req, res) => {
  try {
    const stats = await getDocumentsStats();

    res.json({
      ...stats,
      total: {
        ...stats.total,
        totalSizeMB: (stats.total.totalSize / (1024 * 1024)).toFixed(2)
      }
    });

  } catch (error) {
    console.error('Erreur récupération stats:', error);
    res.status(500).json({ message: 'Erreur serveur', error: error.message });
  }
};

/**
 * @desc    Recherche de documents
 * @route   GET /api/documents/search
 * @access  Private
 */
exports.searchDocuments = async (req, res) => {
  try {
    const {
      nom,
      type,
      relatedModel,
      relatedId,
      dateDebut,
      dateFin,
      limit = 50,
      page = 1
    } = req.query;

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const results = await searchDocuments({
      nom,
      type,
      relatedModel,
      relatedId,
      dateDebut,
      dateFin,
      limit: parseInt(limit),
      skip
    });

    // Formater les résultats
    const formattedDocuments = results.documents.map(doc => ({
      id: doc._id,
      nom: doc.nom,
      type: doc.type,
      contentType: doc.contentType,
      taille: doc.taille,
      extension: doc.extension,
      relatedTo: doc.relatedTo,
      metadata: doc.metadata,
      dateDepot: doc.dateDepot
    }));

    res.json({
      documents: formattedDocuments,
      pagination: {
        total: results.total,
        page: results.page,
        totalPages: results.totalPages,
        limit: parseInt(limit)
      }
    });

  } catch (error) {
    console.error('Erreur recherche documents:', error);
    res.status(500).json({ message: 'Erreur serveur', error: error.message });
  }
};

module.exports = exports;
