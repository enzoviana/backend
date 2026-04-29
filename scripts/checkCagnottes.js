/**
 * 🔍 Script de vérification des cagnottes (READ-ONLY)
 *
 * Ce script VÉRIFIE tous les ordres de mission avec statut "Payé" ou "Payée"
 * et affiche un rapport sans modifier les données.
 *
 * Usage: node scripts/checkCagnottes.js
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
    console.log('✅ Connecté à MongoDB (mode lecture seule)');
  } catch (error) {
    console.error('❌ Erreur de connexion MongoDB:', error);
    process.exit(1);
  }
};

// Script principal
const checkCagnottes = async () => {
  try {
    console.log('\n🔍 Vérification des cagnottes...\n');

    // Trouver tous les ordres de mission payés
    const ordresPayes = await OrdreMission.find({
      statut: { $in: ['Payé', 'Payée'] }
    })
      .populate('devisId')
      .populate('agenceId')
      .populate('creePar.id');

    console.log(`📊 ${ordresPayes.length} ordres de mission payés trouvés\n`);

    if (ordresPayes.length === 0) {
      console.log('✅ Aucun ordre de mission payé');
      return;
    }

    let aCrediter = 0;
    let dejaPaye = 0;
    let erreurs = 0;

    const rapport = {
      aCrediter: {
        agences: {},
        employes: {}
      },
      dejaPaye: {
        agences: {},
        employes: {}
      }
    };

    // Vérifier chaque ordre de mission
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
            console.log(`❌ Ordre ${ordre.numero} : NON CRÉDITÉ (Employé ${employe.nom} ${employe.prenom}) - ${montantCredit}€`);
            aCrediter++;

            if (!rapport.aCrediter.employes[employe._id]) {
              rapport.aCrediter.employes[employe._id] = {
                nom: `${employe.prenom} ${employe.nom}`,
                montantTotal: 0,
                ordres: []
              };
            }
            rapport.aCrediter.employes[employe._id].montantTotal += montantCredit;
            rapport.aCrediter.employes[employe._id].ordres.push(ordre.numero);
          } else {
            console.log(`✅ Ordre ${ordre.numero} : Déjà crédité (Employé)`);
            dejaPaye++;

            if (!rapport.dejaPaye.employes[employe._id]) {
              rapport.dejaPaye.employes[employe._id] = {
                nom: `${employe.prenom} ${employe.nom}`,
                ordres: []
              };
            }
            rapport.dejaPaye.employes[employe._id].ordres.push(ordre.numero);
          }

        } else {
          // Cas : Cagnotte partagée agence
          const agenceHistorique = agence.historiqueCagnotte || [];

          dejaCredite = agenceHistorique.some(h =>
            h.description && h.description.includes(`Ordre ${ordre.numero}`)
          );

          if (!dejaCredite) {
            console.log(`❌ Ordre ${ordre.numero} : NON CRÉDITÉ (Agence ${agence.nom_commercial}) - ${montantCredit}€`);
            aCrediter++;

            if (!rapport.aCrediter.agences[agence._id]) {
              rapport.aCrediter.agences[agence._id] = {
                nom: agence.nom_commercial,
                cagnotteActuelle: agence.cagnotte || 0,
                montantTotal: 0,
                ordres: []
              };
            }
            rapport.aCrediter.agences[agence._id].montantTotal += montantCredit;
            rapport.aCrediter.agences[agence._id].ordres.push(ordre.numero);
          } else {
            console.log(`✅ Ordre ${ordre.numero} : Déjà crédité (Agence)`);
            dejaPaye++;

            if (!rapport.dejaPaye.agences[agence._id]) {
              rapport.dejaPaye.agences[agence._id] = {
                nom: agence.nom_commercial,
                cagnotteActuelle: agence.cagnotte || 0,
                ordres: []
              };
            }
            rapport.dejaPaye.agences[agence._id].ordres.push(ordre.numero);
          }
        }

      } catch (err) {
        console.error(`❌ Erreur pour ordre ${ordre.numero}:`, err.message);
        erreurs++;
      }
    }

    // Afficher le rapport final
    console.log('\n' + '='.repeat(70));
    console.log('📊 RAPPORT DE VÉRIFICATION DES CAGNOTTES (READ-ONLY)');
    console.log('='.repeat(70));
    console.log(`\n📈 Statistiques:`);
    console.log(`   - Total ordres payés : ${ordresPayes.length}`);
    console.log(`   - À créditer : ${aCrediter} ❌`);
    console.log(`   - Déjà crédités : ${dejaPaye} ✅`);
    console.log(`   - Erreurs : ${erreurs} ⚠️`);

    if (Object.keys(rapport.aCrediter.agences).length > 0) {
      console.log(`\n❌ AGENCES À CRÉDITER (${Object.keys(rapport.aCrediter.agences).length}):`);
      for (const [agenceId, data] of Object.entries(rapport.aCrediter.agences)) {
        console.log(`   • ${data.nom}`);
        console.log(`     ├─ Cagnotte actuelle : ${data.cagnotteActuelle.toFixed(2)}€`);
        console.log(`     ├─ À ajouter : +${data.montantTotal.toFixed(2)}€`);
        console.log(`     ├─ Nouvelle cagnotte : ${(data.cagnotteActuelle + data.montantTotal).toFixed(2)}€`);
        console.log(`     └─ Ordres manquants : ${data.ordres.join(', ')}`);
      }
    }

    if (Object.keys(rapport.aCrediter.employes).length > 0) {
      console.log(`\n❌ EMPLOYÉS À CRÉDITER (${Object.keys(rapport.aCrediter.employes).length}):`);
      for (const [employeId, data] of Object.entries(rapport.aCrediter.employes)) {
        console.log(`   • ${data.nom}`);
        console.log(`     ├─ À ajouter : +${data.montantTotal.toFixed(2)}€`);
        console.log(`     └─ Ordres manquants : ${data.ordres.join(', ')}`);
      }
    }

    if (Object.keys(rapport.dejaPaye.agences).length > 0) {
      console.log(`\n✅ AGENCES DÉJÀ À JOUR (${Object.keys(rapport.dejaPaye.agences).length}):`);
      for (const [agenceId, data] of Object.entries(rapport.dejaPaye.agences)) {
        console.log(`   • ${data.nom}`);
        console.log(`     ├─ Cagnotte actuelle : ${data.cagnotteActuelle.toFixed(2)}€`);
        console.log(`     └─ Ordres crédités : ${data.ordres.length} ordre(s)`);
      }
    }

    if (Object.keys(rapport.dejaPaye.employes).length > 0) {
      console.log(`\n✅ EMPLOYÉS DÉJÀ À JOUR (${Object.keys(rapport.dejaPaye.employes).length}):`);
      for (const [employeId, data] of Object.entries(rapport.dejaPaye.employes)) {
        console.log(`   • ${data.nom}`);
        console.log(`     └─ Ordres crédités : ${data.ordres.length} ordre(s)`);
      }
    }

    console.log('\n' + '='.repeat(70));

    if (aCrediter > 0) {
      console.log(`\n⚠️  ${aCrediter} cagnotte(s) à corriger !`);
      console.log(`\n💡 Pour corriger automatiquement, lancez :`);
      console.log(`   node scripts/fixCagnottes.js`);
    } else {
      console.log(`\n✅ Toutes les cagnottes sont à jour !`);
    }

  } catch (error) {
    console.error('\n❌ Erreur lors de la vérification:', error);
    process.exit(1);
  }
};

// Exécution du script
const run = async () => {
  await connectDB();
  await checkCagnottes();
  await mongoose.connection.close();
  console.log('\n👋 Connexion MongoDB fermée');
  process.exit(0);
};

run();
