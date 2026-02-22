// controllers/contratController.js
const ContratTransfert = require('../models/ContratTransfert');
const Admin = require('../models/Admin');
const sendEmail = require('../utils/sendEmails');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const PDFDocument = require('pdfkit');

// Définition des packs de maintenance
const PACKS_MAINTENANCE = {
  serenite: {
    nom: 'Pack Sérénité',
    prixMensuelPreferentiel: 250,
    prixMensuelNormal: 345, // 250 * 1.38
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
    prixMensuelPreferentiel: 400,
    prixMensuelNormal: 552, // 400 * 1.38
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
    const adminId = req.user.id; // ID du SuperAdmin depuis le token

    const contrat = await ContratTransfert.getOrCreateForAdmin(adminId);

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
    const adminId = req.user.id; 

    // Vérifier si l'admin a déjà un contrat pour adapter les prix
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

// POST /api/admin/contrat/envoyer-code
// Envoie un code de vérification par email avant la signature
exports.envoyerCodeVerification = async (req, res) => {
  try {
    const adminId = req.user.id;
    const { packMaintenance, signature } = req.body;

    // Validation
    if (!packMaintenance || !['serenite', 'evolution', 'aucun'].includes(packMaintenance)) {
      return res.status(400).json({
        success: false,
        message: 'Pack de maintenance invalide'
      });
    }

    if (!signature || !signature.nom || !signature.prenom || !signature.signatureCanvas) {
      return res.status(400).json({
        success: false,
        message: 'Informations de signature incomplètes'
      });
    }

    // Récupérer l'admin pour avoir son email
    const admin = await Admin.findById(adminId);
    if (!admin) {
      return res.status(404).json({
        success: false,
        message: 'Administrateur introuvable'
      });
    }

    // Récupérer ou créer le contrat
    let contrat = await ContratTransfert.getOrCreateForAdmin(adminId);

    // Si déjà signé, bloquer
    if (contrat.isValide) {
      return res.status(400).json({
        success: false,
        message: 'Le contrat a déjà été signé'
      });
    }

    // Mettre à jour le pack choisi (pour appliquer la tarification)
    contrat.packMaintenance = packMaintenance;

    // 💰 LOGIQUE DE TARIFICATION : Si pas de maintenance, augmenter de 38%
    if (packMaintenance === 'aucun') {
      contrat.tarifPreferentiel = false; // Perte du tarif préférentiel
    }

    // Stocker temporairement les données de signature
    contrat.signature = {
      nom: signature.nom,
      prenom: signature.prenom,
      signatureCanvas: signature.signatureCanvas,
      accepteConditions: false // Pas encore validé
    };

    // Générer le code de vérification
    const code = contrat.genererCodeVerification();

    await contrat.save();

    // Envoyer l'email avec le code
    await sendEmail({
      to: admin.email,
      subject: '🔐 Code de vérification - Signature du contrat Dimotec',
      template: 'CodeVerificationContrat.html',
      variables: {
        nom: signature.nom,
        prenom: signature.prenom,
        code: code,
        packChoisi: PACKS_MAINTENANCE[packMaintenance].nom
      }
    });

    res.json({
      success: true,
      message: 'Code de vérification envoyé par email',
      emailEnvoye: admin.email
    });

  } catch (error) {
    console.error('Erreur envoyerCodeVerification:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de l\'envoi du code de vérification'
    });
  }
};

// POST /api/admin/contrat/signer
// Signe le contrat après vérification du code
exports.signerContrat = async (req, res) => {
  try {
    const adminId = req.user.id;
    const { codeVerification } = req.body;

    // Validation
    if (!codeVerification) {
      return res.status(400).json({
        success: false,
        message: 'Code de vérification requis'
      });
    }

    // Récupérer le contrat
    let contrat = await ContratTransfert.findOne({ adminId }).select('+codeVerification');

    if (!contrat) {
      return res.status(404).json({
        success: false,
        message: 'Aucune demande de signature en cours'
      });
    }

    // Si déjà signé, bloquer
    if (contrat.isValide) {
      return res.status(400).json({
        success: false,
        message: 'Le contrat a déjà été signé'
      });
    }

    // Vérifier le code
    const verification = contrat.verifierCode(codeVerification);
    if (!verification.valide) {
      return res.status(400).json({
        success: false,
        message: verification.message
      });
    }

    // Récupérer l'admin pour les informations légales
    const admin = await Admin.findById(adminId);
    if (!admin) {
      return res.status(404).json({
        success: false,
        message: 'Administrateur introuvable'
      });
    }

    // Récupérer les détails du pack pour les figer dans le contrat
    const packDetails = PACKS_MAINTENANCE[contrat.packMaintenance];
    contrat.detailsPack = {
      nom: packDetails.nom,
      prixMensuel: contrat.tarifPreferentiel
        ? packDetails.prixMensuelPreferentiel
        : packDetails.prixMensuelNormal,
      fonctionnalites: packDetails.fonctionnalites
    };

    // Collecter les informations légales
    const ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
    const userAgent = req.headers['user-agent'] || '';

    // Parser le user agent pour extraire navigateur et OS
    let navigateur = 'Inconnu';
    let systemeExploitation = 'Inconnu';

    if (userAgent.includes('Chrome')) navigateur = 'Google Chrome';
    else if (userAgent.includes('Firefox')) navigateur = 'Mozilla Firefox';
    else if (userAgent.includes('Safari')) navigateur = 'Safari';
    else if (userAgent.includes('Edge')) navigateur = 'Microsoft Edge';

    if (userAgent.includes('Windows')) systemeExploitation = 'Windows';
    else if (userAgent.includes('Mac')) systemeExploitation = 'macOS';
    else if (userAgent.includes('Linux')) systemeExploitation = 'Linux';
    else if (userAgent.includes('Android')) systemeExploitation = 'Android';
    else if (userAgent.includes('iOS')) systemeExploitation = 'iOS';

    const informationsLegales = {
      ipSignature: ip,
      userAgent: userAgent,
      navigateur: navigateur,
      systemeExploitation: systemeExploitation,
      horodatageComplet: new Date(),
      emailContact: admin.email,
      telephoneContact: admin.telephone || 'Non renseigné',
      adresseComplete: admin.entreprise?.adresse
        ? `${admin.entreprise.adresse.rue || ''}, ${admin.entreprise.adresse.codePostal || ''} ${admin.entreprise.adresse.ville || ''}, ${admin.entreprise.adresse.pays || 'France'}`
        : 'Non renseigné'
    };

    // Valider le contrat via la méthode du modèle
    await contrat.valider(contrat.signature, informationsLegales);

    // Définir le statut de paiement
    if (contrat.packMaintenance !== 'aucun') {
      contrat.statutPaiement = 'en_attente';

      // Mettre à jour le contrat de maintenance dans Admin (en attente jusqu'au paiement)
      admin.contratMaintenance = {
        actif: false, // Sera activé après le paiement
        type: contrat.packMaintenance,
        dateDebut: null,
        dateExpiration: null
      };
    } else {
      contrat.statutPaiement = 'actif'; // Pas de paiement requis pour le pack sans maintenance

      // Pas de contrat de maintenance
      admin.contratMaintenance = {
        actif: false,
        type: 'aucun',
        dateDebut: null,
        dateExpiration: null
      };
    }

    await contrat.save();
    await admin.save();

    // 📧 Envoyer email de confirmation
    await sendEmail({
      to: admin.email,
      subject: '✅ Contrat de transfert signé - Dimotec',
      template: 'ConfirmationSignatureContrat.html',
      variables: {
        nom: contrat.signature.nom,
        prenom: contrat.signature.prenom,
        packChoisi: contrat.detailsPack.nom,
        prixMensuel: contrat.detailsPack.prixMensuel,
        dateSignature: contrat.dateSignature.toLocaleDateString('fr-FR', {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit'
        })
      }
    });

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
    const adminId = req.user.id; 

    const contrat = await ContratTransfert.findOne({ adminId }).populate('adminId', 'nom prenom email telephone entreprise');

    if (!contrat || !contrat.isValide) {
      return res.status(404).json({
        success: false,
        message: 'Aucun contrat signé trouvé pour cet administrateur'
      });
    }

    res.json({
      success: true,
      contrat: {
        _id: contrat._id,
        dateSignature: contrat.dateSignature,
        packMaintenance: contrat.packMaintenance,
        detailsPack: contrat.detailsPack,
        tarifPreferentiel: contrat.tarifPreferentiel,
        isValide: contrat.isValide,
        signature: {
          nom: contrat.signature.nom,
          prenom: contrat.signature.prenom,
          fonction: contrat.signature.fonction
        },
        // Informations de l'Admin remontées via populate
        admin: contrat.adminId ? {
          nom: contrat.adminId.nom,
          prenom: contrat.adminId.prenom,
          email: contrat.adminId.email,
          entreprise: contrat.adminId.entreprise?.name || 'Non spécifié'
        } : null,
        // Informations Stripe et paiement
        statutPaiement: contrat.statutPaiement,
        stripeSubscriptionId: contrat.stripeSubscriptionId,
        stripeCustomerId: contrat.stripeCustomerId,
        dateDebutAbonnement: contrat.dateDebutAbonnement,
        dateProchaineFacture: contrat.dateProchaineFacture,
        dateFinEngagement: contrat.dateFinEngagement,
        versionContrat: contrat.versionContrat
      }
    });

  } catch (error) {
    console.error('Erreur getDetails:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la récupération des détails du contrat'
    });
  }
};

