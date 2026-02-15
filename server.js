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
   4️⃣ PARSER JSON
===================================================== */
app.use(express.json());

/* =====================================================
   5️⃣ ROUTES API
===================================================== */
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
const MONGO_LIVE = process.env.MONGO_LIVE || 'mongodb://127.0.0.1:27017/diag_platform';

mongoose.connect(MONGO_LIVE)
.then(() => {
  console.log('MongoDB connecté ✅');
  console.log('📅 Initialisation des jobs planifiés...');
  scheduledJobs.init();
})
.catch(err => {
  console.error('Erreur MongoDB :', err);
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
