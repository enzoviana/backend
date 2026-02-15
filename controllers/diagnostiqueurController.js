const Diagnostiqueur = require('../models/Diagnostiqueur');
const TechnicienDiagnostiqueur = require('../models/TechnicienDiagnostiqueur');
const Certification = require('../models/Certification');
const DomaineActivite = require('../models/DomaineActivite');
const OrdreMission = require('../models/OrdreMission');
const Devis = require('../models/Devis');
const NotationDiagnostiqueur = require('../models/NotationDiagnostiqueur');
const RenouvelementGratuit = require('../models/RenouvelementGratuit');
const AlerteDocument = require('../models/AlerteDocument');
const AbonnementDiagnostiqueur = require('../models/AbonnementDiagnostiqueur');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const cloudinary = require('../config/cloudinary');
const alerteService = require('../services/alerteService');
const notationService = require('../services/notationService');
const stripeService = require('../services/stripeService');

const JWT_SECRET = process.env.JWT_SECRET || 'tonSecretIci';

/**
 * INSCRIPTION (Register)
 */
exports.register = async (req, res) => {
  try {
    const {
      nom_entreprise,
      siret,
      adresse,
      email_entreprise,
      admin,
      secteursIntervention
    } = req.body;

    // Vérifier si le SIRET existe déjà
    const existingSiret = await Diagnostiqueur.findOne({ siret });
    if (existingSiret) {
      return res.status(400).json({ message: 'Ce SIRET est déjà enregistré.' });
    }

    // Vérifier si l'email admin existe déjà
    const existingEmail = await Diagnostiqueur.findOne({ 'admin.email': admin.email });
    if (existingEmail) {
      return res.status(400).json({ message: 'Cet email est déjà utilisé.' });
    }

    // Créer le diagnostiqueur
    const diagnostiqueur = new Diagnostiqueur({
      nom_entreprise,
      siret,
      adresse,
      email_entreprise,
      admin: {
        nom: admin.nom,
        prenom: admin.prenom,
        email: admin.email,
        mot_de_passe: admin.mot_de_passe, // Sera hashé par le pre-save hook
        telephone: admin.telephone
      },
      secteursIntervention: secteursIntervention || [],
      statut: 'en_attente',
      typeAbonnement: 'STANDARD'
    });

    await diagnostiqueur.save();

    // TODO: Envoyer email de confirmation à l'admin plateforme

    res.status(201).json({
      message: 'Inscription réussie. Votre compte est en attente de validation.',
      diagnostiqueur: {
        id: diagnostiqueur._id,
        nom_entreprise: diagnostiqueur.nom_entreprise,
        statut: diagnostiqueur.statut
      }
    });

  } catch (error) {
    console.error('Erreur register:', error);
    res.status(500).json({ message: 'Erreur lors de l\'inscription.' });
  }
};

/**
 * CONNEXION (Login)
 */
exports.login = async (req, res) => {
  try {
    const { email, mot_de_passe } = req.body;

    // Trouver le diagnostiqueur par email admin
    const diagnostiqueur = await Diagnostiqueur.findOne({ 'admin.email': email });

    if (!diagnostiqueur) {
      return res.status(401).json({ message: 'Email ou mot de passe incorrect.' });
    }

    // Vérifier le mot de passe
    const isMatch = await bcrypt.compare(mot_de_passe, diagnostiqueur.admin.mot_de_passe);

    if (!isMatch) {
      return res.status(401).json({ message: 'Email ou mot de passe incorrect.' });
    }

    // Vérifier le statut
    if (diagnostiqueur.statut === 'bloqué') {
      return res.status(403).json({ message: 'Votre compte est bloqué. Contactez l\'administrateur.' });
    }

    // Générer le token JWT
    const token = jwt.sign(
      {
        id: diagnostiqueur._id,
        email: diagnostiqueur.admin.email,
        type: 'diagnostiqueur'
      },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      token,
      diagnostiqueur: {
        id: diagnostiqueur._id,
        nom_entreprise: diagnostiqueur.nom_entreprise,
        email: diagnostiqueur.admin.email,
        nom: diagnostiqueur.admin.nom,
        prenom: diagnostiqueur.admin.prenom,
        statut: diagnostiqueur.statut,
        typeAbonnement: diagnostiqueur.typeAbonnement,
        noteGlobale: diagnostiqueur.noteGlobale,
        nombreEvaluations: diagnostiqueur.nombreEvaluations
      }
    });

  } catch (error) {
    console.error('Erreur login:', error);
    res.status(500).json({ message: 'Erreur lors de la connexion.' });
  }
};

