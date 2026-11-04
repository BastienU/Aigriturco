import { db } from "./db.js";

// Regroupe des lignes de réactions par article puis par humeur : Map(entryId → [{ mood, members: [{ id, pseudo }] }])
export async function listReactions(query)
{
	const rows = await query;
	const byEntry = new Map();
	rows.forEach(row =>
	{
		if (!byEntry.has(row.entry_id))
			byEntry.set(row.entry_id, new Map());
		const byMood = byEntry.get(row.entry_id);
		if (!byMood.has(row.mood))
			byMood.set(row.mood, []);
		byMood.get(row.mood).push({ id: row.member_id, pseudo: row.pseudo });
	});
	return new Map([...byEntry].map(([entryId, byMood]) => [entryId, [...byMood].map(([mood, members]) => ({ mood, members }))]));
}

// Renvoie les réactions d'un seul article
export async function entryReactions(entryId)
{
	const reactions = await listReactions(db()`
		SELECT r.entry_id, r.mood, r.member_id, m.pseudo
		FROM entry_reactions r JOIN members m ON m.id = r.member_id
		WHERE r.entry_id = ${entryId}
		ORDER BY r.created_at`);
	return reactions.get(entryId) || [];
}
