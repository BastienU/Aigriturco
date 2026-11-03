import { db } from "./_lib/db.js";
import { HttpError, handler, hashCode, verifyCode, createMemberKey, cleanText, findRoom, requireMember, requireOwner } from "./_lib/http.js";

const MAX_ATTEMPTS = 5;
const LOCK_MINUTES = 15;

// Transforme une violation d'unicité (code 23505) en message lisible
function pseudoTaken(error)
{
	if (error.code === "23505")
		return new HttpError(409, "Ce pseudo est déjà pris dans ce salon.");
	return error;
}

// Vérifie qu'un identifiant ressemble à un uuid
function cleanId(value, field)
{
	if (typeof value !== "string" || !/^[0-9a-f-]{36}$/i.test(value))
		throw new HttpError(400, `${field} : identifiant invalide.`);
	return value;
}

// Rejoint un salon avec un pseudo et un code secret
async function join(room, body)
{
	const pseudo = cleanText(body.pseudo, "Pseudo", { min: 1, max: 30 });
	const code = cleanText(body.code, "Code secret", { min: 4, max: 64 });
	try
	{
		const [member] = await db()`INSERT INTO members (room_id, pseudo, code_hash) VALUES (${room.id}, ${pseudo}, ${hashCode(code)}) RETURNING id, pseudo, is_owner`;
		return { status: 201, body: { memberKey: await createMemberKey(member.id) } };
	}
	catch (error)
	{
		throw pseudoTaken(error);
	}
}

// Reprend un pseudo existant sur un nouvel appareil grâce au code secret (bloqué après plusieurs échecs)
async function reclaim(room, body)
{
	const pseudo = cleanText(body.pseudo, "Pseudo", { min: 1, max: 30 });
	const code = cleanText(body.code, "Code secret", { min: 1, max: 64 });
	const [member] = await db()`
		SELECT id, code_hash, failed_attempts, locked_until > now() AS locked
		FROM members WHERE room_id = ${room.id} AND lower(pseudo) = lower(${pseudo})`;
	if (!member)
		throw new HttpError(404, "Aucun membre avec ce pseudo dans ce salon.");
	if (!member.code_hash)
		throw new HttpError(403, "Ce membre n'a pas défini de code secret : demande au créateur du salon un lien d'accès.");
	if (member.locked)
		throw new HttpError(429, `Trop d'essais. Réessaie dans ${LOCK_MINUTES} minutes.`);

	if (!verifyCode(code, member.code_hash))
	{
		const attempts = member.failed_attempts + 1;
		const lock = attempts >= MAX_ATTEMPTS;
		await db()`
			UPDATE members SET failed_attempts = ${lock ? 0 : attempts},
				locked_until = CASE WHEN ${lock} THEN now() + make_interval(mins => ${LOCK_MINUTES}) ELSE locked_until END
			WHERE id = ${member.id}`;
		throw new HttpError(401, lock ? `Code incorrect. Trop d'essais : réessaie dans ${LOCK_MINUTES} minutes.` : `Code incorrect (${MAX_ATTEMPTS - attempts} essai(s) restant(s)).`);
	}
	await db()`UPDATE members SET failed_attempts = 0, locked_until = NULL WHERE id = ${member.id}`;
	return { memberKey: await createMemberKey(member.id) };
}

// Crée un lien d'accès pour un autre membre qui a perdu le sien (créateur uniquement)
async function accessLink(room, body, req)
{
	await requireOwner(req, room.id);
	const memberId = cleanId(body.memberId, "Membre");
	const [member] = await db()`SELECT id FROM members WHERE id = ${memberId} AND room_id = ${room.id}`;
	if (!member)
		throw new HttpError(404, "Membre introuvable.");
	return { memberKey: await createMemberKey(member.id) };
}

// POST /api/members : join (par défaut), reclaim ou access selon body.action
async function post(req)
{
	const body = req.body || {};
	const room = await findRoom(body.salon);
	if (body.action === "reclaim")
		return reclaim(room, body);
	if (body.action === "access")
		return accessLink(room, body, req);
	return join(room, body);
}

// PATCH /api/members : change son pseudo et/ou son code secret
async function update(req)
{
	const body = req.body || {};
	const room = await findRoom(body.salon);
	const member = await requireMember(req, room.id);
	if (body.pseudo !== undefined)
	{
		const pseudo = cleanText(body.pseudo, "Pseudo", { min: 1, max: 30 });
		try
		{
			await db()`UPDATE members SET pseudo = ${pseudo} WHERE id = ${member.id}`;
		}
		catch (error)
		{
			throw pseudoTaken(error);
		}
	}
	if (body.code !== undefined)
	{
		const code = cleanText(body.code, "Code secret", { min: 4, max: 64 });
		await db()`UPDATE members SET code_hash = ${hashCode(code)}, failed_attempts = 0, locked_until = NULL WHERE id = ${member.id}`;
	}
	return { updated: true };
}

// DELETE /api/members?salon=…&id=…&mergeInto=… : retire un membre, en transférant éventuellement ses articles (créateur uniquement)
async function remove(req)
{
	const room = await findRoom(req.query.salon);
	const owner = await requireOwner(req, room.id);
	const id = cleanId(req.query.id, "Membre");
	if (id === owner.id)
		throw new HttpError(400, "Le créateur ne peut pas se retirer lui-même.");
	if (req.query.mergeInto)
	{
		const target = cleanId(req.query.mergeInto, "Destinataire");
		const [exists] = await db()`SELECT id FROM members WHERE id = ${target} AND room_id = ${room.id} AND id <> ${id}`;
		if (!exists)
			throw new HttpError(404, "Membre destinataire introuvable.");
		await db()`UPDATE entries SET member_id = ${target} WHERE member_id = ${id} AND room_id = ${room.id}`;
	}
	const deleted = await db()`DELETE FROM members WHERE id = ${id} AND room_id = ${room.id} RETURNING id`;
	if (!deleted.length)
		throw new HttpError(404, "Membre introuvable.");
	return { deleted: id };
}

export default handler({ POST: post, PATCH: update, DELETE: remove });
