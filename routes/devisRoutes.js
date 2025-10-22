const express = require("express");
const router = express.Router();
const devisController = require("../controllers/devisController");
const missionController = require("../controllers/missionController");
const upload = require('../middlewares/upload');

router.get("/devis/:key", devisController.getDevisViaLien);
router.post("/devis/:key/:devisId/accepter", devisController.accepterDevisViaLien);
router.post("/devis/:key/:devisId/refuser", devisController.refuserDevisViaLien);

router.post("/upload/:accesClientKey", missionController.uploadFileByClientKey);

module.exports = router;
