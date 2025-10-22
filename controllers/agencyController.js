// controllers/agencyController.js
const Agence = require('../models/Agency');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const Pack = require('../models/Pack');
const Diagnostic = require('../models/Diagnostic')
const Supplement = require('../models/Supplement');
// Secret JWT (à mettre dans .env)
const JWT_SECRET = process.env.JWT_SECRET || 'tonSecretIci';
const JWT_EXPIRES_IN = '7d'; // durée du token
const cloudinary = require('../config/cloudinary');
const sendEmail = require('../utils/sendEmails');

/**
 * LOGIN AGENCE
 */
exports.login = async (req, res) => {
  try {
    const { email, mot_de_passe } = req.body;

    // Cherche l'agence soit dans admin.email soit dans emails_contact
    const agence = await Agence.findOne({
      $or: [
        { 'admin.email': email },
        { 'emails_contact.email': email }
      ]
    });

    if (!agence) return res.status(400).json({ message: 'Email ou mot de passe incorrect.' });

    // Vérifie le mot de passe uniquement sur admin
    const isMatch = await bcrypt.compare(mot_de_passe, agence.admin.mot_de_passe);
    if (!isMatch) return res.status(400).json({ message: 'Email ou mot de passe incorrect.' });

    // Vérifie le statut
    if (agence.statut === 'en_attente') {
      return res.status(403).json({ message: 'Votre compte est toujours en attente d’approbation.' });
    } else if (agence.statut === 'bloqué') {
      return res.status(403).json({ message: 'Votre compte est bloqué. Contactez le support.' });
    } else if (agence.statut === 'suspendu') {
      return res.status(403).json({ message: 'Votre compte est suspendu.' });
    }

    // Génération du token JWT
    const token = jwt.sign(
      {
        agenceId: agence._id,
        email: agence.admin.email,
        role: agence.admin.role
      },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN || '7d' }
    );

    res.json({
      token,
      agence: {
        id: agence._id,
        nom_commercial: agence.nom_commercial,
        nom_responsable: agence.nom_responsable,
        adresse: agence.adresse,
        siret: agence.siret,
        telephone_fixe: agence.telephone_fixe,
        telephone_portable: agence.admin.telephone_portable,
        activite: agence.activite,
        domaine_intervention: agence.domaine_intervention,
        emails_contact: agence.emails_contact,
        alerte_secteur: agence.alerte_secteur,
        statut: agence.statut,
        photo: agence.logo,
      }
    });
  } catch (error) {
    console.error('❌ Erreur lors de la connexion :', error);
    res.status(500).json({ message: 'Erreur serveur lors de la connexion.' });
  }
};



/**
 * REGISTER AGENCE
 */
