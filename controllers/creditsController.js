const CreditPack = require('../models/CreditPack');
const Agency = require('../models/Agency');
const Admin = require('../models/Admin');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

/**
 * 📦 Obtenir tous les packs de crédits disponibles
 */
exports.getPacks = async (req, res) => {
  try {
    const packs = await CreditPack.find({ actif: true }).sort({ ordre: 1 });

    return res.status(200).json({
      success: true,
      packs
    });
  } catch (err) {
    console.error('Erreur getPacks:', err);
    return res.status(500).json({
      success: false,
      message: 'Erreur lors de la récupération des packs de crédits'
    });
  }
};

/**
 * 💰 Obtenir le solde de crédits (Admin ou Agence)
 */
exports.getBalance = async (req, res) => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Utilisateur non authentifié'
      });
    }

    // 🔹 Vérifier si c'est un Admin
    const admin = await Admin.findById(userId)
      .select('creditsIA historiqueCreditsIA')
      .lean();

    if (admin) {
      // C'est un Admin de la plateforme
      const historique = (admin.historiqueCreditsIA || [])
        .sort((a, b) => new Date(b.date) - new Date(a.date))
        .slice(0, 20);

      return res.status(200).json({
        success: true,
        creditsIA: admin.creditsIA || 0,
        historique
      });
    }

    // 🔹 Sinon, vérifier si c'est une Agence
    const agencyId = req.agence?._id;

    if (!agencyId) {
      return res.status(401).json({
        success: false,
        message: 'Utilisateur non trouvé'
      });
    }

    const agency = await Agency.findById(agencyId)
      .select('creditsIA historiqueCreditsIA')
      .lean();

    if (!agency) {
      return res.status(404).json({
        success: false,
        message: 'Agence introuvable'
      });
    }

    // Récupérer les 20 dernières transactions
    const historique = (agency.historiqueCreditsIA || [])
      .sort((a, b) => new Date(b.date) - new Date(a.date))
      .slice(0, 20);

    return res.status(200).json({
      success: true,
      creditsIA: agency.creditsIA || 0,
      historique
    });
  } catch (err) {
    console.error('Erreur getBalance:', err);
    return res.status(500).json({
      success: false,
      message: 'Erreur lors de la récupération du solde'
    });
  }
};

/**
 * 🛒 Créer une session de paiement Stripe pour acheter un pack (Admin ou Agence)
 */
exports.createCheckoutSession = async (req, res) => {
  try {
    const userId = req.user?.id;
    const { packId } = req.body;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Utilisateur non authentifié'
      });
    }

    if (!packId) {
      return res.status(400).json({
        success: false,
        message: 'ID du pack requis'
      });
    }

    // Récupérer le pack
    const pack = await CreditPack.findById(packId);

    if (!pack || !pack.actif) {
      return res.status(404).json({
        success: false,
        message: 'Pack introuvable ou inactif'
      });
    }

    // 🔹 Vérifier si c'est un Admin
    const admin = await Admin.findById(userId);

    if (admin) {
      // C'est un Admin de la plateforme
      const session = await stripe.checkout.sessions.create({
        payment_method_types: ['card'],
        mode: 'payment',
        customer_email: admin.email,
        line_items: [
          {
            price_data: {
              currency: 'eur',
              product_data: {
                name: pack.nom,
                description: `${pack.nombreCredits} crédits IA pour la génération de devis`,
              },
              unit_amount: pack.prixCentimes,
            },
            quantity: 1,
          },
        ],
        metadata: {
          adminId: userId.toString(),
          packId: packId.toString(),
          nombreCredits: pack.nombreCredits.toString(),
          type: 'credit_pack_purchase_admin'
        },
        success_url: `${process.env.ADMIN_FRONTEND_URL || 'http://localhost:8080'}/settings?payment=success&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${process.env.ADMIN_FRONTEND_URL || 'http://localhost:8080'}/settings?payment=cancelled`,
      });

      return res.status(200).json({
        success: true,
        sessionId: session.id,
        url: session.url
      });
    }

    // 🔹 Sinon, c'est une Agence
    const agencyId = req.agence?._id;

    if (!agencyId) {
      return res.status(401).json({
        success: false,
        message: 'Utilisateur non trouvé'
      });
    }

    const agency = await Agency.findById(agencyId);

    if (!agency) {
      return res.status(404).json({
        success: false,
        message: 'Agence introuvable'
      });
    }

    // Créer la session Stripe pour l'agence
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'payment',
      customer_email: agency.admin.email,
      line_items: [
        {
          price_data: {
            currency: 'eur',
            product_data: {
              name: pack.nom,
              description: `${pack.nombreCredits} crédits IA pour la génération de devis`,
            },
            unit_amount: pack.prixCentimes,
          },
          quantity: 1,
        },
      ],
      metadata: {
        agencyId: agencyId.toString(),
        packId: packId.toString(),
        nombreCredits: pack.nombreCredits.toString(),
        type: 'credit_pack_purchase'
      },
      success_url: `${process.env.FRONTEND_URL || 'http://localhost:8080'}/settings?payment=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.FRONTEND_URL || 'http://localhost:8080'}/settings?payment=cancelled`,
    });

    return res.status(200).json({
      success: true,
      sessionId: session.id,
      url: session.url
    });
  } catch (err) {
    console.error('Erreur createCheckoutSession:', err);
    return res.status(500).json({
      success: false,
      message: 'Erreur lors de la création de la session de paiement'
    });
  }
};

