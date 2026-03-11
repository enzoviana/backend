const Diagnostiqueur = require('../models/Diagnostiqueur');
const Certification = require('../models/Certification');
const OrdreMission = require('../models/OrdreMission');
const DomaineActivite = require('../models/DomaineActivite');
const eligibiliteService = require('../services/eligibiliteService');

/**
 * Récupérer tous les diagnostiqueurs
 */
exports.getAllDiagnostiqueurs = async (req, res) => {
  try {
    const { statut, typeAbonnement, search } = req.query;

    const query = {};

    if (statut) query.statut = statut;
    if (typeAbonnement) query.typeAbonnement = typeAbonnement;
    if (search) {
      query.$or = [
        { nom_entreprise: { $regex: search, $options: 'i' } },
        { siret: { $regex: search, $options: 'i' } },
        { 'admin.email': { $regex: search, $options: 'i' } }
      ];
    }

    const diagnostiqueurs = await Diagnostiqueur.find(query)
      .select('-admin.mot_de_passe -admin.resetPasswordToken')
      .sort({ createdAt: -1 })
      .limit(100);

    // Enrichir chaque diagnostiqueur avec certifications et statistiques
    const diagnostiqueursEnrichis = await Promise.all(
      diagnostiqueurs.map(async (diag) => {
        // Mettre à jour le statut des documents expirés
        const now = new Date();
        let documentsModifies = false;

        if (diag.documents && diag.documents.length > 0) {
          diag.documents.forEach(doc => {
            if (doc.dateExpiration && new Date(doc.dateExpiration) < now && doc.statut === 'valide') {
              doc.statut = 'expire';
              documentsModifies = true;
            }
          });

          if (documentsModifies) {
            await diag.save();
          }
        }

        // Récupérer les certifications
        const certifications = await Certification.find({ diagnostiqueur: diag._id })
          .populate('technicien')
          .populate('domaine')
          .sort({ dateExpiration: 1 });

        // Récupérer les statistiques de missions
        const missionsTotal = await OrdreMission.countDocuments({ diagnostiqueur: diag._id });
        const missionsCompletes = await OrdreMission.countDocuments({
          diagnostiqueur: diag._id,
          statut: 'Traité'
        });

        // Calculer la note moyenne (à partir des notations clients)
        const missions = await OrdreMission.find({
          diagnostiqueur: diag._id,
          noteClient: { $exists: true, $ne: null }
        }).select('noteClient');

        let noteMoyenne = 'N/A';
        if (missions.length > 0) {
          const sommeNotes = missions.reduce((acc, m) => acc + (m.noteClient || 0), 0);
          noteMoyenne = (sommeNotes / missions.length).toFixed(1);
        }

        return {
          ...diag.toObject(),
          certifications,
          stats: {
            missions: missionsTotal,
            missionsCompletes,
            note: noteMoyenne
          }
        };
      })
    );

    res.json({ diagnostiqueurs: diagnostiqueursEnrichis });

  } catch (error) {
    console.error('Erreur getAllDiagnostiqueurs:', error);
    res.status(500).json({ message: 'Erreur lors de la récupération des diagnostiqueurs.' });
  }
};

/**
 * Récupérer un diagnostiqueur par ID
 */
exports.getDiagnostiqueurById = async (req, res) => {
  try {
    const { id } = req.params;

    const diagnostiqueur = await Diagnostiqueur.findById(id)
      .select('-admin.mot_de_passe -admin.resetPasswordToken')
      .populate('validePar', 'nom prenom email');

    if (!diagnostiqueur) {
      return res.status(404).json({ message: 'Diagnostiqueur non trouvé.' });
    }

    // Récupérer les certifications
    const certifications = await Certification.find({ diagnostiqueur: id })
      .populate('technicien')
      .populate('domaine');

    // Récupérer les missions
    const missionsCount = await OrdreMission.countDocuments({ diagnostiqueur: id });

    res.json({
      diagnostiqueur,
      certifications,
      missionsCount
    });

  } catch (error) {
    console.error('Erreur getDiagnostiqueurById:', error);
    res.status(500).json({ message: 'Erreur lors de la récupération du diagnostiqueur.' });
  }
};

