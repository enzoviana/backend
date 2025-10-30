const Devis = require("../models/Devis.js");
const Agence = require("../models/Agency.js");
const OrdreMission = require("../models/OrdreMission.js");

const getDashboardAgence = async (req, res) => {
  try {
    const agence = req.agence; // récupéré via agencyAuth

    if (!agence) {
      return res.status(404).json({ success: false, message: "Agence introuvable" });
    }

    // Récupérer les devis et ordres liés
    const devis = await Devis.find({ agenceId: agence._id });
    const ordres = await OrdreMission.find({ agenceId: agence._id });

    const clients = agence.clients || [];

    // === CA total accepté ===
    const chiffreAffairesTotal = devis
      .filter(d => d.statut === "Accepté")
      .reduce((sum, d) => sum + (d.totalFinal || 0), 0);

    // === Nombre devis et taux acceptation ===
    const nombreDevis = devis.length;
    const devisAcceptes = devis.filter(d => d.statut === "Accepté").length;
    const tauxAcceptation = nombreDevis > 0 ? ((devisAcceptes / nombreDevis) * 100).toFixed(2) : 0;

    // === CA par mois / semaine ===
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
      const semaineKey = `${date.getFullYear()}-W${String(semaineNum).padStart(2, "0")}`;
      chiffreAffairesParSemaine[semaineKey] = (chiffreAffairesParSemaine[semaineKey] || 0) + (d.totalFinal || 0);
    });

    // === Top diagnostics & packs vendus ===
    const topItems = {};
    devis.forEach(d => {
      if (d.diagnosticsSelectionnes) {
        d.diagnosticsSelectionnes.forEach(diag => {
          topItems[diag] = (topItems[diag] || 0) + 1;
        });
      }
      if (d.pack) topItems[d.pack] = (topItems[d.pack] || 0) + 1;
    });
    const topItemsArray = Object.entries(topItems)
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => ({ name, count }))
      .slice(0, 10);

    return res.status(200).json({
      success: true,
      stats: {
        nomAgence: agence.nom_commercial,
        nombreClients: clients.length,
        nombreDevis,
        devisAcceptes,
        tauxAcceptation: parseFloat(tauxAcceptation),
        chiffreAffairesTotal: parseFloat(chiffreAffairesTotal.toFixed(2)),
        cagnotte: agence.cagnotte,
        reduction: agence.reduction,
        ca_estime: agence.ca_estime,
        nombreOrdres: ordres.length,
        chiffreAffairesParMois,
        chiffreAffairesParSemaine,
        topItems: topItemsArray
      }
    });
  } catch (error) {
    console.error("Erreur Dashboard Agence:", error);
    return res.status(500).json({ success: false, message: "Erreur serveur" });
  }
};

// Fonction utilitaire pour numéro de semaine ISO
function getWeekNumber(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
}



module.exports = { getDashboardAgence };
