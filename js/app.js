import { request } from "./api.js";
import * as session from "./session.js";
import { MOODS, analyzeRoomDay, pickPhoto, VALENCE_LEVELS, ENERGY_LEVELS, isSingleEmoji, defaultMoodColor } from "./mood.js";
import { PHOTOS } from "./photos.js";

const POLL_DELAY = 20000;
const $ = selector => document.querySelector(selector);

const state = {
	token: null,
	memberKey: null,
	room: null,
	members: [],
	me: null,
	date: todayStr(),
	selectedMood: null,
	entries: [],
	loadedFrom: null,
	photos: validatePhotos(PHOTOS),
	pollTimer: null,
	joinMode: "join",
	push: null,
	managed: null,
	customMoods: [],
	allMoods: MOODS,
	activeMoods: MOODS,
	colorTouched: false,
	filterMember: null
};

const EMOJI_SUGGESTIONS = ["🥳", "😍", "🥰", "🤗", "😎", "🤪", "😇", "🥲", "😤", "😩", "🥺", "😬", "🙃", "🤯", "😶", "🫠", "🤓", "😋", "🤢", "🥶", "🥵", "💪", "🎉", "☀️"];

// Garde les images correctement déclarées et signale les erreurs du catalogue dans la console
function validatePhotos(photos)
{
	return photos.filter((photo, i) =>
	{
		if (!photo || typeof photo.src !== "string" || !photo.src)
		{
			console.warn(`photos.js : l'image n°${i + 1} n'a pas de « src », elle est ignorée.`);
			return false;
		}
		const moods = Array.isArray(photo.moods) ? photo.moods : [photo.moods];
		const unknown = moods.filter(mood => !MOODS[mood]);
		if (unknown.length)
			console.warn(`photos.js : humeur(s) inconnue(s) pour ${photo.src} : ${unknown.join(", ")}. Valeurs possibles : ${Object.keys(MOODS).join(", ")}`);
		photo.moods = moods.filter(mood => MOODS[mood]);
		photo.tags = photo.tags || "";
		return true;
	});
}

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

// Indique l'heure de rédaction d'un article, avec le jour s'il diffère de la date du journal
function formatCreatedAt(entry)
{
	const created = new Date(entry.createdAt);
	const time = created.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
	if (toDateStr(created) === entry.date)
		return `à ${time}`;
	return `le ${created.toLocaleDateString("fr-FR", { day: "numeric", month: "short" })} à ${time}`;
}

// Remplit une pastille avec l'initiale du pseudo et une couleur propre à chacun
function fillAvatar(element, pseudo)
{
	let hue = 0;
	for (const c of pseudo)
		hue = (hue * 31 + c.charCodeAt(0)) % 360;
	element.textContent = pseudo.charAt(0).toUpperCase();
	element.style.background = `hsl(${hue} 55% 52%)`;
}

// Affiche un court message en bas de l'écran
function toast(message)
{
	const box = $("#toast");
	box.textContent = message;
	box.hidden = false;
	clearTimeout(toast.timer);
	toast.timer = setTimeout(() => box.hidden = true, 2800);
}

// Exécute l'envoi d'un formulaire en bloquant le bouton et en affichant l'éventuelle erreur
async function submitWith(form, action)
{
	const button = form.querySelector("button[type=submit]");
	const error = form.querySelector(".form-error");
	error.hidden = true;
	button.disabled = true;
	try
	{
		await action();
	}
	catch (err)
	{
		error.textContent = err.message;
		error.hidden = false;
	}
	finally
	{
		button.disabled = false;
	}
}

// Affiche une seule des vues de la page (accueil, rejoindre, erreur, salon)
function showView(name)
{
	$("#loading").hidden = true;
	document.querySelectorAll(".view").forEach(view => view.hidden = view.id !== `view-${name}`);
	$("#room-tabs").hidden = name !== "room";
}

// Affiche la page d'accueil et la liste des salons mémorisés
function showHome()
{
	const list = $("#my-rooms");
	const rooms = session.getRooms().filter(room => room.name && room.memberKey);
	list.replaceChildren();
	$("#no-room").hidden = rooms.length > 0;
	rooms.forEach(room =>
	{
		const item = document.createElement("li");
		const link = document.createElement("a");
		link.href = `/?salon=${encodeURIComponent(room.token)}`;
		link.className = "room-link";
		const name = document.createElement("strong");
		name.textContent = room.name;
		const pseudo = document.createElement("span");
		pseudo.className = "muted small";
		pseudo.textContent = `en tant que ${room.pseudo}`;
		link.append(name, pseudo);
		item.append(link);
		list.append(item);
	});
	showView("home");
}

// Affiche un message quand le salon est introuvable ou fermé
function showError(message)
{
	$("#error-message").textContent = message;
	showView("error");
}

// Affiche le formulaire pour rejoindre le salon avec un pseudo
function showJoin()
{
	$("#join-room-name").textContent = state.room.name;
	const count = state.members.length;
	$("#join-members").textContent = `${count} membre${count > 1 ? "s" : ""} : ${state.members.map(member => member.pseudo).join(", ")}`;
	document.title = `${state.room.name} · Humeur du jour`;
	showView("join");
	$("#join-pseudo").focus();
}

