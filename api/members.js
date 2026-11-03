import { db } from "./_lib/db.js";
import { HttpError, handler, randomToken, hashKey, cleanText, findRoom } from "./_lib/http.js";

// POST /api/members : rejoint un salon avec un pseudo et renvoie la clé personnelle du membre
async function join(req)
{
	const room = await findRoom(req.body?.salon);
	const pseudo = cleanText(req.body?.pseudo, "Pseudo", { min: 1, max: 30 });
	const memberKey = randomToken(24);
	try
	{
		const [member] = await db()`INSERT INTO members (room_id, pseudo, key_hash) VALUES (${room.id}, ${pseudo}, ${hashKey(memberKey)}) RETURNING id, pseudo, is_owner`;
		return { status: 201, body: { memberKey, me: { id: member.id, pseudo: member.pseudo, isOwner: member.is_owner } } };
	}
	catch (error)
	{
		// 23505 = violation de contrainte d'unicité (pseudo déjà pris dans ce salon)
		if (error.code === "23505")
			throw new HttpError(409, "Ce pseudo est déjà pris dans ce salon.");
		throw error;
	}
}

export default handler({ POST: join });
