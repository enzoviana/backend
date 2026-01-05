require('dotenv').config(); // pour charger .env
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

// Routes
const adminRoutes = require('./routes/adminRoutes');
const agencyRoutes = require('./routes/agencyRoutes');
const devisRoutes = require('./routes/devisRoutes');
const dashboardRoutes = require('./routes/dashboardRoutes');

const app = express();

// Middleware
app.use(cors());
app.use(express.json()); // parser JSON

// Middleware pour logger toutes les requêtes
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`);
  next();
});

// Routes
app.use('/api/admin', adminRoutes);
app.use('/api/agency', agencyRoutes);
app.use('/api/client', devisRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/devis', devisRoutes)
// Test route
app.get('/', (req, res) => {
  res.send('API est en ligne !');
});

// Connexion à MongoDB
const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/maBase';
mongoose.connect(MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
})
.then(() => console.log('MongoDB connecté ✅'))
.catch(err => console.error('Erreur MongoDB :', err));

// Démarrage serveur
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Serveur démarré sur http://localhost:${PORT} 🚀`);
});