exports.register = async (req, res) => {
  try {
    const {
      nom_commercial,
      nom_responsable,
      adresse,
      alerte_secteur,
      siret,
      telephone_fixe,
      telephone_portable,
      activite,
      emails_contact, // [{ email: '...' }]
      mot_de_passe,
      ca_estime
    } = req.body;

    // Vérification email de contact
    if (!emails_contact) {
      return res.status(400).json({ message: "L'email de contact est obligatoire." });
    }

    const emailsArray = JSON.parse(emails_contact);
    if (emailsArray.length === 0) {
      return res.status(400).json({ message: "Au moins un email de contact doit être fourni." });
    }

    const email_connexion = emailsArray[0].email;

    // Vérifie si un compte existe déjà
    const existingAdmin = await Agence.findOne({ 'admin.email': email_connexion });
    if (existingAdmin) {
      return res.status(400).json({ message: "Un compte avec cet email existe déjà." });
    }

    // Upload Cloudinary
    let logoUrl = null;
    let photoProfilUrl = null;

    if (req.files?.logo?.[0]) {
      const resultLogo = await cloudinary.uploader.upload(req.files.logo[0].path, {
        folder: "dimotec/agences"
      });
      logoUrl = resultLogo.secure_url;
    }

    if (req.files?.photo_profil?.[0]) {
      const resultPhoto = await cloudinary.uploader.upload(req.files.photo_profil[0].path, {
        folder: "dimotec/admins"
      });
      photoProfilUrl = resultPhoto.secure_url;
    }

    // Création de l'agence
    const newAgence = new Agence({
      nom_commercial,
      nom_responsable,
      adresse,
      alerte_secteur,
      siret,
      telephone_fixe,
      activite,
      emails_contact: emailsArray,
      logo: logoUrl,
      ca_estime: Number(ca_estime) || 0,
      admin: {
        nom: nom_responsable,
        prenom: 'Admin',
        email: email_connexion,
        mot_de_passe,
        telephone_portable,
        role: 'admin',
        photo_profil: photoProfilUrl
      }
    });

    await newAgence.save();

    // Génération du token JWT
    const token = jwt.sign(
      {
        agenceId: newAgence._id,
        email: newAgence.admin.email,
        role: newAgence.admin.role
      },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );

    // ✅ Envoi de l'e-mail de bienvenue
    await sendEmail({
      to: email_connexion,
      subject: "Bienvenue sur Dimotec 👋",
      template: "WelcomeAgence.html", // ton template dans /templates/WelcomeAgence.html
      variables: {
        nomResponsable: nom_responsable,
        nomCommercial: nom_commercial,
        emailConnexion: email_connexion,
        telephone: telephone_portable,
        adresse,
      }
    });

    res.status(201).json({
      message: 'Agence créée avec succès ✅',
      token,
      agence: {
        id: newAgence._id,
        nom_commercial: newAgence.nom_commercial,
        nom_responsable: newAgence.nom_responsable,
        adresse: newAgence.adresse,
        siret: newAgence.siret,
        telephone_fixe: newAgence.telephone_fixe,
        telephone_portable: newAgence.admin.telephone_portable,
        activite: newAgence.activite,
        email_connexion: newAgence.admin.email,
        emails_contact: newAgence.emails_contact,
        alerte_secteur: newAgence.alerte_secteur,
        logo: newAgence.logo,
        photo_profil: newAgence.admin.photo_profil
      }
    });

  } catch (error) {
    console.error('❌ Erreur lors de la création de l’agence :', error);
    res.status(500).json({ message: 'Erreur serveur lors de l’inscription.' });
  }
};

// ✅ Récupération complète des infos de l'agence connectée
exports.getInfosAgence = async (req, res) => {
  try {
    const agenceId = req.agence?._id || req.user?.agenceId || req.params.id;
    if (!agenceId) {
      return res.status(400).json({ message: "Aucun identifiant d'agence fourni." });
    }

    const agence = await Agence.findById(agenceId).select("-admin.mot_de_passe -__v");
    if (!agence) {
      return res.status(404).json({ message: "Agence introuvable." });
    }

    res.status(200).json({
      message: "✅ Informations de l'agence récupérées avec succès",
      agence,
    });
  } catch (error) {
    console.error("❌ Erreur lors de la récupération des infos agence :", error);
    res.status(500).json({ message: "Erreur serveur lors de la récupération des informations." });
  }
};


// ✅ Mise à jour complète des infos de l'agence
exports.updateInfosAgence = async (req, res) => {
  try {
    const agenceId = req.agence?._id || req.user?.agenceId || req.params.id;
    if (!agenceId) {
      return res.status(400).json({ message: "Aucun identifiant d'agence fourni." });
    }

    const allowedFields = [
      "nom_commercial",
      "nom_responsable",
      "adresse",
      "alerte_secteur",
      "siret",
      "telephone_fixe",
      "activite",
      "domaine_intervention",
      "emails_contact",
      "ca_estime",
      "reduction"
    ];

    const updates = {};
    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        updates[field] = req.body[field];
      }
    }

    const updatedAgence = await Agence.findByIdAndUpdate(
      agenceId,
      { $set: updates },
      { new: true, runValidators: true, select: "-admin.mot_de_passe -__v" }
    );

    if (!updatedAgence) {
      return res.status(404).json({ message: "Agence introuvable." });
    }

    res.status(200).json({
      message: "✅ Informations mises à jour avec succès",
      agence: updatedAgence,
    });
  } catch (error) {
    console.error("❌ Erreur lors de la mise à jour des infos agence :", error);
    res.status(500).json({ message: "Erreur serveur lors de la mise à jour des informations." });
  }
};