/**
 * VÉRIFICATION TOKEN
 */
exports.verifyToken = async (req, res) => {
  try {
    // Le middleware diagnostiqueurAuth a déjà vérifié le token
    res.json({
      valid: true,
      diagnostiqueur: {
        id: req.diagnostiqueur._id,
        nom_entreprise: req.diagnostiqueur.nom_entreprise,
        email: req.diagnostiqueur.admin.email,
        nom: req.diagnostiqueur.admin.nom,
        prenom: req.diagnostiqueur.admin.prenom,
        statut: req.diagnostiqueur.statut,
        typeAbonnement: req.diagnostiqueur.typeAbonnement,
        noteGlobale: req.diagnostiqueur.noteGlobale,
        nombreEvaluations: req.diagnostiqueur.nombreEvaluations
      }
    });

  } catch (error) {
    console.error('Erreur verifyToken:', error);
    res.status(500).json({ message: 'Erreur lors de la vérification du token.' });
  }
};

/**
 * MOT DE PASSE OUBLIÉ
 */
exports.forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;

    const diagnostiqueur = await Diagnostiqueur.findOne({ 'admin.email': email });

    if (!diagnostiqueur) {
      return res.status(404).json({ message: 'Aucun compte associé à cet email.' });
    }

    // Générer token de réinitialisation
    const resetToken = crypto.randomBytes(32).toString('hex');
    diagnostiqueur.admin.resetPasswordToken = resetToken;
    diagnostiqueur.admin.resetPasswordExpires = Date.now() + 3600000; // 1 heure

    await diagnostiqueur.save();

    // TODO: Envoyer email avec lien de réinitialisation

    res.json({ message: 'Un email de réinitialisation a été envoyé.' });

  } catch (error) {
    console.error('Erreur forgotPassword:', error);
    res.status(500).json({ message: 'Erreur lors de la demande de réinitialisation.' });
  }
};

/**
 * RÉINITIALISER MOT DE PASSE
 */
exports.resetPassword = async (req, res) => {
  try {
    const { token } = req.params;
    const { mot_de_passe } = req.body;

    const diagnostiqueur = await Diagnostiqueur.findOne({
      'admin.resetPasswordToken': token,
      'admin.resetPasswordExpires': { $gt: Date.now() }
    });

    if (!diagnostiqueur) {
      return res.status(400).json({ message: 'Token invalide ou expiré.' });
    }

    // Mettre à jour le mot de passe
    diagnostiqueur.admin.mot_de_passe = mot_de_passe; // Sera hashé par le pre-save hook
    diagnostiqueur.admin.resetPasswordToken = null;
    diagnostiqueur.admin.resetPasswordExpires = null;

    await diagnostiqueur.save();

    res.json({ message: 'Mot de passe réinitialisé avec succès.' });

  } catch (error) {
    console.error('Erreur resetPassword:', error);
    res.status(500).json({ message: 'Erreur lors de la réinitialisation du mot de passe.' });
  }
};

/**
 * PROFIL - Récupérer
 */
exports.getMe = async (req, res) => {
  try {
    const diagnostiqueur = await Diagnostiqueur.findById(req.diagnostiqueur._id)
      .select('-admin.mot_de_passe -admin.resetPasswordToken -admin.resetPasswordExpires');

    res.json(diagnostiqueur);

  } catch (error) {
    console.error('Erreur getMe:', error);
    res.status(500).json({ message: 'Erreur lors de la récupération du profil.' });
  }
};

/**
 * PROFIL - Mettre à jour
 */
