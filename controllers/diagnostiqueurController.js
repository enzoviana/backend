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
const sendEmail = require('../utils/sendEmails');

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

    // Envoyer email de confirmation au diagnostiqueur
    try {
      await sendEmail({
        to: admin.email,
        subject: 'Bienvenue sur Dimotec - Inscription réussie',
        template: 'InscriptionDiagnostiqueur.html',
        variables: {
          prenom: admin.prenom,
          nom: admin.nom,
          nom_entreprise,
          siret,
          email: admin.email
        }
      });
      console.log(`✅ Email d'inscription envoyé à ${admin.email}`);
    } catch (emailError) {
      console.error('❌ Erreur envoi email inscription:', emailError);
      // On ne bloque pas l'inscription si l'email échoue
    }

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

    // Envoyer email avec lien de réinitialisation
    const resetUrl = `${process.env.FRONTEND_DIAGNOSTIQUEUR_URL || 'https://diagnostiqueur.dimotec.fr'}/reset-password/${resetToken}`;

    try {
      await sendEmail({
        to: email,
        subject: 'Réinitialisation de votre mot de passe - Dimotec',
        template: 'ResetPassword.html',
        variables: {
          nomClient: `${diagnostiqueur.admin.prenom} ${diagnostiqueur.admin.nom}`,
          lienReinitialisation: resetUrl
        }
      });
      console.log(`✅ Email de réinitialisation envoyé à ${email}`);
    } catch (emailError) {
      console.error('❌ Erreur envoi email réinitialisation:', emailError);
      // On retourne une erreur si l'email n'a pas pu être envoyé
      return res.status(500).json({ message: 'Erreur lors de l\'envoi de l\'email de réinitialisation.' });
    }

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
    const allowedUpdates = ['nom_entreprise', 'adresse', 'email_entreprise', 'secteursIntervention', 'description'];

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

    // Vérifier les limites du plan
    const nombreTechniciensActuels = await TechnicienDiagnostiqueur.countDocuments({
      diagnostiqueur: diagnostiqueur._id
    });

    // Limites selon le plan
    const limitesTechnicians = {
      'STANDARD': 1,
      'PRO': 5
    };

    const limite = limitesTechnicians[diagnostiqueur.typeAbonnement] || 1;

    if (nombreTechniciensActuels >= limite) {
      return res.status(403).json({
        message: `Limite de techniciens atteinte pour le plan ${diagnostiqueur.typeAbonnement}. Vous pouvez ajouter jusqu'à ${limite} technicien(s).`,
        limite,
        actuel: nombreTechniciensActuels,
        planActuel: diagnostiqueur.typeAbonnement
      });
    }

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
      mentionSpeciale,
      notes
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
    console.log('📤 Upload Cloudinary en cours...', {
      filePath: req.file.path,
      fileName: req.file.originalname,
      folder: `diagnostiqueurs/${diagnostiqueur._id}/certifications`
    });

    const result = await cloudinary.uploader.upload(req.file.path, {
      folder: `diagnostiqueurs/${diagnostiqueur._id}/certifications`,
      resource_type: 'auto'
    });

    console.log('✅ Upload Cloudinary réussi:', {
      url: result.secure_url,
      public_id: result.public_id
    });

    // Vérifier que l'URL est bien présente
    if (!result.secure_url) {
      throw new Error('URL Cloudinary non générée après upload');
    }

    // Créer la certification en attente d'approbation
    const certification = await Certification.create({
      technicien: technicienId,
      diagnostiqueur: diagnostiqueur._id,
      domaine: domaineId,
      numeroCertification,
      organisme,
      dateObtention: new Date(dateObtention),
      dateExpiration: new Date(dateExpiration),
      mentionSpeciale: mentionSpeciale || null,
      notes: notes || '',
      document: {
        nom: req.file.originalname,
        url: result.secure_url,
        public_id: result.public_id,
        dateDepot: new Date()
      },
      statut: 'en_attente',
      approbation: {
        statutApprobation: 'en_attente',
        approuvePar: null,
        dateApprobation: null,
        raisonRejet: null,
        commentaireAdmin: null
      }
    });

    // Ajouter la certification au technicien
    technicien.certifications.push(certification._id);
    await technicien.save();

    const certificationPopulated = await Certification.findById(certification._id)
      .populate('technicien')
      .populate('domaine');

    res.status(201).json({
      message: 'Certification ajoutée et en attente d\'approbation par l\'administrateur.',
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

    // Vérifier si des champs critiques sont modifiés
    const champsModifies = ['numeroCertification', 'organisme', 'dateObtention', 'dateExpiration'];
    const aDesModificationsCritiques = champsModifies.some(champ => updates[champ] !== undefined);

    // Si certification approuvée et modifications critiques, remettre en attente
    if (aDesModificationsCritiques && certification.approbation.statutApprobation === 'approuve') {
      certification.approbation.statutApprobation = 'en_attente';
      certification.approbation.dateApprobation = null;
      certification.approbation.approuvePar = null;
      certification.approbation.commentaireAdmin = 'Remise en attente suite à modification';
      certification.statut = 'en_attente';
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
      .populate({
        path: 'devisId',
        populate: [
          { path: 'pack', populate: 'diagnostics' },
          { path: 'diagnosticsSelectionnes' }
        ]
      })
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
 * MISSIONS - Mettre à jour la date de RDV
 */
exports.updateMissionRdv = async (req, res) => {
  try {
    const { missionId } = req.params;
    const { rdvDate } = req.body;
    const diagnostiqueur = req.diagnostiqueur;

    const mission = await OrdreMission.findOne({
      _id: missionId,
      diagnostiqueur: diagnostiqueur._id
    });

    if (!mission) {
      return res.status(404).json({ message: 'Mission non trouvée.' });
    }

    mission.rdvDate = new Date(rdvDate);
    await mission.save();

    res.json({
      message: 'Date de rendez-vous mise à jour.',
      mission
    });

  } catch (error) {
    console.error('Erreur updateMissionRdv:', error);
    res.status(500).json({ message: 'Erreur lors de la mise à jour de la date de RDV.' });
  }
};

/**
 * MISSIONS - Clôturer une mission
 */
exports.cloturerMission = async (req, res) => {
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

    // Vérifier que la mission est acceptée
    if (mission.statutAcceptation !== 'accepte') {
      return res.status(400).json({ message: 'Seules les missions acceptées peuvent être clôturées.' });
    }

    // Mettre à jour le statut d'acceptation à 'termine'
    mission.statutAcceptation = 'termine';
    mission.statut = 'Traité'; // Optionnel : mettre aussi le statut à Traité
    await mission.save();

    res.json({
      message: 'Mission clôturée avec succès.',
      mission
    });

  } catch (error) {
    console.error('Erreur cloturerMission:', error);
    res.status(500).json({ message: 'Erreur lors de la clôture de la mission.' });
  }
};

/**
 * MISSIONS - Télécharger l'ordre de mission en PDF
 */
exports.downloadOrdreMission = async (req, res) => {
  try {
    const { missionId } = req.params;
    const diagnostiqueur = req.diagnostiqueur;

    const mission = await OrdreMission.findOne({
      _id: missionId,
      diagnostiqueur: diagnostiqueur._id
    })
      .populate({
        path: 'devisId',
        populate: [
          { path: 'pack', populate: { path: 'diagnostics' } },
          { path: 'diagnosticsSelectionnes' },
          { path: 'supplementsSelectionnes' }
        ]
      })
      .populate('clientId')
      .populate('agenceId');

    if (!mission) {
      return res.status(404).json({ message: 'Mission non trouvée.' });
    }

    const PDFDocument = require('pdfkit');
    const doc = new PDFDocument({ margin: 50 });

    // Headers pour le téléchargement
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="OrdreMission_${mission.numero}.pdf"`);

    // Pipe le PDF vers la réponse
    doc.pipe(res);

    // En-tête
    doc.fontSize(20).font('Helvetica-Bold').text('ORDRE DE MISSION', { align: 'center' });
    doc.moveDown(0.5);
    doc.fontSize(10).font('Helvetica').text('DIMOTEC CONTROLES', { align: 'center' });
    doc.text('298 rue d\'Alco, 34080 Montpellier', { align: 'center' });
    doc.text('SIRET 921 392 775 00018 - Tél : 04 67 60 50 18', { align: 'center' });
    doc.moveDown(2);

    // Informations de la mission
    doc.fontSize(12).font('Helvetica-Bold').text('Informations de la mission', { underline: true });
    doc.moveDown(0.5);
    doc.fontSize(10).font('Helvetica');
    doc.text(`Numéro de mission : ${mission.numero}`);
    doc.text(`Date de création : ${new Date(mission.dateCreation).toLocaleDateString('fr-FR')}`);
    doc.text(`Statut : ${mission.statut}`);
    if (mission.rdvDate) {
      doc.text(`Date de RDV : ${new Date(mission.rdvDate).toLocaleString('fr-FR')}`);
    }
    doc.moveDown(1.5);

    // Informations du client
    doc.fontSize(12).font('Helvetica-Bold').text('Client (Propriétaire)', { underline: true });
    doc.moveDown(0.5);
    doc.fontSize(10).font('Helvetica');
    doc.text(`Nom : ${mission.clientId?.nom || 'N/A'} ${mission.clientId?.prenom || ''}`);
    doc.text(`Email : ${mission.clientId?.email || 'N/A'}`);
    doc.text(`Téléphone : ${mission.clientId?.telephone || 'N/A'}`);
    doc.text(`Adresse : ${mission.clientId?.adresse || 'N/A'}`);
    doc.text(`Ville : ${mission.clientId?.codePostal || ''} ${mission.clientId?.ville || 'N/A'}`);
    doc.moveDown(1.5);

    // Informations du bien
    if (mission.devisId?.adresseBien) {
      doc.fontSize(12).font('Helvetica-Bold').text('Bien immobilier', { underline: true });
      doc.moveDown(0.5);
      doc.fontSize(10).font('Helvetica');
      doc.text(`Type : ${mission.devisId.bien || 'N/A'}`);
      doc.text(`Adresse : ${mission.devisId.adresseBien.adresse || 'N/A'}`);
      doc.text(`Ville : ${mission.devisId.adresseBien.codePostal || ''} ${mission.devisId.adresseBien.ville || 'N/A'}`);
      if (mission.devisId.adresseBien.etage) {
        doc.text(`Étage : ${mission.devisId.adresseBien.etage}`);
      }
      doc.moveDown(1.5);
    }

    // Diagnostics à effectuer
    doc.fontSize(12).font('Helvetica-Bold').text('Diagnostics à effectuer', { underline: true });
    doc.moveDown(0.5);
    doc.fontSize(10).font('Helvetica');

    const diagnostics = [];
    if (mission.devisId?.pack?.diagnostics) {
      // Filtrer les diagnostics du pack selon la tranche d'année du devis
      const devisTrancheAnnee = mission.devisId.anneeConstruction;
      const diagnosticsFiltres = mission.devisId.pack.diagnostics.filter(diag => {
        const diagTrancheAnnee = Array.isArray(diag.trancheAnnee) ? diag.trancheAnnee : [];
        const nomDiag = (diag.nom || '').toLowerCase();

        // ❌ EXCLURE GAZ et Audits car ce sont des suppléments conditionnels
        const isGaz = nomDiag.includes('gaz');
        const isAudit = nomDiag.includes('audit');
        if (isGaz || isAudit) {
          return false;
        }

        // ❌ EXCLURE Surface uniquement pour les MAISONS
        const isSurface = nomDiag.includes('surface') || nomDiag.includes('copropriét');
        if (isSurface && mission.devisId.bien === 'maison') {
          return false;
        }

        // ✅ Le diagnostic est compatible UNIQUEMENT si :
        // - Il a EXACTEMENT la même tranche d'année que le devis
        // - On ignore les diagnostics avec "toutes"
        const matchTranche = diagTrancheAnnee.includes(devisTrancheAnnee);

        return matchTranche;
      });
      diagnostics.push(...diagnosticsFiltres);
    }
    if (mission.devisId?.diagnosticsSelectionnes) {
      diagnostics.push(...mission.devisId.diagnosticsSelectionnes);
    }

    if (diagnostics.length > 0) {
      diagnostics.forEach((diag, index) => {
        doc.text(`${index + 1}. ${diag.nom || 'Diagnostic'}`);
      });
    } else {
      doc.text('Aucun diagnostic assigné');
    }
    doc.moveDown(1.5);

    // Informations financières
    doc.fontSize(12).font('Helvetica-Bold').text('Informations financières', { underline: true });
    doc.moveDown(0.5);
    doc.fontSize(10).font('Helvetica');
    doc.text(`Numéro de devis : ${mission.devisId?.numero || 'N/A'}`);
    doc.text(`Montant TTC : ${mission.devisId?.totalApresReduction || mission.devisId?.montantTTC || 'N/A'} €`);
    doc.moveDown(1.5);

    // Diagnostiqueur
    doc.fontSize(12).font('Helvetica-Bold').text('Diagnostiqueur assigné', { underline: true });
    doc.moveDown(0.5);
    doc.fontSize(10).font('Helvetica');
    doc.text(`Entreprise : ${diagnostiqueur.nom_entreprise || 'N/A'}`);
    doc.text(`Email : ${diagnostiqueur.admin?.email || diagnostiqueur.email_entreprise || 'N/A'}`);
    doc.moveDown(2);

    // Footer
    doc.fontSize(8).font('Helvetica').text(
      'Document généré automatiquement par DIMOTEC CONTROLES',
      { align: 'center' }
    );

    // Finaliser le PDF
    doc.end();

  } catch (error) {
    console.error('Erreur downloadOrdreMission:', error);
    res.status(500).json({ message: 'Erreur lors du téléchargement de l\'ordre de mission.' });
  }
};

/**
 * DEVIS - Liste
 */
exports.getDevis = async (req, res) => {
  console.log('--- Debug getDevis ---');
  try {
    const diagnostiqueur = req.diagnostiqueur;
    
    // Log 1: Vérification de l'utilisateur extrait du middleware
    console.log('ID Diagnostiqueur extrait:', diagnostiqueur?._id);

    if (!diagnostiqueur?._id) {
      console.warn('Attention: Aucun ID diagnostiqueur trouvé dans la requête');
    }

    console.log('Recherche des devis en cours...');
    
    const devis = await Devis.find({
      diagnostiqueurAssigne: diagnostiqueur._id
    })
      .populate('agenceId')
      .sort({ dateCreation: -1 })
      .limit(50);

    // Log 2: Résultat de la requête
    console.log(`Nombre de devis trouvés: ${devis.length}`);
    
    // Log 3 (Optionnel): Voir le premier devis pour vérifier le populate
    if (devis.length > 0) {
      console.log('Exemple du premier devis (agenceId):', devis[0].agenceId ? 'Peuplé ✅' : 'Non peuplé ❌');
    }

    res.json({ devis });

  } catch (error) {
    // Log 4: Erreur détaillée
    console.error('❌ Erreur getDevis:', error);
    res.status(500).json({ 
      message: 'Erreur lors de la récupération des devis.',
      error: error.message // Utile en dev, à retirer en prod
    });
  } finally {
    console.log('--- Fin de traitement getDevis ---');
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
      .populate({
        path: 'pack',
        populate: { path: 'diagnostics' }
      })
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
    console.log("=== UPGRADE ABONNEMENT START ===");

    const diagnostiqueur = req.diagnostiqueur;
    const { returnUrl, cancelUrl } = req.body;

    console.log("Diagnostiqueur reçu :", diagnostiqueur);
    console.log("ID diagnostiqueur :", diagnostiqueur?._id);
    console.log("Type abonnement actuel :", diagnostiqueur?.typeAbonnement);
    console.log("Body reçu :", req.body);
    console.log("Return URL :", returnUrl);
    console.log("Cancel URL :", cancelUrl);
    console.log("FRONTEND_DIAGNOSTIQUEUR_URL :", process.env.FRONTEND_DIAGNOSTIQUEUR_URL);

    if (diagnostiqueur.typeAbonnement === 'PRO') {
      console.log("⛔ Déjà PRO, on bloque l'upgrade.");
      return res.status(400).json({ message: 'Vous êtes déjà abonné PRO.' });
    }

    const finalReturnUrl =
      returnUrl || `${process.env.FRONTEND_DIAGNOSTIQUEUR_URL}/abonnement`;
    const finalCancelUrl =
      cancelUrl || `${process.env.FRONTEND_DIAGNOSTIQUEUR_URL}/abonnement`;

    console.log("Final Return URL :", finalReturnUrl);
    console.log("Final Cancel URL :", finalCancelUrl);

    console.log("➡️ Création session Stripe...");
    const session = await stripeService.creerCheckoutSession(
      diagnostiqueur._id,
      finalReturnUrl,
      finalCancelUrl
    );

    console.log("✅ Session Stripe créée :", session);
    console.log("Session ID :", session?.id);
    console.log("Session URL :", session?.url);

    console.log("=== UPGRADE ABONNEMENT SUCCESS ===");

    res.json({
      sessionId: session.id,
      sessionUrl: session.url
    });

  } catch (error) {
    console.error("❌ Erreur upgradeAbonnement:");
    console.error("Message :", error.message);
    console.error("Stack :", error.stack);
    console.error("Erreur complète :", error);

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

/**
 * INFORMATIONS BANCAIRES - Mettre à jour
 */
exports.updateInformationsBancaires = async (req, res) => {
  try {
    const diagnostiqueur = req.diagnostiqueur;
    const { iban, bic, titulaire, banque } = req.body;

    // Validation basique IBAN (format FR)
    if (iban && !iban.match(/^FR\d{2}[A-Z0-9]{23}$/)) {
      return res.status(400).json({ message: 'Format IBAN invalide. Format attendu: FR + 2 chiffres + 23 caractères alphanumériques.' });
    }

    diagnostiqueur.informationsBancaires = {
      iban: iban || diagnostiqueur.informationsBancaires?.iban || null,
      bic: bic || diagnostiqueur.informationsBancaires?.bic || null,
      titulaire: titulaire || diagnostiqueur.informationsBancaires?.titulaire || null,
      banque: banque || diagnostiqueur.informationsBancaires?.banque || null,
      verifie: false,
      dateVerification: null
    };

    await diagnostiqueur.save();

    res.json({
      message: 'Informations bancaires mises à jour avec succès',
      informationsBancaires: diagnostiqueur.informationsBancaires
    });
  } catch (error) {
    console.error('Erreur updateInformationsBancaires:', error);
    res.status(500).json({ message: 'Erreur lors de la mise à jour des informations bancaires.' });
  }
};

/**
 * ZONE INTERVENTION - Mettre à jour
 */
exports.updateZoneIntervention = async (req, res) => {
  try {
    const diagnostiqueur = req.diagnostiqueur;
    const { departements, villes, rayonKm, preferences } = req.body;

    diagnostiqueur.zoneIntervention = {
      departements: departements || [],
      villes: villes || [],
      rayonKm: rayonKm || 50,
      preferences: preferences || null
    };

    await diagnostiqueur.save();

    res.json({
      message: 'Zone d\'intervention mise à jour avec succès',
      zoneIntervention: diagnostiqueur.zoneIntervention
    });
  } catch (error) {
    console.error('Erreur updateZoneIntervention:', error);
    res.status(500).json({ message: 'Erreur lors de la mise à jour de la zone d\'intervention.' });
  }
};

/**
 * NIVEAU EXPERTISE - Ajouter ou mettre à jour
 */
exports.addNiveauExpertise = async (req, res) => {
  try {
    const diagnostiqueur = req.diagnostiqueur;
    const { domaineId, niveau, anneesExperience, specialites } = req.body;

    if (!domaineId || !niveau) {
      return res.status(400).json({ message: 'Domaine et niveau requis' });
    }

    // Vérifier que le domaine existe
    const domaine = await DomaineActivite.findById(domaineId);
    if (!domaine) {
      return res.status(404).json({ message: 'Domaine non trouvé' });
    }

    // Initialiser detailsCertifications si nécessaire
    if (!diagnostiqueur.detailsCertifications) {
      diagnostiqueur.detailsCertifications = { niveauxExpertise: [], formationsContinues: [] };
    }

    // Vérifier si niveau d'expertise existe déjà pour ce domaine
    const existant = diagnostiqueur.detailsCertifications.niveauxExpertise.find(
      n => n.domaine.toString() === domaineId
    );

    if (existant) {
      // Mettre à jour
      existant.niveau = niveau;
      existant.anneesExperience = anneesExperience || 0;
      existant.specialites = specialites || [];
    } else {
      // Ajouter
      diagnostiqueur.detailsCertifications.niveauxExpertise.push({
        domaine: domaineId,
        niveau,
        anneesExperience: anneesExperience || 0,
        specialites: specialites || []
      });
    }

    await diagnostiqueur.save();

    // Repopuler pour retourner les infos complètes
    await diagnostiqueur.populate('detailsCertifications.niveauxExpertise.domaine');

    res.json({
      message: 'Niveau d\'expertise ajouté/mis à jour avec succès',
      niveauxExpertise: diagnostiqueur.detailsCertifications.niveauxExpertise
    });
  } catch (error) {
    console.error('Erreur addNiveauExpertise:', error);
    res.status(500).json({ message: 'Erreur lors de l\'ajout du niveau d\'expertise.' });
  }
};

/**
 * DEVIS - Récupérer tous les devis assignés au diagnostiqueur
 */
exports.getMesDevis = async (req, res) => {
  try {
    const diagnostiqueur = req.diagnostiqueur;

    const devis = await Devis.find({
      diagnostiqueurAssigne: diagnostiqueur._id
    })
    .populate('agenceId') // OK : existe dans ton modèle
    .populate('pack')     // OK : existe dans ton modèle
    .populate('diagnosticsSelectionnes') // OK : existe dans ton modèle
    // .populate('clientId') <-- SUPPRIMÉ car c'est un objet interne 'client'
    .sort({ dateCreation: -1 })
    .limit(50);

    // Les infos client seront accessibles via devis.client.nom, etc.
    res.json({ devis });

  } catch (error) {
    console.error('Erreur getMesDevis:', error);
    res.status(500).json({ message: 'Erreur lors de la récupération des devis.' });
  }
};

/**
 * DEVIS - Refuser un devis avec une raison
 */
exports.refuserDevis = async (req, res) => {
  try {
    const { devisId } = req.params;
    const { raison } = req.body;
    const diagnostiqueur = req.diagnostiqueur;

    if (!raison || raison.trim().length === 0) {
      return res.status(400).json({ message: 'Veuillez fournir une raison de refus.' });
    }

    const devis = await Devis.findOne({
      _id: devisId,
      diagnostiqueurAssigne: diagnostiqueur._id
    });

    if (!devis) {
      return res.status(404).json({ message: 'Devis non trouvé ou non assigné à vous.' });
    }

    // Mettre à jour le devis avec le statut refusé et la raison
    devis.statut = 'Refusé';
    devis.raisonRefus = raison;
    devis.diagnostiqueurAssigne = null; // Libérer le diagnostiqueur assigné

    await devis.save();

    res.json({
      message: 'Devis refusé avec succès.',
      devis
    });

  } catch (error) {
    console.error('Erreur refuserDevis:', error);
    res.status(500).json({ message: 'Erreur lors du refus du devis.' });
  }
};

/**
 * ASSURANCES - Récupérer les assurances du diagnostiqueur
 */
exports.getAssurances = async (req, res) => {
  try {
    const diagnostiqueur = req.diagnostiqueur;

    const assurances = diagnostiqueur.documents.filter(
      doc => doc.type === 'assurance_rc' || doc.type === 'assurance_decennale'
    );

    res.json({ assurances });

  } catch (error) {
    console.error('Erreur getAssurances:', error);
    res.status(500).json({ message: 'Erreur lors de la récupération des assurances.' });
  }
};

/**
 * ASSURANCES - Upload une nouvelle assurance
 */
exports.uploadAssurance = async (req, res) => {
  try {
    const { type, dateExpiration } = req.body;
    const diagnostiqueur = req.diagnostiqueur;

    if (!req.file) {
      return res.status(400).json({ message: 'Veuillez fournir un fichier PDF.' });
    }

    if (!type || (type !== 'assurance_rc' && type !== 'assurance_decennale')) {
      return res.status(400).json({ message: 'Type d\'assurance invalide.' });
    }

    if (!dateExpiration) {
      return res.status(400).json({ message: 'Veuillez fournir une date d\'expiration.' });
    }

    // Vérifier si une assurance du même type existe déjà
    const existingIndex = diagnostiqueur.documents.findIndex(doc => doc.type === type);

    const newDocument = {
      type,
      nom: req.file.originalname,
      url: req.file.path,
      public_id: req.file.filename,
      dateExpiration: new Date(dateExpiration),
      dateDepot: new Date(),
      statut: 'en_attente'
    };

    if (existingIndex !== -1) {
      // Remplacer l'ancienne assurance
      diagnostiqueur.documents[existingIndex] = newDocument;
    } else {
      // Ajouter la nouvelle assurance
      diagnostiqueur.documents.push(newDocument);
    }

    await diagnostiqueur.save();

    res.json({
      message: 'Assurance enregistrée avec succès.',
      document: newDocument
    });

  } catch (error) {
    console.error('Erreur uploadAssurance:', error);
    res.status(500).json({ message: 'Erreur lors de l\'upload de l\'assurance.' });
  }
};

/**
 * TECHNICIENS - Initialiser technicien par défaut
 * Crée automatiquement un technicien par défaut si le diagnostiqueur n'en a pas
 */
exports.initTechnicienDefaut = async (req, res) => {
  try {
    const diagnostiqueur = req.diagnostiqueur;

    // Vérifier si le diagnostiqueur a déjà des techniciens
    const techniciensExistants = await TechnicienDiagnostiqueur.countDocuments({
      diagnostiqueur: diagnostiqueur._id
    });

    if (techniciensExistants > 0) {
      // Récupérer les techniciens existants
      const techniciens = await TechnicienDiagnostiqueur.find({
        diagnostiqueur: diagnostiqueur._id
      });

      return res.json({
        message: 'Technicien(s) déjà existant(s)',
        alreadyExists: true,
        techniciens
      });
    }

    // Vérifier les limites du plan
    const limitesTechnicians = {
      'STANDARD': 1,
      'PRO': 5
    };

    const limite = limitesTechnicians[diagnostiqueur.typeAbonnement] || 1;

    // Créer un technicien par défaut avec les infos du diagnostiqueur
    const technicienData = {
      diagnostiqueur: diagnostiqueur._id,
      nom: diagnostiqueur.admin?.nom || 'Nom',
      prenom: diagnostiqueur.admin?.prenom || 'Prénom',
      email: diagnostiqueur.admin?.email || 'email@example.com',
      telephone: diagnostiqueur.admin?.telephone || '0000000000',
      actif: true
    };

    const technicien = await TechnicienDiagnostiqueur.create(technicienData);

    console.log(`✅ Technicien par défaut créé pour ${diagnostiqueur.nom_entreprise}`);

    res.status(201).json({
      message: 'Technicien par défaut créé avec succès',
      created: true,
      technicien,
      limites: {
        plan: diagnostiqueur.typeAbonnement,
        maxTechniciens: limite,
        actuel: 1
      }
    });

  } catch (error) {
    console.error('Erreur initTechnicienDefaut:', error);
    res.status(500).json({
      message: 'Erreur lors de l\'initialisation du technicien par défaut.',
      error: error.message
    });
  }
};
