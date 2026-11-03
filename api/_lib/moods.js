import { db } from "./db.js";
import { MOODS } from "../../js/mood.js";

const CUSTOM_PREFIX = "c:";

// Met en forme une humeur personnalisée pour la réponse JSON
function toMood(row)
{
	return {
		id: row.id,
		key: CUSTOM_PREFIX + row.id,
		label: row.label,
		emoji: row.emoji,
		color: row.color,
		valence: row.valence,
		energy: row.energy,
		status: row.status,
		proposedBy: row.proposed_by ? { id: row.proposed_by, pseudo: row.pseudo } : null,
		usage: row.usage
	};
}

// Liste les humeurs personnalisées d'un salon (avec auteur de la proposition et nombre d'articles qui l'utilisent)
export async function listRoomMoods(roomId)
{
	const rows = await db()`
		SELECT r.id, r.label, r.emoji, r.color, r.valence, r.energy, r.status, r.proposed_by, m.pseudo,
			(SELECT count(*) FROM entries e WHERE e.room_id = r.room_id AND e.mood = ${CUSTOM_PREFIX}::text || r.id::text)::int AS usage
		FROM room_moods r LEFT JOIN members m ON m.id = r.proposed_by
		WHERE r.room_id = ${roomId}
		ORDER BY r.created_at`;
	return rows.map(toMood);
}

// Retrouve une humeur (de base ou personnalisée du salon) à partir de sa clé ; onlyApproved exclut les propositions et archives
export async function findMood(roomId, key, { onlyApproved = false } = {})
{
	if (MOODS[key])
		return MOODS[key];
	if (typeof key !== "string" || !key.startsWith(CUSTOM_PREFIX))
		return null;
	const id = key.slice(CUSTOM_PREFIX.length);
	if (!/^[0-9a-f-]{36}$/i.test(id))
		return null;
	const [row] = await db()`SELECT label, emoji, color, valence, energy, status FROM room_moods WHERE id = ${id} AND room_id = ${roomId}`;
	if (!row || (onlyApproved && row.status !== "approved"))
		return null;
	return row;
}
