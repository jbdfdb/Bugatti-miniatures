# 🏎️ Les Bugatti de Pascal — Fiche de maintenance

Tout ce qu'il faut pour faire vivre le site, au quotidien et dans le temps.
Aucune connaissance en programmation requise — juste quelques commandes dans le **Terminal**.

---

## 🚀 Installation (une seule fois)

1. Récupérer le site depuis GitHub :
   ```bash
   git clone https://github.com/jbdfdb/Bugatti-miniatures.git
   cd Bugatti-miniatures
   ```
2. Lancer l'installation :
   ```bash
   ./install.sh
   ```
3. **Ouvrir un nouveau Terminal** (pour activer la commande `bugatti`).

---

## ▶️ Au quotidien

| Je veux…                          | Je tape…            |
|-----------------------------------|---------------------|
| Ouvrir le site                    | `bugatti run`       |
| Arrêter le site                   | `Ctrl + C` (ou `bugatti stop`) |
| Savoir s'il tourne                | `bugatti status`    |
| Sauvegarder mes données           | `bugatti backup`    |
| Voir toutes les commandes         | `bugatti help`      |

Une fois `bugatti run` lancé, le navigateur s'ouvre tout seul sur le site.
**Laissez la fenêtre du Terminal ouverte** tant que vous utilisez le site.

### Devenir administrateur
En bas à droite du site, cliquez sur **« Admin »**.
- **La toute première fois** : choisissez votre mot de passe (notez-le !).
- Ensuite : saisissez ce mot de passe pour activer les crayons d'édition ✎.
- Pour ressortir : bouton **« Site public »** (aucun mot de passe demandé).

Tout se pilote ensuite depuis le bouton **« ⚙ Panneau »** (guide, CSV, fréquentation, réglages).

---

## 🔄 Mettre à jour le site

Quand J-B a amélioré le site (nouvelles fonctions, corrections), récupérez la
mise à jour :

```bash
bugatti update
```

Cela fait un `git pull` puis remet les dépendances à jour. Relancez ensuite `bugatti run`.

> **Vos données ne sont jamais écrasées** par une mise à jour : votre collection,
> vos textes et vos photos restent sur votre ordinateur. Seul le code du site change.

Si `bugatti update` refuse à cause de « modifications locales », c'est en général
un fichier de données modifié localement. Sauvegardez d'abord (`bugatti backup`),
puis :
```bash
git stash        # met de côté vos changements locaux
bugatti update
git stash pop     # les récupère (au besoin)
```
En cas de doute, contactez J-B.

---

## 💾 Sauvegardes

- **Créer une sauvegarde :** `bugatti backup`
  → crée un fichier `.tar.gz` dans `data/backups/` (collection + textes + photos).
- **Restaurer :** `bugatti restore` (liste les sauvegardes) puis
  `bugatti restore data/backups/sauvegarde-AAAAMMJJ-HHMMSS.tar.gz`.

💡 Copiez de temps en temps ces fichiers sur une **clé USB** ou un **cloud** :
c'est votre filet de sécurité si l'ordinateur tombe en panne.

---

## 🔑 Mot de passe administrateur

- **Le changer** : bouton Admin → ⚙ Panneau → onglet **Réglages**.
- **Oublié ?** Deux options :
  1. En local : `bugatti reset-admin`, puis recréez-le au prochain lancement.
  2. À distance : demandez à **J-B**, qui peut forcer sa réinitialisation via
     GitHub (au prochain `bugatti update`, le site vous laissera en choisir un nouveau).

> Le mot de passe n'est **jamais** stocké dans le dépôt GitHub public : il reste
> chiffré sur votre seul ordinateur.

---

## 🧰 Entretien de la machine (Mac)

De temps en temps, gardez les outils système à jour :

```bash
brew update && brew upgrade
```

> ⚠️ Si une mise à jour de Homebrew change la version majeure de Python
> (ex. 3.13 → 3.14) et que le site refuse de démarrer, reconstruisez
> l'environnement :
> ```bash
> rm -rf .venv
> ./install.sh
> ```
> Vos données ne sont pas touchées (elles sont dans `data/`).

---

## 🆘 Dépannage express

| Symptôme                                   | Solution |
|--------------------------------------------|----------|
| `command not found: bugatti`               | Ouvrez un nouveau Terminal, ou `source ~/.zshrc` |
| « Environnement Python absent »            | `./install.sh` |
| Le site ne s'ouvre pas dans le navigateur  | Allez manuellement sur http://localhost:8000 |
| Port déjà utilisé                          | `bugatti stop`, puis `bugatti run` |
| Les crayons ✎ n'apparaissent pas           | Cliquez « Admin » et connectez-vous |
| Un import CSV est refusé                   | Les en-têtes doivent être **exactement** ceux du CSV exporté |

---

## 📁 Où sont mes données ?

- `data/collection.json` — la collection (toutes les miniatures)
- `data/site_content.json` — les textes du site (titres, sous-titres…)
- `static/img/uploads/` — vos photos ajoutées
- `data/backups/` — vos sauvegardes

Ces fichiers vivent sur **votre** ordinateur et ne partent pas sur GitHub.

---

*Site conçu par J-B de Fromont — pour la collection de Pascal.*
