// Chaque humeur est placée sur deux axes : valence (négatif → positif) et énergie (calme → agité)
export const MOODS = {
	joyeux: { label: "Joyeux", emoji: "😄", color: "#f2a93b", valence: 2, energy: 1 },
	excite: { label: "Excité", emoji: "🤩", color: "#f0714f", valence: 2, energy: 2 },
	serein: { label: "Serein", emoji: "😌", color: "#3fb68b", valence: 1, energy: -1 },
	neutre: { label: "Neutre", emoji: "😐", color: "#8f97a6", valence: 0, energy: 0 },
	fatigue: { label: "Fatigué", emoji: "😴", color: "#7d8bd1", valence: -1, energy: -2 },
	triste: { label: "Triste", emoji: "😢", color: "#4f86e8", valence: -2, energy: -1 },
	stresse: { label: "Stressé", emoji: "😰", color: "#a970d6", valence: -1, energy: 2 },
	colere: { label: "En colère", emoji: "😠", color: "#e0484f", valence: -2, energy: 2 }
};

// Petit lexique de racines de mots (sans accents) qui influencent l'analyse des anecdotes
const LEXICON = [
	[["content", "heureu", "genial", "super", "cool", "rire", "rigol", "bonheur", "merveill", "adore", "kiff", "fier", "reussi", "bravo", "cadeau", "amour"], 2, 1],
	[["fete", "soiree", "concert", "victoire", "gagne", "hate", "impatien", "voyage", "aventure"], 2, 2],
	[["sport", "courir", "couru", "danse", "rando", "velo", "muscu", "match"], 1, 2],
	[["calme", "repos", "detend", "zen", "tranquil", "paisible", "lecture", "balade", "promen", "plage", "soleil", "nature", "vacance", "sieste", "cocooning"], 1, -1],
	[["ami", "famille", "copain", "copine", "bisou", "calin"], 1, 0],
	[["fatigu", "epuis", "creve", "insomni", "malade", "migraine", "lassitude", "flemme"], -1, -2],
	[["trist", "pleur", "seul", "solitude", "manque", "deprim", "decu", "deception", "nostalg", "perdu", "rupture", "deuil"], -2, -1],
	[["stress", "angoiss", "peur", "inquiet", "anxi", "examen", "partiel", "deadline", "retard", "pression", "urgence", "oral", "entretien"], -1, 2],
	[["colere", "enerv", "agac", "dispute", "rage", "marre", "injust", "frustr", "insupport", "deteste", "embrouille"], -2, 2]
];

const NEGATIONS = new Set(["pas", "plus", "jamais", "ni", "sans", "aucun", "aucune"]);

const STOPWORDS = new Set(["avec", "dans", "pour", "mais", "donc", "alors", "aussi", "tres", "trop", "bien", "cette", "cela", "comme", "elle", "elles", "nous", "vous", "ils", "leur", "leurs", "suis", "etait", "etais", "ete", "avoir", "avait", "avais", "fait", "faire", "tout", "tous", "toute", "toutes", "encore", "apres", "avant", "quand", "parce", "quelque", "chose", "aujourd", "hui", "journee", "matin", "soir", "midi", "demain", "hier", "moment", "sont", "etre", "peu", "beaucoup", "plus", "moins", "ma", "mon", "mes"]);

// Met un texte en minuscules, retire les accents et le découpe en mots
export function tokenize(text)
{
	return text.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").split(/[^a-z]+/).filter(Boolean);
}

// Analyse les anecdotes : tendance émotionnelle des mots reconnus et mots-clés utiles
function analyzeText(text)
{
	const tokens = tokenize(text);
	let valence = 0;
	let energy = 0;
	let hits = 0;
	tokens.forEach((token, i) =>
	{
		const rule = LEXICON.find(([stems]) => stems.some(stem => token.startsWith(stem)));
		if (!rule)
			return;
		const negated = NEGATIONS.has(tokens[i - 1]) || NEGATIONS.has(tokens[i - 2]);
		valence += negated ? -rule[1] : rule[1];
		energy += rule[2];
		hits++;
	});
	const keywords = new Set(tokens.filter(token => token.length >= 3 && !STOPWORDS.has(token)));
	return {
		valence: hits ? valence / hits : 0,
		energy: hits ? energy / hits : 0,
		hits,
		keywords
	};
}

