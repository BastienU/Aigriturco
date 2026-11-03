// Mémorise dans le navigateur les salons rejoints (lien, nom, pseudo et clé personnelle)
const STORAGE_KEY = "aigriturco.rooms";

// Lit la liste des salons connus (vide si le stockage est indisponible)
export function getRooms()
{
	try
	{
		const rooms = JSON.parse(localStorage.getItem(STORAGE_KEY));
		return Array.isArray(rooms) ? rooms : [];
	}
	catch
	{
		return [];
	}
}

// Écrit la liste des salons connus
function setRooms(rooms)
{
	try
	{
		localStorage.setItem(STORAGE_KEY, JSON.stringify(rooms));
	}
	catch
	{
		console.warn("Stockage local indisponible : le salon ne sera pas mémorisé.");
	}
}

// Retrouve un salon par son lien
export function findRoom(token)
{
	return getRooms().find(room => room.token === token) || null;
}

// Ajoute ou met à jour un salon ; oldToken permet de suivre un lien régénéré
export function saveRoom(room, oldToken = room.token)
{
	const rooms = getRooms().filter(item => item.token !== oldToken && item.token !== room.token);
	const previous = findRoom(oldToken) || {};
	rooms.unshift({ ...previous, ...room, lastVisit: new Date().toISOString() });
	setRooms(rooms);
}

// Oublie un salon sur cet appareil
export function forgetRoom(token)
{
	setRooms(getRooms().filter(room => room.token !== token));
}
