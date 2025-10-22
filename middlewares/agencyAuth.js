const jwt = require('jsonwebtoken');
const Agence = require('../models/Agency');

const JWT_SECRET = process.env.JWT_SECRET || 'tonSecretIci';

const agencyAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer '))
      return res.status(401).json({ message: 'Token manquant' });

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET);

    // Vérifier que l'agence existe
    const agence = await Agence.findById(decoded.agenceId);
    if (!agence) return res.status(401).json({ message: 'Token invalide' });

    // Ajouter l'agence à la requête pour y accéder facilement dans les routes
    req.agence = agence;
    next();
  } catch (err) {
    console.error(err);
    res.status(401).json({ message: 'Authentification échouée' });
  }
};

module.exports = agencyAuth;