exports.updateMe = async (req, res) => {
  try {
    const updates = req.body;
    const diagnostiqueur = req.diagnostiqueur;

    // Champs autorisés à la mise à jour
    const allowedUpdates = ['nom_entreprise', 'adresse', 'email_entreprise', 'secteursIntervention'];

    allowedUpdates.forEach(field => {
      if (updates[field] !== undefined) {
        diagnostiqueur[field] = updates[field];
      }
    });

    // Mise à jour admin
    if (updates.admin) {
      const allowedAdminUpdates = ['nom', 'prenom', 'telephone'];
      allowedAdminUpdates.forEach(field => {
        if (updates.admin[field] !== undefined) {
          diagnostiqueur.admin[field] = updates.admin[field];
        }
      });
    }

    await diagnostiqueur.save();

    res.json({
      message: 'Profil mis à jour avec succès.',
      diagnostiqueur
    });

  } catch (error) {
    console.error('Erreur updateMe:', error);
    res.status(500).json({ message: 'Erreur lors de la mise à jour du profil.' });
  }
};

/**
 * LOGO - Upload
 */
exports.uploadLogo = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'Aucun fichier fourni.' });
    }

    const diagnostiqueur = req.diagnostiqueur;

    // Upload sur Cloudinary
    const result = await cloudinary.uploader.upload(req.file.path, {
      folder: 'diagnostiqueurs/logos'
    });

    // Supprimer l'ancien logo si existe
    if (diagnostiqueur.logo) {
      const publicId = diagnostiqueur.logo.split('/').slice(-2).join('/').split('.')[0];
      await cloudinary.uploader.destroy(publicId);
    }

    diagnostiqueur.logo = result.secure_url;
    await diagnostiqueur.save();

    res.json({
      message: 'Logo mis à jour avec succès.',
      logo: result.secure_url
    });

  } catch (error) {
    console.error('Erreur uploadLogo:', error);
    res.status(500).json({ message: 'Erreur lors de l\'upload du logo.' });
  }
};

/**
 * DOCUMENTS - Ajouter
 */
exports.addDocument = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'Aucun fichier fourni.' });
    }

    const { type, dateExpiration } = req.body;
    const diagnostiqueur = req.diagnostiqueur;

    // Upload sur Cloudinary
    const result = await cloudinary.uploader.upload(req.file.path, {
      folder: `diagnostiqueurs/${diagnostiqueur._id}/documents`,
      resource_type: 'auto'
    });

    const document = {
      type,
      nom: req.file.originalname,
      url: result.secure_url,
      public_id: result.public_id,
      dateExpiration: dateExpiration ? new Date(dateExpiration) : null,
      dateDepot: new Date(),
      statut: 'valide'
    };

    diagnostiqueur.documents.push(document);
    await diagnostiqueur.save();

    res.status(201).json({
      message: 'Document ajouté avec succès.',
      document
    });

  } catch (error) {
    console.error('Erreur addDocument:', error);
    res.status(500).json({ message: 'Erreur lors de l\'ajout du document.' });
  }
};

/**
 * DOCUMENTS - Liste
 */
exports.getDocuments = async (req, res) => {
  try {
    const diagnostiqueur = req.diagnostiqueur;

    res.json({
      documents: diagnostiqueur.documents
    });

  } catch (error) {
    console.error('Erreur getDocuments:', error);
    res.status(500).json({ message: 'Erreur lors de la récupération des documents.' });
  }
};

/**
 * DOCUMENTS - Supprimer
 */
exports.deleteDocument = async (req, res) => {
  try {
    const { documentId } = req.params;
    const diagnostiqueur = req.diagnostiqueur;

    const document = diagnostiqueur.documents.id(documentId);

    if (!document) {
      return res.status(404).json({ message: 'Document non trouvé.' });
    }

    // Supprimer de Cloudinary
    await cloudinary.uploader.destroy(document.public_id);

    // Supprimer du tableau
    diagnostiqueur.documents.pull(documentId);
    await diagnostiqueur.save();

    res.json({ message: 'Document supprimé avec succès.' });

  } catch (error) {
    console.error('Erreur deleteDocument:', error);
    res.status(500).json({ message: 'Erreur lors de la suppression du document.' });
  }
};

/**
 * TECHNICIENS - Ajouter
 */
