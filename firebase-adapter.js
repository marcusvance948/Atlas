/*
  Firebase adapter for Avenues Student Hub.

  The app was first built as a Claude artifact, where claude.ai provides sign-in,
  a shared database, photo storage and downloads through window.claude.use(name).
  This file provides the same window.claude.use() interface on top of Firebase
  (Google sign-in + Cloud Firestore), so the app code runs unchanged on any web host.

  Settings live in firebase-config.js. Security is enforced by firestore.rules,
  not by this file.
*/
(function () {
  "use strict";
  const CFG = window.FIREBASE_CONFIG || {};
  const OWNER_UID = String(window.OWNER_UID || "").trim();

  if (!CFG.apiKey || !CFG.projectId || !window.firebase) {
    window.__setupMsg = "Setup isn't finished yet: add your Firebase settings to firebase-config.js.";
    return; // the app shows its offline notice
  }

  firebase.initializeApp(CFG);
  const auth = firebase.auth();
  const fs = firebase.firestore();
  try { fs.settings({ ignoreUndefinedProperties: true, merge: true }); } catch (e) {}
  // No offline persistence: with it, a second visit kept showing the cached copy and never reconnected
  // (tested 2026-11-14), and Firestore bills a fresh read after 30 minutes away anyway.

  let user = null, isOwner = false, isCouncil = false, isLeader = false;

  /* ---------- sign-in ---------- */
  window.__signIn = async () => {
    try { await auth.signInWithPopup(new firebase.auth.GoogleAuthProvider()); location.reload(); }
    catch (e) {
      if (e && e.code === "auth/popup-blocked") { auth.signInWithRedirect(new firebase.auth.GoogleAuthProvider()); return; }
      if (e && e.code !== "auth/popup-closed-by-user" && e.code !== "auth/cancelled-popup-request") alert("Sign-in didn't work: " + (e.message || e.code));
    }
  };
  window.__signOut = async () => { await auth.signOut(); location.reload(); };

  const ready = new Promise((resolve) => {
    const stop = auth.onAuthStateChanged(async (u) => {
      stop();
      user = u;
      if (u) {
        isOwner = !!OWNER_UID && u.uid === OWNER_UID;
        try {
          const c = await fs.doc("config/access").get();
          const approved = (c.exists && c.data().approved) || {};
          isCouncil = isOwner || approved[u.uid] === true;
        } catch (e) { isCouncil = isOwner; }
        // The person's own row of the student list (grade, StuCo, clubs they lead), if they are on it.
        let row = null;
        // __rosterCheck says what happened, so the site can tell "not on the list" apart from "couldn't read it" (from Nico's PR #3).
        window.__rosterCheck = { email: u.email ? u.email.toLowerCase() : "", found: false, error: "" };
        if (u.email) {
          for (let i = 0; i < 2 && !row; i++) {
            try { const r = await fs.doc("roster/" + u.email.toLowerCase()).get(); window.__rosterCheck.error = ""; if (r.exists) row = r.data(); break; }
            catch (e) { window.__rosterCheck.error = (e && e.code) || "unknown"; console.warn("Student list check failed:", e); }
          }
        }
        window.__rosterCheck.found = !!row;
        window.__rosterMe = row;
        if (row && row.council) isCouncil = true;
        isLeader = !!(row && (row.clubs || []).length);
        // Public profile (name and photo) so others see who signed up or posted.
        // The email goes in a private doc only the person and the president can read.
        fs.doc("profiles/" + u.uid).set({ name: (row && row.name) || u.displayName || "", photo: u.photoURL || "" }, { merge: true }).catch(() => {});
        if (u.email) fs.doc("private/" + u.uid).set({ email: u.email.toLowerCase() }, { merge: true }).catch(() => {});
        if (!OWNER_UID) showSetupId(u.uid);
      }
      resolve();
    });
  });

  function showSetupId(uid) {
    const box = document.createElement("div");
    box.setAttribute("role", "status");
    box.style.cssText = "position:fixed;left:16px;right:16px;bottom:16px;z-index:70;background:#14202E;color:#fff;padding:14px 16px;border-radius:4px;font:15px/1.5 'Libre Franklin',Arial,sans-serif;max-width:640px;margin:0 auto";
    box.innerHTML = '<b>One setup step left.</b> If you are the president, copy your user ID into <code>firebase-config.js</code> (OWNER_UID) and into <code>firestore.rules</code>: <code id="__uid" style="user-select:all;background:#2B3642;padding:2px 6px;border-radius:3px"></code>';
    box.querySelector("#__uid").textContent = uid;
    document.addEventListener("DOMContentLoaded", () => document.body.appendChild(box));
    if (document.body) document.body.appendChild(box);
  }

  /* ---------- database: the db capability on Firestore ---------- */
  const denied = (e) => e && (e.code === "permission-denied" || e.code === "unauthenticated");
  const toErr = (e) => ({ code: denied(e) ? "invalid_argument" : e && e.code === "resource-exhausted" ? "quota_exceeded" : "unavailable", message: (e && e.message) || "" });
  const emptyDoc = (id) => ({ id, exists: false, data: () => undefined, metadata: { fromCache: false, hasPendingWrites: false } });
  const q = (docs, md) => ({ docs, size: docs.length, empty: !docs.length, metadata: md || { fromCache: false, hasPendingWrites: false }, docChanges: () => [] });

  function docRef(path) {
    const r = fs.doc(path);
    return {
      id: r.id, path,
      get: () => r.get().catch((e) => { if (denied(e)) return emptyDoc(r.id); throw toErr(e); }),
      set: (d) => r.set(d).catch((e) => { throw toErr(e); }),
      // Claude's update merges nested objects recursively; Firestore's merge-set does the same.
      update: (d) => r.set(d, { merge: true }).catch((e) => { throw toErr(e); }),
      delete: () => r.delete().catch((e) => { throw toErr(e); }),
      onSnapshot: (next, err) => r.onSnapshot(next, (e) => { if (denied(e)) next(emptyDoc(r.id)); else err && err(toErr(e)); }),
      collection: (sub) => colRef(path + "/" + sub),
    };
  }
  function colRef(path) {
    const c = fs.collection(path);
    return {
      path,
      doc: (id) => docRef(id ? path + "/" + id : c.doc().path),
      add: async (d) => { const r = c.doc(); await r.set(d).catch((e) => { throw toErr(e); }); return docRef(r.path); },
      get: () => c.get().then((s) => q(s.docs, s.metadata)).catch((e) => { if (denied(e)) return q([]); throw toErr(e); }),
      // A collection this person can't list in full (suggestions, votes) falls back to
      // their own document, the same way the artifact returns only what they may see.
      onSnapshot: (next, err) => {
        let unsub = c.onSnapshot((s) => next(q(s.docs, s.metadata)), (e) => {
          if (!denied(e)) { err && err(toErr(e)); return; }
          if (user) unsub = fs.doc(path + "/" + user.uid).onSnapshot((d) => next(q(d.exists ? [d] : [], d.metadata)), () => next(q([])));
          else next(q([]));
        });
        return () => unsub();
      },
      where() { return this; }, orderBy() { return this; }, limit() { return this; },
    };
  }
  // A limited listen: spec = { where: [[field, op, value], ...], orderBy: [field, "asc"|"desc"], limit: n }.
  // The app uses these so each page reads only what it shows (Firestore bills per document read).
  function query(path, spec) {
    let r = fs.collection(path);
    for (const w of (spec && spec.where) || []) r = r.where(w[0], w[1], w[2]);
    if (spec && spec.orderBy) r = r.orderBy(spec.orderBy[0], spec.orderBy[1] || "asc");
    if (spec && spec.limit) r = r.limit(spec.limit);
    return {
      onSnapshot: (next, err) => r.onSnapshot((s) => next(q(s.docs, s.metadata)), (e) => { if (denied(e)) next(q([])); else err && err(toErr(e)); }),
      get: () => r.get().then((s) => q(s.docs, s.metadata)).catch((e) => { if (denied(e)) return q([]); throw toErr(e); }),
    };
  }
  const db = { doc: docRef, collection: colRef, query };

  /* ---------- phone notifications (Firebase Cloud Messaging), delivered by sw.js ---------- */
  // the messaging library loads only when someone turns notifications on or off
  const needMessaging = () => firebase.messaging ? Promise.resolve() : new Promise((ok, no) => {
    const el = document.createElement("script");
    el.src = "https://www.gstatic.com/firebasejs/" + (window.FIREBASE_VERSION || "10.12.2") + "/firebase-messaging-compat.js";
    el.onload = () => ok(); el.onerror = () => no({ code: "unsupported" }); document.head.appendChild(el);
  });
  window.__pushToken = async (vapidKey) => {
    if (!("serviceWorker" in navigator) || !("Notification" in window)) throw { code: "unsupported" };
    await needMessaging();
    if (!firebase.messaging) throw { code: "unsupported" };
    const perm = await Notification.requestPermission();
    if (perm !== "granted") throw { code: "denied" };
    const reg = await navigator.serviceWorker.ready;
    return firebase.messaging().getToken({ vapidKey, serviceWorkerRegistration: reg });
  };
  window.__pushOff = async () => { try { await needMessaging(); await firebase.messaging().deleteToken(); } catch (e) {} };

  /* ---------- people ---------- */
  const profCache = {};
  const blank = (id) => ({ id, name: "", avatarUrl: initials("?"), color: "#56606C", email: null, isMe: !!user && id === user.uid, guest: false });
  function initials(t) {
    const s = String(t || "?").trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase() || "?";
    return "data:image/svg+xml," + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#56606C"/><text x="32" y="40" font-family="Arial" font-size="24" font-weight="700" fill="#fff" text-anchor="middle">${s.replace(/[<&>]/g, "")}</text></svg>`);
  }
  const userNS = {
    isOwner: async () => isOwner,
    canEdit: async () => isCouncil,
    can: async (n) => (n === "data.write" ? !!user : n === "files.write" || n === "assets.write" ? isCouncil : false),
    id: async () => (user ? user.uid : null),
    name: async () => (user && user.displayName) || "",
    email: async () => (user && user.email) || null,
    avatarUrl: async () => (user ? user.photoURL || initials(user.displayName) : null),
    me: async () => ({
      id: user ? user.uid : null, name: (user && user.displayName) || "", email: (user && user.email) || null,
      avatarUrl: user ? user.photoURL || initials(user.displayName) : initials("?"), color: "#56606C", isOwner, canEdit: isCouncil,
    }),
    profiles: async (ids) => {
      ids = [...new Set([].concat(ids || []))];
      const out = {};
      await Promise.all(ids.map(async (id) => {
        if (!profCache[id]) {
          const p = blank(id);
          try { const d = await fs.doc("profiles/" + id).get(); if (d.exists) { p.name = d.data().name || ""; p.avatarUrl = d.data().photo || initials(p.name); } } catch (e) {}
          if (isOwner) { try { const d = await fs.doc("private/" + id).get(); if (d.exists) p.email = d.data().email || null; } catch (e) {} }
          profCache[id] = p;
        }
        out[id] = profCache[id];
      }));
      return out;
    },
    search: async () => [],
  };

  /* ---------- photos: stored in Firestore (Firebase Storage needs a paid plan) ---------- */
  const assetCache = {}, pending = {};
  const PIXEL = "data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==";
  let redraw = 0;
  window.__assetUrl = (id) => {
    if (assetCache[id]) return assetCache[id];
    if (!pending[id]) {
      pending[id] = fs.doc("photos/" + id).get().then((d) => {
        assetCache[id] = d.exists ? d.data().data : PIXEL;
        clearTimeout(redraw);
        redraw = setTimeout(() => {
          if (typeof window.render === "function") window.render();
          // the app's open-album state is a top-level `let`, reachable by name but not on window
          try { if (gal && typeof drawGallery === "function") drawGallery(); } catch (e) {}
        }, 120);
      }).catch(() => { assetCache[id] = PIXEL; });
    }
    return PIXEL;
  };
  function loadImage(blob) {
    return new Promise((res, rej) => { const u = URL.createObjectURL(blob), i = new Image(); i.onload = () => { URL.revokeObjectURL(u); res(i); }; i.onerror = () => { URL.revokeObjectURL(u); rej(new Error("decode")); }; i.src = u; });
  }
  async function toSmallDataUrl(blob) {
    const img = await loadImage(blob);
    for (const max of [1400, 1150, 950, 760]) {
      const k = Math.min(1, max / Math.max(img.width, img.height)), c = document.createElement("canvas");
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      const url = c.toDataURL("image/jpeg", 0.78);
      if (url.length < 900000) return url; // a Firestore document holds up to 1 MiB
    }
    throw { code: "too_large", message: "Image too large" };
  }
  // full image data for building slide decks (the gallery uses the cached copy when it has one)
  window.__assetData = async (id) => { if (assetCache[id] && assetCache[id] !== PIXEL) return assetCache[id]; const d = await fs.doc("photos/" + id).get(); return d.exists ? d.data().data : null; };
  const assets = {
    upload: async (blob) => {
      if (!user) throw { code: "not_granted", message: "Sign in to upload photos." };
      const url = await toSmallDataUrl(blob);
      const ref = fs.collection("photos").doc();
      await ref.set({ data: url, by: user.uid, at: new Date().toISOString() }).catch((e) => { throw toErr(e); });
      assetCache[ref.id] = url;
      return { id: ref.id, url, sizeBytes: url.length, contentType: "image/jpeg" };
    },
    list: async () => ({ assets: [], usage: {} }),
    delete: async (id) => fs.doc("photos/" + id).delete(),
  };

  /* ---------- downloads: a normal browser download ---------- */
  const downloads = {
    save: async ({ filename, data }) => {
      const b = data instanceof Blob ? data : new Blob([data]);
      const u = URL.createObjectURL(b), a = document.createElement("a");
      a.href = u; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(u), 4000);
      return { status: "saved" };
    },
  };

  window.claude = {
    use: async (name) => {
      await ready;
      if (name === "db") return db;
      if (name === "user") return userNS;
      if (name === "downloads") return downloads;
      if (name === "assets") return user ? assets : null;
      return null;
    },
  };
})();