// Affiche le salon et lance le rafraîchissement automatique
async function showRoom()
{
	document.title = `${state.room.name} · Humeur du jour`;
	$("#room-title").textContent = state.room.name;
	renderSettings();
	renderPush();
	showView("room");
	showTab("journal");
	await refreshEntries();
	startPolling();
}

// Charge les infos du salon (nom, membres, membre courant)
async function loadRoom()
{
	applyRoom(await request("GET", "rooms", { query: { salon: state.token }, memberKey: state.memberKey }));
}

// Met à jour l'état avec la réponse de l'API et suit un éventuel nouveau lien
function applyRoom(data)
{
	const oldToken = state.token;
	state.room = data.room;
	state.members = data.members;
	state.me = data.me;
	state.token = data.room.token;
	if (oldToken !== state.token)
		history.replaceState(null, "", `?salon=${encodeURIComponent(state.token)}`);
	if (state.me)
		session.saveRoom({ token: state.token, name: state.room.name, pseudo: state.me.pseudo, memberKey: state.memberKey }, oldToken);
	state.customMoods = data.moods || [];
	buildMoods();
}

// Combine les humeurs de base et celles du salon : allMoods pour l'affichage, activeMoods pour le choix
function buildMoods()
{
	const toMood = mood => ({ label: mood.label, emoji: mood.emoji, color: mood.color, valence: mood.valence, energy: mood.energy });
	const pick = statuses => Object.fromEntries(state.customMoods.filter(mood => statuses.includes(mood.status)).map(mood => [mood.key, toMood(mood)]));
	state.allMoods = { ...MOODS, ...pick(["approved", "archived"]) };
	state.activeMoods = { ...MOODS, ...pick(["approved"]) };
	renderMoodPicker();
	if (state.me)
		renderMoodsTab();
}

// Analyse l'ambiance du salon (une voix par membre)
function analyzeRoom(entries)
{
	return analyzeRoomDay(entries, state.allMoods, state.activeMoods);
}

// Formate un nombre à la française avec au plus deux décimales
function formatNumber(value)
{
	return value.toLocaleString("fr-FR", { maximumFractionDigits: 2 });
}

// Charge les articles du salon (30 derniers jours, ou plus si on regarde une date ancienne)
async function refreshEntries()
{
	const today = todayStr();
	const monthAgo = shiftDate(today, -29);
	const from = state.date < monthAgo ? state.date : monthAgo;
	const data = await request("GET", "entries", { query: { salon: state.token, from, to: today }, memberKey: state.memberKey });
	state.entries = data.entries;
	state.loadedFrom = from;
	renderDay();
}

// Recharge salon et articles, en gérant la perte d'accès
async function refreshAll()
{
	try
	{
		await loadRoom();
		if (!state.me)
			return showJoin();
		renderSettings();
		await refreshEntries();
	}
	catch (error)
	{
		if ([404, 410].includes(error.status))
			showError(error.message);
		else
			toast(error.message);
	}
}

// Rafraîchit les articles régulièrement tant que la page est visible
function startPolling()
{
	clearInterval(state.pollTimer);
	state.pollTimer = setInterval(() =>
	{
		if (document.visibilityState === "visible")
			refreshEntries().catch(error => toast(error.message));
	}, POLL_DELAY);
}

// Crée les boutons de sélection d'humeur du formulaire
function renderMoodPicker()
{
	const picker = $("#mood-picker");
	picker.replaceChildren();
	for (const [key, mood] of Object.entries(state.activeMoods))
	{
		const button = document.createElement("button");
		button.type = "button";
		button.className = "mood-btn";
		button.dataset.mood = key;
		button.style.setProperty("--mood-color", mood.color);
		const emoji = document.createElement("span");
		emoji.textContent = mood.emoji;
		button.append(emoji, mood.label);
		button.addEventListener("click", () => selectMood(key));
		picker.append(button);
	}
	selectMood(state.activeMoods[state.selectedMood] ? state.selectedMood : null);
}

// Sélectionne une humeur dans le formulaire
function selectMood(key)
{
	state.selectedMood = key;
	document.querySelectorAll(".mood-btn").forEach(button => button.classList.toggle("is-selected", button.dataset.mood === key));
}

// Rafraîchit toute la vue du journal pour la date courante
function renderDay()
{
	const entries = state.entries.filter(entry => entry.date === state.date);
	$("#date-input").value = state.date;
	$("#date-input").max = todayStr();
	$("#next-day").disabled = state.date >= todayStr();
	$("#today-btn").hidden = state.date === todayStr();
	$("#day-title").textContent = formatLongDate(state.date);
	if (state.filterMember && !entries.some(entry => entry.memberId === state.filterMember))
		state.filterMember = null;
	const room = analyzeRoom(entries);
	renderEntries(entries);
	renderMembersDay(room);
	renderHighlight(room);
	renderHistory();
}

// Affiche uniquement les articles d'un membre (ou tous si on reclique sur le même)
function setFilter(memberId)
{
	state.filterMember = state.filterMember === memberId ? null : memberId;
	renderDay();
}

// Réaffiche les articles de tout le monde
function clearFilter()
{
	if (!state.filterMember)
		return;
	state.filterMember = null;
	renderDay();
}