// POST /api/admin/contrat/creer-abonnement
// Crée une souscription Stripe pour le contrat signé
exports.creerAbonnementStripe = async (req, res) => {
  try {
    const adminId = req.user.id;

    const contrat = await ContratTransfert.findOne({ adminId });
    if (!contrat || !contrat.isValide) {
      return res.status(404).json({
        success: false,
        message: 'Aucun contrat signé trouvé'
      });
    }

    // Si l'abonnement existe déjà
    if (contrat.stripeSubscriptionId) {
      return res.status(400).json({
        success: false,
        message: 'Un abonnement existe déjà pour ce contrat'
      });
    }

    // Si pas de maintenance, pas de paiement
    if (contrat.packMaintenance === 'aucun') {
      return res.status(400).json({
        success: false,
        message: 'Aucun paiement requis pour le pack sans maintenance'
      });
    }

    const admin = await Admin.findById(adminId);
    if (!admin) {
      return res.status(404).json({
        success: false,
        message: 'Administrateur introuvable'
      });
    }

    // Créer ou récupérer le customer Stripe
    let customerId = contrat.stripeCustomerId;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: admin.email,
        name: `${admin.prenom} ${admin.nom}`,
        metadata: {
          adminId: adminId.toString(),
          entreprise: admin.entreprise?.name || 'Non spécifié'
        }
      });
      customerId = customer.id;
      contrat.stripeCustomerId = customerId;
    }

    // Créer la session Stripe Checkout
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      payment_method_types: ['card'],
      mode: 'subscription',
      line_items: [
        {
          price_data: {
            currency: 'eur',
            product_data: {
              name: contrat.detailsPack.nom,
              description: `Abonnement de maintenance Dimotec - Engagement 1 an`,
            },
            unit_amount: contrat.detailsPack.prixMensuel * 100, // En centimes
            recurring: {
              interval: 'month',
            },
          },
          quantity: 1,
        },
      ],
      subscription_data: {
        metadata: {
          adminId: adminId.toString(),
          contratId: contrat._id.toString(),
          packMaintenance: contrat.packMaintenance,
          type: 'contrat_maintenance'
        }
      },
      metadata: {
        adminId: adminId.toString(),
        contratId: contrat._id.toString(),
        type: 'contrat_maintenance'
      },
      success_url: `${process.env.ADMIN_FRONTEND_URL || 'http://localhost:8080'}/settings?tab=contrat&payment=success`,
      cancel_url: `${process.env.ADMIN_FRONTEND_URL || 'http://localhost:8080'}/settings?tab=contrat&payment=cancelled`,
    });

    await contrat.save();

    res.json({
      success: true,
      sessionUrl: session.url,
      sessionId: session.id
    });

  } catch (error) {
    console.error('Erreur creerAbonnementStripe:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la création de l\'abonnement'
    });
  }
};

