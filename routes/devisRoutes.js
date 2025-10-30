const express = require("express");
const router = express.Router();
const devisController = require("../controllers/devisController");
const missionController = require("../controllers/missionController");
const upload = require('../middlewares/upload');
const authMiddleware = require('../middlewares/authMiddleware'); // JWT

// Récupération devis via lien
router.get("/devis/:key", devisController.getDevisViaLien);

// Accepter / refuser devis
router.post("/devis/:key/:devisId/accepter", devisController.accepterDevisViaLien);
router.post("/devis/:key/:devisId/refuser", devisController.refuserDevisViaLien);

// Upload fichiers côté client
router.post("/upload/:accesClientKey", missionController.uploadFileByClientKey);

// Upload PDF généré côté client pour un devis
router.post(
  "/devis/:devisId/upload-pdf",
  upload.single("pdf"), // utilise le middleware Multer + Cloudinary
  devisController.uploadPdfDevis // nouvelle méthode à créer dans ton controller
);

router.post("/devis/:devisId/signature", devisController.uploadSignature);


// Rappel devis
router.post("/:id/rappel", authMiddleware, devisController.envoyerRappelDevis);

module.exports = router;
