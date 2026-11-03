import webpush from "web-push";
import { db } from "./db.js";
import { MOODS } from "../../js/mood.js";

let configured = false;

// Indique si les clés VAPID sont configurées (variables d'environnement Vercel)
export function pushEnabled()
{
	return Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
}

// Configure web-push une seule fois avec les clés VAPID
function configure()
{
	if (configured)
		return;
	webpush.setVapidDetails(process.env.VAPID_SUBJECT || "mailto:contact@example.com", process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);
	configured = true;
}

// Envoie une notification « nouvel article » à tous les autres membres abonnés du salon
export async function notifyNewEntry(room, author, entry)
{
	if (!pushEnabled())
		return;
	configure();
	const subscriptions = await db()`
		SELECT s.id, s.endpoint, s.p256dh, s.auth
		FROM push_subscriptions s JOIN members m ON m.id = s.member_id
		WHERE m.room_id = ${room.id} AND m.id <> ${author.id}`;
	if (!subscriptions.length)
		return;

	const mood = MOODS[entry.mood];
	const snippet = entry.anecdote.length > 120 ? entry.anecdote.slice(0, 117) + "…" : entry.anecdote;
	const payload = JSON.stringify({
		title: `${author.pseudo} · ${mood.emoji} ${mood.label}`,
		body: snippet || `Nouvel article dans ${room.name}`,
		tag: `salon-${room.token}`,
		url: `/?salon=${encodeURIComponent(room.token)}`
	});

	const results = await Promise.allSettled(subscriptions.map(sub =>
		webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, payload, { TTL: 86400 })
	));

	// 404 / 410 : l'abonnement n'existe plus (notifications désactivées, appli désinstallée…), on le supprime
	const expired = subscriptions.filter((sub, i) => [404, 410].includes(results[i].reason?.statusCode)).map(sub => sub.id);
	for (const id of expired)
		await db()`DELETE FROM push_subscriptions WHERE id = ${id}`;
	results.forEach((result, i) =>
	{
		if (result.status === "rejected" && !expired.includes(subscriptions[i].id))
			console.warn("Notification non envoyée :", result.reason?.statusCode, result.reason?.body || result.reason?.message);
	});
}
