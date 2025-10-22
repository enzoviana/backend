// controllers/devisController.js
const Devis = require("../models/Devis");
const Pack = require("../models/Pack");
const Diagnostic = require("../models/Diagnostic");
const Client = require("../models/Client");
const Facture = require('../models/Facture');
const OrdreMission = require('../models/OrdreMission');
const Agence = require('../models/Agency');
const sendEmail = require("../utils/sendEmails"); // <-- Vérifie le bon chemin selon ton projet
const path = require("path");

/**
 * Récupérer tous les devis de l'utilisateur connecté
 * req.admin ou req.agence doit être défini par le middleware
 */
exports.getDevis = async (req, res) => {
  try {
    let query = {};

    if (req.admin) {
      // 🧑‍💼 Admin → tous les devis
      query = {};
    } else if (req.agence) {
      // 🏢 Agence → uniquement ses devis
      query = { agenceId: req.agence._id };
    } else {
      return res.status(401).json({ message: "Utilisateur non authentifié." });
    }

    const devis = await Devis.find(query)
      .populate("pack")
      .populate("diagnosticsSelectionnes")
      .sort({ dateCreation: -1 });

    res.json(devis);
  } catch (error) {
    console.error("Erreur récupération devis :", error);
    res.status(500).json({ message: "Erreur serveur." });
  }
};


/**
 * 🧾 Créer un nouveau devis
 */
