// controllers/adminController.js
const Admin = require('../models/Admin');
const Client = require('../models/Client'); // ← Important
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const Agence = require('../models/Agency');
const Configuration = require('../models/Configuration');
const crypto = require('crypto'); // pour générer un mot de passe aléatoire
// Secret JWT (à mettre dans .env)
const JWT_SECRET = process.env.JWT_SECRET || 'tonSecretIci';
const JWT_EXPIRES_IN = '7d'; // durée du token
const Diagnostic = require("../models/Diagnostic");
const Pack = require("../models/Pack");
const Supplement = require("../models/Supplement");
const sendEmail = require('../utils/sendEmails');

/**
 * REGISTER ADMIN
 */
exports.register = async (req, res) => {
  try {
    const { nom, prenom, email, telephone, mot_de_passe, entreprise } = req.body;

    // Vérifier si admin existe déjà
    const existingAdmin = await Admin.findOne({ email });
    if (existingAdmin) return res.status(400).json({ message: 'Email déjà utilisé.' });

    // Hash du mot de passe
    const hashedPassword = await bcrypt.hash(mot_de_passe, 10);

    const newAdmin = new Admin({
      nom,
      prenom,
      email,
      telephone,
      entreprise,
      mot_de_passe: hashedPassword
    });

    await newAdmin.save();
    res.status(201).json({ message: 'Admin créé avec succès.' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Erreur serveur.' });
  }
};

/**
 * LOGIN ADMIN
 */
exports.login = async (req, res) => {
  try {
    const { email, mot_de_passe } = req.body;

    const admin = await Admin.findOne({ email });
    if (!admin) return res.status(400).json({ message: 'Email ou mot de passe incorrect.' });

    const isMatch = await bcrypt.compare(mot_de_passe, admin.mot_de_passe);
    if (!isMatch) return res.status(400).json({ message: 'Email ou mot de passe incorrect.' });

    // Générer JWT
    const token = jwt.sign(
      { id: admin._id, email: admin.email, role: admin.role },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );

    res.json({ token, admin: { id: admin._id, nom: admin.nom, prenom: admin.prenom, email: admin.email } });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Erreur serveur.' });
  }
};

/**
 * VERIFY TOKEN
 */
exports.verifyToken = async (req, res) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ valid: false, message: "Token manquant" });
    }

    const token = authHeader.split(" ")[1];
    const decoded = jwt.verify(token, JWT_SECRET);

    // Tu peux aussi vérifier que l’admin existe toujours :
    const admin = await Admin.findById(decoded.id);
    if (!admin) {
      return res.status(401).json({ valid: false, message: "Utilisateur introuvable" });
    }

    res.status(200).json({
      valid: true,
      admin: {
        id: admin._id,
        nom: admin.nom,
        prenom: admin.prenom,
        email: admin.email,
        role: admin.role
      }
    });
  } catch (error) {
    console.error("❌ Erreur de vérification du token :", error.message);
    res.status(401).json({ valid: false, message: "Token invalide ou expiré" });
  }
};



/**
 * GET ADMIN DETAILS
 */
