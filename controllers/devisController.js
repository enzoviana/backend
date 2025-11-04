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
const Supplement = require("../models/Supplement")
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
 * 📧 Envoyer un rappel au client pour un devis
 */
exports.envoyerRappelDevis = async (req, res) => {
  try {
    console.log("📥 Requête reçue pour envoyer un rappel");

    const { id } = req.params;
    console.log("🔍 ID du devis :", id);

    // ✅ Trouver le devis
    const devis = await Devis.findById(id);
    console.log("📄 Devis trouvé :", devis ? "OUI" : "NON");

    if (!devis) {
      console.log("❌ Aucun devis trouvé avec cet ID");
      return res.status(404).json({ message: "Devis introuvable." });
    }

    // ✅ Vérification email client
    console.log("📧 Email client :", devis.client?.email || "Aucun email");
    if (!devis.client?.email) {
      console.log("❌ Devis sans email client → envoi annulé");
      return res.status(400).json({ message: "Ce devis n'a pas d'e-mail client associé." });
    }

    // 🔗 Lien client
    const lienDevis = `https://dimotec.datafuse.fr/client-Devis/${devis.accesClientKey}`;
    console.log("🔗 Lien du devis envoyé au client :", lienDevis);

    // 💌 Envoi e-mail
    console.log("📨 Envoi de l'e-mail en cours...");
    await sendEmail({
      to: devis.client.email,
      subject: `Rappel concernant votre devis ${devis.numero}`,
      template: "rappel.html",
      variables: {
        nomClient: `${devis.client.prenom} ${devis.client.nom}`,
        numeroDevis: devis.numero,
        lienDevis
      }
    });
    console.log("✅ E-mail envoyé avec succès");

    // 🕒 Mise à jour date de dernière relance
    devis.derniereRelance = new Date();
    await devis.save();
    console.log("🗂 Dernière relance mise à jour :", devis.derniereRelance);

    console.log("✅ Processus de rappel terminé avec succès");
    return res.status(200).json({
      message: "✅ Rappel envoyé avec succès.",
      derniereRelance: devis.derniereRelance
    });

  } catch (error) {
    console.error("❌ Erreur lors de l'envoi du rappel :", error);
    return res.status(500).json({ message: "Erreur serveur lors de l'envoi du rappel." });
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

    // 🔎 Préparer les données client
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

    const secteur = (req.agence?.alerte_secteur || "autre")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");

    // 💰 Calcul du montant avant remise
    let totalAvantRemise = 0;

    // --- Pack complet ---
    if (data.type === "pack_complet" && data.pack) {
      const pack = await Pack.findById(data.pack).populate("diagnostics");
      if (!pack) return res.status(400).json({ message: "Pack invalide." });

      let surfaceMin = 0, surfaceMax = 0;
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
    } 
    // --- Diagnostics ---
    else if (data.type === "diagnostic" && data.diagnosticsSelectionnes?.length) {
      const diagnostics = await Diagnostic.find({ _id: { $in: data.diagnosticsSelectionnes } });
      totalAvantRemise = diagnostics.reduce((sum, d) => {
        let tarifTrouve = 0;

        if (data.bien === "maison" && d.tarifsParSurface?.length) {
          let surfaceMin = 0, surfaceMax = 0;
          if (data.surfaceMaison) {
            const match = data.surfaceMaison.match(/(\d+)\s*-\s*(\d+)/);
            surfaceMin = match ? parseInt(match[1], 10) : 0;
            surfaceMax = match ? parseInt(match[2], 10) : surfaceMin;
          }

          for (let tps of d.tarifsParSurface) {
            if (!(surfaceMax < tps.surfaceMin || surfaceMin > tps.surfaceMax)) {
              tarifTrouve = tps.tarifs[secteur] ?? tps.tarifs.autre ?? 0;
              break;
            }
          }
        } else if (data.bien === "appartement" && d.tarifsParAppartement?.length) {
          const typeAppart = data.surfaceAppartement;
          const tarifAppart = d.tarifsParAppartement.find(t => t.typeAppartement === typeAppart);
          if (tarifAppart) tarifTrouve = tarifAppart.tarifs[secteur] ?? tarifAppart.tarifs.autre ?? 0;
        }

        return sum + (Number(tarifTrouve) || 0);
      }, 0);

      // 🔹 Ajouter les frais de déplacement
      totalAvantRemise += 55;
    } 
    // --- Audit ---
    else if (data.type === "audit") {
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

    // --- Diagnostic Gaz si applicable ---
    let tarifGaz = 0;
    if (data.installationGaz === true) {
      const diagGaz = await Diagnostic.findOne({ nom: /gaz/i });
      if (diagGaz) {
        if (data.bien === "maison" && diagGaz.tarifsParSurface?.length) {
          const match = data.surfaceMaison.match(/(\d+)\s*-\s*(\d+)/);
          const surfaceMin = match ? parseInt(match[1], 10) : 0;
          const surfaceMax = match ? parseInt(match[2], 10) : surfaceMin;
          for (let tps of diagGaz.tarifsParSurface) {
            if (!(surfaceMax < tps.surfaceMin || surfaceMin > tps.surfaceMax)) {
              tarifGaz = tps.tarifs?.[secteur] ?? tps.tarifs?.autre ?? 0;
              break;
            }
          }
        } else if (data.bien === "appartement" && diagGaz.tarifsParAppartement?.length) {
          const typeAppart = data.surfaceAppartement;
          const tps = diagGaz.tarifsParAppartement.find(t => t.typeAppartement === typeAppart);
          if (tps) tarifGaz = tps.tarifs?.[secteur] ?? tps.tarifs?.autre ?? 0;
        }
      }
      totalAvantRemise += tarifGaz;
    }

    // 💸 Calculs financiers
    const reductionPourcent = Number(data.reductionPourcent) || 0;
    const montantCagnotteUtilisee = Number(data.montantCagnotteUtilisee) || 0;
    const totalApresReduction = totalAvantRemise * (1 - reductionPourcent / 100);
    const totalFinal = Math.max(totalApresReduction - montantCagnotteUtilisee, 0);
    const montantTTC = totalFinal;

    console.log("===== Totaux calculés =====", { totalAvantRemise, totalApresReduction, totalFinal, montantTTC });

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
      chauffageGaz: data.installationGaz === true, // ✅ true/false
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
        statut: "Commande",
      });

      if (req.file) {
        ordre.fichiersClient.push({
          nom: req.file.originalname,
          url: req.file.path,
          public_id: req.file.filename || req.file.public_id,
          dateDepot: new Date(),
        });
      }
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
      const lienDevis = `https://dimotec.datafuse.fr/client-Devis/${devis.accesClientKey}`;
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

    return res.status(201).json({
      message: "✅ Devis créé avec succès et e-mail envoyé au client",
      devis,
    });

  } catch (error) {
    console.error("Erreur création devis :", error);
    return res.status(500).json({ message: "Erreur serveur lors de la création du devis." });
  }
};


