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
}
