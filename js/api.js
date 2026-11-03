// Erreur renvoyée par l'API, avec son code HTTP
export class ApiError extends Error
{
	constructor(status, message)
	{
		super(message);
		this.status = status;
	}
}

// Appelle une fonction /api en JSON, avec la clé du membre si elle est connue
export async function request(method, path, { query, body, memberKey } = {})
{
	const url = new URL(`/api/${path}`, location.origin);
	for (const [key, value] of Object.entries(query || {}))
		url.searchParams.set(key, value);
	const headers = {};
	if (body)
		headers["Content-Type"] = "application/json";
	if (memberKey)
		headers["X-Member-Key"] = memberKey;

	let response;
	try
	{
		response = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
	}
	catch
	{
		throw new ApiError(0, "Connexion impossible. Vérifie ta connexion internet.");
	}
	const data = await response.json().catch(() => ({}));
	if (!response.ok)
		throw new ApiError(response.status, data.error || `Erreur ${response.status}`);
	return data;
}
