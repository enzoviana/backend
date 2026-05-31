# ⚡ Test Rapide - Synchronisation BDD

Guide ultra-rapide pour tester la synchronisation Atlas → Docker.

## 🚀 Méthode 1 : Ligne de commande (Plus rapide)

### 1. Vérifier la configuration

```bash
cd backend
cat .env | grep MONGO
```

Vous devriez voir :
```
MONGO_URI=mongodb://localhost:27017/monbackend
MONGO_LIVE=mongodb+srv://contact_db_use...
```

### 2. Vérifier que Docker tourne

```bash
docker ps
```

Vous devriez voir un conteneur MongoDB actif.

Si MongoDB n'est pas actif :
```bash
docker-compose up -d mongodb
# ou
docker start <nom-du-conteneur-mongodb>
```

### 3. Lancer la synchronisation

```bash
npm run sync:databases
```

Tapez `oui` quand on vous le demande.

### 4. Vérifier les résultats

Vous devriez voir à la fin :
```
✅ SYNCHRONISATION TERMINÉE AVEC SUCCÈS !
```

## 🌐 Méthode 2 : Via Postman (API)

### 1. Vérifier la configuration

**GET** `http://localhost:3000/api/admin/sync/check-config`

Headers:
```
Authorization: Bearer <votre-token-admin>
```

✅ **Attendu :**
```json
{
  "success": true,
  "peutSynchroniser": true,
  "message": "Configuration OK - Synchronisation possible"
}
```

### 2. Lancer la sync (mode asynchrone)

**POST** `http://localhost:3000/api/admin/sync/start`

Headers:
```
Authorization: Bearer <votre-token-admin>
Content-Type: application/json
```

Body:
```json
{
  "avecBackup": true,
  "viderAvant": true,
  "copierIndexes": true
}
```

✅ **Attendu :**
```json
{
  "success": true,
  "message": "Synchronisation démarrée",
  "syncId": "sync_1705315845123"
}
```

### 3. Vérifier la progression

**GET** `http://localhost:3000/api/admin/sync/status/sync_1705315845123`

Remplacez `sync_1705315845123` par le syncId reçu à l'étape 2.

✅ **Pendant la sync :**
```json
{
  "success": true,
  "status": "en_cours",
  "progression": 45,
  "collectionActuelle": "devis"
}
```

✅ **Quand c'est terminé :**
```json
{
  "success": true,
  "status": "termine",
  "progression": 100,
  "stats": {
    "collections": {
      "total": 12,
      "reussies": 12,
      "erreurs": 0
    },
    "documents": {
      "total": 1534,
      "copies": 1534
    }
  }
}
```

### Alternative : Mode bloquant (attend la fin)

**POST** `http://localhost:3000/api/admin/sync/execute`

⚠️ Cette requête peut prendre plusieurs minutes à répondre !

Body:
```json
{
  "avecBackup": true,
  "viderAvant": true,
  "copierIndexes": true
}
```

## 🧪 Vérification après synchronisation

### 1. Vérifier via MongoDB Compass

Connectez-vous à `mongodb://localhost:27017/monbackend`

Vous devriez voir toutes vos collections avec les données d'Atlas.

### 2. Vérifier via le CLI MongoDB

```bash
# Connexion au conteneur Docker
docker exec -it <nom-conteneur-mongodb> mongosh

# Dans mongosh
use monbackend
show collections
db.clients.countDocuments()
db.devis.countDocuments()
```

### 3. Vérifier via l'application

Lancez votre frontend et vérifiez que les données s'affichent correctement.

## ⚠️ Résolution de problèmes

### Erreur : "MONGO_LIVE non défini"

**Solution :**
```bash
# Vérifier le .env
cat .env | grep MONGO_LIVE

# Si vide, ajouter
echo 'MONGO_LIVE=mongodb+srv://votre-uri-atlas' >> .env
```

### Erreur : "Cannot connect to MongoDB"

**Solution :**
```bash
# Vérifier que Docker tourne
docker ps

# Démarrer MongoDB si nécessaire
docker-compose up -d mongodb

# Vérifier les logs
docker logs <nom-conteneur-mongodb>
```

### Erreur : "Access denied" ou 401

**Solution :**
Vérifiez que votre token d'authentification est valide et que vous êtes admin.

### La sync est bloquée à 0%

**Solution :**
1. Vérifiez la connexion internet (pour accéder à Atlas)
2. Vérifiez que les credentials Atlas sont corrects dans `.env`
3. Consultez les logs du serveur backend

### Les données ne correspondent pas

**Solution :**
1. Vérifiez que vous êtes connecté à la bonne base Atlas
2. Relancez la sync avec `viderAvant: true`

## 📊 Exemples de résultats attendus

### Petite base de données (< 1000 docs)

```
📊 RAPPORT DE SYNCHRONISATION
======================================================================
⏱️  Durée totale: 5.23 secondes

📚 Collections: 12 réussies
📄 Documents: 847 copiés

✅ SYNCHRONISATION TERMINÉE AVEC SUCCÈS !
```

### Base moyenne (1000-10000 docs)

```
📊 RAPPORT DE SYNCHRONISATION
======================================================================
⏱️  Durée totale: 23.45 secondes

📚 Collections: 15 réussies
📄 Documents: 5,234 copiés

✅ SYNCHRONISATION TERMINÉE AVEC SUCCÈS !
```

## 🎯 Checklist de test

- [ ] Variables d'environnement configurées
- [ ] Docker MongoDB actif
- [ ] Connexion à Atlas fonctionne
- [ ] Token admin disponible
- [ ] Routes ajoutées dans server.js
- [ ] Premier test ligne de commande réussi
- [ ] Test Postman réussi
- [ ] Données visibles dans MongoDB Compass
- [ ] Application frontend fonctionne avec les données

## 📝 Notes

- **Temps de sync** : Varie selon la taille de la base et votre connexion
- **Backup** : Créé automatiquement avec un nom type `backup_2025-01-15T10-30-45-123Z`
- **Idempotence** : Vous pouvez relancer la sync autant de fois que nécessaire
- **Sécurité** : Seuls les admins authentifiés peuvent lancer une sync

## 🆘 Besoin d'aide ?

1. Consultez `README_SYNC_BDD.md` pour la doc complète
2. Consultez `INTEGRATION_SYNC_BDD.md` pour l'intégration
3. Vérifiez les logs du serveur backend
4. Vérifiez les logs Docker MongoDB

## ✅ Test réussi !

Si vous voyez ce message :
```
✅ SYNCHRONISATION TERMINÉE AVEC SUCCÈS !
```

Félicitations ! Votre système de synchronisation fonctionne parfaitement. 🎉

Vous pouvez maintenant :
- Synchroniser régulièrement votre base locale avec Atlas
- Développer localement avec des données de production
- Tester en toute sécurité sans impacter la production
