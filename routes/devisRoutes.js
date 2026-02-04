const express = require("express");
const router = express.Router();
const devisController = require("../controllers/devisController");
const missionController = require("../controllers/missionController");
const upload = require('../middlewares/upload');
const authMiddleware = require('../middlewares/authMiddleware'); // JWT

// Récupération devis via lien
router.get("/devis/:key", devisController.getDevisViaLien);

// marquage devis en ouvert 
router.get("/devis/ouvrir/:key", devisController.ouvrirDevisViaLien);

// Accepter / refuser devis
router.post("/devis/:key/:devisId/accepter", devisController.accepterDevisViaLien);
router.post("/devis/:key/:devisId/refuser", devisController.refuserDevisViaLien);

// Upload fichiers côté client
router.post("/upload/:accesClientKey", missionController.uploadFileByClientKey); 
// 🚀 Upload PDF de consentement (single file)
router.post(
  "/upload-consent/:accesClientKey",
  missionController.uploadConsentPdfByClientKey
);
// Upload PDF généré côté client pour un devis
router.post(
  "/devis/:devisId/upload-pdf",
  upload.single("pdf"), // utilise le middleware Multer + Cloudinary
  devisController.uploadPdfDevis // nouvelle méthode à créer dans ton controller
);

router.post("/devis/:devisId/signature", devisController.uploadSignature);
// 🔹 Nouvelle route : aucun document à transmettre
router.post('/no-documents', devisController.noDocumentsDevis)

// Rappel devis
router.post("/:id/rappel", authMiddleware, devisController.envoyerRappelDevis);

// Vérification manuelle des bounces pour les devis en "Envoi_En_Cours"
router.post("/verifier-bounces", authMiddleware, devisController.verifierBouncesDevis);

module.exports = router;