// ✅ Récupération de la cagnotte, réduction, email, téléphone et CA estimé
exports.getCagnotteEtReduction = async (req, res) => {
  try {
    let agence;

    if (req.admin) {
      // 🧑‍💼 Admin → récupération d'une agence (exemple : première agence)
      console.log("Admin connecté, récupération globale possible");
      agence = await Agence.findOne().select("nom_commercial cagnotte reduction telephone_fixe emails_contact ca_estime");
      if (!agence) return res.status(404).json({ message: "Aucune agence trouvée." });

    } else if (req.agence) {
      // 🏢 Agence → uniquement sa propre agence
      const agenceId = req.agence._id;
      console.log("Agence connectée, récupération de ses données :", agenceId);
      agence = await Agence.findById(agenceId).select("nom_commercial cagnotte reduction telephone_fixe emails_contact ca_estime");
      if (!agence) return res.status(404).json({ message: "Agence introuvable." });

    } else {
      return res.status(401).json({ message: "Utilisateur non authentifié." });
    }

    // Formater les emails pour ne renvoyer que la liste simple ou par type
    const emails = agence.emails_contact?.map(e => ({ type: e.type, email: e.email })) || [];

    return res.status(200).json({
      message: "✅ Informations récupérées avec succès",
      agence: agence.nom_commercial,
      telephone: agence.telephone_fixe,
      emails: emails,
      ca_estime: agence.ca_estime || 0,
      cagnotte: agence.cagnotte || 0,
      reduction: agence.reduction || 0
    });

  } catch (error) {
    console.error("❌ Erreur récupération cagnotte/réduction :", error);
    return res.status(500).json({
      message: "Erreur serveur lors de la récupération de la cagnotte et de la réduction."
    });
  }
};





/**
 * Récupère tous les packs correspondant aux infos envoyées
 * POST /api/agency/packs/filter
 * Body: { typeBien, typeOperation, annee, surface }
 */
exports.filterPacks = async (req, res) => {
  try {
    const { typeBien, typeOperation, annee, surface } = req.body;

    if (!typeBien || !typeOperation || !surface) {
      return res.status(400).json({ message: "Type de bien, type d'opération et surface sont requis." });
    }

    // Récupération de l'agence depuis le middleware
    const agence = req.agence;
    const secteur = (agence?.alerte_secteur || 'autre').toLowerCase();
    console.log("🔹 Secteur de l'agence :", secteur);

    // Mapping année front -> tranche backend
    let tranche;
    switch (annee) {
      case 'Avant 1949': tranche = 'avant_1949'; break;
      case 'De 1949 à 30 Juin 1997': tranche = '1949_1997'; break;
      case 'Du 1 Juillet 1997 + 15 ans': tranche = '1997_plus15'; break;
      case 'Moins de 15 ans': tranche = 'moins_15ans'; break;
      default: tranche = 'moins_15ans';
    }
    console.log("🔹 Tranche année calculée :", tranche);

    // Extraction de la plage de surface
    const surfaceMatch = surface.match(/(\d+)-(\d+)/);
    const surfaceMinDemande = surfaceMatch ? parseInt(surfaceMatch[1], 10) : 0;
    const surfaceMaxDemande = surfaceMatch ? parseInt(surfaceMatch[2], 10) : surfaceMinDemande;
    console.log("🔹 Surface demandée min/max :", surfaceMinDemande, "/", surfaceMaxDemande);

    // Recherche packs
    const packs = await Pack.find({ typeBien, typeOperation, trancheAnnee: tranche })
      .populate('diagnostics');

    if (!packs.length) {
      console.log("❌ Aucun pack trouvé pour ces critères :", { typeBien, typeOperation, tranche });
      return res.status(404).json({ message: "Aucun pack trouvé pour ces critères." });
    }

    console.log(`🔹 ${packs.length} pack(s) trouvé(s) pour ces critères`);

    // Calcul tarif par surface + secteur avec chevauchement des plages
    const packsAvecTarif = packs.map(pack => {
      let tarifTrouve = null;

      if (pack.tarifsParSurface?.length) {
        for (let tps of pack.tarifsParSurface) {
          if (!(surfaceMaxDemande < tps.surfaceMin || surfaceMinDemande > tps.surfaceMax)) {
            tarifTrouve = tps.tarifs[secteur] ?? tps.tarifs.autre ?? null;
            break;
          }
        }
      }

      return {
        ...pack.toObject(),
        tarifPourSurface: tarifTrouve
      };
    });

    // Récupération de tous les diagnostics avec seulement le nom
    const allDiagnostics = await Diagnostic.find({}, { nom: 1 });

    res.json({
      packs: packsAvecTarif,
      diagnostics: allDiagnostics
    });

  } catch (error) {
    console.error("❌ Erreur filterPacks :", error);
    res.status(500).json({ message: "Erreur serveur lors de la récupération des packs." });
  }
};

