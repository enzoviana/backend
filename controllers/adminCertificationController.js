const Certification = require('../models/Certification');
const Diagnostiqueur = require('../models/Diagnostiqueur');
const TechnicienDiagnostiqueur = require('../models/TechnicienDiagnostiqueur');
const DomaineActivite = require('../models/DomaineActivite');
const sendEmail = require('../utils/sendEmails');

/**
 * GET - Liste des certifications en attente d'approbation
 */
const getCertificationsEnAttente = async (req, res) => {
  try {
    const certifications = await Certification.find({
      'approbation.statutApprobation': 'en_attente'
    })
    .populate('diagnostiqueur', 'nom_entreprise admin.email')
    .populate('technicien', 'prenom nom')
    .populate('domaine', 'nom code')
    .sort({ createdAt: -1 });

    res.json({ certifications });
  } catch (error) {
    console.error('Erreur getCertificationsEnAttente:', error);
    res.status(500).json({ message: error.message });
  }
};

/**
 * GET - Toutes les certifications avec filtres optionnels
 */
const getToutesCertifications = async (req, res) => {
  try {
    const { statutApprobation, diagnostiqueurId } = req.query;
    const query = {};

    if (statutApprobation) {
      query['approbation.statutApprobation'] = statutApprobation;
    }
    if (diagnostiqueurId) {
      query.diagnostiqueur = diagnostiqueurId;
    }

    const certifications = await Certification.find(query)
      .populate('diagnostiqueur', 'nom_entreprise admin.email')
      .populate('technicien', 'prenom nom')
      .populate('domaine', 'nom code')
      .sort({ createdAt: -1 });

    res.json({ certifications });
  } catch (error) {
    console.error('Erreur getToutesCertifications:', error);
    res.status(500).json({ message: error.message });
  }
};

/**
 * PUT - Approuver une certification
 */
const approuverCertification = async (req, res) => {
  try {
    const { certificationId } = req.params;
    const { commentaireAdmin } = req.body;
    const adminId = req.user.id;

    const certification = await Certification.findById(certificationId);
    if (!certification) {
      return res.status(404).json({ message: 'Certification non trouvée' });
    }

    // Mettre à jour l'approbation
    certification.approbation.statutApprobation = 'approuve';
    certification.approbation.approuvePar = adminId;
    certification.approbation.dateApprobation = new Date();
    certification.approbation.commentaireAdmin = commentaireAdmin || null;
    certification.approbation.raisonRejet = null;

    // Recalculer le statut (valide/expire/a_renouveler)
    if (typeof certification.calculerStatut === 'function') {
        certification.calculerStatut();
    }

    await certification.save();

    const certificationPopulated = await Certification.findById(certificationId)
      .populate('diagnostiqueur', 'nom_entreprise admin.email')
      .populate('technicien', 'prenom nom')
      .populate('domaine', 'nom code')
      .populate('approbation.approuvePar', 'nom prenom');

    // Envoyer un email de notification au diagnostiqueur
    try {
      const dateExpiration = new Date(certificationPopulated.dateExpiration).toLocaleDateString('fr-FR');

      await sendEmail({
        to: certificationPopulated.diagnostiqueur.admin.email,
        subject: '✅ Certification approuvée - Dimotec Contrôles',
        template: 'CertificationApprouvee.html',
        variables: {
          nomDiagnostiqueur: certificationPopulated.diagnostiqueur.nom_entreprise,
          nomDomaine: certificationPopulated.domaine.nom,
          codeDomaine: certificationPopulated.domaine.code,
          nomTechnicien: `${certificationPopulated.technicien.prenom} ${certificationPopulated.technicien.nom}`,
          numeroCertification: certificationPopulated.numeroCertification,
          organisme: certificationPopulated.organisme,
          dateExpiration: dateExpiration,
          commentaireAdmin: commentaireAdmin || '',
          commentaireDisplay: commentaireAdmin ? '' : 'display: none;'
        }
      });

      console.log('✅ Email de certification approuvée envoyé avec succès');
    } catch (emailError) {
      console.error('❌ Erreur envoi email certification approuvée:', emailError);
      // Ne pas bloquer la réponse si l'email échoue
    }

    res.json({
      message: 'Certification approuvée avec succès',
      certification: certificationPopulated
    });
  } catch (error) {
    console.error('Erreur approuverCertification:', error);
    res.status(500).json({ message: error.message });
  }
};

