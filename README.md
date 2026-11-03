# 📔 Humeur du jour

Journal d'humeur partagé : on crée un **salon**, on partage son lien, et chaque membre y publie avec son pseudo ses anecdotes et son humeur du jour. Le site choisit parmi les **images du catalogue** celle qui colle le mieux à l'ambiance du salon, et une image pour chaque membre. Plus il y a d'articles dans la journée, plus l'analyse est fine.

## Fonctionnement

- **Lancement** : le site rouvre directement le dernier salon visité ; le logo mène à l'accueil (`/?accueil`).
- **Accueil** : créer un salon (nom, pseudo, date de fermeture facultative), retrouver « Mes salons », ou ouvrir un lien reçu.
- **Rejoindre** : la personne qui ouvre le lien choisit un pseudo (unique dans le salon) et un **code secret**. Sur un autre appareil (ou si le navigateur a tout oublié), « J'ai déjà un pseudo » + le code permettent de reprendre son compte. Après 5 codes faux, le pseudo est bloqué 15 minutes.
- **Journal** : date du jour par défaut, articles de tous les membres avec pseudo et heure, « Chacun sa journée » (humeur et image par membre), image du salon et frise des 30 derniers jours. Rafraîchissement automatique toutes les 20 s tant que la page est visible.
- **Filtre par auteur** : un clic sur un article (ou sur une carte « Chacun sa journée ») n'affiche plus que les articles de cette personne ; la croix, la touche Échap ou un clic ailleurs réaffichent tout.
- **Ambiance du salon** (`analyzeRoomDay` dans `js/mood.js`) : chaque humeur est un point (ressenti, énergie) entre -2 et +2. On calcule le point de chaque membre (moyenne de ses articles, nuancée par les mots de ses anecdotes), puis la moyenne des membres : **une voix par personne**. L'humeur la plus proche l'emporte, avec un petit avantage pour celles retenues par les membres. « Neutre » n'est retenu que si au moins la moitié des membres l'a choisi. Le détail du calcul est consultable sous l'image du salon.
- **Salon** : membres, lien d'invitation, profil (renommer, changer son code secret), notifications, lien d'accès personnel, régénération du lien par le créateur.
- **Gestion des membres (créateur)** : bouton « Gérer » sur chaque membre pour lui générer un lien d'accès (s'il a perdu le sien) ou le retirer du salon en supprimant ou transférant ses articles à un autre membre.
- **Humeurs** : chaque membre peut proposer une humeur au salon (emoji, nom, ressenti, énergie, couleur) ; le créateur l'accepte ou la refuse, et peut en ajouter directement. Une humeur retirée qui a déjà servi est archivée : les anciens articles la gardent. Le créateur est notifié des nouvelles propositions.
- **Notifications** : chaque membre peut activer, sur chacun de ses appareils, une notification à chaque nouvel article des autres membres (Web Push). Sur iPhone, il faut d'abord ajouter le site à l'écran d'accueil (iOS 16.4 minimum).
- **Droits** : chacun supprime ses articles ; le créateur peut supprimer tous les articles et régénérer le lien. Après une régénération, l'ancien lien ne marche plus pour les nouveaux venus, mais les membres existants sont redirigés automatiquement.

⚠️ Il n'y a pas de comptes : **toute personne qui possède le lien peut lire et écrire**.

## Architecture

- **Front** : HTML/CSS/JS sans framework (`index.html`, `css/`, `js/`).
- **API** : fonctions serverless Vercel dans `api/` (`rooms`, `members`, `entries`). Les fichiers de `api/_lib/` ne sont pas exposés.
- **Base de données** : Postgres Neon (offre gratuite), via la variable d'environnement `DATABASE_URL` ajoutée par l'intégration Vercel. Les tables sont créées automatiquement au premier appel.
- **Identité** : chaque appareil d'un membre reçoit une clé secrète gardée dans le navigateur et envoyée dans l'en-tête `X-Member-Key` (table `member_keys`, seul le hash SHA-256 est stocké). Le code secret est haché avec scrypt.
- **Notifications** : service worker `sw.js`, abonnements dans `push_subscriptions`, envoi avec la librairie `web-push` (clés VAPID).
- **Application installable** : `manifest.webmanifest` et icônes dans `icons/`.

## Lancer en local

```bash
npm install
npm run dev
```

Puis ouvrir http://localhost:3000. Le serveur local imite Vercel et utilise une base Postgres embarquée (PGlite) stockée dans `.data/` : aucune connexion à la base Neon n'est nécessaire. `DEV_DB=memory npm run dev` repart d'une base vide à chaque lancement.

## Ajouter des images

1. Déposer le fichier dans `images/` (nom en minuscules, sans espace ni accent).
2. Le déclarer dans `js/photos.js` :

```js
export const PHOTOS = [
	{ src: "images/plage.jpg", moods: ["joyeux", "serein"], tags: "plage, soleil, vacances" },
	{ src: "images/pluie.jpg", moods: ["triste"] },
];
```

- `moods` : une ou plusieurs humeurs parmi `joyeux`, `excite`, `serein`, `neutre`, `fatigue`, `triste`, `stresse`, `colere`, `malade`, `pensif`, `choque` ;
- `tags` (facultatif) : mots-clés recherchés dans les anecdotes.

Une faute de frappe dans une humeur est signalée dans la console du navigateur (F12).

## Déploiement

Chaque push sur `main` est déployé par Vercel. Prérequis côté Vercel : la base Neon reliée au projet (onglet *Storage*), preset *Other*, sans commande de build.

### Activer les notifications

1. Générer une paire de clés VAPID (une seule fois) : `npx web-push generate-vapid-keys`
2. Dans Vercel → *Settings → Environment Variables*, ajouter :
	- `VAPID_PUBLIC_KEY` : la clé publique ;
	- `VAPID_PRIVATE_KEY` : la clé privée (à ne jamais publier) ;
	- `VAPID_SUBJECT` : `mailto:` suivi d'une adresse de contact.
3. Redéployer (*Deployments → … → Redeploy*) pour que les variables soient prises en compte.

Changer de clés plus tard invalide tous les abonnements : chacun devra réactiver les notifications.

## Structure

```
index.html            page unique (accueil, rejoindre, salon)
css/style.css         styles (clair / sombre, responsive)
js/app.js             interface et navigation
js/api.js             appels à l'API
js/session.js         salons mémorisés dans le navigateur
js/mood.js            analyse de l'humeur et choix de l'image (partagé avec l'API)
js/photos.js          catalogue des images
images/               fichiers des images
sw.js                 service worker (réception des notifications)
manifest.webmanifest  manifeste de l'application installable
icons/                icônes de l'application
api/                  fonctions serverless (rooms, members, entries, moods, push)
api/_lib/             accès base de données et utilitaires HTTP
scripts/dev-server.js serveur de développement local
```
