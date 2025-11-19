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
const Admin = require("../models/Admin");
const Employe = require("../models/Employe")
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
    }  else if (req.role === "agence") {
      // 🏢 Agence → uniquement ses ordres de mission
      query = { agenceId: req.agence._id };
    } else if (req.role === "employe") {
      // 👨‍💻 Employé → uniquement les OM où il est creePar ou dans partageAvec
      const empId = req.user._id.toString();

      query = {
        $or: [
          { "creePar.type": "Employe", "creePar.id": empId },
        ]
      };
    }  else {
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
 * 📦 Envoyer automatiquement les rappels pour tous les devis "Envoyé" depuis plus de 48h
 */
exports.envoyerRappelsAutomatiques = async () => {
  try {
    console.log("📥 Lancement du job d'envoi des rappels...");

    const deuxJours = new Date(Date.now() - 48 * 60 * 60 * 1000);

    const devisArelancer = await Devis.find({
      statut: "Envoyé",
      $or: [
        { derniereRelance: { $lt: deuxJours } },
        { derniereRelance: null }
      ],
      'client.email': { $exists: true, $ne: "" }
    });

    console.log(`🔍 ${devisArelancer.length} devis à relancer`);

    for (const devis of devisArelancer) {
      const lienDevis = `https://dimotec.datafuse.fr/client-Devis/${devis.accesClientKey}`;

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

      devis.derniereRelance = new Date();
      await devis.save();
      console.log(`✅ Rappel envoyé pour le devis ${devis.numero}`);
    }

    console.log("✅ Tous les rappels ont été envoyés avec succès");
  } catch (error) {
    console.error("❌ Erreur lors de l'envoi automatique des rappels :", error);
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


                // 🔐 Déterminer qui crée le devis
    let creePar;
    if (req.user && req.user.role === "employe") {
      creePar = { id: req.user._id, type: "Employe" };
    } else {
      creePar = { id: agenceId, type: "Agence" };
    }


    // 🔎 Préparer les données client
    const clientPayload = {
      ...data.client,
      telephone: data.client.tel || data.client.telephone || "",
      agences: [agenceId],
    };

    delete clientPayload.tel;

    // 🏠 Si aucune adresse client fournie → utiliser l'adresse du bien
if (!clientPayload.adresse && data.adresseBien?.adresse) {
  clientPayload.adresse = data.adresseBien.adresse;
}
if (!clientPayload.ville && data.adresseBien?.ville) {
  clientPayload.ville = data.adresseBien.ville;
}
if (!clientPayload.codePostal && data.adresseBien?.codePostal) {
  clientPayload.codePostal = data.adresseBien.codePostal;
}

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
// --- Pack complet ---
if (data.type === "pack_complet" && data.pack) {
  const pack = await Pack.findById(data.pack).populate("diagnostics");
  if (!pack) return res.status(400).json({ message: "Pack invalide." });

  let tarifTrouve = 0;

  // 🏠 MAISON → tarifsParSurface
  if (data.bien === "maison" && data.surfaceMaison && pack.tarifsParSurface?.length) {
    const match = data.surfaceMaison.match(/(\d+)\s*-\s*(\d+)/);
    const surfaceMin = match ? parseInt(match[1], 10) : 0;
    const surfaceMax = match ? parseInt(match[2], 10) : surfaceMin;

    for (let tps of pack.tarifsParSurface) {
      if (!(surfaceMax < tps.surfaceMin || surfaceMin > tps.surfaceMax)) {
        tarifTrouve = tps.tarifs?.[secteur] ?? tps.tarifs?.autre ?? 0;
        break;
      }
    }
  }

  // 🏢 APPARTEMENT → tarifsParAppartement
  if (data.bien === "appartement" && data.surfaceAppartement && pack.tarifsParAppartement?.length) {
    const appart = pack.tarifsParAppartement.find(
      (t) => t.typeAppartement === data.surfaceAppartement
    );
    if (appart) {
      tarifTrouve = appart.tarifs?.[secteur] ?? appart.tarifs?.autre ?? 0;
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

  // 🔹 Ajouter les frais de déplacement sauf si ERP seul
  const isERPSeul = diagnostics.length === 1 && diagnostics[0].nom.toLowerCase().includes("erp");
  if (!isERPSeul) {
    totalAvantRemise += 55;
  }
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
    // ✅ Vérifier qu'il n'est pas déjà sélectionné
    const dejaSelectionne = data.diagnosticsSelectionnes?.includes(diagGaz._id.toString());
    if (!dejaSelectionne) {
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

      // Ajouter au total
      totalAvantRemise += tarifGaz;

      // Ajouter au tableau diagnosticsSelectionnes si nécessaire
      data.diagnosticsSelectionnes.push(diagGaz._id.toString());
    }
  }
}

    // --- Diagnostic Copropriété si applicable ---
let tarifCopro = 0;
if (data.copropriete === true) {
  const diagCopro = await Diagnostic.findOne({ nom: /surface/i }); // ou nom spécifique "copropriété"
  if (diagCopro) {
    if (data.bien === "maison" && diagCopro.tarifsParSurface?.length) {
      const match = data.surfaceMaison.match(/(\d+)\s*-\s*(\d+)/);
      const surfaceMin = match ? parseInt(match[1], 10) : 0;
      const surfaceMax = match ? parseInt(match[2], 10) : surfaceMin;

      for (let tps of diagCopro.tarifsParSurface) {
        if (!(surfaceMax < tps.surfaceMin || surfaceMin > tps.surfaceMax)) {
          tarifCopro = tps.tarifs?.[secteur] ?? tps.tarifs?.autre ?? 0;
          break;
        }
      }
    } else if (data.bien === "appartement" && diagCopro.tarifsParAppartement?.length) {
      const tps = diagCopro.tarifsParAppartement.find(t => t.typeAppartement === data.surfaceAppartement);
      if (tps) tarifCopro = tps.tarifs?.[secteur] ?? tps.tarifs?.autre ?? 0;
    }
  }
  totalAvantRemise += tarifCopro;
}


// 💸 Calculs financiers
const reductionPourcent = Number(data.reductionPourcent) || 0;
const montantCagnotteUtilisee = Number(data.montantCagnotteUtilisee) || 0;

if (montantCagnotteUtilisee > 0) {
  let cibleCagnotte = null; // peut être agence ou employé
  let auteur = 'Système';

  console.log('🔹 Début traitement cagnotte', { creePar, agenceId });

  if (creePar.type === "Agence") {
    cibleCagnotte = await Agence.findById(creePar.id);
    auteur = cibleCagnotte?.nom_commercial || 'Agence';
    console.log('🟢 Manipulation par l’Agence');
  } else if (creePar.type === "Employe") {
    const employe = await Employe.findById(creePar.id);
    auteur = req.user?.email || 'Employé';
    console.log('🟢 Manipulation par l’Employé', { employe });

    if (employe.cagnotte !== undefined) {
      cibleCagnotte = employe; // on manipule la cagnotte de l'employé
    } else {
      // fallback si pas de cagnotte individuelle
      cibleCagnotte = await Agence.findById(agenceId);
      console.log('⚠️ Pas de cagnotte individuelle, fallback sur l’agence');
    }
  }

  if (!cibleCagnotte) {
    return res.status(404).json({ message: "Cagnotte introuvable." });
  }

  console.log('🔹 Avant utilisation de la cagnotte :', {
    cagnotte: cibleCagnotte.cagnotte,
    cagnotteEnAttente: cibleCagnotte.cagnotteEnAttente,
    historique: cibleCagnotte.historiqueCagnotte || cibleCagnotte.transactions_cagnotte
  });

  const dejaEnAttente = (cibleCagnotte.historiqueCagnotte || cibleCagnotte.transactions_cagnotte)
    .filter(m => m.type === 'en_attente' && m.description.includes(`devis (${data.type || 'non spécifié'})`))
    .reduce((sum, m) => sum + m.montant, 0);

  const montantRestant = montantCagnotteUtilisee - dejaEnAttente;
  console.log('💰 Montant restant à déplacer vers en_attente:', montantRestant);

  if (montantRestant <= 0) {
    console.log('⚠️ Montant déjà en attente pour ce devis, pas de duplication');
  } else {
    if ((cibleCagnotte.cagnotte || 0) < montantRestant) {
      return res.status(400).json({ message: "Cagnotte insuffisante." });
    }

    cibleCagnotte.cagnotte -= montantRestant;
    cibleCagnotte.cagnotteEnAttente = (cibleCagnotte.cagnotteEnAttente || 0) + montantRestant;

    console.log('💸 Montant déplacé vers cagnotte en attente', {
      montantRestant,
      cagnotte: cibleCagnotte.cagnotte,
      cagnotteEnAttente: cibleCagnotte.cagnotteEnAttente
    });

    // Ajouter dans l'historique
    const mouvement = {
      type: 'en_attente',
      montant: montantRestant,
      description: `Montant mis en attente pour le devis (${data.type || 'non spécifié'})`,
      par: auteur,
      date: new Date()
    };

    if (creePar.type === "Agence") {
      cibleCagnotte.historiqueCagnotte.push(mouvement);
    } else {
      cibleCagnotte.transactions_cagnotte.push(mouvement);
    }

    console.log('📝 Historique mis à jour', mouvement);

    await cibleCagnotte.save();
    console.log('✅ Sauvegarde terminée');
  }

  console.log('🔹 Fin traitement cagnotte');
}








    const totalApresReduction = totalAvantRemise * (1 - reductionPourcent / 100);
    const totalFinal = Math.max(totalApresReduction - montantCagnotteUtilisee, 0);
    const montantTTC = totalFinal;

    console.log("===== Totaux calculés =====", { totalAvantRemise, totalApresReduction, totalFinal, montantTTC });



    // 🧾 Création du devis
    const devis = new Devis({
      agenceId,
      creePar,
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
       copropriete: data.copropriete === true,  // ✅ nouveau champ
  tarifCopropriete: tarifCopro,
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
// ✅ Si le payeur est l’agence
if (data.payer === "agence") {
  const facture = new Facture({
    devisId: devis._id,
    agenceId: devis.agenceId,
    numero: `F-${Date.now()}`,
    clientId: client._id,
    montantHT: devis.totalFinal,
    montantTTC: devis.totalFinal,
    statut: "Envoyée",
  });
  await facture.save();

  const ordre = new OrdreMission({
    devisId: devis._id,
    agenceId: devis.agenceId,
    numero: `OM-${Date.now()}`,
    clientId: client._id,
    description: `Ordre de mission pour le devis ${devis.numero}`,
    statut: "Commande",
     creePar
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

  // ✅ Emails
  const agence = await Agence.findById(devis.agenceId);
  const agenceEmail = agence?.emails_contact?.[0]?.email || null;
  const dimotecEmail = "dimotec34@gmail.com";

  const variables = {
    nomClient: `${devis.client.prenom} ${devis.client.nom}`,
    numero: ordre.numero,
    devisNumero: devis.numero,
    nomAgence: agence?.nom_commercial || "",
    dateCreation: new Date().toLocaleDateString("fr-FR"),
    description: ordre.description,
    statut: ordre.statut,
    lienMission: `https://dimotec.datafuse.fr/ordre-mission`
  };

  // ✅ Envoi mail à l’agence si disponible
  if (agenceEmail) {
    await sendEmail({
      to: agenceEmail,
      subject: `Nouvel Ordre de Mission - ${ordre.numero}`,
      template: "OrdreMission.html",
      variables
    });
  }

  // ✅ Envoi mail Dimotec systématique
  await sendEmail({
    to: dimotecEmail,
    subject: `Nouvel Ordre de Mission - ${ordre.numero}`,
    template: "OrdreMission.html",
    variables
  });



  return res.status(201).json({
    message: "✅ Devis créé, accepté automatiquement et ordre envoyé (payeur agence).",
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

    const devis = await Devis.findOne({ _id: devisId, accesClientKey: key });
    if (!devis) return res.status(404).json({ message: "Devis introuvable ou clé invalide." });

    // ✅ Mise à jour du devis
    devis.statut = "Accepté";
    if (ville) devis.faitA = ville;
    if (date) devis.dateAcceptation = new Date(date);
    if (numeroFiscalBien) devis.numeroFiscalBien = numeroFiscalBien;
    devis.cgvAccepted = true;
    devis.rgpdAccepted = true;
    await devis.save();

    // 🔹 Trouver client réel si pas encore lié
    let clientId = devis.clientId;
    if (!clientId && devis.client?.email) {
      const client = await Client.findOne({ email: devis.client.email });
      if (!client) return res.status(400).json({ message: "Client introuvable pour créer la facture." });
      clientId = client._id;
    }


    // ✅ Création Ordre de Mission
    const ordre = new OrdreMission({
      devisId: devis._id,
      agenceId: devis.agenceId,
      numero: `OM-${Date.now()}`,
      clientId,
      description: `Ordre de mission pour le devis ${devis.numero}`,
      statut: "Commande",
      creePar: devis.creePar,
    });
    await ordre.save();

    const agence = await Agence.findById(devis.agenceId);

    // 🔹 Gestion de la cagnotte après acceptation
    if (devis.montantCagnotteUtilisee > 0) {
      console.log('💰 Début traitement retrait cagnotte pour devis accepté');

      let cible = null;
      let auteur = 'Système';

      if (agence.type_cagnotte === 'individuelle' && devis.creePar.type === 'Employe') {
        // 🔹 Cagnotte individuelle : retirer à l'employé
        cible = await Employe.findById(devis.creePar.id);
        auteur = cible?.email || 'Employé';
        if (!cible) return res.status(404).json({ message: "Employé introuvable pour retrait cagnotte." });

        console.log('🟢 Retrait cagnotte individuelle de l’employé :', auteur);

        const montantEnAttente = cible.cagnotteEnAttente || 0;
        const montantARetirer = Math.min(montantEnAttente, devis.montantCagnotteUtilisee);

        if (montantARetirer > 0) {
          cible.cagnotteEnAttente -= montantARetirer;


          cible.transactions_cagnotte.push({
            montant: montantARetirer,
            type: 'retrait',
            description: `Montant utilisé pour le devis accepté (${devis.type})`,
            reference: devis._id,
            date: new Date()
          });

          await cible.save();
          console.log('✅ Cagnotte employé mise à jour', {
            cagnotte: cible.cagnotte,
            cagnotteEnAttente: cible.cagnotteEnAttente
          });
        }

      } else {
        // 🔹 Cagnotte partagée ou agence créatrice
        cible = agence;
        auteur = agence.nom_commercial;

        console.log('🟢 Retrait cagnotte partagée de l’agence');

        const montantEnAttente = agence.cagnotteEnAttente || 0;
        const montantARetirer = Math.min(montantEnAttente, devis.montantCagnotteUtilisee);

        if (montantARetirer > 0) {
          agence.cagnotteEnAttente -= montantARetirer;


          agence.historiqueCagnotte.push({
            montant: montantARetirer,
            type: 'retrait',
            description: `Montant utilisé pour le devis accepté (${devis.type})`,
            par: auteur,
            date: new Date()
          });

          await agence.save();
          console.log('✅ Cagnotte agence mise à jour', {
            cagnotte: agence.cagnotte,
            cagnotteEnAttente: agence.cagnotteEnAttente
          });
        }
      }
      console.log('🔹 Fin traitement cagnotte pour devis accepté');
    }

    // ✅ Email Agence
    const agenceEmail = agence.emails_contact?.[0]?.email || null;
    const variables = {
      nomClient: `${devis.client.prenom} ${devis.client.nom}`,
      numero: ordre.numero,
      devisNumero: devis.numero,
      nomAgence: agence.nom_commercial,
      dateCreation: new Date().toLocaleDateString("fr-FR"),
      description: ordre.description,
      statut: ordre.statut,
      lienMission: `https://dimotec.datafuse.fr/ordre-mission`
    };

    if (agenceEmail) {
      await sendEmail({
        to: agenceEmail,
        subject: `Nouvel Ordre de Mission - ${ordre.numero}`,
        template: "OrdreMission.html",
        variables
      });
    }

    // ✅ Envoi email → Dimotec
    const dimotec = "dimotec34@gmail.com"
    await sendEmail({
      to: dimotec,
      subject: `Nouvel Ordre de Mission - ${ordre.numero}`,
      template: "OrdreMission.html",
      variables
    });

    return res.status(200).json({
      message: "✅ Devis accepté, facture & ordre de mission créés, mails envoyés, cagnotte mise à jour.",
      devis,
      ordre,
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
        diagnostics.push({ nom: diagGaz.nom, prixHT, prixTTC });
      }
    }

    // -------- COPROPRIÉTÉ --------
    if (devis.copropriete) {
      const prixTTC = Number(devis.tarifCopropriete || 0);
      const prixHT = +(prixTTC / 1.2).toFixed(2);
      diagnostics.push({ nom: "Supplément copropriété", prixHT, prixTTC });
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
      let prixTTC = 0;

      // 🏠 MAISON
      if (devis.bien === "maison" && devis.pack.tarifsParSurface?.length) {
        const tranche = devis.pack.tarifsParSurface.find(
          t => surface >= t.surfaceMin && surface <= t.surfaceMax
        );
        prixTTC = tranche?.tarifs?.[secteur] ?? tranche?.tarifs?.autre ?? 0;
      }

      // 🏢 APPARTEMENT
      if (devis.bien === "appartement" && devis.pack.tarifsParAppartement?.length) {
        const appart = devis.pack.tarifsParAppartement.find(
          t => t.typeAppartement === surfaceStr
        );
        prixTTC = appart?.tarifs?.[secteur] ?? appart?.tarifs?.autre ?? 0;
      }

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

    const devisObj = devis.toObject();
    devisObj.diagnosticsSelectionnes = diagnostics;
    devisObj.supplementsSelectionnes = supplements;
    devisObj.pack = pack;

    return res.status(200).json({
      message: "✅ Devis récupéré",
      devis: devisObj
    });

  } catch (error) {
    console.error("🚨 Erreur accès devis via lien :", error);
    return res.status(500).json({ message: "Erreur serveur." });
  }
};


/**
 * Supprimer un devis
 */
exports.deleteDevis = async (req, res) => {
  try {
    const devisId = req.params.id;

    // Vérifier que le devis existe
    const devis = await Devis.findById(devisId);
    if (!devis) {
      return res.status(404).json({ message: "Devis introuvable." });
    }

    // Vérifier l'autorisation
    if (req.admin) {
      // Admin peut tout supprimer
    } else if (req.role === "agence" && devis.agenceId.toString() !== req.agence._id.toString()) {
      return res.status(403).json({ message: "Vous n'avez pas la permission de supprimer ce devis." });
    } else {
      return res.status(403).json({ message: "Vous n'avez pas la permission de supprimer ce devis." });
    }

    // Supprimer le devis
    await Devis.findByIdAndDelete(devisId);

    res.json({ message: "Devis supprimé avec succès." });
  } catch (error) {
    console.error("Erreur suppression devis :", error);
    res.status(500).json({ message: "Erreur serveur." });
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
