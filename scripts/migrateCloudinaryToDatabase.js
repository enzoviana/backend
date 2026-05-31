require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });const mongoose = require('mongoose');
const axios = require('axios');
const path = require('path');
 
// Modèles
const Document = require('../models/Document');
const Diagnostiqueur = require('../models/Diagnostiqueur');
const Devis = require('../models/Devis');
const OrdreMission = require('../models/OrdreMission');
const cloudinary = require('../config/cloudinary');

// Statistiques de migration
const stats = {
  total: 0,
  reussis: 0,
  erreurs: 0,
  skipped: 0,
  detailsParType: {}
};

/**
 * Télécharge un fichier depuis une URL et retourne le buffer
 */
async function telechargerFichier(url) {
  try {
    const response = await axios.get(url, {
      responseType: 'arraybuffer',
      timeout: 30000, // 30 secondes
      maxContentLength: 50 * 1024 * 1024 // 50 MB max
    });
    return Buffer.from(response.data);
  } catch (error) {
    throw new Error(`Erreur téléchargement ${url}: ${error.message}`);
  }
}

/**
 * Détermine le content type depuis l'extension
 */
function getContentType(extension) {
  const types = {
    'pdf': 'application/pdf',
    'jpg': 'image/jpeg',
    'jpeg': 'image/jpeg',
    'png': 'image/png',
    'webp': 'image/webp',
    'doc': 'application/msword',
    'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'xls': 'application/vnd.ms-excel',
    'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'zip': 'application/zip',
    'rar': 'application/x-rar-compressed',
    '7z': 'application/x-7z-compressed',
    'txt': 'text/plain',
    'csv': 'text/csv'
  };
  return types[extension.toLowerCase()] || 'application/octet-stream';
}

/**
 * Extrait l'extension depuis l'URL ou le nom de fichier
 */
function getExtension(url, nom) {
  // Essayer depuis le nom
  if (nom) {
    const match = nom.match(/\.([a-zA-Z0-9]+)$/);
    if (match) return match[1].toLowerCase();
  }

  // Essayer depuis l'URL
  const urlMatch = url.match(/\.([a-zA-Z0-9]+)(?:\?|$)/);
  if (urlMatch) return urlMatch[1].toLowerCase();

  // Vérifier si c'est un PDF Cloudinary
  if (url.includes('.pdf')) return 'pdf';

  return 'unknown';
}

/**
 * Crée un document dans la BDD
 */
async function creerDocument(params) {
  const { nom, type, url, publicId, relatedModel, relatedId, relatedField, metadata } = params;

  try {
    // Vérifier si le document existe déjà
    if (publicId) {
      const existant = await Document.findOne({ cloudinaryPublicId: publicId });
      if (existant) {
        console.log(`⏭️  Document déjà migré: ${nom} (${publicId})`);
        stats.skipped++;
        return existant;
      }
    }

    // Télécharger le fichier
    console.log(`📥 Téléchargement: ${nom} depuis ${url.substring(0, 60)}...`);
    const buffer = await telechargerFichier(url);

    // Déterminer l'extension et le content type
    const extension = getExtension(url, nom);
    const contentType = getContentType(extension);

    // Créer le document
    const document = new Document({
      nom: nom || `document_${Date.now()}`,
      type,
      data: buffer,
      contentType,
      taille: buffer.length,
      extension,
      cloudinaryPublicId: publicId,
      cloudinaryUrl: url,
      relatedTo: {
        model: relatedModel,
        id: relatedId,
        field: relatedField
      },
      metadata: metadata || {},
      dateDepot: new Date(),
      dateMigration: new Date()
    });

    await document.save();

    stats.reussis++;
    if (!stats.detailsParType[type]) stats.detailsParType[type] = 0;
    stats.detailsParType[type]++;

    console.log(`✅ Migré: ${nom} (${(buffer.length / 1024).toFixed(2)} KB)`);
    return document;

  } catch (error) {
    stats.erreurs++;
    console.error(`❌ Erreur migration ${nom}:`, error.message);
    return null;
  }
}

/**
 * Migre les documents d'un diagnostiqueur
 */
async function migrerDocumentsDiagnostiqueur(diagnostiqueur) {
  console.log(`\n📋 Diagnostiqueur: ${diagnostiqueur.nom_entreprise} (${diagnostiqueur._id})`);

  // 1. Documents administratifs
  for (const doc of diagnostiqueur.documents || []) {
    if (!doc.url) continue;

    stats.total++;
    await creerDocument({
      nom: doc.nom,
      type: doc.type,
      url: doc.url,
      publicId: doc.public_id,
      relatedModel: 'Diagnostiqueur',
      relatedId: diagnostiqueur._id,
      relatedField: 'documents',
      metadata: {
        dateExpiration: doc.dateExpiration,
        dateValidation: doc.dateValidation,
        statut: doc.statut,
        raisonRefus: doc.raisonRefus
      }
    });
  }

  // 2. Logo
  if (diagnostiqueur.logo) {
    stats.total++;
    await creerDocument({
      nom: `logo_${diagnostiqueur.nom_entreprise}`,
      type: 'logo_entreprise',
      url: diagnostiqueur.logo,
      publicId: null,
      relatedModel: 'Diagnostiqueur',
      relatedId: diagnostiqueur._id,
      relatedField: 'logo'
    });
  }

  // 3. Photo de profil admin
  if (diagnostiqueur.admin?.photo_profil) {
    stats.total++;
    await creerDocument({
      nom: `photo_${diagnostiqueur.admin.prenom}_${diagnostiqueur.admin.nom}`,
      type: 'photo_profil',
      url: diagnostiqueur.admin.photo_profil,
      publicId: null,
      relatedModel: 'Diagnostiqueur',
      relatedId: diagnostiqueur._id,
      relatedField: 'admin.photo_profil'
    });
  }
}