exports.addTechnicien = async (req, res) => {
  try {
    const { nom, prenom, email, telephone } = req.body;
    const diagnostiqueur = req.diagnostiqueur;

    const technicien = await TechnicienDiagnostiqueur.create({
      diagnostiqueur: diagnostiqueur._id,
      nom,
      prenom,
      email,
      telephone,
      actif: true
    });

    res.status(201).json({
      message: 'Technicien ajouté avec succès.',
      technicien
    });

  } catch (error) {
    console.error('Erreur addTechnicien:', error);
    res.status(500).json({ message: 'Erreur lors de l\'ajout du technicien.' });
  }
};

/**
 * TECHNICIENS - Liste
 */
exports.getTechniciens = async (req, res) => {
  try {
    const diagnostiqueur = req.diagnostiqueur;

    const techniciens = await TechnicienDiagnostiqueur.find({
      diagnostiqueur: diagnostiqueur._id
    }).populate('certifications');

    res.json({ techniciens });

  } catch (error) {
    console.error('Erreur getTechniciens:', error);
    res.status(500).json({ message: 'Erreur lors de la récupération des techniciens.' });
  }
};

/**
 * TECHNICIENS - Mettre à jour
 */
exports.updateTechnicien = async (req, res) => {
  try {
    const { technicienId } = req.params;
    const updates = req.body;
    const diagnostiqueur = req.diagnostiqueur;

    const technicien = await TechnicienDiagnostiqueur.findOne({
      _id: technicienId,
      diagnostiqueur: diagnostiqueur._id
    });

    if (!technicien) {
      return res.status(404).json({ message: 'Technicien non trouvé.' });
    }

    const allowedUpdates = ['nom', 'prenom', 'email', 'telephone', 'actif'];
    allowedUpdates.forEach(field => {
      if (updates[field] !== undefined) {
        technicien[field] = updates[field];
      }
    });

    await technicien.save();

    res.json({
      message: 'Technicien mis à jour avec succès.',
      technicien
    });

  } catch (error) {
    console.error('Erreur updateTechnicien:', error);
    res.status(500).json({ message: 'Erreur lors de la mise à jour du technicien.' });
  }
};

/**
 * TECHNICIENS - Supprimer
 */
exports.deleteTechnicien = async (req, res) => {
  try {
    const { technicienId } = req.params;
    const diagnostiqueur = req.diagnostiqueur;

    const technicien = await TechnicienDiagnostiqueur.findOne({
      _id: technicienId,
      diagnostiqueur: diagnostiqueur._id
    });

    if (!technicien) {
      return res.status(404).json({ message: 'Technicien non trouvé.' });
    }

    // Supprimer les certifications associées
    await Certification.deleteMany({ technicien: technicienId });

    // Supprimer le technicien
    await technicien.deleteOne();

    res.json({ message: 'Technicien supprimé avec succès.' });

  } catch (error) {
    console.error('Erreur deleteTechnicien:', error);
    res.status(500).json({ message: 'Erreur lors de la suppression du technicien.' });
  }
};

/**
 * CERTIFICATIONS - Ajouter
 */
exports.addCertification = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'Aucun fichier fourni.' });
    }

    const {
      technicienId,
      domaineId,
      numeroCertification,
      organisme,
      dateObtention,
      dateExpiration,
      mentionSpeciale
    } = req.body;

    const diagnostiqueur = req.diagnostiqueur;

    // Vérifier que le technicien appartient au diagnostiqueur
    const technicien = await TechnicienDiagnostiqueur.findOne({
      _id: technicienId,
      diagnostiqueur: diagnostiqueur._id
    });

    if (!technicien) {
      return res.status(404).json({ message: 'Technicien non trouvé.' });
    }

    // Upload sur Cloudinary
    const result = await cloudinary.uploader.upload(req.file.path, {
      folder: `diagnostiqueurs/${diagnostiqueur._id}/certifications`,
      resource_type: 'auto'
    });

    // Créer la certification
    const certification = await Certification.create({
      technicien: technicienId,
      diagnostiqueur: diagnostiqueur._id,
      domaine: domaineId,
      numeroCertification,
      organisme,
      dateObtention: new Date(dateObtention),
      dateExpiration: new Date(dateExpiration),
      mentionSpeciale: mentionSpeciale || null,
      document: {
        nom: req.file.originalname,
        url: result.secure_url,
        public_id: result.public_id,
        dateDepot: new Date()
      },
      statut: 'valide'
    });

    // Ajouter la certification au technicien
    technicien.certifications.push(certification._id);
    await technicien.save();

    const certificationPopulated = await Certification.findById(certification._id)
      .populate('technicien')
      .populate('domaine');

    res.status(201).json({
      message: 'Certification ajoutée avec succès.',
      certification: certificationPopulated
    });

  } catch (error) {
    console.error('Erreur addCertification:', error);
    res.status(500).json({ message: 'Erreur lors de l\'ajout de la certification.' });
  }
};

