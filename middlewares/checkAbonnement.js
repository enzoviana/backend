/**
 * Middleware paramétré pour vérifier le type d'abonnement
 * Usage: checkAbonnement('PRO') ou checkAbonnement(['PRO', 'STANDARD'])
 */
const checkAbonnement = (typesAutorises) => {
  // Normaliser en tableau
  const types = Array.isArray(typesAutorises) ? typesAutorises : [typesAutorises];

  return (req, res, next) => {
    try {
      // Vérifie que req.diagnostiqueur existe (doit être après diagnostiqueurAuth)
      if (!req.diagnostiqueur) {
        return res.status(401).json({ message: 'Authentification requise.' });
      }

      const { typeAbonnement } = req.diagnostiqueur;

      // Vérifie si le type d'abonnement est autorisé
      if (!types.includes(typeAbonnement)) {
        return res.status(403).json({
          message: 'Accès réservé aux abonnés PRO.',
          typeActuel: typeAbonnement,
          typesRequis: types,
          upgradeUrl: '/abonnement/upgrade'
        });
      }

      next();

    } catch (error) {
      console.error('Erreur checkAbonnement:', error);
      res.status(500).json({ message: 'Erreur serveur lors de la vérification de l\'abonnement.' });
    }
  };
};

module.exports = checkAbonnement;