// Affiche les articles de la journée, du plus récent au plus ancien
function renderEntries(entries)
{
	const container = $("#entries");
	const template = $("#entry-template");
	container.replaceChildren();
	$("#no-entry").hidden = entries.length > 0;

	const bar = $("#filter-bar");
	const filtered = entries.filter(entry => !state.filterMember || entry.memberId === state.filterMember);
	bar.hidden = !state.filterMember;
	if (state.filterMember)
	{
		const pseudo = filtered[0].pseudo;
		fillAvatar(bar.querySelector(".avatar"), pseudo);
		bar.querySelector(".filter-name").textContent = pseudo;
		bar.querySelector(".filter-count").textContent = `${filtered.length} sur ${entries.length}`;
	}

	filtered.forEach(entry =>
	{
		const mood = state.allMoods[entry.mood] || MOODS.neutre;
		const node = template.content.cloneNode(true);
		node.querySelector(".entry").style.setProperty("--mood-color", mood.color);
		fillAvatar(node.querySelector(".avatar"), entry.pseudo);
		node.querySelector(".entry-author").textContent = entry.pseudo;
		node.querySelector(".entry-mood").textContent = `${mood.emoji} ${mood.label}`;
		node.querySelector(".entry-time").textContent = formatCreatedAt(entry);
		node.querySelector(".entry-time").dateTime = entry.createdAt;
		node.querySelector(".entry-text").textContent = entry.anecdote;
		const remove = node.querySelector(".entry-delete");
		remove.hidden = !(entry.memberId === state.me.id || state.me.isOwner);
		remove.addEventListener("click", () => removeEntry(entry.id));
		node.querySelector(".entry").addEventListener("click", event =>
		{
			// Pas de filtre si on clique sur la croix ou si on sélectionne du texte
			if (event.target.closest(".entry-delete") || getSelection().toString())
				return;
			setFilter(entry.memberId);
		});
		container.append(node);
	});
}

// Affiche, pour chaque membre ayant écrit ce jour-là, son humeur et son image (clic : filtre ses articles)
function renderMembersDay(room)
{
	const container = $("#members-day");
	const template = $("#member-day-template");
	container.replaceChildren();
	if (!room)
		return;

	const title = document.createElement("h3");
	title.className = "field-label";
	title.textContent = "Chacun sa journée";
	const grid = document.createElement("div");
	grid.className = "members-day-grid";
	container.append(title, grid);

	room.members.forEach(({ memberId, pseudo, analysis }) =>
	{
		const mood = state.allMoods[analysis.mood];
		const match = pickPhoto(analysis, state.photos, state.date + memberId, state.allMoods);
		const node = template.content.cloneNode(true);
		const card = node.querySelector(".member-day");
		card.style.setProperty("--mood-color", mood.color);
		card.classList.toggle("is-filtered", state.filterMember === memberId);
		card.title = `Voir uniquement les articles de ${pseudo}`;
		card.addEventListener("click", () => setFilter(memberId));
		const img = node.querySelector("img");
		if (match)
			img.src = match.photo.src;
		else
			img.remove();
		card.dataset.emoji = mood.emoji;
		fillAvatar(node.querySelector(".avatar"), pseudo);
		node.querySelector(".member-day-name").textContent = pseudo;
		node.querySelector(".member-day-mood").textContent = `${mood.emoji} ${mood.label}`;
		grid.append(node);
	});
}

// Affiche l'humeur générale du salon et l'image qui lui correspond le mieux
function renderHighlight(analysis)
{
	const box = $("#highlight");
	box.hidden = !analysis;
	if (!analysis)
		return;

	const mood = state.allMoods[analysis.mood];
	const authors = analysis.members.length;
	renderCalculation(analysis);
	box.style.setProperty("--mood-color", mood.color);
	$("#hl-mood").textContent = `${mood.emoji} Ambiance plutôt ${mood.label.toLowerCase()}`;
	$("#hl-confidence").style.width = `${Math.round(analysis.confidence * 100)}%`;
	$("#hl-confidence-label").textContent = `Basé sur ${analysis.count} article${analysis.count > 1 ? "s" : ""} de ${authors} membre${authors > 1 ? "s" : ""}`;

	const match = pickPhoto(analysis, state.photos, state.date, state.allMoods);
	const img = $("#hl-photo");
	const reasons = $("#hl-reasons");
	reasons.replaceChildren();
	img.hidden = !match;
	$("#hl-empty").hidden = Boolean(match);
	if (!match)
		return;

	img.src = match.photo.src;
	const lines = match.reasons.length ? match.reasons : ["La plus proche parmi les images disponibles"];
	lines.forEach(text =>
	{
		const li = document.createElement("li");
		li.textContent = text;
		reasons.append(li);
	});
}

