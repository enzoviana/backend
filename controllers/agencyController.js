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
const Employe = require('../models/Employe');

/**
 * LOGIN AGENCE OU EMPLOYÉ
 */
/**
 * LOGIN AGENCE OU EMPLOYÉ
 */
exports.login = async (req, res) => {
  try {
    const { email, mot_de_passe } = req.body;

    let user = null;
    let type = null;

    /**
     * 1️⃣ Vérification côté AGENCE
     */
    const agence = await Agence.findOne({
      $or: [
        { 'admin.email': email },
        { 'emails_contact.email': email }
      ]
    });

    if (agence) {
      user = agence;
      type = 'agence';
    }

    /**
     * 2️⃣ Vérification côté EMPLOYÉ si non agence
     */
    let employe = null;
    if (!user) {
      employe = await Employe.findOne({ email });
      if (employe) {
        user = employe;
        type = 'employe';
      }
    }

    /**
     * Aucun utilisateur trouvé
     */
    if (!user) {
      return res.status(400).json({ message: "Email ou mot de passe incorrect." });
    }

    /**
     * 3️⃣ Vérification du mot de passe
     */
    const hash = type === "agence"
      ? user.admin.mot_de_passe
      : user.mot_de_passe;

    const isMatch = await bcrypt.compare(mot_de_passe, hash);
    if (!isMatch) {
      return res.status(400).json({ message: "Email ou mot de passe incorrect." });
    }

    /**
     * 4️⃣ Vérification des statuts
     */
    const statut = user.statut?.toLowerCase() || "actif";

    // Statuts agence
    if (type === "agence") {
      if (statut === 'en_attente') {
        return res.status(403).json({ message: "Votre compte est en attente d’approbation." });
      }
      if (statut === 'bloqué') {
        return res.status(403).json({ message: "Votre compte est bloqué." });
      }
      if (statut === 'suspendu') {
        return res.status(403).json({ message: "Votre compte est suspendu." });
      }
    }

    // Statuts employé
    if (type === "employe") {
      if (['en_attente', 'bloque', 'suspendu'].includes(statut)) {
        const messages = {
          en_attente: "Votre compte employé est en attente de validation.",
          bloque: "Votre compte employé est bloqué.",
          suspendu: "Votre compte employé est suspendu."
        };
        return res.status(403).json({ message: messages[statut] });
      }

      // en_conge = autorisé
      // actif = autorisé
    }

    /**
     * 5️⃣ JWT
     */
    const token = jwt.sign(
      {
        id: user._id,
        type,
        role: type === "agence" ? user.admin.role : user.role,
        agenceId: type === "agence" ? user._id : user.agenceId,
        employeId: type === "employe" ? user._id : null,
        email
      },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN || "7d" }
    );

    /**
     * 6️⃣ Réponse
     */
    if (type === "agence") {
      return res.json({
        token,
        type,
        agence: {
          id: user._id,
          nom_commercial: user.nom_commercial,
          adresse: user.adresse,
          email: user.admin.email,
          telephone: user.admin.telephone_portable,
          statut: user.statut,
          activite: user.activite,
          domaine_intervention: user.domaine_intervention,
          logo: user.logo
        }
      });
    }

    return res.json({
      token,
      type,
      employe: {
        id: user._id,
        nom: user.nom,
        prenom: user.prenom,
        email: user.email,
        role: user.role,
        statut: user.statut,
        agenceId: user.agenceId
      }
    });

  } catch (error) {
    console.error("❌ Erreur lors de la connexion :", error);
    res.status(500).json({ message: "Erreur serveur lors de la connexion." });
  }
};


/**
 * VERIFY TOKEN (AGENCE ou EMPLOYE)
 */
