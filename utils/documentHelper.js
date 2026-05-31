const Document = require('../models/Document');

/**
 * Utilitaires pour gérer les documents stockés en BDD
 */

/**
 * Récupère tous les documents d'une entité
 */
async function getDocumentsByEntity(model, id) {
  return await Document.find({
    'relatedTo.model': model,
    'relatedTo.id': id
  }).sort({ dateDepot: -1 });
}

/**
 * Récupère un document spécifique par son public_id Cloudinary (migration)
 */
async function getDocumentByCloudinaryId(publicId) {
  return await Document.findOne({ cloudinaryPublicId: publicId });
}

/**
 * Récupère les documents d'un diagnostiqueur
 */
async function getDocumentsDiagnostiqueur(diagnostiqueurId, options = {}) {
  const query = {
    'relatedTo.model': 'Diagnostiqueur',
    'relatedTo.id': diagnostiqueurId
  };

  // Filtrer par type si spécifié
  if (options.type) {
    query.type = options.type;
  }

  // Filtrer par field si spécifié
  if (options.field) {
    query['relatedTo.field'] = options.field;
  }

  return await Document.find(query).sort({ dateDepot: -1 });
}

/**
 * Récupère les documents d'un devis
 */
async function getDocumentsDevis(devisId) {
  return await Document.find({
    'relatedTo.model': 'Devis',
    'relatedTo.id': devisId
  }).sort({ dateDepot: -1 });
}

/**
 * Récupère les documents d'un ordre de mission
 */
async function getDocumentsOrdreMission(missionId, options = {}) {
  const query = {
    'relatedTo.model': 'OrdreMission',
    'relatedTo.id': missionId
  };

  if (options.type) {
    query.type = options.type;
  }

  return await Document.find(query).sort({ dateDepot: -1 });
}

/**
 * Sauvegarde un nouveau document dans la BDD
 */
async function saveDocument(params) {
  const {
    nom,
    type,
    buffer,
    contentType,
    relatedModel,
    relatedId,
    relatedField,
    metadata = {},
    cloudinaryPublicId = null,
    cloudinaryUrl = null
  } = params;

  // Déterminer l'extension
  const extension = nom.split('.').pop().toLowerCase();

  const document = new Document({
    nom,
    type,
    data: buffer,
    contentType,
    taille: buffer.length,
    extension,
    cloudinaryPublicId,
    cloudinaryUrl,
    relatedTo: {
      model: relatedModel,
      id: relatedId,
      field: relatedField
    },
    metadata,
    dateDepot: new Date()
  });

  await document.save();
  return document;
}

/**
 * Supprime un document
 */
async function deleteDocument(documentId) {
  return await Document.findByIdAndDelete(documentId);
}

/**
 * Met à jour les métadonnées d'un document
 */
async function updateDocumentMetadata(documentId, metadata) {
  return await Document.findByIdAndUpdate(
    documentId,
    { $set: { metadata } },
    { new: true }
  );
}

/**
 * Obtient les statistiques des documents
 */
async function getDocumentsStats() {
  const stats = await Document.aggregate([
    {
      $group: {
        _id: '$type',
        count: { $sum: 1 },
        totalSize: { $sum: '$taille' }
      }
    },
    {
      $project: {
        type: '$_id',
        count: 1,
        totalSize: 1,
        totalSizeMB: { $divide: ['$totalSize', 1024 * 1024] },
        _id: 0
      }
    },
    {
      $sort: { count: -1 }
    }
  ]);

  const total = await Document.aggregate([
    {
      $group: {
        _id: null,
        count: { $sum: 1 },
        totalSize: { $sum: '$taille' }
      }
    }
  ]);

  return {
    byType: stats,
    total: total[0] || { count: 0, totalSize: 0 }
  };
}

/**
 * Récupère un document et le renvoie en format Base64 (pour affichage)
 */
async function getDocumentAsBase64(documentId) {
  const document = await Document.findById(documentId);
  if (!document) return null;

  return {
    id: document._id,
    nom: document.nom,
    contentType: document.contentType,
    base64: document.data.toString('base64'),
    dataUrl: `data:${document.contentType};base64,${document.data.toString('base64')}`
  };
}

/**
 * Récupère un document et le renvoie en format Buffer (pour téléchargement)
 */
async function getDocumentAsBuffer(documentId) {
  const document = await Document.findById(documentId);
  if (!document) return null;

  return {
    id: document._id,
    nom: document.nom,
    contentType: document.contentType,
    buffer: document.data
  };
}

/**
 * Recherche de documents
 */
async function searchDocuments(searchParams) {
  const {
    nom,
    type,
    relatedModel,
    relatedId,
    dateDebut,
    dateFin,
    limit = 50,
    skip = 0
  } = searchParams;

  const query = {};

  if (nom) {
    query.nom = { $regex: nom, $options: 'i' };
  }

  if (type) {
    query.type = type;
  }

  if (relatedModel) {
    query['relatedTo.model'] = relatedModel;
  }

  if (relatedId) {
    query['relatedTo.id'] = relatedId;
  }

  if (dateDebut || dateFin) {
    query.dateDepot = {};
    if (dateDebut) query.dateDepot.$gte = new Date(dateDebut);
    if (dateFin) query.dateDepot.$lte = new Date(dateFin);
  }

  const documents = await Document.find(query)
    .select('-data') // Ne pas charger les données binaires dans la recherche
    .sort({ dateDepot: -1 })
    .limit(limit)
    .skip(skip);

  const total = await Document.countDocuments(query);

  return {
    documents,
    total,
    page: Math.floor(skip / limit) + 1,
    totalPages: Math.ceil(total / limit)
  };
}

module.exports = {
  getDocumentsByEntity,
  getDocumentByCloudinaryId,
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
};