// Détaille le calcul de l'ambiance : point de chaque membre, moyenne du salon et humeurs les plus proches
function renderCalculation(analysis)
{
	const point = (valence, energy) => `ressenti ${formatNumber(valence)} · énergie ${formatNumber(energy)}`;
	const members = $("#calc-members");
	members.replaceChildren(...analysis.members.map(({ pseudo, analysis: member }) =>
	{
		const mood = state.allMoods[member.mood];
		const item = document.createElement("li");
		const avatar = document.createElement("span");
		avatar.className = "avatar";
		fillAvatar(avatar, pseudo);
		const text = document.createElement("div");
		const head = document.createElement("strong");
		head.textContent = `${pseudo} → ${mood.emoji} ${mood.label}`;
		const chosen = Object.entries(member.moodCounts).map(([key, n]) => `${state.allMoods[key].emoji}${n > 1 ? ` ×${n}` : ""}`).join(" ");
		const detail = document.createElement("span");
		detail.className = "muted small";
		const words = member.textHits ? ` · ${member.textHits} mot${member.textHits > 1 ? "s" : ""} repéré${member.textHits > 1 ? "s" : ""} dans ses anecdotes` : "";
		detail.textContent = `${member.count} article${member.count > 1 ? "s" : ""} (${chosen})${words} → ${point(member.valence, member.energy)}`;
		text.append(head, detail);
		item.append(avatar, text);
		return item;
	}));
	$("#calc-average").textContent = `Moyenne des ${analysis.members.length} membre${analysis.members.length > 1 ? "s" : ""} : ${point(analysis.valence, analysis.energy)}`;
	$("#calc-ranking").replaceChildren(...analysis.ranking.slice(0, 3).map((rank, i) =>
	{
		const mood = state.allMoods[rank.key];
		const item = document.createElement("li");
		const bonus = rank.bonus ? ` − ${formatNumber(rank.bonus)} (humeur d'un membre) = ${formatNumber(rank.score)}` : "";
		item.textContent = `${i === 0 ? "✅ " : ""}${mood.emoji} ${mood.label} : distance ${formatNumber(rank.distance)}${bonus}`;
		return item;
	}));
}

// Affiche une frise des 30 derniers jours colorée selon l'humeur générale du salon
function renderHistory()
{
	const byDate = new Map();
	state.entries.forEach(entry =>
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
		const analysis = analyzeRoom(byDate.get(date) || []);
		const dot = document.createElement("button");
		dot.className = "history-day";
		dot.classList.toggle("is-current", date === state.date);
		dot.title = formatLongDate(date) + (analysis ? ` · ${state.allMoods[analysis.mood].label}` : "");
		if (analysis)
			dot.style.background = state.allMoods[analysis.mood].color;
		dot.addEventListener("click", () => goToDate(date));
		history.append(dot);
	}
}

// Change la date affichée (sans dépasser aujourd'hui) et recharge si elle sort de la période chargée
function goToDate(date)
{
	if (!date || date > todayStr())
		return;
	state.date = date;
	if (date < state.loadedFrom)
		refreshEntries().catch(error => toast(error.message));
	else
		renderDay();
}

// Affiche les infos et réglages du salon
function renderSettings()
{
	$("#settings-name").textContent = state.room.name;
	$("#settings-expires").textContent = state.room.expiresAt ? `Ce salon fermera après le ${formatLongDate(state.room.expiresAt)}.` : "Ce salon n'a pas de date de fermeture.";
	$("#me-pseudo").textContent = state.me.pseudo;
	$("#invite-link").value = `${location.origin}/?salon=${state.token}`;
	$("#recovery-link").value = `${location.origin}/?salon=${state.token}&membre=${state.memberKey}`;
	$("#owner-zone").hidden = !state.me.isOwner;
	if (document.activeElement !== $("#rename-input"))
		$("#rename-input").value = state.me.pseudo;
	$("#code-status").textContent = state.me.hasCode ? "· ✅ défini" : "· ⚠️ pas encore défini";
	$("#code-banner").hidden = state.me.hasCode;

	const list = $("#member-list");
	list.replaceChildren();
	state.members.forEach(member =>
	{
		const item = document.createElement("li");
		const avatar = document.createElement("span");
		avatar.className = "avatar";
		fillAvatar(avatar, member.pseudo);
		const name = document.createElement("span");
		name.textContent = member.pseudo + (member.id === state.me.id ? " (toi)" : "");
		item.append(avatar, name);
		if (member.isOwner)
		{
			const badge = document.createElement("span");
			badge.className = "badge";
			badge.textContent = "créateur";
			item.append(badge);
		}
		if (state.me.isOwner && member.id !== state.me.id)
		{
			const manage = document.createElement("button");
			manage.className = "link-btn member-manage";
			manage.textContent = "Gérer";
			manage.addEventListener("click", () => openMemberDialog(member));
			item.append(manage);
		}
		list.append(item);
	});
}

// Affiche la galerie (lecture seule) des images déclarées dans js/photos.js
function renderGallery()
{
	const grid = $("#photo-grid");
	const template = $("#photo-template");
	grid.replaceChildren();
	$("#no-photo").hidden = state.photos.length > 0;

	state.photos.forEach(photo =>
	{
		const node = template.content.cloneNode(true);
		const img = node.querySelector("img");
		img.src = photo.src;
		img.alt = photo.src;
		img.loading = "lazy";
		img.addEventListener("error", () => img.closest(".photo-card").classList.add("is-missing"));
		node.querySelector(".photo-src").textContent = photo.src;

		const chips = node.querySelector(".chips");
		photo.moods.forEach(key =>
		{
			const chip = document.createElement("span");
			chip.className = "chip is-selected";
			chip.style.setProperty("--mood-color", MOODS[key].color);
			chip.textContent = `${MOODS[key].emoji} ${MOODS[key].label}`;
			chips.append(chip);
		});
		node.querySelector(".photo-tags").textContent = photo.tags;
		grid.append(node);
	});
}

