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
const Employe = require('../models/Employe');
const Devis = require('../models/Devis')
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


exports.getClassementAgences = async (req, res) => {
  try {
    const agences = await Agence.find().lean();

    const classement = await Promise.all(
      agences.map(async (agence) => {
        // 🔹 Récupération des employés de l'agence
        const employes = await Employe.find({ agence: agence._id }).lean();
        const employeIds = employes.map(e => e._id);

        // 🔹 Récupération des devis liés à l'agence
        const devisListe = await Devis.find({
          $or: [
            { agenceId: agence._id },
            { _id: { $in: agence.devis } }, // ceux déjà dans le tableau
            { 'creePar.id': { $in: employeIds } } // ceux créés par les employés
          ]
        }).lean();

        // 🔹 Calcul des montants fiables pour chaque devis
        const devisAvecMontant = devisListe.map(d => ({
          ...d,
          montant: d.totalFinal ?? d.montantTTC ?? d.totalApresReduction ?? 0
        }));

        const nombreDevis = devisAvecMontant.length;
        const devisAccepte = devisAvecMontant.filter(d => d.statut.toLowerCase() === 'accepté').length;
        const tauxConversion = nombreDevis > 0 ? (devisAccepte / nombreDevis) * 100 : 0;

        // 🔹 Cagnotte totale (employés + agence)
        let cagnotteTotale = agence.cagnotte || 0;
        if (cagnotteTotale === 0) {
          const sommeEmployes = employes.reduce((acc, e) => acc + (e.cagnotte || 0), 0);
          cagnotteTotale = sommeEmployes;
        }

        // 🔹 Email et téléphone
        let emailAgence = (agence.emails_contact && agence.emails_contact.length > 0)
          ? agence.emails_contact[0].email
          : agence.admin?.email || '';

        const telephone = agence.admin?.telephone_portable || agence.telephone_fixe || '';

        return {
          id: agence._id,
          nom_commercial: agence.nom_commercial,
          nom_responsable: agence.nom_responsable,
          cagnotte: cagnotteTotale,
          cagnotteEnAttente: agence.cagnotteEnAttente || 0,
          tauxConversion: parseFloat(tauxConversion.toFixed(2)),
          nombreDevis,
          email: emailAgence,
          telephone
        };
      })
    );

    // 🔹 Tri du classement selon score
    const classementTrie = classement.sort((a, b) => {
      const scoreA = a.cagnotte + a.tauxConversion * 10 + a.nombreDevis * 5;
      const scoreB = b.cagnotte + b.tauxConversion * 10 + b.nombreDevis * 5;
      return scoreB - scoreA;
    });

    const classementAvecPosition = classementTrie.map((agence, index) => ({
      position: index + 1,
      ...agence
    }));

    res.status(200).json(classementAvecPosition);
  } catch (error) {
    console.error("Erreur récupération classement agences :", error);
    res.status(500).json({ message: "Erreur serveur lors du classement des agences." });
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
/**
 * RECUPERER TOUTES LES AGENCES AVEC EMPLOYES
 */
exports.getAllAgences = async (req, res) => {
  try {
    const agences = await Agence.find();

    const result = await Promise.all(
      agences.map(async (agence) => {

        const employes = await Employe.find({ agence: agence._id });

        // 🔹 Récupération des devis
const devis = await Devis.find({ agenceId: agence._id })
  .sort({ dateCreation: -1 })
  .select("numero statut client.nom client.prenom client.email client.tel dateCreation totalFinal +montantTTC totalApresReduction");

const devisFormatted = devis.map((d) => {
  const ttc =
    d.totalFinal ??
    d.montantTTC ??
    d.totalApresReduction ??
    0;

  return {
    id: d._id,
    numero: d.numero,
    statut: d.statut,
    client: `${d.client.nom} ${d.client.prenom}`,
    email: d.client.email,
    telephone: d.client.tel,
    date: formatDateFR(d.dateCreation),

    total: ttc,        // 🔥 toujours rempli
    montantTTC: ttc   // compatibilité front
  };
});


        return {
          id: agence._id,
          nom_commercial: agence.nom_commercial,
          nom_responsable: agence.nom_responsable,
          adresse: agence.adresse,
          siret: agence.siret,
          telephone_fixe: agence.telephone_fixe || '',
          telephone_portable: agence.admin?.telephone_portable || '',
          emails_contact: agence.emails_contact || [],
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

          nombreDevis: devis.length,
          devis: devisFormatted, // 🔥 Liste des devis formatés

          tauxAcceptation: agence.tauxAcceptation || 0,
          CA: agence.CA || 0,
          clients: agence.clients || [],
          ca_estime: agence.ca_estime || 0,
          cagnotte: agence.cagnotte || 0,
          reduction: agence.reduction || 0,
          createdAt: agence.createdAt,
          updatedAt: agence.updatedAt,

          employes: employes.map(e => ({
            id: e._id,
            nom: e.nom,
            prenom: e.prenom,
            email: e.email,
            telephone_portable: e.telephone_portable,
            statut: e.statut
          })),

          nombreEmployes: employes.length
        };
      })
    );

    res.json(result);

  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Erreur serveur lors de la récupération des agences." });
  }
};


// 🔧 Fonction de formatage
function formatDateFR(date) {
  if (!date) return "";
  const d = new Date(date);

  const jour = String(d.getDate()).padStart(2, "0");
  const mois = String(d.getMonth() + 1).padStart(2, "0");
  const annee = d.getFullYear();

  const heures = String(d.getHours()).padStart(2, "0");
  const minutes = String(d.getMinutes()).padStart(2, "0");

  return `${jour}/${mois}/${annee} - ${heures}:${minutes}`;
}


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
      typeBienLibre,   // <-- récupéré si l'utilisateur a saisi "Autre"
      typeOperation, 
      trancheAnnee, 
      tarifsParSurface, 
      tarifsParAppartement,
      tarifAudit,
      erpOffert, 
      supplementsDisponibles 
    } = req.body;

    // --- Déterminer le type de bien final ---
    const typeBienFinal = typeBienLibre?.trim() || typeBien;

    const trancheAnneeArray = Array.isArray(trancheAnnee)
  ? trancheAnnee
  : trancheAnnee ? [trancheAnnee] : [];

    // --- Validation ---
    if (!nom || !typeBienFinal || !typeOperation || !Array.isArray(trancheAnnee)) {
      console.warn("⚠️ Champs obligatoires manquants :", { nom, typeBienFinal, typeOperation, trancheAnnee });
      return res.status(400).json({ message: "Champs obligatoires manquants." });
    }

    // Validation spécifique selon typeBien
    if (typeBienFinal === "maison" && (!Array.isArray(tarifsParSurface) || !tarifsParSurface.length)) {
      console.warn("⚠️ Champs manquants pour maison :", { tarifsParSurface });
      return res.status(400).json({ message: "Tarifs par surface obligatoires pour une maison." });
    }
    if (typeBienFinal === "appartement" && (!Array.isArray(tarifsParAppartement) || !tarifsParAppartement.length)) {
      console.warn("⚠️ Champs manquants pour appartement :", { tarifsParAppartement });
      return res.status(400).json({ message: "Tarifs par appartement obligatoires pour un appartement." });
    }
    if (typeBienFinal === "audit" && (tarifAudit === undefined || tarifAudit === null)) {
      console.warn("⚠️ Champ tarifAudit manquant pour audit :", { tarifAudit });
      return res.status(400).json({ message: "Tarif audit obligatoire pour un audit." });
    }

    console.log("✅ Données validées !");
    console.log("🧾 Détails du diagnostic à créer :", {
      nom,
      typeBienFinal,
      typeOperation,
      trancheAnnee,
      tarifsParSurface,
      tarifsParAppartement,
      tarifAudit,
      erpOffert,
      supplementsDisponibles,
    });

    const diagnostic = new Diagnostic({
      nom,
      typeBien: typeBienFinal,   // <-- on enregistre le type libre si fourni
      typeOperation,
      trancheAnnee,
      tarifsParSurface: tarifsParSurface || [],
      tarifsParAppartement: tarifsParAppartement || [],
      tarifAudit: tarifAudit || 0,
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

    const deleted = await Supplement.findByIdAndDelete(id);
    if (!deleted) {
      return res.status(404).json({ message: "Supplément non trouvé." });
    }

    res.status(200).json({ message: "Supplément supprimé ✅" });
  } catch (err) {
    console.error("❌ Erreur deleteSupplement:", err);
    res.status(500).json({ message: "Erreur serveur." });
  }
};


/**
 * 📦 Créer un pack avec diagnostics associés et tarifs
 */
exports.createPack = async (req, res) => {
  try {
    console.log("✏️ [createPack] Requête reçue :", req.body);

    const {
      nom,
      typeBien,
      typeOperation,
      diagnostics,
      tarifs,
      tarifsParSurface,
      tarifsParAppartement,
      trancheAnnee,
      obligatoireDansPacks,
      erpOffert,
      supplementsDisponibles
    } = req.body;

    // Validation des champs obligatoires
    if (!nom || !typeBien || !typeOperation) {
      return res.status(400).json({ message: "Champs obligatoires manquants." });
    }

    // Vérifier que les diagnostics existent
    let validDiagnostics = [];
    if (diagnostics?.length) {
      validDiagnostics = await Diagnostic.find({ _id: { $in: diagnostics } });
      if (validDiagnostics.length !== diagnostics.length) {
        return res.status(400).json({ message: "Certains diagnostics sont introuvables." });
      }
    }

    // Construction du pack
// Construction du pack
const pack = new Pack({
  nom,
  typeBien,
  typeOperation,
  trancheAnnee: Array.isArray(trancheAnnee) ? trancheAnnee : [],
  diagnostics: validDiagnostics.map(d => d._id),

  // Tarifs globaux
  tarifs: {
    var: Number(tarifs?.var ?? 0),
    herault: Number(tarifs?.herault ?? 0),
    autre: Number(tarifs?.autre ?? 0)
  },

  // Tarifs selon la surface (pour tous les types sauf appartement)
  tarifsParSurface: typeBien !== "appartement"
    ? (Array.isArray(tarifsParSurface)
        ? tarifsParSurface.map(t => ({
            surfaceMin: Number(t.surfaceMin ?? 0),
            surfaceMax: Number(t.surfaceMax ?? 0),
            tarifs: {
              var: Number(t.tarifs?.var ?? 0),
              herault: Number(t.tarifs?.herault ?? 0),
              autre: Number(t.tarifs?.autre ?? 0)
            }
          }))
        : [])
    : [],

  // Tarifs selon type d'appartement
  tarifsParAppartement: typeBien === "appartement"
    ? (Array.isArray(tarifsParAppartement)
        ? tarifsParAppartement.map(t => ({
            typeAppartement: t.typeAppartement ?? "<20m2",
            tarifs: {
              var: Number(t.tarifs?.var ?? 0),
              herault: Number(t.tarifs?.herault ?? 0),
              autre: Number(t.tarifs?.autre ?? 0)
            }
          }))
        : [])
    : [],

  obligatoireDansPacks: Array.isArray(obligatoireDansPacks) ? obligatoireDansPacks : [],
  erpOffert: Boolean(erpOffert),
  supplementsDisponibles: Array.isArray(supplementsDisponibles) ? supplementsDisponibles : []
});



    await pack.save();
    res.status(201).json({ message: "Pack créé avec succès.", pack });

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
    const { id } = req.params;
    const {
      nom,
      typeBien,
      typeOperation,
      trancheAnnee,
      tarifsParSurface,
      tarifsParAppartement,
      erpOffert,
      supplementsDisponibles,
      obligatoireDansPacks
    } = req.body;

    const diagnostic = await Diagnostic.findById(id);
    if (!diagnostic) return res.status(404).json({ message: "Diagnostic introuvable." });

    if (nom) diagnostic.nom = nom;
    if (typeBien) diagnostic.typeBien = typeBien;
    if (typeOperation) diagnostic.typeOperation = typeOperation;
    if (trancheAnnee) diagnostic.trancheAnnee = trancheAnnee;
    if (typeof erpOffert === "boolean") diagnostic.erpOffert = erpOffert;
    if (Array.isArray(supplementsDisponibles)) diagnostic.supplementsDisponibles = supplementsDisponibles;
    if (Array.isArray(obligatoireDansPacks)) diagnostic.obligatoireDansPacks = obligatoireDansPacks;

    // ✅ Tarifs maison
    if (Array.isArray(tarifsParSurface)) {
      diagnostic.tarifsParSurface = tarifsParSurface.map(t => ({
        _id: t._id || undefined,
        surfaceMin: Number(t.surfaceMin ?? 0),
        surfaceMax: Number(t.surfaceMax ?? 0),
        tarifs: {
          var: Number(t.tarifs?.var ?? 0),
          herault: Number(t.tarifs?.herault ?? 0),
          autre: Number(t.tarifs?.autre ?? 0),
        }
      }));
    }

    // ✅ Tarifs appartement (la partie manquante !)
    if (Array.isArray(tarifsParAppartement)) {
      diagnostic.tarifsParAppartement = tarifsParAppartement.map(t => ({
        _id: t._id || undefined,
        typeAppartement: t.typeAppartement ?? "<20m2",
        tarifs: {
          var: Number(t.tarifs?.var ?? 0),
          herault: Number(t.tarifs?.herault ?? 0),
          autre: Number(t.tarifs?.autre ?? 0),
        }
      }));
    }

    await diagnostic.save();
    res.json({ message: "Diagnostic mis à jour.", diagnostic });

  } catch (err) {
    res.status(500).json({ message: "Erreur serveur lors de la modification du diagnostic." });
  }
};




exports.updatePack = async (req, res) => {
  try {
    console.log("✏️ [updatePack] Requête reçue :", req.params.id, req.body);
    const { id } = req.params;
    const {
      nom,
      typeBien,
      typeOperation,
      diagnostics,
      tarifs,
      tarifsParSurface,
      tarifsParAppartement,
      trancheAnnee,
      obligatoireDansPacks,
      erpOffert,
      supplementsDisponibles
    } = req.body;

    const pack = await Pack.findById(id);
    if (!pack) return res.status(404).json({ message: "Pack introuvable." });

    // Champs principaux
    if (nom !== undefined) pack.nom = nom;
    if (typeBien !== undefined) pack.typeBien = typeBien;
    if (typeOperation !== undefined) pack.typeOperation = typeOperation;
    if (trancheAnnee !== undefined) pack.trancheAnnee = Array.isArray(trancheAnnee) ? trancheAnnee : [];

    // Tarifs globaux
    if (tarifs) {
      pack.tarifs.var = Number(tarifs.var ?? pack.tarifs.var);
      pack.tarifs.herault = Number(tarifs.herault ?? pack.tarifs.herault);
      pack.tarifs.autre = Number(tarifs.autre ?? pack.tarifs.autre);
    }

    // Tarifs détaillés
    if (typeBien !== "appartement" && Array.isArray(tarifsParSurface)) {
      pack.tarifsParSurface = tarifsParSurface.map(t => ({
        _id: t._id || undefined,
        surfaceMin: Number(t.surfaceMin ?? 0),
        surfaceMax: Number(t.surfaceMax ?? 0),
        tarifs: {
          var: Number(t.tarifs?.var ?? 0),
          herault: Number(t.tarifs?.herault ?? 0),
          autre: Number(t.tarifs?.autre ?? 0)
        }
      }));
    }

    if (typeBien === "appartement" && Array.isArray(tarifsParAppartement)) {
      pack.tarifsParAppartement = tarifsParAppartement.map(t => ({
        _id: t._id || undefined,
        typeAppartement: t.typeAppartement ?? "<20m2",
        tarifs: {
          var: Number(t.tarifs?.var ?? 0),
          herault: Number(t.tarifs?.herault ?? 0),
          autre: Number(t.tarifs?.autre ?? 0)
        }
      }));
    }

    // Diagnostics : vérifier qu'ils existent
    if (Array.isArray(diagnostics)) {
      const validDiagnostics = await Diagnostic.find({ _id: { $in: diagnostics } });
      if (validDiagnostics.length !== diagnostics.length) {
        return res.status(400).json({ message: "Certains diagnostics sont introuvables." });
      }
      pack.diagnostics = validDiagnostics.map(d => d._id);
    }

    // Champs supplémentaires
    if (obligatoireDansPacks !== undefined) pack.obligatoireDansPacks = obligatoireDansPacks;
    if (erpOffert !== undefined) pack.erpOffert = Boolean(erpOffert);
    if (supplementsDisponibles !== undefined) pack.supplementsDisponibles = supplementsDisponibles;

    await pack.save();
    res.json({ message: "Pack mis à jour.", pack });

  } catch (err) {
    console.error("❌ [updatePack] Erreur :", err);
    res.status(500).json({ message: "Erreur serveur lors de la modification du pack." });
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




// ------------------------ MDP RÉINITIALISATION ADMIN ------------------------------- //


/**
 * DEMANDE DE RÉINITIALISATION DU MOT DE PASSE ADMIN
 */
exports.forgotPasswordAdmin = async (req, res) => {
  try {
    const { email } = req.body;

    const admin = await Admin.findOne({ email });
    if (!admin) {
      return res.status(404).json({ message: "Aucun compte admin trouvé avec cet email." });
    }

    // Génération d’un token aléatoire
    const resetToken = crypto.randomBytes(32).toString('hex');
    const resetTokenHash = crypto.createHash('sha256').update(resetToken).digest('hex');

    // Stockage du token et expiration (1h)
    admin.resetPasswordToken = resetTokenHash;
    admin.resetPasswordExpires = Date.now() + 60 * 60 * 1000;
    await admin.save();

    // Lien de réinitialisation
    const resetUrl = `https://dimotec.datafuse.fr/admin/reset-password/${resetToken}`;

    await sendEmail({
      to: admin.email,
      subject: "Réinitialisation de votre mot de passe - Admin",
      template: "ResetPassword.html",
      variables: {
        nomClient: admin.nom,
        lienReinitialisation: resetUrl
      }
    });

    res.json({ message: "Un e-mail de réinitialisation a été envoyé à votre adresse." });
  } catch (error) {
    console.error("❌ Erreur forgotPasswordAdmin :", error);
    res.status(500).json({ message: "Erreur serveur lors de la demande de réinitialisation." });
  }
};

/**
 * VÉRIFICATION DU TOKEN DE RÉINITIALISATION ADMIN
 */
exports.verifyResetTokenAdmin = async (req, res) => {
  try {
    const { token } = req.params;
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    const admin = await Admin.findOne({
      resetPasswordToken: tokenHash,
      resetPasswordExpires: { $gt: Date.now() }
    });

    if (!admin) {
      return res.status(400).json({ message: "Token invalide ou expiré." });
    }

    res.json({ message: "Token valide.", email: admin.email });
  } catch (error) {
    console.error("❌ Erreur verifyResetTokenAdmin :", error);
    res.status(500).json({ message: "Erreur serveur lors de la vérification du token." });
  }
};

/**
 * DÉFINITION D’UN NOUVEAU MOT DE PASSE ADMIN
 */
exports.resetPasswordAdmin = async (req, res) => {
  try {
    const { token } = req.params;
    const { mot_de_passe } = req.body;

    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    const admin = await Admin.findOne({
      resetPasswordToken: tokenHash,
      resetPasswordExpires: { $gt: Date.now() }
    });

    if (!admin) {
      return res.status(400).json({ message: "Token invalide ou expiré." });
    }

    // 🔹 Hash du mot de passe avant de sauvegarder
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(mot_de_passe, salt);

    admin.mot_de_passe = hashedPassword;
    admin.resetPasswordToken = undefined;
    admin.resetPasswordExpires = undefined;
    await admin.save();

    // Email de confirmation
    await sendEmail({
      to: admin.email,
      subject: "Votre mot de passe a été modifié - Admin",
      template: "PasswordChanged.html",
      variables: { nomClient: admin.nom }
    });

    res.json({ message: "Mot de passe réinitialisé avec succès." });
  } catch (error) {
    console.error("❌ Erreur resetPasswordAdmin :", error);
    res.status(500).json({ message: "Erreur serveur lors de la réinitialisation du mot de passe." });
  }
};