"""Build the public website (site/index.html) from the shared app (stuco-hub.html).

stuco-hub.html is the single source for both versions:
  - published as-is, it is the claude.ai artifact;
  - wrapped by this script with Firebase, it is the website on GitHub Pages.

Run from the repo root:  python3 tools/build_site.py
"""
import hashlib
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SITE_URL = "https://marcusvance948.github.io/Atlas/"
FIREBASE = "10.12.2"
TITLE = "Avenues Student Hub"
DESCRIPTION = ("Events, sign-ups, the weekly bulletin, opportunities and Student Council news "
               "for students at Avenues The World School.")

app = (ROOT / "stuco-hub.html").read_text(encoding="utf-8")
# The artifact sets its own title and a viewer hint; the website head below replaces both.
app = re.sub(r"<title>.*?</title>\s*", "", app, count=1)
app = re.sub(r'<meta name="claude:viewport-fit-sides"[^>]*>\s*', "", app, count=1)

def ver(name):
    """Short content hash, so browsers fetch a file again whenever it changes."""
    return hashlib.sha1((ROOT / "site" / name).read_bytes()).hexdigest()[:8]

head = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>{TITLE}</title>
<meta name="description" content="{DESCRIPTION}">
<link rel="canonical" href="{SITE_URL}">
<meta property="og:type" content="website">
<meta property="og:title" content="{TITLE}">
<meta property="og:description" content="{DESCRIPTION}">
<meta property="og:url" content="{SITE_URL}">
<meta property="og:image" content="{SITE_URL}icons/icon-512.png">
<meta name="twitter:card" content="summary">
<meta name="theme-color" content="#14202E">
<link rel="icon" href="icons/favicon-32.png" type="image/png">
<link rel="manifest" href="manifest.webmanifest">
<link rel="apple-touch-icon" href="icons/apple-touch-icon.png">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="Student Hub">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<style>:root{{color-scheme:light;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}}body{{margin:0;font:14px system-ui,sans-serif}}img{{max-width:100%}}[hidden]{{display:none!important}}</style>
<link rel="preconnect" href="https://www.gstatic.com" crossorigin>
<script defer src="https://www.gstatic.com/firebasejs/{FIREBASE}/firebase-app-compat.js"></script>
<script defer src="https://www.gstatic.com/firebasejs/{FIREBASE}/firebase-auth-compat.js"></script>
<script defer src="https://www.gstatic.com/firebasejs/{FIREBASE}/firebase-firestore-compat.js"></script>
<script>window.FIREBASE_VERSION="{FIREBASE}"</script>
<script defer src="firebase-config.js?v={ver('firebase-config.js')}"></script>
<script defer src="firebase-adapter.js?v={ver('firebase-adapter.js')}"></script>
<script>if("serviceWorker"in navigator)addEventListener("load",()=>navigator.serviceWorker.register("sw.js").catch(()=>{{}}))</script>
</head>
<body>
<noscript><p style="padding:16px">Avenues Student Hub needs JavaScript. It lists events, sign-ups, the weekly bulletin, opportunities and Student Council news for Avenues The World School.</p></noscript>
"""

out = head + app.strip() + "\n</body>\n</html>\n"
(ROOT / "site" / "index.html").write_text(out, encoding="utf-8")
# installable app: manifest and a small service worker (network first, so students never get a stale page)
import json
(ROOT / "site" / "manifest.webmanifest").write_text(json.dumps({
    "name": TITLE, "short_name": "Student Hub", "description": DESCRIPTION,
    "start_url": "./#home", "scope": "./", "display": "standalone",
    "background_color": "#14202E", "theme_color": "#14202E",
    "icons": [
        {"src": "icons/icon-192.png", "sizes": "192x192", "type": "image/png"},
        {"src": "icons/icon-512.png", "sizes": "512x512", "type": "image/png"},
        {"src": "icons/maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable"}]}, indent=1), encoding="utf-8")
shell_ver = hashlib.sha1(out.encode()).hexdigest()[:10]
(ROOT / "site" / "sw.js").write_text(f"""// Student Hub service worker. Network first for the page; cached copy only when offline.
// Firebase and Google requests are never cached.
const CACHE = "hub-{shell_ver}";
const SHELL = ["./", "firebase-config.js", "firebase-adapter.js", "icons/icon-192.png"];
self.addEventListener("install", e => {{ e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); }});
self.addEventListener("activate", e => {{ e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); }});
// phone notifications from the nightly script (data-only FCM messages)
self.addEventListener("push", e => {{
  let p = {{}}; try {{ p = e.data ? e.data.json() : {{}}; }} catch (x) {{}}
  const d = p.data || p.notification || p;
  e.waitUntil(self.registration.showNotification(d.title || "Student Hub", {{ body: d.body || "", icon: "icons/icon-192.png", badge: "icons/favicon-32.png", data: {{ url: d.url || "./#home" }} }}));
}});
self.addEventListener("notificationclick", e => {{
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || "./#home", self.registration.scope).href;
  e.waitUntil(clients.matchAll({{ type: "window", includeUncontrolled: true }}).then(ws => {{ for (const w of ws) if (w.url.startsWith(self.registration.scope)) {{ w.navigate(url); return w.focus(); }} return clients.openWindow(url); }}));
}});
self.addEventListener("fetch", e => {{
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== location.origin) return;
  e.respondWith(fetch(e.request).then(r => {{ if (r.ok) {{ const c = r.clone(); caches.open(CACHE).then(x => x.put(e.request, c)); }} return r; }})
    .catch(() => caches.match(e.request, {{ ignoreSearch: true }}).then(r => r || caches.match("./"))));
}});
""", encoding="utf-8")
(ROOT / "site" / "robots.txt").write_text(f"User-agent: *\nAllow: /\n\nSitemap: {SITE_URL}sitemap.xml\n", encoding="utf-8")
(ROOT / "site" / "sitemap.xml").write_text(
    '<?xml version="1.0" encoding="UTF-8"?>\n'
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
    f"  <url><loc>{SITE_URL}</loc></url>\n</urlset>\n", encoding="utf-8")
# mistyped addresses go back to the app instead of GitHub's error page
(ROOT / "site" / "404.html").write_text(
    f'<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
    f'<title>Page not found | {TITLE}</title><meta name="robots" content="noindex"><meta http-equiv="refresh" content="0;url={SITE_URL}"></head>'
    f'<body style="font:16px system-ui,sans-serif;padding:24px"><p>That page doesn\'t exist. <a href="{SITE_URL}">Go to {TITLE}</a>.</p></body></html>\n', encoding="utf-8")
print("Built site/index.html", len(out), "bytes")
