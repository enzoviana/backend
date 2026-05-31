/**
 * Script pour mettre à jour les domaines ERP, CARREZ et BOUTIN
 * afin de les marquer comme ne nécessitant pas de certification
 */

require('dotenv').config();
const mongoose = require('mongoose');
const DomaineActivite = require('../models/DomaineActivite');

async function updateDomaines() {
  try {
    console.log('🔌 Connexion à MongoDB...');
    const mongoUri = process.env.MONGO_LIVE || process.env.MONGO_URI;
    if (!mongoUri) {
      throw new Error('MONGO_URI ou MONGO_LIVE non défini dans .env');
    }
    await mongoose.connect(mongoUri);
    console.log('✅ Connecté à MongoDB');

    // Domaines qui ne requièrent pas de certification
    const domainesSansCertification = ['ERP', 'CARREZ', 'BOUTIN'];

    console.log('\n📝 Mise à jour des domaines sans certification requise...');

    for (const code of domainesSansCertification) {
      const result = await DomaineActivite.findOneAndUpdate(
        { code },
        { requiresCertification: false },
        { new: true, upsert: false }
      );

      if (result) {
        console.log(`✅ ${code}: requiresCertification = false`);
      } else {
        console.log(`⚠️ ${code}: Domaine non trouvé, création...`);

        // Créer le domaine s'il n'existe pas
        const nomMap = {
          'ERP': 'État des Risques et Pollutions',
          'CARREZ': 'Loi Carrez - Mesurage',
          'BOUTIN': 'Loi Boutin - Mesurage'
        };

        await DomaineActivite.create({
          code,
          nom: nomMap[code],
          description: `Aucune certification n'est requise pour ${nomMap[code]}`,
          requiresCertification: false,
          actif: true
        });

        console.log(`✅ ${code}: Domaine créé avec requiresCertification = false`);
      }
    }

    // Optionnel: Ajouter la mention spéciale pour DPE Locaux Commerciaux
    console.log('\n📝 Ajout de la mention spéciale DPE Locaux Commerciaux...');

    const dpe = await DomaineActivite.findOne({ code: 'DPE' });

    if (dpe) {
      const mentionExists = dpe.mentionsSpeciales?.some(
        m => m.code === 'LOCAUX_COMMERCIAUX'
      );

      if (!mentionExists) {
        dpe.mentionsSpeciales = dpe.mentionsSpeciales || [];
        dpe.mentionsSpeciales.push({
          code: 'LOCAUX_COMMERCIAUX',
          libelle: 'Locaux commerciaux',
          description: 'Certification valable pour les locaux commerciaux'
        });
        await dpe.save();
        console.log('✅ DPE: Mention "Locaux commerciaux" ajoutée');
      } else {
        console.log('ℹ️ DPE: Mention "Locaux commerciaux" déjà présente');
      }
    }

    console.log('\n✅ Mise à jour terminée avec succès!');

    // Afficher un résumé
    console.log('\n📊 Résumé des domaines:');
    const allDomaines = await DomaineActivite.find({}).sort({ code: 1 });

    for (const domaine of allDomaines) {
      const certRequired = domaine.requiresCertification !== false ? '🔒 Certification requise' : '✓ Pas de certification';
      console.log(`  ${domaine.code.padEnd(15)} - ${certRequired}`);
    }

  } catch (error) {
    console.error('❌ Erreur:', error);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log('\n🔌 Déconnecté de MongoDB');
    process.exit(0);
  }
}

updateDomaines();