// Crée un salon puis y entre directement
function onCreate(event)
{
	event.preventDefault();
	submitWith(event.target, async () =>
	{
		const data = await request("POST", "rooms", { body: {
			name: $("#room-name").value,
			pseudo: $("#owner-pseudo").value,
			code: $("#owner-code").value,
			expiresAt: $("#room-expires").value || null
		} });
		state.token = data.room.token;
		state.memberKey = data.memberKey;
		history.pushState(null, "", `?salon=${encodeURIComponent(state.token)}`);
		applyRoom(data);
		await showRoom();
		toast("Salon créé ! Copie le lien d'invitation dans l'onglet « Salon ».");
	});
}

// Ouvre un salon à partir d'un lien collé
function onOpenLink(event)
{
	event.preventDefault();
	const value = $("#link-input").value.trim();
	let token = value;
	try
	{
		token = new URL(value).searchParams.get("salon") || "";
	}
	catch
	{
		// Ce n'est pas une URL : on considère que c'est directement l'identifiant du salon
	}
	const error = event.target.querySelector(".form-error");
	error.hidden = Boolean(token);
	error.textContent = "Ce lien ne contient pas de salon.";
	if (token)
		location.href = `/?salon=${encodeURIComponent(token)}`;
}

// Bascule le formulaire entre « Je suis nouveau » et « J'ai déjà un pseudo »
function setJoinMode(mode)
{
	state.joinMode = mode;
	document.querySelectorAll("[data-join-mode]").forEach(button => button.classList.toggle("is-active", button.dataset.joinMode === mode));
	document.querySelectorAll("#join-form [data-label-join]").forEach(element => element.textContent = element.dataset[mode === "join" ? "labelJoin" : "labelReclaim"]);
	$("#join-code").autocomplete = mode === "join" ? "new-password" : "current-password";
	$("#join-form .form-error").hidden = true;
}

// Rejoint le salon avec un nouveau pseudo, ou reprend un pseudo existant grâce au code secret
function onJoin(event)
{
	event.preventDefault();
	submitWith(event.target, async () =>
	{
		const data = await request("POST", "members", { body: {
			salon: state.token,
			action: state.joinMode,
			pseudo: $("#join-pseudo").value,
			code: $("#join-code").value
		} });
		state.memberKey = data.memberKey;
		await loadRoom();
		await showRoom();
	});
}

// Publie un article dans le salon
function onSubmitEntry(event)
{
	event.preventDefault();
	submitWith(event.target, async () =>
	{
		if (!state.selectedMood)
			throw new Error("Choisis une humeur avant de publier.");
		await request("POST", "entries", { memberKey: state.memberKey, body: {
			salon: state.token,
			date: state.date,
			mood: state.selectedMood,
			anecdote: $("#anecdote").value
		} });
		$("#anecdote").value = "";
		selectMood(null);
		await refreshEntries();
	});
}

// Supprime un article après confirmation
async function removeEntry(id)
{
	if (!confirm("Supprimer cet article ?"))
		return;
	try
	{
		await request("DELETE", "entries", { query: { salon: state.token, id }, memberKey: state.memberKey });
		await refreshEntries();
	}
	catch (error)
	{
		toast(error.message);
	}
}

// Régénère le lien d'invitation (créateur uniquement)
async function regenerateLink()
{
	if (!confirm("L'ancien lien ne fonctionnera plus pour les nouveaux invités. Continuer ?"))
		return;
	try
	{
		applyRoom(await request("PATCH", "rooms", { query: { salon: state.token }, memberKey: state.memberKey }));
		renderSettings();
		toast("Nouveau lien prêt : renvoie-le aux personnes à inviter.");
	}
	catch (error)
	{
		toast(error.message);
	}
}

// Oublie le salon sur cet appareil et revient à l'accueil
function leaveRoom()
{
	if (!confirm("Sans ton lien d'accès personnel, tu ne pourras plus reprendre ce pseudo. Oublier ce salon ?"))
		return;
	session.forgetRoom(state.token);
	location.href = "/?accueil";
}

// Change son pseudo
function onRename(event)
{
	event.preventDefault();
	submitWith(event.target, async () =>
	{
		await request("PATCH", "members", { memberKey: state.memberKey, body: { salon: state.token, pseudo: $("#rename-input").value } });
		$("#rename-input").blur();
		await refreshAll();
		toast("Pseudo modifié !");
	});
}

// Définit ou change son code secret
function onSetCode(event)
{
	event.preventDefault();
	submitWith(event.target, async () =>
	{
		await request("PATCH", "members", { memberKey: state.memberKey, body: { salon: state.token, code: $("#code-input").value } });
		$("#code-input").value = "";
		state.me.hasCode = true;
		renderSettings();
		toast("Code secret enregistré.");
	});
}

// Ouvre la fenêtre de gestion d'un membre (créateur uniquement)
function openMemberDialog(member)
{
	state.managed = member;
	const count = member.entryCount;
	$("#md-title").textContent = member.pseudo;
	$("#md-count").textContent = `${count} article${count > 1 ? "s" : ""}`;
	$("#md-access-row").hidden = true;
	$("#md-remove-btn").textContent = `Retirer ${member.pseudo}`;
	const select = $("#md-merge");
	select.replaceChildren(new Option("Les supprimer", ""));
	state.members.filter(other => other.id !== member.id).forEach(other => select.append(new Option(`Les transférer à ${other.pseudo}`, other.id)));
	$("#member-dialog").showModal();
}

