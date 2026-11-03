import { db } from "./_lib/db.js";
import { HttpError, handler, cleanText, findRoom, requireMember, requireOwner } from "./_lib/http.js";
import { listRoomMoods } from "./_lib/moods.js";
import { notifyMoodProposal } from "./_lib/push.js";
import { MOODS, isSingleEmoji } from "../js/mood.js";

const MAX_CUSTOM = 30;
const MAX_PENDING_PER_MEMBER = 3;

// Vérifie qu'une position sur un axe est un nombre entre -2 et 2
function cleanAxis(value, field)
{
	const number = Number(value);
	if (!Number.isFinite(number) || number < -2 || number > 2)
		throw new HttpError(400, `${field} : valeur entre -2 et 2 attendue.`);
	return number;
}

// Vérifie qu'un identifiant ressemble à un uuid
function cleanId(value)
{
	if (typeof value !== "string" || !/^[0-9a-f-]{36}$/i.test(value))
		throw new HttpError(400, "Identifiant d'humeur invalide.");
	return value;
}

// Renvoie la liste à jour des humeurs du salon
async function moodsPayload(roomId)
{
	return { moods: await listRoomMoods(roomId) };
}

// POST /api/moods : propose une humeur (acceptée directement si c'est le créateur qui l'ajoute)
async function create(req)
{
	const body = req.body || {};
	const room = await findRoom(body.salon);
	const member = await requireMember(req, room.id);
	const label = cleanText(body.label, "Nom", { min: 1, max: 20 });
	const emoji = typeof body.emoji === "string" ? body.emoji.trim() : "";
	if (!isSingleEmoji(emoji))
		throw new HttpError(400, "Choisis un seul emoji.");
	const color = typeof body.color === "string" && /^#[0-9a-f]{6}$/i.test(body.color) ? body.color.toLowerCase() : null;
	if (!color)
		throw new HttpError(400, "Couleur invalide.");
	const valence = cleanAxis(body.valence, "Ressenti");
	const energy = cleanAxis(body.energy, "Énergie");
	if (Object.values(MOODS).some(mood => mood.label.toLowerCase() === label.toLowerCase()))
		throw new HttpError(409, "Cette humeur existe déjà.");

	const [counts] = await db()`
		SELECT count(*) FILTER (WHERE status <> 'archived')::int AS active,
			count(*) FILTER (WHERE status = 'pending' AND proposed_by = ${member.id})::int AS mine
		FROM room_moods WHERE room_id = ${room.id}`;
	if (counts.active >= MAX_CUSTOM)
		throw new HttpError(409, `Le salon a déjà ${MAX_CUSTOM} humeurs personnalisées.`);
	if (!member.is_owner && counts.mine >= MAX_PENDING_PER_MEMBER)
		throw new HttpError(409, `Tu as déjà ${MAX_PENDING_PER_MEMBER} propositions en attente.`);

	const status = member.is_owner ? "approved" : "pending";
	try
	{
		await db()`
			INSERT INTO room_moods (room_id, label, emoji, color, valence, energy, status, proposed_by)
			VALUES (${room.id}, ${label}, ${emoji}, ${color}, ${valence}, ${energy}, ${status}, ${member.id})`;
	}
	catch (error)
	{
		// 23505 = violation d'unicité : même nom déjà utilisé dans le salon
		if (error.code === "23505")
			throw new HttpError(409, "Cette humeur existe déjà (ou a déjà été proposée).");
		throw error;
	}
	if (status === "pending")
	{
		try
		{
			await notifyMoodProposal(room, member, { label, emoji });
		}
		catch (error)
		{
			console.error("Notifications :", error);
		}
	}
	return { status: 201, body: await moodsPayload(room.id) };
}

// PATCH /api/moods : accepte une proposition, archive ou restaure une humeur (créateur uniquement)
async function update(req)
{
	const body = req.body || {};
	const room = await findRoom(body.salon);
	await requireOwner(req, room.id);
	const id = cleanId(body.id);
	const transitions = { approve: ["pending", "approved"], archive: ["approved", "archived"], restore: ["archived", "approved"] };
	const transition = transitions[body.action];
	if (!transition)
		throw new HttpError(400, "Action inconnue.");
	const updated = await db()`
		UPDATE room_moods SET status = ${transition[1]}
		WHERE id = ${id} AND room_id = ${room.id} AND status = ${transition[0]}
		RETURNING id`;
	if (!updated.length)
		throw new HttpError(404, "Humeur introuvable ou déjà modifiée.");
	return moodsPayload(room.id);
}

// DELETE /api/moods?salon=…&id=… : refuse/annule une proposition ou supprime une humeur inutilisée (archivée si déjà utilisée)
async function remove(req)
{
	const room = await findRoom(req.query.salon);
	const member = await requireMember(req, room.id);
	const id = cleanId(req.query.id);
	const [mood] = await db()`
		SELECT status, proposed_by, (SELECT count(*) FROM entries e WHERE e.room_id = ${room.id} AND e.mood = ${"c:" + id})::int AS usage
		FROM room_moods WHERE id = ${id} AND room_id = ${room.id}`;
	if (!mood)
		throw new HttpError(404, "Humeur introuvable.");
	const ownPending = mood.status === "pending" && mood.proposed_by === member.id;
	if (!member.is_owner && !ownPending)
		throw new HttpError(403, "Seul le créateur du salon peut retirer cette humeur.");

	// Une humeur déjà utilisée est archivée pour que les anciens articles gardent leur emoji
	if (mood.usage > 0)
		await db()`UPDATE room_moods SET status = 'archived' WHERE id = ${id}`;
	else
		await db()`DELETE FROM room_moods WHERE id = ${id}`;
	return moodsPayload(room.id);
}

export default handler({ POST: create, PATCH: update, DELETE: remove });
