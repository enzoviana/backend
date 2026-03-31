/**
 * Script de vérification de cohérence des clients
 * Vérifie que les infos client de l'OM (nom, prénom, tél) correspondent au devis associé
 *
 * Usage: node scripts/checkClientConsistency.js
 * Options:
 *   --fix : Corriger automatiquement en utilisant le clientId du devis
 *
 * Note: Ignore les anciens devis sans clientId
 */

require("dotenv").config();
const connectDB = require("../config/db");
const mongoose = require("mongoose");

const OrdreMission = require("../models/OrdreMission");
const Devis = require("../models/Devis");
const Client = require("../models/Client");

const FIX_MODE = process.argv.includes("--fix");

(async () => {
  try {
    console.log("🔌 Connexion à MongoDB...\n");
    await connectDB();

    console.log("🔍 Vérification de la cohérence des clients...\n");
    console.log("=".repeat(80));
    console.log("\n");

    // Récupérer tous les ordres de mission
    const ordresMissions = await OrdreMission.find({}).populate('devisId');

    console.log(`📊 Total d'ordres de mission : ${ordresMissions.length}\n`);

    let totalIncoherences = 0;
    let totalCorriges = 0;
    let totalSansDevis = 0;
    let totalDevisSansClientId = 0;
    let totalCoherents = 0;

    const incoherences = [];

    for (const om of ordresMissions) {
      // Vérifier si le devis existe
      if (!om.devisId) {
        totalSansDevis++;
        console.log(`⚠️  OM ${om.numero} - Pas de devis associé`);
        continue;
      }

      const devis = om.devisId;

      // ⚠️ IGNORER les anciens devis sans clientId (comme demandé)
      if (!devis.clientId) {
        totalDevisSansClientId++;
        continue; // On passe au suivant sans rien afficher
      }

      // Récupérer le client du devis
      const clientDevis = await Client.findById(devis.clientId);
      if (!clientDevis) {
        console.log(`❌ Client du devis introuvable: ${devis.clientId}`);
        continue;
      }

      // Récupérer le client de l'OM
      const clientOM = om.clientId ? await Client.findById(om.clientId) : null;

      // Normalisation pour comparaison (supprimer espaces, accents, mettre en minuscule)
      const normalize = (str) => {
        if (!str) return '';
        return str.toLowerCase().trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      };

      const devisNom = normalize(devis.client.nom);
      const devisPrenom = normalize(devis.client.prenom);
      const devisTel = normalize(devis.client.tel);

      const omNom = clientOM ? normalize(clientOM.nom) : '';
      const omPrenom = clientOM ? normalize(clientOM.prenom) : '';
      const omTel = clientOM ? normalize(clientOM.telephone) : '';

      // Vérifier si les infos correspondent
      const nomMatch = omNom === devisNom;
      const prenomMatch = omPrenom === devisPrenom;
      const telMatch = omTel === devisTel || !devisTel || !omTel; // Ignorer si l'un des deux est vide

      const isCoherent = nomMatch && prenomMatch && telMatch;

      if (!isCoherent) {
        totalIncoherences++;

        console.log(`❌ INCOHÉRENCE DÉTECTÉE`);
        console.log(`   Ordre de Mission: ${om.numero} (ID: ${om._id})`);
        console.log(`   Devis associé: ${devis.numero} (ID: ${devis._id})`);
        console.log("");
        console.log(`   📋 Infos dans le DEVIS :`);
        console.log(`      → Nom: ${devis.client.nom}${!nomMatch ? ' ❌' : ' ✅'}`);
        console.log(`      → Prénom: ${devis.client.prenom}${!prenomMatch ? ' ❌' : ' ✅'}`);
        console.log(`      → Email: ${devis.client.email}`);
        console.log(`      → Tél: ${devis.client.tel || 'N/A'}${!telMatch && devisTel && omTel ? ' ❌' : ' ✅'}`);
        console.log("");
        console.log(`   👤 Client de l'OM (ID: ${om.clientId || 'NON DÉFINI'}) :`);
        if (clientOM) {
          console.log(`      → Nom: ${clientOM.nom}${!nomMatch ? ' ❌' : ' ✅'}`);
          console.log(`      → Prénom: ${clientOM.prenom}${!prenomMatch ? ' ✅' : ' ✅'}`);
          console.log(`      → Email: ${clientOM.email}`);
          console.log(`      → Tél: ${clientOM.telephone || 'N/A'}${!telMatch && devisTel && omTel ? ' ❌' : ' ✅'}`);
        } else {
          console.log(`      → PAS DE CLIENT ASSOCIÉ`);
        }

        incoherences.push({
          omId: om._id,
          omNumero: om.numero,
          devisId: devis._id,
          devisNumero: devis.numero,
          omClientId: om.clientId,
          devisClientId: devis.clientId,
          clientOM,
          clientDevis,
          devisClient: devis.client
        });

        if (FIX_MODE) {
          // Corriger l'OM en utilisant le clientId du devis
          om.clientId = devis.clientId;
          await om.save();
          totalCorriges++;
          console.log(`   ✅ CORRIGÉ : OM mis à jour avec le client du devis (${devis.clientId})`);
        } else {
          console.log(`   ℹ️  Utilisez --fix pour corriger automatiquement`);
        }

        console.log("");
        console.log("-".repeat(80));
        console.log("");
      } else {
        totalCoherents++;
      }
    }

    // Résumé final
    console.log("\n");
    console.log("=".repeat(80));
    console.log("📊 RÉSUMÉ DE LA VÉRIFICATION");
    console.log("=".repeat(80));
    console.log("");
    console.log(`📋 Total analysé : ${ordresMissions.length - totalDevisSansClientId} OM (${totalDevisSansClientId} ignorés car devis sans clientId)`);
    console.log(`✅ Ordres de mission cohérents : ${totalCoherents}`);
    console.log(`❌ Incohérences détectées : ${totalIncoherences}`);
    console.log(`⚠️  OM sans devis associé : ${totalSansDevis}`);

    if (FIX_MODE) {
      console.log(`\n✅ Corrections effectuées : ${totalCorriges}`);
    } else if (totalIncoherences > 0) {
      console.log(`\n💡 Pour corriger automatiquement (utiliser le clientId du devis), exécutez :`);
      console.log(`   node scripts/checkClientConsistency.js --fix`);
    }

    console.log("");

    // Liste détaillée des incohérences à la fin
    if (incoherences.length > 0 && !FIX_MODE) {
      console.log("\n📋 LISTE RÉCAPITULATIVE DES INCOHÉRENCES :");
      console.log("");
      incoherences.forEach((inc, index) => {
        console.log(`${index + 1}. OM ${inc.omNumero} → Devis ${inc.devisNumero}`);
        console.log(`   📋 Devis: ${inc.devisClient.prenom} ${inc.devisClient.nom} | ${inc.devisClient.email} | ${inc.devisClient.tel || 'N/A'}`);
        console.log(`   👤 Client OM: ${inc.clientOM?.prenom || 'N/A'} ${inc.clientOM?.nom || 'N/A'} | ${inc.clientOM?.email || 'N/A'} | ${inc.clientOM?.telephone || 'N/A'}`);
        console.log("");
      });
    }

    process.exit(0);

  } catch (error) {
    console.error("❌ Erreur lors de la vérification :", error);
    process.exit(1);
  }
})();
