# Complices : MVP

Des jeux à deux en temps réel. Chaque réponse se joue en **« Montrer sa carte »** : chacun écrit sur son ardoise, l'ardoise de l'autre reste retournée, puis au signal du Maître (« 3, 2, 1… Ardoises ! ») les deux se révèlent au même instant.

## Lancer le jeu

Il faut Node.js 20 ou plus récent.

```bash
npm install
npm start
```

La console affiche deux adresses :

- **Sur ce PC** : `http://localhost:3000`
- **Sur le Wi-Fi** : `http://192.168.x.x:3000`. C'est celle qu'ouvre un téléphone connecté au même réseau.

Au premier lancement, Windows peut demander d'autoriser Node.js sur le réseau. Accepte pour les **réseaux privés**, sinon les téléphones ne pourront pas se connecter.

## Jouer à deux

1. Sur ton téléphone (ou ton PC), ouvre l'adresse Wi-Fi, choisis ton pseudo et ton jeu, puis appuie sur **Créer la partie**.
2. Envoie le lien affiché (Copier ou Partager), fais scanner le QR code, ou donne le code à 8 caractères.
3. L'autre accepte, et vous réglez chacun votre curseur en secret.
4. Jouez. Le bouton **Stop** permet à tout moment de redescendre en Doux ou de terminer la partie, sans que l'autre sache qui l'a demandé.

Pour tester seul, ouvre deux onglets : un qui crée la partie, et un autre qui ouvre le lien d'invitation.

## Ce que contient le MVP

- **À deux ou en groupe** : en groupe, jusqu'à 8 joueurs rejoignent avec le même lien (bouton WhatsApp intégré), puis l'hôte lance la partie. Le Meneur choisit la Cible, et tous les autres parient. Il existe aussi des cartes **Vote** (« Qui ici… ? »). La Drague / couple reste réservée aux duos.
- **Questions perso** : le Meneur peut écrire sa propre carte (Vérité, Pari, Miroir, Action ou Vote), avec une réponse écrite, des choix, une échelle ou un dessin. S'il l'accepte, sa question rejoint anonymement la banque de questions. Voir [BANQUE-DE-QUESTIONS.md](BANQUE-DE-QUESTIONS.md).
- **Double Jeu**, l'Action ou Vérité réinventé. À chaque tour, le Meneur tire 3 cartes (Vérité ou Pari, Action, Miroir) et en choisit une. La Cible répond, et le Meneur parie sur sa réponse.
- **5 façons d'écrire sur l'ardoise** : un mot, un chiffre entouré, un choix, un défi (relever ou passer) ou un dessin au doigt.
- **Curseur secret** : la partie prend le niveau le plus bas des deux. Le niveau Audacieux reste suggestif, jamais explicite.
- **Score** : Flair individuel et complicité commune. Les « Âmes jumelles » sont récompensées. La partie se joue en 10 tours ou s'arrête dès qu'un joueur atteint 20 points de Flair.
- **Immersion** : sons de craie, d'éponge et de cloche, vibrations, poussière de craie, réactions en emoji envoyées à l'autre.
- **171 cartes en français** : Drague / couple 45 (duo, 18+), Amitié 63 et Centres d'intérêt 63 (16+), dont 36 cartes pensées pour les groupes.
- **Robustesse** :
  - reconnexion automatique et pause si l'autre se déconnecte ;
  - lien d'invitation à usage unique, valable 24 h ;
  - aperçu du lien soigné pour WhatsApp et Messenger.
- **Vie privée** : aucun compte, aucune base de données. Les réponses restent en mémoire et disparaissent avec la partie. Les polices sont hébergées sur place, sans appel à Google.

## Tests

```bash
npm test
```

27 tests, dont une partie en duo et une partie de groupe à 3, jouées à travers le vrai serveur (HTTP + WebSocket).

## Structure

```
server/
  index.js    serveur HTTP + WebSocket, invitations, QR code
  game.js     moteur de jeu (logique pure, testée)
  invite.js   codes d'invitation, secrets
  deck.js     chargement et validation des cartes
  store.js    banque de questions perso (Postgres / Neon)
decks/        romance.json, friendship.json, interests.json
public/
  index.html, css/app.css
  js/app.js   écrans (accueil, invitation, partie)
  js/slate.js l'ardoise : saisie et rendu à la craie
  js/net.js   connexion temps réel, horloge synchronisée
  js/sound.js sons et vibrations
test/         tests du moteur et test de bout en bout
```

## Limites connues (prochaines étapes)

- **Hébergement en ligne** : le projet est prêt (`render.yaml`, `Dockerfile`). Toutes les étapes sont dans [MISE-EN-LIGNE.md](MISE-EN-LIGNE.md).
- **Mémoire seulement** : si le serveur redémarre, les parties en cours sont perdues. L'étape suivante est une base de données (Supabase / Postgres).
- **Révélation** : les réponses arrivent sur l'autre téléphone pendant le compte à rebours de 3 s, pour une révélation sans décalage. Un joueur très technique pourrait les lire dans les outils du navigateur. L'étape suivante est de les chiffrer, avec la clé libérée au signal.
- **Pas encore inclus** : le geste « lever le téléphone » (gyroscope, qui demande HTTPS), les jokers et enchères, le carnet du duo, les paiements, les cartes générées par IA.
