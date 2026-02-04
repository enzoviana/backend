# 📝 Changelog - Corrections Rate Limit (451 Hostinger)

## Date: 2026-02-04

## 🎯 Problème initial
```
451 4.7.1 Ratelimit "hostinger_out_ratelimit" exceeded
```
Les emails n'étaient pas envoyés car Hostinger bloquait après 10-20 emails/heure.

---

## ✅ Modifications apportées

### 1. `/backend/utils/sendEmails.js` - Optimisation SMTP

#### Avant:
```javascript
maxConnections: 5,
maxMessages: 100,
// Pas de rate limiting
// Pas de retry sur erreur 451
```

#### Après:
```javascript
maxConnections: 2,        // ⬇️ Réduit pour éviter surcharge
maxMessages: 10,          // ⬇️ Moins d'emails par connexion
rateDelta: 2000,          // ⏱️ 2 secondes entre chaque email
rateLimit: 5,             // 📊 Max 5 emails toutes les 2 secondes

// ✅ Retry automatique 3 fois si erreur 451
const RETRY_DELAYS = [5000, 15000, 30000]; // 5s, 15s, 30s

// ✅ Détection spécifique erreur 451
const isRateLimit = error.message?.includes('451') ||
                    error.message?.includes('ratelimit') ||
                    error.responseCode === 451;
```

**Impact**: Réduit considérablement les erreurs 451 en espaçant les envois.

---

### 2. `/backend/controllers/devisController.js` - Délais entre emails

#### Ajouté:
```javascript
// En haut du fichier
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
```

#### Modifications multiples:

**Email client → agence (ligne ~1299)**
```javascript
console.log("✅ Email envoyé avec succès au client");

// ✅ NOUVEAU: Attente 2s avant email agence
await sleep(2000);

const agence = await Agence.findById(devis.agenceId);
```

**Ordre mission agence → dimotec (ligne ~1252)**
```javascript
if (agenceEmail) {
  await sendEmail({...}); // Email agence

  // ✅ NOUVEAU: Attente 2s avant email dimotec
  await sleep(2000);
}

await sendEmail({...}); // Email dimotec
```

**Boucles d'alertes (lignes 1366, 1427, 2693)**
```javascript
// AVANT
for (let dest of destinataires) {
  await sendEmail({...});
}

// APRÈS
for (let i = 0; i < destinataires.length; i++) {
  const dest = destinataires[i];
  await sendEmail({...});

  // ✅ NOUVEAU: Attente entre chaque email
  if (i < destinataires.length - 1) {
    await sleep(2000);
  }
}
```

**Impact**: Évite d'envoyer plusieurs emails simultanément, respecte les limites Hostinger.

---

### 3. `/backend/utils/sendEmailBrevo.js` - Alternative Brevo (NOUVEAU)

**Fichier créé** pour migration vers Brevo si nécessaire.

**Avantages**:
- 300 emails/jour gratuits (vs 10-20 Hostinger)
- Meilleure délivrabilité
- Tracking avancé
- Pas de rate limit 451

**Pour l'activer**:
```bash
npm install sib-api-v3-sdk --legacy-peer-deps
```

Puis dans `devisController.js`:
```javascript
const sendEmail = require("../utils/sendEmailBrevo"); // Au lieu de sendEmails
```

---

## 📊 Résultats attendus

### Avant les modifications:
- ❌ Erreur 451 après 5-10 emails
- ❌ Devis marqués "Email_Errone" à tort
- ❌ Emails perdus

### Après les modifications:
- ✅ Retry automatique sur erreur 451 (3 tentatives)
- ✅ Délais de 2s entre chaque email
- ✅ Connexions SMTP limitées (2 max)
- ✅ Rate limiting: 5 emails/2s max
- ✅ ~15-20 devis/heure possibles sans erreur

### Avec Brevo (si migration):
- ✅ 300 emails/jour (15x plus que Hostinger)
- ✅ ~100+ devis/heure possibles
- ✅ Aucune erreur 451

---

## 📁 Fichiers créés/modifiés

