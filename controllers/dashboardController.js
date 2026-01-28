const Devis = require("../models/Devis.js");
const Agence = require("../models/Agency.js");
const OrdreMission = require("../models/OrdreMission.js");

/**
 * Dashboard global - statistiques et métriques principales
 */
const getDashboardStats = async (req, res) => {
  try {
    // === 1️⃣ Récupération des données ===
const [devis, agences, ordres] = await Promise.all([
  Devis.find({})
    .populate('pack', 'nom') // On ne récupère que le champ 'nom' du pack
    .populate('diagnosticsSelectionnes', 'nom'), // Idem pour les diagnostics
  Agence.find({}),
  OrdreMission.find({})
]);

    const now = new Date();

    // === 2️⃣ Calcul du chiffre d’affaires par mois / semaine ===
    const chiffreAffairesParMois = {};
    const chiffreAffairesParSemaine = {};

    devis.forEach(d => {
      if (d.statut !== "Accepté") return;
      const date = new Date(d.dateCreation);

      // Par mois
      const moisKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
      chiffreAffairesParMois[moisKey] = (chiffreAffairesParMois[moisKey] || 0) + (d.totalFinal || 0);

      // Par semaine
      const semaineNum = getWeekNumber(date);
      const semaineKey = `${date.getFullYear()}-W${String(semaineNum).padStart(2,"0")}`;
      chiffreAffairesParSemaine[semaineKey] = (chiffreAffairesParSemaine[semaineKey] || 0) + (d.totalFinal || 0);
    });

    // === 3️⃣ Nombre de devis par mois / semaine ===
    const nombreDevisParMois = {};
    const nombreDevisParSemaine = {};

    devis.forEach(d => {
      const date = new Date(d.dateCreation);

      // Par mois
      const moisKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2,"0")}`;
      nombreDevisParMois[moisKey] = (nombreDevisParMois[moisKey] || 0) + 1;

      // Par semaine
      const semaineNum = getWeekNumber(date);
      const semaineKey = `${date.getFullYear()}-W${String(semaineNum).padStart(2,"0")}`;
      nombreDevisParSemaine[semaineKey] = (nombreDevisParSemaine[semaineKey] || 0) + 1;
    });

    // === 4️⃣ Nombre d’agences par mois / semaine ===
    const nombreAgencesParMois = {};
    const nombreAgencesParSemaine = {};

    agences.forEach(a => {
      const date = new Date(a.createdAt);

      const moisKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2,"0")}`;
      nombreAgencesParMois[moisKey] = (nombreAgencesParMois[moisKey] || 0) + 1;

      const semaineNum = getWeekNumber(date);
      const semaineKey = `${date.getFullYear()}-W${String(semaineNum).padStart(2,"0")}`;
      nombreAgencesParSemaine[semaineKey] = (nombreAgencesParSemaine[semaineKey] || 0) + 1;
    });

// === 5️⃣ Top diagnostics / packs ===
const topItems = {};
devis.forEach(d => {
  // Diagnostics
  if (d.diagnosticsSelectionnes && Array.isArray(d.diagnosticsSelectionnes)) {
    d.diagnosticsSelectionnes.forEach(diag => {
      // Si diag est peuplé, on prend diag.nom, sinon on garde l'ID ou 'Inconnu'
      const name = diag.nom || diag; 
      topItems[name] = (topItems[name] || 0) + 1;
    });
  }

  // Packs
  if (d.pack) {
    // Si pack est peuplé, on prend d.pack.nom
    const packName = d.pack.nom || d.pack;
    topItems[packName] = (topItems[packName] || 0) + 1;
  }
});

    const topItemsArray = Object.entries(topItems)
      .sort((a,b) => b[1] - a[1])
      .map(([nom, count]) => ({ nom, count })) 
      .slice(0, 10); // top 10

    // === 6️⃣ Autres stats globales ===
    const chiffreAffairesTotal = devis
      .filter(d => d.statut === "Accepté")
      .reduce((acc,d) => acc + (d.totalFinal || 0), 0);

    const nombreDevis = devis.length;
    const devisAcceptes = devis.filter(d => d.statut === "Accepté").length;
    const tauxConversion = nombreDevis > 0 ? ((devisAcceptes / nombreDevis) * 100).toFixed(2) : 0;

    // === 7️⃣ Envoi des stats ===
    const stats = {
      chiffreAffairesTotal: parseFloat(chiffreAffairesTotal.toFixed(2)),
      nombreAgences: agences.length,
      nombreDevis,
      devisAcceptes,
      tauxConversion: parseFloat(tauxConversion),
      nombreOrdres: ordres.length,

      // Graphiques
      chiffreAffairesParMois,
      chiffreAffairesParSemaine,
      nombreDevisParMois,
      nombreDevisParSemaine,
      nombreAgencesParMois,
      nombreAgencesParSemaine,
      topItems: topItemsArray
    };

    res.status(200).json({ success: true, stats });
  } catch (error) {
    console.error("Erreur Dashboard:", error);
    res.status(500).json({ success: false, message: "Erreur serveur" });
  }
};

// 🔹 Fonction utilitaire pour numéro de semaine ISO
function getWeekNumber(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7; // Lundi = 1
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
}


module.exports = { getDashboardStats };
