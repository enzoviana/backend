// middlewares/authMiddleware.js
const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET || 'tonSecretIci';

const authMiddleware = (req, res, next) => {
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

    // Ajoute les infos de l'admin à la requête
    req.admin = decoded; // { id, email, role }

    next(); // passe au prochain middleware / route
  } catch (error) {
    console.error(error);
    res.status(401).json({ message: 'Token invalide.' });
  }
};

module.exports = authMiddleware;
