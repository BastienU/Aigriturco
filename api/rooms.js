import { db } from "./_lib/db.js";
import { handler, randomToken, hashCode, createMemberKey, cleanText, cleanDate, findRoom, findMember, requireOwner, assertOpen } from "./_lib/http.js";

// Liste les membres d'un salon avec leur nombre d'articles
async function listMembers(roomId)
{
	const rows = await db()`
		SELECT m.id, m.pseudo, m.is_owner, (SELECT count(*) FROM entries e WHERE e.member_id = m.id)::int AS entry_count
		FROM members m WHERE m.room_id = ${roomId} ORDER BY m.created_at`;
	return rows.map(row => ({ id: row.id, pseudo: row.pseudo, isOwner: row.is_owner, entryCount: row.entry_count }));
}

// Met en forme un salon et le membre courant pour la réponse JSON
async function roomPayload(room, member)
{
	return {
		room: { token: room.token, name: room.name, expiresAt: room.expires_at },
		members: await listMembers(room.id),
		me: member ? { id: member.id, pseudo: member.pseudo, isOwner: member.is_owner, hasCode: Boolean(member.has_code) } : null
	};
}

// POST /api/rooms : crée un salon et son créateur
async function createRoom(req)
{
	const name = cleanText(req.body?.name, "Nom du salon", { min: 1, max: 60 });
	const pseudo = cleanText(req.body?.pseudo, "Pseudo", { min: 1, max: 30 });
	const code = cleanText(req.body?.code, "Code secret", { min: 4, max: 64 });
	const expiresAt = req.body?.expiresAt ? cleanDate(req.body.expiresAt, "Date de fermeture") : null;
	const token = randomToken();

	const [room] = await db()`INSERT INTO rooms (token, name, expires_at) VALUES (${token}, ${name}, ${expiresAt}) RETURNING id, token, name, expires_at::text AS expires_at`;
	const [member] = await db()`INSERT INTO members (room_id, pseudo, code_hash, is_owner) VALUES (${room.id}, ${pseudo}, ${hashCode(code)}, true) RETURNING id, pseudo, is_owner, true AS has_code`;
	const memberKey = await createMemberKey(member.id);
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
	const member = await requireOwner(req, room.id);
	const [updated] = await db()`UPDATE rooms SET token = ${randomToken()} WHERE id = ${room.id} RETURNING id, token, name, expires_at::text AS expires_at`;
	return roomPayload(updated, member);
}

export default handler({ GET: getRoom, POST: createRoom, PATCH: regenerateLink });