/**
 * CERTIFICATIONS - Liste
 */
exports.getCertifications = async (req, res) => {
  try {
    const diagnostiqueur = req.diagnostiqueur;

    const certifications = await Certification.find({
      diagnostiqueur: diagnostiqueur._id
    })
      .populate('technicien')
      .populate('domaine')
      .sort({ dateExpiration: 1 });

    res.json({ certifications });

  } catch (error) {
    console.error('Erreur getCertifications:', error);
    res.status(500).json({ message: 'Erreur lors de la récupération des certifications.' });
  }
};

/**
 * CERTIFICATIONS - Mettre à jour
 */
exports.updateCertification = async (req, res) => {
  try {
    const { certificationId } = req.params;
    const updates = req.body;
    const diagnostiqueur = req.diagnostiqueur;

    const certification = await Certification.findOne({
      _id: certificationId,
      diagnostiqueur: diagnostiqueur._id
    });

    if (!certification) {
      return res.status(404).json({ message: 'Certification non trouvée.' });
    }

    const allowedUpdates = ['numeroCertification', 'organisme', 'dateObtention', 'dateExpiration', 'mentionSpeciale'];
    allowedUpdates.forEach(field => {
      if (updates[field] !== undefined) {
        if (field === 'dateObtention' || field === 'dateExpiration') {
          certification[field] = new Date(updates[field]);
        } else {
          certification[field] = updates[field];
        }
      }
    });

    await certification.save();

    const certificationPopulated = await Certification.findById(certification._id)
      .populate('technicien')
      .populate('domaine');

    res.json({
      message: 'Certification mise à jour avec succès.',
      certification: certificationPopulated
    });

  } catch (error) {
    console.error('Erreur updateCertification:', error);
    res.status(500).json({ message: 'Erreur lors de la mise à jour de la certification.' });
  }
};

/**
 * CERTIFICATIONS - Supprimer
 */
exports.deleteCertification = async (req, res) => {
  try {
    const { certificationId } = req.params;
    const diagnostiqueur = req.diagnostiqueur;

    const certification = await Certification.findOne({
      _id: certificationId,
      diagnostiqueur: diagnostiqueur._id
    });

    if (!certification) {
      return res.status(404).json({ message: 'Certification non trouvée.' });
    }

    // Supprimer de Cloudinary
    await cloudinary.uploader.destroy(certification.document.public_id);

    // Retirer du technicien
    await TechnicienDiagnostiqueur.updateOne(
      { _id: certification.technicien },
      { $pull: { certifications: certificationId } }
    );

    // Supprimer la certification
    await certification.deleteOne();

    res.json({ message: 'Certification supprimée avec succès.' });

  } catch (error) {
    console.error('Erreur deleteCertification:', error);
    res.status(500).json({ message: 'Erreur lors de la suppression de la certification.' });
  }
};

/**
 * MISSIONS - Liste
 */
exports.getMissions = async (req, res) => {
  try {
    const diagnostiqueur = req.diagnostiqueur;
    const { statut } = req.query;

    const query = { diagnostiqueur: diagnostiqueur._id };
    if (statut) {
      query.statutAcceptation = statut;
    }

    const missions = await OrdreMission.find(query)
      .populate('devisId')
      .populate('clientId')
      .populate('agenceId')
      .sort({ dateCreation: -1 })
      .limit(50);

    res.json({ missions });

  } catch (error) {
    console.error('Erreur getMissions:', error);
    res.status(500).json({ message: 'Erreur lors de la récupération des missions.' });
  }
};

/**
 * MISSIONS - Détail
 */
