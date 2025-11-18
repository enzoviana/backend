require("dotenv").config();
const mongoose = require("mongoose");
const connectDB = require("./config/db"); // ⚠️ adapte le chemin si ton fichier s'appelle différemment
const Pack = require("./models/Pack");
const Diagnostic = require("./models/Diagnostic");

(async () => {
  await connectDB();

  console.log("🔍 Démarrage de l’audit des packs...\n");

  const packs = await Pack.find().populate("diagnostics");
  let totalAnomalies = 0;
  let totalFixes = 0;

  for (const pack of packs) {
    const anomalies = [];
    const diagNames = new Set();
    const diagnosticsToKeep = [];

    for (const diag of pack.diagnostics) {
      if (!diag) continue;

      const key = `${diag.nom}-${diag.typeBien}-${diag.typeOperation}`;
      let isValid = true;

      // 1️⃣ Vérifie les doublons
      if (diagNames.has(key)) {
        anomalies.push(`❌ Doublon supprimé : ${diag.nom} (${diag.typeBien}/${diag.typeOperation})`);
        isValid = false;
      } else {
        diagNames.add(key);
      }

      // 2️⃣ Vérifie la cohérence du typeBien
      if (diag.typeBien !== pack.typeBien) {
        anomalies.push(`⚠️ Incohérence typeBien : ${diag.nom} (${diag.typeBien}) ≠ Pack (${pack.typeBien})`);
        isValid = false;
      }

      // 3️⃣ Vérifie la cohérence du typeOperation
      if (diag.typeOperation !== pack.typeOperation) {
        anomalies.push(`⚠️ Incohérence typeOperation : ${diag.nom} (${diag.typeOperation}) ≠ Pack (${pack.typeOperation})`);
        isValid = false;
      }

      // On ne garde que les diagnostics cohérents
      if (isValid) diagnosticsToKeep.push(diag._id);
    }

    if (anomalies.length > 0) {
      totalAnomalies += anomalies.length;
      console.log(`\n📦 Pack : ${pack.nom} (${pack.typeBien}/${pack.typeOperation})`);
      anomalies.forEach(a => console.log("   " + a));

      // 🧹 Mode AUTO-FIX : on met à jour le pack sans les mauvais diagnostics
      pack.diagnostics = diagnosticsToKeep;
      await pack.save();
      totalFixes++;
      console.log(`   ✅ Pack corrigé automatiquement (${diagnosticsToKeep.length} diagnostics conservés)`);
    }
  }

  console.log("\n✅ Audit terminé !");
  console.log(`📊 Total anomalies détectées : ${totalAnomalies}`);
  console.log(`🔧 Total packs corrigés : ${totalFixes}`);

  mongoose.connection.close();
})();
