import { db } from "./_lib/db.js";
import { HttpError, handler, findRoom, requireMember } from "./_lib/http.js";
import { findMood } from "./_lib/moods.js";
import { entryReactions } from "./_lib/reactions.js";

// Vérifie que l'article existe bien dans ce salon et renvoie son identifiant
async function findEntry(roomId, entryId)
{
	if (typeof entryId !== "string" || !/^[0-9a-f-]{36}$/i.test(entryId))
		throw new HttpError(400, "Article invalide.");
	const [entry] = await db()`SELECT id FROM entries WHERE id = ${entryId} AND room_id = ${roomId}`;
	if (!entry)
		throw new HttpError(404, "Article introuvable.");
	return entry.id;
}

// POST /api/reactions : ajoute sa réaction (une humeur du salon) à un article
async function add(req)
{
	const body = req.body || {};
	const room = await findRoom(body.salon);
	const member = await requireMember(req, room.id);
	const entryId = await findEntry(room.id, body.entryId);
	if (!await findMood(room.id, body.mood, { onlyApproved: true }))
		throw new HttpError(400, "Cette réaction n'existe pas dans le salon.");
	await db()`
		INSERT INTO entry_reactions (entry_id, member_id, mood) VALUES (${entryId}, ${member.id}, ${body.mood})
		ON CONFLICT DO NOTHING`;
	return { status: 201, body: { reactions: await entryReactions(entryId) } };
}

// DELETE /api/reactions?salon=…&entryId=…&mood=… : retire sa réaction
async function remove(req)
{
	const room = await findRoom(req.query.salon);
	const member = await requireMember(req, room.id);
	const entryId = await findEntry(room.id, req.query.entryId);
	await db()`DELETE FROM entry_reactions WHERE entry_id = ${entryId} AND member_id = ${member.id} AND mood = ${req.query.mood || ""}`;
	return { reactions: await entryReactions(entryId) };
}

export default handler({ POST: add, DELETE: remove });
