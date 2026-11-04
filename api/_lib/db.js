import { neon } from "@neondatabase/serverless";

let sql = null;
let schemaReady = null;

// Renvoie le client SQL (créé une seule fois par instance de fonction)
export function db()
{
	if (sql)
		return sql;
	const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
	if (!url)
		throw new Error("DATABASE_URL manquante : relie la base Neon au projet Vercel.");
	sql = neon(url);
	return sql;
}

// Remplace le client SQL (utilisé par le serveur de développement local)
export function setDb(client)
{
	sql = client;
	schemaReady = null;
}

// Crée les tables si elles n'existent pas encore (une fois par démarrage à froid)
export function ensureSchema()
{
	if (!schemaReady)
	{
		schemaReady = createSchema().catch(error =>
		{
			schemaReady = null;
			throw error;
		});
	}
	return schemaReady;
}

// Exécute les requêtes de création des tables et index
async function createSchema()
{
	const sql = db();
	await sql`CREATE TABLE IF NOT EXISTS rooms (
		id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
		token text NOT NULL UNIQUE,
		name text NOT NULL,
		expires_at date,
		created_at timestamptz NOT NULL DEFAULT now()
	)`;
	await sql`CREATE TABLE IF NOT EXISTS members (
		id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
		room_id uuid NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
		pseudo text NOT NULL,
		key_hash text NOT NULL UNIQUE,
		is_owner boolean NOT NULL DEFAULT false,
		created_at timestamptz NOT NULL DEFAULT now()
	)`;
	await sql`CREATE UNIQUE INDEX IF NOT EXISTS members_room_pseudo ON members (room_id, lower(pseudo))`;
	await sql`CREATE TABLE IF NOT EXISTS entries (
		id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
		room_id uuid NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
		member_id uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
		day date NOT NULL,
		mood text NOT NULL,
		anecdote text NOT NULL DEFAULT '',
		created_at timestamptz NOT NULL DEFAULT now()
	)`;
	await sql`CREATE INDEX IF NOT EXISTS entries_room_day ON entries (room_id, day)`;

	// v2 : code secret pour reprendre son pseudo, plusieurs clés (appareils) par membre, notifications
	await sql`ALTER TABLE members ADD COLUMN IF NOT EXISTS code_hash text`;
	await sql`ALTER TABLE members ADD COLUMN IF NOT EXISTS failed_attempts integer NOT NULL DEFAULT 0`;
	await sql`ALTER TABLE members ADD COLUMN IF NOT EXISTS locked_until timestamptz`;
	await sql`ALTER TABLE members ALTER COLUMN key_hash DROP NOT NULL`;
	await sql`CREATE TABLE IF NOT EXISTS member_keys (
		key_hash text PRIMARY KEY,
		member_id uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
		created_at timestamptz NOT NULL DEFAULT now()
	)`;
	await sql`INSERT INTO member_keys (key_hash, member_id) SELECT key_hash, id FROM members WHERE key_hash IS NOT NULL ON CONFLICT DO NOTHING`;
	await sql`CREATE TABLE IF NOT EXISTS push_subscriptions (
		id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
		member_id uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
		endpoint text NOT NULL,
		p256dh text NOT NULL,
		auth text NOT NULL,
		created_at timestamptz NOT NULL DEFAULT now(),
		UNIQUE (member_id, endpoint)
	)`;

	// v3 : humeurs propres à chaque salon, proposées par les membres et validées par le créateur
	await sql`CREATE TABLE IF NOT EXISTS room_moods (
		id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
		room_id uuid NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
		label text NOT NULL,
		emoji text NOT NULL,
		color text NOT NULL,
		valence real NOT NULL,
		energy real NOT NULL,
		status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'archived')),
		proposed_by uuid REFERENCES members(id) ON DELETE SET NULL,
		created_at timestamptz NOT NULL DEFAULT now()
	)`;
	await sql`CREATE UNIQUE INDEX IF NOT EXISTS room_moods_label ON room_moods (room_id, lower(label))`;

	// v4 : réactions des membres aux articles (une humeur du salon par réaction)
	await sql`CREATE TABLE IF NOT EXISTS entry_reactions (
		entry_id uuid NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
		member_id uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
		mood text NOT NULL,
		created_at timestamptz NOT NULL DEFAULT now(),
		PRIMARY KEY (entry_id, member_id, mood)
	)`;
}