/**
 * Récupère les diagnostics à la carte correspondant aux infos envoyées
 * POST /api/agency/diagnostics/filter
 * Body: { typeBien, typeOperation, annee, surface }
 */
exports.filterDiagnostics = async (req, res) => {
  try {
    const { typeBien, typeOperation, annee, surface } = req.body;

    if (!typeBien || !typeOperation || !annee || !surface) {
      return res.status(400).json({
        message: "Type de bien, type d'opération, année et surface sont requis."
      });
    }

    // --- Récupération de l'agence depuis le middleware ---
    const agence = req.agence;
    const secteur = (agence?.alerte_secteur || 'autre').toLowerCase();
    console.log("🔹 Secteur de l'agence :", secteur);

    // --- Déterminer la tranche d'année ---
    let tranche;
    switch (annee) {
      case 'Avant 1949': tranche = 'avant_1949'; break;
      case 'De 1949 à 30 Juin 1997': tranche = '1949_1997'; break;
      case 'Du 1 Juillet 1997 + 15 ans': tranche = '1997_plus15'; break;
      case 'Moins de 15 ans': tranche = 'moins_15ans'; break;
      default: tranche = 'moins_15ans';
    }

    console.log("🔹 Tranche année :", tranche);

    // --- Déterminer les diagnostics obligatoires selon la règle métier ---
    let diagnosticsObligatoires = [];

    if (typeBien === "maison") {
      if (tranche === "avant_1949") {
        diagnosticsObligatoires = ["DPE", "TERMITE", "ELECTRICITE", "PLOMB"];
      } else if (tranche === "1949_1997") {
        diagnosticsObligatoires = ["DPE", "TERMITE", "ELECTRICITE"];
      } else if (tranche === "1997_plus15") {
        diagnosticsObligatoires = ["DPE", "TERMITE", "ELECTRICITE"];
      } else if (tranche === "moins_15ans") {
        diagnosticsObligatoires = ["DPE", "TERMITE"];
      }
    } else if (typeBien === "appartement") {
      diagnosticsObligatoires = ["DPE", "ELECTRICITE"];
    }

    console.log("🔹 Diagnostics obligatoires :", diagnosticsObligatoires);

    // --- Extraction de la plage de surface ---
    const surfaceMatch = surface.match(/(\d+)-(\d+)/);
    const surfaceMinDemande = surfaceMatch ? parseInt(surfaceMatch[1], 10) : 0;
    const surfaceMaxDemande = surfaceMatch ? parseInt(surfaceMatch[2], 10) : surfaceMinDemande;
    console.log("🔹 Surface demandée :", surfaceMinDemande, "-", surfaceMaxDemande);

    // --- Rechercher les diagnostics correspondants ---
    const allDiagnostics = await Diagnostic.find({
      typeBien: typeBien.toLowerCase(),
      typeOperation: typeOperation.toLowerCase(),
    });

    if (!allDiagnostics.length) {
      return res.status(404).json({ message: "Aucun diagnostic trouvé pour ces critères." });
    }

    // --- Fonction de normalisation (accents, casse, espaces) ---
    const normalize = (str) =>
      str
        ?.toString()
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .trim();

    // --- Filtrer uniquement ceux requis selon les règles ---
    const diagnosticsFiltres = allDiagnostics.filter(d => {
      const diagName = normalize(d.nom);
      return diagnosticsObligatoires.some(name => diagName.includes(normalize(name)));
    });

    if (!diagnosticsFiltres.length) {
      console.log("❌ Aucun diagnostic correspondant aux règles métier trouvé.");
      return res.status(404).json({ message: "Aucun diagnostic requis pour cette configuration." });
    }

    // --- Ajouter le tarif selon la surface et le secteur ---
    const diagnosticsAvecTarif = diagnosticsFiltres.map(diag => {
      let tarifTrouve = null;
      let plageSurface = null;

      if (diag.tarifsParSurface?.length) {
        for (let tps of diag.tarifsParSurface) {
          if (!(surfaceMaxDemande < tps.surfaceMin || surfaceMinDemande > tps.surfaceMax)) {
            tarifTrouve = tps.tarifs?.[secteur] ?? tps.tarifs?.autre ?? null;
            plageSurface = `${tps.surfaceMin}-${tps.surfaceMax}`;
            break;
          }
        }

        // 🔸 Fallback : si aucun tarif exact trouvé, prendre le plus proche
        if (!tarifTrouve) {
          const tarifLePlusProche = diag.tarifsParSurface
            .sort((a, b) => Math.abs(surfaceMinDemande - a.surfaceMin) - Math.abs(surfaceMinDemande - b.surfaceMin))[0];
          tarifTrouve = tarifLePlusProche?.tarifs?.[secteur] ?? tarifLePlusProche?.tarifs?.autre ?? null;
          plageSurface = `${tarifLePlusProche?.surfaceMin}-${tarifLePlusProche?.surfaceMax}`;
        }
      }

      console.log(`💰 Diagnostic : ${diag.nom}`);
      console.log(`   → Plage surface : ${plageSurface || "aucune"}`);
      console.log(`   → Tarif trouvé (${secteur}) : ${tarifTrouve ?? "non trouvé"}`);

      return {
        ...diag.toObject(),
        tarifPourSurface: tarifTrouve
      };
    });

    console.log(`✅ ${diagnosticsAvecTarif.length} diagnostics filtrés avec tarif.`);

    res.json({
      diagnostics: diagnosticsAvecTarif,
      tranche,
      diagnosticsObligatoires
    });

  } catch (error) {
    console.error("❌ Erreur filterDiagnostics :", error);
    res.status(500).json({ message: "Erreur serveur lors du filtrage des diagnostics." });
  }
};