// Génère un lien d'accès pour le membre géré
async function generateAccessLink()
{
	try
	{
		const data = await request("POST", "members", { memberKey: state.memberKey, body: { salon: state.token, action: "access", memberId: state.managed.id } });
		$("#md-access-link").value = `${location.origin}/?salon=${state.token}&membre=${data.memberKey}`;
		$("#md-access-row").hidden = false;
	}
	catch (error)
	{
		toast(error.message);
	}
}

// Retire le membre géré, en transférant ou supprimant ses articles
async function removeMember()
{
	const member = state.managed;
	const target = $("#md-merge").value;
	const fate = target ? `ses articles seront transférés à ${state.members.find(other => other.id === target).pseudo}` : "ses articles seront supprimés";
	if (!confirm(`Retirer ${member.pseudo} du salon ? ${fate[0].toUpperCase() + fate.slice(1)}.`))
		return;
	try
	{
		const query = { salon: state.token, id: member.id };
		if (target)
			query.mergeInto = target;
		await request("DELETE", "members", { query, memberKey: state.memberKey });
		$("#member-dialog").close();
		await refreshAll();
		toast(`${member.pseudo} a été retiré du salon.`);
	}
	catch (error)
	{
		toast(error.message);
	}
}

// Convertit la clé publique VAPID (base64url) dans le format attendu par le navigateur
function base64UrlToBytes(value)
{
	const base64 = (value + "=".repeat((4 - value.length % 4) % 4)).replace(/-/g, "+").replace(/_/g, "/");
	return Uint8Array.from(atob(base64), c => c.charCodeAt(0));
}

// Indique si le site est ouvert comme application installée (écran d'accueil)
function isStandalone()
{
	return matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
}

// Affiche l'état des notifications pour ce salon et sur cet appareil
async function renderPush()
{
	const status = $("#push-status");
	const button = $("#push-btn");
	button.hidden = true;
	const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
	if (isIos && !isStandalone())
		return status.textContent = "Sur iPhone, ajoute d'abord le site à l'écran d'accueil (bouton Partager → « Sur l'écran d'accueil »), puis ouvre-le depuis l'icône pour activer les notifications.";
	if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window))
		return status.textContent = "Ton navigateur ne gère pas les notifications.";
	try
	{
		state.push ??= await request("GET", "push");
	}
	catch
	{
		return status.textContent = "Impossible de vérifier les notifications pour le moment.";
	}
	if (!state.push.enabled)
		return status.textContent = "Les notifications ne sont pas encore configurées sur le serveur.";
	if (Notification.permission === "denied")
		return status.textContent = "Tu as bloqué les notifications pour ce site : réautorise-les dans les réglages de ton navigateur.";

	const enabled = Boolean(session.findRoom(state.token)?.push) && Notification.permission === "granted";
	status.textContent = enabled ? "🔔 Tu reçois une notification quand un membre publie un article." : "Reçois une notification sur cet appareil quand un membre publie un article.";
	button.textContent = enabled ? "Désactiver" : "Activer les notifications";
	button.className = enabled ? "ghost-btn" : "primary-btn";
	button.hidden = false;
}

// Active ou désactive les notifications de ce salon sur cet appareil
async function togglePush()
{
	const button = $("#push-btn");
	button.disabled = true;
	try
	{
		const registration = await navigator.serviceWorker.ready;
		let subscription = await registration.pushManager.getSubscription();
		if (session.findRoom(state.token)?.push)
		{
			if (subscription)
				await request("DELETE", "push", { query: { salon: state.token, endpoint: subscription.endpoint }, memberKey: state.memberKey });
			session.saveRoom({ token: state.token, push: false });
		}
		else
		{
			if (await Notification.requestPermission() !== "granted")
				throw new Error("Notifications refusées.");
			const options = { userVisibleOnly: true, applicationServerKey: base64UrlToBytes(state.push.publicKey) };
			try
			{
				subscription ??= await registration.pushManager.subscribe(options);
			}
			catch
			{
				// L'ancien abonnement a été créé avec une autre clé serveur : on le remplace
				await subscription?.unsubscribe();
				subscription = await registration.pushManager.subscribe(options);
			}
			await request("POST", "push", { memberKey: state.memberKey, body: { salon: state.token, subscription: subscription.toJSON() } });
			session.saveRoom({ token: state.token, push: true });
			toast("Notifications activées 🔔");
		}
	}
	catch (error)
	{
		toast(`Impossible de modifier les notifications : ${error.message}`);
	}
	finally
	{
		button.disabled = false;
		renderPush();
	}
}

// Crée une pastille « emoji + nom » colorée pour une humeur
function moodChip(mood)
{
	const chip = document.createElement("span");
	chip.className = "chip is-selected";
	chip.style.setProperty("--mood-color", mood.color);
	chip.textContent = `${mood.emoji} ${mood.label}`;
	return chip;
}

