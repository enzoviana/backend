const express = require('express');
const router = express.Router();
const agencyController = require('../controllers/agencyController');
const devisController = require('../controllers/devisController')
const adminController = require('../controllers/adminController');
const clientController = require("../controllers/clientController");
const missionController = require("../controllers/missionController");
const dashboardController = require("../controllers/agencyDashboard")
const agencyAuth = require('../middlewares/agencyAuth');
const upload = require('../middlewares/upload');

// Login agence
router.post('/login', agencyController.login);
router.get('/verify-token', agencyController.verifyToken);

router.post(
  '/register',
  upload.fields([
    { name: 'logo', maxCount: 1 },
    { name: 'photo_profil', maxCount: 1 }
  ]),
  agencyController.register
);

// 🔹 Mot de passe oublié / réinitialisation
router.post('/forgot-password', agencyController.forgotPassword);
router.post('/reset-password/:token', agencyController.resetPassword);


// ---------------------- DEVIS ----------------------



router.get('/devis', agencyAuth, devisController.getDevis);
router.post('/devis/corriger-email', agencyAuth, devisController.corrigerEmailDevis);

router.post(
  '/devis',
  agencyAuth,
  upload.single('consentement'), // Multer va parser le fichier
  devisController.createDevis
);


router.get("/mission/downloadConsentPdf/:devisId", agencyAuth, missionController.downloadConsentPdf);

// ---------------------- CONFIGURATION ----------------------
// Diagnostics
router.get('/diagnostics', agencyAuth, adminController.getAllDiagnostics);
router.post('/diagnostic/filter', agencyAuth, agencyController.filterDiagnostics);
router.get('/typeBiens', agencyAuth, agencyController.getAllTypeBiens);


// Packs
router.get('/packs', agencyAuth, adminController.getAllPacks);
router.post('/packs/filter', agencyAuth , agencyController.filterPacks);


// Supplement 
router.post('/supplement/filter', agencyAuth , agencyController.filterSupplementsByTypeBien);

// ---------------------- Client ----------------------

router.get("/clients", agencyAuth, clientController.getClients);
router.delete("/clients/:id", agencyAuth, clientController.deleteClient);
router.put("/clients/:id", agencyAuth, clientController.updateClient);


// ---------------------- Mission ----------------------
router.get("/mission", agencyAuth, missionController.getOrdresMission);
router.get("/mission/:id", agencyAuth, missionController.getOrdreMissionById);

router.put("/mission/:id/modifier-infos", agencyAuth, missionController.updateMissionInfos);
// ---------------------- Mission ----------------------
// Partager un ordre de mission avec un employé ou client
router.post(
  '/mission/:missionId/assign-employee',
  agencyAuth,
  missionController.partagerOrdreMission
);
router.get("/facture", agencyAuth, missionController.getFactures);



// ---------------------- Cagnotte ----------------------
router.get('/me/cagnotte', agencyAuth, agencyController.getCagnotteEtReduction);


// ---------------------- Agence ----------------------

router.get('/me', agencyAuth, agencyController.getInfosAgence);
router.put('/me', agencyAuth, agencyController.updateInfosAgence);
// 🔹 Nouvelle route pour mettre à jour uniquement le logo
router.put(
  '/me/logo', agencyAuth, upload.single('logo'), agencyController.updateLogoAgence
);


// ---------------------- Dashboard ----------------------
router.get("/dashboard", agencyAuth, dashboardController.getDashboardAgence);


// ---------------------- Employés ----------------------
router.post('/employes', agencyAuth, agencyController.addEmploye);              // Ajouter un employé
router.put('/employes/:employeId', agencyAuth, agencyController.updateEmploye); // Modifier un employé
router.delete('/employes/:employeId', agencyAuth, agencyController.deleteEmploye); // Supprimer un employé
router.get('/employes', agencyAuth, agencyController.getEmployes);           // Récupérer tous les employés

// Mettre à jour ses infos (photo URL ou fichier)
router.put(
  '/employe/me/photo',
  agencyAuth,
  upload.single('photo_profil'),
  agencyController.updatePhotoEmploye
);

// 📩 Parrainage – envoi email
router.post(
  "/parrainage/email",
  agencyAuth,
  agencyController.sendParrainageEmail
);

module.exports = router;