exports.getMissionDetail = async (req, res) => {
  try {
    const { missionId } = req.params;
    const diagnostiqueur = req.diagnostiqueur;

    const mission = await OrdreMission.findOne({
      _id: missionId,
      diagnostiqueur: diagnostiqueur._id
    })
      .populate('devisId')
      .populate('clientId')
      .populate('agenceId');

    if (!mission) {
      return res.status(404).json({ message: 'Mission non trouvée.' });
    }

    res.json({ mission });

  } catch (error) {
    console.error('Erreur getMissionDetail:', error);
    res.status(500).json({ message: 'Erreur lors de la récupération de la mission.' });
  }
};

/**
 * MISSIONS - Accepter (avec middleware checkEligibilite)
 */
exports.accepterMission = async (req, res) => {
  try {
    const { missionId } = req.params;
    const diagnostiqueur = req.diagnostiqueur;

    const mission = await OrdreMission.findOne({
      _id: missionId,
      diagnostiqueur: diagnostiqueur._id
    });

    if (!mission) {
      return res.status(404).json({ message: 'Mission non trouvée.' });
    }

    if (mission.statutAcceptation !== 'en_attente') {
      return res.status(400).json({ message: 'Cette mission a déjà été traitée.' });
    }

    // L'éligibilité a déjà été vérifiée par le middleware checkEligibilite
    mission.statutAcceptation = 'accepte';
    mission.dateAcceptation = new Date();
    await mission.save();

    res.json({
      message: 'Mission acceptée avec succès.',
      mission
    });

  } catch (error) {
    console.error('Erreur accepterMission:', error);
    res.status(500).json({ message: 'Erreur lors de l\'acceptation de la mission.' });
  }
};

/**
 * MISSIONS - Refuser
 */
exports.refuserMission = async (req, res) => {
  try {
    const { missionId } = req.params;
    const { raison } = req.body;
    const diagnostiqueur = req.diagnostiqueur;

    const mission = await OrdreMission.findOne({
      _id: missionId,
      diagnostiqueur: diagnostiqueur._id
    });

    if (!mission) {
      return res.status(404).json({ message: 'Mission non trouvée.' });
    }

    if (mission.statutAcceptation !== 'en_attente') {
      return res.status(400).json({ message: 'Cette mission a déjà été traitée.' });
    }

    mission.statutAcceptation = 'refuse';
    mission.dateRefus = new Date();
    mission.raisonRefus = raison || 'Non spécifiée';
    await mission.save();

    res.json({
      message: 'Mission refusée.',
      mission
    });

  } catch (error) {
    console.error('Erreur refuserMission:', error);
    res.status(500).json({ message: 'Erreur lors du refus de la mission.' });
  }
};

/**
 * MISSIONS - Changer statut
 */
exports.updateMissionStatut = async (req, res) => {
  try {
    const { missionId } = req.params;
    const { statut } = req.body;
    const diagnostiqueur = req.diagnostiqueur;

    const mission = await OrdreMission.findOne({
      _id: missionId,
      diagnostiqueur: diagnostiqueur._id
    });

    if (!mission) {
      return res.status(404).json({ message: 'Mission non trouvée.' });
    }

    mission.statut = statut;
    await mission.save();

    res.json({
      message: 'Statut de la mission mis à jour.',
      mission
    });

  } catch (error) {
    console.error('Erreur updateMissionStatut:', error);
    res.status(500).json({ message: 'Erreur lors de la mise à jour du statut.' });
  }
};

/**
 * DEVIS - Liste
 */
exports.getDevis = async (req, res) => {
  try {
    const diagnostiqueur = req.diagnostiqueur;

    const devis = await Devis.find({
      diagnostiqueurAssigne: diagnostiqueur._id
    })
      .populate('agenceId')
      .sort({ dateCreation: -1 })
      .limit(50);

    res.json({ devis });

  } catch (error) {
    console.error('Erreur getDevis:', error);
    res.status(500).json({ message: 'Erreur lors de la récupération des devis.' });
  }
};

/**
 * DEVIS - Détail
 */
