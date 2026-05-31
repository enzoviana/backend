# Guide de Déploiement Docker - Backend Dimotec

## Prérequis

- Docker installé (version 20.10 ou supérieure)
- Docker Compose installé (version 2.0 ou supérieure)
- Accès à un serveur ou VPS (pour la production)

## Configuration Initiale

### 1. Créer le fichier d'environnement

```bash
# Copiez le fichier d'exemple
cp .env.production .env

# Éditez le fichier .env avec vos vraies valeurs
nano .env
```

**Important**: Modifiez TOUTES les valeurs sensibles:
- `JWT_SECRET`: Générez une clé sécurisée longue
- Clés Stripe: Utilisez les clés **LIVE** en production
- Identifiants SMTP et autres services

### 2. Vérifier la structure

Assurez-vous que votre répertoire `backend` contient:
```
backend/
├── Dockerfile
├── docker-compose.yml
├── .dockerignore
├── .env
├── package.json
├── server.js
└── ... (autres fichiers du backend)
```

## Déploiement Local (Test)

### Lancer l'application

```bash
# Construire et démarrer les conteneurs
docker-compose up -d

# Voir les logs
docker-compose logs -f

# Vérifier le statut
docker-compose ps
```

### Accéder à l'application

- Backend: http://localhost:3000
- MongoDB: localhost:27017

### Commandes utiles

```bash
# Arrêter les conteneurs
docker-compose down

# Arrêter et supprimer les volumes (⚠️ supprime les données MongoDB)
docker-compose down -v

# Reconstruire les images
docker-compose build --no-cache

# Redémarrer un service spécifique
docker-compose restart backend

# Voir les logs d'un service
docker-compose logs -f backend
docker-compose logs -f mongo

# Accéder au shell d'un conteneur
docker-compose exec backend sh
docker-compose exec mongo mongosh
```

## Déploiement en Production

### Option 1: Serveur VPS (DigitalOcean, OVH, etc.)

#### 1. Connexion au serveur

```bash
ssh user@votre-serveur.com
```

#### 2. Installation de Docker

```bash
# Ubuntu/Debian
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh
sudo usermod -aG docker $USER

# Installer Docker Compose
sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose
```

#### 3. Transférer le code

```bash
# Depuis votre machine locale
scp -r backend user@votre-serveur.com:/home/user/

# Ou cloner depuis Git (recommandé)
ssh user@votre-serveur.com
git clone votre-repo.git
cd votre-repo/backend
```

#### 4. Configuration et lancement

```bash
# Créer et configurer le .env
cp .env.production .env
nano .env

# Lancer l'application
docker-compose up -d

# Vérifier que tout fonctionne
docker-compose logs -f
```

#### 5. Configuration du pare-feu

```bash
# Ouvrir le port 3000 (ou configurer un reverse proxy)
sudo ufw allow 3000/tcp
sudo ufw allow 22/tcp  # SSH
sudo ufw enable
```

### Option 2: Avec Nginx comme Reverse Proxy (Recommandé)

#### 1. Modifier docker-compose.yml

```yaml
# Dans docker-compose.yml, changer le port backend de:
ports:
  - "3000:3000"

# En:
ports:
  - "127.0.0.1:3000:3000"  # N'expose que sur localhost
```

#### 2. Installer et configurer Nginx

```bash
sudo apt update
sudo apt install nginx

# Créer la configuration
sudo nano /etc/nginx/sites-available/dimotec-backend
```

Contenu du fichier Nginx:
```nginx
server {
    listen 80;
    server_name votre-domaine.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

```bash
# Activer la configuration
sudo ln -s /etc/nginx/sites-available/dimotec-backend /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```

#### 3. Configurer SSL avec Let's Encrypt

```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d votre-domaine.com
```

## Maintenance

### Mise à jour du code

```bash
# Arrêter les conteneurs
docker-compose down

# Mettre à jour le code (depuis Git)
git pull

# Reconstruire et redémarrer
docker-compose build
docker-compose up -d
```

### Backup MongoDB

```bash
# Créer un backup
docker-compose exec mongo mongodump --out /data/backup

# Copier le backup hors du conteneur
docker cp dimotec-mongo:/data/backup ./backup-$(date +%Y%m%d)

# Restaurer un backup
docker cp ./backup-20240101 dimotec-mongo:/data/restore
docker-compose exec mongo mongorestore /data/restore
```

### Logs et monitoring

```bash
# Voir les logs en temps réel
docker-compose logs -f

# Voir les stats des conteneurs
docker stats

# Vérifier la santé des conteneurs
docker-compose ps
```

## Dépannage

### Le backend ne démarre pas

```bash
# Vérifier les logs
docker-compose logs backend

# Vérifier les variables d'environnement
docker-compose exec backend env

# Tester la connexion MongoDB
docker-compose exec backend node -e "console.log('Test')"
```

### MongoDB ne se connecte pas

```bash
# Vérifier que MongoDB est bien démarré
docker-compose ps mongo

# Tester la connexion
docker-compose exec mongo mongosh --eval "db.adminCommand('ping')"
```

### Port déjà utilisé

```bash
# Trouver quel process utilise le port
sudo lsof -i :3000

# Changer le port dans docker-compose.yml
ports:
  - "3001:3000"
```

## Sécurité en Production

- [ ] Utilisez des secrets forts pour JWT_SECRET
- [ ] Configurez un pare-feu (ufw, iptables)
- [ ] Utilisez HTTPS avec un certificat SSL
- [ ] Ne pas exposer MongoDB directement sur Internet
- [ ] Mettez à jour régulièrement les images Docker
- [ ] Activez les healthchecks
- [ ] Configurez des backups automatiques
- [ ] Limitez les accès SSH (clés uniquement)

## Architecture de Production Recommandée

```
Internet
   ↓
[Nginx (HTTPS) - Port 443]
   ↓
[Docker Backend - Port 3000]
   ↓
[Docker MongoDB - Port 27017 (localhost only)]
```

## Support

Pour toute question ou problème, consultez:
- Documentation Docker: https://docs.docker.com
- Documentation MongoDB: https://docs.mongodb.com
- Documentation Nginx: https://nginx.org/en/docs