/**
 * Valider un diagnostiqueur (activer son compte)
 */
exports.validerDiagnostiqueur = async (req, res) => {
  try {
    const { id } = req.params;
    const adminId = req.user.id;

    const diagnostiqueur = await Diagnostiqueur.findById(id);

    if (!diagnostiqueur) {
      return res.status(404).json({ message: 'Diagnostiqueur non trouvé.' });
    }

    if (diagnostiqueur.statut !== 'en_attente') {
      return res.status(400).json({ message: 'Ce diagnostiqueur a déjà été traité.' });
    }

    diagnostiqueur.statut = 'actif';
    diagnostiqueur.validePar = adminId;
    diagnostiqueur.dateValidation = new Date();

    await diagnostiqueur.save();

    // TODO: Envoyer email de confirmation au diagnostiqueur

    res.json({
      message: 'Diagnostiqueur validé avec succès.',
      diagnostiqueur
    });

  } catch (error) {
    console.error('Erreur validerDiagnostiqueur:', error);
    res.status(500).json({ message: 'Erreur lors de la validation du diagnostiqueur.' });
  }
};

/**
 * Bloquer un diagnostiqueur
 */
exports.bloquerDiagnostiqueur = async (req, res) => {
  try {
    const { id } = req.params;
    const { raison } = req.body;

    const diagnostiqueur = await Diagnostiqueur.findById(id);

    if (!diagnostiqueur) {
      return res.status(404).json({ message: 'Diagnostiqueur non trouvé.' });
    }

    diagnostiqueur.statut = 'bloqué';

    await diagnostiqueur.save();

    // TODO: Envoyer email au diagnostiqueur avec la raison

    res.json({
      message: 'Diagnostiqueur bloqué avec succès.',
      diagnostiqueur
    });

  } catch (error) {
    console.error('Erreur bloquerDiagnostiqueur:', error);
    res.status(500).json({ message: 'Erreur lors du blocage du diagnostiqueur.' });
  }
};

/**
 * Changer le statut d'un diagnostiqueur
 */
exports.changerStatutDiagnostiqueur = async (req, res) => {
  try {
    const { id } = req.params;
    const { statut } = req.body;

    const diagnostiqueur = await Diagnostiqueur.findById(id);

    if (!diagnostiqueur) {
      return res.status(404).json({ message: 'Diagnostiqueur non trouvé.' });
    }

    diagnostiqueur.statut = statut;

    await diagnostiqueur.save();

    res.json({
      message: 'Statut mis à jour avec succès.',
      diagnostiqueur
    });

  } catch (error) {
    console.error('Erreur changerStatutDiagnostiqueur:', error);
    res.status(500).json({ message: 'Erreur lors du changement de statut.' });
  }
};

/**
 * Supprimer un diagnostiqueur
 */
exports.deleteDiagnostiqueur = async (req, res) => {
  try {
    const { id } = req.params;

    const diagnostiqueur = await Diagnostiqueur.findById(id);

    if (!diagnostiqueur) {
      return res.status(404).json({ message: 'Diagnostiqueur non trouvé.' });
    }

    // Vérifier s'il a des missions en cours
    const missionsEnCours = await OrdreMission.countDocuments({
      diagnostiqueur: id,
      statut: { $in: ['Commande', 'En Cours'] }
    });

    if (missionsEnCours > 0) {
      return res.status(400).json({ message: 'Impossible de supprimer un diagnostiqueur avec des missions en cours.' });
    }

    // Supprimer les certifications
    await Certification.deleteMany({ diagnostiqueur: id });

    // Supprimer le diagnostiqueur
    await diagnostiqueur.deleteOne();

    res.json({ message: 'Diagnostiqueur supprimé avec succès.' });

  } catch (error) {
    console.error('Erreur deleteDiagnostiqueur:', error);
    res.status(500).json({ message: 'Erreur lors de la suppression du diagnostiqueur.' });
  }
};

