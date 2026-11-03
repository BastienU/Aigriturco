import { db } from "./_lib/db.js";
import { HttpError, handler, randomToken, hashKey, cleanText, cleanDate, findRoom, findMember, requireMember, assertOpen } from "./_lib/http.js";

// Liste les membres d'un salon
async function listMembers(roomId)
{
	const rows = await db()`SELECT id, pseudo, is_owner FROM members WHERE room_id = ${roomId} ORDER BY created_at`;
	return rows.map(row => ({ id: row.id, pseudo: row.pseudo, isOwner: row.is_owner }));
}

// Met en forme un salon et le membre courant pour la réponse JSON
async function roomPayload(room, member)
{
	return {
		room: { token: room.token, name: room.name, expiresAt: room.expires_at },
		members: await listMembers(room.id),
		me: member ? { id: member.id, pseudo: member.pseudo, isOwner: member.is_owner } : null
	};
}

// POST /api/rooms : crée un salon et son créateur
async function createRoom(req)
{
	const name = cleanText(req.body?.name, "Nom du salon", { min: 1, max: 60 });
	const pseudo = cleanText(req.body?.pseudo, "Pseudo", { min: 1, max: 30 });
	const expiresAt = req.body?.expiresAt ? cleanDate(req.body.expiresAt, "Date de fermeture") : null;
	const token = randomToken();
	const memberKey = randomToken(24);

	const [room] = await db()`INSERT INTO rooms (token, name, expires_at) VALUES (${token}, ${name}, ${expiresAt}) RETURNING id, token, name, expires_at::text AS expires_at`;
	const [member] = await db()`INSERT INTO members (room_id, pseudo, key_hash, is_owner) VALUES (${room.id}, ${pseudo}, ${hashKey(memberKey)}, true) RETURNING id, pseudo, is_owner`;
	return { status: 201, body: { ...(await roomPayload(room, member)), memberKey } };
}

// GET /api/rooms?salon=… : infos du salon (un membre retrouve son salon même si le lien a été régénéré)
async function getRoom(req)
{
	try
	{
		const room = await findRoom(req.query.salon);
		return roomPayload(room, await findMember(req, room.id));
	}
	catch (error)
	{
		if (error.status !== 404)
			throw error;
		const member = await findMember(req);
		if (!member)
			throw error;
		const [room] = await db()`SELECT id, token, name, expires_at::text AS expires_at FROM rooms WHERE id = ${member.room_id}`;
		assertOpen(room);
		return roomPayload(room, member);
	}
}

// PATCH /api/rooms?salon=… : régénère le lien du salon (créateur uniquement)
async function regenerateLink(req)
{
	const room = await findRoom(req.query.salon);
	const member = await requireMember(req, room.id);
	if (!member.is_owner)
		throw new HttpError(403, "Seul le créateur du salon peut régénérer le lien.");
	const [updated] = await db()`UPDATE rooms SET token = ${randomToken()} WHERE id = ${room.id} RETURNING id, token, name, expires_at::text AS expires_at`;
	return roomPayload(updated, member);
}

export default handler({ GET: getRoom, POST: createRoom, PATCH: regenerateLink });
