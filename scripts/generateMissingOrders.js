/**
 * Script automatique :
 * Vérifie tous les devis Acceptés et crée un Ordre de Mission
 * si aucun n'a encore été généré.
 */

require("dotenv").config();
const connectDB = require("../config/db"); // <-- Ton connecteur
const mongoose = require("mongoose");

const Devis = require("../models/Devis");
const OrdreMission = require("../models/OrdreMission");
const Client = require("../models/Client");
const Agence = require("../models/Agency");
const Employe = require("../models/Employe");

(async () => {
  try {
    console.log("🔌 Connexion à MongoDB...");
    await connectDB();

    console.log("🔎 Recherche des devis acceptés sans ordre de mission...");

    // 🔹 Récupère tous les devis Acceptés
    const devisAcceptes = await Devis.find({ statut: "Accepté" });

    let compteur = 0;

    for (const devis of devisAcceptes) {

      // 🔹 Vérifie si un OM existe déjà
      const existingOM = await OrdreMission.findOne({ devisId: devis._id });

      if (existingOM) {
        console.log(`➡️ Déjà fait : OM ${existingOM.numero} existe pour ${devis.numero}`);
        continue;
      }

      console.log(`🆕 OM manquant → Création pour ${devis.numero}`);

      // ────────────────────────────────────────────
      // 🔹 Trouver le client
      // ────────────────────────────────────────────
      let clientId = devis.clientId;

      // ⚠️ IMPORTANT : Toujours privilégier le clientId du devis
      if (!clientId && devis.client?.email) {
        console.warn(`⚠️ Devis ${devis.numero} sans clientId, recherche par email...`);

        // Vérifier s'il y a des doublons d'email AVANT de sélectionner
        const duplicates = await Client.find({ email: devis.client.email });

        if (duplicates.length === 0) {
          console.log(`❌ Client introuvable pour ${devis.numero} → OM impossible`);
          continue;
        }

        if (duplicates.length > 1) {
          console.error(`❌ PLUSIEURS CLIENTS (${duplicates.length}) AVEC L'EMAIL ${devis.client.email} !`);
          console.error(`   Devis: ${devis.numero}`);
          console.error(`   Clients trouvés:`, duplicates.map(d => `${d._id} - ${d.prenom} ${d.nom}`));
          console.error(`   ⚠️ ORDRE DE MISSION NON CRÉÉ - Impossible de déterminer le bon client`);
          continue; // Sauter ce devis
        }

        // Un seul client trouvé, on peut l'utiliser en toute sécurité
        const client = duplicates[0];
        clientId = client._id;

        // Mettre à jour le devis avec le clientId
        devis.clientId = clientId;
        await devis.save();
        console.log(`✅ Client trouvé et associé au devis: ${client._id} - ${client.prenom} ${client.nom}`);
      }

      // ────────────────────────────────────────────
      // 🔹 Génération du numéro OM
      // ────────────────────────────────────────────
      const numeroOM = `OM-${Date.now()}-${Math.floor(Math.random() * 999)}`;

      // ────────────────────────────────────────────
      // 🔹 Création de l'Ordre de Mission
      // ────────────────────────────────────────────
const ordre = new OrdreMission({
  devisId: devis._id,
  agenceId: devis.agenceId || null,
  numero: numeroOM,
  clientId,
  description: `Ordre de mission généré automatiquement pour ${devis.numero}`,
  statut: "Commande",
  creePar: devis.creePar || {
    type: "Admin",
    id: "68e3d6e2633a85d834279fd8"
  }
});


      await ordre.save();
      compteur++;

      console.log(`✅ OM créé : ${numeroOM} pour ${devis.numero}`);
    }

    console.log(`\n🎉 Terminé : ${compteur} Ordre(s) de Mission créé(s).`);
    process.exit(0);

  } catch (error) {
    console.error("❌ Erreur script OM :", error);
    process.exit(1);

  }
})();