exports.getDevisDetail = async (req, res) => {
  try {
    const { devisId } = req.params;
    const diagnostiqueur = req.diagnostiqueur;

    const devis = await Devis.findOne({
      _id: devisId,
      diagnostiqueurAssigne: diagnostiqueur._id
    })
      .populate('pack')
      .populate('diagnosticsSelectionnes')
      .populate('supplementsSelectionnes')
      .populate('agenceId');

    if (!devis) {
      return res.status(404).json({ message: 'Devis non trouvé.' });
    }

    res.json({ devis });

  } catch (error) {
    console.error('Erreur getDevisDetail:', error);
    res.status(500).json({ message: 'Erreur lors de la récupération du devis.' });
  }
};

/**
 * ALERTES - Liste
 */
exports.getAlertes = async (req, res) => {
  try {
    const diagnostiqueur = req.diagnostiqueur;

    const alertes = await alerteService.getAlertesActives(diagnostiqueur._id);

    res.json({ alertes });

  } catch (error) {
    console.error('Erreur getAlertes:', error);
    res.status(500).json({ message: 'Erreur lors de la récupération des alertes.' });
  }
};

/**
 * ALERTES - Marquer comme lue
 */
exports.markAlerteAsRead = async (req, res) => {
  try {
    const { alerteId } = req.params;
    const diagnostiqueur = req.diagnostiqueur;

    const alerte = await AlerteDocument.findOne({
      _id: alerteId,
      diagnostiqueur: diagnostiqueur._id
    });

    if (!alerte) {
      return res.status(404).json({ message: 'Alerte non trouvée.' });
    }

    alerte.statut = 'resolue';
    alerte.dateResolution = new Date();
    await alerte.save();

    res.json({ message: 'Alerte marquée comme résolue.' });

  } catch (error) {
    console.error('Erreur markAlerteAsRead:', error);
    res.status(500).json({ message: 'Erreur lors de la mise à jour de l\'alerte.' });
  }
};

/**
 * NOTATIONS - Liste
 */
exports.getNotations = async (req, res) => {
  try {
    const diagnostiqueur = req.diagnostiqueur;

    const notations = await NotationDiagnostiqueur.find({
      diagnostiqueur: diagnostiqueur._id,
      statut: 'publie'
    })
      .populate('agence')
      .populate('ordreMission')
      .sort({ dateNotation: -1 });

    const stats = await notationService.getStatistiquesNotation(diagnostiqueur._id);

    res.json({
      notations,
      statistiques: stats
    });

  } catch (error) {
    console.error('Erreur getNotations:', error);
    res.status(500).json({ message: 'Erreur lors de la récupération des notations.' });
  }
};

/**
 * NOTATIONS - Ajouter réponse
 */
exports.addReponseNotation = async (req, res) => {
  try {
    const { notationId } = req.params;
    const { texte } = req.body;
    const diagnostiqueur = req.diagnostiqueur;

    const notation = await notationService.ajouterReponse(notationId, diagnostiqueur._id, texte);

    res.json({
      message: 'Réponse ajoutée avec succès.',
      notation
    });

  } catch (error) {
    console.error('Erreur addReponseNotation:', error);
    res.status(500).json({ message: error.message || 'Erreur lors de l\'ajout de la réponse.' });
  }
};

/**
 * RENOUVELLEMENTS - Liste (PRO uniquement)
 */
exports.getRenouvellements = async (req, res) => {
  try {
    const diagnostiqueur = req.diagnostiqueur;

    const renouvellements = await RenouvelementGratuit.find({
      diagnostiqueur: diagnostiqueur._id
    })
      .populate('agence')
      .populate('client')
      .populate('ordreMissionOriginal')
      .populate('nouvelOrdreMission')
      .sort({ dateDemande: -1 });

    res.json({ renouvellements });

  } catch (error) {
    console.error('Erreur getRenouvellements:', error);
    res.status(500).json({ message: 'Erreur lors de la récupération des renouvellements.' });
  }
};

/**
 * ABONNEMENT - Informations
 */
exports.getAbonnement = async (req, res) => {
  try {
    const diagnostiqueur = req.diagnostiqueur;

    const abonnement = await AbonnementDiagnostiqueur.findOne({
      diagnostiqueur: diagnostiqueur._id
    });

    res.json({
      typeAbonnement: diagnostiqueur.typeAbonnement,
      stripeSubscriptionId: diagnostiqueur.stripeSubscriptionId,
      stripeSubscriptionStatus: diagnostiqueur.stripeSubscriptionStatus,
      abonnement: abonnement || null
    });

  } catch (error) {
    console.error('Erreur getAbonnement:', error);
    res.status(500).json({ message: 'Erreur lors de la récupération de l\'abonnement.' });
  }
};

