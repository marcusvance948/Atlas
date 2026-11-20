// Student Hub service worker. Network first for the page; cached copy only when offline.
// Firebase and Google requests are never cached.
const CACHE = "hub-276a8c18f3";
const SHELL = ["./", "firebase-config.js", "firebase-adapter.js", "icons/icon-192.png"];
self.addEventListener("install", e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
// phone notifications from the nightly script (data-only FCM messages)
self.addEventListener("push", e => {
  let p = {}; try { p = e.data ? e.data.json() : {}; } catch (x) {}
  const d = p.data || p.notification || p;
  e.waitUntil(self.registration.showNotification(d.title || "Student Hub", { body: d.body || "", icon: "icons/icon-192.png", badge: "icons/favicon-32.png", data: { url: d.url || "./#home" } }));
});
self.addEventListener("notificationclick", e => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || "./#home", self.registration.scope).href;
  e.waitUntil(clients.matchAll({ type: "window", includeUncontrolled: true }).then(ws => { for (const w of ws) if (w.url.startsWith(self.registration.scope)) { w.navigate(url); return w.focus(); } return clients.openWindow(url); }));
});
self.addEventListener("fetch", e => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== location.origin) return;
  e.respondWith(fetch(e.request).then(r => { if (r.ok) { const c = r.clone(); caches.open(CACHE).then(x => x.put(e.request, c)); } return r; })
    .catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match("./"))));
});
