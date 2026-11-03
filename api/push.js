import { db } from "./_lib/db.js";
import { HttpError, handler, findRoom, requireMember } from "./_lib/http.js";
import { pushEnabled } from "./_lib/push.js";

// GET /api/push : clé publique VAPID nécessaire au navigateur pour s'abonner
function getConfig()
{
	return { enabled: pushEnabled(), publicKey: process.env.VAPID_PUBLIC_KEY || null };
}

// Vérifie le format d'un abonnement envoyé par le navigateur
function cleanSubscription(value)
{
	const { endpoint, keys } = value || {};
	if (typeof endpoint !== "string" || !endpoint.startsWith("https://") || typeof keys?.p256dh !== "string" || typeof keys?.auth !== "string")
		throw new HttpError(400, "Abonnement invalide.");
	return { endpoint, p256dh: keys.p256dh, auth: keys.auth };
}

// POST /api/push : enregistre l'abonnement de cet appareil pour le salon
async function subscribe(req)
{
	if (!pushEnabled())
		throw new HttpError(503, "Les notifications ne sont pas configurées sur le serveur.");
	const room = await findRoom(req.body?.salon);
	const member = await requireMember(req, room.id);
	const sub = cleanSubscription(req.body?.subscription);
	await db()`
		INSERT INTO push_subscriptions (member_id, endpoint, p256dh, auth)
		VALUES (${member.id}, ${sub.endpoint}, ${sub.p256dh}, ${sub.auth})
		ON CONFLICT (member_id, endpoint) DO UPDATE SET p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth`;
	return { status: 201, body: { subscribed: true } };
}

// DELETE /api/push?salon=…&endpoint=… : désabonne cet appareil pour le salon
async function unsubscribe(req)
{
	const room = await findRoom(req.query.salon);
	const member = await requireMember(req, room.id);
	const endpoint = req.query.endpoint;
	if (typeof endpoint !== "string")
		throw new HttpError(400, "Abonnement invalide.");
	await db()`DELETE FROM push_subscriptions WHERE member_id = ${member.id} AND endpoint = ${endpoint}`;
	return { subscribed: false };
}

export default handler({ GET: getConfig, POST: subscribe, DELETE: unsubscribe });
