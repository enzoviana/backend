const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');
const authMiddleware = require('../middlewares/authMiddleware'); // JWT
const clientController = require("../controllers/clientController");
const missionController = require("../controllers/missionController");
const agencyController = require('../controllers/agencyController');
const devisController = require('../controllers/devisController');
const adminDiagnostiqueurController = require('../controllers/adminDiagnostiqueurController');
const creditsController = require('../controllers/creditsController');
const googleCalendarController = require('../controllers/googleCalendarController');
const contratController = require('../controllers/contratController');
const upload = require('../middlewares/upload');

// Diagnostics
router.post('/diagnostic/filter', authMiddleware, agencyController.filterDiagnostics);


// Packs
router.post('/packs/filter', authMiddleware , agencyController.filterPacks);


// Supplement 
router.post('/supplement/filter', authMiddleware , agencyController.filterSupplementsByTypeBien);


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
router.delete("/agences/:id", authMiddleware, adminController.deleteAgence);

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


router.get('/typeBiens', authMiddleware, agencyController.getAllTypeBiens);



// ---------------------- Client ----------------------

router.get("/clients", authMiddleware, clientController.getClients);
router.delete("/clients/:id", authMiddleware, clientController.deleteClient);
router.put("/clients/:id", authMiddleware, clientController.updateClient);


// ---------------------- Ordre Mission ----------------------

router.get("/mission", authMiddleware, missionController.getOrdresMission);
router.put("/mission/:ordreId/statut", authMiddleware, missionController.updateStatutOrdreMission);
router.get("/mission/download/:fileId", authMiddleware, missionController.downloadFile);
router.get("/mission/downloadConsentPdf/:devisId", authMiddleware, missionController.downloadConsentPdf);

router.delete("/mission/:id", authMiddleware, missionController.deleteOrdreMission);
router.put("/mission/:id/modifier-infos", authMiddleware, missionController.updateMissionInfos);

router.get('/cagnotte', authMiddleware, agencyController.getCagnotteEtReduction);


router.get('/devis', authMiddleware, devisController.getDevis);
router.post('/devis/corriger-email', authMiddleware, devisController.corrigerEmailDevis);
router.post('/devis/ai', authMiddleware, devisController.generateDevisAI);
router.patch('/devis/:id', authMiddleware, devisController.updateDevisInfos);

// 🆕 Routes de notification d'agences
router.post('/devis/notify-new-agency', authMiddleware, devisController.notifyNewAgency);
router.post('/devis/notify-existing-agency', authMiddleware, devisController.notifyExistingAgency);

router.delete("/devis/:id", authMiddleware, devisController.deleteDevis);
router.post(
  '/devis',
  authMiddleware,
  upload.single('consentement'), // Multer va parser le fichier
  devisController.createDevis
);
router.get("/devis/download/:devisId", authMiddleware, devisController.downloadDevis);

// ---------------------- CRÉDITS IA ----------------------
router.get('/credits/packs', authMiddleware, creditsController.getPacks);
router.get('/credits/balance', authMiddleware, creditsController.getBalance);
router.post('/credits/checkout', authMiddleware, creditsController.createCheckoutSession);
router.post('/credits/add-manually', authMiddleware, creditsController.addCreditsManually);

// ---------------------- GOOGLE CALENDAR ----------------------
router.get('/google/auth/url', authMiddleware, googleCalendarController.getAuthUrl);
router.get('/google/auth/callback', googleCalendarController.handleCallback); // Pas de authMiddleware car appelé par Google
router.get('/google/status', authMiddleware, googleCalendarController.getStatus);
router.post('/google/disconnect', authMiddleware, googleCalendarController.disconnect);
router.post('/google/calendar/event', authMiddleware, googleCalendarController.createEvent);
router.post('/google/checkout', authMiddleware, googleCalendarController.createGoogleCalendarCheckoutSession);

// ---------------------- CONTRAT DE TRANSFERT ----------------------
router.get('/contrat/status', authMiddleware, contratController.getStatus);
router.get('/contrat/packs', authMiddleware, contratController.getPacks);
router.post('/contrat/envoyer-code', authMiddleware, contratController.envoyerCodeVerification);
router.post('/contrat/signer', authMiddleware, contratController.signerContrat);
router.get('/contrat/details', authMiddleware, contratController.getDetails);
router.put('/contrat/changer-pack', authMiddleware, contratController.changerPack);

// ---------------------- DIAGNOSTIQUEURS ----------------------

// Liste et recherche
router.get('/diagnostiqueurs', authMiddleware, adminDiagnostiqueurController.getAllDiagnostiqueurs);
router.get('/diagnostiqueurs/stats/global', authMiddleware, adminDiagnostiqueurController.getStatistiquesGlobales);
router.get('/diagnostiqueurs/:id', authMiddleware, adminDiagnostiqueurController.getDiagnostiqueurById);

// Gestion
router.put('/diagnostiqueurs/:id/valider', authMiddleware, adminDiagnostiqueurController.validerDiagnostiqueur);
router.put('/diagnostiqueurs/:id/bloquer', authMiddleware, adminDiagnostiqueurController.bloquerDiagnostiqueur);
router.put('/diagnostiqueurs/:id/statut', authMiddleware, adminDiagnostiqueurController.changerStatutDiagnostiqueur);
router.delete('/diagnostiqueurs/:id', authMiddleware, adminDiagnostiqueurController.deleteDiagnostiqueur);

// Certifications et éligibilité
router.get('/diagnostiqueurs/:id/certifications', authMiddleware, adminDiagnostiqueurController.getCertificationsDiagnostiqueur);
router.post('/diagnostiqueurs/:id/eligibilite', authMiddleware, adminDiagnostiqueurController.verifierEligibilite);

// ---------------------- DOMAINES D'ACTIVITÉ ----------------------

router.get('/domaines', authMiddleware, adminDiagnostiqueurController.getAllDomaines);
router.post('/domaines', authMiddleware, adminDiagnostiqueurController.createDomaine);
router.put('/domaines/:id', authMiddleware, adminDiagnostiqueurController.updateDomaine);

module.exports = router;
