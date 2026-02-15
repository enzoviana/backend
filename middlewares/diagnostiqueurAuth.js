const jwt = require('jsonwebtoken');
const Diagnostiqueur = require('../models/Diagnostiqueur');

const JWT_SECRET = process.env.JWT_SECRET || 'tonSecretIci';

/**
 * Middleware d'authentification pour les diagnostiqueurs
 * Vérifie le JWT et charge le diagnostiqueur depuis MongoDB
 */
const diagnostiqueurAuth = async (req, res, next) => {
  try {
    // Vérifie que le header Authorization existe et commence par "Bearer "
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ message: 'Token manquant.' });
    }

    // Récupère le token
    const token = authHeader.split(' ')[1];

    // Vérifie le token
    const decoded = jwt.verify(token, JWT_SECRET);

    // Vérifie que c'est un token diagnostiqueur
    if (decoded.type !== 'diagnostiqueur') {
      return res.status(403).json({ message: 'Accès non autorisé. Token invalide.' });
    }

    // Charge le diagnostiqueur depuis la base de données
    const diagnostiqueur = await Diagnostiqueur.findById(decoded.id);

    if (!diagnostiqueur) {
      return res.status(404).json({ message: 'Diagnostiqueur non trouvé.' });
    }

    // Vérifie le statut du diagnostiqueur
    if (diagnostiqueur.statut === 'bloqué') {
      return res.status(403).json({ message: 'Votre compte est bloqué. Contactez l\'administrateur.' });
    }

    if (diagnostiqueur.statut === 'suspendu') {
      return res.status(403).json({ message: 'Votre compte est suspendu.' });
    }

    if (diagnostiqueur.statut === 'en_attente') {
      return res.status(403).json({ message: 'Votre compte est en attente de validation.' });
    }

    // Injecte les informations dans req
    req.user = {
      id: decoded.id,
      email: decoded.email,
      role: 'diagnostiqueur'
    };
    req.diagnostiqueur = diagnostiqueur;
    req.role = 'diagnostiqueur';

    next();

  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ message: 'Token invalide.' });
    }
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ message: 'Token expiré.' });
    }

    console.error('Erreur diagnostiqueurAuth:', error);
    res.status(500).json({ message: 'Erreur serveur lors de l\'authentification.' });
  }
};

module.exports = diagnostiqueurAuth;