exports.verifyToken = async (req, res) => {
  try {
    const token = req.headers.authorization?.split(" ")[1];

    if (!token) {
      return res.status(401).json({ valid: false, message: "Token manquant" });
    }

    // Décodage du token
    const decoded = jwt.verify(token, JWT_SECRET);

    // Vérifie que le rôle existe
    if (!decoded.type) {
      return res.status(400).json({
        valid: false,
        message: "Token invalide : rôle manquant",
      });
    }

    let result = null;

    // ----------------------------------------------------------------------
    // 🔎 CAS 1 : ROLE = AGENCE
    // ----------------------------------------------------------------------
    if (decoded.type === "agence") {
      result = await Agence.findById(decoded.agenceId).select(
        "nom_commercial admin.email statut logo"
      );

      if (!result) {
        return res.status(404).json({ valid: false, message: "Agence introuvable" });
      }

      if (["bloqué", "suspendu", "en_attente"].includes(result.statut)) {
        return res.status(403).json({
          valid: false,
          message: "Votre compte agence est inactif. Contactez le support.",
        });
      }

      return res.json({
        valid: true,
        role: "agence",
        agence: {
          id: result._id,
          nom_commercial: result.nom_commercial,
          email: result.admin.email,
          statut: result.statut,
          logo: result.logo,
        },
      });
    }

    // ----------------------------------------------------------------------
    // 🔎 CAS 2 : ROLE = EMPLOYE
    // ----------------------------------------------------------------------
    if (decoded.type === "employe") {
      result = await Employe.findById(decoded.employeId)
        .select("nom prenom email statut role agenceId");

      if (!result) {
        return res.status(404).json({ valid: false, message: "Employé introuvable" });
      }

      if (["bloqué", "suspendu"].includes(result.statut)) {
        return res.status(403).json({
          valid: false,
          message: "Votre compte employé est inactif. Contactez l'administrateur.",
        });
      }

      return res.json({
        valid: true,
        role: "employe",
        employe: {
          id: result._id,
          nom: result.nom,
          prenom: result.prenom,
          email: result.email,
          statut: result.statut,
          role: result.role,
          agenceId: result.agenceId,
        },
      });
    }

    // ----------------------------------------------------------------------
    // RÔLE NON GÉRÉ
    // ----------------------------------------------------------------------
    return res.status(400).json({
      valid: false,
      message: "Rôle non reconnu dans le token",
    });

  } catch (error) {
    console.error("❌ Erreur lors de la vérification du token :", error);
    return res.status(401).json({ valid: false, message: "Token invalide ou expiré" });
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

    // ✅ Envoi d'un e-mail interne pour prévenir Dimotec
await sendEmail({
  to: "dimotec34@gmail.com",
  subject: "🆕 Une nouvelle agence souhaite rejoindre le réseau Dimotec",
  template: "NouvelleAgenceAdmin.html", // à créer (ou remplacer par texte brut si tu veux)
  variables: {
    nomResponsable: nom_responsable,
    nomCommercial: nom_commercial,
    emailConnexion: email_connexion,
    telephone: telephone_portable,
    adresse,
    siret: siret,
    caEstime: ca_estime,
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
// ✅ Récupération complète des infos agence OU employé connecté
exports.getInfosAgence = async (req, res) => {
  try {
    // --- 👤 SI EMPLOYÉ : renvoyer les données de l'employé ---
    if (req.role === "employe") {
      const employe = await Employe.findById(req.user._id)
        .select("-mot_de_passe -__v");

      if (!employe) {
        return res.status(404).json({ message: "Employé introuvable." });
      }

      return res.status(200).json({
        message: "✅ Informations de l'employé récupérées avec succès",
        type: "employe",
        employe
      });
    }

    // --- 🏢 SI AGENCE (ou admin) ---
    const agenceId =
      req.agence?._id ||
      req.user?.agenceId ||
      req.params.id;

    if (!agenceId) {
      return res.status(400).json({ message: "Aucun identifiant d'agence fourni." });
    }

    const agence = await Agence.findById(agenceId)
      .select("-admin.mot_de_passe -__v");

    if (!agence) {
      return res.status(404).json({ message: "Agence introuvable." });
    }

    return res.status(200).json({
      message: "✅ Informations de l'agence récupérées avec succès",
      type: "agence",
      agence
    });

  } catch (error) {
    console.error("❌ Erreur lors de la récupération des infos agence/employé :", error);
    return res.status(500).json({ message: "Erreur serveur lors de la récupération des informations." });
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
      "reduction",
      "type_cagnotte" // ✅ Autorisé à la mise à jour
    ];

    const updates = {};
    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        updates[field] = req.body[field];
      }
    }

    // 🔎 Vérifie que le type de cagnotte est valide
    if (updates.type_cagnotte && !["partagee", "individuelle"].includes(updates.type_cagnotte)) {
      return res.status(400).json({
        message: "Le type de cagnotte doit être soit 'partagee' soit 'individuelle'."
      });
    }


    // 🔹 Récupère l’agence avant mise à jour pour comparer l’ancien type
    const oldAgence = await Agence.findById(agenceId);
    if (!oldAgence) {
      return res.status(404).json({ message: "Agence introuvable." });
    }

    const updatedAgence = await Agence.findByIdAndUpdate(
      agenceId,
      { $set: updates },
      { new: true, runValidators: true, select: "-admin.mot_de_passe -__v" }
    );

    // 🧩 Si le type de cagnotte a changé, adapter le système
    if (updates.type_cagnotte && updates.type_cagnotte !== oldAgence.type_cagnotte) {
      console.log(`⚙️ Changement du type de cagnotte : ${oldAgence.type_cagnotte} → ${updates.type_cagnotte}`);

      const employes = await Employe.find({ agence: agenceId });

      if (updates.type_cagnotte === "partagee") {
        // 🏦 Fusion des cagnottes individuelles vers la cagnotte de l’agence
        const total = employes.reduce((sum, e) => sum + (e.cagnotte || 0), 0);
        updatedAgence.cagnotte += total;
        await updatedAgence.save();

        // Réinitialise les cagnottes des employés
        for (const e of employes) {
          e.cagnotte = 0;
          e.transactions_cagnotte.push({
            montant: -e.cagnotte,
            type: "ajustement",
            description: "Fusion vers la cagnotte partagée"
          });
          await e.save();
        }

      } else if (updates.type_cagnotte === "individuelle") {
        // 💰 Répartir la cagnotte partagée équitablement
        if (employes.length > 0 && oldAgence.cagnotte > 0) {
          const montantParEmploye = oldAgence.cagnotte / employes.length;

          for (const e of employes) {
            e.cagnotte += montantParEmploye;
            e.transactions_cagnotte.push({
              montant: montantParEmploye,
              type: "ajustement",
              description: "Conversion en cagnottes individuelles"
            });
            await e.save();
          }

          // Vide la cagnotte de l’agence
          updatedAgence.cagnotte = 0;
          await updatedAgence.save();
        }
      }
    }

    res.status(200).json({
      message: "✅ Informations mises à jour avec succès",
      agence: updatedAgence,
    });
  } catch (error) {
    console.error("❌ Erreur lors de la mise à jour des infos agence :", error);
    res.status(500).json({
      message: "Erreur serveur lors de la mise à jour des informations.",
      error: error.message,
    });
  }
};

// ✅ Mise à jour des informations d'un employé connecté (photo URL ou fichier)
exports.updateInfosEmploye = async (req, res) => {
  try {
    console.log("🟢 Début updateInfosEmploye");
    console.log("Req.user :", req.user);
    console.log("Req.body :", req.body);
    console.log("Req.file :", req.file);

    const employeId = req.user?._id;
    if (!employeId) {
      console.log("❌ Aucun identifiant d'employé fourni");
      return res.status(400).json({ message: "Aucun identifiant d'employé fourni." });
    }

    const employe = await Employe.findById(employeId);
    if (!employe) {
      console.log("❌ Employé introuvable pour l'ID :", employeId);
      return res.status(404).json({ message: "Employé introuvable." });
    }

    // 🔹 Champs autorisés
    const allowedFields = ["nom", "prenom", "email", "telephone_portable", "statut"];
    const updates = {};

    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        updates[field] = req.body[field];
        console.log(`🔹 Mise à jour du champ ${field} :`, req.body[field]);
      }
    }

    // 🔹 Photo de profil : fichier ou URL
    if (req.file) {
      updates.photo_profil = `/uploads/${req.file.filename}`; 
      console.log("📸 Photo envoyée en fichier :", updates.photo_profil);
    } else if (req.body.photo_profil !== undefined) {
      updates.photo_profil = req.body.photo_profil; // lien direct
      console.log("📸 Photo via URL :", updates.photo_profil);
    }

    // 🔹 Mot de passe (optionnel)
    if (req.body.mot_de_passe) {
      employe.mot_de_passe = req.body.mot_de_passe;
      console.log("🔑 Mot de passe mis à jour");
    }

    console.log("🛠 Application des mises à jour :", updates);
    Object.assign(employe, updates);
    await employe.save();
    console.log("✅ Employé mis à jour :", employe);

    const result = employe.toObject();
    delete result.mot_de_passe;
    delete result.__v;

    res.status(200).json({
      message: "✅ Informations de l'employé mises à jour avec succès",
      employe: result
    });

  } catch (error) {
    console.error("❌ Erreur lors de la mise à jour des infos employé :", error);
    res.status(500).json({
      message: "Erreur serveur lors de la mise à jour des informations.",
      error: error.message
    });
  }
};





