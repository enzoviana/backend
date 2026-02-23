const mongoose = require('mongoose');
const Certification = require('../models/Certification');
require('dotenv').config();

/**
 * Script de migration pour ajouter le système d'approbation aux certifications existantes
 * Les certifications valides existantes seront automatiquement approuvées
 */
async function migrateCertifications() {
  try {
    console.log('🔄 Démarrage de la migration des certifications...');

    // Connexion à MongoDB
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Connecté à MongoDB');

    // Récupérer toutes les certifications existantes qui n'ont pas encore de système d'approbation
    const certifications = await Certification.find({
      $or: [
        { 'approbation': { $exists: false } },
        { 'approbation.statutApprobation': { $exists: false } }
      ]
    });

    console.log(`📊 ${certifications.length} certifications à migrer`);

    let countApprouvees = 0;
    let countEnAttente = 0;

    for (const cert of certifications) {
      // Si la certification est actuellement valide, l'approuver automatiquement
      if (cert.statut === 'valide' && cert.dateExpiration > new Date()) {
        cert.approbation = {
          statutApprobation: 'approuve',
          approuvePar: null,
          dateApprobation: new Date(),
          raisonRejet: null,
          commentaireAdmin: 'Migration automatique - Certification préexistante validée'
        };
        countApprouvees++;
      } else {
        // Sinon, mettre en attente d'approbation
        cert.approbation = {
          statutApprobation: 'en_attente',
          approuvePar: null,
          dateApprobation: null,
          raisonRejet: null,
          commentaireAdmin: 'Migration automatique - En attente de vérification'
        };
        cert.statut = 'en_attente';
        countEnAttente++;
      }

      await cert.save();
    }

    console.log(`✅ Migration terminée avec succès!`);
    console.log(`   - ${countApprouvees} certifications approuvées automatiquement`);
    console.log(`   - ${countEnAttente} certifications mises en attente de vérification`);

    await mongoose.disconnect();
    console.log('✅ Déconnecté de MongoDB');

  } catch (error) {
    console.error('❌ Erreur lors de la migration:', error);
    process.exit(1);
  }
}

// Exécuter la migration
migrateCertifications();