exports.createDevis = async (req, res) => {
  try {
   
   console.log("===== Nouveau devis reçu =====", req.body);
    let data = req.body.data ? JSON.parse(req.body.data) : req.body;

    
    if (!data.client || !data.type || !data.bien) {
      return res.status(400).json({ message: "Client, type de devis et type de bien requis." });
    }

    const agenceId = req.agence?._id;
    if (!agenceId) return res.status(401).json({ message: "Agence non authentifiée." });

    // 🔎 Préparer les données client correctement
    const clientPayload = {
      ...data.client,
      telephone: data.client.tel || data.client.telephone || "",
      agences: [agenceId],
    };
    delete clientPayload.tel;

    // 🔎 Recherche ou création du client
    let client = await Client.findOne({ email: data.client.email });
    if (!client) {
      client = new Client(clientPayload);
      await client.save();
    } else if (!client.agences.includes(agenceId)) {
      client.agences.push(agenceId);
      await client.save();
    }

    const secteur = (req.agence?.alerte_secteur || "autre").toLowerCase();

    // 💰 Calcul du montant avant remise
    let totalAvantRemise = 0;

    if (data.type === "pack_complet" && data.pack) {
      const pack = await Pack.findById(data.pack).populate("diagnostics");
      if (!pack) return res.status(400).json({ message: "Pack invalide." });

      let surfaceMin = 0,
        surfaceMax = 0;
      if (data.surfaceMaison) {
        const match = data.surfaceMaison.match(/(\d+)\s*-\s*(\d+)/);
        surfaceMin = match ? parseInt(match[1], 10) : 0;
        surfaceMax = match ? parseInt(match[2], 10) : surfaceMin;
      }

      let tarifTrouve = null;
      if (pack.tarifsParSurface?.length) {
        for (let tps of pack.tarifsParSurface) {
          if (!(surfaceMax < tps.surfaceMin || surfaceMin > tps.surfaceMax)) {
            tarifTrouve = tps.tarifs[secteur] ?? tps.tarifs.autre ?? 0;
            break;
          }
        }
      }
      totalAvantRemise = Number(tarifTrouve) || 0;
    } else if (data.type === "diagnostic" && data.diagnosticsSelectionnes?.length) {
      const diagnostics = await Diagnostic.find({ _id: { $in: data.diagnosticsSelectionnes } });
      totalAvantRemise = diagnostics.reduce((sum, d) => {
        let surfaceMin = 0,
          surfaceMax = 0;
        if (data.surfaceMaison) {
          const match = data.surfaceMaison.match(/(\d+)\s*-\s*(\d+)/);
          surfaceMin = match ? parseInt(match[1], 10) : 0;
          surfaceMax = match ? parseInt(match[2], 10) : surfaceMin;
        }

        let tarifTrouve = null;
        if (d.tarifsParSurface?.length) {
          for (let tps of d.tarifsParSurface) {
            if (!(surfaceMax < tps.surfaceMin || surfaceMin > tps.surfaceMax)) {
              tarifTrouve = tps.tarifs[secteur] ?? tps.tarifs.autre ?? 0;
              break;
            }
          }
        }
        return sum + (Number(tarifTrouve) || 0);
      }, 0);
    } else if (data.type === "audit") {
      const tarifsAudit = {
        "0 - 70 m²": 300,
        "71 - 90 m²": 350,
        "91 - 120 m²": 400,
        "121 - 150 m²": 450,
        "151 m² et +": 500,
      };
      let surfaceKey = data.surfaceMaison || data.surfaceAppartement;
      if (!surfaceKey) return res.status(400).json({ message: "Surface requise pour un audit." });
      surfaceKey = surfaceKey.replace(/\s*-\s*/, " - ").replace(/m²$/, " m²");
      totalAvantRemise = Number(tarifsAudit[surfaceKey]) || 0;
    }

    // --- Suppléments ---
    let supplementsSelectionnes = [];
    let totalSupplements = 0;
    if (data.supplementsSelectionnes?.length) {
      const supplements = await Supplement.find({ _id: { $in: data.supplementsSelectionnes } });
      supplementsSelectionnes = supplements.map((s) => s._id);
      totalSupplements = supplements.reduce(
        (sum, s) => sum + (s.tarifs?.[secteur] ?? s.tarifs?.autre ?? 0),
        0
      );
      totalAvantRemise += totalSupplements;
    }

    // 💸 Calculs financiers
    const reductionPourcent = Number(data.reductionPourcent) || 0;
    const montantCagnotteUtilisee = Number(data.montantCagnotteUtilisee) || 0;
    const totalApresReduction = totalAvantRemise * (1 - reductionPourcent / 100);
    const totalFinal = Math.max(totalApresReduction - montantCagnotteUtilisee, 0);
    const montantTTC = totalFinal;

    console.log("===== Totaux calculés =====", {
      totalAvantRemise,
      totalApresReduction,
      totalFinal,
      montantTTC,
    });

    // 🧾 Création du devis
    const devis = new Devis({
      agenceId,
      client: {
        nom: client.nom,
        prenom: client.prenom,
        email: client.email,
        tel: client.telephone,
        adresse: client.adresse,
        ville: client.ville,
        codePostal: client.codePostal,
        pays: client.pays,
        societe: client.societe,
        siret: client.siret,
        remarques: client.remarques,
      },
      type: data.type,
      bien: data.bien,
      transaction: data.transaction,
      adresseBien: data.adresseBien,
      surfaceMaison: data.surfaceMaison,
      surfaceAppartement: data.surfaceAppartement,
      anneeConstruction: data.anneeConstruction,
      numeroFiscalBien: data.numeroFiscalBien || null,
      pack: data.pack || null,
      diagnosticsSelectionnes: data.diagnosticsSelectionnes || [],
      supplementsSelectionnes,
      numeroAdeme: data.numeroAdeme || null,
      totalAvantRemise,
      reductionPourcent,
      montantCagnotteUtilisee,
      totalApresReduction,
      totalFinal,
      payer: data.payer || "client",
      montantTTC,
      statut: data.payer === "agence" ? "Accepté" : "Envoyé",
      numero: `DV-${Date.now()}`,
      dateCreation: new Date(),
      note: data.note || "",
    });

    await devis.save();

    if (!client.devis.includes(devis._id)) {
      client.devis.push(devis._id);
      await client.save();
    }

    // ✅ Si le payeur est l’agence
    if (data.payer === "agence") {
      const facture = new Facture({
        devisId: devis._id,
        agenceId: devis.agenceId,
        numero: `F-${Date.now()}`,
        clientId: client._id,
        montantHT: devis.montantTTC,
        montantTTC: devis.montantTTC,
        statut: "Envoyée",
      });
      await facture.save();

      const ordre = new OrdreMission({
        devisId: devis._id,
        agenceId: devis.agenceId,
        numero: `OM-${Date.now()}`,
        clientId: client._id,
        description: `Ordre de mission pour le devis ${devis._id}`,
        statut: "En cours",
      });
      await ordre.save();

      const agence = await Agence.findById(devis.agenceId);
      if (agence) {
        const montantCagnotte = devis.montantTTC * 0.03;
        agence.cagnotte = (agence.cagnotte || 0) + montantCagnotte;
        await agence.save();
      }

      return res.status(201).json({
        message: "✅ Devis créé et accepté automatiquement (payeur agence).",
        devis,
      });
    }

    // 💌 Envoi de l’e-mail si le payeur est le client
    if (data.payer === "client") {
      const lienDevis = `https://dimotec.fr/devis/${devis._id}`; // 🔗 À adapter à ton frontend
      await sendEmail({
        to: client.email,
        subject: `Votre devis ${devis.numero} est prêt`,
       template: "devis.html",
        variables: {
          nomClient: `${client.prenom} ${client.nom}`,
         lienDevis: lienDevis,
          "[Adresse email]": req.agence?.email || "contact@dimotec.fr",
          "[Numéro de téléphone]": req.agence?.telephone || "06 00 00 00 00",
        },
      });
    }

    return res
      .status(201)
      .json({ message: "✅ Devis créé avec succès et e-mail envoyé au client", devis });
  } catch (error) {
    console.error("Erreur création devis :", error);
    return res
      .status(500)
      .json({ message: "Erreur serveur lors de la création du devis." });
  }
};