// Renvoie la clé de l'humeur la plus proche d'un point (valence, énergie)
function nearestMood(valence, energy)
{
	let best = "neutre";
	let bestDistance = Infinity;
	for (const [key, mood] of Object.entries(MOODS))
	{
		const distance = Math.hypot(mood.valence - valence, mood.energy - energy);
		if (distance < bestDistance)
		{
			best = key;
			bestDistance = distance;
		}
	}
	return best;
}

// Calcule l'état d'esprit global d'une journée à partir de toutes ses entrées
export function analyzeDay(entries)
{
	const valid = entries.filter(entry => MOODS[entry.mood]);
	if (!valid.length)
		return null;
	let valence = 0;
	let energy = 0;
	const moodCounts = {};
	valid.forEach(entry =>
	{
		valence += MOODS[entry.mood].valence;
		energy += MOODS[entry.mood].energy;
		moodCounts[entry.mood] = (moodCounts[entry.mood] || 0) + 1;
	});
	valence /= valid.length;
	energy /= valid.length;

	const text = analyzeText(valid.map(entry => entry.anecdote).join(" "));
	if (text.hits)
	{
		// Le texte nuance l'humeur choisie, sans jamais la remplacer
		const weight = Math.min(0.4, text.hits * 0.1);
		valence = valence * (1 - weight) + text.valence * weight;
		energy = energy * (1 - weight) + text.energy * weight;
	}

	const confidence = Math.min(1, valid.length * 0.2 + Math.min(text.hits, 4) * 0.05 + 0.1);
	return {
		valence,
		energy,
		mood: nearestMood(valence, energy),
		moodCounts,
		keywords: text.keywords,
		textHits: text.hits,
		count: valid.length,
		confidence
	};
}

// Petit hash déterministe pour départager deux photos sans que le choix change à chaque affichage
function hash(str)
{
	let h = 0;
	for (const c of str)
		h = (h * 31 + c.charCodeAt(0)) | 0;
	return Math.abs(h);
}

// Note une photo par rapport à l'analyse de la journée et explique pourquoi
function scorePhoto(photo, analysis, date)
{
	const reasons = [];
	const moods = (photo.moods || []).filter(key => MOODS[key]);

	let valence = 0;
	let energy = 0;
	moods.forEach(key =>
	{
		valence += MOODS[key].valence;
		energy += MOODS[key].energy;
	});
	if (moods.length)
	{
		valence /= moods.length;
		energy /= moods.length;
	}

	// Distance max possible entre deux humeurs ≈ 5.66 (de -2/-2 à 2/2)
	const distance = Math.hypot(valence - analysis.valence, energy - analysis.energy);
	let score = (1 - distance / 5.66) * 0.6;

	if (moods.includes(analysis.mood))
		reasons.push(`Tu l'as associée à l'humeur « ${MOODS[analysis.mood].label} »`);
	else if (moods.length && distance < 1.2)
		reasons.push("Son ambiance est proche de ton humeur");

	let moodBonus = 0;
	moods.forEach(key =>
	{
		if (analysis.moodCounts[key])
			moodBonus += analysis.moodCounts[key] / analysis.count;
	});
	score += Math.min(1, moodBonus) * 0.2;

	const tags = tokenize(photo.tags || "").filter(tag => tag.length >= 3);
	const matched = tags.filter(tag => [...analysis.keywords].some(word => word.startsWith(tag) || tag.startsWith(word)));
	if (matched.length)
		reasons.push(`${matched.length > 1 ? "Mots-clés" : "Mot-clé"} ${matched.map(tag => `« ${tag} »`).join(", ")} ${matched.length > 1 ? "retrouvés" : "retrouvé"} dans tes anecdotes`);
	score += Math.min(1, matched.length * 0.5) * 0.3;

	// Une photo sans étiquette reste candidate, mais passe après les autres
	if (!moods.length && !tags.length)
		score *= 0.7;

	score += (hash(date + photo.src) % 1000) / 100000;
	return { photo, score, reasons };
}

// Choisit parmi les photos celle qui correspond le mieux à la journée
export function pickPhoto(analysis, photos, date)
{
	if (!analysis || !photos.length)
		return null;
	return photos.map(photo => scorePhoto(photo, analysis, date)).sort((a, b) => b.score - a.score)[0];
}
