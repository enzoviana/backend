// controllers/contratController.js
const ContratTransfert = require('../models/ContratTransfert');
const Admin = require('../models/Admin');
const sendEmail = require('../utils/sendEmails');

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
        dateSignature: contrat.dateSignature,
        packMaintenance: contrat.packMaintenance,
        detailsPack: contrat.detailsPack,
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

// PUT /api/admin/contrat/changer-pack
// Permet de changer de pack après signature (passage au tarif normal)
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

    // Changement de pack = perte du tarif préférentiel
    contrat.packMaintenance = nouveauPack;
    contrat.tarifPreferentiel = false;

    const packDetails = PACKS_MAINTENANCE[nouveauPack];
    contrat.detailsPack = {
      nom: packDetails.nom,
      prixMensuel: packDetails.prixMensuelNormal,
      fonctionnalites: packDetails.fonctionnalites
    };

    await contrat.save();

    res.json({
      success: true,
      message: 'Pack de maintenance modifié avec succès',
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