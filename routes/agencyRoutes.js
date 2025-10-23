const express = require('express');
const router = express.Router();
const agencyController = require('../controllers/agencyController');
const devisController = require('../controllers/devisController')
const adminController = require('../controllers/adminController');
const clientController = require("../controllers/clientController");
const missionController = require("../controllers/missionController");
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
router.get('/devis', agencyAuth, devisController.getDevis);
router.post(
  '/devis',
  agencyAuth,
  upload.single('consentement'), // Multer va parser le fichier
  devisController.createDevis
);



// ---------------------- CONFIGURATION ----------------------
// Diagnostics
router.get('/diagnostics', agencyAuth, adminController.getAllDiagnostics);
router.post('/diagnostic/filter', agencyAuth, agencyController.filterDiagnostics);


// Packs
router.get('/packs', agencyAuth, adminController.getAllPacks);
router.post('/packs/filter', agencyAuth , agencyController.filterPacks);


// Supplement 
router.post('/supplement/filter', agencyAuth , agencyController.filterSupplementsByTypeBien);

// ---------------------- Client ----------------------

router.get("/clients", agencyAuth, clientController.getClients);


// ---------------------- Mission ----------------------
router.get("/mission", agencyAuth, missionController.getOrdresMission);
router.get("/facture", agencyAuth, missionController.getFactures);



// ---------------------- Cagnotte ----------------------
router.get('/me/cagnotte', agencyAuth, agencyController.getCagnotteEtReduction);


// ---------------------- Agence ----------------------

router.get('/me', agencyAuth, agencyController.getInfosAgence);
router.put('/me', agencyAuth, agencyController.updateInfosAgence);

module.exports = router;