// 🔹 Accepter un devis via clé
// 🔹 Accepter un devis via clé
exports.accepterDevisViaLien = async (req, res) => {
  try {
    const { key, devisId } = req.params;
    console.log("🔹 acceptAndSign appelé avec :", { key, devisId });

    const devis = await Devis.findOne({ _id: devisId, accesClientKey: key });
    if (!devis) {
      console.log("❌ Devis introuvable ou clé invalide.");
      return res.status(404).json({ message: "Devis introuvable ou clé invalide." });
    }
    console.log("✅ Devis trouvé :", devis._id);

    // Mettre à jour le statut du devis
    devis.statut = "Accepté";
    await devis.save();
    console.log("✅ Statut du devis mis à jour :", devis.statut);

    // 🔹 Récupérer le client réel
    let clientId = devis.clientId;
    if (!clientId && devis.client?.email) {
      const client = await Client.findOne({ email: devis.client.email });
      if (!client) {
        console.log("❌ Client introuvable pour créer la facture.");
        return res.status(400).json({ message: "Client introuvable pour créer la facture." });
      }
      clientId = client._id;
    }
    console.log("✅ Client trouvé ou existant :", clientId);

    // 🔹 Créer une facture
    const facture = new Facture({
      devisId: devis._id,
      agenceId: devis.agenceId,
      numero: `F-${Date.now()}`,
      clientId,
      montantHT: devis.montantTTC,
      montantTTC: devis.montantTTC,
      statut: "Envoyée"
    });
    await facture.save();
    console.log("✅ Facture créée :", facture.numero);

    // 🔹 Créer un ordre de mission
    const ordre = new OrdreMission({
      devisId: devis._id,
      agenceId: devis.agenceId,
      numero: `OM-${Date.now()}`,
      clientId,
      description: `Ordre de mission pour le devis ${devis.numero}`,
      statut: "En cours"
    });
    await ordre.save();
    console.log("✅ Ordre de mission créé :", ordre.numero);

    // 🔹 Ajouter 3% du montant TTC à la cagnotte de l'agence
    const agence = await Agence.findById(devis.agenceId);
    if (agence) {
      const montantCagnotte = devis.montantTTC * 0.03; 
      agence.cagnotte = (agence.cagnotte || 0) + montantCagnotte;
      await agence.save();
      console.log(`🔹 ${montantCagnotte}€ ajoutés à la cagnotte de l'agence ${agence.nom_commercial}`);
    } else {
      console.log("❌ Agence non trouvée pour mettre à jour la cagnotte");
    }

    console.log("✅ Tout s'est bien passé. Retour au frontend.");
    return res.status(200).json({ 
      message: "✅ Devis accepté, facture et ordre de mission créés, cagnotte mise à jour", 
      devis, 
      facture, 
      ordre, 
      cagnotteAgence: agence?.cagnotte 
    });
  } catch (error) {
    console.error("❌ Erreur acceptation via lien :", error);
    return res.status(500).json({ message: "Erreur serveur." });
  }
};






// 🔹 Accéder aux devis via clé
// 🔹 Accéder aux devis via clé
exports.getDevisViaLien = async (req, res) => {
  try {
    const { key } = req.params;

    // Récupération des devis associés à la clé
    const devis = await Devis.find({ accesClientKey: key })
      .populate("client") // récupère toutes les infos du client
      .populate("pack") // si pack existant
      .populate("diagnosticsSelectionnes"); // si diagnostics existants
      // tu peux ajouter d'autres populates si nécessaire

    // Vérification de l’existence du lien
    if (!devis || devis.length === 0) {
      return res.status(404).json({ message: "Lien invalide ou expiré." });
    }

    // Vérification d’expiration du lien
    if (devis[0].accesClientExpire && devis[0].accesClientExpire < new Date()) {
      return res.status(403).json({ message: "Lien expiré." });
    }

    // Envoi direct de tous les devis trouvés
    return res.status(200).json({
      message: "✅ Devis récupérés",
      devis,
    });
  } catch (error) {
    console.error("Erreur accès devis via lien :", error);
    return res.status(500).json({ message: "Erreur serveur." });
  }
};







// 🔹 Refuser/supprimer un devis via clé
exports.refuserDevisViaLien = async (req, res) => {
  try {
    const { key, devisId } = req.params;

    const devis = await Devis.findOne({ _id: devisId, accesClientKey: key });
    if (!devis) return res.status(404).json({ message: "Devis introuvable ou clé invalide." });

    devis.statut = "Refusé";
    await devis.save();

    return res.status(200).json({ message: "✅ Devis refusé", devis });
  } catch (error) {
    console.error("Erreur refus via lien :", error);
    return res.status(500).json({ message: "Erreur serveur." });
  }
};
