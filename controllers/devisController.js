// controllers/devisController.js
require('dotenv').config();
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
const cloudinary = require("../config/cloudinary"); // ton fichier cloudinary.js 
const OpenAI = require("openai");

const dns = require("dns");
const net = require("net");

async function smtpVerifyEmail(email) {
  const domain = email.split("@")[1];
  if (!domain) return false;

  try {
    const mxRecords = await dns.promises.resolveMx(domain);
    if (!mxRecords || mxRecords.length === 0) return false;

    // Tri : on prend le serveur MX avec la priorité la plus basse
    const mx = mxRecords.sort((a, b) => a.priority - b.priority)[0];

    return await new Promise((resolve) => {
      const socket = net.createConnection(25, mx.exchange);

      socket.setTimeout(5000);

      socket.on("error", () => resolve(false));
      socket.on("timeout", () => {
        socket.destroy();
        resolve(false);
      });

      socket.on("connect", () => {
        socket.write("HELO dimotec.fr\r\n");
        socket.write("MAIL FROM:<verification@dimotec.fr>\r\n");
        socket.write(`RCPT TO:<${email}>\r\n`);
      });

      socket.on("data", (data) => {
        const msg = data.toString();

        if (/250 2.1.5/.test(msg)) {
          socket.end();
          resolve(true); // ✔️ Email existe
        }

        if (/550/.test(msg) || /551/.test(msg) || /553/.test(msg)) {
          socket.end();
          resolve(false); // ❌ Email invalide
        }
      });
    });
  } catch (err) {
    return false;
  }
}




/**
 * Récupérer tous les devis de l'utilisateur connecté
 * req.admin ou req.agence doit être défini par le middleware
 */
