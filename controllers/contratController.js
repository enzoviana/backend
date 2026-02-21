const ContratTransfert = require('../models/ContratTransfert');
const Agency = require('../models/Agency');

// Définition des packs de maintenance
const PACKS_MAINTENANCE = {
  serenite: {
    nom: 'Pack Sérénité',
    prixMensuelPreferentiel: 49,
    prixMensuelNormal: 79,
    fonctionnalites: [
      'Hébergement inclus',
      'Mises à jour de sécurité',
      'Support technique prioritaire',
      'Sauvegardes quotidiennes',
      'Monitoring 24/7',
      'Garantie de disponibilité 99.9%'
    ]
  },
  evolution: {
    nom: 'Pack Evolution',
    prixMensuelPreferentiel: 99,
    prixMensuelNormal: 149,
    fonctionnalites: [
      'Tout le Pack Sérénité',
      'Nouvelles fonctionnalités incluses',
      'Personnalisations mensuelles',
      'Optimisations de performance',
      'Formations continues',
      'Conseils stratégiques'
    ]
  },
  aucun: {
    nom: 'Sans Maintenance',
    prixMensuelPreferentiel: 0,
    prixMensuelNormal: 0,
    fonctionnalites: [
      'Accès à l\'application',
      'Support limité (email uniquement)',
      'Pas de mises à jour garanties',
      'Hébergement à votre charge après 3 mois'
    ]
  }
};

// GET /api/admin/contrat/status
// Vérifie si le contrat est signé
exports.getStatus = async (req, res) => {
  try {
    const agenceId = req.user.agenceId;

    // Récupérer l'admin ID de l'agence
    const agency = await Agency.findById(agenceId).select('admin');
    if (!agency || !agency.admin || !agency.admin._id) {
      return res.status(404).json({
        success: false,
        message: 'Agence ou admin non trouvé'
      });
    }

    const adminId = agency.admin._id;
    const contrat = await ContratTransfert.getOrCreateForAdmin(adminId, agenceId);

    res.json({
      success: true,
      isSigne: contrat.isValide,
      packMaintenance: contrat.packMaintenance,
      dateSignature: contrat.dateSignature,
      tarifPreferentiel: contrat.tarifPreferentiel
    });

  } catch (error) {
    console.error('Erreur getStatus contrat:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la récupération du statut du contrat'
    });
  }
};

// GET /api/admin/contrat/packs
// Récupère la liste des packs disponibles
exports.getPacks = async (req, res) => {
  try {
    const agenceId = req.user.agenceId;

    // Récupérer l'admin ID
    const agency = await Agency.findById(agenceId).select('admin');
    if (!agency || !agency.admin || !agency.admin._id) {
      return res.status(404).json({
        success: false,
        message: 'Agence ou admin non trouvé'
      });
    }

    const adminId = agency.admin._id;

    // Vérifier si l'admin a déjà un contrat
    const contrat = await ContratTransfert.findOne({ adminId });
    const tarifPreferentiel = contrat ? contrat.tarifPreferentiel : true;

    const packs = Object.keys(PACKS_MAINTENANCE).map(key => {
      const pack = PACKS_MAINTENANCE[key];
      return {
        id: key,
        nom: pack.nom,
        prixMensuel: tarifPreferentiel ? pack.prixMensuelPreferentiel : pack.prixMensuelNormal,
        prixMensuelBarré: tarifPreferentiel ? pack.prixMensuelNormal : null,
        fonctionnalites: pack.fonctionnalites,
        recommande: key === 'serenite'
      };
    });

    res.json({
      success: true,
      packs,
      tarifPreferentiel
    });

  } catch (error) {
    console.error('Erreur getPacks:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la récupération des packs'
    });
  }
};

