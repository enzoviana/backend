const multer = require('multer');
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const cloudinary = require('cloudinary').v2;
const OrdreMission = require('../models/OrdreMission');

// Config Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Génération de public_id unique
async function generateUniquePublicId(originalName, missionId) {
  const baseName = originalName.replace(/\.[^/.]+$/, '').replace(/\s+/g, '_');
  let publicId = `${Date.now()}-${baseName}`;
  
  if (missionId) {
    try {
      const mission = await OrdreMission.findById(missionId);
      const existingNames = mission?.fichiersClient.map(f => f.nom) || [];
      let count = 1;
      while (existingNames.includes(publicId)) {
        publicId = `${Date.now()}-${baseName}_${count}`;
        count++;
      }
    } catch (e) {
      console.error("Erreur check doublons:", e);
    }
  }
  return publicId;
}

// Configuration du stockage
const storage = new CloudinaryStorage({
  cloudinary,
  params: async (req, file) => {
    const ext = file.originalname.split('.').pop().toLowerCase();
    const missionId = req.body.missionId;
    const publicId = await generateUniquePublicId(file.originalname, missionId);

    // Détermination du resource_type
    let resourceType = 'raw'; 
    if (['jpg', 'jpeg', 'png', 'webp', 'pdf'].includes(ext)) {
      resourceType = 'image'; // PDF et Images vont ici
    }

    return {
      folder: 'dimotec',
      public_id: publicId,
      resource_type: resourceType,
      // IMPORTANT : Pour les PDF en mode 'image', on peut forcer le format
      format: ext === 'pdf' ? 'pdf' : undefined, 
    };
  }
});

// Middleware Multer avec limites augmentées
const upload = multer({
  storage,
  limits: { 
    fileSize: 50 * 1024 * 1024 // Limite augmentée à 50 Mo pour les ZIP/Archives
  },
  fileFilter: (req, file, cb) => {
    const ext = file.originalname.split('.').pop().toLowerCase();
    const allowedExtensions = [
      'jpg', 'jpeg', 'png', 'webp', 
      'pdf', 'doc', 'docx', 'xls', 'xlsx', 
      'zip', 'rar', '7z', 'txt', 'csv'
    ];

    if (allowedExtensions.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error(`Format de fichier .${ext} non supporté`), false);
    }
  }
});

console.log("✅ Middleware Upload (Multer+Cloudinary) prêt : Max 50Mo, Support ZIP/RAR");

module.exports = upload;