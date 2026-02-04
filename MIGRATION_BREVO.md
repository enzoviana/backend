# 🚀 Migration vers Brevo (optionnel)

## Pourquoi migrer vers Brevo ?

Si vous continuez à avoir des erreurs 451 Rate Limit avec Hostinger, Brevo est une excellente alternative:

✅ **300 emails/jour GRATUITS** (vs 10-20 avec Hostinger)
✅ **Meilleure délivrabilité** (moins de bounces)
✅ **Tracking avancé** (taux d'ouverture, clics)
✅ **Infrastructure professionnelle**
✅ **Pas de rate limit 451**

## 📋 Prérequis

Vous avez déjà une clé API Brevo dans votre `.env`:
```env
BREVO_API_KEY=xsmtpsib-1ead873dd3f9b79e08440c0d0add6eb697034d4689f0541ec7cd5898789bed40-zZLKB3BTO2XbGtXG
```

## 🛠️ Installation (3 étapes)

### Étape 1: Installer le package Brevo
```bash
npm install sib-api-v3-sdk --legacy-peer-deps
```

### Étape 2: Modifier devisController.js
Remplacer en haut du fichier:
```javascript
// AVANT
const sendEmail = require("../utils/sendEmails");

// APRÈS
const sendEmail = require("../utils/sendEmailBrevo"); // ← Utilise Brevo au lieu de Hostinger
```

### Étape 3: Redémarrer le serveur
```bash
# En développement
npm run dev

# En production (Heroku)
git add .
git commit -m "Switch to Brevo for email sending"
git push heroku main
```

## ✅ C'est tout !

Le reste du code reste identique. Tous vos templates, variables, etc. fonctionnent de la même manière.

## 🔄 Alternative: Utiliser les deux (fallback)

Pour plus de robustesse, vous pouvez essayer Hostinger d'abord, puis Brevo en cas d'échec:

```javascript
// utils/sendEmailWithFallback.js
const sendEmailHostinger = require("./sendEmails");
const sendEmailBrevo = require("./sendEmailBrevo");

async function sendEmailWithFallback(options) {
  try {
    // Essayer Hostinger d'abord
    return await sendEmailHostinger(options);
  } catch (error) {
    console.warn("⚠️ Échec Hostinger, tentative avec Brevo...", error.message);

    // Si rate limit Hostinger, essayer Brevo
    if (error.code === 'RATE_LIMIT_EXCEEDED' || error.message.includes('451')) {
      return await sendEmailBrevo(options);
    }

    // Autre erreur, on la propage
    throw error;
  }
}

module.exports = sendEmailWithFallback;
```

Puis dans `devisController.js`:
```javascript
const sendEmail = require("../utils/sendEmailWithFallback");
```

## 🧪 Test

Créer un devis après la migration:
```bash
# Les logs devraient montrer:
✅ [BREVO] E-mail envoyé à client@example.com [Message ID: xxx]
```

Au lieu de:
```bash
✅ E-mail envoyé à client@example.com [ID: xxx]
```

## 📊 Vérifier les limites Brevo

Connectez-vous sur https://app.brevo.com/
- **Compte gratuit**: 300 emails/jour
- **Plan Lite** ($25/mois): 10,000 emails/mois
- **Plan Premium** ($65/mois): 20,000 emails/mois + features avancées

## 🔍 Monitoring Brevo

Dashboard Brevo: https://app.brevo.com/statistics/email
- Emails envoyés
- Taux d'ouverture
- Taux de clics
- Bounces
- Spam reports

## ⚠️ Points d'attention

1. **Domaine expéditeur**
   - Brevo recommande de configurer un domaine personnalisé
   - Améliore la délivrabilité (moins de spam)
   - Guide: https://help.brevo.com/hc/fr/articles/208857029

2. **Limites gratuites**
   - 300 emails/jour suffisent pour ~10 devis/jour
   - Si vous dépassez, upgrade vers plan payant

3. **IP dédiée**
   - Plan gratuit = IP partagée
   - Plans payants peuvent avoir IP dédiée (meilleure réputation)

## 🆘 Troubleshooting

### Erreur: "Invalid API key"
- Vérifiez `BREVO_API_KEY` dans `.env`
- Vérifiez qu'elle commence par `xkeysib-` ou `xsmtpsib-`
- Créez une nouvelle clé sur https://app.brevo.com/settings/keys/api

### Erreur: "Sender not verified"
- Allez sur https://app.brevo.com/senders
- Vérifiez votre email expéditeur
- Suivez le lien de confirmation

### Emails vont en spam
- Configurez SPF/DKIM sur votre domaine
- Guide Brevo: https://help.brevo.com/hc/fr/articles/208857029

## 📈 Recommandation finale

**Si vous avez plus de 5 devis/heure** → Migrez vers Brevo immédiatement
**Si vous avez 1-5 devis/heure** → Testez d'abord les modifications Hostinger, migrez si problème persiste
**Si vous prévoyez de grandir** → Brevo est un meilleur choix long terme

---

💡 **Besoin d'aide ?** Je peux vous aider à:
- Implémenter le système de fallback
- Configurer le domaine personnalisé
- Optimiser les templates pour Brevo
