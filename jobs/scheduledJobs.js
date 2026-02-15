const cron = require('node-cron');
const alerteService = require('../services/alerteService');
const Certification = require('../models/Certification');
const Diagnostiqueur = require('../models/Diagnostiqueur');

/**
 * Tâche quotidienne : Vérification des documents et envoi des alertes
 * Exécutée tous les jours à 8h00
 */
const verificationDocumentsJob = cron.schedule('0 8 * * *', async () => {
  try {
    console.log('🔔 [CRON] Démarrage vérification quotidienne des documents...');

    await alerteService.verifierTousLesDocuments();

    console.log('✅ [CRON] Vérification documents terminée avec succès');

  } catch (error) {
    console.error('❌ [CRON] Erreur vérification documents:', error);
  }
}, {
  scheduled: false, // Ne démarre pas automatiquement, sera démarré manuellement
  timezone: "Europe/Paris"
});

/**
 * Tâche quotidienne : Mise à jour des statuts des certifications
 * Exécutée tous les jours à 2h00
 */
const updateCertificationStatusesJob = cron.schedule('0 2 * * *', async () => {
  try {
    console.log('🔄 [CRON] Démarrage MAJ statuts certifications...');

    const certifications = await Certification.find({});
    let updatedCount = 0;

    for (const cert of certifications) {
      const oldStatut = cert.statut;
      cert.calculerStatut();

      if (cert.statut !== oldStatut) {
        await cert.save();
        updatedCount++;
      }
    }

    console.log(`✅ [CRON] MAJ statuts certifications terminée: ${updatedCount} mises à jour`);

  } catch (error) {
    console.error('❌ [CRON] Erreur MAJ statuts certifications:', error);
  }
}, {
  scheduled: false,
  timezone: "Europe/Paris"
});

/**
 * Tâche quotidienne : Mise à jour des statuts des documents diagnostiqueurs
 * Exécutée tous les jours à 3h00
 */
const updateDocumentStatusesJob = cron.schedule('0 3 * * *', async () => {
  try {
    console.log('🔄 [CRON] Démarrage MAJ statuts documents diagnostiqueurs...');

    const diagnostiqueurs = await Diagnostiqueur.find({ statut: 'actif' });
    let updatedCount = 0;

    for (const diag of diagnostiqueurs) {
      let hasChanges = false;

      diag.documents.forEach(doc => {
        if (doc.dateExpiration) {
          const maintenant = new Date();
          const joursRestants = Math.ceil((doc.dateExpiration - maintenant) / (1000 * 60 * 60 * 24));
          const oldStatut = doc.statut;

          if (joursRestants < 0) {
            doc.statut = 'expire';
          } else if (joursRestants <= 30) {
            doc.statut = 'a_renouveler';
          } else {
            doc.statut = 'valide';
          }

          if (doc.statut !== oldStatut) {
            hasChanges = true;
          }
        }
      });

      if (hasChanges) {
        await diag.save();
        updatedCount++;
      }
    }

    console.log(`✅ [CRON] MAJ statuts documents terminée: ${updatedCount} diagnostiqueurs mis à jour`);

  } catch (error) {
    console.error('❌ [CRON] Erreur MAJ statuts documents:', error);
  }
}, {
  scheduled: false,
  timezone: "Europe/Paris"
});

/**
 * Initialise et démarre tous les jobs planifiés
 */
function init() {
  console.log('📅 Initialisation des jobs planifiés...');

  verificationDocumentsJob.start();
  console.log('✅ Job vérification documents programmé (tous les jours à 8h00)');

  updateCertificationStatusesJob.start();
  console.log('✅ Job MAJ statuts certifications programmé (tous les jours à 2h00)');

  updateDocumentStatusesJob.start();
  console.log('✅ Job MAJ statuts documents programmé (tous les jours à 3h00)');

  console.log('✅ Tous les jobs planifiés sont actifs');
}

/**
 * Arrête tous les jobs planifiés
 */
function stop() {
  console.log('⏸️  Arrêt des jobs planifiés...');

  verificationDocumentsJob.stop();
  updateCertificationStatusesJob.stop();
  updateDocumentStatusesJob.stop();

  console.log('✅ Tous les jobs planifiés sont arrêtés');
}

module.exports = {
  init,
  stop,
  verificationDocumentsJob,
  updateCertificationStatusesJob,
  updateDocumentStatusesJob
};
