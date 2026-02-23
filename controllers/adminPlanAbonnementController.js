// Plans définis en dur - STANDARD et PRO uniquement
const PLANS_STATIQUES = {
  STANDARD: {
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
        'Jusqu\'à 10 missions/mois',
        'Jusqu\'à 50 clients actifs',
        '1 technicien'
      ]
    },
    actif: true,
    visible: true
  },
  PRO: {
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
        'Devis illimités',
        'Clients actifs illimités',
        'Synchronisation Google Calendar',
        'Exports avancés (Excel, PDF)',
        'Accès API',
        'Support prioritaire',
        'Gestion d\'équipe (5 techniciens)',
        'Statistiques avancées',
        'Stockage 50 Go',
        '14 jours d\'essai gratuit'
      ]
    },
    actif: true,
    visible: true
  }
};

/**
 * Récupérer tous les plans d'abonnement (hardcodés)
 */
exports.getAllPlans = async (req, res) => {
  try {
    const plans = Object.values(PLANS_STATIQUES);
    res.json({ plans });
  } catch (error) {
    console.error('Erreur getAllPlans:', error);
    res.status(500).json({ message: error.message });
  }
};

/**
 * Récupérer un plan par son nom
 */
exports.getPlanByName = async (req, res) => {
  try {
    const { planName } = req.params;
    const plan = PLANS_STATIQUES[planName.toUpperCase()];

    if (!plan) {
      return res.status(404).json({ message: 'Plan non trouvé' });
    }

    res.json({ plan });
  } catch (error) {
    console.error('Erreur getPlanByName:', error);
    res.status(500).json({ message: error.message });
  }
};

/**
 * Vérifier si un diagnostiqueur dépasse les limites de son plan
 */
exports.verifierLimitesPlan = async (req, res) => {
  try {
    const { planName } = req.body;
    const plan = PLANS_STATIQUES[planName];

    if (!plan) {
      return res.status(404).json({ message: 'Plan non trouvé' });
    }

    res.json({
      plan,
      limites: plan.limites,
      fonctionnalites: plan.fonctionnalites
    });
  } catch (error) {
    console.error('Erreur verifierLimitesPlan:', error);
    res.status(500).json({ message: error.message });
  }
};

module.exports = exports;
