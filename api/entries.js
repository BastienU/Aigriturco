import { db } from "./_lib/db.js";
import { HttpError, handler, cleanText, cleanDate, findRoom, requireMember } from "./_lib/http.js";
import { MOODS } from "../js/mood.js";
import { notifyNewEntry } from "./_lib/push.js";

const MAX_RANGE_DAYS = 400;

// Met en forme une ligne SQL pour la réponse JSON
function toEntry(row)
{
	return {
		id: row.id,
		memberId: row.member_id,
		pseudo: row.pseudo,
		date: row.day,
		mood: row.mood,
		anecdote: row.anecdote,
		createdAt: row.created_at
	};
}

// GET /api/entries?salon=…&from=…&to=… : articles du salon sur une période
async function list(req)
{
	const room = await findRoom(req.query.salon);
	await requireMember(req, room.id);
	const from = cleanDate(req.query.from, "Début");
	const to = cleanDate(req.query.to, "Fin");
	if ((Date.parse(to) - Date.parse(from)) / 86400000 > MAX_RANGE_DAYS)
		throw new HttpError(400, `Période limitée à ${MAX_RANGE_DAYS} jours.`);
	const rows = await db()`
		SELECT e.id, e.member_id, m.pseudo, e.day::text AS day, e.mood, e.anecdote, e.created_at
		FROM entries e JOIN members m ON m.id = e.member_id
		WHERE e.room_id = ${room.id} AND e.day BETWEEN ${from} AND ${to}
		ORDER BY e.created_at DESC`;
	return { entries: rows.map(toEntry) };
}

// POST /api/entries : publie un article dans le salon
async function create(req)
{
	const room = await findRoom(req.body?.salon);
	const member = await requireMember(req, room.id);
	const day = cleanDate(req.body?.date, "Date");
	const anecdote = cleanText(req.body?.anecdote, "Anecdote", { max: 2000 });
	const mood = req.body?.mood;
	if (!MOODS[mood])
		throw new HttpError(400, "Humeur inconnue.");
	// Tolérance d'un jour pour les fuseaux horaires en avance sur le serveur
	if (Date.parse(day) > Date.now() + 86400000)
		throw new HttpError(400, "Impossible d'écrire dans le futur.");
	const [row] = await db()`
		INSERT INTO entries (room_id, member_id, day, mood, anecdote)
		VALUES (${room.id}, ${member.id}, ${day}, ${mood}, ${anecdote})
		RETURNING id, member_id, day::text AS day, mood, anecdote, created_at`;
	try
	{
		await notifyNewEntry(room, member, row);
	}
	catch (error)
	{
		// Une notification ratée ne doit pas empêcher la publication
		console.error("Notifications :", error);
	}
	return { status: 201, body: { entry: toEntry({ ...row, pseudo: member.pseudo }) } };
}

// DELETE /api/entries?salon=…&id=… : supprime son article (le créateur du salon peut tout supprimer)
async function remove(req)
{
	const room = await findRoom(req.query.salon);
	const member = await requireMember(req, room.id);
	const id = req.query.id;
	if (typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id))
		throw new HttpError(400, "Identifiant invalide.");
	const deleted = await db()`
		DELETE FROM entries
		WHERE id = ${id} AND room_id = ${room.id} AND (member_id = ${member.id} OR ${member.is_owner})
		RETURNING id`;
	if (!deleted.length)
		throw new HttpError(404, "Article introuvable ou qui ne t'appartient pas.");
	return { deleted: id };
}

export default handler({ GET: list, POST: create, DELETE: remove });
