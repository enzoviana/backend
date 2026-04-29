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

// 🕐 Fonction d'attente pour éviter rate limit
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

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
 * Vérifier les bounces via IMAP
 * Lit la boîte mail pour détecter les emails de rebond (bounce)
 */
async function verifierBouncesIMAP() {
  try {
    const Imap = require('imap');
    const { simpleParser } = require('mailparser');

    const imap = new Imap({
      user: process.env.SMTP_USER,
      password: process.env.SMTP_PASS,
      host: process.env.IMAP_HOST || 'imap.gmail.com',
      port: parseInt(process.env.IMAP_PORT) || 993,
      tls: true,
      tlsOptions: { rejectUnauthorized: false }
    });

    return new Promise((resolve) => {
      const bouncedEmails = new Set();

      imap.once('ready', () => {
        imap.openBox('INBOX', false, (err) => {
          if (err) {
            console.error('Erreur ouverture INBOX:', err);
            imap.end();
            return resolve([]);
          }

          const searchCriteria = [
            ['SINCE', new Date(Date.now() - 24 * 60 * 60 * 1000)], // dernières 24h
            ['OR', ['FROM', 'mailer-daemon'], ['FROM', 'postmaster']]
          ];

          imap.search(searchCriteria, (err, results) => {
            if (err || !results?.length) {
              imap.end();
              return resolve([]);
            }

            const f = imap.fetch(results, { bodies: '' });

            f.on('message', (msg) => {
              msg.on('body', (stream) => {
                simpleParser(stream, (err, parsed) => {
                  if (err) return;

                  const body = (parsed.text || '').toLowerCase();

                  // Détection des hard bounces
                  const isHardBounce =
                    body.includes('550') ||
                    body.includes('5.1.1') ||
                    body.includes('does not exist') ||
                    body.includes('user unknown');

                  if (!isHardBounce) return;

                  // Extraction de tous les emails dans le corps
                  const emailRegex = /<([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})>/gi;
                  let match;
                  while ((match = emailRegex.exec(body)) !== null) {
                    const email = match[1].toLowerCase();
                    // On ignore l'email d'envoi
                    if (email !== process.env.SMTP_USER.toLowerCase()) {
                      bouncedEmails.add(email);
                      console.log(`🔴 Bounce réel détecté pour ${email}`);
                    }
                  }
                });
              });
            });

            f.once('end', () => {
              imap.end();
              resolve([...bouncedEmails]);
            });

            f.once('error', (err) => {
              console.error('Erreur fetch:', err);
              imap.end();
              resolve([...bouncedEmails]);
            });
          });
        });
      });

      imap.once('error', (err) => {
        console.error('Erreur IMAP:', err);
        resolve([]);
      });

      imap.connect();
    });

  } catch (err) {
    console.error('Erreur verifierBouncesIMAP:', err);
    return [];
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
      query = {};
    } else if (req.role === "agence") {
      query = {
        $or: [
          { agenceId: req.agence._id },       // Devis dont l'agence est propriétaire
          { shareAgency: req.agence._id }     // Devis partagés avec l'agence
        ]
      };
    } else if (req.role === "employe") {
      const empId = req.user._id.toString();
      const agenceId = req.user.agence;

      const Agence = require("../models/Agency");
      const agence = await Agence.findById(agenceId);

      if (agence?.partage_devis === true) {
        // Voir tous les devis de l'agence
        query = { agenceId: agenceId };
      } else {
        // Voir ses propres devis OU ceux partagés avec lui via shareAgency
        query = {
          agenceId: agenceId, // On reste dans le périmètre de l'agence
          $or: [
            { "creePar.type": "Employe", "creePar.id": empId },
            { shareAgency: empId } // <--- Ajout : si l'ID est dans shareAgency
          ]
        };
      }
    } else {
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
      .populate({
        path: "shareAgency",
        select: "nom_commercial"
      })
      .sort({ dateCreation: -1 })
      .lean();

    // --- Ajout du statut de l'ordre de mission ---
    const devisWithOrdre = await Promise.all(devis.map(async (d) => {
      const ordre = await OrdreMission.findOne({ devisId: d._id }).select('statut').lean();

      return {
        _id: d._id,
        numero: d.numero || `DV-${d._id.toString().slice(-4)}`,
        nomAgence: d.agenceId?.nom_commercial ||' DIMOTEC ',
        pack: d.pack || null,
        diagnosticsSelectionnes: d.diagnosticsSelectionnes || [],
        montantTTC: d.montantTTC || 0,
        totalApresReduction: d.totalApresReduction || 0,
        statut: d.statut || 'Envoyé',
        locataire: d.locataire || null,
        contactLocataire: d.contactLocataire || false,
        clefEnAgence: d.clefEnAgence || false,
        adresseBien: d.adresseBien || null,
        note: d.note || null,
        numeroFiscalBien: d.numeroFiscalBien || null,
        client: d.client || null,
        dateCreation: d.dateCreation || d.createdAt || new Date(),
        accesClientKey: d.accesClientKey || null,
        ordreMissionStatut: ordre?.statut || "Aucune",
        derniereRelance: d.derniereRelance || null,
        pdfUrl: d.pdfUrl || null
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
    const lienDevis = `https://admin.votre-devis-diagnostics.fr/client-Devis/${devis.accesClientKey}`;
    console.log("🔗 Lien du devis envoyé au client :", lienDevis);

    // 💌 Envoi e-mail
    console.log("📨 Envoi de l'e-mail en cours...");
    await sendEmail({
      to: devis.client.email,
      subject: `Rappel concernant Votre devis`,
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

    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ success: false, message: "Utilisateur non authentifié" });
    }

    // 1. Identification de l'entité (Admin ou Agence) pour les crédits
    let userEntity = await Admin.findById(userId);
    let isAdmin = !!userEntity;

    if (!userEntity) {
      const userEmail = req.user?.email;
      userEntity = await Agence.findOne({ 'admin.email': userEmail });
    }

    if (!userEntity) {
      return res.status(404).json({ success: false, message: "Utilisateur non trouvé" });
    }

    // 2. Vérification des crédits
    if (!userEntity.aAssezDeCredits(1)) {
      return res.status(403).json({
        success: false,
        message: "Crédits IA insuffisants.",
        creditsRestants: userEntity.creditsIA || 0
      });
    }

    const data = typeof req.body.data === "string" ? JSON.parse(req.body.data) : req.body.data || req.body;
    const prompt = data.prompt || "";

    // 3. Initialisation des objets de base
    let bien = {
      bien: "",
      transaction: "vente",
      adresseBien: { adresse: "", codePostal: "", ville: "" },
      surfaceAppartement: ""
    };
    let clientInfo = { nom: "", prenom: "", email: "", tel: "" };
    let productMode = "pack";
    let trancheAnnee = "1949_1997"; // Fallback par défaut

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    // 4. Pré-récupération de TOUS les suppléments disponibles pour guider l'IA
    const tousSupplements = await Supplement.find({}); // Récupérer TOUS les suppléments, peu importe le typeBien
    const nomsSupplementsUniques = [...new Set(tousSupplements.map(s => s.nom))];

    console.log("🗄️ TOUS les suppléments disponibles en base:", nomsSupplementsUniques);
    console.log("🔍 Détail des suppléments:", tousSupplements.map(s => ({ nom: s.nom, typeBien: s.typeBien })));

    // 5. APPEL UNIQUE OPENAI : Extraction Client + Analyse Technique
    let installationGaz = data.installationGaz || false;
    let copropriete = data.copropriete || false;
    let diagnosticsSpecifiques = [];
    let supplementsSpecifiques = [];

    if (prompt) {
      console.log("📝 Analyse du prompt par l'IA...");
      const extractionPrompt = `
        Tu es un expert en immobilier français. Analyse ce message : "${prompt}"

        Extraits TOUTES les informations de manière structurée.

        RÈGLES IMPORTANTES :
        - Transaction : "vente" ou "location"
        - Type de bien : "appartement" ou "maison"
        - Année de construction → tranche :
          * avant 1949 → "avant_1949"
          * 1949 à 1997 → "1949_1997"
          * 1998 à 2012 → "1juillet1997_plus15"
          * après 2012 → "moins_15"
        - Surface : extrais le nombre en m2 (ex: "120m2" → "120")
        - Pour appartement, extrais le type si mentionné (ex: "T2", "T3", "F2")
        - ProductMode : si le message mentionne explicitement des diagnostics spécifiques (DPE, Amiante, Plomb, Termites, Gaz, Électricité, ERP, ERNMT), retourne "diagnostic". Sinon "pack".
        - Diagnostics demandés : liste TOUS les diagnostics mentionnés dans le prompt avec leurs NOMS COMPLETS :
          * Si "DPE" est mentionné → ajoute "DPE" (pas "AUDIT DPE")
          * Si "Amiante" est mentionné → ajoute "Amiante"
          * Si "ERP" est mentionné → ajoute "ERP"
          * Si "Termites" est mentionné → ajoute "Termites"
          * Si "Plomb" est mentionné → ajoute "Plomb"
          * Si "Gaz" ou "Diagnostic Gaz" est mentionné → ajoute "Gaz"
          * Si "Électricité" ou "Diagnostic Électricité" est mentionné → ajoute "Électricité"
          * Si "ERNMT" est mentionné → ajoute "ERNMT"
          IMPORTANT : Retourne les noms EXACTS tels qu'ils apparaissent dans cette liste.
        - Installation gaz : true si le message mentionne "gaz", "installation gaz", "chauffage gaz", etc.
        - Copropriété : true si le message mentionne "copropriété", "copro", etc.

        - Suppléments : TRÈS IMPORTANT - DÉTECTE ET SÉLECTIONNE les suppléments mentionnés dans le prompt en utilisant UNIQUEMENT les NOMS EXACTS de cette liste :

          SUPPLÉMENTS DISPONIBLES EN BASE :
          ${JSON.stringify(nomsSupplementsUniques)}

          RÈGLES D'EXTRACTION :
          1. Analyse le prompt pour détecter les mots-clés : cave, garage, parking, jardin, terrasse, piscine, local, dépendance, box, annexe, etc.
          2. Pour chaque mot-clé détecté, cherche le supplément correspondant DANS LA LISTE CI-DESSUS
          3. Retourne le NOM EXACT tel qu'il apparaît dans la liste (respecte la casse et les espaces)
          4. Si "local piscine" est mentionné :
             - ET que "Local Piscine" (avec espace) existe dans la liste → retourne ["Local Piscine"]
             - MAIS que seuls "Local" et "Piscine" existent séparément → retourne ["Local", "Piscine"]
          5. Ne retourne QUE des noms qui existent dans la liste ci-dessus

          EXEMPLES AVEC LISTE :
          - Prompt: "maison avec garage et cave" + Liste: ["Cave", "Garage", "Parking"]
            → supplements_demandes: ["Garage", "Cave"]

          - Prompt: "bien avec local piscine" + Liste: ["Cave", "Local Piscine", "Garage"]
            → supplements_demandes: ["Local Piscine"]

          - Prompt: "bien avec local piscine" + Liste: ["Cave", "Local", "Piscine", "Garage"]
            → supplements_demandes: ["Local", "Piscine"]

        RETOURNE UNIQUEMENT CE JSON :
        {
          "client": {
            "nom": "",
            "prenom": "",
            "email": "",
            "tel": ""
          },
          "bien": {
            "type": "",
            "transaction": "",
            "annee_tranche": "",
            "adresse": "",
            "cp": "",
            "ville": "",
            "surface_m2": "",
            "surface_type": "",
            "installation_gaz": false,
            "copropriete": false
          },
          "productMode": "pack",
          "diagnostics_demandes": [],
          "supplements_demandes": []
        }

        EXEMPLES DE RETOUR :
        - Prompt: "Devis pour Jean Dupont avec maison de 120m2 avec ERP et Termites, possède un garage et une cave"
          → diagnostics_demandes: ["ERP", "Termites"]
          → supplements_demandes: ["Garage", "Cave"]

        - Prompt: "Appartement T3 en vente, présence de parking et terrasse, avec DPE"
          → diagnostics_demandes: ["DPE"]
          → supplements_demandes: ["Parking", "Terrasse"]

        - Prompt: "Maison avec jardin et piscine, diagnostics Plomb et Amiante"
          → diagnostics_demandes: ["Plomb", "Amiante"]
          → supplements_demandes: ["Jardin", "Piscine"]

        - Prompt: "Maison avec local piscine et garage"
          → diagnostics_demandes: []
          → supplements_demandes: ["Local", "Piscine", "Garage"]

        - Prompt: "Bien avec une cave"
          → diagnostics_demandes: []
          → supplements_demandes: ["Cave"]
      `;

      const completion = await openai.chat.completions.create({
        model: "gpt-4-turbo-preview",
        messages: [
          {
            role: "system",
            content: "Tu es un assistant spécialisé dans l'extraction d'informations pour des devis immobiliers. Tu dois être EXTRÊMEMENT ATTENTIF aux détails suivants : diagnostics demandés, suppléments (cave, garage, parking, jardin, etc.). N'oublie JAMAIS de remplir les champs diagnostics_demandes et supplements_demandes s'ils sont mentionnés dans le prompt."
          },
          { role: "user", content: extractionPrompt }
        ],
        response_format: { type: "json_object" },
        temperature: 0,
      });

      const extracted = JSON.parse(completion.choices[0].message.content);
      console.log("🤖 ========== EXTRACTION IA COMPLÈTE ==========");
      console.log(JSON.stringify(extracted, null, 2));
      console.log("🤖 ==========================================");

      // Mise à jour des données avec l'extraction IA
      clientInfo = { ...clientInfo, ...extracted.client };
      bien.bien = extracted.bien.type || "appartement";
      bien.transaction = extracted.bien.transaction || "vente";
      trancheAnnee = extracted.bien.annee_tranche || "1949_1997";
      bien.adresseBien = {
        adresse: extracted.bien.adresse || "",
        codePostal: extracted.bien.cp || "",
        ville: extracted.bien.ville || ""
      };

      // Gestion de la surface selon le type de bien
      if (bien.bien === "appartement") {
        bien.surfaceAppartement = extracted.bien.surface_type || "";
      } else {
        bien.surfaceMaison = extracted.bien.surface_m2 || "";
      }

      productMode = extracted.productMode || "pack";
      installationGaz = extracted.bien.installation_gaz || false;
      copropriete = extracted.bien.copropriete || false;
      diagnosticsSpecifiques = extracted.diagnostics_demandes || [];
      supplementsSpecifiques = extracted.supplements_demandes || [];

      console.log("📊 Mode produit:", productMode);
      console.log("🔧 Installation gaz:", installationGaz);
      console.log("🏢 Copropriété:", copropriete);
      console.log("📋 Diagnostics demandés:", diagnosticsSpecifiques);
      console.log("🏗️ Suppléments demandés:", supplementsSpecifiques);
      console.log("🚨 ATTENTION: Si les suppléments sont vides alors que vous les avez mentionnés, l'IA ne les a pas détectés!");
    }

    // 5. Recherche en Base de Données (Packs & Diagnostics)
    let packs = await Pack.find({
      typeBien: bien.bien,
      trancheAnnee: trancheAnnee,
      typeOperation: bien.transaction
    }).populate("diagnostics");

    let diagnosticsFiltres = await Diagnostic.find({
      typeBien: bien.bien,
      trancheAnnee: trancheAnnee,
      typeOperation: bien.transaction
    });

    console.log("📋 Diagnostics demandés par IA:", diagnosticsSpecifiques);
    console.log("🗄️ Diagnostics disponibles en base:", diagnosticsFiltres.map(d => d.nom));

    // Si des diagnostics spécifiques sont demandés, les filtrer strictement
    if (diagnosticsSpecifiques.length > 0 && productMode === "diagnostic") {
      diagnosticsFiltres = diagnosticsFiltres.filter(d => {
        const nomDiag = d.nom.toLowerCase();

        // Vérifier si le diagnostic correspond à un diagnostic demandé
        const match = diagnosticsSpecifiques.some(nom => {
          const nomDemande = nom.toLowerCase();

          // Si on demande "DPE" mais pas "AUDIT", ne pas inclure "AUDIT DPE"
          if (nomDemande === 'dpe' && nomDiag.includes('audit') && !diagnosticsSpecifiques.some(n => n.toLowerCase().includes('audit'))) {
            return false;
          }

          // Sinon, vérifier le match classique
          return nomDiag.includes(nomDemande) || nomDemande.includes(nomDiag);
        });

        if (match) {
          console.log(`✅ Diagnostic "${d.nom}" retenu`);
        } else {
          console.log(`❌ Diagnostic "${d.nom}" exclu (ne correspond à aucune demande)`);
        }
        return match;
      });
      console.log("🎯 Diagnostics filtrés selon demande:", diagnosticsFiltres.map(d => d.nom));
    } else if (productMode === "diagnostic" && diagnosticsSpecifiques.length === 0) {
      // Si mode diagnostic mais aucun diagnostic spécifique, ne rien retourner
      diagnosticsFiltres = [];
      console.log("⚠️ Mode diagnostic mais aucun diagnostic spécifique demandé");
    }

    // Ajouter diagnostic gaz si installation gaz détectée
    if (installationGaz) {
      const diagGaz = await Diagnostic.findOne({
        typeBien: bien.bien,
        nom: { $regex: /gaz/i }
      });
      if (diagGaz && !diagnosticsFiltres.find(d => d._id.equals(diagGaz._id))) {
        diagnosticsFiltres.push(diagGaz);
        console.log("⛽ Diagnostic gaz ajouté");
      }
    }

    // Ajouter diagnostic copropriété si mentionné
    if (copropriete) {
      const diagCopro = await Diagnostic.findOne({
        typeBien: bien.bien,
        nom: { $regex: /copro|surface/i }
      });
      if (diagCopro && !diagnosticsFiltres.find(d => d._id.equals(diagCopro._id))) {
        diagnosticsFiltres.push(diagCopro);
        console.log("🏢 Diagnostic copropriété ajouté");
      }
    }

    // Récupérer TOUS les suppléments disponibles (pas seulement pour le typeBien actuel)
    // Car certains suppléments comme Cave, Garage peuvent être communs à plusieurs types
    let supplements = await Supplement.find({});

    console.log("📋 Suppléments demandés par IA:", supplementsSpecifiques);
    console.log("🗄️ TOUS les suppléments en base pour matching:", supplements.map(s => `${s.nom} (${s.typeBien})`));

    supplements = supplements.map(s => {
      const nomSupplementBase = s.nom.toLowerCase().trim();

      const isSelected = supplementsSpecifiques.length > 0 && supplementsSpecifiques.some(nomIA => {
        const nomIALower = nomIA.toLowerCase().trim();

        // 1. MATCH EXACT (priorité absolue)
        if (nomSupplementBase === nomIALower) {
          console.log(`✅ MATCH EXACT: "${s.nom}" === "${nomIA}"`);
          return true;
        }

        // 2. MATCH par inclusion complète
        // "Local Piscine" contient "piscine" OU "piscine" contient "Local Piscine"
        if (nomSupplementBase.includes(nomIALower) || nomIALower.includes(nomSupplementBase)) {
          console.log(`✅ MATCH INCLUSION: "${s.nom}" inclut "${nomIA}"`);
          return true;
        }

        // 3. MATCH par mots individuels (pour compatibilité avec noms composés)
        // Si "Local Piscine" en base et IA retourne ["Piscine"] séparément
        const motsBase = nomSupplementBase.split(/\s+/);
        const motsIA = nomIALower.split(/\s+/);

        const matchMots = motsIA.some(motIA => motsBase.some(motBase =>
          motBase.includes(motIA) || motIA.includes(motBase)
        ));

        if (matchMots) {
          console.log(`✅ MATCH PAR MOTS: "${s.nom}" contient un mot de "${nomIA}"`);
        }

        return matchMots;
      });

      if (!isSelected) {
        console.log(`❌ Supplément "${s.nom}" NON sélectionné`);
      }

      return {
        ...s.toObject(),
        selected: isSelected
      };
    });

    console.log("🏗️ Suppléments finaux sélectionnés:", supplements.filter(s => s.selected).map(s => s.nom));

    // Filtrer les suppléments pour ne garder que ceux du type de bien actuel
    const supplementsFiltres = supplements.filter(s => s.typeBien === bien.bien);
    console.log(`🔍 Suppléments filtrés pour typeBien="${bien.bien}":`, supplementsFiltres.map(s => `${s.nom} (selected=${s.selected})`));

    // 6. DEUXIÈME APPEL : Recommandation de Devis (Le conseil métier)
    const conseilPrompt = `
      Basé sur un(e) ${bien.bien} de la période ${trancheAnnee} en ${bien.transaction}.
      ${productMode === "pack" ? `Packs disponibles : ${packs.map(p => p.nom).join(", ")}` : ""}
      ${productMode === "diagnostic" ? `Diagnostics sélectionnés : ${diagnosticsFiltres.map(d => d.nom).join(", ")}` : ""}
      Installation Gaz : ${installationGaz ? "OUI" : "NON"}
      Copropriété : ${copropriete ? "OUI" : "NON"}
      ${supplementsSpecifiques.length > 0 ? `Suppléments demandés : ${supplementsSpecifiques.join(", ")}` : ""}

      ${productMode === "pack"
        ? "Rédige une recommandation courte expliquant pourquoi ce pack est adapté."
        : "Rédige une recommandation courte expliquant pourquoi ces diagnostics sont nécessaires pour cette transaction."
      }
    `;

    const recommandation = await openai.chat.completions.create({
      model: "gpt-4",
      messages: [{ role: "user", content: conseilPrompt }],
      temperature: 0.7,
    });

    const aiResponse = recommandation.choices[0].message.content;

    // 7. Vérification si le client existe déjà
    if (clientInfo.email) {
      // ⚠️ Vérifier s'il y a des doublons d'email
      const duplicates = await Client.find({ email: clientInfo.email });

      if (duplicates.length > 1) {
        console.warn("⚠️ [IA-DEVIS] Plusieurs clients avec le même email détectés !");
        console.warn(`   Email: ${clientInfo.email}`);
        console.warn(`   Nombre de clients: ${duplicates.length}`);
        console.warn(`   Clients trouvés:`, duplicates.map(d => `${d._id} - ${d.prenom} ${d.nom}`));
        console.warn("   ⚠️ Utilisation du premier client trouvé - Vérifiez manuellement");
      }

      const existingClient = duplicates[0];
      if (existingClient) {
        clientInfo = { ...existingClient.toObject(), ...clientInfo }; // Fusionne avec l'existant
      }
    }

    // 8. Construction de la réponse Finale
    const responseJSON = {
      message: "✅ Devis généré avec succès",
      suggestion: aiResponse,
      productMode,
      client: clientInfo,
      bien: {
        ...bien,
        trancheAnnee,
        anneeConstruction: trancheAnnee,
        gaz: installationGaz,
        copropriete: copropriete
      },
      packs: productMode === "pack" ? packs.map((p, index) => {
        let tarif = {};

        if (bien.bien === "appartement" && p.tarifsParAppartement && bien.surfaceAppartement) {
          const tranche = p.tarifsParAppartement.find(t =>
            t.typeAppartement === bien.surfaceAppartement
          );
          tarif = tranche?.tarifs || p.tarifs || {};
        } else {
          tarif = p.tarifs || {};
        }

        return {
          _id: p._id,
          id: p._id,
          nom: p.nom,
          tarifs: p.tarifs || {},
          tarifsParAppartement: p.tarifsParAppartement || [],
          tarif: tarif,
          diagnostics: p.diagnostics || [],
          selected: index === 0
        };
      }) : [],
      diagnostics: productMode === "diagnostic" ? diagnosticsFiltres.map(d => {
        // Calculer le prix selon le type de bien et la surface
        let prix = 0;
        let tarifsObj = {};

        if (bien.bien === "maison" && d.tarifsParSurface) {
          const surface = parseInt(bien.surfaceMaison) || 0;
          const tranche = d.tarifsParSurface.find(t =>
            surface >= t.surfaceMin && surface <= t.surfaceMax
          );
          if (tranche) {
            tarifsObj = tranche.tarifs || {};
            // Utiliser le tarif par défaut (autre)
            prix = tranche.tarifs?.autre || tranche.tarifs?.herault || tranche.tarifs?.var || 0;
          }
        } else if (bien.bien === "appartement" && d.tarifsParAppartement) {
          const tranche = d.tarifsParAppartement.find(t =>
            t.typeAppartement === bien.surfaceAppartement
          );
          if (tranche) {
            tarifsObj = tranche.tarifs || {};
            prix = tranche.tarifs?.autre || tranche.tarifs?.herault || tranche.tarifs?.var || 0;
          }
        }

        return {
          _id: d._id,
          id: d._id,
          nom: d.nom,
          prix: prix,
          tarifsParSurface: d.tarifsParSurface || [],
          tarifsParAppartement: d.tarifsParAppartement || [],
          tarifs: tarifsObj,
          selected: true
        };
      }) : [],
      supplements: Array.isArray(supplementsFiltres) && supplementsFiltres.length > 0
        ? supplementsFiltres.map(s => ({
            _id: s._id,
            id: s._id,
            nom: s.nom,
            tarifs: s.tarifs || {},
            selected: s.selected || false
          }))
        : []
    };

    // 🤖 Déduction du crédit
    try {
      await userEntity.ajouterCreditsIA({
        type: 'utilisation',
        nombreCredits: 1,
        description: `Génération devis AI - ${bien.bien}`,
        par: isAdmin ? userEntity.email : (userEntity.admin?.email || 'système')
      });
    } catch (e) { console.error("Erreur crédit:", e); }

    responseJSON.creditsRestants = userEntity.creditsIA;

    // LOG FINAL : Vérifier ce qui est envoyé au frontend
    console.log("📤 ========== RÉPONSE ENVOYÉE AU FRONTEND ==========");
    console.log("📦 Suppléments envoyés:", responseJSON.supplements?.map(s => ({ nom: s.nom, selected: s.selected })));
    console.log("📦 Diagnostics envoyés:", responseJSON.diagnostics?.map(d => ({ nom: d.nom, selected: d.selected })));
    console.log("📤 =================================================");

    return res.status(200).json(responseJSON);

  } catch (error) {
    console.error("❌ Erreur generateDevisAI:", error);
    return res.status(500).json({ message: "Erreur lors de la génération IA." });
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
      // Seulement les devis "Envoyé" ou "ouvert"
      statut: { $in: ["Envoyé", "ouvert"] },
      // ⚠️ IMPORTANT : Exclure les devis déjà signés (en attente d'upload PDF)
      cgvAccepted: { $ne: true },
      $or: [
        { derniereRelance: { $lt: deuxJours } },
        { derniereRelance: null }
      ],
      'client.email': { $exists: true, $ne: "" }
    });

    console.log(`🔍 ${devisArelancer.length} devis candidats trouvés (Statuts: Envoyé/Ouvert, non signés)`);

    let rappelsEnvoyes = 0;
    let devisIgnores = 0;
    let devisAvecOrdre = 0;

    for (const devis of devisArelancer) {
      // ⚠️ VÉRIFICATION CRITIQUE 1 : Ne pas relancer si un ordre de mission existe déjà
      const ordreMissionExiste = await OrdreMission.findOne({ devisId: devis._id });

      if (ordreMissionExiste) {
        console.log(`⏭️  Devis ${devis.numero} IGNORÉ - Ordre de mission ${ordreMissionExiste.numero} déjà créé (RDV: ${ordreMissionExiste.rdvDate ? new Date(ordreMissionExiste.rdvDate).toLocaleDateString('fr-FR') : 'Non fixé'})`);
        devisAvecOrdre++;
        continue;
      }

      // ⚠️ VÉRIFICATION CRITIQUE 2 : Ne pas relancer si le statut est "Accepté"
      if (devis.statut === "Accepté") {
        console.log(`⏭️  Devis ${devis.numero} IGNORÉ - Statut déjà "Accepté"`);
        devisIgnores++;
        continue;
      }

      // Si toutes les vérifications passent, on peut envoyer le rappel
      const lienDevis = `https://admin.votre-devis-diagnostics.fr/client-Devis/${devis.accesClientKey}`;

      await sendEmail({
        to: devis.client.email,
        subject: `Rappel concernant Votre devis`,
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
      rappelsEnvoyes++;
    }

    console.log(`✅ Job de rappels terminé - ${rappelsEnvoyes} rappels envoyés, ${devisAvecOrdre} devis avec ordre de mission, ${devisIgnores} devis déjà acceptés`);
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

    console.log('utilisateur : ', req.user)


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

    // 🔎 Gestion du client (existant ou nouveau)
    let client;

    // Si le client a un _id, c'est un client existant
    if (data.client._id) {
      console.log('✅ Client existant sélectionné:', data.client._id);

      // Vérifier que le client existe et appartient à l'agence
      client = await Client.findById(data.client._id);

      if (!client) {
        return res.status(404).json({ message: "Client introuvable." });
      }

      // ⚠️ Vérifier s'il y a des doublons d'email pour ce client
      if (client.email) {
        const duplicates = await Client.find({ email: client.email, _id: { $ne: client._id } });
        if (duplicates.length > 0) {
          console.warn('⚠️ ATTENTION: Plusieurs clients avec le même email détectés!');
          console.warn(`   Email: ${client.email}`);
          console.warn(`   Client sélectionné: ${client._id} - ${client.prenom} ${client.nom}`);
          console.warn(`   Autres clients avec cet email:`, duplicates.map(d => `${d._id} - ${d.prenom} ${d.nom}`));
        }
      }

      // Ajouter l'agence au client s'il ne l'a pas déjà
      if (agenceId && !client.agences.includes(agenceId)) {
        client.agences.push(agenceId);
        await client.save();
        console.log('✅ Agence ajoutée au client existant');
      }
    } else {
      // Nouveau client : créer
      console.log('🆕 Création d\'un nouveau client');

      const clientPayload = {
        ...data.client,
        email: data.client.email ? data.client.email.trim() : "",
        telephone: data.client.tel || data.client.telephone || "",
        agences: agenceId ? [agenceId] : [],
      };

      delete clientPayload.tel;
      delete clientPayload._id; // Supprimer _id s'il est null/undefined

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

      client = new Client(clientPayload);
      await client.save();
      console.log('✅ Nouveau client créé:', client._id);
    }


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

      console.log("\nTotal avant remise (diagnostics uniquement) =", totalAvantRemise);
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
        const tarifUnitaire = Number((l.prixHT * 1.2).toFixed(2)) || 0; // ou prixTTC si tu veux
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
// --- Diagnostic Gaz si applicable ---
let tarifGaz = 0;
if (data.installationGaz === true) {
  // 🔍 FIX: On cherche le Gaz qui correspond au BIEN et à la TRANSACTION
  const diagGaz = await Diagnostic.findOne({ 
    nom: /gaz/i,
    typeBien: data.bien,            // 'maison' ou 'appartement'
    typeOperation: data.transaction // 'vente' ou 'location'
  });

  if (diagGaz) {
    const dejaSelectionne = data.diagnosticsSelectionnes?.includes(diagGaz._id.toString());
    if (!dejaSelectionne) {
      
      if (data.bien === "maison" && diagGaz.tarifsParSurface?.length) {
        const surfaceStr = (data.surfaceMaison || data.surface || "0").toString();

        let surfaceMin = 0, surfaceMax = 0;

        // Gérer les plages de surface (ex: "121-150m²") et les valeurs uniques (ex: "130")
        const surfaceCleaned = surfaceStr.replace(/[^\d-]/g, "");

        if (surfaceCleaned.includes("-")) {
          const match = surfaceCleaned.match(/(\d+)-(\d+)/);
          surfaceMin = match ? parseInt(match[1], 10) : 0;
          surfaceMax = match ? parseInt(match[2], 10) : surfaceMin;
        } else {
          const valeur = parseInt(surfaceCleaned, 10) || 0;
          surfaceMin = valeur;
          surfaceMax = valeur;
        }

        console.log(`🔥 GAZ - Surface min=${surfaceMin}, max=${surfaceMax}, secteur=${secteur}`);

        // Trouver une tranche qui overlap avec la surface demandée
        const tranche = diagGaz.tarifsParSurface.find(t => {
          return !(surfaceMax < t.surfaceMin || surfaceMin > t.surfaceMax);
        });

        if (tranche) {
          tarifGaz = Number(tranche.tarifs?.[secteur] ?? tranche.tarifs?.autre ?? 0);
          console.log(`✅ GAZ - Tranche trouvée: ${tranche.surfaceMin}-${tranche.surfaceMax}m², tarif=${tarifGaz}€`);
        } else {
          console.warn(`⚠️ GAZ - Aucune tranche trouvée pour surface ${surfaceMin}-${surfaceMax}m²`);
        }
      } 
      else if (data.bien === "appartement" && diagGaz.tarifsParAppartement?.length) {
        const mappingAppartement = {
          "moins 20m²": "<20m2", "20-40m²": "20-40m2",
          "T1": "T1", "T2": "T2", "T3": "T3", "T4": "T4", "T5": "T5"
        };
        const typeAppart = mappingAppartement[data.surfaceAppartement] || data.surfaceAppartement;
        const tps = diagGaz.tarifsParAppartement.find(t => t.typeAppartement === typeAppart);
        if (tps) {
          tarifGaz = Number(tps.tarifs?.[secteur] ?? tps.tarifs?.autre ?? 0);
        }
      }

      totalAvantRemise = Number(totalAvantRemise) + tarifGaz;
      data.diagnosticsSelectionnes.push(diagGaz._id.toString());
    }
  } else {
    console.warn(`⚠️ Aucun diagnostic GAZ trouvé pour ${data.bien} / ${data.transaction}`);
  }
}

    // --- Diagnostic Surface (Copropriété) si applicable ---
    // Pour tous les types de biens SAUF maison
    // Uniquement pour le mode diagnostic à la carte (pas pour les packs)
    let tarifCopro = 0;
    if (data.copropriete === true && data.bien !== "maison" && data.type === "diagnostic") {
      // Chercher le diagnostic Surface correspondant au type de bien et à la transaction
      const diagCopro = await Diagnostic.findOne({
        nom: /surface/i,
        typeBien: data.bien,
        typeOperation: data.transaction
      });

      if (diagCopro) {
        const dejaSelectionne = data.diagnosticsSelectionnes?.includes(diagCopro._id.toString());
        if (!dejaSelectionne) {

          // Pour appartements
          if (data.bien === "appartement" && diagCopro.tarifsParAppartement?.length) {
            const mappingAppartement = {
              "moins 20m²": "<20m2", "20-40m²": "20-40m2",
              "T1": "T1", "T2": "T2", "T3": "T3", "T4": "T4", "T5": "T5"
            };
            const typeAppart = mappingAppartement[data.surfaceAppartement] || data.surfaceAppartement;
            const tps = diagCopro.tarifsParAppartement.find(t => t.typeAppartement === typeAppart);
            if (tps) {
              tarifCopro = Number(tps.tarifs?.[secteur] ?? tps.tarifs?.autre ?? 0);
              console.log(`✅ SURFACE (COPRO) - Appartement type ${typeAppart}, tarif=${tarifCopro}€`);
            }
          }
          // Pour autres types de biens (locaux commerciaux, terrains, etc.)
          else if (data.bien !== "appartement" && diagCopro.tarifsParSurface?.length) {
            const surfaceStr = (data.surfaceMaison || data.surface || "0").toString();
            let surfaceMin = 0, surfaceMax = 0;

            const surfaceCleaned = surfaceStr.replace(/[^\d-]/g, "");

            if (surfaceCleaned.includes("-")) {
              const match = surfaceCleaned.match(/(\d+)-(\d+)/);
              surfaceMin = match ? parseInt(match[1], 10) : 0;
              surfaceMax = match ? parseInt(match[2], 10) : surfaceMin;
            } else {
              const valeur = parseInt(surfaceCleaned, 10) || 0;
              surfaceMin = valeur;
              surfaceMax = valeur;
            }

            console.log(`🏢 SURFACE (COPRO) - Surface min=${surfaceMin}, max=${surfaceMax}, secteur=${secteur}`);

            const tranche = diagCopro.tarifsParSurface.find(t => {
              return !(surfaceMax < t.surfaceMin || surfaceMin > t.surfaceMax);
            });

            if (tranche) {
              tarifCopro = Number(tranche.tarifs?.[secteur] ?? tranche.tarifs?.autre ?? 0);
              console.log(`✅ SURFACE (COPRO) - Tranche trouvée: ${tranche.surfaceMin}-${tranche.surfaceMax}m², tarif=${tarifCopro}€`);
            } else {
              console.warn(`⚠️ SURFACE (COPRO) - Aucune tranche trouvée pour surface ${surfaceMin}-${surfaceMax}m²`);
            }
          }

          totalAvantRemise = Number(totalAvantRemise) + tarifCopro;
          data.diagnosticsSelectionnes.push(diagCopro._id.toString());
        }
      } else {
        console.warn(`⚠️ Aucun diagnostic SURFACE trouvé pour ${data.bien} / ${data.transaction}`);
      }
    }

    // 🚚 Frais de déplacement (appliqué selon le choix de l'admin, pour tous les types)

    // 🆕 Si fraisDeplacementAppliques n'est pas défini, le définir automatiquement
    if (data.fraisDeplacementAppliques === undefined || data.fraisDeplacementAppliques === null) {
      // Déterminer si c'est un pack ou des diagnostics à la carte
      const estPack = data.type === "pack_complet" || data.pack;
      const estDiagnostic = data.type === "diagnostic";

      // Vérifier si c'est uniquement ERP
      let uniquementERP = false;
      if (estDiagnostic && data.diagnosticsSelectionnes?.length > 0) {
        // Récupérer les diagnostics pour vérifier leurs noms
        const diagnosticsIds = data.diagnosticsSelectionnes;
        const diagnosticsRecuperes = await Diagnostic.find({ _id: { $in: diagnosticsIds } });

        // Vérifier si c'est uniquement ERP
        uniquementERP =
          diagnosticsRecuperes.length === 1 &&
          diagnosticsRecuperes[0].nom.toLowerCase().includes('erp');
      }

      // Logique automatique :
      // - Si pack → false
      // - Si diagnostic à la carte avec au moins 1 diagnostic (et pas uniquement ERP) → true
      // - Sinon → false
      if (!estPack && estDiagnostic && data.diagnosticsSelectionnes?.length > 0 && !uniquementERP) {
        data.fraisDeplacementAppliques = true;
        console.log("🆕 Frais de déplacement automatiquement définis à TRUE (diagnostic à la carte)");
      } else {
        data.fraisDeplacementAppliques = false;
        console.log("🆕 Frais de déplacement automatiquement définis à FALSE (pack ou ERP seul)");
      }
    }

    if (data.fraisDeplacementAppliques === true) {
      totalAvantRemise += 55;
      console.log("✅ Frais de déplacement appliqués (+55€)");
    } else {
      console.log("❌ Frais de déplacement non appliqués");
    }

    // 💸 Calculs financiers
    let reductionPourcent = Number(data.reductionPourcent) || 0;
let montantCagnotteUtilisee = (typeof data.montantCagnotteUtilisee === 'boolean') 
    ? 0 
    : (Number(data.montantCagnotteUtilisee) || 0);
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

    // 🆕 1. PLACE LE BLOC ICI
    let typeAffichage = "Diagnostics à la carte";
    if (data.type === "pack_complet" && data.pack) {
      const packInfo = await Pack.findById(data.pack);
      typeAffichage = `PACK : ${packInfo?.nom?.toUpperCase() || "COMPLET"}`;
    } else if (data.type === "diagnostic") {
      typeAffichage = "DIAGNOSTICS";
    } else if (data.type === "audit") {
      typeAffichage = "AUDIT ÉNERGÉTIQUE";
    }

    const shareAgencyId = data.shareAgency && data.shareAgency !== "" ? data.shareAgency : null;

    // 🆕 Récupérer le nom de la nouvelle agence si applicable
    const shareAgencyName = data.newAgencyShare?.nom || null;

    console.log("==== Client avant création devis ====", client);


    // 🧾 Création du devis avec les données du client récupéré/créé
    const devis = new Devis({
      agenceId,
      shareAgency: shareAgencyId,
      shareAgencyName,
      creePar,
      clientId: client._id, // ✅ IMPORTANT : Stocker la référence au client
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

      // 🆕 Ajouter les champs locataire
      locataire: data.locataire || null,
      contactLocataire: data.contactLocataire || false,
      clefEnAgence: data.clefEnAgence || false,
      informationsComplementaires: data.informationsComplementaires || "",
      type: data.type,
      bien: data.bien,
      transaction: data.transaction,
      adresseBien: data.adresseBien,
      surfaceMaison: data.surfaceMaison,
      typeSurfaceMaison: data.typeSurfaceMaison,
      ...(data.bien === "appartement" ? { surfaceAppartement: data.surfaceAppartement } : {}),
      anneeConstruction: data.anneeConstruction,
      numeroFiscalBien: data.numeroFiscalBien || null,
      pack: data.pack || null,
      diagnosticsSelectionnes: data.diagnosticsSelectionnes || [],
      supplementsSelectionnes,
      chauffageGaz: data.installationGaz === true, // ✅ true/false
      tarifGaz: tarifGaz, // ✅ Stocker le tarif Gaz pour éviter les recalculs
      copropriete: data.copropriete === true,  // ✅ nouveau champ
      tarifCopropriete: tarifCopro,
      fraisDeplacementAppliques: data.fraisDeplacementAppliques === true, // 🆕 Frais de déplacement
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
      secteur,
      diagnostiqueurAssigne: data.diagnostiqueurAssigne || null // ✅ Diagnostiqueur assigné dès la création
    });

    console.log('💾 Avant sauvegarde - diagnostiqueurAssigne:', data.diagnostiqueurAssigne?.toString() || 'NULL');

    await devis.save();

    console.log('✅ Devis créé:', {
      numero: devis.numero,
      _id: devis._id.toString(),
      clientId: devis.clientId?.toString() || 'NON DÉFINI', // ✅ Vérifier que le clientId est bien sauvegardé
      diagnostiqueurAssigne: devis.diagnostiqueurAssigne?.toString() || 'NON ASSIGNÉ',
      agenceId: devis.agenceId?.toString() || 'AUCUNE',
      client: `${devis.client.nom} ${devis.client.prenom}`
    });

    // ✅ Ajouter le devis au client
    if (!client.devis.includes(devis._id)) {
      client.devis.push(devis._id);
      await client.save();
    }

    // ✅ Ajouter le client et le devis à l'agence si applicable
    if (agenceId) {
      const agence = await Agence.findById(agenceId);
      if (agence) {
        // Ajouter le client à l'agence s'il n'y est pas déjà
        if (!agence.clients.includes(client._id)) {
          agence.clients.push(client._id);
        }
        // Ajouter le devis à l'agence s'il n'y est pas déjà
        if (!agence.devis.includes(devis._id)) {
          agence.devis.push(devis._id);
        }
        await agence.save();
      }
    }

    // ✅ Si le payeur est l'agence
    // ✅ Si le payeur est l'agence
    if (data.payer === "agence") {
      // Récupérer le diagnostiqueur assigné au devis, sinon le diagnostiqueur par défaut de l'agence
      const agenceData = await Agence.findById(devis.agenceId);
      const diagnostiqueurId = devis.diagnostiqueurAssigne || agenceData?.diagnostiqueurParDefaut || null;

      const ordre = new OrdreMission({
        devisId: devis._id,
        agenceId: devis.agenceId,
        numero: `OM-${Date.now()}`,
        clientId: client._id,
        description: `Ordre de mission pour le devis ${devis.numero}`,
        statut: "Commande",
        creePar,
        diagnostiqueur: diagnostiqueurId,
        statutAcceptation: diagnostiqueurId ? 'en_attente' : null
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

      // Synchroniser diagnostiqueurAssigne dans le devis et mettre à jour compteur agence
      if (diagnostiqueurId) {
        devis.diagnostiqueurAssigne = diagnostiqueurId;

        // 📧 Envoyer un email au diagnostiqueur pour l'informer qu'il a été choisi
        try {
          const Diagnostiqueur = require('../models/Diagnostiqueur');
          const diagnostiqueurData = await Diagnostiqueur.findById(diagnostiqueurId);
          if (diagnostiqueurData?.admin?.email) {
            await sendEmail({
              to: diagnostiqueurData.admin.email,
              subject: '🔔 Nouvelle mission disponible - DIMOTEC',
              html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f9f9f9;">
                  <div style="background: linear-gradient(135deg, #FF6B35 0%, #FF8C42 100%); padding: 30px; border-radius: 10px 10px 0 0; text-align: center;">
                    <h1 style="color: white; margin: 0; font-size: 28px;">🎯 Nouvelle Mission Disponible</h1>
                  </div>
                  <div style="background: white; padding: 30px; border-radius: 0 0 10px 10px; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
                    <p style="font-size: 16px; color: #333; line-height: 1.6;">
                      Bonjour <strong>${diagnostiqueurData.nom_entreprise}</strong>,
                    </p>
                    <p style="font-size: 16px; color: #333; line-height: 1.6;">
                      Bonne nouvelle ! Vous avez été sélectionné pour une nouvelle mission.
                    </p>
                    <div style="background: #f5f5f5; padding: 20px; border-radius: 8px; margin: 20px 0;">
                      <h3 style="color: #FF6B35; margin-top: 0;">📋 Détails de la mission</h3>
                      <p style="margin: 8px 0;"><strong>Numéro du devis :</strong> ${devis.numero}</p>
                      <p style="margin: 8px 0;"><strong>Client :</strong> ${devis.client?.nom} ${devis.client?.prenom}</p>
                      <p style="margin: 8px 0;"><strong>Montant TTC :</strong> ${devis.montantTTC || devis.totalApresReduction || 'N/A'} €</p>
                      <p style="margin: 8px 0;"><strong>Agence :</strong> ${agenceData?.nom_commercial || 'N/A'}</p>
                    </div>
                    <p style="font-size: 16px; color: #333; line-height: 1.6;">
                      Cette mission est en attente de votre acceptation. Connectez-vous à votre espace pour consulter tous les détails et accepter la mission.
                    </p>
                    <div style="text-align: center; margin: 30px 0;">
                      <a href="${process.env.FRONTEND_DIAGNOSTIQUEUR_URL || 'https://diagnostiqueur.dimotec.fr'}/missions"
                         style="background: linear-gradient(135deg, #FF6B35 0%, #FF8C42 100%); color: white; padding: 15px 30px; text-decoration: none; border-radius: 8px; font-weight: bold; display: inline-block; box-shadow: 0 4px 6px rgba(255,107,53,0.3);">
                        📱 Voir la mission
                      </a>
                    </div>
                    <p style="font-size: 14px; color: #666; margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee;">
                      Cordialement,<br>
                      <strong>L'équipe DIMOTEC</strong>
                    </p>
                  </div>
                </div>
              `
            });
            console.log('✅ Email envoyé au diagnostiqueur pour nouvelle mission');
          }
        } catch (emailError) {
          console.error('❌ Erreur envoi email diagnostiqueur:', emailError);
          // Ne pas bloquer la création du devis si l'email échoue
        }
      }

      // ⚠️ IMPORTANT : Mettre à jour le statut du devis pour éviter les relances
      devis.statut = "Accepté";
      await devis.save();

        // Incrémenter le compteur d'utilisation dans l'agence
        const Diagnostiqueur = require('../models/Diagnostiqueur');
        const diagnostiqueur = await Diagnostiqueur.findById(diagnostiqueurId);
        if (diagnostiqueur && agenceData) {
          const diagUtilise = agenceData.diagnostiqueursUtilises?.find(
            d => d.diagnostiqueur.toString() === diagnostiqueurId.toString()
          );

          if (diagUtilise) {
            diagUtilise.nombreCommandes += 1;
            diagUtilise.derniereCommande = new Date();
          } else {
            if (!agenceData.diagnostiqueursUtilises) {
              agenceData.diagnostiqueursUtilises = [];
            }
            agenceData.diagnostiqueursUtilises.push({
              diagnostiqueur: diagnostiqueurId,
              nombreCommandes: 1,
              derniereCommande: new Date()
            });
          }

          await agenceData.save();
        }


      // ✅ Emails
      const agence = await Agence.findById(devis.agenceId);
      const agenceEmail = agence?.emails_contact?.[0]?.email; // null si agence ou email inexistant
      const dimotecEmail = "dimotec34@gmail.com";
      // 1. On prépare les variables communes (sans le lien pour l'instant)
      const baseVariables = {
        nomClient: `${devis.client.prenom} ${devis.client.nom}`,
        numero: ordre.numero,
        devisNumero: devis.numero,
        nomAgence: agence?.nom_commercial || "",
        dateCreation: new Date().toLocaleDateString("fr-FR"),
        description: ordre.description,
        statut: ordre.statut,
      };

      // ✅ Envoi mail à l'AGENCE (Lien vers agence.votre-devis...)
      if (agenceEmail) {
        await sendEmail({
          to: agenceEmail,
          subject: `Nouvel Ordre de Mission - ${ordre.numero}`,
          template: "OrdreMission.html",
          variables: {
            ...baseVariables,
            lienMission: `https://agence.votre-devis-diagnostics.fr/ordre-mission` // Lien spécifique Agence
          }
        });

        // ⏱️ Attente 2 secondes avant email suivant
        await sleep(2000);
      }

      // ✅ Envoi mail DIMOTEC (Lien vers admin.votre-devis...)
      await sendEmail({
        to: dimotecEmail,
        subject: `[ADMIN] Nouvel Ordre de Mission - ${ordre.numero}`,
        template: "OrdreMission.html",
        variables: {
          ...baseVariables,
          lienMission: `https://admin.votre-devis-diagnostics.fr/ordre-mission` // Lien spécifique Admin
        }
      });

      return res.status(201).json({
        message: "✅ Devis créé, accepté automatiquement et ordre envoyé (payeur agence).",
        devis,
      });
    }





    // 💌 Envoi de l'e-mail si le payeur est le client
    // 💌 Envoi de l'e-mail si le payeur est le client
    if (data.payer === "client") {
      const lienDevis = `https://admin.votre-devis-diagnostics.fr/client-Devis/${devis.accesClientKey}`;

      try {
        console.log("📤 Tentative d'envoi e-mail au client :", client.email);

        // 1. Mail au Client
        await sendEmail({
          to: client.email,
          subject: `Votre devis est prêt`,
          template: "devis.html",
          variables: {
            nomClient: `${client.prenom} ${client.nom}`,
            lienDevis,
            "[Adresse email]": req.agence?.email || "support@.votre-devis-diagnostics.fr",
            "[Numéro de téléphone]": req.agence?.telephone || "06 00 00 00 00",
          },
        });

        console.log("✅ Email envoyé avec succès au client :", client.email);

        // ✅ Mise à jour du statut : Succès
        devis.emailNonDelivre = false;
        devis.statut = "Envoyé";
        await devis.save();

        // ⏱️ Courte attente avant la suite pour ménager Hostinger
        await sleep(2000);

        // --- Notification à l'agence ---
        const agence = await Agence.findById(devis.agenceId);
        const agenceEmail = agence?.emails_contact?.[0]?.email;

        if (agenceEmail) {
          console.log("📤 Envoi copie à l'agence :", agenceEmail);
          await sendEmail({
            to: agenceEmail,
            subject: `Nouveau devis créé - ${devis.numero} - ${client.prenom} ${client.nom}`,
            template: "notification_agence_devis.html",
            variables: {
              nomClient: `${client.prenom} ${client.nom}`,
              typeDevis: typeAffichage,
              numero: devis.numero,
              montant: devis.montantTTC,
              lienDevis: "https://agence.votre-devis-diagnostics.fr/billing"
            },
          });
          console.log("✅ Notification envoyée à l'agence");
        }

      } catch (err) {
        console.error(`❌ Erreur SMTP (Mail non envoyé) pour ${client.email}:`, err.message);

        // ❗ On marque l'erreur en BDD, mais on ne bloque pas la réponse au front
        devis.emailNonDelivre = true;
        devis.emailClientErrone = client.email;
        devis.statut = "Email_Errone";
        await devis.save();

        // 🔔 Tentative d'alerte silencieuse (optionnelle)
        try {
          const dimotecEmail = "dimotec34@gmail.com";
          await sendEmail({
            to: dimotecEmail,
            subject: `⚠️ Échec envoi devis ${devis.numero}`,
            template: "alerteEmailClient.html",
            variables: {
              clientNom: `${client.prenom} ${client.nom}`,
              emailClient: client.email,
              devisNumero: devis.numero,
              error: err.message
            },
          });
        } catch (silentErr) {
          console.error("Impossible d'envoyer l'alerte d'échec SMTP.");
        }
      }
    }

    // ✅ RÉPONSE FINALE : Toujours renvoyée au front-end si on arrive ici
    return res.status(201).json({
      message: "✅ Devis créé avec succès.",
      note: "Le devis est enregistré en base de données.",
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

  // Nettoyer l'email (supprimer espaces avant/après)
  const emailCleaned = nouvelEmail.trim();

  const devis = await Devis.findById(devisId);
  if (!devis) return res.status(404).json({ message: "Devis introuvable." });

  // Mettre à jour email dans le devis
  devis.client.email = emailCleaned;
  devis.emailNonDelivre = false;
  devis.statut = "Envoyé";

  // 📌 Corriger aussi le vrai client en BDD
  const client = await Client.findOne({
    nom: devis.client.nom,
    prenom: devis.client.prenom,
    telephone: devis.client.tel || devis.client.telephone
  });

  if (client) {
    client.email = emailCleaned;
    await client.save();
  }

  await devis.save();

  try {
    await sendEmail({
      to: emailCleaned,
      subject: `Votre devis est prêt`,
      template: "devis.html",
      variables: {
        nomClient: `${devis.client.prenom} ${devis.client.nom}`,
        lienDevis: `https://admin.votre-devis-diagnostics.fr/client-Devis/${devis.accesClientKey}`,
        "[Adresse email]": req.agence?.email || "support@.votre-devis-diagnostics.fr",
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
    console.log("📥 [UPLOAD-PDF] Réception requête pour devisId:", req.params.devisId);
    const { devisId } = req.params;

    // 1️⃣ Vérification de la présence du fichier
    if (!req.file) {
      console.error("❌ [UPLOAD-PDF] Aucun fichier reçu dans req.file");
      return res.status(400).json({ message: "Aucun fichier PDF reçu." });
    }

    console.log("✅ [UPLOAD-PDF] Fichier reçu:", {
      filename: req.file.filename,
      size: `${(req.file.size / 1024 / 1024).toFixed(2)} MB`,
      mimetype: req.file.mimetype
    });

    const pdfUrl = req.file.path; // URL récupérée depuis Cloudinary via multer-storage-cloudinary
    console.log("☁️ [UPLOAD-PDF] URL Cloudinary:", pdfUrl);

    // 2️⃣ Récupération du devis et des relations nécessaires
    const devis = await Devis.findById(devisId).populate('diagnosticsSelectionnes');
    if (!devis) {
      console.error("❌ [UPLOAD-PDF] Devis introuvable:", devisId);
      return res.status(404).json({ message: "Devis introuvable." });
    }

    console.log("📋 [UPLOAD-PDF] Devis trouvé:", devis.numero);

    // 3️⃣ MISE À JOUR CRITIQUE : Passage au statut "Accepté" et enregistrement du PDF
    console.log("💾 [UPLOAD-PDF] Mise à jour du statut vers 'Accepté'...");
    devis.statut = "Accepté";
    devis.pdfUrl = pdfUrl;
    await devis.save();
    console.log("✅ [UPLOAD-PDF] Devis sauvegardé avec succès");

    // 4️⃣ LOGIQUE MÉTIER : Création de l'Ordre de Mission
    console.log("📝 [UPLOAD-PDF] Création de l'Ordre de Mission...");
    let clientId = devis.clientId;

    // ⚠️ IMPORTANT : Toujours privilégier le clientId du devis
    if (!clientId && devis.client?.email) {
      console.warn("⚠️ [UPLOAD-PDF] Devis sans clientId, recherche par email...");

      // Vérifier s'il y a des doublons d'email
      const duplicates = await Client.find({ email: devis.client.email });

      let client;

      if (duplicates.length > 1) {
        console.error("❌ [UPLOAD-PDF] PLUSIEURS CLIENTS AVEC LE MÊME EMAIL DÉTECTÉS !");
        console.error(`   Email: ${devis.client.email}`);
        console.error(`   Nombre de clients: ${duplicates.length}`);
        console.error(`   Clients trouvés:`, duplicates.map(d => `${d._id} - ${d.prenom} ${d.nom}`));

        // Tentative de correspondance par nom et prénom
        const normalizeString = (str) => str?.toLowerCase().trim() || '';
        const devisNom = normalizeString(devis.client.nom);
        const devisPrenom = normalizeString(devis.client.prenom);

        console.log(`🔍 [UPLOAD-PDF] Recherche de correspondance pour: ${devis.client.prenom} ${devis.client.nom}`);

        const matchingClients = duplicates.filter(c => {
          const clientNom = normalizeString(c.nom);
          const clientPrenom = normalizeString(c.prenom);
          return clientNom === devisNom && clientPrenom === devisPrenom;
        });

        if (matchingClients.length === 1) {
          console.log(`✅ [UPLOAD-PDF] Correspondance unique trouvée par nom/prénom: ${matchingClients[0].prenom} ${matchingClients[0].nom} (ID: ${matchingClients[0]._id})`);
          client = matchingClients[0];
        } else if (matchingClients.length > 1) {
          console.error("   ⚠️ [UPLOAD-PDF] PLUSIEURS CLIENTS AVEC LE MÊME NOM/PRÉNOM - ORDRE DE MISSION NON CRÉÉ");
          return res.status(400).json({
            message: "Plusieurs clients avec le même nom/prénom détectés. Impossible de créer l'ordre de mission automatiquement."
          });
        } else {
          console.error("   ⚠️ [UPLOAD-PDF] AUCUNE CORRESPONDANCE PAR NOM/PRÉNOM - ORDRE DE MISSION NON CRÉÉ");
          return res.status(400).json({
            message: "Impossible de déterminer le bon client parmi les doublons d'email. Veuillez contacter le support."
          });
        }
      } else {
        client = duplicates[0];
      }

      if (client) {
        clientId = client._id;

        // Mettre à jour le devis avec le clientId trouvé
        devis.clientId = clientId;
        await devis.save();
        console.log("✅ [UPLOAD-PDF] Client trouvé et associé au devis:", clientId);
      } else {
        console.error("❌ [UPLOAD-PDF] Aucun client trouvé avec l'email:", devis.client.email);
      }
    }

    // Récupérer le diagnostiqueur assigné au devis, sinon le diagnostiqueur par défaut de l'agence
    const agenceData = await Agence.findById(devis.agenceId);
    const diagnostiqueurId = devis.diagnostiqueurAssigne || agenceData?.diagnostiqueurParDefaut || null;

    const ordre = new OrdreMission({
      devisId: devis._id,
      agenceId: devis.agenceId,
      numero: `OM-${Date.now()}`,
      clientId,
      description: `Ordre de mission automatique pour le devis ${devis.numero}`,
      statut: "Commande",
      creePar: devis.creePar,
      diagnostiqueur: diagnostiqueurId,
      statutAcceptation: diagnostiqueurId ? 'en_attente' : null
    });
    await ordre.save();
    console.log("✅ [UPLOAD-PDF] Ordre de mission créé:", ordre.numero);

    // Synchroniser diagnostiqueurAssigne dans le devis et mettre à jour compteur agence
    if (diagnostiqueurId) {
      devis.diagnostiqueurAssigne = diagnostiqueurId;

      // 📧 Envoyer un email au diagnostiqueur pour l'informer que le devis a été accepté
      try {
        const Diagnostiqueur = require('../models/Diagnostiqueur');
        const diagnostiqueurData = await Diagnostiqueur.findById(diagnostiqueurId);
        if (diagnostiqueurData?.admin?.email) {
          await sendEmail({
            to: diagnostiqueurData.admin.email,
            subject: '✅ Devis accepté - Mission à confirmer - DIMOTEC',
            html: `
              <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f9f9f9;">
                <div style="background: linear-gradient(135deg, #10B981 0%, #059669 100%); padding: 30px; border-radius: 10px 10px 0 0; text-align: center;">
                  <h1 style="color: white; margin: 0; font-size: 28px;">✅ Devis Accepté !</h1>
                </div>
                <div style="background: white; padding: 30px; border-radius: 0 0 10px 10px; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
                  <p style="font-size: 16px; color: #333; line-height: 1.6;">
                    Bonjour <strong>${diagnostiqueurData.nom_entreprise}</strong>,
                  </p>
                  <p style="font-size: 16px; color: #333; line-height: 1.6;">
                    Excellente nouvelle ! Le client a accepté le devis pour lequel vous avez été sélectionné.
                  </p>
                  <div style="background: #f0fdf4; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #10B981;">
                    <h3 style="color: #059669; margin-top: 0;">📋 Détails de la mission</h3>
                    <p style="margin: 8px 0;"><strong>Numéro du devis :</strong> ${devis.numero}</p>
                    <p style="margin: 8px 0;"><strong>Numéro de mission :</strong> ${ordre.numero}</p>
                    <p style="margin: 8px 0;"><strong>Client :</strong> ${devis.client?.nom} ${devis.client?.prenom}</p>
                    <p style="margin: 8px 0;"><strong>Montant TTC :</strong> ${devis.totalApresReduction || devis.montantTTC || 'N/A'} €</p>
                    <p style="margin: 8px 0;"><strong>Agence :</strong> ${agenceData?.nom_commercial || 'N/A'}</p>
                  </div>
                  <div style="background: #FEF3C7; padding: 15px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #F59E0B;">
                    <p style="margin: 0; color: #92400E; font-weight: bold;">
                      ⚠️ Action requise
                    </p>
                    <p style="margin: 8px 0 0 0; color: #92400E;">
                      Veuillez vous connecter à votre espace diagnostiqueur pour accepter cette mission et consulter tous les détails.
                    </p>
                  </div>
                  <div style="text-align: center; margin: 30px 0;">
                    <a href="${process.env.FRONTEND_DIAGNOSTIQUEUR_URL || 'https://diagnostiqueur.dimotec.fr'}/missions/${ordre._id}"
                       style="background: linear-gradient(135deg, #10B981 0%, #059669 100%); color: white; padding: 15px 30px; text-decoration: none; border-radius: 8px; font-weight: bold; display: inline-block; box-shadow: 0 4px 6px rgba(16,185,129,0.3);">
                      ✓ Accepter la mission
                    </a>
                  </div>
                  <p style="font-size: 14px; color: #666; margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee;">
                    Cordialement,<br>
                    <strong>L'équipe DIMOTEC</strong>
                  </p>
                </div>
              </div>
            `
          });
          console.log('✅ Email envoyé au diagnostiqueur pour devis accepté');
        }
      } catch (emailError) {
        console.error('❌ Erreur envoi email diagnostiqueur:', emailError);
        // Ne pas bloquer la création de l'ordre si l'email échoue
      }

      // Incrémenter le compteur d'utilisation dans l'agence
      const Diagnostiqueur = require('../models/Diagnostiqueur');
      const diagnostiqueur = await Diagnostiqueur.findById(diagnostiqueurId);
      if (diagnostiqueur && agenceData) {
        const diagUtilise = agenceData.diagnostiqueursUtilises?.find(
          d => d.diagnostiqueur.toString() === diagnostiqueurId.toString()
        );

        if (diagUtilise) {
          diagUtilise.nombreCommandes += 1;
          diagUtilise.derniereCommande = new Date();
        } else {
          if (!agenceData.diagnostiqueursUtilises) {
            agenceData.diagnostiqueursUtilises = [];
          }
          agenceData.diagnostiqueursUtilises.push({
            diagnostiqueur: diagnostiqueurId,
            nombreCommandes: 1,
            derniereCommande: new Date()
          });
        }

        await agenceData.save();
      }
    }

    // ⚠️ IMPORTANT : Mettre à jour le statut du devis pour éviter les relances
    devis.statut = "Accepté";
    await devis.save();

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
    console.log("📧 [UPLOAD-PDF] Envoi des emails de notification...");

    // On définit les variables communes
    const variablesEmailBase = {
      nomClient: `${devis.client.prenom} ${devis.client.nom}`,
      numero: ordre.numero,
      devisNumero: devis.numero,
      nomAgence: agence?.nom_commercial || " ",
      dateCreation: new Date().toLocaleDateString("fr-FR"),
      description: ordre.description,
      statut: ordre.statut,
    };

    // Email à l'agence (Lien spécifique Agency)
    const agenceEmail = agence?.emails_contact?.[0]?.email;
    if (agenceEmail) {
      console.log(`📨 [UPLOAD-PDF] Envoi email à l'agence: ${agenceEmail}`);
      await sendEmail({
        to: agenceEmail,
        subject: `Nouvel Ordre de Mission - ${ordre.numero}`,
        template: "OrdreMission.html",
        variables: {
          ...variablesEmailBase,
          lienMission: `https://agence.votre-devis-diagnostics.fr/ordre-mission`
        }
      });
      console.log("✅ [UPLOAD-PDF] Email agence envoyé");
    }

    // Email de copie à Dimotec (Lien spécifique Admin)
    console.log("📨 [UPLOAD-PDF] Envoi email à Dimotec...");
    await sendEmail({
      to: "dimotec34@gmail.com",
      subject: `[COPIE] Nouvel Ordre de Mission - ${ordre.numero}`,
      template: "OrdreMission.html",
      variables: {
        ...variablesEmailBase,
        lienMission: `https://admin.votre-devis-diagnostics.fr/ordre-mission`
      }
    });
    console.log("✅ [UPLOAD-PDF] Email Dimotec envoyé");

    // 7️⃣ RÉPONSE FINALE
    console.log("🎉 [UPLOAD-PDF] Processus terminé avec succès!");
    return res.status(200).json({
      success: true,
      message: "PDF uploadé et devis accepté avec succès.",
      pdfUrl,
      devisNumero: devis.numero,
      ordreNumero: ordre.numero,
      devis: {
        _id: devis._id,
        numero: devis.numero,
        statut: devis.statut,
        pdfUrl: devis.pdfUrl
      },
      ordre: {
        _id: ordre._id,
        numero: ordre.numero,
        statut: ordre.statut
      }
    });

  } catch (err) {
    console.error("❌ [UPLOAD-PDF] Erreur critique:", err);
    console.error("❌ [UPLOAD-PDF] Stack trace:", err.stack);

    // Log détaillé pour debugging
    console.error("❌ [UPLOAD-PDF] Détails:", {
      devisId: req.params.devisId,
      hasFile: !!req.file,
      fileName: req.file?.filename,
      errorMessage: err.message
    });

    return res.status(500).json({
      success: false,
      message: "Erreur lors de la finalisation de l'acceptation via PDF.",
      error: err.message,
      details: process.env.NODE_ENV === 'development' ? err.stack : undefined
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
      // ✅ Populate de l'agence propriétaire
      .populate({
        path: "agenceId",
        model: "Agence",
        select: "nom_commercial nom_responsable adresse telephone_fixe emails_contact siret activite logo alerte_secteur statut reduction"
      })
      // ✅ Populate de l'agence de partage
      .populate({
        path: "shareAgency",
        model: "Agence",
        select: "nom_commercial nom_responsable adresse telephone_fixe emails_contact siret activite logo alerte_secteur statut reduction"
      });

    if (!devis) {
      return res.status(404).json({ message: "Lien invalide ou expiré." });
    }

    // ✅ Détermination de l'agence à utiliser (Priorité agenceId, sinon shareAgency)
    const agenceActive = devis.agenceId || devis.shareAgency;

    // ✅ Utilisation de l'alerte_secteur de l'agence active pour le calcul des tarifs
    const secteur = (agenceActive?.alerte_secteur || devis.secteur || "autre")
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
        const tranche = item.tarifsParSurface.find(t => surface >= t.surfaceMin && surface <= t.surfaceMax);
        tarifTTC = tranche?.tarifs?.[secteur] ?? tranche?.tarifs?.autre ?? 0;
      } else {
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
        // ✅ Utiliser le tarif stocké dans le devis au lieu de le recalculer
        const prixTTC = Number(devis.tarifGaz || 0);
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
      let prixHT = calculerTarif(devis.pack);
      const prixTTC = +(prixHT * 1.2).toFixed(2);

      // Filtrer les diagnostics du pack selon la tranche d'année du devis
      const diagnosticsPackFiltres = (devis.pack.diagnostics || []).filter(diag => {
        const diagTrancheAnnee = Array.isArray(diag.trancheAnnee) ? diag.trancheAnnee : [];
        const devisTrancheAnnee = devis.anneeConstruction;
        const nomDiag = (diag.nom || '').toLowerCase();

        // ❌ EXCLURE GAZ et Audits car ce sont des suppléments conditionnels
        const isGaz = nomDiag.includes('gaz');
        const isAudit = nomDiag.includes('audit');
        if (isGaz || isAudit) {
          console.log(`🚫 [PACK FILTER] EXCLU: ${diag.nom} (supplément conditionnel ou audit)`);
          return false;
        }

        // ❌ EXCLURE Surface uniquement pour les MAISONS
        const isSurface = nomDiag.includes('surface') || nomDiag.includes('copropriét');
        if (isSurface && devis.bien === 'maison') {
          console.log(`🚫 [PACK FILTER] EXCLU: ${diag.nom} (Surface non applicable pour maison)`);
          return false;
        }

        // ✅ Le diagnostic est compatible UNIQUEMENT si :
        // - Il a EXACTEMENT la même tranche d'année que le devis
        // - On ignore les diagnostics avec "toutes"
        const matchTranche = diagTrancheAnnee.includes(devisTrancheAnnee);

        if (!matchTranche) {
          console.log(`🚫 [PACK FILTER] EXCLU: ${diag.nom} - tranches:[${diagTrancheAnnee}] vs devis:${devisTrancheAnnee}`);
        } else {
          console.log(`✅ [PACK FILTER] INCLUS: ${diag.nom} - tranches:[${diagTrancheAnnee}] vs devis:${devisTrancheAnnee}`);
        }

        return matchTranche;
      });

      const diagnosticsPack = diagnosticsPackFiltres.map(diag => {
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
    
    // ✅ On injecte l'agence active dans l'objet pour le Front-end
    devisObj.agenceActive = agenceActive;

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
    console.log("--- 🚀 DÉBUT PROCÉDURE : AUCUN DOCUMENT ---");
    const { devisId, messageClient } = req.body;

    if (!devisId) {
      return res.status(400).json({ message: "L'ID du devis est requis." });
    }

    // 1. Récupérer le devis
    const devis = await Devis.findById(devisId).populate("client");
    if (!devis) {
      console.error("❌ ERROR 404: Devis introuvable pour ID :", devisId);
      return res.status(404).json({ message: "Devis introuvable." });
    }

    // Sauvegarde de la clé pour l'email avant suppression (si besoin du lien dans le mail admin)
    const oldKey = devis.accesClientKey;

    // 2. 🛡️ DESTRUCTION DE L'ACCÈS
    // On utilise updateOne avec $unset pour supprimer totalement la clé de la base
    // Cela évite les erreurs de "duplicate key" sur la valeur null
    const nouvelleNote = (devis.note || "") + `\n[Système] Le client a déclaré ne posséder aucune facture pour le bien le ${new Date().toLocaleString("fr-FR")}.`;

    await Devis.updateOne(
      { _id: devisId },
      { 
        $unset: { accesClientKey: "" }, // Supprime le champ pour l'index unique
        $set: { 
          accesClientExpire: new Date(), // Expire l'accès
          note: nouvelleNote 
        }
      }
    );

    // On met à jour l'objet local 'devis' pour la suite du script (emails, etc.)
    devis.accesClientKey = undefined;
    devis.note = nouvelleNote;

    console.log(`🔒 Accès révoqué pour le devis ${devis.numero}. Clé supprimée de la base.`);

    const clientNom = `${devis.client?.prenom || ""} ${devis.client?.nom || ""}`.trim();
    // 3. Préparer les variables pour l'email
    const emailVariables = {
      nomClient: clientNom,
      numeroDevis: devis.numero,
      messageClient: messageClient || "Le client indique qu'aucun document n'est disponible.",
      // Ici, on utilise l'ID pour l'admin car la clé client n'existe plus
      lienDevis: `https://votre-plateforme-admin.fr/devis/${devis._id}`,
      date: new Date().toLocaleString("fr-FR"),
    };

    // 4. Envoi du mail à Dimotec
    try {
      await sendEmail({
        to: "dimotec34@gmail.com",
        subject: `⚠️ Devis ${devis.numero} : Pas de documents transmis`,
        template: "noDocuments.html",
        variables: emailVariables,
      });
      console.log("📧 Email de notification envoyé à Dimotec.");
    } catch (mailErr) {
      console.error("⚠️ Erreur lors de l'envoi de l'email (mais l'accès a été coupé) :", mailErr);
    }

    console.log("--- ✅ PROCÉDURE TERMINÉE ---");
    res.status(200).json({
      message: "✅ Notification envoyée. L'accès au portail documents est désormais clos.",
    });

  } catch (error) {
    console.error("❌ ERREUR SERVEUR noDocumentsDevis :", error);
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
    const {
      client,
      locataire,
      contactLocataire,
      clefEnAgence,
      adresseBien,
      numeroFiscalBien,
      note,
      informationsComplementaires,
      statut,
      // Nouveaux champs financiers
      totalAvantRemise,
      montantTTC,
      montantCagnotteUtilisee,
      reductionPourcent
    } = req.body;

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

    // 🔍 Détection du changement de statut vers "Accepté"
    const ancienStatut = devis.statut;
    const passeAAccepte = statut && statut === "Accepté" && ancienStatut !== "Accepté";

    if (statut) {
      devis.statut = statut;
    }

    // ✏️ Mise à jour des montants financiers (Lien avec vos inputs front-end)
    if (totalAvantRemise !== undefined) {
      devis.totalAvantRemise = totalAvantRemise;
    }

    if (montantTTC !== undefined) {
      devis.montantTTC = montantTTC;
      devis.totalApresReduction = montantTTC; // Synchronisation du prix final
    }

    if (montantCagnotteUtilisee !== undefined) {
      devis.montantCagnotteUtilisee = montantCagnotteUtilisee;
    }

    if (reductionPourcent !== undefined) {
      devis.reductionPourcent = reductionPourcent;
    }

    // ✏️ Mise à jour des autres champs modifiables

    // Informations client
    if (client) {
      if (client.nom) devis.client.nom = client.nom;
      if (client.prenom) devis.client.prenom = client.prenom;
      if (client.email) devis.client.email = client.email.trim();
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

    // Clef en agence
    if (clefEnAgence !== undefined) {
      devis.clefEnAgence = clefEnAgence;
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

    // Informations complémentaires
    if (informationsComplementaires !== undefined) {
      devis.informationsComplementaires = informationsComplementaires;
    }

    // 💾 Sauvegarde globale
    await devis.save();

    console.log(`✅ Devis ${devis.numero} mis à jour avec succès (Montants inclus)`);

    // 🆕 Création automatique de l'ordre de mission si le devis passe à "Accepté"
    if (passeAAccepte) {
      console.log(`🚀 Création automatique de l'ordre de mission pour le devis ${devis.numero}`);

      try {
        const ordreMissionExistant = await OrdreMission.findOne({ devisId: devis._id });

        if (ordreMissionExistant) {
          console.log(`⚠️ Un ordre de mission existe déjà pour ce devis (${ordreMissionExistant.numero})`);
        } else {
          let clientId = devis.clientId;

          // ⚠️ IMPORTANT : Toujours privilégier le clientId du devis
          if (!clientId && devis.client?.email) {
            console.warn("⚠️ Devis sans clientId, recherche par email...");

            // Vérifier s'il y a des doublons d'email
            const duplicates = await Client.find({ email: devis.client.email });

            let clientExist;

            if (duplicates.length > 1) {
              console.error("❌ PLUSIEURS CLIENTS AVEC LE MÊME EMAIL DÉTECTÉS !");
              console.error(`   Email: ${devis.client.email}`);
              console.error(`   Nombre de clients: ${duplicates.length}`);
              console.error(`   Clients trouvés:`, duplicates.map(d => `${d._id} - ${d.prenom} ${d.nom}`));

              // Tentative de correspondance par nom et prénom
              const normalizeString = (str) => str?.toLowerCase().trim() || '';
              const devisNom = normalizeString(devis.client.nom);
              const devisPrenom = normalizeString(devis.client.prenom);

              console.log(`🔍 Recherche de correspondance pour: ${devis.client.prenom} ${devis.client.nom}`);

              const matchingClients = duplicates.filter(client => {
                const clientNom = normalizeString(client.nom);
                const clientPrenom = normalizeString(client.prenom);
                return clientNom === devisNom && clientPrenom === devisPrenom;
              });

              if (matchingClients.length === 1) {
                console.log(`✅ Correspondance unique trouvée par nom/prénom: ${matchingClients[0].prenom} ${matchingClients[0].nom} (ID: ${matchingClients[0]._id})`);
                clientExist = matchingClients[0];
              } else if (matchingClients.length > 1) {
                console.error("   ⚠️ PLUSIEURS CLIENTS AVEC LE MÊME NOM/PRÉNOM - ORDRE DE MISSION NON CRÉÉ");
                return res.status(200).json({
                  message: "Devis mis à jour, mais ordre de mission non créé (plusieurs clients avec le même nom/prénom détectés)",
                  devis
                });
              } else {
                console.error("   ⚠️ AUCUNE CORRESPONDANCE PAR NOM/PRÉNOM - ORDRE DE MISSION NON CRÉÉ");
                return res.status(200).json({
                  message: "Devis mis à jour, mais ordre de mission non créé (impossible de déterminer le bon client)",
                  devis
                });
              }
            } else {
              clientExist = duplicates[0];
            }

            if (!clientExist) {
              clientExist = new Client({
                nom: devis.client.nom,
                prenom: devis.client.prenom,
                email: devis.client.email,
                tel: devis.client.tel || '',
                adresse: devis.client.adresse || '',
                ville: devis.client.ville || '',
                codePostal: devis.client.codePostal || '',
                pays: devis.client.pays || 'France',
                devis: [devis._id]
              });
              await clientExist.save();
              console.log(`✅ Client créé : ${clientExist.email}`);
            }

            clientId = clientExist._id;
            devis.clientId = clientId;
            await devis.save();
          }

          // Récupérer le diagnostiqueur assigné au devis, sinon le diagnostiqueur par défaut de l'agence
          const agenceData = await Agence.findById(devis.agenceId);
          const diagnostiqueurId = devis.diagnostiqueurAssigne || agenceData?.diagnostiqueurParDefaut || null;

          const nouvelOrdreMission = new OrdreMission({
            devisId: devis._id,
            agenceId: devis.agenceId || null,
            numero: `OM-${Date.now()}`,
            clientId: clientId,
            description: `Ordre de mission créé automatiquement pour le devis ${devis.numero}`,
            statut: "Commande",
            creePar: devis.creePar || {
              id: req.user._id,
              type: req.user.role === "admin" ? "Admin" : req.user.role === "agence" ? "Agence" : "Employe"
            },
            diagnostiqueur: diagnostiqueurId,
            statutAcceptation: diagnostiqueurId ? 'en_attente' : null
          });

          await nouvelOrdreMission.save();
          console.log(`✅ Ordre de mission ${nouvelOrdreMission.numero} créé automatiquement`);

          // Synchroniser diagnostiqueurAssigne dans le devis et mettre à jour compteur agence
          if (diagnostiqueurId) {
            devis.diagnostiqueurAssigne = diagnostiqueurId;

            // Incrémenter le compteur d'utilisation dans l'agence
            const Diagnostiqueur = require('../models/Diagnostiqueur');
            const diagnostiqueur = await Diagnostiqueur.findById(diagnostiqueurId);
            if (diagnostiqueur && agenceData) {
              const diagUtilise = agenceData.diagnostiqueursUtilises?.find(
                d => d.diagnostiqueur.toString() === diagnostiqueurId.toString()
              );

              if (diagUtilise) {
                diagUtilise.nombreCommandes += 1;
                diagUtilise.derniereCommande = new Date();
              } else {
                if (!agenceData.diagnostiqueursUtilises) {
                  agenceData.diagnostiqueursUtilises = [];
                }
                agenceData.diagnostiqueursUtilises.push({
                  diagnostiqueur: diagnostiqueurId,
                  nombreCommandes: 1,
                  derniereCommande: new Date()
                });
              }

              await agenceData.save();
            }
          }

          // ⚠️ IMPORTANT : Mettre à jour le statut du devis pour éviter les relances
          devis.statut = "Accepté";
          await devis.save();
        }
      } catch (errorOM) {
        console.error("❌ Erreur lors de la création de l'ordre de mission :", errorOM);
      }
    }

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
    const { devisId, agencyName, agencyEmail, devisNumero } = req.body;

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
  <title>Invitation Votre Devis Diagnostics</title>
  <style>
    body {
      font-family: 'Segoe UI', Arial, sans-serif;
      line-height: 1.6;
      color: #334155;
      background-color: #f8fafc;
      margin: 0;
      padding: 0;
    }
    .container {
      max-width: 600px;
      margin: 20px auto;
      background: #ffffff;
      border-radius: 12px;
      overflow: hidden;
      border: 1px solid #e2e8f0;
    }
    .header {
      background: linear-gradient(135deg, #ed891a 0%, #f59e42 100%);
      padding: 35px 25px;
      text-align: center;
      color: white;
    }
    .content {
      padding: 35px 30px;
    }
    .devis-info {
      background: #f1f5f9;
      border-radius: 12px;
      padding: 20px;
      margin: 20px 0;
      border: 1px solid #e2e8f0;
    }
    /* Section demandée par le client */
    .benefits-section {
      margin: 30px 0;
      padding-top: 20px;
      border-top: 1px solid #f1f5f9;
    }
    .benefit-row {
      margin-bottom: 20px;
      display: table; /* Meilleur support mail que flex */
      width: 100%;
    }
    .benefit-icon {
      display: table-cell;
      width: 40px;
      vertical-align: top;
      font-size: 20px;
    }
    .benefit-text {
      display: table-cell;
      vertical-align: top;
      font-size: 14px;
      color: #475569;
    }
    .highlight-box {
      background-color: #f0fdf4;
      border: 1px dashed #22c55e;
      padding: 15px;
      border-radius: 8px;
      text-align: center;
      margin-top: 25px;
      color: #166534;
      font-weight: 600;
      font-size: 14px;
    }
    .cta-button {
      display: inline-block;
      background-color: #ed891a;
      color: #ffffff !important;
      padding: 16px 32px;
      text-decoration: none;
      border-radius: 10px;
      font-weight: bold;
      margin-top: 25px;
    }
    .footer {
      background: #f8fafc;
      padding: 25px;
      text-align: center;
      font-size: 12px;
      color: #94a3b8;
      border-top: 1px solid #f1f5f9;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1 style="margin:0; font-size: 24px;">🎉 Nouveau Devis Disponible</h1>
      <p style="margin:10px 0 0; opacity: 0.9;">Propulsé par la plateforme Votre Devis Diagnostics</p>
    </div>

    <div class="content">
      <h2 style="color: #1e293b; margin-top: 0;">Bonjour ${agencyName},</h2>
      <p>Un devis de diagnostic vient d'être réalisé pour l'un de vos clients. Vous pouvez le consulter dès maintenant sur votre espace.</p>

      <div class="devis-info">
        <strong style="color: #ed891a; font-size: 13px; text-transform: uppercase;">Détails de l'offre</strong>
        <p style="margin: 10px 0 5px 0;"><strong>Numéro :</strong> ${devisNumero || 'N/A'}</p>
        ${devis ? `
          <p style="margin: 5px 0;"><strong>Client :</strong> ${devis.client?.prenom || ''} ${devis.client?.nom || ''}</p>
          <p style="margin: 5px 0;"><strong>Montant :</strong> ${devis.montantTTC ? devis.montantTTC.toFixed(2) + ' €' : 'N/A'}</p>
        ` : ''}
      </div>

      <div class="benefits-section">
        <h3 style="color: #1e293b; font-size: 18px; margin-bottom: 20px;">Pourquoi nous rejoindre ?</h3>
        
        <div class="benefit-row">
          <div class="benefit-icon">⚡</div>
          <div class="benefit-text">Afin de faciliter votre quotidien, vous réalisez et envoyez vos devis de diagnostic en <strong>instantané</strong>.</div>
        </div>

        <div class="benefit-row">
          <div class="benefit-icon">🤝</div>
          <div class="benefit-text">Votre technicien de diagnostic n'a plus besoin de vous relancer pour vous demander des documents ou informations complémentaires.</div>
        </div>

        <div class="benefit-row">
          <div class="benefit-icon">📈</div>
          <div class="benefit-text">Vous êtes informé en <strong>temps réel</strong> de l'avancement du dossier, des relances si nécessaires et jusqu'à son règlement.</div>
        </div>

        <div class="highlight-box">
          📍 Toutes vos demandes et dossiers sont centralisés sur votre plateforme dédiée.
        </div>
      </div>

      <center>
        <a href="https://agence.votre-devis-diagnostics.fr/login" class="cta-button">
          Accéder à mon espace gratuit
        </a>
      </center>
    </div>

    <div class="footer">
      <p><strong>Votre Devis Diagnostics</strong> - La solution professionnelle pour vos diagnostics</p>
      <p>Besoin d'aide ? <a href="mailto:support@.votre-devis-diagnostics.fr" style="color: #ed891a;">Contactez le support</a></p>
      <p>© ${new Date().getFullYear()} Votre Devis Diagnostics</p>
    </div>
  </div>
</body>
</html>
    `;

    // Envoyer l'email
    await sendEmail({
      to: agencyEmail,
      subject: `🎉 Invitation Votre Devis Diagnostics - Un devis a été créé pour ${agencyName}`,
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
    const { devisId, agencyId, devisNumero } = req.body;

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
  <title>Nouveau Devis Votre Devis Diagnostics</title>
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

      <p>Nous vous informons qu'un nouveau devis a été créé en votre nom sur la plateforme Votre Devis Diagnostics.</p>

      <div class="devis-card">
        <h3>📄 Informations du devis</h3>
        <div class="info-row">
          <strong>Numéro de devis</strong>
          <span>${devisNumero || 'N/A'}</span>
        </div>
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
        <a href="https://agence.votre-devis-diagnostics.fr/login" class="cta-button">
          Accéder à mon espace
        </a>
      </center>

      <p style="margin-top: 30px; color: #94a3b8; font-size: 14px;">
        Ce devis est maintenant visible dans votre tableau de bord. Vous pouvez le consulter, le modifier et suivre son statut à tout moment.
      </p>
    </div>

    <div class="footer">
      <p>
        <strong>Votre Devis Diagnostics</strong><br>
        Plateforme de gestion de diagnostics immobiliers
      </p>
      <p style="margin-top: 15px;">
        Besoin d'aide ? <a href="mailto:support@.votre-devis-diagnostics.fr">support@.votre-devis-diagnostics.fr</a>
      </p>
      <p style="margin-top: 10px; color: #94a3b8;">
        © ${new Date().getFullYear()} Votre Devis Diagnostics - Tous droits réservés
      </p>
    </div>
  </div>
</body>
</html>
    `;

    // Envoyer l'email
    await sendEmail({
      to: agencyEmail,
      subject: `📋 Nouveau Devis ${devisNumero || ''} créé pour ${agence.nom_commercial}`,
      html: emailHtml
    });

    console.log(`✅ Email de notification envoyé à ${agencyEmail}`);

    res.status(200).json({ message: "Email de notification envoyé avec succès" });

  } catch (error) {
    console.error("❌ Erreur envoi email agence existante:", error);
    res.status(500).json({ message: "Erreur lors de l'envoi de l'email" });
  }
};

/**
 * Vérifier manuellement les bounces pour tous les devis en "Envoi_En_Cours"
 * Route: POST /api/public/verifier-bounces
 */
exports.verifierBouncesDevis = async (req, res) => {
  try {
    console.log("🔍 Vérification manuelle des bounces en cours...");

    // Récupérer tous les devis en "Envoi_En_Cours"
    const devisEnCours = await Devis.find({ statut: "Envoi_En_Cours" });

    if (devisEnCours.length === 0) {
      return res.status(200).json({
        message: "Aucun devis en attente de vérification",
        total: 0,
        envoyes: 0,
        errones: 0
      });
    }

    let nbEnvoyes = 0;
    let nbErrones = 0;

    // Vérifier chaque devis
    for (const devis of devisEnCours) {
      try {
        const emailClient = devis.client?.email;
        if (!emailClient) continue;

        console.log(`Vérification de ${emailClient} - Devis ${devis.numero}`);

        const isBounced = await verifierBouncesIMAP(emailClient, devis.numero);

        if (isBounced) {
          console.log(`⚠️ Bounce détecté pour ${emailClient}`);
          devis.emailNonDelivre = true;
          devis.emailClientErrone = emailClient;
          devis.statut = "Email_Errone";
          await devis.save();
          nbErrones++;

          // Notification agence et Dimotec
          const agence = await Agence.findById(devis.agenceId);
          const agenceEmail = agence?.emails_contact?.[0]?.email || null;
          const dimotecEmail = "dimotec34@gmail.com";

          const alertVariables = {
            clientNom: `${devis.client.prenom} ${devis.client.nom}`,
            emailClient: emailClient,
            devisNumero: devis.numero,
            agenceNom: agence?.nom_commercial || "Agence",
          };

          const destinataires = [];
          if (agenceEmail) destinataires.push(agenceEmail);
          destinataires.push(dimotecEmail);

          for (let i = 0; i < destinataires.length; i++) {
            const dest = destinataires[i];
            await sendEmail({
              to: dest,
              subject: `⚠️ Email non délivré - Devis ${devis.numero}`,
              template: "alerteEmailClient.html",
              variables: alertVariables,
            });

            // ⏱️ Attente entre chaque email (sauf le dernier)
            if (i < destinataires.length - 1) {
              await sleep(2000);
            }
          }
        } else {
          console.log(`✅ Email confirmé délivré pour ${emailClient}`);
          devis.statut = "Envoyé";
          await devis.save();
          nbEnvoyes++;
        }
      } catch (error) {
        console.error(`Erreur vérification devis ${devis.numero}:`, error);
        // En cas d'erreur, passer en "Envoyé" par défaut
        devis.statut = "Envoyé";
        await devis.save();
        nbEnvoyes++;
      }
    }

    res.status(200).json({
      message: "Vérification des bounces terminée",
      total: devisEnCours.length,
      envoyes: nbEnvoyes,
      errones: nbErrones
    });

  } catch (error) {
    console.error("❌ Erreur vérification bounces:", error);
    res.status(500).json({ message: "Erreur lors de la vérification des bounces" });
  }
};

/**
 * 📝 Mettre à jour le numéro fiscal d'un bien dans un devis
 * Route : PUT /api/client/devis/:devisId/numero-fiscal
 */
exports.updateNumeroFiscal = async (req, res) => {
  try {
    const { devisId } = req.params;
    const { numeroFiscalBien } = req.body;

    if (!numeroFiscalBien) {
      return res.status(400).json({ message: "Le numéro fiscal est requis." });
    }

    // Rechercher le devis
    const devis = await Devis.findById(devisId);
    if (!devis) {
      return res.status(404).json({ message: "Devis introuvable." });
    }

    // Mettre à jour le numéro fiscal
    devis.numeroFiscalBien = numeroFiscalBien;
    await devis.save();

    console.log(`✅ Numéro fiscal mis à jour pour le devis ${devis.numero}: ${numeroFiscalBien}`);

    res.status(200).json({
      message: "Numéro fiscal enregistré avec succès.",
      devis
    });

  } catch (error) {
    console.error("❌ Erreur mise à jour numéro fiscal:", error);
    res.status(500).json({ message: "Erreur lors de l'enregistrement du numéro fiscal." });
  }
};
