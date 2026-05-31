const express = require('express');
const router = express.Router();
const multer = require('multer');
const documentController = require('../controllers/documentController');
const { protect } = require('../middlewares/authMiddleware');
const { protectDiagnostiqueur } = require('../middlewares/diagnostiqueurAuth');

// Configuration Multer pour upload en mémoire (sans Cloudinary)
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: {
    fileSize: 50 * 1024 * 1024 // 50 MB
  },
  fileFilter: (req, file, cb) => {
    const allowedExtensions = [
      'jpg', 'jpeg', 'png', 'webp',
      'pdf', 'doc', 'docx', 'xls', 'xlsx',
      'zip', 'rar', '7z', 'txt', 'csv'
    ];
    const ext = file.originalname.split('.').pop().toLowerCase();

    if (allowedExtensions.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error(`Format .${ext} non supporté`), false);
    }
  }
});

/**
 * Routes publiques (avec authentification)
 */

// Récupérer un document par ID
router.get('/:id', protect, documentController.getDocument);

// Visualiser un document (inline)
router.get('/:id/view', protect, documentController.viewDocument);

// Récupérer les documents d'un diagnostiqueur
router.get('/diagnostiqueur/:id', protect, documentController.getDocumentsDiagnostiqueur);

// Récupérer les documents d'un devis
router.get('/devis/:id', protect, documentController.getDocumentsDevis);

// Récupérer les documents d'un ordre de mission
router.get('/mission/:id', protect, documentController.getDocumentsOrdreMission);

// Rechercher des documents
router.get('/search', protect, documentController.searchDocuments);

// Upload un nouveau document
router.post('/upload', protect, upload.single('file'), documentController.uploadDocument);

// Mettre à jour les métadonnées d'un document
router.patch('/:id/metadata', protect, documentController.updateMetadata);

// Supprimer un document
router.delete('/:id', protect, documentController.deleteDocument);

/**
 * Routes admin
 */

// Statistiques (admin seulement)
router.get('/admin/stats', protect, documentController.getStats);

module.exports = router;
