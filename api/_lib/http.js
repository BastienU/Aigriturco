import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { db, ensureSchema } from "./db.js";

// Erreur « métier » renvoyée telle quelle au client avec son code HTTP
export class HttpError extends Error
{
	constructor(status, message)
	{
		super(message);
		this.status = status;
	}
}

// Enveloppe un handler : prépare la base, gère les méthodes autorisées et les erreurs
export function handler(routes)
{
	return async (req, res) =>
	{
		res.setHeader("Cache-Control", "no-store");
		const route = routes[req.method];
		if (!route)
			return res.status(405).json({ error: "Méthode non autorisée." });
		try
		{
			await ensureSchema();
			const result = await route(req);
			res.status(result?.status || 200).json(result?.body ?? result ?? {});
		}
		catch (error)
		{
			if (error instanceof HttpError)
				return res.status(error.status).json({ error: error.message });
			console.error(error);
			res.status(500).json({ error: "Erreur interne du serveur." });
		}
	};
}

// Génère un secret aléatoire lisible dans une URL
export function randomToken(bytes = 12)
{
	return randomBytes(bytes).toString("base64url");
}

// Hache une clé membre : la base ne stocke jamais la clé en clair
export function hashKey(key)
{
	return createHash("sha256").update(key).digest("hex");
}

// Hache un code secret avec un sel aléatoire (scrypt : lent exprès pour freiner les essais en masse)
export function hashCode(code)
{
	const salt = randomBytes(16).toString("hex");
	return `${salt}:${scryptSync(code, salt, 32).toString("hex")}`;
}

// Vérifie un code secret contre son hash, en temps constant
export function verifyCode(code, stored)
{
	if (!stored)
		return false;
	const [salt, hash] = stored.split(":");
	return timingSafeEqual(Buffer.from(hash, "hex"), scryptSync(code, salt, 32));
}

// Crée une nouvelle clé d'accès (un appareil) pour un membre et la renvoie en clair
export async function createMemberKey(memberId)
{
	const key = randomToken(24);
	await db()`INSERT INTO member_keys (key_hash, member_id) VALUES (${hashKey(key)}, ${memberId})`;
	return key;
}

// Nettoie une chaîne et vérifie sa longueur
export function cleanText(value, field, { min = 0, max })
{
	const text = typeof value === "string" ? value.trim() : "";
	if (text.length < min || text.length > max)
		throw new HttpError(400, `${field} : entre ${min} et ${max} caractères.`);
	return text;
}

// Vérifie qu'une date est au format AAAA-MM-JJ
export function cleanDate(value, field)
{
	if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || isNaN(Date.parse(value)))
		throw new HttpError(400, `${field} : date invalide.`);
	return value;
}

// Retrouve le salon à partir de son lien, refuse s'il est introuvable ou expiré
export async function findRoom(token)
{
	if (typeof token !== "string" || !token)
		throw new HttpError(400, "Lien de salon manquant.");
	const [room] = await db()`SELECT id, token, name, expires_at::text AS expires_at FROM rooms WHERE token = ${token}`;
	if (!room)
		throw new HttpError(404, "Ce salon n'existe pas ou son lien a été régénéré.");
	assertOpen(room);
	return room;
}

// Refuse l'accès à un salon dont la date de fermeture est passée
export function assertOpen(room)
{
	if (room.expires_at && room.expires_at < new Date().toISOString().slice(0, 10))
		throw new HttpError(410, "Ce salon est fermé depuis le " + room.expires_at + ".");
}

// Retrouve le membre correspondant à la clé envoyée dans l'en-tête X-Member-Key
export async function findMember(req, roomId)
{
	const key = req.headers["x-member-key"];
	if (!key)
		return null;
	const [member] = await db()`
		SELECT m.id, m.room_id, m.pseudo, m.is_owner, m.code_hash IS NOT NULL AS has_code
		FROM member_keys k JOIN members m ON m.id = k.member_id
		WHERE k.key_hash = ${hashKey(key)}`;
	if (!member || (roomId && member.room_id !== roomId))
		return null;
	return member;
}

// Comme findMember mais exige un membre valide
export async function requireMember(req, roomId)
{
	const member = await findMember(req, roomId);
	if (!member)
		throw new HttpError(401, "Tu dois rejoindre ce salon avec un pseudo.");
	return member;
}

// Comme requireMember mais réservé au créateur du salon
export async function requireOwner(req, roomId)
{
	const member = await requireMember(req, roomId);
	if (!member.is_owner)
		throw new HttpError(403, "Action réservée au créateur du salon.");
	return member;
}
