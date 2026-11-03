# 📔 Humeur du jour

Journal d'humeur quotidien : pour chaque jour, tu écris des anecdotes et tu choisis une humeur. Chaque entrée devient un petit « article » horodaté, et le site choisit parmi les **images du catalogue** celle qui colle le mieux à l'état d'esprit de la journée. Plus tu ajoutes d'entrées dans la journée, plus l'analyse est fine.

## Fonctionnement

- **Journal** : sélection de la date (aujourd'hui par défaut), anecdote + humeur, liste des entrées avec l'heure de rédaction, frise des 30 derniers jours colorée par humeur.
- **Galerie** : affiche, en lecture seule, les images du catalogue avec leurs humeurs et mots-clés (et signale les fichiers introuvables).
- **Choix de la photo** (`js/mood.js`) :
	- chaque humeur est un point sur deux axes, *valence* (négatif → positif) et *énergie* (calme → agité) ;
	- la journée = moyenne des humeurs des entrées, nuancée par un petit lexique appliqué aux anecdotes (avec gestion simple de la négation : « pas content ») ;
	- chaque photo est notée selon sa distance à ce point, les humeurs qui lui sont associées et ses mots-clés retrouvés dans les anecdotes ;
	- le site explique pourquoi il a choisi la photo.
- **Données** : les entrées sont stockées dans le navigateur (IndexedDB), rien n'est envoyé sur un serveur. Export / import JSON dans l'onglet « Galerie » pour sauvegarder ou changer d'appareil.

## Ajouter des images

1. Déposer le fichier dans `images/` (nom en minuscules, sans espace ni accent).
2. Le déclarer dans `js/photos.js` :

```js
export const PHOTOS = [
	{ src: "images/plage.jpg", moods: ["joyeux", "serein"], tags: "plage, soleil, vacances" },
	{ src: "images/pluie.jpg", moods: ["triste"] },
];
```

- `moods` : une ou plusieurs humeurs parmi `joyeux`, `excite`, `serein`, `neutre`, `fatigue`, `triste`, `stresse`, `colere` ;
- `tags` (facultatif) : mots-clés recherchés dans les anecdotes.

Une faute de frappe dans une humeur est signalée dans la console du navigateur (F12).

## Lancer en local

```bash
python3 -m http.server 4173
```

Puis ouvrir http://localhost:4173 (les modules ES ne fonctionnent pas en ouvrant directement `index.html` en `file://`).

## Déployer sur Vercel

Site 100 % statique : aucune configuration ni build nécessaire.

**Option 1 – via GitHub (recommandé, redéploiement automatique à chaque push)**
1. Créer un dépôt sur GitHub et y pousser ce projet.
2. Sur https://vercel.com/new, importer le dépôt.
3. Framework Preset : *Other*, laisser Build Command et Output Directory vides, puis *Deploy*.

**Option 2 – via la CLI**

```bash
npx vercel
npx vercel --prod
```

## Structure

```
index.html        page unique (2 onglets)
css/style.css     styles (clair / sombre, responsive)
js/app.js         interface et événements
js/mood.js        analyse de l'humeur et choix de la photo
js/photos.js      catalogue des images (chemin, humeurs, mots-clés)
images/           fichiers des images
js/storage.js     accès IndexedDB
```