// POST /api/admin/contrat/signer
// Signe le contrat avec le pack choisi
exports.signerContrat = async (req, res) => {
  try {
    const agenceId = req.user.agenceId;
    const { packMaintenance, signature } = req.body;

    // Validation
    if (!packMaintenance || !['serenite', 'evolution', 'aucun'].includes(packMaintenance)) {
      return res.status(400).json({
        success: false,
        message: 'Pack de maintenance invalide'
      });
    }

    if (!signature || !signature.nom || !signature.prenom || !signature.accepteConditions) {
      return res.status(400).json({
        success: false,
        message: 'Informations de signature incomplètes'
      });
    }

    // Récupérer l'admin ID
    const agency = await Agency.findById(agenceId).select('admin');
    if (!agency || !agency.admin || !agency.admin._id) {
      return res.status(404).json({
        success: false,
        message: 'Agence ou admin non trouvé'
      });
    }

    const adminId = agency.admin._id;

    // Récupérer ou créer le contrat
    let contrat = await ContratTransfert.getOrCreateForAdmin(adminId, agenceId);

    // Si déjà signé, ne pas permettre de re-signer
    if (contrat.isValide) {
      return res.status(400).json({
        success: false,
        message: 'Le contrat a déjà été signé'
      });
    }

    // Mettre à jour le pack choisi
    contrat.packMaintenance = packMaintenance;

    // Récupérer les détails du pack
    const packDetails = PACKS_MAINTENANCE[packMaintenance];
    contrat.detailsPack = {
      nom: packDetails.nom,
      prixMensuel: contrat.tarifPreferentiel
        ? packDetails.prixMensuelPreferentiel
        : packDetails.prixMensuelNormal,
      fonctionnalites: packDetails.fonctionnalites
    };

    // Récupérer l'IP de la requête
    const ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress;

    // Valider le contrat
    await contrat.valider(signature, ip, agenceId);

    res.json({
      success: true,
      message: 'Contrat signé avec succès',
      contrat: {
        dateSignature: contrat.dateSignature,
        packMaintenance: contrat.packMaintenance,
        detailsPack: contrat.detailsPack
      }
    });

  } catch (error) {
    console.error('Erreur signerContrat:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la signature du contrat'
    });
  }
};

// GET /api/admin/contrat/details
// Récupère les détails complets du contrat signé
exports.getDetails = async (req, res) => {
  try {
    const agenceId = req.user.agenceId;

    // Récupérer l'admin ID
    const agency = await Agency.findById(agenceId).select('admin nom_commercial email telephone');
    if (!agency || !agency.admin || !agency.admin._id) {
      return res.status(404).json({
        success: false,
        message: 'Agence ou admin non trouvé'
      });
    }

    const adminId = agency.admin._id;

    const contrat = await ContratTransfert.findOne({ adminId })
      .populate('agence', 'nom_commercial email admin.telephone_portable');

    if (!contrat || !contrat.isValide) {
      return res.status(404).json({
        success: false,
        message: 'Aucun contrat signé trouvé'
      });
    }

    res.json({
      success: true,
      contrat: {
        dateSignature: contrat.dateSignature,
        packMaintenance: contrat.packMaintenance,
        detailsPack: contrat.detailsPack,
        signature: {
          nom: contrat.signature.nom,
          prenom: contrat.signature.prenom,
          fonction: contrat.signature.fonction
        },
        agence: {
          nomAgence: agency.nom_commercial,
          email: agency.admin?.email || agency.email,
          telephone: agency.admin?.telephone_portable || agency.telephone
        },
        versionContrat: contrat.versionContrat
      }
    });

  } catch (error) {
    console.error('Erreur getDetails:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la récupération des détails'
    });
  }
};

// PUT /api/admin/contrat/changer-pack
// Permet de changer de pack après signature (tarif normal)
exports.changerPack = async (req, res) => {
  try {
    const agenceId = req.user.agenceId;
    const { nouveauPack } = req.body;

    if (!['serenite', 'evolution', 'aucun'].includes(nouveauPack)) {
      return res.status(400).json({
        success: false,
        message: 'Pack invalide'
      });
    }

    // Récupérer l'admin ID
    const agency = await Agency.findById(agenceId).select('admin');
    if (!agency || !agency.admin || !agency.admin._id) {
      return res.status(404).json({
        success: false,
        message: 'Agence ou admin non trouvé'
      });
    }

    const adminId = agency.admin._id;

    const contrat = await ContratTransfert.findOne({ adminId });

    if (!contrat || !contrat.isValide) {
      return res.status(404).json({
        success: false,
        message: 'Aucun contrat signé trouvé'
      });
    }

    // Changement de pack = tarif normal (plus de préférentiel)
    contrat.packMaintenance = nouveauPack;
    contrat.tarifPreferentiel = false;

    const packDetails = PACKS_MAINTENANCE[nouveauPack];
    contrat.detailsPack = {
      nom: packDetails.nom,
      prixMensuel: packDetails.prixMensuelNormal,
      fonctionnalites: packDetails.fonctionnalites
    };

    await contrat.save();

    // Mettre à jour l'agence
    await Agency.findByIdAndUpdate(agenceId, {
      'contratTransfert.packMaintenance': nouveauPack
    });

    res.json({
      success: true,
      message: 'Pack de maintenance modifié',
      nouveauPack: contrat.detailsPack
    });

  } catch (error) {
    console.error('Erreur changerPack:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors du changement de pack'
    });
  }
};