/**
 * PUT - Rejeter une certification
 */
const rejeterCertification = async (req, res) => {
  try {
    const { certificationId } = req.params;
    const { raisonRejet, commentaireAdmin } = req.body;
    const adminId = req.user.id;

    if (!raisonRejet) {
      return res.status(400).json({ message: 'Raison du rejet requise' });
    }

    const certification = await Certification.findById(certificationId);
    if (!certification) {
      return res.status(404).json({ message: 'Certification non trouvée' });
    }

    // Mettre à jour l'approbation
    certification.approbation.statutApprobation = 'rejete';
    certification.approbation.approuvePar = adminId;
    certification.approbation.dateApprobation = new Date();
    certification.approbation.raisonRejet = raisonRejet;
    certification.approbation.commentaireAdmin = commentaireAdmin || null;
    certification.statut = 'rejete';

    await certification.save();

    const certificationPopulated = await Certification.findById(certificationId)
      .populate('diagnostiqueur', 'nom_entreprise admin.email')
      .populate('technicien', 'prenom nom')
      .populate('domaine', 'nom code')
      .populate('approbation.approuvePar', 'nom prenom');

    // Envoyer un email de notification au diagnostiqueur
    try {
      await sendEmail({
        to: certificationPopulated.diagnostiqueur.admin.email,
        subject: '❌ Certification non approuvée - Dimotec Contrôles',
        template: 'CertificationRejetee.html',
        variables: {
          nomDiagnostiqueur: certificationPopulated.diagnostiqueur.nom_entreprise,
          nomDomaine: certificationPopulated.domaine.nom,
          codeDomaine: certificationPopulated.domaine.code,
          nomTechnicien: `${certificationPopulated.technicien.prenom} ${certificationPopulated.technicien.nom}`,
          numeroCertification: certificationPopulated.numeroCertification,
          organisme: certificationPopulated.organisme,
          raisonRejet: raisonRejet,
          commentaireAdmin: commentaireAdmin || '',
          commentaireDisplay: commentaireAdmin ? '' : 'display: none;'
        }
      });

      console.log('✅ Email de certification rejetée envoyé avec succès');
    } catch (emailError) {
      console.error('❌ Erreur envoi email certification rejetée:', emailError);
      // Ne pas bloquer la réponse si l'email échoue
    }

    res.json({
      message: 'Certification rejetée',
      certification: certificationPopulated
    });
  } catch (error) {
    console.error('Erreur rejeterCertification:', error);
    res.status(500).json({ message: error.message });
  }
};

/**
 * DELETE - Supprimer une certification
 */
const supprimerCertification = async (req, res) => {
  try {
    const { certificationId } = req.params;

    const certification = await Certification.findById(certificationId);
    if (!certification) {
      return res.status(404).json({ message: 'Certification non trouvée' });
    }

    await Certification.findByIdAndDelete(certificationId);

    res.json({
      message: 'Certification supprimée avec succès'
    });
  } catch (error) {
    console.error('Erreur supprimerCertification:', error);
    res.status(500).json({ message: error.message });
  }
};

/**
 * GET - Télécharger le document d'une certification (proxy Cloudinary sécurisé)
 */
/**
 * GET - Télécharger le document d'une certification (proxy Cloudinary sécurisé)
 */
