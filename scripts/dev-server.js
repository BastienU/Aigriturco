// Serveur de développement local : sert le site et les fonctions /api comme Vercel,
// avec une base Postgres embarquée (PGlite) stockée dans le dossier .data/
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import webpush from "web-push";
import { setDb } from "../api/_lib/db.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".svg": "image/svg+xml", ".gif": "image/gif", ".webmanifest": "application/manifest+json" };

const pg = new PGlite(process.env.DEV_DB === "memory" ? undefined : join(ROOT, ".data"));

// Reproduit l'API « tagged template » du driver Neon au-dessus de PGlite
function sql(strings, ...values)
{
	const text = strings.reduce((query, part, i) => query + `$${i}` + part);
	return pg.query(text, values).then(result => result.rows);
}

setDb(sql);

// En local, sans clés VAPID définies, on en génère des temporaires pour tester les notifications
if (!process.env.VAPID_PUBLIC_KEY)
{
	const keys = webpush.generateVAPIDKeys();
	process.env.VAPID_PUBLIC_KEY = keys.publicKey;
	process.env.VAPID_PRIVATE_KEY = keys.privateKey;
}

// Ajoute à req/res les helpers fournis par Vercel (req.query, req.body, res.status, res.json)
async function withHelpers(req, res, url)
{
	req.query = Object.fromEntries(url.searchParams);
	let raw = "";
	for await (const chunk of req)
		raw += chunk;
	try
	{
		req.body = raw ? JSON.parse(raw) : undefined;
	}
	catch
	{
		req.body = undefined;
	}
	res.status = code =>
	{
		res.statusCode = code;
		return res;
	};
	res.json = data =>
	{
		res.setHeader("Content-Type", "application/json");
		res.end(JSON.stringify(data));
	};
}

// Appelle la fonction /api correspondante
async function serveApi(req, res, url)
{
	const name = url.pathname.slice(5).replace(/\/$/, "");
	if (!/^[a-z]+$/.test(name))
		return notFound(res);
	try
	{
		const module = await import(`../api/${name}.js`);
		await withHelpers(req, res, url);
		await module.default(req, res);
	}
	catch (error)
	{
		if (error.code === "ERR_MODULE_NOT_FOUND")
			return notFound(res);
		throw error;
	}
}

// Sert un fichier statique du projet
async function serveStatic(res, url)
{
	const path = normalize(decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname));
	if (path.includes("..") || /^\/(api|scripts|node_modules|\.)/.test(path))
		return notFound(res);
	try
	{
		const content = await readFile(join(ROOT, path));
		res.setHeader("Content-Type", TYPES[extname(path)] || "application/octet-stream");
		res.end(content);
	}
	catch
	{
		notFound(res);
	}
}

// Répond 404
function notFound(res)
{
	res.statusCode = 404;
	res.end("Not found");
}

createServer(async (req, res) =>
{
	const url = new URL(req.url, `http://${req.headers.host}`);
	try
	{
		if (url.pathname.startsWith("/api/"))
			await serveApi(req, res, url);
		else
			await serveStatic(res, url);
	}
	catch (error)
	{
		console.error(error);
		res.statusCode = 500;
		res.end("Erreur serveur");
	}
}).listen(PORT, () => console.log(`Site disponible sur http://localhost:${PORT}`));