/**
 * Récupérer les certifications d'un diagnostiqueur
 */
exports.getCertificationsDiagnostiqueur = async (req, res) => {
  try {
    const { id } = req.params;

    const certifications = await Certification.find({ diagnostiqueur: id })
      .populate('technicien')
      .populate('domaine')
      .sort({ dateExpiration: 1 });

    res.json({ certifications });

  } catch (error) {
    console.error('Erreur getCertificationsDiagnostiqueur:', error);
    res.status(500).json({ message: 'Erreur lors de la récupération des certifications.' });
  }
};

/**
 * Vérifier l'éligibilité d'un diagnostiqueur pour un devis
 */
exports.verifierEligibilite = async (req, res) => {
  try {
    const { id } = req.params;
    const { devisId } = req.body;

    const resultat = await eligibiliteService.verifierEligibilite(id, devisId);

    res.json(resultat);

  } catch (error) {
    console.error('Erreur verifierEligibilite:', error);
    res.status(500).json({ message: 'Erreur lors de la vérification de l\'éligibilité.' });
  }
};

/**
 * Statistiques globales des diagnostiqueurs
 */
exports.getStatistiquesGlobales = async (req, res) => {
  try {
    const total = await Diagnostiqueur.countDocuments();
    const actifs = await Diagnostiqueur.countDocuments({ statut: 'actif' });
    const enAttente = await Diagnostiqueur.countDocuments({ statut: 'en_attente' });
    const bloques = await Diagnostiqueur.countDocuments({ statut: 'bloqué' });
    const pro = await Diagnostiqueur.countDocuments({ typeAbonnement: 'PRO' });
    const standard = await Diagnostiqueur.countDocuments({ typeAbonnement: 'STANDARD' });

    res.json({
      total,
      statuts: {
        actifs,
        enAttente,
        bloques
      },
      abonnements: {
        pro,
        standard
      }
    });

  } catch (error) {
    console.error('Erreur getStatistiquesGlobales:', error);
    res.status(500).json({ message: 'Erreur lors de la récupération des statistiques.' });
  }
};

/**
 * GESTION DES DOMAINES D'ACTIVITÉ
 */

/**
 * Récupérer tous les domaines
 */
exports.getAllDomaines = async (req, res) => {
  try {
    const domaines = await DomaineActivite.find().sort({ nom: 1 });

    res.json({ domaines });

  } catch (error) {
    console.error('Erreur getAllDomaines:', error);
    res.status(500).json({ message: 'Erreur lors de la récupération des domaines.' });
  }
};

/**
 * Créer un domaine
 */
exports.createDomaine = async (req, res) => {
  try {
    const { code, nom, description, requiresCertification, mentionsSpeciales } = req.body;

    const domaine = await DomaineActivite.create({
      code,
      nom,
      description,
      requiresCertification: requiresCertification !== undefined ? requiresCertification : true,
      mentionsSpeciales: mentionsSpeciales || [],
      actif: true
    });

    res.status(201).json({
      message: 'Domaine créé avec succès.',
      domaine
    });

  } catch (error) {
    console.error('Erreur createDomaine:', error);
    res.status(500).json({ message: 'Erreur lors de la création du domaine.' });
  }
};

/**
 * Mettre à jour un domaine
 */