exports.handleContratStripeWebhook = async (session) => {
  try {
    const { adminId, contratId } = session.metadata;

    if (!adminId || !contratId) {
      console.error('Métadonnées manquantes dans le webhook Stripe');
      return;
    }

    const contrat = await ContratTransfert.findById(contratId);
    if (!contrat) {
      console.error('Contrat introuvable:', contratId);
      return;
    }

    // Récupérer l'abonnement Stripe
    const subscription = await stripe.subscriptions.retrieve(session.subscription);

    // --- CORRECTION ICI : FALLBACKS SUR LES TIMESTAMPS ---
    // On utilise start_date ou created si current_period_start n'est pas encore là
    const startTimestamp = subscription.current_period_start || subscription.start_date || subscription.created;
    
    // Si current_period_end manque (ex: période d'essai ou bug synchro), 
    // on calcule +30 jours par défaut pour ne pas bloquer le script
    const endTimestamp = subscription.current_period_end || (startTimestamp + 30 * 24 * 60 * 60);

    if (!startTimestamp) {
      console.error('Données temporelles Stripe totalement introuvables:', subscription);
      throw new Error('Données Stripe manquantes');
    }

    // Mettre à jour le contrat
    contrat.stripeSubscriptionId = subscription.id;
    contrat.statutPaiement = 'actif';

    // Conversion sécurisée
    const dateDebut = new Date(startTimestamp * 1000);
    const dateFin = new Date(endTimestamp * 1000);

    // Vérifier que les dates sont valides (isNaN)
    if (isNaN(dateDebut.getTime()) || isNaN(dateFin.getTime())) {
      console.error('Dates invalides après conversion:', { startTimestamp, endTimestamp });
      throw new Error('Conversion de dates échouée');
    }

    contrat.dateDebutAbonnement = dateDebut;
    contrat.dateProchaineFacture = dateFin;

    // Engagement 1 an à partir de la date de début
    const dateFinEngagement = new Date(dateDebut);
    dateFinEngagement.setFullYear(dateFinEngagement.getFullYear() + 1);
    contrat.dateFinEngagement = dateFinEngagement;

    await contrat.save();

    // ✅ Mettre à jour le champ contratMaintenance dans Admin pour débloquer les fonctionnalités
    const admin = await Admin.findById(adminId);
    if (admin) {
      admin.contratMaintenance = {
        actif: true,
        type: contrat.packMaintenance, // 'serenite' ou 'evolution'
        dateDebut: dateDebut,
        dateExpiration: dateFinEngagement
      };
      await admin.save();
      console.log(`✅ Contrat de maintenance synchronisé dans Admin ${adminId}`);
    }

    console.log(`✅ Abonnement Stripe activé pour le contrat ${contratId}`);

  } catch (error) {
    console.error('Erreur handleContratStripeWebhook:', error);
    // On re-throw pour que Stripe sache que le webhook a échoué et réessaie plus tard
    throw error;
  }
};

