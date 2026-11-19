# Banque de questions perso

Pendant une partie, le Meneur peut écrire sa propre carte : Vérité, Pari, Miroir, Action, ou Vote en groupe. S'il coche **« Proposer ma question à la banque Complices »**, la question est enregistrée **sans pseudo, sans partie et sans réponses**. Elle reste « en attente » jusqu'à ce que tu la relises.

Une question que tu valides rejoint les cartes du jeu (mention « communauté ») dans toutes les nouvelles parties de la même orientation. Le jeu s'enrichit ainsi avec ce que les joueurs ont vraiment envie de se demander, sans que les cartes deviennent répétitives.

Sans base de données, tout marche quand même : les questions perso sont jouées, mais pas gardées.

---

## 1. Brancher la base Neon (une seule fois)

1. Crée un compte gratuit sur [neon.tech](https://neon.tech).
2. Crée un projet `complices`, région **Europe (Frankfurt)**.
3. Dans **Connect**, copie la *connection string* :
   - elle commence par `postgresql://…` ;
   - prends la version **Pooled connection** si Neon la propose.
4. Dans Render, ouvre le service **complices**, puis **Environment** et **Add Environment Variable** :
   - `DATABASE_URL` = la connection string.
5. Enregistre. Render redémarre le service.
6. Pour vérifier, ouvre `https://ton-site/health`. Tu dois voir `"db":true`.

La table `custom_questions` se crée toute seule au démarrage.

## 2. Ton jeton d'administration

Le fichier `render.yaml` crée une variable `ADMIN_TOKEN` avec une valeur aléatoire. Pour la retrouver, va dans Render, ouvre **Environment** et clique sur l'œil à côté de `ADMIN_TOKEN`.

Garde ce jeton pour toi : il donne accès à la banque. Sans `ADMIN_TOKEN`, les routes d'administration n'existent pas (le serveur répond 404).

## 3. Relire et valider les questions

Les commandes ci-dessous se lancent dans un terminal. Remplace :
- `https://complices-gknq.onrender.com` par ton adresse ;
- `TON_JETON` par le jeton d'administration.

**Voir les chiffres :**

```bash
curl -H "Authorization: Bearer TON_JETON" https://complices-gknq.onrender.com/api/admin/stats
```

**Lister les questions en attente :**

```bash
curl -H "Authorization: Bearer TON_JETON" "https://complices-gknq.onrender.com/api/admin/questions?status=pending"
```

**Valider la question n° 12**, qui rejoint aussitôt les cartes du jeu :

```bash
curl -X POST -H "Authorization: Bearer TON_JETON" -H "Content-Type: application/json" -d "{\"status\":\"approved\"}" https://complices-gknq.onrender.com/api/admin/questions/12
```

**Refuser une question :** même commande, avec `rejected` à la place de `approved`.

## Ce qui est enregistré

| Champ | Exemple |
|---|---|
| `text` | « Combien de fois tu as appuyé sur snooze ce matin ? » |
| `kind` / `input` | `bet` / `choice` |
| `choices` ou `scale` | `["Zéro, je suis un robot", "Une ou deux"]` |
| `level` | 1 (Doux), 2 (Piquant) ou 3 (Audacieux), selon le niveau de la partie |
| `orientation` / `mode` / `player_count` | `friendship` / `group` / `3` |
| `status` | `pending`, `approved` ou `rejected` |

Ce qui n'est **jamais** enregistré : les pseudos, l'identifiant de partie, l'adresse IP et les réponses.

Une question qui contient une adresse e-mail, un lien ou une suite de chiffres (un numéro de téléphone, par exemple) est ignorée.

## Exploiter les données

Les questions validées montrent ce que les joueurs veulent vraiment se demander, et elles peuvent alimenter les prochains paquets de cartes. Avec l'export JSON de `/api/admin/questions`, tu peux :
- compter les thèmes qui reviennent ;
- repérer les types de cartes préférés (beaucoup de Votes ? de Paris ?) ;
- t'inspirer des meilleures questions pour écrire les packs thématiques payants.
