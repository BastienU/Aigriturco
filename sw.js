// Service worker : reçoit les notifications push et ouvre le bon salon au clic

// Active immédiatement la nouvelle version du service worker
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", event => event.waitUntil(self.clients.claim()));

// Affiche la notification envoyée par le serveur
self.addEventListener("push", event =>
{
	let data = {};
	try
	{
		data = event.data ? event.data.json() : {};
	}
	catch
	{
		data = { body: event.data?.text() };
	}
	event.waitUntil(self.registration.showNotification(data.title || "Humeur du jour", {
		body: data.body || "",
		tag: data.tag,
		renotify: Boolean(data.tag),
		icon: "/icons/icon-192.png",
		badge: "/icons/badge-96.png",
		data: { url: data.url || "/" }
	}));
});

// Au clic, met au premier plan l'onglet du salon s'il est ouvert, sinon l'ouvre
self.addEventListener("notificationclick", event =>
{
	event.notification.close();
	const url = new URL(event.notification.data?.url || "/", self.location.origin).href;
	event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(windows =>
	{
		const existing = windows.find(client => client.url === url);
		if (existing)
			return existing.focus();
		return self.clients.openWindow(url);
	}));
});