// Crée une ligne de liste pour une humeur personnalisée, avec sa description et ses boutons d'action
function moodRow(mood, actions)
{
	const item = document.createElement("li");
	const text = document.createElement("div");
	text.className = "mood-row-text";
	const meta = document.createElement("span");
	meta.className = "muted small";
	const levels = `${VALENCE_LEVELS.find(([v]) => v === mood.valence)?.[1] || ""} · ${ENERGY_LEVELS.find(([v]) => v === mood.energy)?.[1] || ""}`;
	const by = mood.proposedBy ? ` · par ${mood.proposedBy.pseudo}` : "";
	const usage = mood.usage ? ` · ${mood.usage} article${mood.usage > 1 ? "s" : ""}` : "";
	meta.textContent = levels + by + usage;
	text.append(moodChip(mood), meta);
	item.append(text);
	const buttons = document.createElement("div");
	buttons.className = "mood-row-actions";
	actions.forEach(([label, handler, danger]) =>
	{
		const button = document.createElement("button");
		button.className = danger ? "link-btn danger" : "link-btn";
		button.textContent = label;
		button.addEventListener("click", handler);
		buttons.append(button);
	});
	item.append(buttons);
	return item;
}

// Affiche l'onglet Humeurs : formulaire, propositions en attente, humeurs du salon et humeurs retirées
function renderMoodsTab()
{
	const owner = state.me.isOwner;
	$("#mood-form-title").textContent = owner ? "Ajouter une humeur" : "Proposer une humeur";
	$("#mood-form-hint").textContent = owner ? "En tant que créateur, ton humeur est ajoutée directement au salon." : "Le créateur du salon recevra ta proposition et pourra l'accepter.";
	$("#mood-submit").textContent = owner ? "Ajouter" : "Proposer";

	const pending = state.customMoods.filter(mood => mood.status === "pending");
	const approved = state.customMoods.filter(mood => mood.status === "approved");
	const archived = state.customMoods.filter(mood => mood.status === "archived");

	$("#pending-card").hidden = !pending.length;
	$("#pending-list").replaceChildren(...pending.map(mood =>
	{
		const actions = [];
		if (owner)
			actions.push(["Accepter", () => moodAction("PATCH", mood, "approve")], ["Refuser", () => moodAction("DELETE", mood), true]);
		else if (mood.proposedBy?.id === state.me.id)
			actions.push(["Annuler", () => moodAction("DELETE", mood), true]);
		return moodRow(mood, actions);
	}));

	$("#no-custom").hidden = approved.length > 0;
	$("#custom-list").replaceChildren(...approved.map(mood => moodRow(mood, owner ? [["Retirer", () => moodAction("DELETE", mood), true]] : [])));
	$("#base-list").replaceChildren(...Object.values(MOODS).map(moodChip));

	$("#archived-card").hidden = !owner || !archived.length;
	$("#archived-list").replaceChildren(...archived.map(mood => moodRow(mood, [["Restaurer", () => moodAction("PATCH", mood, "restore")]])));

	const badge = $("#moods-badge");
	badge.hidden = !owner || !pending.length;
	badge.textContent = pending.length;
}

// Remplit les listes déroulantes du formulaire et les suggestions d'emojis
function initMoodForm()
{
	const fill = (select, levels) => select.replaceChildren(...levels.map(([value, label]) => new Option(label, value, false, value === 0)));
	fill($("#mood-valence"), VALENCE_LEVELS);
	fill($("#mood-energy"), ENERGY_LEVELS);
	$("#emoji-suggestions").replaceChildren(...EMOJI_SUGGESTIONS.map(emoji =>
	{
		const button = document.createElement("button");
		button.type = "button";
		button.textContent = emoji;
		button.addEventListener("click", () =>
		{
			$("#mood-emoji").value = emoji;
			updateMoodPreview();
		});
		return button;
	}));
	updateMoodPreview();
}

// Met à jour l'aperçu de l'humeur en cours de création (et la couleur conseillée tant qu'on n'y a pas touché)
function updateMoodPreview()
{
	const valence = Number($("#mood-valence").value);
	const energy = Number($("#mood-energy").value);
	if (!state.colorTouched)
		$("#mood-color").value = defaultMoodColor(valence, energy);
	const preview = $("#mood-preview");
	preview.replaceChildren(moodChip({
		emoji: $("#mood-emoji").value.trim() || "❔",
		label: $("#mood-label").value.trim() || "Nom de l'humeur",
		color: $("#mood-color").value
	}));
}

// Envoie la nouvelle humeur (proposition, ou ajout direct pour le créateur)
function onSubmitMood(event)
{
	event.preventDefault();
	submitWith(event.target, async () =>
	{
		const emoji = $("#mood-emoji").value.trim();
		if (!isSingleEmoji(emoji))
			throw new Error("Choisis un seul emoji (touche une suggestion ou utilise le clavier emoji).");
		const data = await request("POST", "moods", { memberKey: state.memberKey, body: {
			salon: state.token,
			emoji,
			label: $("#mood-label").value,
			valence: Number($("#mood-valence").value),
			energy: Number($("#mood-energy").value),
			color: $("#mood-color").value
		} });
		state.customMoods = data.moods;
		buildMoods();
		event.target.reset();
		state.colorTouched = false;
		initMoodForm();
		toast(state.me.isOwner ? "Humeur ajoutée au salon !" : "Proposition envoyée au créateur du salon.");
	});
}