// Webhook handler pour les mises à jour d'abonnement Stripe (annulation, suspension, etc.)
exports.handleContratSubscriptionUpdated = async (subscription) => {
  try {
    const { adminId, contratId } = subscription.metadata || {};

    if (!adminId || !contratId) {
      console.warn('Métadonnées manquantes pour subscription.updated, probablement pas un contrat de maintenance');
      return;
    }

    const contrat = await ContratTransfert.findById(contratId);
    if (!contrat) {
      console.error('Contrat introuvable:', contratId);
      return;
    }

    const admin = await Admin.findById(adminId);
    if (!admin) {
      console.error('Admin introuvable:', adminId);
      return;
    }

    // Mettre à jour le statut selon le statut Stripe
    if (subscription.status === 'active') {
      contrat.statutPaiement = 'actif';
      admin.contratMaintenance.actif = true;
    } else if (subscription.status === 'canceled' || subscription.status === 'incomplete_expired') {
      contrat.statutPaiement = 'annule';
      admin.contratMaintenance.actif = false;
      admin.contratMaintenance.type = 'aucun';
      console.log(`🚫 Abonnement annulé pour le contrat ${contratId}`);
    } else if (subscription.status === 'past_due' || subscription.status === 'unpaid') {
      contrat.statutPaiement = 'suspendu';
      admin.contratMaintenance.actif = false;
      console.log(`⚠️ Abonnement suspendu pour le contrat ${contratId}`);
    }

    // Mettre à jour les dates si disponibles
    if (subscription.current_period_end) {
      contrat.dateProchaineFacture = new Date(subscription.current_period_end * 1000);
    }

    await contrat.save();
    await admin.save();

    console.log(`✅ Abonnement mis à jour pour le contrat ${contratId}, statut: ${subscription.status}`);

  } catch (error) {
    console.error('Erreur handleContratSubscriptionUpdated:', error);
    throw error;
  }
};

// PUT /api/admin/contrat/changer-pack
// Permet de changer de pack après signature (UPGRADE uniquement)
exports.changerPack = async (req, res) => {
  try {
    const adminId = req.user.id;
    const { nouveauPack } = req.body;

    if (!['serenite', 'evolution', 'aucun'].includes(nouveauPack)) {
      return res.status(400).json({
        success: false,
        message: 'Pack invalide'
      });
    }

    const contrat = await ContratTransfert.findOne({ adminId });

    if (!contrat || !contrat.isValide) {
      return res.status(404).json({
        success: false,
        message: 'Aucun contrat signé trouvé'
      });
    }

    // 🚫 Empêcher le DOWNGRADE
    const hierarchie = { 'aucun': 0, 'serenite': 1, 'evolution': 2 };
    const packActuel = hierarchie[contrat.packMaintenance];
    const nouveauPackNiveau = hierarchie[nouveauPack];

    if (nouveauPackNiveau < packActuel) {
      return res.status(400).json({
        success: false,
        message: 'Vous ne pouvez pas rétrograder vers un pack inférieur. Contactez le support pour une résiliation.'
      });
    }

    // ✅ Changement de pack = perte du tarif préférentiel
    contrat.packMaintenance = nouveauPack;
    contrat.tarifPreferentiel = false;

    const packDetails = PACKS_MAINTENANCE[nouveauPack];
    contrat.detailsPack = {
      nom: packDetails.nom,
      prixMensuel: packDetails.prixMensuelNormal,
      fonctionnalites: packDetails.fonctionnalites
    };

    // Mettre à jour l'abonnement Stripe si actif
    if (contrat.stripeSubscriptionId && nouveauPack !== 'aucun') {
      try {
        const subscription = await stripe.subscriptions.retrieve(contrat.stripeSubscriptionId);

        // Mettre à jour le montant de l'abonnement
        await stripe.subscriptions.update(contrat.stripeSubscriptionId, {
          items: [{
            id: subscription.items.data[0].id,
            price_data: {
              currency: 'eur',
              product_data: {
                name: packDetails.nom,
                description: 'Abonnement de maintenance Dimotec - Engagement 1 an',
              },
              unit_amount: packDetails.prixMensuelNormal * 100,
              recurring: {
                interval: 'month',
              },
            },
          }],
          proration_behavior: 'create_prorations'
        });
      } catch (stripeError) {
        console.error('Erreur mise à jour Stripe:', stripeError);
      }
    }

    await contrat.save();

    // Mettre à jour le champ contratMaintenance dans Admin
    const admin = await Admin.findById(adminId);
    if (admin && contrat.statutPaiement === 'actif') {
      admin.contratMaintenance = {
        actif: true,
        type: nouveauPack,
        dateDebut: contrat.dateDebutAbonnement,
        dateExpiration: contrat.dateFinEngagement
      };
      await admin.save();
      console.log(`✅ Contrat de maintenance mis à jour dans Admin ${adminId}`);
    }

    res.json({
      success: true,
      message: 'Pack de maintenance modifié avec succès',
      nouveauPack: contrat.detailsPack,
      avertissement: 'Le tarif préférentiel a été perdu. Nouveau tarif: ' + contrat.detailsPack.prixMensuel + '€/mois'
    });

  } catch (error) {
    console.error('Erreur changerPack:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors du changement de pack'
    });
  }
};