/**
 * ✅ Webhook Stripe pour confirmer le paiement et ajouter les crédits (Admin ou Agence)
 * Cette fonction sera appelée par le webhook Stripe existant
 */
exports.handlePaymentSuccess = async (session) => {
  try {
    console.log('📦 Traitement achat pack de crédits:', session.id);

    const { agencyId, adminId, packId, nombreCredits, type } = session.metadata;

    if (!packId || !nombreCredits) {
      console.error('Métadonnées manquantes dans la session Stripe');
      return;
    }

    // Récupérer le pack
    const pack = await CreditPack.findById(packId);

    if (!pack) {
      console.error('Pack introuvable:', packId);
      return;
    }

    // 🔹 Si c'est un achat Admin
    if (type === 'credit_pack_purchase_admin' && adminId) {
      const admin = await Admin.findById(adminId);

      if (!admin) {
        console.error('Admin introuvable:', adminId);
        return;
      }

      // Ajouter les crédits à l'admin
      await admin.ajouterCreditsIA({
        type: 'achat',
        nombreCredits: parseInt(nombreCredits, 10),
        description: `Achat du pack "${pack.nom}"`,
        packAchete: packId,
        stripePaymentId: session.payment_intent,
        par: 'stripe'
      });

      console.log(`✅ ${nombreCredits} crédits ajoutés à l'admin ${admin.email}`);
      return;
    }

    // 🔹 Sinon, c'est un achat Agence
    if (!agencyId) {
      console.error('Ni agencyId ni adminId trouvé dans les métadonnées');
      return;
    }

    const agency = await Agency.findById(agencyId);

    if (!agency) {
      console.error('Agence introuvable:', agencyId);
      return;
    }

    // Ajouter les crédits à l'agence
    await agency.ajouterCreditsIA({
      type: 'achat',
      nombreCredits: parseInt(nombreCredits, 10),
      description: `Achat du pack "${pack.nom}"`,
      packAchete: packId,
      stripePaymentId: session.payment_intent,
      par: 'stripe'
    });

    console.log(`✅ ${nombreCredits} crédits ajoutés à l'agence ${agency.nom_commercial}`);
  } catch (err) {
    console.error('Erreur handlePaymentSuccess:', err);
    throw err;
  }
};

/**
 * 🎁 Ajouter des crédits manuellement (super admin only)
 */
exports.addCreditsManually = async (req, res) => {
  try {
    const { agencyId, adminId, nombreCredits, description } = req.body;

    // Vérifier que c'est un super admin
    if (req.user?.role !== 'super_admin') {
      return res.status(403).json({
        success: false,
        message: 'Accès refusé. Super admin requis.'
      });
    }

    if (!nombreCredits) {
      return res.status(400).json({
        success: false,
        message: 'Nombre de crédits requis'
      });
    }

    // 🔹 Si on ajoute des crédits à un Admin
    if (adminId) {
      const admin = await Admin.findById(adminId);

      if (!admin) {
        return res.status(404).json({
          success: false,
          message: 'Admin introuvable'
        });
      }

      await admin.ajouterCreditsIA({
        type: 'cadeau',
        nombreCredits: parseInt(nombreCredits, 10),
        description: description || 'Crédits ajoutés manuellement par le super admin',
        par: req.user?.email || 'super_admin'
      });

      return res.status(200).json({
        success: true,
        message: `${nombreCredits} crédits ajoutés avec succès à l'admin`,
        nouveauSolde: admin.creditsIA
      });
    }

    // 🔹 Si on ajoute des crédits à une Agence
    if (agencyId) {
      const agency = await Agency.findById(agencyId);

      if (!agency) {
        return res.status(404).json({
          success: false,
          message: 'Agence introuvable'
        });
      }

      await agency.ajouterCreditsIA({
        type: 'cadeau',
        nombreCredits: parseInt(nombreCredits, 10),
        description: description || 'Crédits ajoutés manuellement par le super admin',
        par: req.user?.email || 'super_admin'
      });

      return res.status(200).json({
        success: true,
        message: `${nombreCredits} crédits ajoutés avec succès à l'agence`,
        nouveauSolde: agency.creditsIA
      });
    }

    return res.status(400).json({
      success: false,
      message: 'adminId ou agencyId requis'
    });
  } catch (err) {
    console.error('Erreur addCreditsManually:', err);
    return res.status(500).json({
      success: false,
      message: 'Erreur lors de l\'ajout des crédits'
    });
  }
};

module.exports = exports;