// ✅ Récupération de la cagnotte, réduction, email, téléphone et CA estimé
exports.getCagnotteEtReduction = async (req, res) => {
  try {
    let role;
    let agence = null;
    let user = null;

    // Identification du rôle
    if (req.user.role === "admin") {
      role = "admin";
      agence = await Agence.findOne().select(
        "nom_commercial cagnotte cagnotteEnAttente reduction telephone_fixe emails_contact ca_estime alerte_secteur type_cagnotte historiqueCagnotte"
      );
      if (!agence) return res.status(404).json({ message: "Aucune agence trouvée." });

    } else if (req.role === "agence") {
      role = "agence";
      agence = req.agence;

    } else if (req.role === "employe") {
      role = "employe";
      user = req.user;
      agence = req.agence;
      if (!agence)
        return res.status(404).json({ message: "Agence liée à l'employé introuvable." });

    } else {
      return res.status(401).json({ message: "Utilisateur non authentifié." });
    }

    // Emails normalisés
    const emails = agence?.emails_contact?.map(e => ({
      type: e.type,
      email: e.email
    })) || [];

    // Secteur
    const secteur = (agence?.alerte_secteur || "autre")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();

    // --- 🏦 Cagnotte Entreprise ---
    const cagnotteEntreprise = agence?.cagnotte || 0;
    const cagnotteEntrepriseEnAttente = agence?.cagnotteEnAttente || 0;

    // --- 👤 Cagnotte Employé (toujours renvoyée) ---
    const cagnotteEmploye = user?.cagnotte || 0;
    const cagnotteEmployeEnAttente = user?.cagnotteEnAttente || 0;

    // --- 📜 Historique unifié selon le rôle ---
    const historique =
      role === "employe"
        ? user?.transactions_cagnotte || []
        : agence?.historiqueCagnotte || [];

    return res.status(200).json({
      message: "Informations récupérées avec succès",
      role,
      agence: agence?.nom_commercial || null,
      telephone: agence?.telephone_fixe || null,
      emails,
      ca_estime: agence?.ca_estime || 0,
      secteur,
      reduction: agence?.reduction || 0,
      type_cagnotte: agence?.type_cagnotte || null,

      // 🏦 Cagnotte entreprise
      cagnotteEntreprise,
      cagnotteEntrepriseEnAttente,

      // 👤 Cagnotte employé
      cagnotteEmploye,
      cagnotteEmployeEnAttente,

      // 📜 Historique unifié
      historique
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
    const { typeBien, typeOperation, annee, surface, installationGaz, copropriete } = req.body;
    console.log("💡 Requête reçue :", req.body);

    if (!typeBien || !typeOperation || !annee || !surface) {
      return res.status(400).json({ message: "Type de bien, type d'opération, année et surface sont requis." });
    }

    // --- Normalisation d'un string ---
    const normalizeString = (str) =>
      str?.toString().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim();

    // Normalisation du typeBien et typeOperation
    const typeBienNorm = normalizeString(typeBien);
    const typeOperationNorm = normalizeString(typeOperation);

    // Secteur
    let secteur = req.body.secteur;
    if (!secteur || secteur.trim() === "") {
      const agence = req.agence;
      secteur = agence?.alerte_secteur || "autre";
    }
    secteur = normalizeString(secteur);
    console.log("🔹 Secteur final utilisé :", secteur);

    const tranche = annee;

    // --- Surface ou type appartement ---
    let surfaceMinDemande = 0;
    let surfaceMaxDemande = 0;
    let typeAppartement = null;

    if (typeBienNorm === "maison" || typeBienNorm === "terrain" || typeBienNorm === "mur" || typeBienNorm === "autre") {
      if (surface.includes("-")) {
        const match = surface.match(/(\d+)-(\d+)/);
        surfaceMinDemande = match ? parseInt(match[1], 10) : 0;
        surfaceMaxDemande = match ? parseInt(match[2], 10) : surfaceMinDemande;
      } else {
        const valeur = parseInt(surface, 10);
        surfaceMinDemande = valeur;
        surfaceMaxDemande = valeur;
      }
      console.log(`🏠 Surface : surfaceMin=${surfaceMinDemande}, surfaceMax=${surfaceMaxDemande}`);
    } else if (typeBienNorm === "appartement") {
      const mappingAppartement = {
        "moins 20m²": "<20m2",
        "20-40m²": "20-40m2",
        "T1": "T1",
        "T2": "T2",
        "T3": "T3",
        "T4": "T4",
        "T5": "T5"
      };
      typeAppartement = mappingAppartement[surface.toLowerCase()] || surface;
      console.log(`🏢 Appartement : typeAppartement=${typeAppartement}`);
    }

    // --- Récupération des packs ---
    const allPacks = await Pack.find({
      typeBien: { $exists: true }
    }).populate("diagnostics");

    // --- Filtrage packs ---
    const packs = allPacks.filter(pack => {
      const packTypeBienNorm = normalizeString(pack.typeBien);
      const packTypeOperationNorm = normalizeString(pack.typeOperation);
      const trancheMatch = pack.trancheAnnee?.map(normalizeString).includes(normalizeString(tranche)) ||
                           pack.trancheAnnee?.includes("toutes");

      return packTypeBienNorm === typeBienNorm && packTypeOperationNorm === typeOperationNorm && trancheMatch;
    });

    console.log("📦 Packs trouvés :", packs.length);

    if (!packs.length) {
      return res.status(404).json({ message: "Aucun pack trouvé pour ces critères." });
    }

    // --- Ajout du tarif pack ---
    const packsAvecTarif = packs.map(pack => {
      let tarifTrouve = null;

      if (typeBienNorm !== "appartement" && pack.tarifsParSurface?.length) {
        for (let tps of pack.tarifsParSurface) {
          if (!(surfaceMaxDemande < tps.surfaceMin || surfaceMinDemande > tps.surfaceMax)) {
            tarifTrouve = tps.tarifs?.[secteur] ?? tps.tarifs?.autre ?? null;
            break;
          }
        }
      } else if (typeBienNorm === "appartement" && pack.tarifsParAppartement?.length) {
        const tarifObj = pack.tarifsParAppartement.find(t => normalizeString(t.typeAppartement) === normalizeString(typeAppartement));
        if (tarifObj) {
          tarifTrouve = tarifObj.tarifs?.[secteur] ?? tarifObj.tarifs?.autre ?? null;
        }
      }

      return {
        ...pack.toObject(),
        tarifPourSurface: tarifTrouve
      };
    });

    // --- Diagnostics ---
    const allDiagnostics = await Diagnostic.find({}, { nom: 1 });

    // --- Diagnostics Gaz et Copropriété ---
    const diagnosticGazTarif = installationGaz
      ? await computeDiagnosticTarif("gaz", typeBienNorm, surfaceMinDemande, surfaceMaxDemande, typeAppartement, secteur)
      : null;

    const diagnosticCoproTarif = copropriete && typeBienNorm !== "appartement"
      ? await computeDiagnosticTarif("surface", typeBienNorm, surfaceMinDemande, surfaceMaxDemande, typeAppartement, secteur)
      : null;

    // --- Réponse ---
    res.json({
      packs: packsAvecTarif,
      diagnostics: allDiagnostics,
      diagnosticGazTarif,
      diagnosticCoproTarif,
      tranche,
      surfaceMinDemande,
      surfaceMaxDemande,
      typeAppartement
    });

  } catch (error) {
    console.error("❌ Erreur filterPacks :", error);
    res.status(500).json({ message: "Erreur serveur lors de la récupération des packs." });
  }
};

// --- Helper pour récupérer un tarif diagnostic ---
async function computeDiagnosticTarif(nomDiag, typeBienNorm, surfaceMin, surfaceMax, typeAppartement, secteur) {
  const diag = await Diagnostic.findOne({ nom: { $regex: nomDiag, $options: "i" } });
  if (!diag) return null;

  let tarif = null;
  if (typeBienNorm !== "appartement" && diag.tarifsParSurface?.length) {
    for (let tps of diag.tarifsParSurface) {
      if (!(surfaceMax < tps.surfaceMin || surfaceMin > tps.surfaceMax)) {
        tarif = tps.tarifs?.[secteur] ?? tps.tarifs?.autre ?? null;
        break;
      }
    }
  } else if (typeBienNorm === "appartement" && diag.tarifsParAppartement?.length) {
    const tps = diag.tarifsParAppartement.find(t => normalizeString(t.typeAppartement) === normalizeString(typeAppartement));
    if (tps) tarif = tps.tarifs?.[secteur] ?? tps.tarifs?.autre ?? null;
  }
  return tarif;
}








/**
 * Récupère les diagnostics à la carte correspondant aux infos envoyées
 * POST /api/agency/diagnostics/filter
 * Body: { typeBien, typeOperation, annee, surface }
 */
exports.filterDiagnostics = async (req, res) => {
  try {
    const { typeBien, typeOperation, annee, surface } = req.body;
    console.log("💡 Requête reçue :", req.body);

    if (!typeBien || !typeOperation || !annee || !surface) {
      return res.status(400).json({
        message: "Type de bien, type d'opération, année et surface sont requis."
      });
    }

    // --- Normalisation d'un string ---
    const normalizeString = (str) =>
      str?.toString().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim();

    // Normalisation des inputs
    const typeBienNorm = normalizeString(typeBien);
    const typeOperationNorm = normalizeString(typeOperation);
    let secteur = normalizeString(req.body.secteur || req.agence?.alerte_secteur || "autre");

    // --- Surface ou type appartement ---
    let surfaceMinDemande = 0;
    let surfaceMaxDemande = 0;
    let typeAppartement = null;

    if (typeBienNorm !== "appartement") {
      if (surface.includes("-")) {
        const match = surface.match(/(\d+)-(\d+)/);
        surfaceMinDemande = match ? parseInt(match[1], 10) : 0;
        surfaceMaxDemande = match ? parseInt(match[2], 10) : surfaceMinDemande;
      } else {
        const valeur = parseInt(surface, 10);
        surfaceMinDemande = valeur;
        surfaceMaxDemande = valeur;
      }
      console.log(`🏠 Surface : ${surfaceMinDemande}-${surfaceMaxDemande} m²`);
    } else {
      const mappingAppartement = {
        "moins 20m²": "<20m2",
        "20-40m²": "20-40m2",
        "T1": "T1",
        "T2": "T2",
        "T3": "T3",
        "T4": "T4",
        "T5": "T5"
      };
      typeAppartement = mappingAppartement[normalizeString(surface)] || surface;
      console.log(`🏢 Appartement type : ${typeAppartement}`);
    }

    // --- Récupération diagnostics ---
    const allDiagnostics = await Diagnostic.find({ trancheAnnee: { $in: [annee] } });

    // --- Filtrage par typeBien et typeOperation avec normalisation ---
    const diagnostics = allDiagnostics.filter(diag => {
      const diagTypeBien = normalizeString(diag.typeBien || diag.typeBienLibre);
      const diagTypeOp = normalizeString(diag.typeOperation);
      return diagTypeBien === typeBienNorm && diagTypeOp === typeOperationNorm;
    });

    if (!diagnostics.length) {
      return res.status(404).json({ message: "Aucun diagnostic trouvé pour ces critères." });
    }

    console.log(`🔎 Diagnostics trouvés : ${diagnostics.length}`);

    // --- Ajout des tarifs ---
    const diagnosticsAvecTarif = diagnostics.map(diag => {
      let tarifTrouve = null;

      if (typeBienNorm !== "appartement" && diag.tarifsParSurface?.length) {
        for (const tps of diag.tarifsParSurface) {
          if (!(surfaceMaxDemande < tps.surfaceMin || surfaceMinDemande > tps.surfaceMax)) {
            tarifTrouve = tps.tarifs?.[secteur] ?? tps.tarifs?.autre ?? 0;
            break;
          }
        }
      }

      if (typeBienNorm === "appartement" && diag.tarifsParAppartement?.length && typeAppartement) {
        const tarifObj = diag.tarifsParAppartement.find(
          t => normalizeString(t.typeAppartement) === normalizeString(typeAppartement)
        );
        if (tarifObj) {
          tarifTrouve = tarifObj.tarifs?.[secteur] ?? tarifObj.tarifs?.autre ?? 0;
        }
      }

      return {
        ...diag.toObject(),
        tarifPourSurface: tarifTrouve
      };
    });

    console.log("💰 Diagnostics avec tarif :", diagnosticsAvecTarif.map(d => ({ nom: d.nom, tarifPourSurface: d.tarifPourSurface , id : d._id })));

    res.json({
      diagnostics: diagnosticsAvecTarif,
      surfaceMinDemande,
      surfaceMaxDemande,
      typeAppartement,
      tranche: annee
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
    const { typeBien, typeAppartement } = req.body;

    if (!typeBien) {
      return res.status(400).json({ message: "Le type de bien est requis." });
    }

    // ⚡ Normalisation fonction
    const normalizeString = (str) =>
      str?.toString().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim();

    const typeBienNorm = normalizeString(typeBien);

    // Utilise d'abord le secteur envoyé dans req.body
    let secteur = normalizeString(req.body.secteur || req.agence?.alerte_secteur || "autre");

    console.log("🔹 Type de bien demandé :", typeBienNorm);
    console.log("🔹 Secteur de l'agence :", secteur);

    // --- Récupération des suppléments ---
    const allSupplements = await Supplement.find({
      $or: [
        { typeBienApplicable: { $exists: true, $ne: [], $in: [typeBienNorm] } },
        { typeBien: { $exists: true, $ne: "", $eq: typeBienNorm } },
        { typeBienLibre: { $exists: true, $ne: "", $eq: typeBienNorm } } // Champs libre
      ]
    });

    if (!allSupplements.length) {
      return res.status(404).json({ message: "Aucun supplément trouvé pour ce type de bien." });
    }

    // Supprimer les doublons
    const supplementsUnik = [];
    const idsVus = new Set();
    allSupplements.forEach(s => {
      if (!idsVus.has(s._id.toString())) {
        idsVus.add(s._id.toString());
        supplementsUnik.push(s);
      }
    });

    // --- Ajout du tarif selon le secteur et typeAppartement ---
    const supplementsAvecTarif = supplementsUnik.map(s => {
      let tarifTrouve = 0;

      if (s.tarifsParAppartement?.length && typeBienNorm === "appartement" && typeAppartement) {
        const typeAppNorm = normalizeString(typeAppartement);
        const tarifObj = s.tarifsParAppartement.find(t => normalizeString(t.typeAppartement) === typeAppNorm);
        if (tarifObj) {
          tarifTrouve = tarifObj.tarifs?.[secteur] ?? tarifObj.tarifs?.autre ?? 0;
        }
      } else if (s.tarifsParSurface?.length && typeBienNorm !== "appartement") {
        // Tous les types autres qu'appartement utilisent tarifsParSurface
        tarifTrouve = s.tarifsParSurface[0]?.tarifs?.[secteur] ?? s.tarifsParSurface[0]?.tarifs?.autre ?? 0;
      } else if (s.tarifs) {
        // fallback
        tarifTrouve = s.tarifs?.[secteur] ?? s.tarifs?.autre ?? 0;
      }

      return {
        ...s.toObject(),
        tarifPourSecteur: tarifTrouve
      };
    });

    console.log(`✅ ${supplementsAvecTarif.length} supplément(s) trouvé(s) pour ${typeBienNorm}`);
    res.json({ supplements: supplementsAvecTarif });

  } catch (error) {
    console.error("❌ Erreur filterSupplementsByTypeBien :", error);
    res.status(500).json({ message: "Erreur serveur lors du filtrage des suppléments." });
  }
};

/**
 * 📦 Retourne tous les types de bien distincts présents dans diagnostics et packs
 */
exports.getAllTypeBiens = async (req, res) => {
  try {
    // ⚡ Fonction de normalisation
    const normalizeString = (str) =>
      str?.toString().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim();

    // --- Récupération diagnostics ---
    const diagnostics = await Diagnostic.find({}, { typeBien: 1, typeBienLibre: 1 }).lean();
    const packs = await Pack.find({}, { typeBien: 1, typeBienLibre: 1 }).lean();

    const allTypesSet = new Set();

    const processItem = (item) => {
      if (item.typeBien) allTypesSet.add(normalizeString(item.typeBien));
      if (item.typeBienLibre) allTypesSet.add(normalizeString(item.typeBienLibre));
    };

    diagnostics.forEach(processItem);
    packs.forEach(processItem);

    const typeBiens = Array.from(allTypesSet).sort();

    res.json({ typeBiens });
  } catch (error) {
    console.error("❌ Erreur getAllTypeBiens :", error);
    res.status(500).json({ message: "Erreur serveur lors de la récupération des types de bien." });
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

    let user = null;
    let type = null;

    // 🔹 Cherche dans Agence
    const agence = await Agence.findOne({
      $or: [{ 'admin.email': email }, { 'emails_contact.email': email }]
    });
    if (agence) {
      user = agence;
      type = 'agence';
    }

    // 🔹 Cherche dans Employe si non trouvé
    if (!user) {
      const employe = await Employe.findOne({ email });
      if (employe) {
        user = employe;
        type = 'employe';
      }
    }

    if (!user) {
      return res.status(404).json({ message: "Aucun compte trouvé avec cet email." });
    }

    // 🔹 Génération du token
    const resetToken = crypto.randomBytes(32).toString('hex');
    const resetTokenHash = crypto.createHash('sha256').update(resetToken).digest('hex');
    const expires = Date.now() + 60 * 60 * 1000; // 1h

    // 🔹 Stockage temporaire selon type
    if (type === 'agence') {
      user.admin.resetPasswordToken = resetTokenHash;
      user.admin.resetPasswordExpires = expires;
    } else {
      user.resetPasswordToken = resetTokenHash;
      user.resetPasswordExpires = expires;
    }

    await user.save();

    // 🔹 Lien de réinitialisation
    const resetUrl = `https://client-dimotec.datafuse.fr/reset-password/${resetToken}`;

    // 🔹 Envoi de l'email
    await sendEmail({
      to: email,
      subject: "Réinitialisation de votre mot de passe",
      template: "ResetPassword.html",
      variables: {
        nomClient: type === 'agence' ? user.admin.nom : user.nom,
        lienReinitialisation: resetUrl
      }
    });

    res.json({ message: "Un e-mail de réinitialisation a été envoyé." });
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
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    // 🔹 Cherche dans Agence
    let user = await Agence.findOne({
      'admin.resetPasswordToken': tokenHash,
      'admin.resetPasswordExpires': { $gt: Date.now() }
    });

    let type = 'agence';

    // 🔹 Sinon cherche dans Employe
    if (!user) {
      user = await Employe.findOne({
        resetPasswordToken: tokenHash,
        resetPasswordExpires: { $gt: Date.now() }
      });
      type = 'employe';
    }

    if (!user) {
      return res.status(400).json({ message: "Token invalide ou expiré." });
    }

    res.json({ message: "Token valide.", email: type === 'agence' ? user.admin.email : user.email });
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
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    // 🔹 Cherche dans Agence
    let user = await Agence.findOne({
      'admin.resetPasswordToken': tokenHash,
      'admin.resetPasswordExpires': { $gt: Date.now() }
    });
    let type = 'agence';

    // 🔹 Sinon cherche dans Employe
    if (!user) {
      user = await Employe.findOne({
        resetPasswordToken: tokenHash,
        resetPasswordExpires: { $gt: Date.now() }
      });
      type = 'employe';
    }

    if (!user) {
      return res.status(400).json({ message: "Token invalide ou expiré." });
    }

    // 🔹 Mise à jour du mot de passe
    if (type === 'agence') {
      user.admin.mot_de_passe = mot_de_passe;
      user.admin.resetPasswordToken = undefined;
      user.admin.resetPasswordExpires = undefined;
    } else {
      user.mot_de_passe = mot_de_passe;
      user.resetPasswordToken = undefined;
      user.resetPasswordExpires = undefined;
    }

    await user.save();

    // Envoi email de confirmation
    await sendEmail({
      to: type === 'agence' ? user.admin.email : user.email,
      subject: "Votre mot de passe a été modifié",
      template: "PasswordChanged.html",
      variables: {
        nomClient: type === 'agence' ? user.admin.nom : user.nom
      }
    });

    res.json({ message: "Mot de passe réinitialisé avec succès." });
  } catch (error) {
    console.error("❌ Erreur resetPassword :", error);
    res.status(500).json({ message: "Erreur serveur lors de la réinitialisation du mot de passe." });
  }
};




// ------------------------ EMPLOYE ------------------------------- //

exports.addEmploye = async (req, res) => {
  try {
    const agenceId = req.agence._id; // agence connectée
    const { nom, prenom, email, mot_de_passe, telephone_portable } = req.body;

    if (!nom || !prenom || !email) {
      return res.status(400).json({ message: "Nom, prénom et email sont obligatoires." });
    }

    // Vérifie si email déjà utilisé
    const existing = await Employe.findOne({ email });
    if (existing) return res.status(400).json({ message: "Un employé avec cet email existe déjà." });

    // Génération automatique du mot de passe si non fourni
    const password = mot_de_passe || Math.random().toString(36).slice(-8); // ex: '4f7a9c2b'

    const employe = new Employe({
      agence: agenceId,
      nom,
      prenom,
      email,
      mot_de_passe: password,
      telephone_portable
    });

    await employe.save();

    // ✅ Envoi de l'e-mail avec les identifiants
    const loginUrl = `https://client-dimotec.datafuse.fr/login`; // lien vers la page de connexion

    await sendEmail({
      to: email,
      subject: "Bienvenue dans votre espace Dimotec 👋",
      template: "WelcomeEmploye.html", // ton template HTML pour l'employé
      variables: {
        nom,
        prenom,
        email,
        motDePasse: password,
        loginUrl
      }
    });

    res.status(201).json({
      message: "✅ Employé ajouté avec succès et e-mail envoyé",
      employe
    });

  } catch (error) {
    console.error("❌ Erreur addEmploye :", error);
    res.status(500).json({ message: "Erreur serveur lors de l'ajout de l'employé." });
  }
};




exports.updateEmploye = async (req, res) => {
  try {
    const agenceId = req.agence._id;
    const { employeId } = req.params;

    const fieldsAllowed = ["nom", "prenom", "email", "telephone_portable", "statut", "photo_profil"];
    const updates = {};

    fieldsAllowed.forEach(field => {
      if (req.body[field] !== undefined) updates[field] = req.body[field];
    });

    const employe = await Employe.findOneAndUpdate(
      { _id: employeId, agence: agenceId },
      { $set: updates },
      { new: true }
    ).select("-mot_de_passe");

    if (!employe) return res.status(404).json({ message: "Employé introuvable." });

    res.json({
      message: "✅ Employé modifié avec succès",
      employe
    });

  } catch (error) {
    console.error("❌ Erreur updateEmploye :", error);
    res.status(500).json({ message: "Erreur serveur lors de la modification de l'employé." });
  }
};


exports.deleteEmploye = async (req, res) => {
  try {
    const agenceId = req.agence._id;
    const { employeId } = req.params;

    const employe = await Employe.findOneAndDelete({ _id: employeId, agence: agenceId });

    if (!employe) return res.status(404).json({ message: "Employé introuvable ou ne vous appartient pas." });

    res.json({ message: "🗑 Employé supprimé avec succès" });

  } catch (error) {
    console.error("❌ Erreur deleteEmploye :", error);
    res.status(500).json({ message: "Erreur serveur lors de la suppression de l'employé." });
  }
};


// Récupérer tous les employés d'une agence
exports.getEmployes = async (req, res) => {
  try {
    const agenceId = req.agence._id;

    const employes = await Employe.find({ agence: agenceId }).select('-mot_de_passe');

    res.status(200).json({
      message: "✅ Employés récupérés avec succès",
      employes
    });
  } catch (error) {
    console.error("❌ Erreur getEmployes :", error);
    res.status(500).json({ message: "Erreur serveur lors de la récupération des employés." });
  }
};