// 🔹 Accepter un devis via clé
// 🔹 Accepter un devis via clé
exports.accepterDevisViaLien = async (req, res) => {
  try {
    const { key, devisId } = req.params;
    const { ville, date, numeroFiscalBien } = req.body;
    console.log("🔹 acceptAndSign appelé avec :", { key, devisId, ville, date, numeroFiscalBien });

    const devis = await Devis.findOne({ _id: devisId, accesClientKey: key });
    if (!devis) {
      console.log("❌ Devis introuvable ou clé invalide.");
      return res.status(404).json({ message: "Devis introuvable ou clé invalide." });
    }
    console.log("✅ Devis trouvé :", devis._id, "Statut avant update :", devis.statut);

    // 🔹 Mettre à jour le statut du devis et les champs ville / date / numéro fiscal
    devis.statut = "Accepté";

    if (ville) {
      devis.faitA = ville;
      console.log("📍 faitA mis à jour :", devis.faitA);
    }

    if (date) {
      devis.dateAcceptation = new Date(date);
      console.log("📅 dateAcceptation mis à jour :", devis.dateAcceptation);
    }

    if (numeroFiscalBien) {
      devis.numeroFiscalBien = numeroFiscalBien;
      console.log("💰 numeroFiscalBien mis à jour :", devis.numeroFiscalBien);
    }

    // ✅ Forcer CGV et RGPD à true
    devis.cgvAccepted = true;
    devis.rgpdAccepted = true;
    console.log("✅ CGV et RGPD mis à jour :", { cgvAccepted: devis.cgvAccepted, rgpdAccepted: devis.rgpdAccepted });

    await devis.save();
    console.log("✅ Devis sauvegardé :", {
      statut: devis.statut,
      faitA: devis.faitA,
      dateAcceptation: devis.dateAcceptation,
      numeroFiscalBien: devis.numeroFiscalBien,
      cgvAccepted: devis.cgvAccepted,
      rgpdAccepted: devis.rgpdAccepted
    });

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
      statut: "Commande"
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
      message: "✅ Devis accepté, CGV/RGPD validés, facture et ordre de mission créés, cagnotte mise à jour", 
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



// 🔹 Upload PDF d'un devis vers Cloudinary
exports.uploadPdfDevis = async (req, res) => {
  try {
    const { devisId } = req.params;

    if (!req.file) {
      return res.status(400).json({ message: "Aucun fichier PDF reçu." });
    }

    const pdfUrl = req.file.path; // URL Cloudinary

    // Mettre à jour le devis avec le lien du PDF
    const devis = await Devis.findByIdAndUpdate(
      devisId,
      { pdfUrl },
      { new: true }
    );

    if (!devis) {
      return res.status(404).json({ message: "Devis introuvable." });
    }

    return res.status(200).json({
      message: "PDF du devis uploadé avec succès !",
      pdfUrl,
      devis
    });
  } catch (err) {
    console.error("❌ Erreur uploadPdfDevis :", err);
    return res.status(500).json({ message: "Erreur lors de l'upload du PDF." });
  }
};


// 🔹 Upload signature image (base64 → Cloudinary)
exports.uploadSignature = async (req, res) => {
  try {
    const { devisId } = req.params;
    const { image, ville, date } = req.body;

    if (!image) return res.status(400).json({ message: "Signature manquante." });

    // Upload Cloudinary (image base64)
    const cloudinary = require("../config/cloudinary"); // adapte si ton chemin diffère

    const result = await cloudinary.uploader.upload(image, {
      folder: "signatures_devis",
      public_id: `signature_${devisId}`,
      overwrite: true
    });

    const devis = await Devis.findByIdAndUpdate(
      devisId,
      { signatureUrl: result.secure_url, signatureVille: ville, signatureDate: date },
      { new: true }
    );

    if (!devis) return res.status(404).json({ message: "Devis introuvable." });

    return res.status(200).json({
      message: "✅ Signature enregistrée",
      signatureUrl: result.secure_url
    });

  } catch (error) {
    console.error("❌ Erreur uploadSignature :", error);
    return res.status(500).json({ message: "Erreur lors de l’upload de la signature." });
  }
};



// 🔹 Accéder aux devis via clé
// 🔹 Accéder aux devis via clé
// 🔹 Accéder aux devis via clé
exports.getDevisViaLien = async (req, res) => {
  try {
    const { key } = req.params;

    const devis = await Devis.findOne({ accesClientKey: key })
      .populate("client")
      .populate({
        path: "pack",
        populate: [
          { path: "diagnostics", model: "Diagnostic" },
          { path: "supplementsDisponibles", model: "Supplement" }
        ]
      })
      .populate("diagnosticsSelectionnes")
      .populate("supplementsSelectionnes")
      .populate({
        path: "agenceId",
        model: "Agence",
        select: "nom_commercial nom_responsable adresse telephone_fixe emails_contact siret activite logo alerte_secteur statut reduction"
      });

    if (!devis) {
      return res.status(404).json({ message: "Lien invalide ou expiré." });
    }

    const secteur = (devis.agenceId?.alerte_secteur || "autre")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");

    const surfaceStr = devis.surfaceMaison || devis.surfaceAppartement || "0";
    const surface = parseInt(surfaceStr.split(" ")[0], 10) || 0;

    // -------- DIAGNOSTICS SELECTIONNÉS --------
    const diagnostics = (devis.diagnosticsSelectionnes || [])
      .filter(Boolean)
      .map(diag => {
        let prixTTC = 0;
        if (devis.bien === "maison" && diag.tarifsParSurface?.length) {
          const tranche = diag.tarifsParSurface.find(
            t => surface >= t.surfaceMin && surface <= t.surfaceMax
          );
          prixTTC = tranche?.tarifs?.[secteur] ?? tranche?.tarifs?.autre ?? 0;
        } else if (devis.bien === "appartement" && diag.tarifsParAppartement?.length) {
          const tranche = diag.tarifsParAppartement.find(
            t => t.typeAppartement === surfaceStr
          );
          prixTTC = tranche?.tarifs?.[secteur] ?? tranche?.tarifs?.autre ?? 0;
        }
        const prixHT = +(prixTTC / 1.2).toFixed(2);
        return { nom: diag.nom, prixHT, prixTTC };
      });

    // -------- DIAGNOSTIC GAZ --------
    let diagGazObj = null;
    if (devis.chauffageGaz) {
      const diagGaz = await Diagnostic.findOne({ nom: /gaz/i });
      if (diagGaz) {
        let prixTTC = 0;
        if (devis.bien === "maison" && diagGaz.tarifsParSurface?.length) {
          const tranche = diagGaz.tarifsParSurface.find(
            t => surface >= t.surfaceMin && surface <= t.surfaceMax
          );
          prixTTC = tranche?.tarifs?.[secteur] ?? tranche?.tarifs?.autre ?? 0;
        } else if (devis.bien === "appartement" && diagGaz.tarifsParAppartement?.length) {
          const tranche = diagGaz.tarifsParAppartement.find(
            t => t.typeAppartement === surfaceStr
          );
          prixTTC = tranche?.tarifs?.[secteur] ?? tranche?.tarifs?.autre ?? 0;
        }
        const prixHT = +(prixTTC / 1.2).toFixed(2);
        diagGazObj = { nom: diagGaz.nom, prixHT, prixTTC };
        diagnostics.push(diagGazObj); // ajouter à la liste finale
      }
    }

    // -------- SUPPLÉMENTS SELECTIONNÉS --------
    const supplements = (devis.supplementsSelectionnes || [])
      .filter(Boolean)
      .map(sup => {
        const prixTTC = sup.tarifs?.[secteur] ?? sup.tarifs?.autre ?? 0;
        const prixHT = +(prixTTC / 1.2).toFixed(2);
        return { nom: sup.nom, prixHT, prixTTC };
      });

    // -------- PACK --------
    let pack = null;
    if (devis.pack) {
      const tranche = (devis.pack.tarifsParSurface || []).find(
        t => surface >= t.surfaceMin && surface <= t.surfaceMax
      );
      const prixTTC = tranche?.tarifs?.[secteur] ?? tranche?.tarifs?.autre ?? 0;
      const prixHT = +(prixTTC / 1.2).toFixed(2);

      const diagnosticsPack = (devis.pack.diagnostics || []).map(diag => {
        let diagPrixTTC = 0;
        if (devis.bien === "maison" && diag.tarifsParSurface?.length) {
          const t = diag.tarifsParSurface.find(
            tr => surface >= tr.surfaceMin && surface <= tr.surfaceMax
          );
          diagPrixTTC = t?.tarifs?.[secteur] ?? t?.tarifs?.autre ?? 0;
        } else if (devis.bien === "appartement" && diag.tarifsParAppartement?.length) {
          const t = diag.tarifsParAppartement.find(
            ta => ta.typeAppartement === surfaceStr
          );
          diagPrixTTC = t?.tarifs?.[secteur] ?? t?.tarifs?.autre ?? 0;
        }
        const diagPrixHT = +(diagPrixTTC / 1.2).toFixed(2);
        return { nom: diag.nom, prixHT: diagPrixHT, prixTTC: diagPrixTTC };
      });

      pack = { nom: devis.pack.nom, prixHT, prixTTC, diagnosticsPack };
    }

    // Conversion en objet simple pour remplacer les listes par les objets recalculés
    const devisObj = devis.toObject();
    devisObj.diagnosticsSelectionnes = diagnostics;
    devisObj.supplementsSelectionnes = supplements;
    devisObj.pack = pack;

    console.log("\n✅ Résultat final recalculé :", devisObj);

    return res.status(200).json({
      message: "✅ Devis récupéré",
      devis: devisObj
    });

  } catch (error) {
    console.error("🚨 Erreur accès devis via lien :", error);
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