// GET /api/admin/contrat/sync
// Force la synchronisation du contrat vers Admin.contratMaintenance
exports.syncContratToAdmin = async (req, res) => {
  try {
    const adminId = req.user.id;

    const contrat = await ContratTransfert.findOne({ adminId });

    if (!contrat || !contrat.isValide) {
      return res.status(404).json({
        success: false,
        message: 'Aucun contrat signé trouvé'
      });
    }

    const admin = await Admin.findById(adminId);

    if (!admin) {
      return res.status(404).json({
        success: false,
        message: 'Admin introuvable'
      });
    }

    // Synchroniser le contrat de maintenance
    if (contrat.statutPaiement === 'actif' && contrat.packMaintenance !== 'aucun') {
      admin.contratMaintenance = {
        actif: true,
        type: contrat.packMaintenance,
        dateDebut: contrat.dateDebutAbonnement,
        dateExpiration: contrat.dateFinEngagement
      };
    } else if (contrat.packMaintenance !== 'aucun') {
      admin.contratMaintenance = {
        actif: false,
        type: contrat.packMaintenance,
        dateDebut: null,
        dateExpiration: null
      };
    } else {
      admin.contratMaintenance = {
        actif: false,
        type: 'aucun',
        dateDebut: null,
        dateExpiration: null
      };
    }

    await admin.save();

    res.json({
      success: true,
      message: 'Synchronisation effectuée',
      contratMaintenance: admin.contratMaintenance
    });

  } catch (error) {
    console.error('Erreur syncContratToAdmin:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la synchronisation'
    });
  }
};

