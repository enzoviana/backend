# 🚨 Solution Rate Limit Hostinger

## Erreur rencontrée
```
451 4.7.1 Ratelimit "hostinger_out_ratelimit" exceeded
```

Cette erreur signifie que Hostinger bloque temporairement l'envoi d'emails car vous dépassez leur limite d'envoi.

## 📊 Limites Hostinger typiques
- **10-20 emails par heure** (selon le plan)
- **100-300 emails par jour** (selon le plan)
- **Connexions simultanées limitées**

## ✅ Solutions implémentées

### 1. **Retry automatique avec backoff exponentiel**
Dans `/backend/utils/sendEmails.js`:
- Détecte automatiquement l'erreur 451
- Réessaye 3 fois avec délais croissants: 5s → 15s → 30s
- Si échec après 3 tentatives → erreur explicite `RATE_LIMIT_EXCEEDED`

```javascript
// Retry delays
[5000, 15000, 30000] // 5s, 15s, 30s
```

### 2. **Limitation des connexions SMTP**
Configuration optimisée dans `sendEmails.js`:
```javascript
pool: true,
maxConnections: 2,    // ⬇️ Réduit de 5 à 2
maxMessages: 10,      // ⬇️ Réduit de 100 à 10
rateDelta: 2000,      // ⏱️ 2s entre chaque email
rateLimit: 5,         // 📊 Max 5 emails/2s
```

### 3. **Délais entre les envois multiples**
Ajouté `sleep(2000)` entre chaque email dans:
- Envoi client → agence (devisController.js:1299)
- Ordre mission agence → dimotec (devisController.js:1252)
- Boucles d'alertes (plusieurs endroits)

### 4. **Gestion explicite de l'erreur**
Le code détecte maintenant spécifiquement l'erreur 451:
```javascript
const isRateLimit = error.message?.includes('451') ||
                    error.message?.includes('ratelimit') ||
                    error.responseCode === 451;
```

## 🔧 Configuration actuelle

### Variables d'environnement `.env`
```env
SMTP_HOST=smtp.hostinger.com
SMTP_PORT=587
SMTP_USER=support@.votre-devis-diagnostics.fr
SMTP_PASS=kRfUQ>Q$2

IMAP_HOST=imap.hostinger.com
IMAP_PORT=993
```

## 🎯 Recommandations

### Option 1: Continuer avec Hostinger (actuel)
**Avantages:**
- Gratuit/inclus dans l'hébergement
- Déjà configuré

**Limitations:**
- 10-20 emails/heure maximum
- Peut causer des ralentissements
- Pas idéal pour croissance

**À faire:**
- Limiter la création de devis à max 10-15 par heure
- Espacer les envois de 2-5 minutes si possible
- Surveiller les logs pour détecter les 451

### Option 2: Utiliser Brevo (recommandé) 🌟
**Avantages:**
- **300 emails/jour GRATUITS**
- Limites plus élevées: 100+ emails/heure
- Infrastructure professionnelle
- Tracking des emails (ouvertures, clics)
- Meilleure délivrabilité

**Configuration:**
Vous avez déjà une clé API Brevo dans votre `.env`:
```env
BREVO_API_KEY=xsmtpsib-1ead873dd3f9b79e08440c0d0add6eb697034d4689f0541ec7cd5898789bed40-zZLKB3BTO2XbGtXG
```

Je peux créer un `sendEmailBrevo.js` qui utilise cette API.

### Option 3: SendGrid (professionnel)
- **100 emails/jour gratuits**
- Plans payants très scalables
- Excellente réputation

### Option 4: Amazon SES
- 0,10$ pour 1000 emails
- Infrastructure AWS robuste
- Idéal pour volume élevé

## 📈 Comparaison

| Service | Gratuit/jour | Coût | Fiabilité | Setup |
|---------|-------------|------|-----------|-------|
| **Hostinger** | 10-20 | Inclus | ⭐⭐ | ✅ Fait |
| **Brevo** | 300 | Gratuit | ⭐⭐⭐⭐ | 🟡 Simple |
| **SendGrid** | 100 | $0 puis $15/mois | ⭐⭐⭐⭐⭐ | 🟡 Simple |
| **AWS SES** | - | $0.10/1000 | ⭐⭐⭐⭐⭐ | 🔴 Complexe |

## 🚀 Migration vers Brevo (recommandé)

Si vous voulez passer à Brevo, dites-le moi et je vais:
1. Créer `sendEmailBrevo.js` utilisant l'API Brevo
2. Modifier `devisController.js` pour utiliser Brevo
3. Garder Hostinger en fallback si Brevo échoue

**Temps d'implémentation:** 10 minutes

## 🔍 Monitoring

### Logs à surveiller
```bash
# Rate limit détecté
⚠️ Rate limit détecté pour client@example.com. Retry 1/3 dans 5s...

# Échec définitif
❌ Erreur lors de l'envoi de l'e-mail à client@example.com: Rate limit Hostinger atteint
```

### Commande pour voir les devis en attente
```bash
curl -X POST https://votre-app.herokuapp.com/api/public/verifier-bounces \
  -H "Authorization: Bearer TOKEN"
```

## 📝 Notes importantes

1. **Avec les modifications actuelles**, vous devriez pouvoir envoyer:
   - ~15-20 devis par heure sans erreur 451
   - Chaque email a 3 tentatives avec delays

2. **Si vous continuez à avoir l'erreur 451**:
   - Vérifiez combien d'emails sont envoyés par heure
   - Considérez sérieusement Brevo (gratuit, 300/jour)
   - Ajoutez plus de délais entre les emails

3. **Production Heroku**:
   - Les limites Hostinger s'appliquent par compte email
   - Tous les environnements (dev, staging, prod) partagent la même limite

## ✅ Checklist de test

- [ ] Tester création d'un devis → vérifier logs
- [ ] Créer 3 devis d'affilée → vérifier si 451 apparaît
- [ ] Si 451 → vérifier que le retry fonctionne (logs "Retry 1/3")
- [ ] Si échec après 3 retries → email marqué "Email_Errone"
- [ ] Décider: rester sur Hostinger ou migrer vers Brevo

## 🆘 Si ça continue

Contactez Hostinger pour:
- Demander une augmentation de limite
- Confirmer votre limite actuelle
- Voir si un upgrade de plan augmente la limite

Ou **passez à Brevo (recommandé)** - c'est gratuit et 15x plus de limite!