// Accepte, refuse, retire ou restaure une humeur personnalisée
async function moodAction(method, mood, action)
{
	if (method === "DELETE" && !confirm(`${mood.status === "pending" ? "Retirer la proposition" : "Retirer l'humeur"} « ${mood.emoji} ${mood.label} » ?`))
		return;
	try
	{
		const options = method === "DELETE"
			? { query: { salon: state.token, id: mood.id }, memberKey: state.memberKey }
			: { body: { salon: state.token, id: mood.id, action }, memberKey: state.memberKey };
		const data = await request(method, "moods", options);
		state.customMoods = data.moods;
		buildMoods();
		renderDay();
	}
	catch (error)
	{
		toast(error.message);
	}
}

// Copie le contenu d'un champ dans le presse-papiers
async function copyField(id)
{
	const input = document.getElementById(id);
	try
	{
		await navigator.clipboard.writeText(input.value);
		toast("Lien copié !");
	}
	catch
	{
		input.select();
		toast("Copie automatique impossible : fais Ctrl+C.");
	}
}

// Affiche l'onglet demandé du salon
function showTab(name)
{
	document.querySelectorAll(".tab").forEach(tab => tab.classList.toggle("is-active", tab.dataset.tab === name));
	document.querySelectorAll(".panel").forEach(panel => panel.hidden = panel.id !== `tab-${name}`);
	window.scrollTo({ top: 0 });
}

// Branche tous les événements de la page
function bindEvents()
{
	$("#create-form").addEventListener("submit", onCreate);
	$("#link-form").addEventListener("submit", onOpenLink);
	$("#join-form").addEventListener("submit", onJoin);
	$("#entry-form").addEventListener("submit", onSubmitEntry);
	$("#date-input").addEventListener("change", event => goToDate(event.target.value));
	$("#prev-day").addEventListener("click", () => goToDate(shiftDate(state.date, -1)));
	$("#next-day").addEventListener("click", () => goToDate(shiftDate(state.date, 1)));
	$("#today-btn").addEventListener("click", () => goToDate(todayStr()));
	$("#regenerate-btn").addEventListener("click", regenerateLink);
	$("#rename-form").addEventListener("submit", onRename);
	$("#mood-form").addEventListener("submit", onSubmitMood);
	["#mood-emoji", "#mood-label", "#mood-valence", "#mood-energy"].forEach(selector => $(selector).addEventListener("input", updateMoodPreview));
	$("#mood-color").addEventListener("input", () =>
	{
		state.colorTouched = true;
		updateMoodPreview();
	});
	$("#code-form").addEventListener("submit", onSetCode);
	$("#push-btn").addEventListener("click", togglePush);
	$("#md-access-btn").addEventListener("click", generateAccessLink);
	$("#md-remove-btn").addEventListener("click", removeMember);
	document.querySelectorAll("[data-join-mode]").forEach(button => button.addEventListener("click", () => setJoinMode(button.dataset.joinMode)));
	$("#leave-btn").addEventListener("click", leaveRoom);
	document.querySelectorAll("[data-tab]").forEach(tab => tab.addEventListener("click", () => showTab(tab.dataset.tab)));
	document.querySelectorAll("[data-copy]").forEach(button => button.addEventListener("click", () => copyField(button.dataset.copy)));
	window.addEventListener("popstate", () => location.reload());
	$("#filter-clear").addEventListener("click", clearFilter);
	document.addEventListener("click", event =>
	{
		// Un clic en dehors des articles et des cartes membres réaffiche tous les articles
		if (state.filterMember && !event.target.closest(".entry, .member-day, #filter-bar"))
			clearFilter();
	});
	document.addEventListener("keydown", event =>
	{
		if (event.key === "Escape")
			clearFilter();
	});
	document.addEventListener("visibilitychange", () =>
	{
		if (document.visibilityState === "visible" && state.me)
			refreshAll();
	});
}

// Lit l'URL et affiche l'accueil, le formulaire pour rejoindre ou le salon
async function init()
{
	bindEvents();
	renderMoodPicker();
	initMoodForm();
	renderGallery();
	if ("serviceWorker" in navigator)
		navigator.serviceWorker.register("/sw.js").catch(error => console.warn("Service worker :", error));

	const params = new URLSearchParams(location.search);
	let token = params.get("salon");
	if (!token)
	{
		// Sans salon dans l'URL, on rouvre le dernier salon visité (sauf si on demande explicitement l'accueil)
		const last = params.has("accueil") ? null : session.lastRoom();
		if (!last)
			return showHome();
		token = last.token;
		history.replaceState(null, "", `?salon=${encodeURIComponent(token)}`);
	}

	// Lien d'accès personnel : on mémorise la clé puis on la retire de la barre d'adresse
	const recoveryKey = params.get("membre");
	if (recoveryKey)
		history.replaceState(null, "", `?salon=${encodeURIComponent(token)}`);

	state.token = token;
	state.memberKey = recoveryKey || session.findRoom(token)?.memberKey || null;
	try
	{
		await loadRoom();
	}
	catch (error)
	{
		return showError(error.message);
	}
	if (state.me)
		await showRoom();
	else
		showJoin();
}

init();