/**
 * Migre les documents d'un devis
 */
async function migrerDocumentsDevis(devis) {
  console.log(`\n📄 Devis: ${devis.numero} (${devis._id})`);

  // 1. PDF du devis
  if (devis.pdfUrl) {
    stats.total++;
    await creerDocument({
      nom: `${devis.numero}.pdf`,
      type: 'devis_pdf',
      url: devis.pdfUrl,
      publicId: null,
      relatedModel: 'Devis',
      relatedId: devis._id,
      relatedField: 'pdfUrl'
    });
  }

  // 2. Signature client
  if (devis.signatureUrl) {
    stats.total++;
    await creerDocument({
      nom: `signature_${devis.numero}`,
      type: 'signature_client',
      url: devis.signatureUrl,
      publicId: null,
      relatedModel: 'Devis',
      relatedId: devis._id,
      relatedField: 'signatureUrl'
    });
  }
}

/**
 * Migre les documents d'un ordre de mission
 */
async function migrerDocumentsOrdreMission(mission) {
  console.log(`\n🎯 Ordre Mission: ${mission.numero} (${mission._id})`);

  // 1. Consentement PDF
  if (mission.consentementPdf?.url) {
    stats.total++;
    await creerDocument({
      nom: mission.consentementPdf.nom || 'consentement.pdf',
      type: 'consentement_pdf',
      url: mission.consentementPdf.url,
      publicId: mission.consentementPdf.public_id,
      relatedModel: 'OrdreMission',
      relatedId: mission._id,
      relatedField: 'consentementPdf'
    });
  }

  // 2. Fichiers clients
  for (const fichier of mission.fichiersClient || []) {
    if (!fichier.url) continue;

    stats.total++;
    await creerDocument({
      nom: fichier.nom,
      type: 'fichier_client',
      url: fichier.url,
      publicId: fichier.public_id,
      relatedModel: 'OrdreMission',
      relatedId: mission._id,
      relatedField: 'fichiersClient'
    });
  }
}

/**
 * Script principal de migration
 */
async function migrerTousLesDocuments() {
  try {
    console.log('🚀 Début de la migration Cloudinary → MongoDB\n');
    console.log('=' .repeat(60));

    // Connexion à MongoDB
    await mongoose.connect(process.env.MONGO_LIVE || process.env.MONGO_LIVE);
    console.log('✅ Connecté à MongoDB\n');

    // 1. Migrer tous les diagnostiqueurs
    console.log('\n📦 MIGRATION DES DIAGNOSTIQUEURS');
    console.log('=' .repeat(60));
    const diagnostiqueurs = await Diagnostiqueur.find({});
    console.log(`Trouvé ${diagnostiqueurs.length} diagnostiqueur(s)\n`);

    for (const diag of diagnostiqueurs) {
      await migrerDocumentsDiagnostiqueur(diag);
    }

    // 2. Migrer tous les devis
    console.log('\n📦 MIGRATION DES DEVIS');
    console.log('=' .repeat(60));
    const devis = await Devis.find({ $or: [{ pdfUrl: { $ne: null } }, { signatureUrl: { $ne: null } }] });
    console.log(`Trouvé ${devis.length} devis avec documents\n`);

    for (const dev of devis) {
      await migrerDocumentsDevis(dev);
    }

    // 3. Migrer tous les ordres de mission
    console.log('\n📦 MIGRATION DES ORDRES DE MISSION');
    console.log('=' .repeat(60));
    const missions = await OrdreMission.find({
      $or: [
        { 'consentementPdf.url': { $exists: true, $ne: null } },
        { fichiersClient: { $exists: true, $ne: [] } }
      ]
    });
    console.log(`Trouvé ${missions.length} ordre(s) de mission avec documents\n`);

    for (const mission of missions) {
      await migrerDocumentsOrdreMission(mission);
    }

    // Afficher les statistiques finales
    console.log('\n' + '=' .repeat(60));
    console.log('📊 STATISTIQUES DE MIGRATION');
    console.log('=' .repeat(60));
    console.log(`Total documents traités:    ${stats.total}`);
    console.log(`✅ Réussis:                 ${stats.reussis}`);
    console.log(`⏭️  Déjà existants (skip):   ${stats.skipped}`);
    console.log(`❌ Erreurs:                 ${stats.erreurs}`);
    console.log('\n📈 Détails par type:');
    Object.entries(stats.detailsParType).forEach(([type, count]) => {
      console.log(`   - ${type}: ${count}`);
    });
    console.log('=' .repeat(60));

    // Afficher la taille totale stockée
    const documentsStats = await Document.aggregate([
      {
        $group: {
          _id: null,
          totalSize: { $sum: '$taille' },
          count: { $sum: 1 }
        }
      }
    ]);

    if (documentsStats.length > 0) {
      const totalMB = (documentsStats[0].totalSize / (1024 * 1024)).toFixed(2);
      console.log(`\n💾 Espace total utilisé: ${totalMB} MB pour ${documentsStats[0].count} documents`);
    }

    console.log('\n✅ Migration terminée avec succès !');

  } catch (error) {
    console.error('\n❌ Erreur lors de la migration:', error);
    throw error;
  } finally {
    await mongoose.disconnect();
    console.log('\n👋 Déconnexion de MongoDB');
  }
}

// Exécuter le script
if (require.main === module) {
  migrerTousLesDocuments()
    .then(() => {
      console.log('\n🎉 Script terminé');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n💥 Erreur fatale:', error);
      process.exit(1);
    });
}

module.exports = { migrerTousLesDocuments };
