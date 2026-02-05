// controllers/missionController.js
const OrdreMission = require("../models/OrdreMission");
const Facture = require("../models/Facture");
const Pack = require("../models/Pack");
const Diagnostic = require("../models/Diagnostic");
const upload = require("../middlewares/upload"); // ton middleware multer + Cloudinary
const cloudinary = require("../config/cloudinary"); // ton fichier cloudinary.js 
const Devis = require('../models/Devis')
const axios = require('axios');
const path = require('path');
const Employe = require("../models/Employe");
const Agence = require("../models/Agency");
const Client = require('../models/Client');
const sendEmail = require('../utils/sendEmails');

/**
 * 📋 Récupérer tous les ordres de mission selon l'utilisateur
 */
exports.getOrdresMission = async (req, res) => {
  try {
    let query = {};

    if (req.user.role === "admin" ) {
      // 🧑‍💼 Admin → tous les ordres de mission
      query = {};
    }

    else if (req.role === "agence") {
      // 🏢 Agence → uniquement ses ordres de mission
      query = { agenceId: req.agence._id };
    } else if (req.role === "employe") {
      // 👨‍💻 Employé → uniquement les OM où il est creePar ou dans partageAvec
      const empId = req.user._id.toString();

      query = {
        $or: [
          { "creePar.type": "Employe", "creePar.id": empId },
          { "partageAvec": empId }
        ]
      };
    }  else {
      return res.status(401).json({ message: "Utilisateur non authentifié." });
    }

    const ordres = await OrdreMission.find(query)
      .populate({
        path: "devisId",
        populate: [
          {
            path: "pack",
            populate: [
              { path: "obligatoireDansPacks", model: "Diagnostic" },
              { path: "diagnostics", model: "Diagnostic" }
            ]
          },
          { path: "diagnosticsSelectionnes", model: "Diagnostic" },
          { path: "supplementsSelectionnes", model: "Supplement" },
        ],
      })
      .populate("clientId")
      .populate("agenceId")
      .sort({ dateCreation: -1 })
      .lean();

    // Ajoute le public_id à chaque fichier
    const ordresAvecPublicId = ordres.map(ordre => {
      if (ordre.fichiersClient) {
        ordre.fichiersClient = ordre.fichiersClient.map(fichier => {
          if (!fichier.public_id && fichier.url) {
            let publicId = fichier.url.split('/upload/')[1];
            publicId = publicId.replace(/^v\d+\//, '');
            return { ...fichier, public_id: publicId };
          }
          return fichier;
        });
      }
      return ordre;
    });

    res.json({ ordres: ordresAvecPublicId });
  } catch (error) {
    console.error("❌ Erreur récupération ordres de mission :", error);
    res.status(500).json({ message: "Erreur serveur." });
  }
};

/**
 * 📋 Récupérer un seul ordre de mission par ID
 */
exports.getOrdreMissionById = async (req, res) => {
  try {
    const ordreId = req.params.id;

    let query = { _id: ordreId };

    // 🔐 Filtrage selon le rôle
    if (req.user.role === "admin") {
      // Admin → peut tout voir, pas besoin d’ajouter de condition
    }

    else if (req.role === "agence") {
      // Agence → uniquement ses ordres
      query.agenceId = req.agence._id;
    }

    else if (req.role === "employe") {
      // Employé → doit être créateur OU dans partageAvec
      const empId = req.user._id.toString();

      query.$or = [
        { "creePar.type": "Employe", "creePar.id": empId },
        { partageAvec: empId }
      ];
    }

    else {
      return res.status(401).json({ message: "Utilisateur non authentifié." });
    }

    // 🔎 Recherche + populate
    const ordre = await OrdreMission.findOne(query)
      .populate({
        path: "devisId",
        populate: [
          {
            path: "pack",
            populate: [
              { path: "obligatoireDansPacks", model: "Diagnostic" },
              { path: "diagnostics", model: "Diagnostic" }
            ]
          },
          { path: "diagnosticsSelectionnes", model: "Diagnostic" },
          { path: "supplementsSelectionnes", model: "Supplement" },
        ],
      })
      .populate("clientId")
      .populate("agenceId")
      .lean();

    if (!ordre) {
      return res.status(404).json({ message: "Ordre de mission introuvable ou accès refusé." });
    }

    // 🗂 Ajout du public_id aux fichiers
    if (ordre.fichiersClient) {
      ordre.fichiersClient = ordre.fichiersClient.map((fichier) => {
        if (!fichier.public_id && fichier.url) {
          let publicId = fichier.url.split("/upload/")[1];
          publicId = publicId.replace(/^v\d+\//, "");
          return { ...fichier, public_id: publicId };
        }
        return fichier;
      });
    }

    res.json({ ordre });

  } catch (error) {
    console.error("❌ Erreur récupération ordre de mission :", error);
    res.status(500).json({ message: "Erreur serveur." });
  }
};


exports.updateMissionInfos = async (req, res) => {
  try {
    const missionId = req.params.id;
    const { client, bien } = req.body;

    console.log("🔧 Update mission infos :", { missionId, client, bien });

    // --- Vérifier l'ordre de mission ---
    const mission = await OrdreMission.findById(missionId);
    if (!mission) {
      return res.status(404).json({ message: "Ordre de mission introuvable." });
    }

    // --- Charger le devis associé ---
    const devis = await Devis.findById(mission.devisId);
    if (!devis) {
      return res.status(404).json({ message: "Devis introuvable." });
    }

    // --- 1) Mise à jour du VRAI CLIENT dans la collection Client ---
    if (mission.clientId && client) {
      await Client.findByIdAndUpdate(
        mission.clientId,
        {
          $set: {
            nom: client.nom,
            prenom: client.prenom,
            email: client.email,
            telephone: client.tel,
            adresse: client.adresse,
            ville: client.ville,
            codePostal: client.codePostal
          }
        },
        { new: true }
      );
    }

    // --- 2) Mise à jour du CLIENT dans le devis ---
    if (client) {
      devis.client.nom = client.nom || devis.client.nom;
      devis.client.prenom = client.prenom || devis.client.prenom;
      devis.client.email = client.email || devis.client.email;
      devis.client.tel = client.tel || devis.client.tel;
      devis.client.adresse = client.adresse || devis.client.adresse;
      devis.client.ville = client.ville || devis.client.ville;
      devis.client.codePostal = client.codePostal || devis.client.codePostal;
    }

    // --- 3) Mise à jour des infos du BIEN ---
    if (bien) {
      if (bien.bien) devis.bien = bien.bien;
      if (bien.anneeConstruction) devis.anneeConstruction = bien.anneeConstruction;

      // Surface selon type
      if (devis.bien === "maison") {
        devis.surfaceMaison = bien.surface || devis.surfaceMaison;
      } else {
        devis.surfaceAppartement = bien.surface || devis.surfaceAppartement;
      }

      // Adresse du bien
      devis.adresseBien.adresse = bien.adresse || devis.adresseBien.adresse;
      devis.adresseBien.ville = bien.ville || devis.adresseBien.ville;
      devis.adresseBien.codePostal = bien.codePostal || devis.adresseBien.codePostal;
      devis.adresseBien.etage = bien.etage || devis.adresseBien.etage;
      devis.adresseBien.complement = bien.complement || devis.adresseBien.complement;
      devis.adresseBien.parcelle = bien.parcelle || devis.adresseBien.parcelle;

       if (bien.note !== undefined) {
    devis.note = bien.note;
  }
    }

    await devis.save();

    return res.status(200).json({
      message: "✔️ Client + Bien mis à jour avec succès.",
      devis
    });

  } catch (error) {
    console.error("❌ Erreur updateMissionInfos :", error);
    res.status(500).json({ message: "Erreur serveur lors de la mise à jour." });
  }
};


/**
 * Supprimer un Ordre de Mission
 */
exports.deleteOrdreMission = async (req, res) => {
  try {
    const ordreId = req.params.id;

    // Vérifier que l'OM existe
    const ordre = await OrdreMission.findById(ordreId);
    if (!ordre) {
      return res.status(404).json({ message: "Ordre de mission introuvable." });
    }

    // Vérifier l'autorisation
    if (req.user.role === "admin") {
      // Admin peut tout supprimer
    } else if (req.role === "agence" && ordre.agenceId.toString() !== req.agence._id.toString()) {
      return res.status(403).json({ message: "Vous n'avez pas la permission de supprimer cet ordre de mission." });
    } else {
      return res.status(403).json({ message: "Vous n'avez pas la permission de supprimer cet ordre de mission." });
    }

    // Supprimer les fichiers liés sur Cloudinary si présents
    if (ordre.fichiersClient && ordre.fichiersClient.length > 0) {
      for (const fichier of ordre.fichiersClient) {
        if (fichier.public_id) {
          try {
            await cloudinary.uploader.destroy(fichier.public_id);
          } catch (err) {
            console.warn(`Impossible de supprimer le fichier Cloudinary ${fichier.public_id}:`, err.message);
          }
        }
      }
    }

    // Supprimer l'OM de la base
    await OrdreMission.findByIdAndDelete(ordreId);

    res.json({ message: "Ordre de mission supprimé avec succès." });
  } catch (error) {
    console.error("Erreur suppression ordre de mission :", error);
    res.status(500).json({ message: "Erreur serveur." });
  }
};



/**
 * 📥 Télécharger un fichier lié à une mission
 * Route : GET /api/mission/download/:fileId
 */
exports.downloadFile = async (req, res) => {
  try {
    const { fileId } = req.params;
    console.log("📥 Requête downloadFile pour fileId :", fileId);

    // Cherche l'ordre de mission contenant le fichier
    const mission = await OrdreMission.findOne({ "fichiersClient._id": fileId });
    if (!mission) return res.status(404).json({ message: "Fichier introuvable." });

    const fichier = mission.fichiersClient.find(f => f._id.toString() === fileId);
    if (!fichier) return res.status(404).json({ message: "Fichier introuvable." });

    console.log("📂 Fichier trouvé :", fichier.nom, "→", fichier.url);

    // Récupère le public_id depuis la BDD ou reconstruit-le depuis l'URL Cloudinary
    let publicId;
    if (fichier.public_id) {
      publicId = fichier.public_id; // stocké à l'upload
    } else {
      // récupère la partie après '/upload/' et supprime la version vXXXX/
      const parts = fichier.url.split('/upload/')[1]; // ex: v1761131512/dimotec/xxx.pdf
      publicId = parts.replace(/^v\d+\//, '');       // ex: dimotec/xxx.pdf
    }

    // Détecte le type de fichier pour le resource_type
    const ext = path.extname(fichier.nom).toLowerCase();
    const resourceType = ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.txt', '.csv'].includes(ext)
      ? 'raw'
      : 'image';

    // Génère un lien signé Cloudinary valable 10 minutes
    const downloadUrl = cloudinary.url(publicId, {
      resource_type: resourceType,
      sign_url: true,
      expires_at: Math.floor(Date.now() / 1000) + 60 * 10
    });

    console.log("➡️ Lien signé Cloudinary :", downloadUrl);

    // Redirection vers le lien signé pour téléchargement
    res.redirect(downloadUrl);

  } catch (error) {
    console.error("❌ Erreur téléchargement fichier :", error);
    res.status(500).json({ message: "Erreur serveur lors du téléchargement." });
  }
};

/**
 * 📥 Télécharger le PDF de consentement lié à une mission
 * Route : GET /api/mission/download-consent/:devisId
 */
exports.downloadConsentPdf = async (req, res) => {
  try {
    const { devisId } = req.params;
    console.log("📥 Requête downloadConsentPdf pour devisId :", devisId);

    // Cherche l'ordre de mission associé au devis
    const mission = await OrdreMission.findOne({ devisId });
    if (!mission || !mission.consentementPdf) {
      return res.status(404).json({ message: "PDF de consentement introuvable." });
    }

    const fichier = mission.consentementPdf;
    console.log("📂 Consentement trouvé :", fichier.nom, "→", fichier.url);

    // Récupère le public_id depuis l'URL si non présent
    let publicId;
    if (fichier.public_id) {
      publicId = fichier.public_id;
    } else {
      const parts = fichier.url.split('/upload/')[1]; 
      publicId = parts.replace(/^v\d+\//, '');
    }

    // Type de resource pour Cloudinary
    const ext = path.extname(fichier.nom).toLowerCase();
    const resourceType = ext === '.pdf' ? 'raw' : 'image';

    // Génère un lien signé Cloudinary valable 10 minutes
    const downloadUrl = cloudinary.url(publicId, {
      resource_type: resourceType,
      sign_url: true,
      expires_at: Math.floor(Date.now() / 1000) + 60 * 10
    });

    console.log("➡️ Lien signé Cloudinary :", downloadUrl);

    // Redirection vers le lien signé pour téléchargement
    res.redirect(downloadUrl);

  } catch (error) {
    console.error("❌ Erreur téléchargement PDF consentement :", error);
    res.status(500).json({ message: "Erreur serveur lors du téléchargement du PDF de consentement." });
  }
};



/**
 * 📤 Upload de plusieurs fichiers liés à un ordre de mission via la clé d’accès du client
 * Route : POST /api/client/upload/:accesClientKey
 */
exports.uploadFileByClientKey = [
  upload.array('fichiers', 10), 
  async (req, res) => {
    try {
      console.log("🔑 Clé client reçue :", req.params.accesClientKey);
      
      const { accesClientKey } = req.params;

      // 1. Trouver le devis et vérifier s'il n'est pas déjà expiré
      const devis = await Devis.findOne({ accesClientKey });
      
      if (!devis) {
        return res.status(404).json({ message: "Clé d'accès invalide." });
      }

      // Vérification de la date d'expiration (sécurité supplémentaire)
      if (devis.accesClientExpire && new Date() > devis.accesClientExpire) {
        return res.status(403).json({ message: "Le lien d'accès a expiré. Les documents ont déjà été validés." });
      }

      // 2. Trouver la mission
      const mission = await OrdreMission.findOne({ devisId: devis._id });
      if (!mission) {
        return res.status(404).json({ message: "Aucun ordre de mission associé à ce devis." });
      }

      if (!req.files || req.files.length === 0) {
        return res.status(400).json({ message: "Aucun fichier n'a été téléchargé." });
      }

      // 3. Préparer les fichiers pour la base de données
      const uploadedFiles = req.files.map(file => ({
        nom: file.originalname,
        url: file.path,
        public_id: file.filename || file.public_id,
        dateDepot: new Date(),
      }));

      // 4. Mise à jour de la mission
      mission.fichiersClient.push(...uploadedFiles);
      await mission.save();

      // 5. 🛡️ COUPER L'ACCÈS : On expire la clé du devis maintenant que l'upload est réussi
      devis.accesClientExpire = new Date();
      devis.note = (devis.note || "") + `\n[Système] Documents déposés par le client le ${new Date().toLocaleString("fr-FR")}. Accès fermé.`;
      await devis.save();

      res.status(200).json({ 
        message: "✅ Fichiers déposés avec succès. L'accès est désormais clôturé.", 
        fichiers: uploadedFiles 
      });

    } catch (error) {
      console.error("❌ ERREUR COMPLÈTE UPLOAD FILE :", error);
      res.status(500).json({ message: error.message || "Erreur serveur lors du dépôt des fichiers." });
    }
  }
];

/**
 * 📤 Upload du PDF de consentement
 * Route : POST /api/client/upload-consent/:accesClientKey
 */
exports.uploadConsentPdfByClientKey = [
  upload.single('consentementPdf'),
  async (req, res) => {
    try {
      const { accesClientKey } = req.params;

      const devis = await Devis.findOne({ accesClientKey });
      if (!devis) {
        return res.status(404).json({ message: "Clé d'accès invalide ou expirée." });
      }

      const mission = await OrdreMission.findOne({ devisId: devis._id });
      if (!mission) {
        return res.status(404).json({ message: "Aucun ordre de mission associé à ce devis." });
      }

      // 📄 Enregistrement PDF dans Mission
      mission.consentementPdf = {
        nom: req.file.originalname,
        url: req.file.path,
        public_id: req.file.filename || req.file.public_id,
        dateDepot: new Date(),
      };

      await mission.save();

      // 🔥 NOUVEAUTÉ : mise à jour du devis
      devis.consentementFile = true;   // <-- tu peux aussi appeler ça consentementPdf selon ton modèle
      await devis.save();

      res.status(200).json({
        message: "PDF de consentement uploadé avec succès.",
        fichier: mission.consentementPdf,
        devis
      });

    } catch (error) {
      console.error("❌ ERREUR UPLOAD PDF CONSENTEMENT :", error);
      res.status(500).json({ message: error.message || "Erreur serveur lors du dépôt du PDF de consentement." });
    }
  }
];



/**
 * Modifier le statut d'un ordre de mission
 */
exports.updateStatutOrdreMission = async (req, res) => {
  try {
    const { ordreId } = req.params;
    const { statut, rdvDate } = req.body;

    if (!statut) {
      return res.status(400).json({ message: "Le statut est requis." });
    }

    const ordre = await OrdreMission.findById(ordreId)
      .populate('clientId')
      .populate('agenceId');

    if (!ordre) return res.status(404).json({ message: "Ordre de mission non trouvé." });

    // PATCH automatique des anciens OM sans 'creePar'
    if (!ordre.creePar || !ordre.creePar.id || !ordre.creePar.type) {
      const devis = await Devis.findById(ordre.devisId);
      ordre.creePar = {
        id: devis ? devis.agenceId : ordre.agenceId,
        type: "Agence"
      };
    }

    // Permissions agence
    if (req.agence && ordre.agenceId._id.toString() !== req.agence._id.toString()) {
      return res.status(403).json({ message: "Accès refusé à cet ordre de mission." });
    }

    // Mise à jour de la date de rendez-vous si fournie
    let envoyerMail = false;
    if (rdvDate) {
      ordre.rdvDate = new Date(rdvDate);
      envoyerMail = true;
    }

    // Impossible de passer En Cours sans RDV
    if (statut === "En Cours" && !ordre.rdvDate) {
      return res.status(400).json({
        message: "Impossible de passer l'ordre en 'En Cours' sans définir une date et heure de rendez-vous."
      });
    }

    // Mise à jour du statut
    ordre.statut = statut;

    // Si l'OM était annulé et qu'on lui donne une nouvelle date → retour En Attente
    if (rdvDate && ordre.statut === "Annulé") {
      ordre.statut = "En Attente";
    }

    await ordre.save();

    // ✅ Envoi email au client si rdvDate défini
    if (envoyerMail && ordre.clientId?.email) {
      await sendEmail({
        to: ordre.clientId.email,
        subject: "Confirmation de votre rendez-vous ✅",
        template: "ConfirmationRdvClient.html",
        variables: {
          nomClient: ordre.clientId.nom,
          dateRdv: ordre.rdvDate.toLocaleDateString("fr-FR"),
          heureRdv: ordre.rdvDate.toLocaleTimeString("fr-FR", { hour: '2-digit', minute: '2-digit' }),
          adresseIntervention: ordre.clientId?.adresse + ' ' + ordre.clientId?.ville + ' ' + ordre.clientId?.codePostal || "Adresse non précisée",
          telephoneAgence: ordre.agenceId?.telephone_portable || "Non renseigné"
        }
      });
    }

    // 🆕 Envoi email à l'agence si rdvDate défini
    if (envoyerMail && ordre.agenceId) {
      const agenceEmail = ordre.agenceId.emails_contact?.[0]?.email || ordre.agenceId.email;

      if (agenceEmail) {
        try {
          await sendEmail({
            to: agenceEmail,
            subject: `Rendez-vous confirmé - ${ordre.numero}`,
            template: "ConfirmationRdvAgence.html",
            variables: {
              nomAgence: ordre.agenceId.nom_commercial || "Agence",
              numeroMission: ordre.numero,
              dateRdv: ordre.rdvDate.toLocaleDateString("fr-FR"),
              heureRdv: ordre.rdvDate.toLocaleTimeString("fr-FR", { hour: '2-digit', minute: '2-digit' }),
              nomClient: (ordre.clientId?.prenom || '') + ' ' + (ordre.clientId?.nom || ''),
              telClient: ordre.clientId?.telephone || ordre.clientId?.tel || "Non renseigné",
              adresseIntervention: ordre.clientId?.adresse + ' ' + ordre.clientId?.ville + ' ' + ordre.clientId?.codePostal || "Adresse non précisée"
            }
          });
          console.log(`✅ Email de confirmation RDV envoyé à l'agence : ${agenceEmail}`);
        } catch (emailError) {
          console.error("❌ Erreur lors de l'envoi de l'email à l'agence :", emailError);
          // Ne pas bloquer l'opération si l'email échoue
        }
      } else {
        console.warn("⚠️ Aucun email trouvé pour l'agence");
      }
    }

    /*
    ────────────────────────────────
       💰 Crédit cagnotte si Payée
    ────────────────────────────────
    */
    if (ordre.statut === "Payée") {
      const devis = await Devis.findById(ordre.devisId);
      if (!devis) return res.status(404).json({ message: "Devis lié introuvable." });

      const agence = await Agence.findById(ordre.agenceId);
      const montantCredit = +(devis.montantTTC * 0.03).toFixed(2);

      if (!agence) return res.status(404).json({ message: "Agence introuvable." });

      if (agence.type_cagnotte === "individuelle" && ordre.creePar.type === "Employe") {
        const employe = await Employe.findById(ordre.creePar.id);
        if (employe) {
          employe.cagnotte += montantCredit;
          employe.transactions_cagnotte.push({
            montant: montantCredit,
            type: "gain",
            description: `3% du devis ${devis.numero} (Ordre ${ordre.numero})`,
            reference: ordre._id,
            date: new Date()
          });
          await employe.save();
        }
      } else {
        if (!agence.historiqueCagnotte) agence.historiqueCagnotte = [];
        agence.cagnotte = (agence.cagnotte || 0) + montantCredit;
        agence.historiqueCagnotte.push({
          montant: montantCredit,
          type: "gain",
          description: `3% du devis ${devis.numero} (Ordre ${ordre.numero})`,
          par: agence.nom_commercial,
          date: new Date()
        });
        await agence.save();
      }
    }

    res.json({
      message: "Statut mis à jour avec succès.",
      ordre
    });

  } catch (error) {
    console.error("Erreur mise à jour statut ordre :", error);
    res.status(500).json({ message: "Erreur serveur." });
  }
};



/**
 * Récupérer toutes les factures selon l'utilisateur
 */
exports.getFactures = async (req, res) => {
  try {
    let query = {};

    if (req.user.role === "admin") {
      // 🧑‍💼 Admin → toutes les factures
      query = {};
    } else if (req.agence) {
      // 🏢 Agence → uniquement ses factures
      query = { agenceId: req.agence._id };
    } else {
      return res.status(401).json({ message: "Utilisateur non authentifié." });
    }

    const factures = await Facture.find(query)
      .populate("devisId")
      .populate("clientId")
      .sort({ createdAt: -1 });

    res.json({ factures });
  } catch (error) {
    console.error("Erreur récupération factures :", error);
    res.status(500).json({ message: "Erreur serveur." });
  }
};



/**
 * 📤 Partager un ordre de mission avec un ou plusieurs employés
 * Requête POST /ordres/:ordreId/partager
 * Body: { employeeId: [id1, id2, ...] }
 */
exports.partagerOrdreMission = async (req, res) => {
  try {
    const { missionId } = req.params;
    const { employeeId } = req.body;

    console.log("🔹 ordreId reçu :", missionId);
    console.log("🔹 employeeId reçu :", employeeId);
    console.log("🔹 req.admin :", req.admin);
    console.log("🔹 req.agence :", req.agence ? req.agence._id : null);

    if (!employeeId || !Array.isArray(employeeId) || !employeeId.length) {
      console.log("⚠️ Aucun employé fourni !");
      return res.status(400).json({ message: "Veuillez fournir au moins un employé." });
    }

    const ordre = await OrdreMission.findById(missionId);
    console.log("🔹 Ordre récupéré :", ordre);

    if (!ordre) {
      console.log("⚠️ Ordre de mission introuvable !");
      return res.status(404).json({ message: "Ordre de mission introuvable." });
    }

    // Vérifier que l'utilisateur peut partager (admin ou agence correspondante)
    if (req.user.role === "admin" || (req.agence && ordre.agenceId.toString() === req.agence._id.toString())) {
      console.log("✅ Permission OK pour partager l'ordre");

      // Ajouter uniquement les employés qui ne sont pas déjà dans partageAvec
      ordre.partageAvec = Array.from(
        new Set([...ordre.partageAvec.map(id => id.toString()), ...employeeId])
      );
      console.log("🔹 Nouvel état de partageAvec :", ordre.partageAvec);

      await ordre.save();
      console.log("✅ Ordre sauvegardé avec succès");

      return res.status(200).json({
        message: "✅ Ordre de mission partagé avec succès.",
        ordre
      });
    } else {
      console.log("❌ Permission refusée pour partager l'ordre");
      return res.status(403).json({ message: "Vous n'avez pas la permission de partager cet ordre." });
    }
  } catch (error) {
    console.error("❌ Erreur partage ordre de mission :", error);
    return res.status(500).json({ message: "Erreur serveur." });
  }
};
