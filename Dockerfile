# Utiliser une image Node.js LTS officielle
FROM node:20-alpine

# Définir le répertoire de travail
WORKDIR /app

# Copier les fichiers de dépendances
COPY package*.json ./

# Installer les dépendances de production
RUN npm ci --only=production

# Copier le reste du code source
COPY . .

# Exposer le port de l'application
EXPOSE 3000

# Variables d'environnement par défaut (peuvent être surchargées)
ENV NODE_ENV=production
ENV PORT=3000

# Démarrer l'application
CMD ["node", "server.js"]
