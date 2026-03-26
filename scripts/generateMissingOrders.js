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

      if (!clientId && devis.client?.email) {
        const client = await Client.findOne({ email: devis.client.email });

        if (!client) {
          console.log(`❌ Client introuvable pour ${devis.numero} → OM impossible`);
          continue;
        }

        // ⚠️ Vérifier s'il y a des doublons d'email
        const duplicates = await Client.find({ email: devis.client.email, _id: { $ne: client._id } });
        if (duplicates.length > 0) {
          console.warn(`⚠️ ATTENTION: Plusieurs clients avec l'email ${devis.client.email} !`);
          console.warn(`   Client utilisé: ${client._id} - ${client.prenom} ${client.nom}`);
          console.warn(`   ${duplicates.length} autre(s) client(s) avec cet email trouvé(s)`);
        }

        clientId = client._id;
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
