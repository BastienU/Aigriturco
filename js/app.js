import * as db from "./storage.js";
import { MOODS, analyzeDay, pickPhoto } from "./mood.js";

const $ = selector => document.querySelector(selector);

const state = {
	date: todayStr(),
	selectedMood: null,
	photos: [],
	urls: new Map()
};

// Convertit une Date en chaîne AAAA-MM-JJ selon l'heure locale (toISOString utiliserait l'UTC)
function toDateStr(date)
{
	const month = String(date.getMonth() + 1).padStart(2, "0");
	const day = String(date.getDate()).padStart(2, "0");
	return `${date.getFullYear()}-${month}-${day}`;
}

// Renvoie la date du jour au format AAAA-MM-JJ
function todayStr()
{
	return toDateStr(new Date());
}

// Décale une date AAAA-MM-JJ d'un certain nombre de jours
function shiftDate(dateStr, days)
{
	const date = new Date(`${dateStr}T12:00:00`);
	date.setDate(date.getDate() + days);
	return toDateStr(date);
}

// Formate une date AAAA-MM-JJ en toutes lettres (ex : mardi 3 novembre 2026)
function formatLongDate(dateStr)
{
	return new Date(`${dateStr}T12:00:00`).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

// Indique l'heure de rédaction d'une entrée, avec le jour s'il diffère de la date du journal
function formatCreatedAt(entry)
{
	const created = new Date(entry.createdAt);
	const time = created.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
	if (toDateStr(created) === entry.date)
		return `Écrit à ${time}`;
	return `Écrit le ${created.toLocaleDateString("fr-FR", { day: "numeric", month: "short" })} à ${time}`;
}

// Renvoie (et met en cache) l'URL d'affichage d'une photo stockée en Blob
function photoUrl(photo)
{
	if (!state.urls.has(photo.id))
		state.urls.set(photo.id, URL.createObjectURL(photo.blob));
	return state.urls.get(photo.id);
}

// Crée les boutons de sélection d'humeur du formulaire
function renderMoodPicker()
{
	const picker = $("#mood-picker");
	for (const [key, mood] of Object.entries(MOODS))
	{
		const button = document.createElement("button");
		button.type = "button";
		button.className = "mood-btn";
		button.dataset.mood = key;
		button.style.setProperty("--mood-color", mood.color);
		button.innerHTML = `<span>${mood.emoji}</span>${mood.label}`;
		button.addEventListener("click", () => selectMood(key));
		picker.append(button);
	}
}

// Sélectionne une humeur dans le formulaire
function selectMood(key)
{
	state.selectedMood = key;
	document.querySelectorAll(".mood-btn").forEach(button => button.classList.toggle("is-selected", button.dataset.mood === key));
	$("#form-error").hidden = true;
}

// Rafraîchit toute la vue du journal pour la date courante
async function renderDay()
{
	const entries = await db.getEntriesByDate(state.date);
	entries.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
	$("#date-input").value = state.date;
	$("#date-input").max = todayStr();
	$("#next-day").disabled = state.date >= todayStr();
	$("#today-btn").hidden = state.date === todayStr();
	$("#day-title").textContent = formatLongDate(state.date);
	renderEntries(entries);
	renderHighlight(entries);
	await renderHistory();
}

// Affiche les « articles » de la journée, du plus récent au plus ancien
function renderEntries(entries)
{
	const container = $("#entries");
	const template = $("#entry-template");
	container.replaceChildren();
	$("#no-entry").hidden = entries.length > 0;
	entries.forEach(entry =>
	{
		const mood = MOODS[entry.mood] || MOODS.neutre;
		const node = template.content.cloneNode(true);
		const article = node.querySelector(".entry");
		article.style.setProperty("--mood-color", mood.color);
		node.querySelector(".entry-mood").textContent = `${mood.emoji} ${mood.label}`;
		node.querySelector(".entry-time").textContent = formatCreatedAt(entry);
		node.querySelector(".entry-time").dateTime = entry.createdAt;
		node.querySelector(".entry-text").textContent = entry.anecdote;
		node.querySelector(".entry-delete").addEventListener("click", () => removeEntry(entry.id));
		container.append(node);
	});
}

// Affiche l'humeur globale de la journée et la photo qui lui correspond le mieux
function renderHighlight(entries)
{
	const box = $("#highlight");
	const analysis = analyzeDay(entries);
	box.hidden = !analysis;
	if (!analysis)
		return;

	const mood = MOODS[analysis.mood];
	box.style.setProperty("--mood-color", mood.color);
	$("#hl-mood").textContent = `${mood.emoji} Plutôt ${mood.label.toLowerCase()}`;
	$("#hl-confidence").style.width = `${Math.round(analysis.confidence * 100)}%`;
	const plural = analysis.count > 1 ? "s" : "";
	const hint = analysis.confidence < 1 ? " · ajoute des entrées pour affiner" : "";
	$("#hl-confidence-label").textContent = `Analyse basée sur ${analysis.count} entrée${plural}${hint}`;

	const match = pickPhoto(analysis, state.photos, state.date);
	const img = $("#hl-photo");
	const reasons = $("#hl-reasons");
	reasons.replaceChildren();
	img.hidden = !match;
	$("#hl-empty").hidden = Boolean(match);
	if (!match)
		return;

	img.src = photoUrl(match.photo);
	const lines = match.reasons.length ? match.reasons : ["La plus proche parmi tes photos (pense à les étiqueter !)"];
	lines.forEach(text =>
	{
		const li = document.createElement("li");
		li.textContent = text;
		reasons.append(li);
	});
}

// Affiche une frise des 30 derniers jours colorée selon l'humeur dominante
async function renderHistory()
{
	const all = await db.getAllEntries();
	const byDate = new Map();
	all.forEach(entry =>
	{
		if (!byDate.has(entry.date))
			byDate.set(entry.date, []);
		byDate.get(entry.date).push(entry);
	});

	const history = $("#history");
	history.replaceChildren();
	for (let i = 29; i >= 0; i--)
	{
		const date = shiftDate(todayStr(), -i);
		const analysis = analyzeDay(byDate.get(date) || []);
		const dot = document.createElement("button");
		dot.className = "history-day";
		dot.classList.toggle("is-current", date === state.date);
		dot.title = formatLongDate(date) + (analysis ? ` · ${MOODS[analysis.mood].label}` : "");
		if (analysis)
			dot.style.background = MOODS[analysis.mood].color;
		dot.addEventListener("click", () => goToDate(date));
		history.append(dot);
	}
}

// Change la date affichée (sans dépasser aujourd'hui)
function goToDate(date)
{
	if (!date || date > todayStr())
		return;
	state.date = date;
	renderDay();
}

// Valide le formulaire et enregistre une nouvelle entrée
async function onSubmit(event)
{
	event.preventDefault();
	const anecdote = $("#anecdote").value.trim();
	if (!state.selectedMood)
	{
		$("#form-error").textContent = "Choisis une humeur avant d'enregistrer.";
		$("#form-error").hidden = false;
		return;
	}
	await db.saveEntry({
		id: crypto.randomUUID(),
		date: state.date,
		createdAt: new Date().toISOString(),
		mood: state.selectedMood,
		anecdote
	});
	$("#anecdote").value = "";
	selectMood(null);
	renderDay();
}

// Supprime une entrée après confirmation
async function removeEntry(id)
{
	if (!confirm("Supprimer cette entrée ?"))
		return;
	await db.deleteEntry(id);
	renderDay();
}

// Réduit une image pour limiter la place prise dans le navigateur
async function resizeImage(file, maxSize = 1280)
{
	const bitmap = await createImageBitmap(file);
	const ratio = Math.min(1, maxSize / Math.max(bitmap.width, bitmap.height));
	const canvas = document.createElement("canvas");
	canvas.width = Math.round(bitmap.width * ratio);
	canvas.height = Math.round(bitmap.height * ratio);
	canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
	bitmap.close();
	return new Promise(resolve => canvas.toBlob(resolve, "image/jpeg", 0.85));
}

// Charge les photos depuis la base
async function loadPhotos()
{
	state.photos = await db.getAllPhotos();
	state.photos.sort((a, b) => a.addedAt.localeCompare(b.addedAt));
}

// Ajoute les photos choisies par l'utilisateur
async function onPhotosSelected(event)
{
	const failed = [];
	for (const file of event.target.files)
	{
		try
		{
			const blob = await resizeImage(file);
			await db.savePhoto({ id: crypto.randomUUID(), name: file.name, blob, moods: [], tags: "", addedAt: new Date().toISOString() });
		}
		catch
		{
			failed.push(file.name);
		}
	}
	event.target.value = "";
	if (failed.length)
		alert(`Impossible de lire : ${failed.join(", ")} (format non supporté par ce navigateur ?)`);
	await loadPhotos();
	renderPhotos();
	renderDay();
}

// Affiche la galerie avec, pour chaque photo, ses humeurs et mots-clés modifiables
function renderPhotos()
{
	const grid = $("#photo-grid");
	const template = $("#photo-template");
	grid.replaceChildren();
	$("#photo-count").textContent = state.photos.length;
	$("#no-photo").hidden = state.photos.length > 0;

	state.photos.forEach(photo =>
	{
		const node = template.content.cloneNode(true);
		node.querySelector("img").src = photoUrl(photo);
		node.querySelector("img").alt = photo.name;

		const chips = node.querySelector(".chips");
		for (const [key, mood] of Object.entries(MOODS))
		{
			const chip = document.createElement("button");
			chip.className = "chip";
			chip.style.setProperty("--mood-color", mood.color);
			chip.textContent = `${mood.emoji} ${mood.label}`;
			chip.classList.toggle("is-selected", photo.moods.includes(key));
			chip.addEventListener("click", () => togglePhotoMood(photo, key, chip));
			chips.append(chip);
		}

		const tags = node.querySelector(".tags-input");
		tags.value = photo.tags;
		tags.addEventListener("change", () => updatePhoto(photo, { tags: tags.value.trim() }));
		node.querySelector(".photo-delete").addEventListener("click", () => removePhoto(photo));
		grid.append(node);
	});
}

// Ajoute ou retire une humeur associée à une photo
function togglePhotoMood(photo, key, chip)
{
	const moods = photo.moods.includes(key) ? photo.moods.filter(mood => mood !== key) : [...photo.moods, key];
	chip.classList.toggle("is-selected", moods.includes(key));
	updatePhoto(photo, { moods });
}

// Enregistre une modification de photo puis recalcule la photo du jour
async function updatePhoto(photo, changes)
{
	Object.assign(photo, changes);
	await db.savePhoto(photo);
	renderDay();
}

// Supprime une photo après confirmation
async function removePhoto(photo)
{
	if (!confirm("Supprimer cette photo ?"))
		return;
	await db.deletePhoto(photo.id);
	URL.revokeObjectURL(state.urls.get(photo.id));
	state.urls.delete(photo.id);
	await loadPhotos();
	renderPhotos();
	renderDay();
}

// Convertit un Blob en data URL (texte) pour pouvoir l'écrire dans un JSON
function blobToDataUrl(blob)
{
	return new Promise((resolve, reject) =>
	{
		const reader = new FileReader();
		reader.onload = () => resolve(reader.result);
		reader.onerror = () => reject(reader.error);
		reader.readAsDataURL(blob);
	});
}

// Télécharge toutes les données (entrées + photos) dans un fichier JSON
async function exportData()
{
	const entries = await db.getAllEntries();
	const photos = await Promise.all(state.photos.map(async ({ blob, ...photo }) => ({ ...photo, data: await blobToDataUrl(blob) })));
	const file = new Blob([JSON.stringify({ version: 1, entries, photos })], { type: "application/json" });
	const link = document.createElement("a");
	link.href = URL.createObjectURL(file);
	link.download = `humeur-du-jour-${todayStr()}.json`;
	link.click();
	URL.revokeObjectURL(link.href);
}

// Restaure une sauvegarde JSON (les éléments existants avec le même id sont remplacés)
async function importData(event)
{
	const file = event.target.files[0];
	event.target.value = "";
	if (!file)
		return;
	try
	{
		const backup = JSON.parse(await file.text());
		const photos = await Promise.all((backup.photos || []).map(async ({ data, ...photo }) => ({ ...photo, blob: await (await fetch(data)).blob() })));
		await db.putMany("entries", backup.entries || []);
		await db.putMany("photos", photos);
		await loadPhotos();
		renderPhotos();
		renderDay();
		alert(`Import terminé : ${(backup.entries || []).length} entrées, ${photos.length} photos.`);
	}
	catch
	{
		alert("Ce fichier n'est pas une sauvegarde valide.");
	}
}

// Affiche l'onglet demandé (journal ou photos)
function showTab(name)
{
	document.querySelectorAll(".tab").forEach(tab => tab.classList.toggle("is-active", tab.dataset.tab === name));
	document.querySelectorAll(".panel").forEach(panel => panel.hidden = panel.id !== `tab-${name}`);
	window.scrollTo({ top: 0 });
}

// Branche les événements et lance le premier affichage
async function init()
{
	renderMoodPicker();
	$("#entry-form").addEventListener("submit", onSubmit);
	$("#date-input").addEventListener("change", event => goToDate(event.target.value));
	$("#prev-day").addEventListener("click", () => goToDate(shiftDate(state.date, -1)));
	$("#next-day").addEventListener("click", () => goToDate(shiftDate(state.date, 1)));
	$("#today-btn").addEventListener("click", () => goToDate(todayStr()));
	$("#photo-input").addEventListener("change", onPhotosSelected);
	$("#export-btn").addEventListener("click", exportData);
	$("#import-input").addEventListener("change", importData);
	document.querySelectorAll("[data-tab]").forEach(tab => tab.addEventListener("click", () => showTab(tab.dataset.tab)));
	document.querySelectorAll("[data-goto]").forEach(link => link.addEventListener("click", () => showTab(link.dataset.goto)));

	await loadPhotos();
	renderPhotos();
	renderDay();
}

init();
