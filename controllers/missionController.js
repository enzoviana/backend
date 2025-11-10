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

/**
 * 📋 Récupérer tous les ordres de mission selon l'utilisateur
 */
exports.getOrdresMission = async (req, res) => {
  try {
    let query = {};

    if (req.admin) {
      // 🧑‍💼 Admin → tous les ordres de mission
      query = {};
    } else if (req.agence) {
      // 🏢 Agence → uniquement ses ordres de mission
      query = { agenceId: req.agence._id };
    } else {
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
          { path: "diagnostics", model: "Diagnostic" } // ✅ AJOUT ICI
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
            // Retire la partie avant 'upload/' et la version 'vXXXXX/'
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
 * 📤 Upload de plusieurs fichiers liés à un ordre de mission via la clé d’accès du client
 * Route : POST /api/client/upload/:accesClientKey
 */
exports.uploadFileByClientKey = [
  upload.array('fichiers', 10), 
  async (req, res) => {
    try {
      console.log("🔑 Clé client reçue :", req.params.accesClientKey);
      console.log("📂 Fichiers reçus par Multer :", req.files);

      const { accesClientKey } = req.params;

      const devis = await Devis.findOne({ accesClientKey });
      if (!devis) return res.status(404).json({ message: "Clé d'accès invalide ou expirée." });

      const mission = await OrdreMission.findOne({ devisId: devis._id });
      console.log('mission trouvé: ',mission)
      if (!mission) return res.status(404).json({ message: "Aucun ordre de mission associé à ce devis." });

const uploadedFiles = req.files.map(file => ({
  nom: file.originalname,
  url: file.path,
  public_id: file.filename || file.public_id, // ← ici
  dateDepot: new Date(),
}));

      mission.fichiersClient.push(...uploadedFiles);
      await mission.save();

      res.status(200).json({ message: "Fichiers déposés avec succès.", fichiers: uploadedFiles });

    } catch (error) {
      console.error("❌ ERREUR COMPLÈTE UPLOAD FILE :", error);
      res.status(500).json({ message: error.message || "Erreur serveur lors du dépôt des fichiers." });
    }
  }
];


/**
 * Modifier le statut d'un ordre de mission
 */
exports.updateStatutOrdreMission = async (req, res) => {
  try {
    const { ordreId } = req.params;
    const { statut, rdvDate } = req.body; // <--- récupère rdvDate

    if (!statut) {
      return res.status(400).json({ message: "Le statut est requis." });
    }

    const ordre = await OrdreMission.findById(ordreId);
    if (!ordre) return res.status(404).json({ message: "Ordre de mission non trouvé." });

    // Permissions ok
    if (req.agence && ordre.agenceId.toString() !== req.agence._id.toString()) {
      return res.status(403).json({ message: "Accès refusé à cet ordre de mission." });
    }

    // ✅ Si rdvDate vient du front → on la met à jour
    if (rdvDate) {
      ordre.rdvDate = new Date(rdvDate);
    }

    // ✅ Bloquer “En Cours” si pas de date
    if (statut === "En Cours" && !ordre.rdvDate) {
      return res.status(400).json({ 
        message: "Impossible de passer l'ordre en 'En Cours' sans définir une date et heure de rendez-vous." 
      });
    }

    ordre.statut = statut;
    await ordre.save();

    res.json({ message: "Statut mis à jour avec succès.", ordre });

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

    if (req.admin) {
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
