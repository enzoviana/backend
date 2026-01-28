const express = require('express');
const router = express.Router();
const chatbotController = require('../controllers/chatbotController');
const agencyAuth = require('../middlewares/agencyAuth');
const jwt = require('jsonwebtoken');
const Admin = require('../models/Admin'); // Assure-toi que le chemin est correct

/**
 * Middleware d'authentification Hybride (Admin / Agence / Employé)
 * Ce middleware identifie qui parle au chatbot pour filtrer les données
 */
const combinedAuth = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Token manquant ou format invalide' });
  }

  const token = authHeader.split(' ')[1];
  const JWT_SECRET = process.env.JWT_SECRET;

  try {
    const decoded = jwt.verify(token, JWT_SECRET);

    // 1. Cas Administrateur (Accès Global)
    if (decoded.role === 'admin') {
      const admin = await Admin.findById(decoded.id);
      if (!admin) {
        return res.status(401).json({ message: 'Compte Admin introuvable' });
      }
      req.role = 'admin';
      req.user = admin;
      return next();
    }

    // 2. Cas Agence ou Employé (Accès Restreint)
    // On délègue au middleware agencyAuth existant qui gère déjà le req.agence et req.role
    if (decoded.type === 'agence' || decoded.type === 'employe') {
      return agencyAuth(req, res, next);
    }

    return res.status(403).json({ message: 'Type de compte non autorisé pour le chatbot' });
  } catch (error) {
    console.error('Erreur dans le middleware combinedAuth:', error.message);
    return res.status(401).json({ message: 'Session expirée ou invalide' });
  }
};

/**
 * ROUTES DU CHATBOT
 */

// Route principale : Envoi de message et traitement IA (avec Tool Calling)
router.post('/chat', combinedAuth, chatbotController.chat);

// Route explicite : Pour les actions directes depuis l'interface (ex: bouton "Créer Devis")

// Route utilitaire : Récupérer des suggestions de questions selon le rôle (Admin ou Agence)
router.get('/suggestions', combinedAuth, chatbotController.getSuggestions);

module.exports = router;