exports.getDevis = async (req, res) => {
  try {
    let query = {};

    // --- Définition de la query selon le rôle ---
    if (req.user.role === "admin") {
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

    // --- Récupération des devis ---
    const devis = await Devis.find(query)
      .populate("pack")
      .populate("diagnosticsSelectionnes")
      .populate({
        path: "agenceId",
        select: "nom_commercial"
      })
      .sort({ dateCreation: -1 })
      .lean();
      

    // --- Ajout du statut de l'ordre de mission pour chaque devis ---
    const devisWithOrdre = await Promise.all(devis.map(async (d) => {
      const ordre = await OrdreMission.findOne({ devisId: d._id }).select('statut');

      return {
        _id: d._id,
        numero: d.numero || `DV-${d._id.slice(-4)}`,
        nomAgence: d.agenceId?.nom_commercial || 'DIMOTEC',
        pack: d.pack || null,
        diagnosticsSelectionnes: d.diagnosticsSelectionnes || [],
        montantTTC: d.montantTTC || 0,
        totalApresReduction: d.totalApresReduction || 0,
        statut: d.statut || 'Envoyé',
       locataire: d.locataire ? {
        nom: d.locataire.nom || "",
        prenom: d.locataire.prenom || "",
        tel: d.locataire.tel || ""
    } : null,

    adresseBien: d.adresseBien ? {
        adresse: d.adresseBien.adresse || "",
        codePostal: d.adresseBien.codePostal || "",
        ville: d.adresseBien.ville || "",
        etage: d.adresseBien.etage || "",
        complement: d.adresseBien.complement || "",
        parcelle: d.adresseBien.parcelle || null
    } : null,
      note: d.note || null,
      numeroFiscalBien: d.numeroFiscalBien || null,
        client: d.client || null,
        dateCreation: d.dateCreation || d.createdAt || new Date(),
        accesClientKey: d.accesClientKey || null,
        ordreMissionStatut: ordre?.statut || "Aucune", // ← jamais null
        derniereRelance: d.derniereRelance || null,
        pdfUrl : d.pdfUrl || null
      };
    }));

    res.json(devisWithOrdre);

  } catch (error) {
    console.error("Erreur récupération devis :", error);
    res.status(500).json({ message: "Erreur serveur." });
  }
};
 
exports.downloadDevis = async (req, res) => {
  try {
    const { devisId } = req.params;

    // Cherche le devis dans la BDD
    const devis = await Devis.findById(devisId);
    if (!devis || !devis.pdfUrl) {
      return res.status(404).json({ message: "Devis introuvable ou PDF manquant." });
    }

    console.log("📂 Devis trouvé :", devis.pdfUrl);

    // Récupère le public_id depuis l'URL Cloudinary
    const parts = devis.pdfUrl.split('/upload/')[1]; // ex: v1761131512/monfolder/mondevis.pdf
    const publicId = parts.replace(/^v\d+\//, '');     // ex: monfolder/mondevis.pdf

    // Génère le lien signé Cloudinary pour téléchargement
    const downloadUrl = cloudinary.url(publicId, {
      resource_type: 'raw', // PDF = raw
      sign_url: true,
      expires_at: Math.floor(Date.now() / 1000) + 60 * 10 // lien valable 10 min
    });

    console.log("➡️ Lien signé Cloudinary :", downloadUrl);

    // Redirection vers le lien signé
    res.redirect(downloadUrl);

  } catch (error) {
    console.error("❌ Erreur téléchargement devis :", error);
    res.status(500).json({ message: "Erreur serveur lors du téléchargement." });
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

    // 🔥 Vérifier si le devis a plus de 30 jours
    const dateDevis = new Date(devis.createdAt || devis.dateCreation);
    const maintenant = new Date();
    const diffTemps = maintenant - dateDevis; // différence en ms
    const diffJours = diffTemps / (1000 * 60 * 60 * 24); // conversion en jours

    if (diffJours > 30) {
      console.log(`⏰ Devis de plus de 30 jours (${Math.floor(diffJours)} jours) → passage en refusé`);
      devis.statut = "Refusé"; // ou "REFUSE" selon ton modèle
      await devis.save();
      return res.status(200).json({
        message: "Le devis a plus de 30 jours et a été automatiquement refusé.",
        statut: devis.statut
      });
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
 * 🧾 Générer un devis recommandé via OpenAI en extrayant les infos depuis le prompt
 */
exports.generateDevisAI = async (req, res) => {
  try {
    console.log("📌 Requête reçue pour génération de devis AI");

    const data = typeof req.body.data === "string" ? JSON.parse(req.body.data) : req.body.data || req.body;
    console.log("📄 Données reçues :", data);

    let bien = data.bien || {};
    let productMode = data.productMode || ""; // pack / diagnostic / supplement / manuel
    let trancheAnnee;

    // Extraction depuis le prompt si nécessaire
    if (data.prompt) {
      console.log("📝 Prompt détecté :", data.prompt);
      const promptLower = data.prompt.toLowerCase();

      /**
       * 📌 DÉTECTION DU MODE DE PRODUIT DEMANDÉ
       */
      if (!productMode) {
        if (/pack|formule|tout compris|complet/i.test(promptLower)) productMode = "pack";
        else if (/diagnostic|dpe|amiante|plomb|termites|gaz|électricité|electricite|erp|ernmt/i.test(promptLower)) productMode = "diagnostic";
        else if (/supplément|option|express|plan|photo|drone|relevé/i.test(promptLower)) productMode = "supplement";
        else productMode = "manuel";
      }

      // Détection du type de bien
      if (!bien.bien) {
        const bienMatch = data.prompt.match(/Le bien est un[e]? (\w+)/i);
        bien.bien = bienMatch ? bienMatch[1].trim().toLowerCase() : "";
      }

      // Année → Tranche
      const anneeMatch = data.prompt.match(/construit[e]? en (\d{4})/i);
      if (anneeMatch) {
        const annee = parseInt(anneeMatch[1], 10);
        if (annee < 1949) trancheAnnee = "avant_1949";
        else if (annee <= 1997) trancheAnnee = "1949_1997";
        else if (annee <= 2012) trancheAnnee = "1juillet1997_plus15";
        else trancheAnnee = "moins_15";
      }

      // Transaction
      const transactionMatch = data.prompt.match(/op[eé]ration\s*[: ]\s*(vente|location)/i);
      bien.transaction = transactionMatch ? transactionMatch[1].toLowerCase() : "vente";

      // Adresse
      const adresseMatch = data.prompt.match(/situé[e]? au (.+?), (\d{5}) (.+)\./i);
      bien.adresseBien = {
        adresse: adresseMatch ? adresseMatch[1] : "",
        codePostal: adresseMatch ? adresseMatch[2] : "",
        ville: adresseMatch ? adresseMatch[3] : "",
      };

      // Surface (ex: T2, T3…)
      const surfaceMatch = data.prompt.match(/Surface\s*:\s*(T\d+)/i);
      bien.surfaceAppartement = surfaceMatch ? surfaceMatch[1] : "";

      console.log("🏠 Type de bien :", bien.bien);
      console.log("📆 Tranche année :", trancheAnnee);
      console.log("💰 Transaction :", bien.transaction);
      console.log("🎯 ProductMode détecté :", productMode);
    }


    // Récupérer packs, diagnostics, suppléments
    let packs = await Pack.find({ typeBien: bien.bien, trancheAnnee, typeOperation: bien.transaction }).populate("diagnostics");
    let diagnostics = await Diagnostic.find({ typeBien: bien.bien, trancheAnnee, typeOperation: bien.transaction });
    const supplements = await Supplement.find({ typeBien: bien.bien });

    if (packs.length === 0) packs = [{ nom: "Pack standard", _id: "fallback-pack", tarifs: { var: 0, herault: 0, autre: 0 } }];

    // Compléter diagnostics selon gaz et copro
    let diagnosticsFiltres = [...diagnostics];
    if (data.installationGaz) {
      const diagGaz = diagnostics.find(d => /gaz/i.test(d.nom));
      if (diagGaz && !diagnosticsFiltres.includes(diagGaz)) diagnosticsFiltres.push(diagGaz);
    }
    if (data.copropriete) {
      const diagCopro = diagnostics.find(d => /copropriété|surface/i.test(d.nom));
      if (diagCopro && !diagnosticsFiltres.includes(diagCopro)) diagnosticsFiltres.push(diagCopro);
    }

    // Détection des diagnostics précis dans le prompt
    if (data.prompt) {
      const promptLower = data.prompt.toLowerCase();

      const demandeDiagnostics = diagnostics
        .filter(d => d.typeBien === bien.bien && d.typeOperation === bien.transaction)
        .filter(d => {
          const nameLower = d.nom.toLowerCase();
          return promptLower.includes(nameLower) ||
                 (/dpe/.test(promptLower) && /dpe/.test(nameLower)) ||
                 (/amiante/.test(promptLower) && /amiante/.test(nameLower)) ||
                 (/plomb/.test(promptLower) && /plomb/.test(nameLower)) ||
                 (/termites/.test(promptLower) && /termites/.test(nameLower)) ||
                 (/gaz/.test(promptLower) && /gaz/.test(nameLower)) ||
                 (/élec|elect/.test(promptLower) && /élec|elect/.test(nameLower)) ||
                 (/erp|ernmt/.test(promptLower) && /erp|ernmt/.test(nameLower));
        });

      // Supprimer doublons
      if (demandeDiagnostics.length > 0) {
        diagnosticsFiltres = [...new Map(demandeDiagnostics.map(d => [d._id, d])).values()];
        productMode = "diagnostic"; // seulement si diagnostics détectés
      }
    }

    // Par défaut → PACK si rien détecté
    if (!productMode) productMode = "pack";

    // Prompt OpenAI
    const promptOpenAI = `
Tu es un assistant expert en devis immobiliers.
Le bien est un(e) ${bien.bien}, tranche d'année ${trancheAnnee}.
L'installation gaz est ${data.installationGaz ? "présente" : "absente"}.
La copropriété est ${data.copropriete ? "présente" : "absente"}.
Les packs disponibles sont : ${packs.map(p => p.nom).join(", ")}.
Les diagnostics possibles sont : ${diagnosticsFiltres.map(d => d.nom).join(", ")}.
Les suppléments possibles sont : ${supplements.map(s => s.nom).join(", ")}.

Propose un devis recommandé en listant : 
- Pack suggéré
- Diagnostics nécessaires
- Suppléments utiles
- Justification du choix
`;

    console.log("🤖 Prompt envoyé à OpenAI :", promptOpenAI);

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const completion = await openai.chat.completions.create({
      model: "gpt-4",
      messages: [{ role: "user", content: promptOpenAI }],
      temperature: 0.7,
    });

    const aiResponse = completion.choices[0].message.content;
    console.log("✅ Réponse OpenAI reçue :", aiResponse);

    // Réponse front
    const responseJSON = {
      message: "✅ Devis recommandé généré via AI",
      suggestion: aiResponse,
      productMode,
      client: {
        nom: data.client?.nom || "Jean",
        prenom: data.client?.prenom || "Dupont",
        email: data.client?.email || "jean.dupont@email.com",
        tel: data.client?.tel || "0601020304",
        adresse: data.client?.adresse || bien.adresseBien?.adresse || "",
        ville: data.client?.ville || bien.adresseBien?.ville || "",
        codePostal: data.client?.codePostal || bien.adresseBien?.codePostal || "",
      },
      bien: {
        bien: bien.bien,
        type: bien.type || "",
        adresseBien: bien.adresseBien,
        surfaceAppartement: bien.surfaceAppartement || "",
        surfaceMaison: bien.surfaceMaison || "",
        trancheAnnee,
        anneeConstruction: trancheAnnee,
        transaction: bien.transaction,
        numeroFiscalBien: bien.numeroFiscalBien || "",
        note: ""
      },
      packs: productMode === "pack" ? packs.map(p => ({
        id: p._id,
        nom: p.nom,
        tarif: bien.bien === "appartement" && p.tarifsParAppartement
          ? p.tarifsParAppartement.find(t => t.typeAppartement === bien.surfaceAppartement)?.tarifs || p.tarifs
          : p.tarifs,
        selected: true
      })) : [],
      diagnostics: productMode === "diagnostic" ? diagnosticsFiltres.map(d => ({
        id: d._id,
        nom: d.nom,
        selected: true
      })) : [],
      supplements: [] 
    };

    return res.status(200).json(responseJSON);

  } catch (error) {
    console.error("Erreur génération devis AI :", error);
    return res.status(500).json({ message: "Erreur serveur lors de la génération du devis AI." });
  }
};






/**
 * 📦 Envoyer automatiquement les rappels pour tous les devis "Envoyé" depuis plus de 48h
 */
exports.envoyerRappelsAutomatiques = async () => {
  try {
    console.log("📥 Lancement du job d'envoi des rappels...");

    // Seuil de 48 heures
    const deuxJours = new Date(Date.now() - 48 * 60 * 60 * 1000);

    const devisArelancer = await Devis.find({
      // MODIFICATION ICI : On accepte "Envoyé" OU "Ouvert"
      statut: { $in: ["Envoyé", "ouvert"] },
      $or: [
        { derniereRelance: { $lt: deuxJours } },
        { derniereRelance: null }
      ],
      'client.email': { $exists: true, $ne: "" }
    });

    console.log(`🔍 ${devisArelancer.length} devis à relancer (Statuts: Envoyé/Ouvert)`);

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

      // Mise à jour de la date de relance
      devis.derniereRelance = new Date();
      await devis.save();
      console.log(`✅ Rappel envoyé pour le devis ${devis.numero} (${devis.statut})`);
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

    console.log('utilisateur : ',req.user)


// 🔹 Déterminer l’ID de l’agence / entreprise
let agenceId;

if (req.user?.role === "admin") {
  // Admin superuser : pas besoin d'agence
  agenceId = null; // ou undefined
} else if (req.user?.role === "employe") {
  agenceId = req.user.agence; // ID de l'agence de l'employé
} else if (req.role === "agence") {
  agenceId = req.user._id; // l'agence elle-même
}

// Plus de 401 pour admin
if (!agenceId && req.user?.role !== "admin") {
  return res.status(401).json({ message: "Agence non authentifiée." });
}
// 🔐 Déterminer qui crée le devis
let creePar;
if (req.user?.role === "employe") {
  creePar = { id: req.user._id, type: "Employe" };
} else if (req.user?.role === "admin") {
  creePar = { id: req.user.id, type: "Admin" };
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
// 🔎 Création systématique du client
const client = new Client(clientPayload);
await client.save();


let secteur;

if (req.user.role === "admin") {
  // Super admin → secteur envoyé depuis le front
  secteur = (data.secteur || "autre")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
} else {
  // Agence ou employé → secteur de l’agence
  secteur = (req.agence?.alerte_secteur || "autre")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}


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
    let surfaceMinDemande = 0;
    let surfaceMaxDemande = 0;
    const surface = data.surfaceMaison.toString();

    if (surface.includes("-")) {
      const match = surface.match(/(\d+)\s*-\s*(\d+)/);
      surfaceMinDemande = match ? parseInt(match[1], 10) : 0;
      surfaceMaxDemande = match ? parseInt(match[2], 10) : surfaceMinDemande;
    } else {
      const valeur = parseInt(surface, 10);
      surfaceMinDemande = valeur;
      surfaceMaxDemande = valeur;
    }

    for (let tps of pack.tarifsParSurface) {
      const overlap = !(surfaceMaxDemande < tps.surfaceMin || surfaceMinDemande > tps.surfaceMax);
      if (overlap) {
        tarifTrouve = tps.tarifs?.[secteur] ?? tps.tarifs?.autre ?? 0;
        break;
      }
    }
  }

  // 🏢 APPARTEMENT → tarifsParAppartement
  if (data.bien === "appartement" && data.surfaceAppartement && pack.tarifsParAppartement?.length) {
    // 🔹 Mapping types appartement
    const mappingAppartement = {
      "moins 20m²": "<20m2",
      "20-40m²": "20-40m2",
      "T1": "T1",
      "T2": "T2",
      "T3": "T3",
      "T4": "T4",
      "T5": "T5"
    };
    const typeAppartement = mappingAppartement[data.surfaceAppartement] || data.surfaceAppartement;

    const appart = pack.tarifsParAppartement.find(t => t.typeAppartement === typeAppartement);
    if (appart) {
      tarifTrouve = appart.tarifs?.[secteur] ?? appart.tarifs?.autre ?? 0;
      console.log(`Appartement : type=${typeAppartement}, secteur='${secteur}', tarifTrouve=${tarifTrouve}`);
    } else {
      console.log(`⚠️ Appartement : aucun tarif trouvé pour type=${typeAppartement}, secteur='${secteur}'`);
    }
  }

  // 🚧 AUTRES BIENS → tarifsParSurface (valeur unique)
  else if (data.bien !== "maison" && data.bien !== "appartement" && pack.tarifsParSurface?.length) {
    let valeur = parseInt(data.surfaceMaison || data.surfaceAppartement || data.surface || 0, 10); // la valeur que l'utilisateur a envoyée
    if (!isNaN(valeur)) {
      const tpsTrouve = pack.tarifsParSurface.find(tps => valeur >= tps.surfaceMin && valeur <= tps.surfaceMax);
      if (tpsTrouve) {
        tarifTrouve = tpsTrouve.tarifs?.[secteur] ?? tpsTrouve.tarifs?.autre ?? 0;
      }
    }
  }

  totalAvantRemise = Number(tarifTrouve) || 0;
}


// --- Diagnostics ---
// --- Diagnostics ---
else if (data.type === "diagnostic" && data.diagnosticsSelectionnes?.length) {

  console.log("=== 🧪 MODE : DIAGNOSTICS À LA CARTE ===");
  console.log("Diagnostics sélectionnés :", data.diagnosticsSelectionnes);

  const diagnostics = await Diagnostic.find({ _id: { $in: data.diagnosticsSelectionnes } });
  
  console.log("Diagnostics chargés depuis MongoDB :", diagnostics);

  // 🔹 Normalisation type appartement
  let typeAppartement = null;
  if (data.bien === "appartement" && data.surfaceAppartement) {
    const mappingAppartement = {
      "moins 20m²": "<20m2",
      "20-40m²": "20-40m2",
      "T1": "T1",
      "T2": "T2",
      "T3": "T3",
      "T4": "T4",
      "T5": "T5"
    };
    typeAppartement = mappingAppartement[data.surfaceAppartement] || data.surfaceAppartement;
    console.log("Type appartement normalisé :", typeAppartement);
  }

  // 🔹 Normalisation secteur
  console.log("Secteur brut :", secteur);

  secteur = (secteur || "autre")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();

  console.log("Secteur normalisé :", secteur);

  totalAvantRemise = diagnostics.reduce((sum, d) => {
    console.log("\n--- Diagnostic analysé :", d.nom, " ---");

    let tarifTrouve = 0;

    // 🏠 MAISON
    if (data.bien === "maison" && d.tarifsParSurface?.length) {

      console.log("Mode maison - tarifsParSurface :", d.tarifsParSurface);

      let surfaceMin = 0, surfaceMax = 0;
      let surface = data.surfaceMaison;

      console.log("Surface maison envoyée (brut) :", surface);

      // 🔧 Fix : enlever “m²”, espaces, caractères spéciaux
      surface = surface.replace(/[^\d-]/g, "");
      console.log("Surface maison nettoyée :", surface);

      if (surface) {
        if (surface.includes("-")) {
          const match = surface.match(/(\d+)-(\d+)/);
          surfaceMin = match ? parseInt(match[1], 10) : 0;
          surfaceMax = match ? parseInt(match[2], 10) : surfaceMin;
        } else {
          const valeur = parseInt(surface, 10);
          surfaceMin = valeur;
          surfaceMax = valeur;
        }
      }

      console.log(`Surface min=${surfaceMin}, max=${surfaceMax}`);

const intervalleTrouve = d.tarifsParSurface.find(tps => {
  const min = Number(tps.surfaceMin);
  const max = Number(tps.surfaceMax);
  // 🔹 ajustement : accepter si overlap partiel
  return surfaceMax >= min && surfaceMin <= max;
});


      console.log("Intervalle trouvé :", intervalleTrouve);

      if (intervalleTrouve) {
        tarifTrouve = intervalleTrouve.tarifs[secteur] ?? intervalleTrouve.tarifs.autre ?? 0;
        console.log("Tarif trouvé pour maison =", tarifTrouve);
      } else {
        console.log("⚠️ Aucun intervalle trouvé → tarif=0");
      }
    }

    // 🏢 APPARTEMENT
    else if (data.bien === "appartement" && d.tarifsParAppartement?.length) {

      console.log("Mode appartement - tarifsParAppartement :", d.tarifsParAppartement);

      const tarifAppart = d.tarifsParAppartement.find(t => t.typeAppartement === typeAppartement);

      if (tarifAppart) {
        console.log("Tarif appartement trouvé :", tarifAppart);
        tarifTrouve = tarifAppart.tarifs[secteur] ?? tarifAppart.tarifs.autre ?? 0;
        console.log(`Tarif trouvé = ${tarifTrouve} (secteur=${secteur})`);
      } else {
        console.log(`⚠️ Aucun tarif trouvé pour type=${typeAppartement}`);
      }
    }

     else if (data.bien !== "maison" && data.bien !== "appartement" && d.tarifsParSurface?.length) {
      const valeur = parseInt(data.surfaceMaison || data.surfaceAppartement || data.surface || 0, 10);
      if (!isNaN(valeur)) {
        const tpsTrouve = d.tarifsParSurface.find(tps => valeur >= tps.surfaceMin && valeur <= tps.surfaceMax);
        if (tpsTrouve) tarifTrouve = tpsTrouve.tarifs?.[secteur] ?? tpsTrouve.tarifs?.autre ?? 0;
      }
    }

    // ❗ CAS : pas de tarifs (ERP, Termites, etc)
    else {
      console.log("⚠️ Aucun tableau de tarifs — on vérifie prixTTC/prixHT");

      console.log("prixTTC :", d.prixTTC, "prixHT :", d.prixHT);

      tarifTrouve = Number(d.prixTTC || d.prixHT || 0);

      console.log("Tarif simple appliqué (prixTTC/prixHT) :", tarifTrouve);
    }

    console.log("Tarif retenu pour", d.nom, ":", tarifTrouve);

    return sum + (Number(tarifTrouve) || 0);
  }, 0);

  console.log("\nTotal avant ajout frais déplacement =", totalAvantRemise);

  // 🔹 Ajouter frais déplacement sauf ERP seul
  const isERPSeul = diagnostics.length === 1 && diagnostics[0].nom.toLowerCase().includes("erp");
  console.log("ERP seul ?", isERPSeul);

  if (!isERPSeul) {
    totalAvantRemise += 55;
    console.log("Ajout frais déplacement : +55");
  }

  console.log("Total avant remise final =", totalAvantRemise);
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

let lignes = [];
let totalLignes = 0;

if (Array.isArray(data.lignes) && data.lignes.length) {
  lignes = data.lignes.map(l => {
    const quantite = Number(l.quantite) || 1;
    const tarifUnitaire = Number(l.prixHT * 1.2) || 0; // ou prixTTC si tu veux
    const totalLigne = quantite * tarifUnitaire;
    totalLignes += totalLigne;

    return {
      description: l.designation || "-", // <-- ici on remplace description par designation
      quantite,
      tarifUnitaire,
      totalLigne
    };
  });
}

totalAvantRemise += totalLignes;


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
    // 🔹 Mapping type appartement comme plus haut
    const mappingAppartement = {
      "moins 20m²": "<20m2",
      "20-40m²": "20-40m2",
      "T1": "T1",
      "T2": "T2",
      "T3": "T3",
      "T4": "T4",
      "T5": "T5"
    };
    const typeAppart = mappingAppartement[data.surfaceAppartement] || data.surfaceAppartement;

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
let reductionPourcent = Number(data.reductionPourcent) || 0;
let montantCagnotteUtilisee = Number(data.montantCagnotteUtilisee) || 0;

// 💰 Totaux avant application de la cagnotte
const totalApresReduction = totalAvantRemise * (1 - reductionPourcent / 100);

let totalFinal;

// 🔹 Si Admin
if (creePar.type === "Admin") {
  // On prend exactement ce que le front envoie, pas de déduction supplémentaire
  totalFinal = Math.max(totalApresReduction - montantCagnotteUtilisee, 0);
  console.log("🔹 Créateur Admin : réduction et cagnotte appliquées :", totalFinal);
} 
// 🔹 Si Employé ou Agence
else if (montantCagnotteUtilisee > 0) {
  let cibleCagnotte = null;
  let auteur = 'Système';

  if (creePar.type === "Agence") {
    cibleCagnotte = await Agence.findById(creePar.id);
    auteur = cibleCagnotte?.nom_commercial || 'Agence';
  } else if (creePar.type === "Employe") {
    const employe = await Employe.findById(creePar.id);
    auteur = req.user?.email || 'Employé';
    if (employe.cagnotte !== undefined) {
      cibleCagnotte = employe;
    } else {
      cibleCagnotte = await Agence.findById(agenceId);
    }
  }

  if (!cibleCagnotte) {
    return res.status(404).json({ message: "Cagnotte introuvable." });
  }

  const dejaEnAttente = (cibleCagnotte.historiqueCagnotte || cibleCagnotte.transactions_cagnotte)
    .filter(m => m.type === 'en_attente' && m.description.includes(`devis (${data.type || 'non spécifié'})`))
    .reduce((sum, m) => sum + m.montant, 0);

  const montantRestant = montantCagnotteUtilisee - dejaEnAttente;

  if (montantRestant > 0) {
    if ((cibleCagnotte.cagnotte || 0) < montantRestant) {
      return res.status(400).json({ message: "Cagnotte insuffisante." });
    }

    cibleCagnotte.cagnotte -= montantRestant;
    cibleCagnotte.cagnotteEnAttente = (cibleCagnotte.cagnotteEnAttente || 0) + montantRestant;

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

    await cibleCagnotte.save();
  }

  // 🔹 Appliquer la cagnotte utilisée pour le total final
  totalFinal = Math.max(totalApresReduction - montantCagnotteUtilisee, 0);
}

// 💰 Montant TTC final
const montantTTC = totalFinal;


    console.log("===== Totaux calculés =====", { totalAvantRemise, totalApresReduction, totalFinal, montantTTC });

const shareAgencyId = data.shareAgency && data.shareAgency !== "" ? data.shareAgency : null;

console.log("==== Client avant création devis ====", client);


    // 🧾 Création du devis
    const devis = new Devis({
      agenceId,
      shareAgency : shareAgencyId,
      creePar,
 client: {
    nom: data.client.nom,
    prenom: data.client.prenom,
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

  // 🆕 Ajouter les champs locataire
  locataire: data.locataire || null,
  contactLocataire: data.contactLocataire || false,

      type: data.type,
      bien: data.bien,
      transaction: data.transaction,
      adresseBien: data.adresseBien,
      surfaceMaison: data.surfaceMaison,
      typeSurfaceMaison : data.typeSurfaceMaison,
  ...(data.bien === "appartement" ? { surfaceAppartement: data.surfaceAppartement } : {}),
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
      lignes,
      secteur
    });

    await devis.save();

    if (!client.devis.includes(devis._id)) {
      client.devis.push(devis._id);
      await client.save();
    }

// ✅ Si le payeur est l’agence
// ✅ Si le payeur est l’agence
if (data.payer === "agence") {

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
const agenceEmail = agence?.emails_contact?.[0]?.email; // null si agence ou email inexistant
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
// 💌 Envoi de l’e-mail si le payeur est le client
if (data.payer === "client") {
  const lienDevis = `https://dimotec.datafuse.fr/client-Devis/${devis.accesClientKey}`;

  // 🟡 D'abord on met un statut temporaire
  devis.statut = "Envoi_En_Cours";
  await devis.save();

  try {
    console.log("📤 Envoi e-mail au client :", client.email);

    await sendEmail({
      to: client.email,
      subject: `Votre devis ${devis.numero} est prêt`,
      template: "devis.html",
      variables: {
        nomClient: `${client.prenom} ${client.nom}`,
        lienDevis,
        "[Adresse email]": req.agence?.email || "contact@dimotec.fr",
        "[Numéro de téléphone]": req.agence?.telephone || "06 00 00 00 00",
      },
    });

    console.log("✅ Email envoyé avec succès au client :", client.email);

    devis.emailNonDelivre = false;
    devis.statut = "Envoyé";
    await devis.save();

  } catch (err) {
    console.error(`❌ Erreur envoi e-mail au client ${client.email}:`, err.message);

    // ❗ Ici : email invalide ou boîte pleine OU serveur distant qui rejette
    devis.emailNonDelivre = true;
    devis.emailClientErrone = client.email;
    devis.statut = "Email_Errone";
    await devis.save();

    console.log("⚠️ Devis marqué comme email non délivré.");

    // 🔔 Prévenir l'agence et Dimotec
    const agence = await Agence.findById(devis.agenceId);
    const agenceEmail =
      Array.isArray(agence?.emails_contact) && agence.emails_contact.length > 0
        ? agence.emails_contact[0].email
        : null;

    const dimotecEmail = "dimotec34@gmail.com";

    const alertVariables = {
      clientNom: `${client.prenom} ${client.nom}`,
      emailClient: client.email,
      devisNumero: devis.numero,
      agenceNom: agence?.nom_commercial || "Agence",
    };

    const destinataires = [];
    if (agenceEmail) destinataires.push(agenceEmail);
    destinataires.push(dimotecEmail);

    for (let dest of destinataires) {
      console.log("📤 Envoi alerte à :", dest);

      await sendEmail({
        to: dest,
        subject: `⚠️ Problème d'envoi du devis ${devis.numero}`,
        template: "alerteEmailClient.html",
        variables: alertVariables,
      });

      console.log("✅ Alerte envoyée à :", dest);
    }
  }
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


exports.corrigerEmailDevis = async (req, res) => {
  const { devisId, nouvelEmail } = req.body;

  if (!devisId || !nouvelEmail) {
    return res.status(400).json({ message: "Devis et nouvel email requis." });
  }

  const devis = await Devis.findById(devisId);
  if (!devis) return res.status(404).json({ message: "Devis introuvable." });

  // Mettre à jour email dans le devis
  devis.client.email = nouvelEmail;
  devis.emailNonDelivre = false;
  devis.statut = "Envoyé";

  // 📌 Corriger aussi le vrai client en BDD
  const client = await Client.findOne({
    nom: devis.client.nom,
    prenom: devis.client.prenom,
    telephone: devis.client.tel || devis.client.telephone
  });

  if (client) {
    client.email = nouvelEmail;
    await client.save();
  }

  await devis.save();

  try {
    await sendEmail({
      to: nouvelEmail,
      subject: `Votre devis ${devis.numero} est prêt`,
      template: "devis.html",
      variables: {
        nomClient: `${devis.client.prenom} ${devis.client.nom}`,
        lienDevis: `https://dimotec.datafuse.fr/client-Devis/${devis.accesClientKey}`,
        "[Adresse email]": req.agence?.email || "contact@dimotec.fr",
        "[Numéro de téléphone]": req.agence?.telephone || "06 00 00 00 00",
      },
    });

    return res.status(200).json({ message: "Email corrigé et envoyé avec succès.", devis });
  } catch (err) {
    console.error("Erreur renvoi email après correction :", err.message);
    return res.status(500).json({ message: "Impossible d'envoyer l'email après correction." });
  }
};





// 🔹 Accepter un devis via clé
// 🔹 Accepter un devis via clé
exports.accepterDevisViaLien = async (req, res) => {
  try {
    const { key, devisId } = req.params;
    const { ville, date, numeroFiscalBien } = req.body;

    const devis = await Devis.findOne({ _id: devisId, accesClientKey: key });
    if (!devis) return res.status(404).json({ message: "Devis introuvable." });

    // On enregistre les infos de signature SANS passer le statut à "Accepté"
    if (ville) devis.faitA = ville;
    if (date) devis.dateAcceptation = new Date(date);
    if (numeroFiscalBien) devis.numeroFiscalBien = numeroFiscalBien;
    devis.cgvAccepted = true;
    devis.rgpdAccepted = true;
    
    await devis.save();

    return res.status(200).json({ message: "Données enregistrées, génération du PDF en cours..." });
  } catch (error) {
    return res.status(500).json({ message: "Erreur serveur." });
  }
};





// 🔹 Upload PDF d'un devis vers Cloudinary
exports.uploadPdfDevis = async (req, res) => {
  try {
    const { devisId } = req.params;

    // 1️⃣ Vérification de la présence du fichier
    if (!req.file) {
      return res.status(400).json({ message: "Aucun fichier PDF reçu." });
    }

    const pdfUrl = req.file.path; // URL récupérée depuis Cloudinary via multer-storage-cloudinary

    // 2️⃣ Récupération du devis et des relations nécessaires
    const devis = await Devis.findById(devisId);
    if (!devis) {
      return res.status(404).json({ message: "Devis introuvable." });
    }

    // 3️⃣ MISE À JOUR CRITIQUE : Passage au statut "Accepté" et enregistrement du PDF
    devis.statut = "Accepté";
    devis.pdfUrl = pdfUrl;
    await devis.save();

    // 4️⃣ LOGIQUE MÉTIER : Création de l'Ordre de Mission
    let clientId = devis.clientId;
    if (!clientId && devis.client?.email) {
      const client = await Client.findOne({ email: devis.client.email });
      clientId = client?._id;
    }

    const ordre = new OrdreMission({
      devisId: devis._id,
      agenceId: devis.agenceId,
      numero: `OM-${Date.now()}`,
      clientId,
      description: `Ordre de mission automatique pour le devis ${devis.numero}`,
      statut: "Commande",
      creePar: devis.creePar,
    });
    await ordre.save();

    // 5️⃣ GESTION DE LA CAGNOTTE
    const agence = await Agence.findById(devis.agenceId);
    if (agence && devis.montantCagnotteUtilisee > 0) {
      console.log('💰 Traitement du retrait de la cagnotte...');

      let cible = null;
      let auteur = 'Système';

      if (agence.type_cagnotte === 'individuelle' && devis.creePar.type === 'Employe') {
        // Retrait sur l'employé
        cible = await Employe.findById(devis.creePar.id);
        if (cible) {
          auteur = cible.email || 'Employé';
          const montantARetirer = Math.min(cible.cagnotteEnAttente || 0, devis.montantCagnotteUtilisee);
          
          if (montantARetirer > 0) {
            cible.cagnotteEnAttente -= montantARetirer;
            cible.transactions_cagnotte.push({
              montant: montantARetirer,
              type: 'retrait',
              description: `Utilisé pour devis ${devis.numero} (Accepté)`,
              reference: devis._id,
              date: new Date()
            });
            await cible.save();
          }
        }
      } else {
        // Retrait sur la cagnotte partagée de l'agence
        cible = agence;
        auteur = agence.nom_commercial;
        const montantARetirer = Math.min(agence.cagnotteEnAttente || 0, devis.montantCagnotteUtilisee);

        if (montantARetirer > 0) {
          agence.cagnotteEnAttente -= montantARetirer;
          agence.historiqueCagnotte.push({
            montant: montantARetirer,
            type: 'retrait',
            description: `Utilisé pour devis ${devis.numero} (Accepté)`,
            par: auteur,
            date: new Date()
          });
          await agence.save();
        }
      }
    }

    // 6️⃣ PRÉPARATION ET ENVOI DES EMAILS
    const variablesEmail = {
      nomClient: `${devis.client.prenom} ${devis.client.nom}`,
      numero: ordre.numero,
      devisNumero: devis.numero,
      nomAgence: agence?.nom_commercial || "Dimotec",
      dateCreation: new Date().toLocaleDateString("fr-FR"),
      description: ordre.description,
      statut: ordre.statut,
      lienMission: `https://dimotec.datafuse.fr/ordre-mission`
    };

    // Email à l'agence
    const agenceEmail = agence?.emails_contact?.[0]?.email;
    if (agenceEmail) {
      await sendEmail({
        to: agenceEmail,
        subject: `Nouvel Ordre de Mission - ${ordre.numero}`,
        template: "OrdreMission.html",
        variables: variablesEmail
      });
    }

    // Email de copie à Dimotec
    await sendEmail({
      to: "dimotec34@gmail.com",
      subject: `[COPIE] Nouvel Ordre de Mission - ${ordre.numero}`,
      template: "OrdreMission.html",
      variables: variablesEmail
    });

    // 7️⃣ RÉPONSE FINALE
    return res.status(200).json({
      message: "PDF uploadé et devis accepté avec succès.",
      pdfUrl,
      devis,
      ordre
    });

  } catch (err) {
    console.error("❌ Erreur critique dans uploadPdfDevis :", err);
    return res.status(500).json({ 
      message: "Erreur lors de la finalisation de l'acceptation via PDF.",
      error: err.message 
    });
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

    const secteur = (devis.agenceId?.alerte_secteur || devis.secteur || "autre")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");

    const surfaceStr = devis.surfaceMaison || devis.surfaceAppartement || devis.surface || "0";
    const surface = parseInt(surfaceStr.split(" ")[0], 10) || 0;

    // Helper pour normaliser le type appartement
    const getTypeAppartement = (surfaceAppartement) => {
      const mappingAppartement = {
        "moins 20m²": "<20m2",
        "20-40m²": "20-40m2",
        "T1": "T1",
        "T2": "T2",
        "T3": "T3",
        "T4": "T4",
        "T5": "T5"
      };
      return mappingAppartement[surfaceAppartement] || surfaceAppartement;
    };

    const typeAppart = devis.bien === "appartement" ? getTypeAppartement(devis.surfaceAppartement) : null;

    // Helper pour calculer le tarif TTC selon type de bien
    const calculerTarif = (item) => {
      let tarifTTC = 0;

      if (devis.bien === "maison" && item.tarifsParSurface?.length) {
        const tranche = item.tarifsParSurface.find(t => surface >= t.surfaceMin && surface <= t.surfaceMax);
        tarifTTC = tranche?.tarifs?.[secteur] ?? tranche?.tarifs?.autre ?? 0;

      } else if (devis.bien === "appartement" && item.tarifsParAppartement?.length) {
        const tranche = item.tarifsParAppartement.find(t => t.typeAppartement === typeAppart);
        tarifTTC = tranche?.tarifs?.[secteur] ?? tranche?.tarifs?.autre ?? 0;

      } else if (item.tarifsParSurface?.length) {
        // ✅ Autres types (terrain, local…) : rechercher dans tarifsParSurface
        const tranche = item.tarifsParSurface.find(t => surface >= t.surfaceMin && surface <= t.surfaceMax);
        tarifTTC = tranche?.tarifs?.[secteur] ?? tranche?.tarifs?.autre ?? 0;
      } else {
        // Cas fallback : utiliser prixTTC ou prixHT
        tarifTTC = Number(item.prixTTC || item.prixHT || 0);
      }

      return +(tarifTTC / 1.2).toFixed(2); // Retour HT
    };

    // -------- DIAGNOSTICS SELECTIONNÉS --------
    const diagnostics = (devis.diagnosticsSelectionnes || [])
      .filter(Boolean)
      .map(diag => {
        const prixHT = calculerTarif(diag);
        const prixTTC = +(prixHT * 1.2).toFixed(2);
        return { nom: diag.nom, prixHT, prixTTC };
      });

    // -------- DIAGNOSTIC GAZ --------
    if (devis.chauffageGaz) {
      const diagGaz = await Diagnostic.findOne({ nom: /gaz/i });
      if (diagGaz) {
        const prixHT = calculerTarif(diagGaz);
        const prixTTC = +(prixHT * 1.2).toFixed(2);
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
      let prixHT = calculerTarif(devis.pack);
      const prixTTC = +(prixHT * 1.2).toFixed(2);

      const diagnosticsPack = (devis.pack.diagnostics || []).map(diag => {
        const diagHT = calculerTarif(diag);
        const diagTTC = +(diagHT * 1.2).toFixed(2);
        return { nom: diag.nom, prixHT: diagHT, prixTTC: diagTTC };
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

exports.ouvrirDevisViaLien = async (req, res) => {
  try {
    const { key } = req.params;

    const devis = await Devis.findOne({ accesClientKey: key });

    if (!devis) {
      return res.status(404).json({ message: "Lien invalide ou expiré." });
    }

    // On ne change le statut que s'il n'est pas déjà ouvert ou finalisé
    if (!["ouvert", "Accepté", "Refusé"].includes(devis.statut)) {
      devis.statut = "ouvert";
      devis.dateOuverture = new Date();
      await devis.save(); 
    }

    return res.status(200).json({
      message: "📬 Devis marqué comme ouvert",
      statut: devis.statut
    });

  } catch (error) {
    console.error("🚨 Erreur ouverture devis :", error);
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
    if (req.user.role === "admin") {
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
    const { reason } = req.body; // 🔹 récupérer la raison depuis le frontend

    const devis = await Devis.findOne({ _id: devisId, accesClientKey: key });
    if (!devis) 
      return res.status(404).json({ message: "Devis introuvable ou clé invalide." });

    devis.statut = "Refusé";
    devis.raisonRefus = reason || ""; // 🔹 stocker la raison dans le modèle
    await devis.save();

    return res.status(200).json({ message: "✅ Devis refusé", devis });
  } catch (error) {
    console.error("Erreur refus via lien :", error);
    return res.status(500).json({ message: "Erreur serveur." });
  }
};


/**
 * 📧 Indiquer qu'aucun document n'est disponible pour un devis
 */
exports.noDocumentsDevis = async (req, res) => {
  try {
    const { devisId, messageClient } = req.body;

    // ✅ Vérification des données
    if (!devisId) {
      return res.status(400).json({ message: "L'ID du devis est requis." });
    }

    // 🔹 Récupérer le devis et le client
    const devis = await Devis.findById(devisId).populate("client");
    if (!devis) {
      return res.status(404).json({ message: "Devis introuvable." });
    }

    const clientNom = `${devis.client?.prenom || ""} ${devis.client?.nom || ""}`.trim();

    // 🔹 Préparer les variables pour le template
    const emailVariables = {
      nomClient: clientNom,
      numeroDevis: devis.numero,
      messageClient: messageClient || "Le client indique qu'aucun document n'est disponible.",
      lienDevis: `https://dimotec.datafuse.fr/client-Devis/${devis.accesClientKey}`,
      date: new Date().toLocaleString("fr-FR"),
    };

    // 💌 Envoi du mail à Dimotec
    await sendEmail({
      to: "dimotec34@gmail.com",
      subject: `Devis ${devis.numero} : aucun document transmis`,
      template: "noDocuments.html",
      variables: emailVariables,
    });

    // 🔹 Réponse API
    res.status(200).json({
      message: "✅ Notification envoyée à Dimotec concernant l'absence de documents.",
    });

  } catch (error) {
    console.error("❌ Erreur envoi notification pas de documents :", error);
    res.status(500).json({ message: "Erreur serveur lors de l'envoi de la notification." });
  }
};

/**
 * 📝 Mettre à jour les informations d'un devis existant
 * Route : PATCH /api/agency/devis/:id
 */
exports.updateDevisInfos = async (req, res) => {
  try {
    const { id } = req.params;
    const { client, locataire, contactLocataire, adresseBien, numeroFiscalBien, note, statut } = req.body;

    // 🔍 Vérification de l'existence du devis
    const devis = await Devis.findById(id);
    if (!devis) {
      return res.status(404).json({ message: "Devis introuvable." });
    }

    // 🔐 Vérification des autorisations
    if (req.user.role !== "admin" && req.role !== "agence") {
      return res.status(403).json({ message: "Non autorisé." });
    }

    // Pour les agences, vérifier qu'elles sont propriétaires du devis
    if (req.role === "agence" && devis.agenceId.toString() !== req.agence._id.toString()) {
      return res.status(403).json({ message: "Vous n'avez pas la permission de modifier ce devis." });
    }

    if (statut) {
      devis.statut = statut;
    }

    // ✏️ Mise à jour des champs modifiables

    // Informations client
    if (client) {
      if (client.nom) devis.client.nom = client.nom;
      if (client.prenom) devis.client.prenom = client.prenom;
      if (client.email) devis.client.email = client.email;
      if (client.tel !== undefined) devis.client.tel = client.tel;
    }

    // Informations locataire
    if (locataire) {
      devis.locataire = {
        nom: locataire.nom || '',
        prenom: locataire.prenom || '',
        tel: locataire.tel || ''
      };
    }

    // Contact locataire
    if (contactLocataire !== undefined) {
      devis.contactLocataire = contactLocataire;
    }

    // Adresse du bien
    if (adresseBien) {
      devis.adresseBien = {
        ...devis.adresseBien,
        ...adresseBien
      };
    }

    // Numéro fiscal
    if (numeroFiscalBien !== undefined) {
      devis.numeroFiscalBien = numeroFiscalBien;
    }

    // Note
    if (note !== undefined) {
      devis.note = note;
    }

    // 💾 Sauvegarde
    await devis.save();

    console.log(`✅ Devis ${devis.numero} mis à jour avec succès`);

    return res.status(200).json({
      message: "✅ Devis mis à jour avec succès",
      devis
    });

  } catch (error) {
    console.error("❌ Erreur mise à jour devis :", error);
    return res.status(500).json({ message: "Erreur serveur lors de la mise à jour du devis." });
  }
};

// 🆕 Notifier une nouvelle agence (invitation à rejoindre la plateforme)
exports.notifyNewAgency = async (req, res) => {
  try {
    const { devisId, agencyName, agencyEmail } = req.body;

    if (!agencyEmail || !agencyName) {
      return res.status(400).json({ message: "Nom et email de l'agence requis" });
    }

    // Récupérer le devis pour avoir plus d'infos
    const devis = await Devis.findById(devisId).populate('client');

    // Template email pour nouvelle agence
    const emailHtml = `
<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Invitation DIMOTEC</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      line-height: 1.6;
      color: #333;
      background-color: #f8fafc;
      margin: 0;
      padding: 0;
    }
    .container {
      max-width: 600px;
      margin: 40px auto;
      background: #ffffff;
      border-radius: 16px;
      overflow: hidden;
      box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
    }
    .header {
      background: linear-gradient(135deg, #ed891a 0%, #f59e42 100%);
      padding: 40px 30px;
      text-align: center;
      color: white;
    }
    .header h1 {
      margin: 0;
      font-size: 28px;
      font-weight: 700;
    }
    .header p {
      margin: 10px 0 0;
      font-size: 16px;
      opacity: 0.95;
    }
    .content {
      padding: 40px 30px;
    }
    .content h2 {
      color: #1e293b;
      font-size: 22px;
      margin: 0 0 20px;
    }
    .content p {
      color: #64748b;
      margin: 0 0 16px;
      font-size: 15px;
    }
    .devis-info {
      background: #f1f5f9;
      border-left: 4px solid #ed891a;
      padding: 20px;
      border-radius: 8px;
      margin: 25px 0;
    }
    .devis-info strong {
      color: #1e293b;
      display: block;
      margin-bottom: 8px;
    }
    .devis-info p {
      margin: 5px 0;
      color: #475569;
    }
    .cta-button {
      display: inline-block;
      background: linear-gradient(135deg, #ed891a 0%, #f59e42 100%);
      color: white;
      padding: 16px 40px;
      text-decoration: none;
      border-radius: 12px;
      font-weight: 600;
      font-size: 16px;
      margin: 20px 0;
      transition: transform 0.2s;
      box-shadow: 0 4px 12px rgba(237, 137, 26, 0.3);
    }
    .cta-button:hover {
      transform: translateY(-2px);
      box-shadow: 0 6px 16px rgba(237, 137, 26, 0.4);
    }
    .benefits {
      background: #f8fafc;
      padding: 25px;
      border-radius: 12px;
      margin: 25px 0;
    }
    .benefits h3 {
      color: #1e293b;
      font-size: 18px;
      margin: 0 0 15px;
    }
    .benefits ul {
      list-style: none;
      padding: 0;
      margin: 0;
    }
    .benefits li {
      padding: 10px 0;
      color: #475569;
      display: flex;
      align-items: center;
    }
    .benefits li:before {
      content: "✓";
      color: #10b981;
      font-weight: bold;
      font-size: 20px;
      margin-right: 12px;
    }
    .footer {
      background: #f1f5f9;
      padding: 30px;
      text-align: center;
      color: #64748b;
      font-size: 13px;
    }
    .footer a {
      color: #ed891a;
      text-decoration: none;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🎉 Bienvenue sur DIMOTEC</h1>
      <p>Votre plateforme de gestion de diagnostics immobiliers</p>
    </div>

    <div class="content">
      <h2>Bonjour ${agencyName},</h2>

      <p>Nous avons le plaisir de vous informer qu'un devis a été réalisé en votre nom sur notre plateforme DIMOTEC.</p>

      <div class="devis-info">
        <strong>📋 Détails du devis :</strong>

        ${devis ? `
          <p><strong>Client :</strong> ${devis.client?.prenom || ''} ${devis.client?.nom || ''}</p>
          <p><strong>Montant :</strong> ${devis.montantTTC ? devis.montantTTC.toFixed(2) + ' €' : 'N/A'}</p>
        ` : ''}
      </div>

      <p><strong>Rejoignez DIMOTEC dès maintenant</strong> et profitez d'une plateforme complète pour gérer vos devis, ordres de mission et suivis clients.</p>

      <div class="benefits">
        <h3>Pourquoi nous rejoindre ?</h3>
        <ul>
          <li>Gestion centralisée de vos devis et interventions</li>
          <li>Suivi en temps réel de vos projets</li>
          <li>Communication facilitée avec vos clients</li>
          <li>Outils de reporting et statistiques</li>
          <li>Support technique dédié</li>
        </ul>
      </div>

      <center>
        <a href="https://dimotec.fr/inscription" class="cta-button">
          Créer mon compte gratuitement
        </a>
      </center>

      <p style="margin-top: 30px; color: #94a3b8; font-size: 14px;">
        Une fois inscrit, vous pourrez accéder à ce devis et commencer à utiliser tous nos outils.
      </p>
    </div>

    <div class="footer">
      <p>
        <strong>DIMOTEC</strong><br>
        La solution professionnelle pour vos diagnostics immobiliers
      </p>
      <p style="margin-top: 15px;">
        Des questions ? Contactez-nous à <a href="mailto:contact@dimotec.fr">contact@dimotec.fr</a>
      </p>
      <p style="margin-top: 10px; color: #94a3b8;">
        © ${new Date().getFullYear()} DIMOTEC - Tous droits réservés
      </p>
    </div>
  </div>
</body>
</html>
    `;

    // Envoyer l'email
    await sendEmail({
      to: agencyEmail,
      subject: `🎉 Invitation DIMOTEC - Un devis a été créé pour ${agencyName}`,
      html: emailHtml
    });

    console.log(`✅ Email d'invitation envoyé à ${agencyEmail}`);

    res.status(200).json({ message: "Email d'invitation envoyé avec succès" });

  } catch (error) {
    console.error("❌ Erreur envoi email nouvelle agence:", error);
    res.status(500).json({ message: "Erreur lors de l'envoi de l'email" });
  }
};

// 🆕 Notifier une agence existante (devis créé en leur nom)
exports.notifyExistingAgency = async (req, res) => {
  try {
    const { devisId, agencyId } = req.body;

    if (!agencyId) {
      return res.status(400).json({ message: "ID de l'agence requis" });
    }

    // Récupérer l'agence et le devis
    const agence = await Agence.findById(agencyId);
    const devis = await Devis.findById(devisId).populate('client');

    if (!agence) {
      return res.status(404).json({ message: "Agence introuvable" });
    }

    const agencyEmail = agence.emails_contact?.[0]?.email || agence.email;

    if (!agencyEmail) {
      return res.status(400).json({ message: "Aucun email trouvé pour cette agence" });
    }

    // Template email pour agence existante
    const emailHtml = `
<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Nouveau Devis DIMOTEC</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      line-height: 1.6;
      color: #333;
      background-color: #f8fafc;
      margin: 0;
      padding: 0;
    }
    .container {
      max-width: 600px;
      margin: 40px auto;
      background: #ffffff;
      border-radius: 16px;
      overflow: hidden;
      box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
    }
    .header {
      background: linear-gradient(135deg, #3b82f6 0%, #60a5fa 100%);
      padding: 40px 30px;
      text-align: center;
      color: white;
    }
    .header h1 {
      margin: 0;
      font-size: 28px;
      font-weight: 700;
    }
    .header p {
      margin: 10px 0 0;
      font-size: 16px;
      opacity: 0.95;
    }
    .content {
      padding: 40px 30px;
    }
    .content h2 {
      color: #1e293b;
      font-size: 22px;
      margin: 0 0 20px;
    }
    .content p {
      color: #64748b;
      margin: 0 0 16px;
      font-size: 15px;
    }
    .devis-card {
      background: linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%);
      border: 2px solid #3b82f6;
      border-radius: 12px;
      padding: 25px;
      margin: 25px 0;
    }
    .devis-card h3 {
      color: #1e40af;
      font-size: 18px;
      margin: 0 0 15px;
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .devis-card .info-row {
      display: flex;
      justify-content: space-between;
      padding: 10px 0;
      border-bottom: 1px solid #bfdbfe;
    }
    .devis-card .info-row:last-child {
      border-bottom: none;
    }
    .devis-card .info-row strong {
      color: #1e293b;
    }
    .devis-card .info-row span {
      color: #475569;
    }
    .cta-button {
      display: inline-block;
      background: linear-gradient(135deg, #3b82f6 0%, #60a5fa 100%);
      color: white;
      padding: 16px 40px;
      text-decoration: none;
      border-radius: 12px;
      font-weight: 600;
      font-size: 16px;
      margin: 20px 0;
      transition: transform 0.2s;
      box-shadow: 0 4px 12px rgba(59, 130, 246, 0.3);
    }
    .cta-button:hover {
      transform: translateY(-2px);
      box-shadow: 0 6px 16px rgba(59, 130, 246, 0.4);
    }
    .alert {
      background: #fef3c7;
      border-left: 4px solid #f59e0b;
      padding: 15px 20px;
      border-radius: 8px;
      margin: 20px 0;
    }
    .alert p {
      margin: 0;
      color: #92400e;
      font-size: 14px;
    }
    .footer {
      background: #f1f5f9;
      padding: 30px;
      text-align: center;
      color: #64748b;
      font-size: 13px;
    }
    .footer a {
      color: #3b82f6;
      text-decoration: none;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>📋 Nouveau Devis</h1>
      <p>Un devis a été créé en votre nom</p>
    </div>

    <div class="content">
      <h2>Bonjour ${agence.nom_commercial},</h2>

      <p>Nous vous informons qu'un nouveau devis a été créé en votre nom sur la plateforme DIMOTEC.</p>

      <div class="devis-card">
        <h3>📄 Informations du devis</h3>

        ${devis ? `
          <div class="info-row">
            <strong>Client</strong>
            <span>${devis.client?.prenom || ''} ${devis.client?.nom || ''}</span>
          </div>
          <div class="info-row">
            <strong>Email client</strong>
            <span>${devis.client?.email || 'N/A'}</span>
          </div>
          <div class="info-row">
            <strong>Montant TTC</strong>
            <span style="font-weight: 600; color: #1e40af;">${devis.montantTTC ? devis.montantTTC.toFixed(2) + ' €' : 'N/A'}</span>
          </div>
          <div class="info-row">
            <strong>Date de création</strong>
            <span>${new Date(devis.dateCreation).toLocaleDateString('fr-FR')}</span>
          </div>
        ` : ''}
      </div>

      <div class="alert">
        <p><strong>⏰ Action requise :</strong> Connectez-vous à votre espace pour consulter les détails complets et suivre l'évolution de ce devis.</p>
      </div>

      <center>
        <a href="https://dimotec.fr/login" class="cta-button">
          Accéder à mon espace
        </a>
      </center>

      <p style="margin-top: 30px; color: #94a3b8; font-size: 14px;">
        Ce devis est maintenant visible dans votre tableau de bord. Vous pouvez le consulter, le modifier et suivre son statut à tout moment.
      </p>
    </div>

    <div class="footer">
      <p>
        <strong>DIMOTEC</strong><br>
        Plateforme de gestion de diagnostics immobiliers
      </p>
      <p style="margin-top: 15px;">
        Besoin d'aide ? <a href="mailto:support@dimotec.fr">support@dimotec.fr</a>
      </p>
      <p style="margin-top: 10px; color: #94a3b8;">
        © ${new Date().getFullYear()} DIMOTEC - Tous droits réservés
      </p>
    </div>
  </div>
</body>
</html>
    `;

    // Envoyer l'email
    await sendEmail({
      to: agencyEmail,
      subject: `📋 Nouveau Devis  créé pour ${agence.nom_commercial}`,
      html: emailHtml
    });

    console.log(`✅ Email de notification envoyé à ${agencyEmail}`);

    res.status(200).json({ message: "Email de notification envoyé avec succès" });

  } catch (error) {
    console.error("❌ Erreur envoi email agence existante:", error);
    res.status(500).json({ message: "Erreur lors de l'envoi de l'email" });
  }
};