const telechargerDocumentCertification = async (req, res) => {
  try {
    // 1. LOG DE DÉPART - Si ce log n'apparaît pas, le problème est dans votre fichier de routes (middleware)
    console.log('--- 🔽 DÉBUT FONCTION BACKEND: telechargerDocumentCertification ---');
    
    // Vérifier l'utilisateur injecté par le middleware d'auth
    console.log('👤 Utilisateur Req:', req.user ? { id: req.user._id, role: req.user.role } : 'Aucun req.user trouvé');
    
    // Vérifier le header Authorization reçu
    console.log('🔑 Auth Header:', req.headers.authorization ? 'Présent (commence par ' + req.headers.authorization.substring(0, 15) + '...)' : 'ABSENT');

    const { certificationId } = req.params;
    console.log('🆔 ID Certification demandé:', certificationId);

    // 2. RECHERCHE EN BDD
    const certification = await Certification.findById(certificationId);
    
    if (!certification) {
      console.log('❌ Certification non trouvée en BDD pour ID:', certificationId);
      return res.status(404).json({ message: 'Certification non trouvée' });
    }

    console.log('✅ Certification récupérée:', {
      _id: certification._id,
      hasDocument: !!certification.document,
      url: certification.document?.url ? 'OUI (présente)' : 'NON (absente)'
    });

    if (!certification.document || !certification.document.url) {
      console.log('❌ Erreur: Pas d\'URL Cloudinary associée');
      return res.status(404).json({ message: 'Aucun document associé à cette certification' });
    }

    const documentUrl = certification.document.url;
    const documentNom = certification.document.nom || `certification-${certificationId}.pdf`;

    // 3. REQUÊTE VERS CLOUDINARY
    console.log('📡 Tentative de streaming depuis Cloudinary...');
    const https = require('https');
    const http = require('http');

    const parsedUrl = new URL(documentUrl);
    const protocol = parsedUrl.protocol === 'https:' ? https : http;

    protocol.get(documentUrl, (cloudinaryResponse) => {
      console.log('📦 Status retour Cloudinary:', cloudinaryResponse.statusCode);
      console.log('📦 Headers retour Cloudinary:', cloudinaryResponse.headers['content-type']);

      if (cloudinaryResponse.statusCode !== 200) {
        console.error('❌ Cloudinary a répondu avec une erreur:', cloudinaryResponse.statusCode);
        return res.status(cloudinaryResponse.statusCode).json({
          message: `Erreur Cloudinary (${cloudinaryResponse.statusCode})`
        });
      }

      // 4. CONFIGURATION DE LA RÉPONSE CLIENT
      res.setHeader('Content-Type', cloudinaryResponse.headers['content-type'] || 'application/pdf');
      // Utilisation d'un nom de fichier propre
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(documentNom)}"`);
      
      if (cloudinaryResponse.headers['content-length']) {
        res.setHeader('Content-Length', cloudinaryResponse.headers['content-length']);
      }

      console.log('🚀 Début du pipe vers le client...');

      cloudinaryResponse.pipe(res);

      // Log quand c'est fini
      res.on('finish', () => {
        console.log('🏁 Transfert terminé avec succès pour:', documentNom);
        console.log('--- 🔼 FIN FONCTION BACKEND ---');
      });

    }).on('error', (error) => {
      console.error('❌ Erreur réseau HTTP/HTTPS:', error.message);
      if (!res.headersSent) {
        res.status(500).json({ message: 'Erreur réseau lors du téléchargement' });
      }
    });

  } catch (error) {
    console.error('💥 CRASH EXCEPTION dans telechargerDocumentCertification:', error);
    if (!res.headersSent) {
      res.status(500).json({ message: error.message });
    }
  }
};
// Exportation groupée de toutes les fonctions
module.exports = {
  getCertificationsEnAttente,
  getToutesCertifications,
  approuverCertification,
  rejeterCertification,
  supprimerCertification,
  telechargerDocumentCertification
};