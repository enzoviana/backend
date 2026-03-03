const express = require('express');
const router = express.Router();
const diagnostiqueurController = require('../controllers/diagnostiqueurController');
const diagnostiqueurAuth = require('../middlewares/diagnostiqueurAuth');
const checkAbonnement = require('../middlewares/checkAbonnement');
const checkEligibilite = require('../middlewares/checkEligibilite');
const upload = require('../middlewares/upload');

/**
 * Routes publiques (sans authentification)
 */

// Inscription
router.post('/register', diagnostiqueurController.register);

// Connexion
router.post('/login', diagnostiqueurController.login);

// Mot de passe oublié
router.post('/forgot-password', diagnostiqueurController.forgotPassword);

// Réinitialiser mot de passe
router.post('/reset-password/:token', diagnostiqueurController.resetPassword);

/**
 * Routes protégées (authentification requise)
 */

// Vérifier token
router.get('/verify-token', diagnostiqueurAuth, diagnostiqueurController.verifyToken);

// Profil
router.get('/me', diagnostiqueurAuth, diagnostiqueurController.getMe);
router.put('/me', diagnostiqueurAuth, diagnostiqueurController.updateMe);

// Logo
router.put('/me/logo', diagnostiqueurAuth, upload.single('logo'), diagnostiqueurController.uploadLogo);

// Documents
router.post('/documents', diagnostiqueurAuth, upload.single('document'), diagnostiqueurController.addDocument);
router.get('/documents', diagnostiqueurAuth, diagnostiqueurController.getDocuments);
router.delete('/documents/:documentId', diagnostiqueurAuth, diagnostiqueurController.deleteDocument);

// Techniciens
router.post('/techniciens/init-defaut', diagnostiqueurAuth, diagnostiqueurController.initTechnicienDefaut);
router.post('/techniciens', diagnostiqueurAuth, diagnostiqueurController.addTechnicien);
router.get('/techniciens', diagnostiqueurAuth, diagnostiqueurController.getTechniciens);
router.put('/techniciens/:technicienId', diagnostiqueurAuth, diagnostiqueurController.updateTechnicien);
router.delete('/techniciens/:technicienId', diagnostiqueurAuth, diagnostiqueurController.deleteTechnicien);

// Certifications
router.post('/certifications', diagnostiqueurAuth, upload.single('document'), diagnostiqueurController.addCertification);
router.get('/certifications', diagnostiqueurAuth, diagnostiqueurController.getCertifications);
router.put('/certifications/:certificationId', diagnostiqueurAuth, diagnostiqueurController.updateCertification);
router.delete('/certifications/:certificationId', diagnostiqueurAuth, diagnostiqueurController.deleteCertification);

// Missions
router.get('/missions', diagnostiqueurAuth, diagnostiqueurController.getMissions);
router.get('/missions/:missionId', diagnostiqueurAuth, diagnostiqueurController.getMissionDetail);
router.get('/missions/:missionId/download', diagnostiqueurAuth, diagnostiqueurController.downloadOrdreMission);
router.post('/missions/:missionId/accepter', diagnostiqueurAuth, checkEligibilite, diagnostiqueurController.accepterMission);
router.post('/missions/:missionId/refuser', diagnostiqueurAuth, diagnostiqueurController.refuserMission);
router.put('/missions/:missionId/statut', diagnostiqueurAuth, diagnostiqueurController.updateMissionStatut);

// Devis
router.get('/devis', diagnostiqueurAuth, diagnostiqueurController.getDevis);
router.get('/devis/:devisId', diagnostiqueurAuth, diagnostiqueurController.getDevisDetail);
router.post('/devis/:devisId/refuser', diagnostiqueurAuth, diagnostiqueurController.refuserDevis);

// Alertes
router.get('/alertes', diagnostiqueurAuth, diagnostiqueurController.getAlertes);
router.put('/alertes/:alerteId/lu', diagnostiqueurAuth, diagnostiqueurController.markAlerteAsRead);

// Notations
router.get('/notations', diagnostiqueurAuth, diagnostiqueurController.getNotations);
router.post('/notations/:notationId/reponse', diagnostiqueurAuth, diagnostiqueurController.addReponseNotation);

// Renouvellements (PRO uniquement)
router.get('/renouvellements', diagnostiqueurAuth, checkAbonnement('PRO'), diagnostiqueurController.getRenouvellements);

// Abonnement
router.get('/abonnement', diagnostiqueurAuth, diagnostiqueurController.getAbonnement);
router.post('/abonnement/upgrade', diagnostiqueurAuth, diagnostiqueurController.upgradeAbonnement);
router.post('/abonnement/cancel', diagnostiqueurAuth, diagnostiqueurController.cancelAbonnement);
router.get('/abonnement/factures', diagnostiqueurAuth, diagnostiqueurController.getFactures);

// Statistiques
router.get('/statistiques', diagnostiqueurAuth, diagnostiqueurController.getStatistiques);

// Domaines
router.get('/domaines', diagnostiqueurAuth, diagnostiqueurController.getDomaines);

// Informations bancaires
router.put('/informations-bancaires', diagnostiqueurAuth, diagnostiqueurController.updateInformationsBancaires);

// Zone d'intervention
router.put('/zone-intervention', diagnostiqueurAuth, diagnostiqueurController.updateZoneIntervention);

// Niveaux d'expertise
router.post('/niveaux-expertise', diagnostiqueurAuth, diagnostiqueurController.addNiveauExpertise);

// Mes devis
router.get('/mes-devis', diagnostiqueurAuth, diagnostiqueurController.getMesDevis);

module.exports = router;
