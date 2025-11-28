const jwt = require('jsonwebtoken');
const Agence = require('../models/Agency');
const Employe = require('../models/Employe');

const JWT_SECRET = process.env.JWT_SECRET || 'tonSecretIci';

const auth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer '))
      return res.status(401).json({ message: 'Token manquant' });

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET);
 
    /**
     * decoded = {
     *   id: xx,
     *   type: 'agence' | 'employe',
     *   role: ...
     *   agenceId: ...
     *   email: ...
     * }
     */

    let user = null;

    // ⬅️ 1️⃣ Si c’est une agence
    if (decoded.type === "agence") {
      user = await Agence.findById(decoded.id);
      if (!user) return res.status(401).json({ message: "Agence introuvable" });

      req.role = "agence";
      req.user = user;
      req.agence = user; // cohérence
    }

    // ⬅️ 2️⃣ Si c’est un employé
    else if (decoded.type === "employe") {
      user = await Employe.findById(decoded.id);
      if (!user) return res.status(401).json({ message: "Employé introuvable" });

      const agence = await Agence.findById(user.agence);

      req.role = "employe";
      req.user = user;
      req.agence = agence; // pratique pour tout le reste
    }

    else {
      return res.status(401).json({ message: "Type de compte invalide" });
    }

    next();
  } catch (err) {
    console.error("Erreur auth :", err);
    return res.status(401).json({ message: "Authentification échouée" });
  }
};

module.exports = auth;
