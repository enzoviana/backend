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

    // ⚡ Définit req.user avec l'id, email et role
    req.user = {
      id: decoded.id,
      email: decoded.email,
      role: decoded.role || 'admin', // par défaut admin si non fourni
    };

    next(); // passe au prochain middleware / route
  } catch (error) {
    console.error(error);
    res.status(401).json({ message: 'Token invalide.' });
  }
};

module.exports = authMiddleware;
