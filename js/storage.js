const DB_NAME = "humeur-du-jour";
const DB_VERSION = 1;
let dbPromise = null;

// Ouvre (ou crée au premier lancement) la base IndexedDB du navigateur
function openDb()
{
	if (dbPromise)
		return dbPromise;
	dbPromise = new Promise((resolve, reject) =>
	{
		const request = indexedDB.open(DB_NAME, DB_VERSION);
		request.onupgradeneeded = () =>
		{
			const db = request.result;
			const entries = db.createObjectStore("entries", { keyPath: "id" });
			entries.createIndex("date", "date");
			db.createObjectStore("photos", { keyPath: "id" });
		};
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error);
	});
	return dbPromise;
}

// Exécute une opération dans une transaction et renvoie son résultat une fois validée
async function run(storeName, mode, operation)
{
	const db = await openDb();
	return new Promise((resolve, reject) =>
	{
		const tx = db.transaction(storeName, mode);
		const request = operation(tx.objectStore(storeName));
		tx.oncomplete = () => resolve(request?.result);
		tx.onerror = () => reject(tx.error);
	});
}

// Enregistre (ou remplace) une entrée du journal
export function saveEntry(entry)
{
	return run("entries", "readwrite", store => store.put(entry));
}

// Supprime une entrée du journal
export function deleteEntry(id)
{
	return run("entries", "readwrite", store => store.delete(id));
}

// Renvoie les entrées d'une date donnée (AAAA-MM-JJ)
export function getEntriesByDate(date)
{
	return run("entries", "readonly", store => store.index("date").getAll(date));
}

// Renvoie toutes les entrées du journal
export function getAllEntries()
{
	return run("entries", "readonly", store => store.getAll());
}

// Enregistre (ou met à jour) une photo et ses étiquettes
export function savePhoto(photo)
{
	return run("photos", "readwrite", store => store.put(photo));
}

// Supprime une photo
export function deletePhoto(id)
{
	return run("photos", "readwrite", store => store.delete(id));
}

// Renvoie toutes les photos
export function getAllPhotos()
{
	return run("photos", "readonly", store => store.getAll());
}

// Insère plusieurs éléments d'un coup (utilisé pour l'import d'une sauvegarde)
export function putMany(storeName, items)
{
	return run(storeName, "readwrite", store =>
	{
		items.forEach(item => store.put(item));
	});
}
