const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const authMiddleware = require('../middlewares/authMiddleware'); // JWT
const clientController = require("../controllers/clientController");
const missionController = require("../controllers/missionController");
const agencyController = require('../controllers/agencyController');
const devisController = require('../controllers/devisController')

// ---------------------- ADMIN ----------------------
// Créer un admin
router.post('/register', adminController.register);

// Login
router.post('/login', adminController.login);

router.get('/me', authMiddleware, adminController.getAdminDetails);
router.get("/verify-token",  adminController.verifyToken);

// 🔹 Mot de passe oublié / réinitialisation admin
router.post('/forgot-password', adminController.forgotPasswordAdmin);
router.get('/verify-reset-token/:token', adminController.verifyResetTokenAdmin);
router.post('/reset-password/:token', adminController.resetPasswordAdmin);

// Modifier infos admin (protégé)
router.put('/update', authMiddleware, adminController.updateAdmin);

// ---------------------- AGENCE ----------------------
// Créer une agence (protégé)
router.post('/createAgence', authMiddleware, adminController.createAgence);

// Récupérer toutes les agences (protégé)
router.get('/agences', authMiddleware, adminController.getAllAgences);
router.get('/classement-agences', authMiddleware, adminController.getClassementAgences);

router.put("/agences/:id", authMiddleware, adminController.updateAgence);



// ---------------------- CONFIGURATION ----------------------
// Diagnostics
router.get('/diagnostics', authMiddleware, adminController.getAllDiagnostics);
router.post('/diagnostics', authMiddleware, adminController.createDiagnostic);
router.put('/diagnostics/:id', authMiddleware, adminController.updateDiagnostic);
router.delete('/diagnostics/:id', authMiddleware, adminController.deleteDiagnostic);

// Packs
router.get('/packs', authMiddleware, adminController.getAllPacks);
router.post('/packs', authMiddleware, adminController.createPack);
router.put('/packs/:id', authMiddleware, adminController.updatePack);
router.delete('/packs/:id', authMiddleware, adminController.deletePack);

// Supplement
router.get('/supplement', authMiddleware, adminController.getSupplements);
router.post('/supplement', authMiddleware, adminController.createSupplement);
router.put('/supplement/:id', authMiddleware, adminController.updateSupplement);
router.delete('/supplement/:id', authMiddleware, adminController.deleteSupplement);



// ---------------------- Client ----------------------

router.get("/clients", authMiddleware, clientController.getClients);


// ---------------------- Ordre Mission ----------------------

router.get("/mission", authMiddleware, missionController.getOrdresMission);
router.put("/mission/:ordreId/statut", authMiddleware, missionController.updateStatutOrdreMission);
router.get("/mission/download/:fileId", authMiddleware, missionController.downloadFile);
router.delete("/mission/:id", authMiddleware, missionController.deleteOrdreMission);

router.get('/cagnotte', authMiddleware, agencyController.getCagnotteEtReduction);


router.get('/devis', authMiddleware, devisController.getDevis);
router.delete("/devis/:id", authMiddleware, devisController.deleteDevis);

module.exports = router;
