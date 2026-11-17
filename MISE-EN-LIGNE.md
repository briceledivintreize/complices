# Mettre Complices en ligne

Objectif : une adresse en `https://…` que ta copine peut ouvrir de n'importe où, sans être sur ton Wi-Fi.

Le projet est déjà prêt pour la production :
- liens d'invitation en `https://` ;
- détection des téléphones verrouillés ou sortis du réseau ;
- arrêt propre lors d'un redéploiement ;
- page de santé `/health` ;
- fichier `render.yaml` pour Render et `Dockerfile` pour les autres hébergeurs.

Il te reste à **créer deux comptes** (GitHub et Render), puis à suivre les étapes ci-dessous. Compte environ 20 minutes la première fois.

---

## Option recommandée : Render (gratuit pour commencer)

### 1. Mettre le code sur GitHub

1. Crée un compte sur [github.com](https://github.com) si tu n'en as pas.
2. Clique sur **New repository**. Nomme-le `complices`, choisis **Private**, et ne coche aucune case (ni README, ni .gitignore).
3. Dans un terminal, depuis le dossier `complices`, lance ces commandes une par une. Remplace `TON-PSEUDO` par ton nom d'utilisateur GitHub.

```bash
git init -b main
```

```bash
git add .
```

```bash
git commit -m "Complices : MVP Montrer sa carte"
```

```bash
git remote add origin https://github.com/TON-PSEUDO/complices.git
```

```bash
git push -u origin main
```

Au premier `push`, une fenêtre GitHub s'ouvre pour te connecter.

### 2. Créer le service sur Render

1. Crée un compte sur [render.com](https://render.com) avec **Sign in with GitHub**.
2. Dans le tableau de bord, clique sur **New**, puis **Blueprint**.
3. Autorise Render à lire ton dépôt `complices` et sélectionne-le.
4. Render lit `render.yaml` et propose un service web `complices` (gratuit, région Francfort). Clique sur **Apply**.
5. Attends la fin du déploiement (2 à 4 minutes). L'adresse s'affiche, par exemple `https://complices-xxxx.onrender.com`.

### 3. Vérifier

- Ouvre `https://complices-xxxx.onrender.com/health` : la page doit afficher `{"ok":true,…}`.
- Crée une partie sur ton téléphone en 4G (Wi-Fi coupé), envoie le lien à quelqu'un, et jouez un tour complet.
- Teste au moins un iPhone et un Android.

Ensuite, chaque `git push` sur `main` redéploie automatiquement.

### À savoir sur l'offre gratuite de Render

- **Le service s'endort** après environ 15 minutes sans visite. La visite suivante le réveille en à peu près une minute.
- **Chaque mise en veille ou redéploiement efface les parties en cours**, car elles vivent en mémoire.
- C'est parfait pour tester avec ses proches. Pour un vrai lancement, passe sur une instance payante qui ne dort pas (vérifie le tarif actuel sur render.com/pricing), puis ajoute une base de données (prochaine étape du projet).
- Garde **une seule instance** : deux joueurs d'une même partie doivent parler au même serveur.

### Nom de domaine (facultatif)

Si tu achètes un domaine (par exemple `complices.app`) :
1. Ajoute-le dans Render, dans **Settings**, puis **Custom Domains**, et suis les instructions DNS.
2. Ajoute la variable d'environnement `PUBLIC_URL=https://complices.app` pour que les liens d'invitation utilisent ce domaine.

---

## Autre option : n'importe quel hébergeur Docker

Le `Dockerfile` fonctionne chez Fly.io, Railway, ou sur un petit serveur (VPS) :

```bash
docker build -t complices .
```

```bash
docker run -p 3000:3000 complices
```

L'hébergeur doit gérer le HTTPS devant le conteneur et accepter les WebSockets (c'est le cas de tous les hébergeurs cités).

---

## Avant d'ouvrir au public

- [ ] Compléter la page `public/confidentialite.html` : passages entre crochets, éditeur, contact, hébergeur.
- [ ] Faire relire cette page et les conditions d'âge par un professionnel du droit, en particulier pour l'orientation Drague / couple.
- [ ] Vérifier la disponibilité du nom « Complices » (INPI, nom de domaine, réseaux sociaux).
- [ ] Tester une soirée complète (10 tours) sur deux vrais téléphones, sur place et à distance.
- [ ] Passer sur une instance qui ne s'endort pas.
