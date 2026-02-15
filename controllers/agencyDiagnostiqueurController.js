const Diagnostiqueur = require('../models/Diagnostiqueur');
const Agency = require('../models/Agency');
const NotationDiagnostiqueur = require('../models/NotationDiagnostiqueur');
const RenouvelementGratuit = require('../models/RenouvelementGratuit');
const OrdreMission = require('../models/OrdreMission');
const Devis = require('../models/Devis');
const notationService = require('../services/notationService');

/**
 * Liste des diagnostiqueurs disponibles pour sélection
 */
exports.getDiagnostiqueurs = async (req, res) => {
  try {
    const { secteur, noteMin } = req.query;

    const query = { statut: 'actif' };

    if (secteur) {
      query.secteursIntervention = secteur;
    }

    if (noteMin) {
      query.noteGlobale = { $gte: parseFloat(noteMin) };
    }

    const diagnostiqueurs = await Diagnostiqueur.find(query)
      .select('nom_entreprise siret logo noteGlobale nombreEvaluations secteursIntervention typeAbonnement')
      .sort({ noteGlobale: -1 })
      .limit(50);

    res.json({ diagnostiqueurs });

  } catch (error) {
    console.error('Erreur getDiagnostiqueurs:', error);
    res.status(500).json({ message: 'Erreur lors de la récupération des diagnostiqueurs.' });
  }
};

/**
 * Détails d'un diagnostiqueur
 */
exports.getDiagnostiqueurDetail = async (req, res) => {
  try {
    const { id } = req.params;

    const diagnostiqueur = await Diagnostiqueur.findOne({ _id: id, statut: 'actif' })
      .select('nom_entreprise siret adresse logo noteGlobale nombreEvaluations secteursIntervention typeAbonnement');

    if (!diagnostiqueur) {
      return res.status(404).json({ message: 'Diagnostiqueur non trouvé.' });
    }

    // Récupérer les notations
    const notations = await NotationDiagnostiqueur.find({
      diagnostiqueur: id,
      statut: 'publie'
    })
      .populate('agence', 'nom_commercial')
      .sort({ dateNotation: -1 })
      .limit(10);

    const stats = await notationService.getStatistiquesNotation(id);

    res.json({
      diagnostiqueur,
      notations,
      statistiques: stats
    });

  } catch (error) {
    console.error('Erreur getDiagnostiqueurDetail:', error);
    res.status(500).json({ message: 'Erreur lors de la récupération du diagnostiqueur.' });
  }
};

/**
 * Définir un diagnostiqueur par défaut pour l'agence
 */
exports.setDiagnostiqueurParDefaut = async (req, res) => {
  try {
    const { diagnostiqueurId } = req.body;
    const agenceId = req.user.id;

    const agence = await Agency.findById(agenceId);

    if (!agence) {
      return res.status(404).json({ message: 'Agence non trouvée.' });
    }

    // Vérifier que le diagnostiqueur existe et est actif
    const diagnostiqueur = await Diagnostiqueur.findOne({ _id: diagnostiqueurId, statut: 'actif' });

    if (!diagnostiqueur) {
      return res.status(404).json({ message: 'Diagnostiqueur non trouvé ou inactif.' });
    }

    agence.diagnostiqueurParDefaut = diagnostiqueurId;
    await agence.save();

    res.json({
      message: 'Diagnostiqueur par défaut défini avec succès.',
      diagnostiqueurParDefaut: diagnostiqueurId
    });

  } catch (error) {
    console.error('Erreur setDiagnostiqueurParDefaut:', error);
    res.status(500).json({ message: 'Erreur lors de la définition du diagnostiqueur par défaut.' });
  }
};

/**
 * Créer une notation pour un diagnostiqueur
 * Note: L'agence note le diagnostiqueur après une mission terminée
 */
exports.createNotation = async (req, res) => {
  try {
    const {
      diagnostiqueurId,
      ordreMissionId,
      note,
      commentaire,
      criteres
    } = req.body;

    const agenceId = req.user.id;

    // Vérifier que la mission appartient à l'agence
    const mission = await OrdreMission.findOne({
      _id: ordreMissionId,
      agenceId: agenceId
    });

    if (!mission) {
      return res.status(404).json({ message: 'Mission non trouvée ou non autorisée.' });
    }

    // Créer la notation via le service
    const notation = await notationService.creerNotation(
      agenceId,
      diagnostiqueurId,
      ordreMissionId,
      {
        note,
        commentaire,
        criteres
      }
    );

    res.status(201).json({
      message: 'Notation créée avec succès.',
      notation
    });

  } catch (error) {
    console.error('Erreur createNotation:', error);
    res.status(500).json({ message: error.message || 'Erreur lors de la création de la notation.' });
  }
};