### Modifiés:
1. `/backend/utils/sendEmails.js` - Retry + rate limiting
2. `/backend/controllers/devisController.js` - Délais entre emails
3. `/backend/.env` - Ajout IMAP_HOST et IMAP_PORT

### Créés:
1. `/backend/utils/sendEmailBrevo.js` - Alternative Brevo
2. `/backend/RATE_LIMIT_SOLUTION.md` - Documentation complète
3. `/backend/MIGRATION_BREVO.md` - Guide migration Brevo
4. `/backend/BOUNCE_VERIFICATION.md` - Documentation bounces
5. `/backend/.env.example` - Template variables d'environnement
6. `/backend/CHANGELOG_RATE_LIMIT.md` - Ce fichier

---

## 🧪 Tests à effectuer

### 1. Test rate limit avec retry
```bash
# Créer 3 devis rapidement
# Vérifier dans les logs:
⚠️ Rate limit détecté pour client@example.com. Retry 1/3 dans 5s...
✅ E-mail envoyé à client@example.com [ID: xxx]
```

### 2. Test délais entre emails
```bash
# Créer 1 devis (payer: client)
# Vérifier dans les logs:
✅ Email envoyé avec succès au client: client@example.com
# ⏱️ Pause de 2 secondes
📤 Envoi copie à l'agence : agence@example.com
```

### 3. Test limite journalière
```bash
# Créer 20 devis dans la journée
# Si erreur 451 persiste après 3 retries:
❌ Rate limit Hostinger atteint. Email non envoyé après 3 tentatives.
# → Considérer migration Brevo
```

---

## 🚀 Déploiement

### En développement (local)
```bash
# Les modifications sont déjà actives
npm run dev
```

### En production (Heroku)
```bash
git add .
git commit -m "Fix: Rate limit 451 Hostinger avec retry et delays"
git push heroku main

# Vérifier les variables d'environnement
heroku config:get IMAP_HOST
heroku config:get IMAP_PORT

# Si manquantes:
heroku config:set IMAP_HOST=imap.hostinger.com
heroku config:set IMAP_PORT=993
```

---

## 📈 Monitoring

### Logs à surveiller
```bash
# Heroku
heroku logs --tail | grep "Rate limit\|451\|BREVO"

# Local
npm run dev
# Observer les messages:
✅ E-mail envoyé à ...
⚠️ Rate limit détecté ...
❌ Erreur lors de l'envoi ...
```

### Compteurs importants
- Nombre d'erreurs 451 par heure
- Nombre de retries réussis
- Nombre d'emails marqués "Email_Errone"

**Seuil d'alerte**: Si > 5 erreurs 451/heure après retries → Migrer vers Brevo

---

## 🎯 Prochaines étapes

### Court terme (maintenant):
1. ✅ Tester les modifications en local
2. ✅ Déployer sur Heroku
3. 📊 Monitorer pendant 24-48h

### Si problèmes persistent:
1. 🔄 Migrer vers Brevo (guide dans `MIGRATION_BREVO.md`)
2. 📧 Ou contacter Hostinger pour augmenter la limite
3. 💰 Ou upgrade plan Hostinger

### Long terme:
- Implémenter queue d'emails (Redis/Bull)
- Dashboard de monitoring des emails
- Alertes automatiques si rate limit

---

## 💡 Notes importantes

1. **Les retries prennent du temps**
   - Retry 1: +5s
   - Retry 2: +15s
   - Retry 3: +30s
   - Total: jusqu'à 50s par email en cas d'échec

2. **Les délais s'additionnent**
   - Email client: 0s
   - Attente: 2s
   - Email agence: 2s
   - Total: ~4-5s par devis

3. **Brevo reste la meilleure solution long terme**
   - Gratuit jusqu'à 300 emails/jour
   - Infrastructure professionnelle
   - Pas de modifications majeures du code

---

## 📞 Support

Si vous avez des questions ou problèmes:
1. Consultez `RATE_LIMIT_SOLUTION.md`
2. Consultez `MIGRATION_BREVO.md` pour passer à Brevo
3. Vérifiez les logs Heroku pour les erreurs

**Recommandation finale**: Si vous prévoyez plus de 10-15 devis/jour, migrez vers Brevo dès maintenant.
