# 📜 Scripts de maintenance

## 🔍 Vérification et correction des cagnottes

### 1. Script de vérification (READ-ONLY)

**Fichier:** `checkCagnottes.js`

Ce script **vérifie** l'état des cagnottes sans modifier les données.

```bash
cd backend
node scripts/checkCagnottes.js
```

**Ce qu'il fait :**
- ✅ Liste tous les ordres de mission payés
- ✅ Vérifie si chaque ordre a bien crédité la cagnotte
- ✅ Affiche un rapport détaillé
- ✅ **Ne modifie AUCUNE donnée**

**Exemple de sortie :**
```
📊 12 ordres de mission payés trouvés

✅ Ordre OM-001 : Déjà crédité (Agence)
❌ Ordre OM-002 : NON CRÉDITÉ (Agence ABC) - 45.50€
✅ Ordre OM-003 : Déjà crédité (Agence)
...

📊 RAPPORT DE VÉRIFICATION DES CAGNOTTES (READ-ONLY)
======================================================================
📈 Statistiques:
   - Total ordres payés : 12
   - À créditer : 3 ❌
   - Déjà crédités : 9 ✅
   - Erreurs : 0 ⚠️

❌ AGENCES À CRÉDITER (2):
   • Agence ABC
     ├─ Cagnotte actuelle : 250.00€
     ├─ À ajouter : +45.50€
     ├─ Nouvelle cagnotte : 295.50€
     └─ Ordres manquants : OM-002, OM-005
```

---

### 2. Script de correction automatique

**Fichier:** `fixCagnottes.js`

Ce script **corrige** automatiquement les cagnottes manquantes.

```bash
cd backend
node scripts/fixCagnottes.js
```

**Ce qu'il fait :**
- ✅ Trouve tous les ordres de mission payés
- ✅ Vérifie si la cagnotte a été créditée
- ✅ **Crédite automatiquement** les cagnottes manquantes
- ✅ Ajoute une entrée dans l'historique
- ✅ Affiche un rapport des corrections

**Exemple de sortie :**
```
🔍 Recherche des ordres de mission payés...

📊 12 ordres de mission payés trouvés

⏭️  Ordre OM-001 : Déjà crédité (Agence)
✅ Ordre OM-002 : +45.50€ → Agence ABC
⏭️  Ordre OM-003 : Déjà crédité (Agence)
✅ Ordre OM-005 : +32.40€ → Agence ABC
...

📊 RAPPORT DE CORRECTION DES CAGNOTTES
============================================================
📈 Statistiques:
   - Total ordres payés : 12
   - Corrections effectuées : 3
   - Déjà crédités : 9
   - Erreurs : 0

🏢 AGENCES (2):
   • Agence ABC
     └─ +77.90€ (2 ordres)
   • Agence XYZ
     └─ +21.00€ (1 ordre)

============================================================
✅ 3 cagnotte(s) corrigée(s) avec succès !
```

---

## 🚀 Recommandations d'utilisation

### Première utilisation

1. **Toujours vérifier d'abord** (mode lecture seule) :
   ```bash
   node scripts/checkCagnottes.js
   ```

2. **Analyser le rapport** pour comprendre l'ampleur des corrections

3. **Corriger si nécessaire** :
   ```bash
   node scripts/fixCagnottes.js
   ```

4. **Re-vérifier** après correction :
   ```bash
   node scripts/checkCagnottes.js
   ```

---

## ⚠️ Important

- **Sauvegarde recommandée** : Faites une sauvegarde de la base de données avant d'exécuter `fixCagnottes.js`
- **Protection double crédit** : Les scripts vérifient automatiquement si une cagnotte a déjà été créditée
- **Idempotence** : Vous pouvez lancer `fixCagnottes.js` plusieurs fois sans risque de double crédit
- **Logs détaillés** : Tous les crédits sont enregistrés dans l'historique avec la mention "Correction automatique"

---

## 🔧 Configuration

Les scripts utilisent les variables d'environnement du fichier `.env` :

```env
MONGO_URI=mongodb+srv://...
```

Assurez-vous que la connexion MongoDB est correctement configurée.

---

## 📝 Format de l'historique

Chaque crédit ajouté par le script contient :

**Pour les agences :**
```javascript
{
  montant: 45.50,
  type: "gain",
  description: "3% du devis DV-123 (Ordre OM-002) - Correction automatique",
  par: "Script de correction",
  date: Date
}
```

**Pour les employés :**
```javascript
{
  montant: 45.50,
  type: "gain",
  description: "3% du devis DV-123 (Ordre OM-002) - Correction automatique",
  reference: ObjectId("ordre_id"),
  date: Date
}
```

---

## 🐛 Résolution de problèmes

### Erreur de connexion MongoDB
```
❌ Erreur de connexion MongoDB: MongoNetworkError...
```
**Solution :** Vérifiez que `MONGO_URI` est correct dans le fichier `.env`

### Ordre sans devis
```
⚠️  Ordre OM-XXX : Devis manquant
```
**Solution :** Vérifiez l'intégrité des données dans MongoDB (l'ordre devrait avoir un `devisId`)

### Ordre sans agence
```
⚠️  Ordre OM-XXX : Agence manquante
```
**Solution :** Vérifiez l'intégrité des données dans MongoDB (l'ordre devrait avoir un `agenceId`)

---

## 📊 Calcul du montant

Le montant crédité est toujours **3% du montant TTC du devis** :

```javascript
montantCredit = devis.montantTTC * 0.03
```

Exemple :
- Devis TTC : 1 500€
- Montant crédité : 45€ (3%)

---

## 📅 Maintenance régulière

Il est recommandé de lancer `checkCagnottes.js` régulièrement pour s'assurer que toutes les cagnottes sont à jour.

**Fréquence suggérée :** Une fois par semaine ou après chaque mise à jour du système de paiement.
