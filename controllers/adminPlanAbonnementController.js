const PlanAbonnement = require('../models/PlanAbonnement');

/**
 * Récupérer tous les plans d'abonnement
 */
exports.getAllPlans = async (req, res) => {
  try {
    const plans = await PlanAbonnement.find().sort({ 'affichage.ordre': 1 });
    res.json({ plans });
  } catch (error) {
    console.error('Erreur getAllPlans:', error);
    res.status(500).json({ message: error.message });
  }
};

/**
 * Récupérer un plan par son ID
 */
exports.getPlanById = async (req, res) => {
  try {
    const { planId } = req.params;
    const plan = await PlanAbonnement.findById(planId);

    if (!plan) {
      return res.status(404).json({ message: 'Plan non trouvé' });
    }

    res.json({ plan });
  } catch (error) {
    console.error('Erreur getPlanById:', error);
    res.status(500).json({ message: error.message });
  }
};

/**
 * Créer un nouveau plan d'abonnement
 */
exports.createPlan = async (req, res) => {
  try {
    const planData = req.body;

    // Vérifier que le nom n'existe pas déjà
    const existant = await PlanAbonnement.findOne({ nom: planData.nom });
    if (existant) {
      return res.status(400).json({ message: 'Un plan avec ce nom existe déjà' });
    }

    const plan = new PlanAbonnement(planData);
    await plan.save();

    res.status(201).json({
      message: 'Plan créé avec succès',
      plan
    });
  } catch (error) {
    console.error('Erreur createPlan:', error);
    res.status(500).json({ message: error.message });
  }
};

/**
 * Mettre à jour un plan d'abonnement
 */
exports.updatePlan = async (req, res) => {
  try {
    const { planId } = req.params;
    const updates = req.body;

    const plan = await PlanAbonnement.findByIdAndUpdate(
      planId,
      { $set: updates },
      { new: true, runValidators: true }
    );

    if (!plan) {
      return res.status(404).json({ message: 'Plan non trouvé' });
    }

    res.json({
      message: 'Plan mis à jour avec succès',
      plan
    });
  } catch (error) {
    console.error('Erreur updatePlan:', error);
    res.status(500).json({ message: error.message });
  }
};

/**
 * Supprimer un plan d'abonnement
 */
exports.deletePlan = async (req, res) => {
  try {
    const { planId } = req.params;

    const plan = await PlanAbonnement.findByIdAndDelete(planId);

    if (!plan) {
      return res.status(404).json({ message: 'Plan non trouvé' });
    }

    res.json({
      message: 'Plan supprimé avec succès'
    });
  } catch (error) {
    console.error('Erreur deletePlan:', error);
    res.status(500).json({ message: error.message });
  }
};

/**
 * Initialiser les plans par défaut (STANDARD et PRO)
 */
exports.initialiserPlansParDefaut = async (req, res) => {
  try {
    const plansParDefaut = [
      {
        nom: 'STANDARD',
        tarification: {
          prixMensuel: 0,
          prixAnnuel: 0,
          devise: 'EUR'
        },
        engagement: {
          dureeMinimumMois: 0,
          fraisResiliation: 0,
          periodeEssaiJours: 0
        },
        fonctionnalites: {
          googleCalendarSync: false,
          exportsAvances: false,
          apiAccess: false,
          supportPrioritaire: false,
          formationPersonnalisee: false,
          gestionEquipe: false,
          statistiquesAvancees: false,
          personnalisationInterface: false
        },
        limites: {
          maxMissionsParMois: 10,
          maxTechniciens: 1,
          maxStockageGo: 5,
          maxClientsActifs: 50,
          maxDevisParMois: 20
        },
        affichage: {
          couleur: '#64748b',
          badge: null,
          ordre: 1,
          recommande: false
        },
        description: {
          courte: 'Pour démarrer votre activité',
          longue: 'Le plan STANDARD vous permet de commencer avec les fonctionnalités essentielles',
          avantages: [
            'Gestion des missions de base',
            'Support standard',
            'Stockage 5 Go',
            'Jusqu\'à 10 missions/mois'
          ]
        },
        actif: true,
        visible: true
      },
      {
        nom: 'PRO',
        tarification: {
          prixMensuel: 29,
          prixAnnuel: 290,
          devise: 'EUR',
          stripePriceId: process.env.STRIPE_PRICE_PRO || null
        },
        engagement: {
          dureeMinimumMois: 0,
          fraisResiliation: 0,
          periodeEssaiJours: 14
        },
        fonctionnalites: {
          googleCalendarSync: true,
          exportsAvances: true,
          apiAccess: true,
          supportPrioritaire: true,
          formationPersonnalisee: false,
          gestionEquipe: true,
          statistiquesAvancees: true,
          personnalisationInterface: false
        },
        limites: {
          maxMissionsParMois: null, // Illimité
          maxTechniciens: 5,
          maxStockageGo: 50,
          maxClientsActifs: null,
          maxDevisParMois: null
        },
        affichage: {
          couleur: '#8b5cf6',
          badge: 'Populaire',
          ordre: 2,
          recommande: true
        },
        description: {
          courte: 'Pour les professionnels exigeants',
          longue: 'Le plan PRO offre toutes les fonctionnalités avancées pour développer votre activité',
          avantages: [
            'Missions illimitées',
            'Synchronisation Google Calendar',
            'Exports avancés (Excel, PDF)',
            'Accès API',
            'Support prioritaire',
            'Gestion d\'équipe (5 techniciens)',
            'Statistiques avancées',
            'Stockage 50 Go'
          ]
        },
        actif: true,
        visible: true
      }
    ];

    let created = 0;
    let skipped = 0;

    for (const planData of plansParDefaut) {
      const existant = await PlanAbonnement.findOne({ nom: planData.nom });
      if (!existant) {
        await PlanAbonnement.create(planData);
        created++;
      } else {
        skipped++;
      }
    }

    res.json({
      message: 'Initialisation terminée',
      created,
      skipped
    });
  } catch (error) {
    console.error('Erreur initialiserPlansParDefaut:', error);
    res.status(500).json({ message: error.message });
  }
};

module.exports = exports;