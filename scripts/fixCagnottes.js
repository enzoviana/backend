/**
 * 🔧 Script de correction des cagnottes
 *
 * Ce script vérifie tous les ordres de mission avec statut "Payé" ou "Payée"
 * et crédite les cagnottes qui n'ont pas été mises à jour.
 *
 * Usage: node scripts/fixCagnottes.js
 */

require('dotenv').config();
const mongoose = require('mongoose');
const OrdreMission = require('../models/OrdreMission');
const Devis = require('../models/Devis');
const Agence = require('../models/Agency');
const Employe = require('../models/Employe');

// Connexion à MongoDB
const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGO_LIVE, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log('✅ Connecté à MongoDB');
  } catch (error) {
    console.error('❌ Erreur de connexion MongoDB:', error);
    process.exit(1);
  }
};

// Script principal
const fixCagnottes = async () => {
  try {
    console.log('\n🔍 Recherche des ordres de mission payés...\n');

    // Trouver tous les ordres de mission payés
    const ordresPayes = await OrdreMission.find({
      statut: { $in: ['Payé', 'Payée'] }
    })
      .populate('devisId')
      .populate('agenceId')
      .populate('creePar.id');

    console.log(`📊 ${ordresPayes.length} ordres de mission payés trouvés\n`);

    if (ordresPayes.length === 0) {
      console.log('✅ Aucun ordre de mission payé à traiter');
      return;
    }

    let corrections = 0;
    let dejaPaye = 0;
    let erreurs = 0;

    const rapport = {
      agences: {},
      employes: {},
      details: []
    };

    // Traiter chaque ordre de mission
    for (const ordre of ordresPayes) {
      try {
        if (!ordre.devisId) {
          console.log(`⚠️  Ordre ${ordre.numero} : Devis manquant`);
          erreurs++;
          continue;
        }

        if (!ordre.agenceId) {
          console.log(`⚠️  Ordre ${ordre.numero} : Agence manquante`);
          erreurs++;
          continue;
        }

        const devis = ordre.devisId;
        const agence = ordre.agenceId;
        const montantCredit = +(devis.montantTTC * 0.03).toFixed(2);

        // Vérifier si la cagnotte a déjà été créditée
        let dejaCredite = false;

        if (agence.type_cagnotte === 'individuelle' && ordre.creePar?.type === 'Employe') {
          // Cas : Cagnotte individuelle employé
          const employe = await Employe.findById(ordre.creePar.id);

          if (!employe) {
            console.log(`⚠️  Ordre ${ordre.numero} : Employé introuvable`);
            erreurs++;
            continue;
          }

          dejaCredite = employe.transactions_cagnotte.some(t =>
            t.reference && t.reference.toString() === ordre._id.toString()
          );

          if (!dejaCredite) {
            // Créditer la cagnotte de l'employé
            employe.cagnotte += montantCredit;
            employe.transactions_cagnotte.push({
              montant: montantCredit,
              type: 'gain',
              description: `3% du devis ${devis.numero} (Ordre ${ordre.numero}) - Correction automatique`,
              reference: ordre._id,
              date: new Date()
            });
            await employe.save();

            console.log(`✅ Ordre ${ordre.numero} : +${montantCredit}€ → Employé ${employe.nom} ${employe.prenom}`);
            corrections++;

            if (!rapport.employes[employe._id]) {
              rapport.employes[employe._id] = {
                nom: `${employe.prenom} ${employe.nom}`,
                montantTotal: 0,
                ordres: []
              };
            }
            rapport.employes[employe._id].montantTotal += montantCredit;
            rapport.employes[employe._id].ordres.push(ordre.numero);

            rapport.details.push({
              type: 'employe',
              ordre: ordre.numero,
              montant: montantCredit,
              beneficiaire: `${employe.prenom} ${employe.nom}`
            });
          } else {
            console.log(`⏭️  Ordre ${ordre.numero} : Déjà crédité (Employé)`);
            dejaPaye++;
          }

        } else {
          // Cas : Cagnotte partagée agence
          if (!agence.historiqueCagnotte) agence.historiqueCagnotte = [];

          dejaCredite = agence.historiqueCagnotte.some(h =>
            h.description && h.description.includes(`Ordre ${ordre.numero}`)
          );

          if (!dejaCredite) {
            // Créditer la cagnotte de l'agence
            agence.cagnotte = (agence.cagnotte || 0) + montantCredit;
            agence.historiqueCagnotte.push({
              montant: montantCredit,
              type: 'gain',
              description: `3% du devis ${devis.numero} (Ordre ${ordre.numero}) - Correction automatique`,
              par: 'Script de correction',
              date: new Date()
            });
            await agence.save();

            console.log(`✅ Ordre ${ordre.numero} : +${montantCredit}€ → Agence ${agence.nom_commercial}`);
            corrections++;

            if (!rapport.agences[agence._id]) {
              rapport.agences[agence._id] = {
                nom: agence.nom_commercial,
                montantTotal: 0,
                ordres: []
              };
            }
            rapport.agences[agence._id].montantTotal += montantCredit;
            rapport.agences[agence._id].ordres.push(ordre.numero);

            rapport.details.push({
              type: 'agence',
              ordre: ordre.numero,
              montant: montantCredit,
              beneficiaire: agence.nom_commercial
            });
          } else {
            console.log(`⏭️  Ordre ${ordre.numero} : Déjà crédité (Agence)`);
            dejaPaye++;
          }
        }

      } catch (err) {
        console.error(`❌ Erreur pour ordre ${ordre.numero}:`, err.message);
        erreurs++;
      }
    }

    // Afficher le rapport final
    console.log('\n' + '='.repeat(60));
    console.log('📊 RAPPORT DE CORRECTION DES CAGNOTTES');
    console.log('='.repeat(60));
    console.log(`\n📈 Statistiques:`);
    console.log(`   - Total ordres payés : ${ordresPayes.length}`);
    console.log(`   - Corrections effectuées : ${corrections}`);
    console.log(`   - Déjà crédités : ${dejaPaye}`);
    console.log(`   - Erreurs : ${erreurs}`);

    if (Object.keys(rapport.agences).length > 0) {
      console.log(`\n🏢 AGENCES (${Object.keys(rapport.agences).length}):`);
      for (const [agenceId, data] of Object.entries(rapport.agences)) {
        console.log(`   • ${data.nom}`);
        console.log(`     └─ +${data.montantTotal.toFixed(2)}€ (${data.ordres.length} ordres)`);
      }
    }

    if (Object.keys(rapport.employes).length > 0) {
      console.log(`\n👤 EMPLOYÉS (${Object.keys(rapport.employes).length}):`);
      for (const [employeId, data] of Object.entries(rapport.employes)) {
        console.log(`   • ${data.nom}`);
        console.log(`     └─ +${data.montantTotal.toFixed(2)}€ (${data.ordres.length} ordres)`);
      }
    }

    console.log('\n' + '='.repeat(60));

    if (corrections > 0) {
      console.log(`\n✅ ${corrections} cagnotte(s) corrigée(s) avec succès !`);
    } else {
      console.log(`\n✅ Toutes les cagnottes sont à jour !`);
    }

  } catch (error) {
    console.error('\n❌ Erreur lors de l\'exécution du script:', error);
    process.exit(1);
  }
};

// Exécution du script
const run = async () => {
  await connectDB();
  await fixCagnottes();
  await mongoose.connection.close();
  console.log('\n👋 Connexion MongoDB fermée');
  process.exit(0);
};

run();
