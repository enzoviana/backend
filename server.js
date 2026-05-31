require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

const adminRoutes = require('./routes/adminRoutes');
const agencyRoutes = require('./routes/agencyRoutes');
const devisRoutes = require('./routes/devisRoutes');
const dashboardRoutes = require('./routes/dashboardRoutes');
const chatbotRoutes = require('./routes/chatbotRoutes');
const diagnostiqueurRoutes = require('./routes/diagnostiqueurRoutes');
const stripeRoutes = require('./routes/stripeRoutes');
const adminSyncRoutes = require('./routes/adminSyncRoutes');

const scheduledJobs = require('./jobs/scheduledJobs');

const app = express();

/* =====================================================
   1️⃣ CONFIGURATION CORS
===================================================== */
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

/* =====================================================
   2️⃣ LOGGER GLOBAL (avant tout)
===================================================== */
app.use((req, res, next) => {
  console.log(`\x1b[36m%s\x1b[0m`, `[REQUÊTE ENTRANTE] ${req.method} ${req.url}`);
  next();
});

/* =====================================================
   3️⃣ STRIPE WEBHOOK (RAW obligatoire avant json)
===================================================== */
app.use('/api/stripe/webhook', express.raw({ type: 'application/json' }));
app.use('/api/stripe', stripeRoutes);

/* =====================================================
   4️⃣ PARSER JSON (avec limite augmentée pour les images en base64)
===================================================== */
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

/* =====================================================
   5️⃣ ROUTES API
===================================================== */
app.use('/api/sync', adminSyncRoutes); // ⚠️ IMPORTANT: Les routes spécifiques AVANT les routes génériques
app.use('/api/admin', adminRoutes);
app.use('/api/agency', agencyRoutes);
app.use('/api/client', devisRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/devis', devisRoutes);
app.use('/api/chatbot', chatbotRoutes);
app.use('/api/diagnostiqueur', diagnostiqueurRoutes);

app.get('/', (req, res) => {
  res.send('API Plateforme Diagnostiqueur est en ligne ! 🚀');
});

/* =====================================================
   6️⃣ ANALYSEUR DE ROUTES (Stable & sécurisé)
===================================================== */
const listRoutes = () => {
  console.log(`\n\x1b[33m=== ANALYSE DES ROUTES ===\x1b[0m`);

  const routes = [];

  app._router?.stack?.forEach((middleware) => {
    if (middleware.route) {
      // Routes directes (app.get, app.post, etc.)
      routes.push({
        path: middleware.route.path,
        methods: Object.keys(middleware.route.methods)
          .map(m => m.toUpperCase())
          .join(', ')
      });
    }

    else if (middleware.name === 'router' && middleware.handle?.stack) {
      middleware.handle.stack.forEach((handler) => {
        if (handler.route) {
          routes.push({
            path: handler.route.path,
            methods: Object.keys(handler.route.methods)
              .map(m => m.toUpperCase())
              .join(', ')
          });
        }
      });
    }
  });

  if (routes.length === 0) {
    console.log("⚠️ Aucune route détectée (Express 5 détecté ou router non exposé)");
    console.log("👉 Vérifie ta version avec: npm list express");
  } else {
    routes.forEach(r => {
      console.log(`[OK] ${r.methods} ${r.path}`);
    });
  }

  console.log(`\x1b[33m==========================\x1b[0m\n`);
};


/* =====================================================
   7️⃣ CONNEXION MONGODB
===================================================== */
const MONGO_URI = process.env.MONGO_URI;

// Optionnel: Petit check de sécurité si la variable est vide
if (!MONGO_URI) {
  console.error('\x1b[31m%s\x1b[0m', '❌ ERREUR: La variable d\'environnement MONGO_URI n\'est pas définie !');
}

mongoose.connect(MONGO_URI)
.then(() => {
  // Récupération des infos de connexion via l'objet mongoose
  const dbName = mongoose.connection.name;
  const dbHost = mongoose.connection.host;

  console.log(`\n\x1b[32m=========================================\x1b[0m`);
  console.log(`\x1b[32m🟩 MongoDB connecté avec succès ! 🟩\x1b[0m`);
  console.log(`\x1b[35m[BDD] Nom de la base : ${dbName}\x1b[0m`);
  console.log(`\x1b[35m[HÔTE] Connecté sur  : ${dbHost}\x1b[0m`);
  console.log(`\x1b[32m=========================================\x1b[0m\n`);

  console.log('📅 Initialisation des jobs planifiés...');
  scheduledJobs.init();
})
.catch(err => {
  console.error('\x1b[31m%s\x1b[0m', `❌ Erreur de connexion MongoDB : ${err.message}`);
});

/* =====================================================
   8️⃣ GESTION ERREURS
===================================================== */
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ message: 'Erreur interne du serveur' });
});

/* =====================================================
   9️⃣ DÉMARRAGE SERVEUR
===================================================== */
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Serveur démarré sur http://localhost:${PORT} 🚀`);
  listRoutes(); // ✅ appelé ici seulement (100% safe)
});