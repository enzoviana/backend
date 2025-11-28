const Client = require("../models/Client"); // ✅ Modèle Client
const Devis = require("../models/Devis");   // ✅ Modèle Devis (pour populate)

exports.getClients = async (req, res) => {
  try {
    console.log("🔹 getClients appelé");
    console.log("req.admin:", req.admin);
    console.log("req.agence:", req.agence);

    let query = {};

    // 🔑 Définir la query selon le rôle
    if (req.user.role === "admin") {
      console.log("Rôle: Admin → récupération de tous les clients");
      query = {};
    } else if (req.agence) {
      console.log("Rôle: Agence → récupération des clients de l'agence", req.agence._id);
      query = { agences: req.agence._id };
    } else {
      console.warn("❌ Utilisateur non authentifié");
      return res.status(401).json({ message: "Utilisateur non authentifié." });
    }

    // 📋 Récupère les clients
    const clients = await Client.find(query)
      .populate({
        path: "devis",
        select: "numero dateCreation montantTTC statut type",
      })
      .sort({ createdAt: -1 });

    console.log("🔹 Nombre de clients trouvés:", clients.length);

    // 🔁 Si aucun client
    if (!clients.length) {
      console.warn("❌ Aucun client trouvé");
      return res.status(200).json({ message: "Aucun client trouvé.", clients: [] });
    }

    // 🔹 Log des 3 premiers clients pour vérification
    console.log("🔹 Exemples clients:", clients.slice(0, 3));

    // ✅ Succès
    return res.status(200).json({ message: "✅ Clients récupérés avec succès", clients });
  } catch (error) {
    console.error("Erreur récupération clients :", error);
    return res.status(500).json({ message: "Erreur serveur lors de la récupération des clients." });
  }
};