exports.updateDomaine = async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    const domaine = await DomaineActivite.findById(id);

    if (!domaine) {
      return res.status(404).json({ message: 'Domaine non trouvé.' });
    }

    const allowedUpdates = ['nom', 'description', 'requiresCertification', 'mentionsSpeciales', 'actif'];
    allowedUpdates.forEach(field => {
      if (updates[field] !== undefined) {
        domaine[field] = updates[field];
      }
    });

    await domaine.save();

    res.json({
      message: 'Domaine mis à jour avec succès.',
      domaine
    });

  } catch (error) {
    console.error('Erreur updateDomaine:', error);
    res.status(500).json({ message: 'Erreur lors de la mise à jour du domaine.' });
  }
};

/**
 * Changer le statut d'un document (valider ou refuser)
 */
exports.changerStatutDocument = async (req, res) => {
  try {
    const { id, documentId } = req.params;
    const { statut, raison } = req.body;

    // Vérifier que le statut est valide
    const statutsValides = ['valide', 'refuse', 'en_attente', 'expire'];
    if (!statutsValides.includes(statut)) {
      return res.status(400).json({ message: 'Statut invalide.' });
    }

    const diagnostiqueur = await Diagnostiqueur.findById(id);

    if (!diagnostiqueur) {
      return res.status(404).json({ message: 'Diagnostiqueur non trouvé.' });
    }

    // Trouver le document dans le tableau documents
    const document = diagnostiqueur.documents.id(documentId);

    if (!document) {
      return res.status(404).json({ message: 'Document non trouvé.' });
    }

    // Mettre à jour le statut
    document.statut = statut;

    // Si refusé, ajouter la raison
    if (statut === 'refuse' && raison) {
      document.raisonRefus = raison;
    }

    // Sauvegarder
    await diagnostiqueur.save();

    res.json({
      message: `Document ${statut === 'valide' ? 'validé' : statut === 'refuse' ? 'refusé' : 'mis à jour'} avec succès.`,
      document
    });

  } catch (error) {
    console.error('Erreur changerStatutDocument:', error);
    res.status(500).json({ message: 'Erreur lors de la modification du statut du document.' });
  }
};

/**
 * GET - Télécharger un document d'un diagnostiqueur (proxy Cloudinary sécurisé)
 */
exports.telechargerDocument = async (req, res) => {
  try {
    const { id, documentId } = req.params;

    const diagnostiqueur = await Diagnostiqueur.findById(id);
    if (!diagnostiqueur) {
      return res.status(404).json({ message: 'Diagnostiqueur non trouvé.' });
    }

    // Trouver le document dans le tableau documents
    const document = diagnostiqueur.documents.id(documentId);
    if (!document) {
      return res.status(404).json({ message: 'Document non trouvé.' });
    }

    if (!document.url) {
      return res.status(404).json({ message: 'Aucune URL de document disponible.' });
    }

    const documentUrl = document.url;
    const documentNom = document.nom || `document-${documentId}.pdf`;

    // Récupérer le fichier depuis Cloudinary
    const https = require('https');
    const http = require('http');
    const url = require('url');

    const parsedUrl = url.parse(documentUrl);
    const protocol = parsedUrl.protocol === 'https:' ? https : http;

    protocol.get(documentUrl, (cloudinaryResponse) => {
      if (cloudinaryResponse.statusCode !== 200) {
        return res.status(cloudinaryResponse.statusCode).json({
          message: 'Erreur lors de la récupération du document depuis Cloudinary'
        });
      }

      // Définir les headers pour le téléchargement
      res.setHeader('Content-Type', cloudinaryResponse.headers['content-type'] || 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(documentNom)}"`);
      res.setHeader('Content-Length', cloudinaryResponse.headers['content-length']);

      // Pipe la réponse de Cloudinary vers le client
      cloudinaryResponse.pipe(res);
    }).on('error', (error) => {
      console.error('Erreur téléchargement depuis Cloudinary:', error);
      res.status(500).json({ message: 'Erreur lors du téléchargement du document' });
    });

  } catch (error) {
    console.error('Erreur telechargerDocument:', error);
    res.status(500).json({ message: 'Erreur lors du téléchargement du document.' });
  }
};

module.exports = exports;
