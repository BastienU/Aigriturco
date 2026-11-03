# 📔 Humeur du jour

Journal d'humeur partagé : on crée un **salon**, on partage son lien, et chaque membre y publie avec son pseudo ses anecdotes et son humeur du jour. Le site choisit parmi les **images du catalogue** celle qui colle le mieux à l'ambiance du salon, et une image pour chaque membre. Plus il y a d'articles dans la journée, plus l'analyse est fine.

## Fonctionnement

- **Accueil** : créer un salon (nom, pseudo, date de fermeture facultative), retrouver « Mes salons », ou ouvrir un lien reçu.
- **Rejoindre** : la personne qui ouvre le lien choisit un pseudo (unique dans le salon).
- **Journal** : date du jour par défaut, articles de tous les membres avec pseudo et heure, « Chacun sa journée » (humeur et image par membre), image du salon et frise des 30 derniers jours. Rafraîchissement automatique toutes les 20 s tant que la page est visible.
- **Salon** : membres, lien d'invitation, lien d'accès personnel (pour retrouver son pseudo sur un autre appareil), régénération du lien par le créateur.
- **Droits** : chacun supprime ses articles ; le créateur peut supprimer tous les articles et régénérer le lien. Après une régénération, l'ancien lien ne marche plus pour les nouveaux venus, mais les membres existants sont redirigés automatiquement.

⚠️ Il n'y a pas de comptes : **toute personne qui possède le lien peut lire et écrire**.

## Architecture

- **Front** : HTML/CSS/JS sans framework (`index.html`, `css/`, `js/`).
- **API** : fonctions serverless Vercel dans `api/` (`rooms`, `members`, `entries`). Les fichiers de `api/_lib/` ne sont pas exposés.
- **Base de données** : Postgres Neon (offre gratuite), via la variable d'environnement `DATABASE_URL` ajoutée par l'intégration Vercel. Les tables sont créées automatiquement au premier appel.
- **Identité** : chaque membre reçoit une clé secrète gardée dans son navigateur et envoyée dans l'en-tête `X-Member-Key`. La base n'en stocke que le hash SHA-256.

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
api/                  fonctions serverless (rooms, members, entries)
api/_lib/             accès base de données et utilitaires HTTP
scripts/dev-server.js serveur de développement local
```
