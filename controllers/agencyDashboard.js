const Devis = require("../models/Devis.js");
const Agence = require("../models/Agency.js");
const OrdreMission = require("../models/OrdreMission.js");
const Employe = require('../models/Employe');

const getDashboardAgence = async (req, res) => {
  try {
    const { user, agence, role } = req;

    console.log("===== DASHBOARD REQUEST =====");
    console.log("User:", user ? { id: user._id, email: user.email || user.admin?.email, role: user.role } : null);
    console.log("Agence:", agence ? { id: agence._id, nom: agence.nom_commercial } : null);
    console.log("Role:", role);

    if (!agence) {
      console.log("Agence introuvable dans la requête !");
      return res.status(404).json({ success: false, message: "Agence introuvable" });
    }

    let devis = [];
    let ordres = [];

    if (role === "agence") {
      devis = await Devis.find({ agenceId: agence._id })
        .populate("pack", "nom")
        .populate("diagnosticsSelectionnes", "nom");
      ordres = await OrdreMission.find({ agenceId: agence._id });
    } else if (role === "employe") {
      devis = await Devis.find({ "creePar.id": user._id, "creePar.type": "Employe" })
        .populate("pack", "nom")
        .populate("diagnosticsSelectionnes", "nom");
      ordres = await OrdreMission.find({ "creePar.id": user._id, "creePar.type": "Employe" });
    }

    const clients = agence.clients || [];

    // === Helper pour derniers mois / semaines ===
    const getLastMonths = (count = 4) => {
      const months = [];
      const now = new Date();
      for (let i = count - 1; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
        months.push(key);
      }
      return months;
    };

    const getLastWeeks = (count = 4) => {
      const weeks = [];
      const now = new Date();
      for (let i = count - 1; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i * 7);
        const weekNum = getWeekNumber(d);
        const key = `${d.getFullYear()}-W${String(weekNum).padStart(2, "0")}`;
        if (!weeks.includes(key)) weeks.push(key);
      }
      return weeks;
    };

    // === CA total accepté ===
    const chiffreAffairesTotal = devis
      .filter(d => d.statut === "Accepté")
      .reduce((sum, d) => sum + (d.totalFinal || 0), 0);

    // === Nombre devis et taux acceptation ===
    const nombreDevis = devis.length;
    const devisAcceptes = devis.filter(d => d.statut === "Accepté").length;
    const tauxAcceptation = nombreDevis > 0 ? ((devisAcceptes / nombreDevis) * 100).toFixed(2) : 0;

    // === CA par mois / semaine avec valeurs à 0 ===
    const chiffreAffairesParMois = {};
    const chiffreAffairesParSemaine = {};

    // Pré-remplir les derniers mois et semaines à 0
    getLastMonths(4).forEach(m => chiffreAffairesParMois[m] = 0);
    getLastWeeks(4).forEach(w => chiffreAffairesParSemaine[w] = 0);

    // Remplir avec les valeurs réelles
    devis.forEach(d => {
      if (d.statut !== "Accepté") return;
      const date = new Date(d.dateCreation);
      const montant = parseFloat((d.totalFinal || 0).toFixed(2));

      const moisKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
      chiffreAffairesParMois[moisKey] = parseFloat(((chiffreAffairesParMois[moisKey] || 0) + montant).toFixed(2));

      const semaineNum = getWeekNumber(date);
      const semaineKey = `${date.getFullYear()}-W${String(semaineNum).padStart(2, "0")}`;
      chiffreAffairesParSemaine[semaineKey] = parseFloat(((chiffreAffairesParSemaine[semaineKey] || 0) + montant).toFixed(2));
    });

    // === Top diagnostics & packs vendus ===
    const topItems = {};
    devis.forEach(d => {
      if (d.diagnosticsSelectionnes) {
        d.diagnosticsSelectionnes.forEach(diag => {
          const name = diag.nom || diag.toString();
          topItems[name] = (topItems[name] || 0) + 1;
        });
      }
      if (d.pack) {
        const name = d.pack.nom || d.pack.toString();
        topItems[name] = (topItems[name] || 0) + 1;
      }
    });
    const topItemsArray = Object.entries(topItems)
      .sort((a, b) => b[1] - a[1])
      .map(([name, count]) => ({ name, count }))
      .slice(0, 10);

    // === Préparer la réponse ===
    let stats = {
      nombreDevis,
      devisAcceptes,
      tauxAcceptation: parseFloat(tauxAcceptation),
      chiffreAffairesTotal: parseFloat(chiffreAffairesTotal.toFixed(2)),
      nombreOrdres: ordres.length,
      chiffreAffairesParMois,
      chiffreAffairesParSemaine,
      topItems: topItemsArray
    };

    // Infos supplémentaires pour les agences
    if (role === "agence") {
      stats.nomAgence = agence.nom_commercial;
      stats.nombreClients = clients.length;
      stats.cagnotte = agence.cagnotte;
      stats.reduction = agence.reduction;
      stats.ca_estime = agence.ca_estime;
    }

    console.log("Stats calculées :", stats);

    return res.status(200).json({ success: true, role, stats });

  } catch (error) {
    console.error("Erreur Dashboard:", error);
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