exports.getAdminDetails = async (req, res) => {
  try {
    const adminId = req.admin.id;

    // Récupère l'admin et populate l'agence si c'est un ObjectId
    let admin = await Admin.findById(adminId)
      .populate({ path: 'entreprise', model: 'Agence' })
      .lean();

    if (!admin) return res.status(404).json({ message: 'Admin non trouvé.' });

    // Détermine l'agence
    const agence = admin.entreprise
      ? typeof admin.entreprise === 'object' && admin.entreprise._id
        ? admin.entreprise // populated object
        : admin.entreprise // déjà objet complet
      : null;

    // Récupère configuration, diagnostics, packs et suppléments
    const configuration = await Configuration.findOne({ adminId }).lean();
    const diagnostics = await Diagnostic.find({ adminId }).lean();
    const packs = await Pack.find({ adminId }).lean();
    const supplements = await Supplement.find({ adminId }).lean();
    const clients = await Client.find({ adminId }).lean();

    res.json({
      admin: {
        ...admin,
        entreprise: undefined, // supprime le champ original pour éviter doublon
      },
      agence,
      configuration,
      diagnostics,
      packs,
      supplements,
      clients
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Erreur serveur.' });
  }
};




/**
 * MODIFIER INFOS ADMIN
 */
exports.updateAdmin = async (req, res) => {
  try {
    // Récupère l'ID de l'admin depuis le token
    const adminId = req.admin.id;

    let admin = await Admin.findById(adminId).populate({ path: 'entreprise', model: 'Agence' });
    if (!admin) return res.status(404).json({ message: 'Admin non trouvé.' });

    const { nom, prenom, email, telephone, entreprise } = req.body;

    if (nom) admin.nom = nom;
    if (prenom) admin.prenom = prenom;
    if (email) admin.email = email;
    if (telephone) admin.telephone = telephone;

    // Gérer le champ entreprise : peut être un ID ou un objet complet
    if (entreprise) {
      if (typeof entreprise === 'string' && entreprise.match(/^[0-9a-fA-F]{24}$/)) {
        // Si c'est un ObjectId valide
        admin.entreprise = entreprise;
      } else if (typeof entreprise === 'object' && entreprise._id) {
        // Si c'est un objet complet
        admin.entreprise = entreprise._id;
      } else {
        return res.status(400).json({ message: 'Le champ entreprise est invalide.' });
      }
    }

    await admin.save();

    // Re-populate pour renvoyer l'objet agence complet
    admin = await Admin.findById(adminId).populate({ path: 'entreprise', model: 'Agence' }).lean();

    res.json({ message: 'Infos admin mises à jour avec succès.', admin });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Erreur serveur.' });
  }
};



/**
 * CREER UNE AGENCE
 */
exports.createAgence = async (req, res) => {
  try {
    const { nom, representant, email, telephone } = req.body;

    // Vérifier si une agence avec cet email existe déjà
    const existingAgence = await Agence.findOne({ email });
    if (existingAgence) return res.status(400).json({ message: 'Une agence avec cet email existe déjà.' });

    // Générer un mot de passe aléatoire pour l'admin
    const randomPassword = crypto.randomBytes(6).toString('hex'); // 12 caractères hexadécimaux

    // Créer l'agence avec l'admin par défaut
    const newAgence = new Agence({
      nom,
      representant,
      email,
      telephone,
      admin: {
        nom: representant,
        prenom: 'Admin',
        email,
        mot_de_passe: randomPassword
      },
      clients: [],
      devis: []
    });

    await newAgence.save();

    res.status(201).json({
      message: 'Agence créée avec succès.',
      agence: newAgence,
      adminPassword: randomPassword // à retourner pour que l'admin sache le mdp initial
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Erreur serveur lors de la création de l’agence.' });
  }
};


/**
 * RECUPERER TOUTES LES AGENCES
 */
exports.getAllAgences = async (req, res) => {
  try {
    const agences = await Agence.find();

    const result = agences.map((agence) => ({
      id: agence._id,
      nom_commercial: agence.nom_commercial,
      nom_responsable: agence.nom_responsable,
      adresse: agence.adresse,
      siret: agence.siret,
      telephone_fixe: agence.telephone_fixe || '',
      telephone_portable: agence.admin.telephone_portable || '',
      emails_contact: agence.emails_contact || [], // ✅ on garde le tableau existant
      activite: agence.activite || '',
      domaine_intervention: agence.domaine_intervention || [],
      alerte_secteur: agence.alerte_secteur || '',
      statut: agence.statut || 'en_attente',
      admin: {
        nom: agence.admin?.nom || '',
        prenom: agence.admin?.prenom || '',
        email: agence.admin?.email || '',
        role: agence.admin?.role || ''
      },
      nombreDevis: agence.nombreDevis || 0,
      tauxAcceptation: agence.tauxAcceptation || 0,
      CA: agence.CA || 0,
      clients: agence.clients || [],
      devis: agence.devis || [],
      ca_estime: agence.ca_estime || 0,
      cagnotte: agence.cagnotte || 0,
      reduction: agence.reduction || 0,
      createdAt: agence.createdAt,
      updatedAt: agence.updatedAt
    }));

    res.json(result);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Erreur serveur lors de la récupération des agences." });
  }
};


/**
 * MODIFIER UNE AGENCE
 */
exports.updateAgence = async (req, res) => {
  try {
    const { id } = req.params;

    // On récupère les données du body
    const {
      nom_commercial,
      nom_responsable,
      adresse,
      siret,
      telephone_fixe,
      telephone_portable,
      emails_contact,
      activite,
      domaine_intervention,
      alerte_secteur,
      statut,
      ca_estime,
      cagnotte,
      reduction,
    } = req.body;

    // Vérification que l’agence existe
    const agence = await Agence.findById(id);
    if (!agence) {
      return res.status(404).json({ message: "Agence introuvable" });
    }

    // Sauvegarde du statut précédent pour vérifier le changement
    const statutPrecedent = agence.statut;

    // Mise à jour des champs
    agence.nom_commercial = nom_commercial ?? agence.nom_commercial;
    agence.nom_responsable = nom_responsable ?? agence.nom_responsable;
    agence.adresse = adresse ?? agence.adresse;
    agence.siret = siret ?? agence.siret;
    agence.telephone_fixe = telephone_fixe ?? agence.telephone_fixe;
    agence.telephone_portable = telephone_portable ?? agence.telephone_portable;
    agence.emails_contact = emails_contact ?? agence.emails_contact;
    agence.activite = activite ?? agence.activite;
    agence.domaine_intervention = domaine_intervention
      ? Array.isArray(domaine_intervention)
        ? domaine_intervention
        : [domaine_intervention]
      : agence.domaine_intervention;
    agence.alerte_secteur = alerte_secteur ?? agence.alerte_secteur;
    agence.statut = statut ?? agence.statut;
    agence.ca_estime = ca_estime ?? agence.ca_estime;
    agence.cagnotte = cagnotte ?? agence.cagnotte;
    agence.reduction = reduction ?? agence.reduction;

    await agence.save();

    // ✅ Envoi de l'email si le statut passe à "actif"
    if (statut && statut === "actif" && statutPrecedent !== "actif") {
      const emailConnexion = agence.admin.email;

      await sendEmail({
        to: emailConnexion,
        subject: "Votre compte a été approuvé ✅",
        template: "CompteAgenceApprouve.html", // ton template créé précédemment
        variables: {
          nomResponsable: agence.nom_responsable,
          nomCommercial: agence.nom_commercial,
          emailConnexion: emailConnexion,
          telephone: agence.admin.telephone_portable,
          adresse: agence.adresse,
        }
      });
    }

    res.status(200).json({
      message: "Agence mise à jour avec succès",
      agence,
    });
  } catch (error) {
    console.error("Erreur lors de la mise à jour de l'agence :", error);
    res.status(500).json({ message: "Erreur serveur lors de la mise à jour de l'agence." });
  }
};




/**
 * ➕ Créer un diagnostic
 */
exports.createDiagnostic = async (req, res) => {
  try {
    console.log("📩 [createDiagnostic] Requête reçue !");
    console.log("🧠 Corps de la requête (req.body) :", req.body);

    const { 
      nom, 
      typeBien, 
      typeOperation, 
      trancheAnnee, 
      tarifsParSurface, 
      erpOffert, 
      supplementsDisponibles 
    } = req.body;

    // --- Validation ---
    if (!nom || !typeBien || !typeOperation || !trancheAnnee || !tarifsParSurface?.length) {
      console.warn("⚠️ Champs manquants :", { nom, typeBien, typeOperation, trancheAnnee, tarifsParSurface });
      return res.status(400).json({ message: "Champs obligatoires manquants." });
    }

    console.log("✅ Données validées !");
    console.log("🧾 Détails du diagnostic à créer :", {
      nom,
      typeBien,
      typeOperation,
      trancheAnnee,
      nbTranches: tarifsParSurface.length,
      erpOffert,
      supplementsDisponibles,
    });

    const diagnostic = new Diagnostic({
      nom,
      typeBien,
      typeOperation,
      trancheAnnee,
      tarifsParSurface,
      erpOffert: erpOffert || false,
      supplementsDisponibles: supplementsDisponibles || [],
    });

    console.log("💾 Sauvegarde du diagnostic en base...");
    await diagnostic.save();

    console.log("✅ Diagnostic créé avec succès :", diagnostic);

    res.status(201).json({ message: "Diagnostic créé.", diagnostic });
  } catch (err) {
    console.error("❌ Erreur dans createDiagnostic :", err.message);
    console.error("🧩 Stack :", err.stack);
    res.status(500).json({ message: "Erreur serveur lors de la création du diagnostic." });
  }
};


/**
 * ➕ Créer un supplément
 */
exports.createSupplement = async (req, res) => {
  try {
    console.log("🟢 [createSupplement] Requête reçue :", req.body);

    const { nom, tarifs, typeBien } = req.body; // <-- utiliser le bon nom de champ

    if (!nom || tarifs?.var == null || tarifs?.herault == null) {
      console.warn("⚠️ [createSupplement] Champs obligatoires manquants :", req.body);
      return res.status(400).json({ message: "Nom et tarifs (Var et Hérault) requis." });
    }

    const supplement = new Supplement({
      nom,
      tarifs: {
        var: tarifs.var,
        herault: tarifs.herault,
        autre: tarifs.autre || 0,
      },
      typeBien: typeBien || "maison", // <-- obligatoire, valeur par défaut si nécessaire
    });

    console.log("🟢 [createSupplement] Objet supplement à sauvegarder :", supplement);

    await supplement.save();

    console.log("✅ [createSupplement] Supplément sauvegardé :", supplement);
    res.status(201).json({ message: "Supplément créé.", supplement });
  } catch (err) {
    console.error("❌ [createSupplement] Erreur :", err);
    res.status(500).json({ message: "Erreur serveur lors de la création du supplément." });
  }
};



/**
 * 📥 Récupérer tous les suppléments
 */
exports.getSupplements = async (req, res) => {
  try {
    const supplements = await Supplement.find();
    res.status(200).json(supplements);
  } catch (err) {
    console.error("❌ Erreur getSupplements:", err);
    res.status(500).json({ message: "Erreur serveur lors de la récupération des suppléments." });
  }
};

/**
 * ✏️ Modifier un supplément
 */
exports.updateSupplement = async (req, res) => {
  try {
    const { id } = req.params;
    const { nom, tarifs, typeBienApplicable } = req.body;

    const supplement = await Supplement.findById(id);
    if (!supplement) return res.status(404).json({ message: "Supplément non trouvé." });

    if (nom) supplement.nom = nom;
    if (tarifs) {
      supplement.tarifs.var = tarifs.var ?? supplement.tarifs.var;
      supplement.tarifs.herault = tarifs.herault ?? supplement.tarifs.herault;
      supplement.tarifs.autre = tarifs.autre ?? supplement.tarifs.autre;
    }
    if (typeBienApplicable) supplement.typeBienApplicable = typeBienApplicable;

    await supplement.save();
    res.status(200).json({ message: "Supplément modifié.", supplement });
  } catch (err) {
    console.error("❌ Erreur updateSupplement:", err);
    res.status(500).json({ message: "Erreur serveur lors de la modification du supplément." });
  }
};

/**
 * 🗑️ Supprimer un supplément
 */
exports.deleteSupplement = async (req, res) => {
  try {
    const { id } = req.params;

    const supplement = await Supplement.findById(id);
    if (!supplement) return res.status(404).json({ message: "Supplément non trouvé." });

    await supplement.remove();
    res.status(200).json({ message: "Supplément supprimé." });
  } catch (err) {
    console.error("❌ Erreur deleteSupplement:", err);
    res.status(500).json({ message: "Erreur serveur lors de la suppression du supplément." });
  }
};

/**
 * 📦 Créer un pack avec diagnostics associés
 */
exports.createPack = async (req, res) => {
  try {
    console.log("✏️ [createPack] Requête reçue :", req.body);

    const { nom, typeBien, typeOperation, diagnostics, tarifs, obligatoireDansPacks, erpOffert, supplementsDisponibles } = req.body;

    // Validation des champs obligatoires
    if (!nom || !typeBien || !typeOperation || !tarifs?.var || !tarifs?.herault) {
      console.log("❌ Champs obligatoires manquants :", { nom, typeBien, typeOperation, tarifs });
      return res.status(400).json({ message: "Champs obligatoires manquants." });
    }
    console.log("✅ Champs obligatoires présents");

    // Vérifier que les diagnostics existent
    let validDiagnostics = [];
    if (diagnostics?.length) {
      console.log("🔍 Vérification des diagnostics :", diagnostics);
      validDiagnostics = await Diagnostic.find({ _id: { $in: diagnostics } });
      console.log("✅ Diagnostics valides trouvés :", validDiagnostics.map(d => d._id));
      if (validDiagnostics.length !== diagnostics.length) {
        console.log("❌ Certains diagnostics sont introuvables");
        return res.status(400).json({ message: "Certains diagnostics sont introuvables." });
      }
    }

    // Création du pack
    const pack = new Pack({
      nom,
      typeBien,
      typeOperation,
      diagnostics: validDiagnostics.map(d => d._id),
      tarifs: {
        var: tarifs.var ?? 0,
        herault: tarifs.herault ?? 0,
        autre: tarifs.autre ?? 0
      },
      obligatoireDansPacks: Array.isArray(obligatoireDansPacks) ? obligatoireDansPacks : [],
      erpOffert: typeof erpOffert === "boolean" ? erpOffert : false,
      supplementsDisponibles: Array.isArray(supplementsDisponibles) ? supplementsDisponibles : []
    });

    console.log("💾 Pack à sauvegarder :", pack);
    await pack.save();
    console.log("✅ Pack créé :", pack);

    res.status(201).json({ message: "Pack créé.", pack });
  } catch (err) {
    console.error("❌ Erreur création pack :", err);
    res.status(500).json({ message: "Erreur serveur lors de la création du pack." });
  }
};


/**
 * ✏️ Modifier un diagnostic
 */
exports.updateDiagnostic = async (req, res) => {
  try {
    console.log("✏️ [updateDiagnostic] Requête reçue :", req.params.id, req.body);
    const { id } = req.params;
    const {
      nom,
      typeBien,
      typeOperation,
      trancheAnnee,
      tarifsParSurface,
      erpOffert,
      supplementsDisponibles,
      obligatoireDansPacks
    } = req.body;

    const diagnostic = await Diagnostic.findById(id);
    if (!diagnostic) return res.status(404).json({ message: "Diagnostic introuvable." });

    // ✏️ Modification des champs simples
    if (nom) diagnostic.nom = nom;
    if (typeBien) diagnostic.typeBien = typeBien;
    if (typeOperation) diagnostic.typeOperation = typeOperation;
    if (trancheAnnee) diagnostic.trancheAnnee = trancheAnnee;
    if (typeof erpOffert === "boolean") diagnostic.erpOffert = erpOffert;
    if (Array.isArray(supplementsDisponibles)) diagnostic.supplementsDisponibles = supplementsDisponibles;
    if (Array.isArray(obligatoireDansPacks)) diagnostic.obligatoireDansPacks = obligatoireDansPacks;

    // ✏️ Modification des tarifs par surface
    if (Array.isArray(tarifsParSurface) && tarifsParSurface.length) {
      diagnostic.tarifsParSurface = tarifsParSurface.map(t => ({
        surfaceMin: t.surfaceMin ?? 0,
        surfaceMax: t.surfaceMax ?? 0,
        tarifs: {
          var: t.tarifs?.var ?? 0,
          herault: t.tarifs?.herault ?? 0,
          autre: t.tarifs?.autre ?? 0
        }
      }));
    }

    await diagnostic.save();
    console.log("✅ [updateDiagnostic] Diagnostic mis à jour :", diagnostic);
    res.json({ message: "Diagnostic mis à jour.", diagnostic });
  } catch (err) {
    console.error("❌ [updateDiagnostic] Erreur :", err);
    res.status(500).json({
      message: "Erreur serveur lors de la modification du diagnostic.",
    });
  }
};


/**
 * ✏️ Modifier un pack
 */
exports.updatePack = async (req, res) => {
  try {
    console.log("✏️ [updatePack] Requête reçue :", req.params.id, req.body);
    const { id } = req.params;
    const { nom, typeBien, typeOperation, tarifs, diagnostics, obligatoireDansPacks, erpOffert, supplementsDisponibles } = req.body;

    const pack = await Pack.findById(id);
    if (!pack) return res.status(404).json({ message: "Pack introuvable." });

    // Mise à jour des champs principaux
    if (nom !== undefined) pack.nom = nom;
    if (typeBien !== undefined) pack.typeBien = typeBien;
    if (typeOperation !== undefined) pack.typeOperation = typeOperation;

    // Mise à jour des tarifs
    if (tarifs) {
      pack.tarifs.var = tarifs.var ?? pack.tarifs.var;
      pack.tarifs.herault = tarifs.herault ?? pack.tarifs.herault;
      pack.tarifs.autre = tarifs.autre ?? pack.tarifs.autre;
    }

    // Diagnostics associés
    if (diagnostics !== undefined) pack.diagnostics = diagnostics;

    // Champs supplémentaires
    if (obligatoireDansPacks !== undefined) pack.obligatoireDansPacks = obligatoireDansPacks;
    if (erpOffert !== undefined) pack.erpOffert = erpOffert;
    if (supplementsDisponibles !== undefined) pack.supplementsDisponibles = supplementsDisponibles;

    await pack.save();
    console.log("✅ [updatePack] Pack mis à jour :", pack);
    res.json({ message: "Pack mis à jour.", pack });
  } catch (err) {
    console.error("❌ [updatePack] Erreur :", err);
    res.status(500).json({
      message: "Erreur serveur lors de la modification du pack.",
    });
  }
};


/**
 * 🗑️ Supprimer un diagnostic
 */
exports.deleteDiagnostic = async (req, res) => {
  try {
    console.log("🗑️ [deleteDiagnostic] Requête reçue :", req.params.id);
    const { id } = req.params;

    const deleted = await Diagnostic.findByIdAndDelete(id);
    if (!deleted) return res.status(404).json({ message: "Diagnostic introuvable." });

    console.log("✅ [deleteDiagnostic] Diagnostic supprimé :", deleted);
    res.json({ message: "Diagnostic supprimé." });
  } catch (err) {
    console.error("❌ [deleteDiagnostic] Erreur :", err);
    res.status(500).json({ message: "Erreur serveur lors de la suppression du diagnostic." });
  }
};

/**
 * 🗑️ Supprimer un pack
 */
exports.deletePack = async (req, res) => {
  try {
    console.log("🗑️ [deletePack] Requête reçue :", req.params.id);
    const { id } = req.params;

    const deleted = await Pack.findByIdAndDelete(id);
    if (!deleted) return res.status(404).json({ message: "Pack introuvable." });

    console.log("✅ [deletePack] Pack supprimé :", deleted);
    res.json({ message: "Pack supprimé." });
  } catch (err) {
    console.error("❌ [deletePack] Erreur :", err);
    res.status(500).json({ message: "Erreur serveur lors de la suppression du pack." });
  }
};

/**
 * 📋 Récupérer tous les diagnostics
 */
exports.getAllDiagnostics = async (req, res) => {
  try {
    console.log("📥 [getAllDiagnostics] Requête reçue.");
    const diagnostics = await Diagnostic.find().sort({ createdAt: -1 });

    if (!diagnostics.length) {
      console.log("⚠️ [getAllDiagnostics] Aucun diagnostic trouvé.");
      return res.status(404).json({ message: "Aucun diagnostic trouvé." });
    }

    console.log(`✅ [getAllDiagnostics] ${diagnostics.length} diagnostics trouvés.`);
    res.json(diagnostics);
  } catch (error) {
    console.error("❌ [getAllDiagnostics] Erreur :", error);
    res.status(500).json({ message: "Erreur serveur lors de la récupération des diagnostics." });
  }
};

/**
 * 📋 Récupérer tous les packs (avec les diagnostics associés)
 */
exports.getAllPacks = async (req, res) => {
  try {
    console.log("📥 [getAllPacks] Requête reçue.");
    const packs = await Pack.find().populate("diagnostics").sort({ createdAt: -1 });

    if (!packs.length) {
      console.log("⚠️ [getAllPacks] Aucun pack trouvé.");
      return res.status(404).json({ message: "Aucun pack trouvé." });
    }

    console.log(`✅ [getAllPacks] ${packs.length} packs trouvés.`);
    res.json(packs);
  } catch (error) {
    console.error("❌ [getAllPacks] Erreur :", error);
    res.status(500).json({ message: "Erreur serveur lors de la récupération des packs." });
  }
};