/**
 * Récupérer les notations d'un diagnostiqueur
 */
exports.getNotationsDiagnostiqueur = async (req, res) => {
  try {
    const { diagnostiqueurId } = req.params;

    const notations = await NotationDiagnostiqueur.find({
      diagnostiqueur: diagnostiqueurId,
      statut: 'publie'
    })
      .populate('agence', 'nom_commercial')
      .populate('ordreMission')
      .sort({ dateNotation: -1 });

    const stats = await notationService.getStatistiquesNotation(diagnostiqueurId);

    res.json({
      notations,
      statistiques: stats
    });

  } catch (error) {
    console.error('Erreur getNotationsDiagnostiqueur:', error);
    res.status(500).json({ message: 'Erreur lors de la récupération des notations.' });
  }
};

/**
 * Demander un renouvellement gratuit (TERMITES ou ERP)
 */
exports.demanderRenouvellementGratuit = async (req, res) => {
  try {
    const {
      diagnostiqueurId,
      ordreMissionOriginalId,
      clientId,
      type // 'TERMITES' ou 'ERP'
    } = req.body;

    const agenceId = req.user.id;

    // Vérifier le diagnostiqueur PRO
    const diagnostiqueur = await Diagnostiqueur.findById(diagnostiqueurId);

    if (!diagnostiqueur) {
      return res.status(404).json({ message: 'Diagnostiqueur non trouvé.' });
    }

    if (diagnostiqueur.typeAbonnement !== 'PRO') {
      return res.status(403).json({ message: 'Cette fonctionnalité est réservée aux diagnostiqueurs PRO.' });
    }

    // Vérifier la mission originale
    const missionOriginale = await OrdreMission.findById(ordreMissionOriginalId);

    if (!missionOriginale) {
      return res.status(404).json({ message: 'Mission originale non trouvée.' });
    }

    // Calculer l'âge en mois
    const maintenant = new Date();
    const ageMs = maintenant - missionOriginale.dateCreation;
    const ageEnMois = ageMs / (1000 * 60 * 60 * 24 * 30);

    const seuilAtteint = ageEnMois >= 6;

    // Vérifier si un renouvellement a déjà été demandé
    const dejaUtilise = await RenouvelementGratuit.findOne({
      ordreMissionOriginal: ordreMissionOriginalId,
      type,
      statut: { $ne: 'annule' }
    });

    const eligible = seuilAtteint && !dejaUtilise && diagnostiqueur.typeAbonnement === 'PRO';

    // Créer la demande
    const renouvellement = await RenouvelementGratuit.create({
      agence: agenceId,
      diagnostiqueur: diagnostiqueurId,
      ordreMissionOriginal: ordreMissionOriginalId,
      client: clientId,
      type,
      eligible,
      verificationDetails: {
        ageEnMois: Math.round(ageEnMois * 10) / 10,
        seuilAtteint,
        dejaUtilise: !!dejaUtilise,
        diagnostiqueurPRO: diagnostiqueur.typeAbonnement === 'PRO'
      },
      statut: eligible ? 'approuve' : 'refuse',
      raisonRefus: !eligible ? 'Conditions d\'éligibilité non remplies' : null
    });

    res.status(201).json({
      message: eligible ? 'Demande de renouvellement approuvée.' : 'Demande de renouvellement refusée.',
      renouvellement,
      eligible
    });

  } catch (error) {
    console.error('Erreur demanderRenouvellementGratuit:', error);
    res.status(500).json({ message: 'Erreur lors de la demande de renouvellement.' });
  }
};

/**
 * Liste des renouvellements de l'agence
 */
exports.getRenouvellements = async (req, res) => {
  try {
    const agenceId = req.user.id;

    const renouvellements = await RenouvelementGratuit.find({ agence: agenceId })
      .populate('diagnostiqueur', 'nom_entreprise')
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

module.exports = exports;
