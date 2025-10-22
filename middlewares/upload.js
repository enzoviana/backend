const multer = require('multer');
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const cloudinary = require('cloudinary').v2;
const OrdreMission = require('../models/OrdreMission'); // modèle Mongoose

// Config Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Fonction pour générer un public_id unique en vérifiant les doublons
async function generateUniquePublicId(originalName, missionId) {
  const baseName = originalName.replace(/\.[^/.]+$/, '').replace(/\s+/g, '_');
  let publicId = `${Date.now()}-${baseName}`;
  let count = 1;

  const mission = await OrdreMission.findById(missionId);
  const existingNames = mission?.fichiersClient.map(f => f.nom) || [];

  while (existingNames.includes(publicId)) {
    publicId = `${Date.now()}-${baseName}+${count}`;
    count++;
  }

  return publicId;
}

// Stockage Multer + Cloudinary
const storage = new CloudinaryStorage({
  cloudinary,
  params: async (req, file) => {
    console.log("📂 Upload reçu par CloudinaryStorage :", file.originalname);

    const missionId = req.body.missionId;
    const publicId = missionId 
      ? await generateUniquePublicId(file.originalname, missionId)
      : `${Date.now()}-${file.originalname.replace(/\.[^/.]+$/, '').replace(/\s+/g, '_')}`;

    // Détecte le type de ressource
    const ext = file.originalname.split('.').pop().toLowerCase();
    const resourceType = ['pdf','doc','docx','xls','xlsx','ppt','pptx','txt','csv'].includes(ext)
      ? 'raw' // fichiers "non-images" → raw
      : 'image'; // images → image

    return {
      folder: 'dimotec',
      allowed_formats: [
        'jpg','jpeg','png','webp',
        'pdf','doc','docx','xls','xlsx',
        'ppt','pptx','txt','csv'
      ],
      public_id: publicId,
      type: 'upload',
      resource_type: resourceType, // ✅ crucial pour éviter les 404
    };
  }
});

// Limite de taille à 5 Mo par fichier
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    console.log("🔍 FileFilter appelé pour :", file.originalname);
    cb(null, true);
  }
});

console.log("✅ Multer + CloudinaryStorage configuré (fichiers publics, max 5 Mo)");

module.exports = upload;
