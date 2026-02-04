# Système de Vérification des Bounces (Emails de Rebond)

## 🎯 Problème résolu

En production sur Heroku, le serveur SMTP accepte immédiatement les emails (même invalides) et renvoie un code 250 OK. L'email de rebond (bounce) arrive seulement quelques minutes plus tard si l'adresse n'existe pas.

**Avant** : Le statut "Envoyé" apparaissait même pour des emails invalides.
**Maintenant** : Le système vérifie activement les bounces et met à jour le statut correctement.

## 🔧 Comment ça fonctionne

### 1. Statut "Envoi_En_Cours"
Quand un devis est créé avec `payer: "client"`, l'email est envoyé et le statut est mis à `"Envoi_En_Cours"` au lieu de `"Envoyé"`.

### 2. Vérification automatique après 5 minutes
Un `setTimeout` est lancé qui vérifie les bounces 5 minutes après l'envoi :
- Si un bounce est détecté → statut devient `"Email_Errone"`
- Si aucun bounce → statut devient `"Envoyé"`
- En cas d'erreur de vérification → statut devient `"Envoyé"` par défaut

### 3. Vérification via IMAP
La fonction `verifierBouncesIMAP()` :
- Se connecte à la boîte mail IMAP
- Cherche les emails de `mailer-daemon@` ou `postmaster@` des dernières 24h
- Analyse le contenu pour trouver l'adresse email du client
- Détecte les mots-clés de bounce : `undelivered`, `delivery failure`, `User unknown`, etc.

### 4. Notifications
Quand un bounce est détecté :
- Le statut du devis passe à `"Email_Errone"`
- Un email d'alerte est envoyé à l'agence et à Dimotec
- Le champ `emailClientErrone` contient l'adresse invalide

## 📋 Configuration requise

### Variables d'environnement `.env`
```env
# SMTP (envoi)
SMTP_HOST=smtp.hostinger.com
SMTP_PORT=587
SMTP_USER=support@votre-devis-diagnostics.fr
SMTP_PASS=votre_mot_de_passe

# IMAP (lecture des bounces)
IMAP_HOST=imap.hostinger.com
IMAP_PORT=993
```

**Important** : Utilisez les mêmes identifiants SMTP_USER et SMTP_PASS pour IMAP.

### Packages NPM requis
```bash
npm install imap mailparser --legacy-peer-deps
```

## 🚀 Utilisation

### Vérification manuelle des bounces
Pour forcer la vérification de tous les devis en `"Envoi_En_Cours"` :

```bash
POST /api/public/verifier-bounces
Authorization: Bearer <token>
```

Réponse :
```json
{
  "message": "Vérification des bounces terminée",
  "total": 5,
  "envoyes": 3,
  "errones": 2
}
```

### Créer un Cron Job (optionnel)
Pour vérifier automatiquement les bounces toutes les 10 minutes sur Heroku :

1. Installer Heroku Scheduler addon
2. Créer une commande :
```bash
curl -X POST https://votre-app.herokuapp.com/api/public/verifier-bounces \
  -H "Authorization: Bearer ${ADMIN_TOKEN}"
```

## 📊 Statuts des devis

| Statut | Signification |
|--------|---------------|
| `Envoi_En_Cours` | Email accepté par SMTP, en attente de vérification bounce |
| `Envoyé` | Email confirmé délivré (aucun bounce détecté) |
| `Email_Errone` | Email non délivré (bounce détecté) |
| `Ouvert` | Le client a ouvert le lien du devis |
| `Accepté` | Le client a accepté le devis |
| `Refusé` | Le client a refusé le devis |

## 🔍 Débogage

### Logs à surveiller
```
📤 Envoi e-mail au client : client@example.com
✅ Email accepté par le serveur SMTP pour : client@example.com
🕐 Vérification différée des bounces (5 minutes)
⚠️ Bounce détecté pour client@example.com - Devis DV-0001
✅ Email confirmé délivré pour client@example.com - Devis DV-0002
```

### Problèmes courants

**Erreur IMAP : "Connection timeout"**
- Vérifiez que le port IMAP 993 est ouvert sur Heroku
- Vérifiez vos identifiants IMAP

**Bounces non détectés**
- Le délai de 5 minutes peut être insuffisant pour certains serveurs
- Augmentez le délai : `setTimeout(..., 10 * 60 * 1000)` pour 10 minutes
- Lancez la vérification manuelle : `POST /api/public/verifier-bounces`

**Trop de faux positifs**
- Ajustez les critères de détection dans `verifierBouncesIMAP()`
- Vérifiez que la recherche IMAP filtre correctement par date

## 🧪 Test en développement

En localhost, vous pouvez tester avec un email invalide :

1. Créer un devis avec `client.email = "test@invalid-domain-12345.com"`
2. Vérifier que le statut est `"Envoi_En_Cours"`
3. Attendre 5 minutes ou appeler `/api/public/verifier-bounces`
4. Le statut devrait passer à `"Email_Errone"`

## 📝 Notes techniques

- La vérification IMAP a un timeout de 30 secondes
- Les bounces sont recherchés sur les dernières 24h
- En production, les serveurs Gmail/Hostinger peuvent mettre 1-15 minutes pour renvoyer un bounce
- La fonction utilise `simpleParser` de `mailparser` pour analyser les emails

## 🔐 Sécurité

- Ne commitez JAMAIS le fichier `.env` avec vos identifiants
- Utilisez `.env.example` pour documenter les variables requises
- Rotez régulièrement les mots de passe SMTP/IMAP
- Limitez l'accès à la route `/verifier-bounces` aux admins uniquement
