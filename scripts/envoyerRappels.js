require('dotenv').config();
const mongoose = require('mongoose');
const { envoyerRappelsAutomatiques } = require('../controllers/devisController');

// ⚡ Connexion à MongoDB
mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
}).then(() => {
  console.log("✅ Connecté à MongoDB pour le cron");
  return envoyerRappelsAutomatiques();
}).then(() => {
  console.log("✅ Cron terminé");
  mongoose.disconnect();
}).catch(err => {
  console.error("❌ Erreur dans le cron :", err);
  mongoose.disconnect();
});