// GET /api/admin/contrat/telecharger-pdf
// Génère et télécharge le PDF du contrat signé
exports.telechargerPDF = async (req, res) => {
  try {
    const adminId = req.user.id;

    const contrat = await ContratTransfert.findOne({ adminId }).populate('adminId', 'nom prenom email telephone entreprise');

    if (!contrat || !contrat.isValide) {
      return res.status(404).json({
        success: false,
        message: 'Aucun contrat signé trouvé'
      });
    }

    // Créer un nouveau document PDF
    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: 50, bottom: 50, left: 50, right: 50 }
    });

    // Configuration des headers pour le téléchargement
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="Contrat_Dimotec_${contrat._id}.pdf"`);

    // Pipe le PDF vers la réponse HTTP
    doc.pipe(res);

    // Couleur principale
    const orangeColor = '#ed891a';

    // ========== EN-TÊTE ==========
    doc.fontSize(24).fillColor(orangeColor).font('Helvetica-Bold')
       .text('CONTRAT DE TRANSFERT ET LIVRAISON', { align: 'center' });

    doc.fontSize(14).fillColor('#333').font('Helvetica')
       .text('Application Web Dimotec', { align: 'center' })
       .moveDown(0.3);

    doc.fontSize(10).fillColor('#666')
       .text(`Contrat n° ${contrat._id}`, { align: 'center' })
       .moveDown(1);

    // Ligne de séparation
    doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor(orangeColor).lineWidth(2).stroke();
    doc.moveDown(1.5);

    // ========== 1. INFORMATIONS DU CONTRACTANT ==========
    doc.fontSize(14).fillColor(orangeColor).font('Helvetica-Bold')
       .text('1. Informations du Contractant', { underline: true })
       .moveDown(0.5);

    doc.fontSize(10).fillColor('#333').font('Helvetica');
    const infoY = doc.y;
    doc.text(`Nom complet:`, 70, infoY, { continued: true })
       .font('Helvetica-Bold').text(` ${contrat.signature.prenom} ${contrat.signature.nom}`);
    doc.font('Helvetica').text(`Email:`, 70, doc.y + 5, { continued: true })
       .font('Helvetica-Bold').text(` ${contrat.adminId.email}`);
    doc.font('Helvetica').text(`Téléphone:`, 70, doc.y + 5, { continued: true })
       .font('Helvetica-Bold').text(` ${contrat.informationsLegales?.telephoneContact || 'Non renseigné'}`);
    doc.font('Helvetica').text(`Entreprise:`, 70, doc.y + 5, { continued: true })
       .font('Helvetica-Bold').text(` ${contrat.adminId.entreprise?.name || 'Non spécifié'}`);
    doc.font('Helvetica').text(`Adresse:`, 70, doc.y + 5, { continued: true })
       .font('Helvetica-Bold').text(` ${contrat.informationsLegales?.adresseComplete || 'Non renseigné'}`, { width: 450 });

    doc.moveDown(1.5);

    // ========== 2. PACK DE MAINTENANCE ==========
    doc.fontSize(14).fillColor(orangeColor).font('Helvetica-Bold')
       .text('2. Pack de Maintenance Sélectionné', { underline: true })
       .moveDown(0.5);

    doc.fontSize(10).fillColor('#333').font('Helvetica');
    doc.text(`Offre choisie:`, 70, doc.y, { continued: true })
       .font('Helvetica-Bold').text(` ${contrat.detailsPack.nom}`);
    doc.font('Helvetica').text(`Tarif mensuel:`, 70, doc.y + 5, { continued: true })
       .font('Helvetica-Bold').text(` ${contrat.detailsPack.prixMensuel}€ HT / mois`);
    doc.font('Helvetica').text(`Engagement:`, 70, doc.y + 5, { continued: true })
       .font('Helvetica-Bold').text(` 12 mois - Préavis de résiliation: 1 mois`);

    doc.moveDown(0.8);
    doc.font('Helvetica-Bold').text('Fonctionnalités incluses:', 70);
    doc.font('Helvetica').fontSize(9);
    contrat.detailsPack.fonctionnalites.forEach(f => {
      doc.text(`• ${f}`, 90, doc.y + 3, { width: 470 });
    });

    doc.moveDown(1.5);

    // ========== 3. INFORMATIONS DE SIGNATURE ==========
    doc.fontSize(14).fillColor(orangeColor).font('Helvetica-Bold')
       .text('3. Informations de Signature', { underline: true })
       .moveDown(0.5);

    doc.fontSize(10).fillColor('#333').font('Helvetica');
    doc.text(`Date de signature:`, 70, doc.y, { continued: true })
       .font('Helvetica-Bold').text(` ${new Date(contrat.dateSignature).toLocaleString('fr-FR')}`);
    doc.font('Helvetica').text(`Adresse IP:`, 70, doc.y + 5, { continued: true })
       .font('Helvetica-Bold').text(` ${contrat.informationsLegales?.ipSignature || 'N/A'}`);
    doc.font('Helvetica').text(`Navigateur:`, 70, doc.y + 5, { continued: true })
       .font('Helvetica-Bold').text(` ${contrat.informationsLegales?.navigateur || 'N/A'}`);
    doc.font('Helvetica').text(`Système d'exploitation:`, 70, doc.y + 5, { continued: true })
       .font('Helvetica-Bold').text(` ${contrat.informationsLegales?.systemeExploitation || 'N/A'}`);
    doc.font('Helvetica').text(`Horodatage complet:`, 70, doc.y + 5, { continued: true })
       .font('Helvetica-Bold').text(` ${new Date(contrat.informationsLegales?.horodatageComplet).toLocaleString('fr-FR')}`);

    doc.moveDown(1.5);

    // ========== SIGNATURE CANVAS ==========
    doc.fontSize(12).fillColor(orangeColor).font('Helvetica-Bold')
       .text('Signature électronique manuscrite:', 70)
       .moveDown(0.5);

    if (contrat.signature.signatureCanvas) {
      try {
        // Extraire l'image base64 (enlever le préfixe data:image/png;base64,)
        const base64Data = contrat.signature.signatureCanvas.replace(/^data:image\/\w+;base64,/, '');
        const imageBuffer = Buffer.from(base64Data, 'base64');

        // Ajouter l'image de la signature
        doc.image(imageBuffer, 70, doc.y, {
          fit: [300, 100],
          align: 'left'
        });
        doc.moveDown(6);
      } catch (err) {
        console.error('Erreur ajout signature:', err);
        doc.fontSize(10).fillColor('#666').font('Helvetica-Oblique')
           .text('Signature non disponible', 70);
        doc.moveDown(1);
      }
    } else {
      doc.fontSize(10).fillColor('#666').font('Helvetica-Oblique')
         .text('Signature non disponible', 70);
      doc.moveDown(1);
    }

    doc.fontSize(9).fillColor('#333').font('Helvetica-Oblique')
       .text(`Je soussigné(e) ${contrat.signature.prenom} ${contrat.signature.nom}, certifie avoir lu et accepté les conditions générales du présent contrat.`, 70, doc.y, { width: 470 });

    doc.moveDown(1.5);

    // ========== CONDITIONS GÉNÉRALES COMPLÈTES ==========
    doc.addPage();

    doc.fontSize(18).fillColor(orangeColor).font('Helvetica-Bold')
       .text('CONDITIONS GÉNÉRALES', { align: 'center' })
       .moveDown(0.5);

    doc.fontSize(10).fillColor('#666').font('Helvetica')
       .text('de Livraison & Maintenance', { align: 'center' })
       .moveDown(1.5);

    doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor(orangeColor).lineWidth(1).stroke();
    doc.moveDown(1.5);

    // CLAUSE 1
    doc.fontSize(12).fillColor(orangeColor).font('Helvetica-Bold')
       .text('1. Objet du contrat & Livraison')
       .moveDown(0.5);

    doc.fontSize(10).fillColor('#333').font('Helvetica')
       .text(`Le présent contrat acte la livraison de l'application web « ${contrat.adminId.entreprise?.name || 'Dimotec'} ». Le Prestataire (DATAFUSE) confirme avoir transféré le code source spécifique, le nom de domaine et les accès administrateurs nécessaires. Le Client reconnaît la conformité fonctionnelle de la Web App à la date de signature.`, 70, doc.y, { width: 470, align: 'justify' })
       .moveDown(1.2);

    // CLAUSE 2
    doc.fontSize(12).fillColor(orangeColor).font('Helvetica-Bold')
       .text('2. Garantie Technique', 70)
       .moveDown(0.5);

    doc.fontSize(10).fillColor('#333').font('Helvetica')
       .text('Le Prestataire accorde une garantie de 3 mois à compter de la signature initiale. Cette garantie couvre exclusivement les bugs bloquants et les dysfonctionnements des fonctionnalités existantes. Sont exclus : les modifications graphiques, les évolutions fonctionnelles et les modifications de la logique métier.', 70, doc.y, { width: 470, align: 'justify' })
       .moveDown(1.2);

    // CLAUSE 3
    doc.fontSize(12).fillColor(orangeColor).font('Helvetica-Bold')
       .text('3. Propriété Intellectuelle', 70)
       .moveDown(0.5);

    doc.fontSize(10).fillColor('#333').font('Helvetica-Bold')
       .text('Droits du Prestataire : ', 70, doc.y, { continued: true })
       .font('Helvetica')
       .text('DATAFUSE demeure propriétaire exclusif du Moteur Logiciel (architecture, algorithmes, modules génériques, savoir-faire technique et logique métier non spécifique).', { width: 470, align: 'justify' });

    doc.moveDown(0.5);

    doc.font('Helvetica-Bold')
       .text('Droits du Client : ', 70, doc.y, { continued: true })
       .font('Helvetica')
       .text('Le Client bénéficie d\'un droit d\'usage exclusif de la Web App pour ses besoins propres, sans droit de revente, de duplication ou de commercialisation du moteur.', { width: 470, align: 'justify' })
       .moveDown(1.2);

    // CLAUSE 4
    doc.fontSize(12).fillColor(orangeColor).font('Helvetica-Bold')
       .text('4. Extensions & Applications Tierces', 70)
       .moveDown(0.5);

    doc.fontSize(10).fillColor('#333').font('Helvetica')
       .text('Le Prestataire est autorisé à développer des extensions (IA, automatisations, modules mobiles) et à les proposer directement aux utilisateurs finaux via API. Deux modèles de commercialisation sont possibles : la vente directe par DATAFUSE ou un modèle de partenariat (80% Prestataire / 20% Client).', 70, doc.y, { width: 470, align: 'justify' })
       .moveDown(1.2);

    // CLAUSE 5
    doc.fontSize(12).fillColor(orangeColor).font('Helvetica-Bold')
       .text('5. Confidentialité & Non-Exclusivité', 70)
       .moveDown(0.5);

    doc.fontSize(10).fillColor('#333').font('Helvetica-Bold')
       .text('Exclusivité : ', 70, doc.y, { continued: true })
       .font('Helvetica')
       .text('Le présent contrat n\'instaure aucune exclusivité. DATAFUSE peut proposer des technologies similaires à d\'autres clients.', { width: 470, align: 'justify' });

    doc.moveDown(0.5);

    doc.font('Helvetica-Bold')
       .text('Données : ', 70, doc.y, { continued: true })
       .font('Helvetica')
       .text('Les données du Client et de ses utilisateurs restent sa propriété exclusive. DATAFUSE s\'engage à ne jamais copier, réutiliser ou commercialiser ces données.', { width: 470, align: 'justify' })
       .moveDown(1.2);

    // CLAUSE 6
    doc.fontSize(12).fillColor(orangeColor).font('Helvetica-Bold')
       .text('6. Maintenance Évolutive (Options)', 70)
       .moveDown(0.5);

    // Pack Sérénité
    doc.fontSize(10).fillColor('#ed891a').font('Helvetica-Bold')
       .text('PACK 1 - SÉRÉNITÉ', 90)
       .moveDown(0.3);

    doc.fontSize(9).fillColor('#333').font('Helvetica')
       .text('Maintenance corrective (48h), mises à jour techniques (Serveur, MongoDB, API IA), sauvegardes quotidiennes et support prioritaire.', 90, doc.y, { width: 450, align: 'justify' });

    doc.font('Helvetica-Bold').fillColor('#059669')
       .text('250 € HT / mois', 90, doc.y + 3, { continued: true })
       .font('Helvetica').fillColor('#94a3b8')
       .text(' (345 € HT sans tarif fondateur)')
       .moveDown(0.8);

    // Pack Évolution
    doc.fontSize(10).fillColor('#ed891a').font('Helvetica-Bold')
       .text('PACK 2 - ÉVOLUTION', 90)
       .moveDown(0.3);

    doc.fontSize(9).fillColor('#333').font('Helvetica')
       .text('Inclus Pack 1 + Frais d\'hébergement + 1 journée/mois dédiée aux optimisations UX, graphiques et ajustements de logique serveur.', 90, doc.y, { width: 450, align: 'justify' });

    doc.font('Helvetica-Bold').fillColor('#059669')
       .text('400 € HT / mois', 90, doc.y + 3, { continued: true })
       .font('Helvetica').fillColor('#94a3b8')
       .text(' (552 € HT sans tarif fondateur)')
       .moveDown(0.5);

    doc.fontSize(9).fillColor('#666').font('Helvetica-Oblique')
       .text('En l\'absence de souscription, le Prestataire n\'est tenu à aucune obligation de maintenance ou d\'intervention hors devis ponctuel.', 90, doc.y, { width: 450, align: 'justify' })
       .moveDown(1.2);

    // CLAUSE 7
    doc.fontSize(12).fillColor(orangeColor).font('Helvetica-Bold')
       .text('7. Droit applicable & Litiges', 70)
       .moveDown(0.5);

    doc.fontSize(10).fillColor('#333').font('Helvetica')
       .text('Le contrat est soumis au droit français. Compétence exclusive : ', 70, doc.y, { continued: true })
       .font('Helvetica-Bold')
       .text('Tribunal de Commerce de Paris.')
       .moveDown(2);

    // ENGAGEMENT
    doc.fontSize(11).fillColor('#ed891a').font('Helvetica-Bold')
       .text('Durée d\'engagement', 70)
       .moveDown(0.5);

    doc.fontSize(10).fillColor('#333').font('Helvetica')
       .text('Le présent contrat de maintenance est conclu pour une durée de 12 mois à compter de la date de signature. Le contrat se renouvelle par tacite reconduction pour des périodes successives de 12 mois. Chaque partie peut résilier le contrat moyennant un préavis écrit de 1 mois avant la fin de la période en cours.', 70, doc.y, { width: 470, align: 'justify' })
       .moveDown(2);

    // ========== FOOTER ==========
    doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#ddd').lineWidth(1).stroke();
    doc.moveDown(0.8);

    doc.fontSize(9).fillColor('#666').font('Helvetica')
       .text(`Document généré le ${new Date().toLocaleDateString('fr-FR')} - Contrat légalement valide`, { align: 'center' });
    doc.font('Helvetica-Bold')
       .text('DATAFUSE - Service Dimotec', { align: 'center' });
    doc.font('Helvetica')
       .text(`Version du contrat: ${contrat.versionContrat}`, { align: 'center' });

    // Finaliser le PDF
    doc.end();

  } catch (error) {
    console.error('Erreur telechargerPDF:', error);
    if (!res.headersSent) {
      res.status(500).json({
        success: false,
        message: 'Erreur lors de la génération du PDF'
      });
    }
  }
};