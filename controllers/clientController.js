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

exports.deleteClient = async (req, res) => {
  try {
    const clientId = req.params.id;

    console.log("🗑️ deleteClient appelé pour :", clientId);
    console.log("req.user.role :", req.user.role);
    console.log("req.agence :", req.agence?._id);

    // 🔍 Vérifier que le client existe
    const client = await Client.findById(clientId);
    if (!client) {
      return res.status(404).json({ message: "Client introuvable." });
    }

    // 🔐 Sécurité : 
    // - admin peut supprimer tous les clients
    // - une agence ne peut supprimer que ses propres clients
    if (req.user.role === "agence") {
      if (!client.agences.includes(req.agence._id)) {
        return res.status(403).json({
          message: "Vous n’êtes pas autorisé à supprimer ce client.",
        });
      }
    }

    // ❗ OPTIONNEL : Supprimer tous les devis liés
    // await Devis.deleteMany({ client: clientId });

    // 🗑️ Suppression du client
    await Client.findByIdAndDelete(clientId);

    return res.status(200).json({
      message: "🗑️ Client supprimé avec succès.",
      clientId,
    });
  } catch (error) {
    console.error("Erreur deleteClient :", error);
    return res.status(500).json({
      message: "Erreur serveur lors de la suppression du client.",
    });
  }
};

exports.updateClientEmail = async (req, res) => {
  try {
    const clientId = req.params.id;
    const { email } = req.body;

    console.log("✏️ updateClientEmail appelé :", clientId, email);

    if (!email) {
      return res.status(400).json({ message: "L'email est requis." });
    }

    // 🔍 Vérifier que le client existe
    const client = await Client.findById(clientId);
    if (!client) {
      return res.status(404).json({ message: "Client introuvable." });
    }

    // 📌 Vérifier si un autre client utilise déjà cet email dans la même agence
    const duplicate = await Client.findOne({
      _id: { $ne: clientId },
      email: email,
      agences: { $in: client.agences },
    });

    if (duplicate) {
      return res.status(400).json({
        message: "❌ Cet email est déjà utilisé par un autre client de cette agence.",
      });
    }

    // 📩 Mettre à jour l'email
    client.email = email;
    await client.save();

    return res.status(200).json({
      message: "✏️ Email du client mis à jour avec succès.",
      client,
    });

  } catch (error) {
    console.error("Erreur updateClientEmail :", error);
    return res.status(500).json({
      message: "Erreur serveur lors de la mise à jour de l'email.",
    });
  }
};