/**
 * Récupère les suppléments filtrés par type de bien
 * POST /api/agency/supplements/filter
 * Body: { typeBien }
 */
exports.filterSupplementsByTypeBien = async (req, res) => {
  try {
    const { typeBien } = req.body;

    if (!typeBien) {
      return res.status(400).json({ message: "Le type de bien est requis." });
    }

    // Récupération de l'agence depuis le middleware
    const agence = req.agence;
    const secteur = (agence?.alerte_secteur || 'autre').toLowerCase();

    console.log("🔹 Type de bien demandé :", typeBien);
    console.log("🔹 Secteur de l'agence :", secteur);

    // Recherche des suppléments qui incluent ce type de bien
    const supplements = await Supplement.find({
  typeBienApplicable: { $in: [typeBien?.toLowerCase()] } // sécurité si typeBien undefined
});
    if (!supplements.length) {
      return res.status(404).json({ message: "Aucun supplément trouvé pour ce type de bien." });
    }

    // Ajout du tarif selon le secteur de l'agence
    const supplementsAvecTarif = supplements.map(s => {
      // Prendre le tarif correspondant au secteur ou fallback sur "autre"
      const tarifTrouve = s.tarifs?.[secteur] ?? s.tarifs?.autre ?? 0;
      return {
        ...s.toObject(),
        tarifPourSecteur: tarifTrouve
      };
    });

    console.log(`✅ ${supplementsAvecTarif.length} supplément(s) trouvé(s) pour ${typeBien}`);

    res.json({
      supplements: supplementsAvecTarif
    });

  } catch (error) {
    console.error("❌ Erreur filterSupplementsByTypeBien :", error);
    res.status(500).json({ message: "Erreur serveur lors du filtrage des suppléments." });
  }
};


