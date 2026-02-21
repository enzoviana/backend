// controllers/contratController.js
const ContratTransfert = require('../models/ContratTransfert');
const Admin = require('../models/Admin');
const sendEmail = require('../utils/sendEmails');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const puppeteer = require('puppeteer');

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
    } else {
      contrat.statutPaiement = 'actif'; // Pas de paiement requis pour le pack sans maintenance
    }
    await contrat.save();

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
          packMaintenance: contrat.packMaintenance
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

// Webhook handler pour les événements Stripe de contrat
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

    // Mettre à jour le contrat
    contrat.stripeSubscriptionId = subscription.id;
    contrat.statutPaiement = 'actif';
    contrat.dateDebutAbonnement = new Date(subscription.current_period_start * 1000);
    contrat.dateProchaineFacture = new Date(subscription.current_period_end * 1000);

    // Engagement 1 an à partir de la date de début
    const dateFinEngagement = new Date(subscription.current_period_start * 1000);
    dateFinEngagement.setFullYear(dateFinEngagement.getFullYear() + 1);
    contrat.dateFinEngagement = dateFinEngagement;

    await contrat.save();

    console.log(`✅ Abonnement Stripe activé pour le contrat ${contratId}`);

  } catch (error) {
    console.error('Erreur handleContratStripeWebhook:', error);
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

    // Générer le HTML du contrat
    const html = `
    <!DOCTYPE html>
    <html lang="fr">
    <head>
      <meta charset="UTF-8">
      <style>
        body { font-family: Arial, sans-serif; margin: 40px; color: #333; }
        .header { text-align: center; border-bottom: 3px solid #ed891a; padding-bottom: 20px; margin-bottom: 30px; }
        .header h1 { color: #ed891a; margin: 0; }
        .section { margin-bottom: 25px; }
        .section h2 { color: #ed891a; font-size: 16px; border-bottom: 1px solid #ddd; padding-bottom: 5px; }
        .info-table { width: 100%; border-collapse: collapse; margin: 15px 0; }
        .info-table td { padding: 8px; border: 1px solid #ddd; }
        .info-table td:first-child { font-weight: bold; background: #f8f9fa; width: 30%; }
        .signature-box { border: 2px solid #ed891a; padding: 15px; margin-top: 30px; background: #fff3e0; }
        .signature-img { max-width: 300px; height: auto; border: 1px solid #ddd; background: white; padding: 10px; }
        .footer { text-align: center; margin-top: 50px; font-size: 12px; color: #666; border-top: 1px solid #ddd; padding-top: 20px; }
      </style>
    </head>
    <body>
      <div class="header">
        <h1>CONTRAT DE TRANSFERT ET LIVRAISON</h1>
        <p><strong>Application Web Dimotec</strong></p>
        <p>Contrat n° ${contrat._id}</p>
      </div>

      <div class="section">
        <h2>1. Informations du Contractant</h2>
        <table class="info-table">
          <tr><td>Nom complet</td><td>${contrat.signature.prenom} ${contrat.signature.nom}</td></tr>
          <tr><td>Email</td><td>${contrat.adminId.email}</td></tr>
          <tr><td>Téléphone</td><td>${contrat.informationsLegales?.telephoneContact || 'Non renseigné'}</td></tr>
          <tr><td>Entreprise</td><td>${contrat.adminId.entreprise?.name || 'Non spécifié'}</td></tr>
          <tr><td>Adresse</td><td>${contrat.informationsLegales?.adresseComplete || 'Non renseigné'}</td></tr>
        </table>
      </div>

      <div class="section">
        <h2>2. Pack de Maintenance Sélectionné</h2>
        <table class="info-table">
          <tr><td>Offre choisie</td><td><strong>${contrat.detailsPack.nom}</strong></td></tr>
          <tr><td>Tarif mensuel</td><td><strong>${contrat.detailsPack.prixMensuel}€ HT / mois</strong></td></tr>
          <tr><td>Engagement</td><td>12 mois - Préavis de résiliation: 1 mois</td></tr>
        </table>

        <p><strong>Fonctionnalités incluses:</strong></p>
        <ul>
          ${contrat.detailsPack.fonctionnalites.map(f => `<li>${f}</li>`).join('')}
        </ul>
      </div>

      <div class="section">
        <h2>3. Informations de Signature</h2>
        <table class="info-table">
          <tr><td>Date de signature</td><td>${new Date(contrat.dateSignature).toLocaleString('fr-FR')}</td></tr>
          <tr><td>Adresse IP</td><td>${contrat.informationsLegales?.ipSignature || 'N/A'}</td></tr>
          <tr><td>Navigateur</td><td>${contrat.informationsLegales?.navigateur || 'N/A'}</td></tr>
          <tr><td>Système d'exploitation</td><td>${contrat.informationsLegales?.systemeExploitation || 'N/A'}</td></tr>
          <tr><td>Horodatage complet</td><td>${new Date(contrat.informationsLegales?.horodatageComplet).toLocaleString('fr-FR')}</td></tr>
        </table>
      </div>

      <div class="signature-box">
        <p><strong>Signature électronique manuscrite:</strong></p>
        ${contrat.signature.signatureCanvas ? `<img src="${contrat.signature.signatureCanvas}" class="signature-img" alt="Signature" />` : '<p>Signature non disponible</p>'}
        <p style="margin-top: 15px;"><em>Je soussigné(e) ${contrat.signature.prenom} ${contrat.signature.nom}, certifie avoir lu et accepté les conditions générales du présent contrat.</em></p>
      </div>

      <div class="section" style="margin-top: 30px;">
        <h2>4. Conditions Générales</h2>
        <p><strong>Garantie technique:</strong> 3 mois à compter de la signature initiale.</p>
        <p><strong>Propriété intellectuelle:</strong> DATAFUSE reste propriétaire du moteur logiciel. Le Client bénéficie d'un droit d'usage exclusif.</p>
        <p><strong>Données:</strong> Les données restent la propriété exclusive du Client.</p>
        <p><strong>Engagement:</strong> Durée de 12 mois avec reconduction tacite. Résiliation sur préavis d'1 mois.</p>
        <p><strong>Droit applicable:</strong> Droit français - Tribunal de Commerce de Paris.</p>
      </div>

      <div class="footer">
        <p>Document généré le ${new Date().toLocaleDateString('fr-FR')} - Contrat légalement valide</p>
        <p><strong>DATAFUSE</strong> - Service Dimotec</p>
        <p>Version du contrat: ${contrat.versionContrat}</p>
      </div>
    </body>
    </html>
    `;

    // Générer le PDF avec puppeteer
    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '20px', bottom: '20px', left: '20px', right: '20px' }
    });
    await browser.close();

    // Envoyer le PDF
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="Contrat_Dimotec_${contrat._id}.pdf"`);
    res.send(pdfBuffer);

  } catch (error) {
    console.error('Erreur telechargerPDF:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la génération du PDF'
    });
  }
};