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
 * VERIFY TOKEN AGENCE
 */
exports.verifyToken = async (req, res) => {
  try {
    const token = req.headers.authorization?.split(" ")[1]; // Récupère le token du header

    if (!token) {
      return res.status(401).json({ valid: false, message: "Token manquant" });
    }

    // Vérifie et décode le token
    const decoded = jwt.verify(token, JWT_SECRET);

    // Recherche de l'agence correspondante
    const agence = await Agence.findById(decoded.agenceId).select(
      "nom_commercial admin.email statut logo"
    );

    if (!agence) {
      return res.status(404).json({ valid: false, message: "Agence introuvable" });
    }

    // Si le statut est bloqué, suspendu ou en attente → refuser l'accès
    if (["bloqué", "suspendu", "en_attente"].includes(agence.statut)) {
      return res.status(403).json({
        valid: false,
        message: "Votre compte est inactif. Contactez le support.",
      });
    }

    // ✅ Token valide
    res.json({
      valid: true,
      agence: {
        id: agence._id,
        nom_commercial: agence.nom_commercial,
        email: agence.admin.email,
        statut: agence.statut,
        logo: agence.logo,
      },
    });
  } catch (error) {
    console.error("❌ Erreur lors de la vérification du token :", error);
    res.status(401).json({ valid: false, message: "Token invalide ou expiré" });
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
    console.log(req.body)

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
    console.log("🔹 Surface demandée :", typeBien === "appartement" ? typeAppartement : `${surfaceMinDemande}-${surfaceMaxDemande}`);


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
    console.log(req.body);

    if (!typeBien || !typeOperation || !annee || !surface) {
      return res.status(400).json({
        message: "Type de bien, type d'opération, année et surface sont requis."
      });
    }

    const agence = req.agence;
    const secteur = (agence?.alerte_secteur || "autre").toLowerCase();

    // --- Déterminer la tranche d’année ---
    let tranche;
    switch (annee) {
      case "Avant 1949": tranche = "avant_1949"; break;
      case "De 1949 à 30 Juin 1997": tranche = "1949_1997"; break;
      case "Du 1 Juillet 1997 + 15 ans": tranche = "1997_plus15"; break;
      case "Moins de 15 ans":
      case "Après 2010": tranche = "moins_15ans"; break;
      default: tranche = "moins_15ans";
    }

    console.log("🔹 Tranche année :", tranche);
    console.log("🔹 Type :", typeBien, "-", typeOperation);

    // --- Diagnostics obligatoires ---
    let diagnosticsObligatoires = [];
    if (typeOperation === "vente") {
      if (typeBien === "maison" || typeBien === "appartement") {
        switch (tranche) {
          case "avant_1949":
            diagnosticsObligatoires = ["DPE", "Termites", "Electricité", "Gaz", "Amiante", "Plomb", "ERP", "Surface"];
            break;
          case "1949_1997":
            diagnosticsObligatoires = ["DPE", "Termites", "Electricité", "Gaz", "Amiante", "ERP", "Surface"];
            break;
          case "1997_plus15":
            diagnosticsObligatoires = ["DPE", "Termites", "Electricité", "Gaz", "ERP", "Surface"];
            break;
          case "moins_15ans":
            diagnosticsObligatoires = ["DPE", "Termites", "ERP", "Surface"];
            break;
        }
      }
    } else if (typeOperation === "location") {
      if (typeBien === "maison") {
        diagnosticsObligatoires = tranche === "avant_1949"
          ? ["DPE", "Surface", "ERP", "Electricité/Gaz", "Plomb"]
          : ["DPE", "Surface", "ERP", "Electricité/Gaz"];
      } else if (typeBien === "appartement") {
        diagnosticsObligatoires = tranche === "avant_1949"
          ? ["DPE", "Surface", "ERP", "Electricité/Gaz", "DAPP (amiante)", "Plomb"]
          : tranche === "1949_1997"
          ? ["DPE", "Surface", "ERP", "Electricité/Gaz", "DAPP (amiante)"]
          : ["DPE", "Surface", "ERP", "Electricité/Gaz"];
      }
    }

    console.log("🔹 Diagnostics obligatoires :", diagnosticsObligatoires);

    // --- Calcul surface ---
    let surfaceMinDemande = 0;
    let surfaceMaxDemande = 0;
    let typeAppartement = null;

    if (typeBien === "maison") {
      const match = surface.match(/(\d+)-(\d+)/);
      surfaceMinDemande = match ? parseInt(match[1], 10) : 0;
      surfaceMaxDemande = match ? parseInt(match[2], 10) : surfaceMinDemande;
    } else if (typeBien === "appartement") {
      // Surface envoyée par le front correspond au type d'appartement (T1, T2, ... ou "<20m2")
      typeAppartement = surface;
      surfaceMinDemande = 0;
      surfaceMaxDemande = 0; // on n'utilise pas les min/max pour les appartements
    }

    console.log("🔹 Surface demandée :", surfaceMinDemande, "-", surfaceMaxDemande);

    // --- Récupérer diagnostics ---
    const allDiagnostics = await Diagnostic.find({
      typeBien: typeBien.toLowerCase(),
      typeOperation: typeOperation.toLowerCase(),
    });

    if (!allDiagnostics.length) {
      return res.status(404).json({ message: "Aucun diagnostic trouvé pour ces critères." });
    }

    const normalize = str => str?.toString().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/s$/, "").trim();

    const diagnosticsFiltres = allDiagnostics.filter(d =>
      diagnosticsObligatoires.some(name =>
        normalize(d.nom).includes(normalize(name)) || normalize(name).includes(normalize(d.nom))
      )
    );

    console.log("🔹 Diagnostics filtrés :");
    diagnosticsFiltres.forEach(d => console.log(`- ${d.nom} (${d.typeBien} / ${d.typeOperation})`));

    if (!diagnosticsFiltres.length) {
      return res.status(404).json({ message: "Aucun diagnostic obligatoire trouvé pour cette configuration." });
    }

    // --- Ajouter le tarif ---
    const diagnosticsAvecTarif = diagnosticsFiltres.map(diag => {
      let tarifTrouve = null;

      if (typeBien === "maison" && diag.tarifsParSurface?.length) {
        // Maison : on utilise la plage surface
        for (let tps of diag.tarifsParSurface) {
          if (!(surfaceMaxDemande < tps.surfaceMin || surfaceMinDemande > tps.surfaceMax)) {
            tarifTrouve = tps.tarifs?.[secteur] ?? tps.tarifs?.autre ?? null;
            break;
          }
        }
      } else if (typeBien === "appartement" && diag.tarifsParAppartement?.length) {
        // Appartement : on utilise le type d'appartement
        const tarifObj = diag.tarifsParAppartement.find(t => t.typeAppartement === typeAppartement);
        if (tarifObj) {
          tarifTrouve = tarifObj.tarifs?.[secteur] ?? tarifObj.tarifs?.autre ?? null;
        }
      }

      console.log(`🔹 ${diag.nom} : tarif = ${tarifTrouve}`);

      return {
        ...diag.toObject(),
        tarifPourSurface: tarifTrouve,
      };
    });

    res.json({
      diagnostics: diagnosticsAvecTarif,
      tranche,
      diagnosticsObligatoires,
      surfaceMinDemande,
      surfaceMaxDemande,
      typeAppartement
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


// ------------------------ MDP REINITAILISATION ------------------------------- //


const crypto = require('crypto');

/**
 * DEMANDE DE RÉINITIALISATION DU MOT DE PASSE
 * Envoie un e-mail avec un lien contenant un token temporaire
 */
exports.forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;

    // Recherche de l'agence par email (admin ou contact)
    const agence = await Agence.findOne({
      $or: [
        { 'admin.email': email },
        { 'emails_contact.email': email }
      ]
    });

    if (!agence) {
      return res.status(404).json({ message: "Aucun compte trouvé avec cet email." });
    }

    // Génération d’un token aléatoire
    const resetToken = crypto.randomBytes(32).toString('hex');
    const resetTokenHash = crypto.createHash('sha256').update(resetToken).digest('hex');

    // Stockage temporaire du token dans la BDD (valide 1h)
    agence.admin.resetPasswordToken = resetTokenHash;
    agence.admin.resetPasswordExpires = Date.now() + 60 * 60 * 1000; // 1h
    await agence.save();

    // Lien de réinitialisation (frontend)
    const resetUrl = `${process.env.FRONTEND_URL}/reset-password/${resetToken}`;

    // Envoi de l’e-mail
    await sendEmail({
      to: agence.admin.email,
      subject: "Réinitialisation de votre mot de passe - Dimotec Diagnostics",
      template: "ResetPassword.html", // ton template HTML dans /templates/ResetPassword.html
      variables: {
        nomClient: agence.admin.nom || agence.nom_responsable,
        lienReinitialisation: resetUrl
      }
    });

    res.json({ message: "Un e-mail de réinitialisation a été envoyé à votre adresse." });
  } catch (error) {
    console.error("❌ Erreur forgotPassword :", error);
    res.status(500).json({ message: "Erreur serveur lors de la demande de réinitialisation." });
  }
};

/**
 * VÉRIFICATION DU TOKEN DE RÉINITIALISATION
 */
exports.verifyResetToken = async (req, res) => {
  try {
    const { token } = req.params;
    console.log("🔹 Token reçu du frontend :", token);

    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    console.log("🔹 Token hashé :", tokenHash);

    const agence = await Agence.findOne({
      'admin.resetPasswordToken': tokenHash,
      'admin.resetPasswordExpires': { $gt: Date.now() }
    });

    console.log("🔹 Agence trouvée :", agence ? agence._id : "Aucune agence trouvée");
    console.log("🔹 Date actuelle :", new Date());
    if (agence) {
      console.log("🔹 Date d'expiration du token :", new Date(agence.admin.resetPasswordExpires));
    }

    if (!agence) {
      return res.status(400).json({ message: "Token invalide ou expiré." });
    }

    res.json({ message: "Token valide.", email: agence.admin.email });
  } catch (error) {
    console.error("❌ Erreur verifyResetToken :", error);
    res.status(500).json({ message: "Erreur serveur lors de la vérification du token." });
  }
};


/**
 * DÉFINITION D’UN NOUVEAU MOT DE PASSE
 */
exports.resetPassword = async (req, res) => {
  try {
    const { token } = req.params;
    const { mot_de_passe } = req.body;

    console.log("🔹 Token reçu pour reset :", token);
    console.log("🔹 Mot de passe reçu :", mot_de_passe);

    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    console.log("🔹 Token hashé :", tokenHash);

    const agence = await Agence.findOne({
      'admin.resetPasswordToken': tokenHash,
      'admin.resetPasswordExpires': { $gt: Date.now() }
    });

    console.log("🔹 Agence trouvée :", agence ? agence._id : "Aucune agence trouvée");
    if (agence) {
      console.log("🔹 Date actuelle :", new Date());
      console.log("🔹 Date d'expiration du token :", new Date(agence.admin.resetPasswordExpires));
    }

    if (!agence) {
      return res.status(400).json({ message: "Token invalide ou expiré." });
    }

    // ✅ Mise à jour du mot de passe directement
    // Le pre('save') dans AdminSchema va hash automatiquement
    agence.admin.mot_de_passe = mot_de_passe;
    agence.admin.resetPasswordToken = undefined;
    agence.admin.resetPasswordExpires = undefined;
    await agence.save();

    console.log("✅ Mot de passe réinitialisé pour l'agence :", agence._id);

    // Envoi d’un email de confirmation
    await sendEmail({
      to: agence.admin.email,
      subject: "Votre mot de passe a été modifié - Dimotec Diagnostics",
      template: "PasswordChanged.html",
      variables: {
        nomClient: agence.admin.nom || agence.nom_responsable
      }
    });

    res.json({ message: "Mot de passe réinitialisé avec succès." });
  } catch (error) {
    console.error("❌ Erreur resetPassword :", error);
    res.status(500).json({ message: "Erreur serveur lors de la réinitialisation du mot de passe." });
  }
};