/**
 * ABONNEMENT - Upgrade vers PRO
 */
exports.upgradeAbonnement = async (req, res) => {
  try {
    const diagnostiqueur = req.diagnostiqueur;
    const { returnUrl, cancelUrl } = req.body;

    if (diagnostiqueur.typeAbonnement === 'PRO') {
      return res.status(400).json({ message: 'Vous êtes déjà abonné PRO.' });
    }

    const session = await stripeService.creerCheckoutSession(
      diagnostiqueur._id,
      returnUrl || `${process.env.FRONTEND_DIAGNOSTIQUEUR_URL}/abonnement`,
      cancelUrl || `${process.env.FRONTEND_DIAGNOSTIQUEUR_URL}/abonnement`
    );

    res.json({
      sessionId: session.id,
      sessionUrl: session.url
    });

  } catch (error) {
    console.error('Erreur upgradeAbonnement:', error);
    res.status(500).json({ message: 'Erreur lors de la création de la session Stripe.' });
  }
};

/**
 * ABONNEMENT - Annuler
 */
exports.cancelAbonnement = async (req, res) => {
  try {
    const diagnostiqueur = req.diagnostiqueur;

    if (diagnostiqueur.typeAbonnement !== 'PRO') {
      return res.status(400).json({ message: 'Vous n\'avez pas d\'abonnement PRO actif.' });
    }

    await stripeService.annulerAbonnement(diagnostiqueur._id);

    res.json({ message: 'Abonnement annulé. Il restera actif jusqu\'à la fin de la période payée.' });

  } catch (error) {
    console.error('Erreur cancelAbonnement:', error);
    res.status(500).json({ message: 'Erreur lors de l\'annulation de l\'abonnement.' });
  }
};

/**
 * ABONNEMENT - Factures
 */
exports.getFactures = async (req, res) => {
  try {
    const diagnostiqueur = req.diagnostiqueur;

    const factures = await stripeService.getFactures(diagnostiqueur._id);

    res.json({ factures });

  } catch (error) {
    console.error('Erreur getFactures:', error);
    res.status(500).json({ message: 'Erreur lors de la récupération des factures.' });
  }
};

/**
 * STATISTIQUES
 */
exports.getStatistiques = async (req, res) => {
  try {
    const diagnostiqueur = req.diagnostiqueur;

    const missionsTotal = await OrdreMission.countDocuments({ diagnostiqueur: diagnostiqueur._id });
    const missionsEnCours = await OrdreMission.countDocuments({
      diagnostiqueur: diagnostiqueur._id,
      statutAcceptation: 'accepte',
      statut: { $in: ['En Cours', 'Commande'] }
    });
    const missionsTerminees = await OrdreMission.countDocuments({
      diagnostiqueur: diagnostiqueur._id,
      statutAcceptation: 'termine'
    });

    const alertesCritiques = await AlerteDocument.countDocuments({
      diagnostiqueur: diagnostiqueur._id,
      statut: 'active',
      niveau: { $in: ['critique', 'expire'] }
    });

    const stats = await notationService.getStatistiquesNotation(diagnostiqueur._id);

    res.json({
      missions: {
        total: missionsTotal,
        enCours: missionsEnCours,
        terminees: missionsTerminees
      },
      alertesCritiques,
      notations: stats,
      noteGlobale: diagnostiqueur.noteGlobale,
      nombreEvaluations: diagnostiqueur.nombreEvaluations
    });

  } catch (error) {
    console.error('Erreur getStatistiques:', error);
    res.status(500).json({ message: 'Erreur lors de la récupération des statistiques.' });
  }
};

/**
 * DOMAINES - Liste
 */
exports.getDomaines = async (req, res) => {
  try {
    const domaines = await DomaineActivite.find({ actif: true }).sort({ nom: 1 });

    res.json({ domaines });

  } catch (error) {
    console.error('Erreur getDomaines:', error);
    res.status(500).json({ message: 'Erreur lors de la récupération des domaines.' });
  }
};
