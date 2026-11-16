/**
 * Avenues Student Hub: nightly jobs. Runs on its own every hour and does what's due:
 *   05:00  settle yesterday's games (points, streak bonuses), then rewrite the summary (scores/_stats)
 *   07:00  morning phone notification (today's game, your streak, yesterday's points)
 *   12:00, 16:00  rewrite the summary so like, sign-up and reply counts stay fresh
 *   Sunday 17:00  weekly email digest to students who turned it on
 *   06:00  "Home games this week" bulletin post from the Aviators athletics schedule (varsity home games)
 * It signs in to Firestore as the Google account that runs it, so that account must be an Owner or Editor
 * of the Firebase project. No keys are stored anywhere. Set up once: paste Code.gs and appsscript.json,
 * run setup(), allow access. See README.md.
 * The scoring rules here mirror settleGames() in stuco-hub.html. If you change one, change both.
 */
var PROJECT_ID = "atlas-bae05";
var TZ = "America/New_York";
var SITE_URL = "https://marcusvance948.github.io/Atlas/";
var STATS_HOURS = [5, 12, 16];
var PUSH_HOUR = 7;
var DIGEST = { day: 0, hour: 17, capPerRun: 90 };   // Sunday; Gmail accounts can send to about 100 people a day
var STREAK_BONUS = 5;
var GRADES = ["9", "10", "11", "12"];
var GAMES_HOUR = 6;
var ATHLETICS_URL = "https://storage.googleapis.com/avenues-athletics-data/schedule.json";

/* ---------------- schedule ---------------- */
function setup() {
  ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger("tick").timeBased().everyHours(1).create();
  var r = runNow();
  Logger.log("Set up. First run: " + JSON.stringify(r));
}
function tick() {
  var now = new Date(), h = +Utilities.formatDate(now, TZ, "H"), dow = +Utilities.formatDate(now, TZ, "u") % 7, out = {};
  if (h === 5) out.settle = settle();
  if (STATS_HOURS.indexOf(h) >= 0) out.stats = writeStats();
  if (h === GAMES_HOUR) out.games = homeGames();
  if (h === PUSH_HOUR) out.push = morningPush();
  // Sunday evening, then Monday and Tuesday for anyone the daily email limit left out
  if (h === DIGEST.hour && [DIGEST.day, (DIGEST.day + 1) % 7, (DIGEST.day + 2) % 7].indexOf(dow) >= 0) out.digest = weeklyDigest();
  if (Object.keys(out).length) Logger.log(JSON.stringify(out));
}
/** Run everything except notifications and email right now (safe to run any time). */
function runNow() { return { settle: settle(), stats: writeStats(), games: homeGames() }; }

/* ---------------- dates ---------------- */
function today_() { return Utilities.formatDate(new Date(), TZ, "yyyy-MM-dd"); }
function parse_(s) { var p = String(s).split("-"); return new Date(+p[0], +p[1] - 1, +p[2]); }
function iso_(d) { return d.getFullYear() + "-" + pad_(d.getMonth() + 1) + "-" + pad_(d.getDate()); }
function pad_(n) { return (n < 10 ? "0" : "") + n; }
function addDays_(s, n) { var d = parse_(s); d.setDate(d.getDate() + n); return iso_(d); }
function weekStart_(s) { var d = parse_(s); return addDays_(s, -((d.getDay() + 6) % 7)); }

/* ---------------- Firestore REST ---------------- */
var BASE = "https://firestore.googleapis.com/v1/projects/" + PROJECT_ID + "/databases/(default)/documents";
function call_(method, url, body) {
  var res = UrlFetchApp.fetch(url, { method: method, contentType: "application/json", muteHttpExceptions: true,
    headers: { Authorization: "Bearer " + ScriptApp.getOAuthToken() }, payload: body ? JSON.stringify(body) : undefined });
  var code = res.getResponseCode(), text = res.getContentText();
  if (code === 404) return null;
  if (code >= 300) throw new Error(method + " " + url.replace(BASE, "") + " -> " + code + ": " + text.slice(0, 300));
  return text ? JSON.parse(text) : {};
}
function dec_(v) {
  if (!v) return null;
  if ("stringValue" in v) return v.stringValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return Number(v.doubleValue);
  if ("booleanValue" in v) return v.booleanValue;
  if ("nullValue" in v) return null;
  if ("timestampValue" in v) return v.timestampValue;
  if ("arrayValue" in v) return (v.arrayValue.values || []).map(dec_);
  if ("mapValue" in v) return decFields_(v.mapValue.fields || {});
  return null;
}
function decFields_(f) { var o = {}; Object.keys(f || {}).forEach(function (k) { o[k] = dec_(f[k]); }); return o; }
function enc_(x) {
  if (x === null || x === undefined) return { nullValue: null };
  if (typeof x === "boolean") return { booleanValue: x };
  if (typeof x === "number") return Number.isInteger(x) ? { integerValue: String(x) } : { doubleValue: x };
  if (typeof x === "string") return { stringValue: x };
  if (Array.isArray(x)) return { arrayValue: { values: x.map(enc_) } };
  var f = {}; Object.keys(x).forEach(function (k) { if (x[k] !== undefined) f[k] = enc_(x[k]); }); return { mapValue: { fields: f } };
}
function docName_(path) { return "projects/" + PROJECT_ID + "/databases/(default)/documents/" + path; }
/** Every document in a collection, as [{id, ...fields}]. */
function list_(col) {
  var out = [], token = "";
  do {
    var r = call_("get", BASE + "/" + col + "?pageSize=300" + (token ? "&pageToken=" + encodeURIComponent(token) : "")) || {};
    (r.documents || []).forEach(function (d) { var o = decFields_(d.fields); o.id = d.name.split("/").pop(); out.push(o); });
    token = r.nextPageToken || "";
  } while (token);
  return out;
}
/** Field paths with characters like "-" need backticks. */
function fp_(parts) { return parts.map(function (p) { return /^[A-Za-z_][A-Za-z_0-9]*$/.test(p) ? p : "`" + String(p).replace(/[`\\]/g, "\\$&") + "`"; }).join("."); }
/** Merge: only the given field paths change; the doc is created if missing. */
function mergeWrite_(path, data, paths) { return { update: { name: docName_(path), fields: enc_(data).mapValue.fields }, updateMask: { fieldPaths: paths } }; }
function replaceWrite_(path, data) { return { update: { name: docName_(path), fields: enc_(data).mapValue.fields } }; }
function commit_(writes) { for (var i = 0; i < writes.length; i += 400) call_("post", BASE + ":commit", { writes: writes.slice(i, i + 400) }); }

/* ---------------- scoring helpers (mirror the site) ---------------- */
function gnorm_(t) { return String(t || "").toLowerCase().replace(/[^a-z0-9]/g, ""); }
function gh_(gid, t) {
  var b = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, gid + ":" + gnorm_(t), Utilities.Charset.UTF_8);
  return b.slice(0, 12).map(function (x) { var n = (x + 256) % 256; return (n < 16 ? "0" : "") + n.toString(16); }).join("");
}
function gameName_(g) { return g.title || ({ versus: "This or That", photo: "Photo challenge", quiz: "Mystery", connections: "Avenues Connections" })[g.type] || "Daily game"; }
function ptsOf_(d) { var t = 0; Object.keys((d && d.log) || {}).forEach(function (k) { t += Number((d.log[k] || {}).p) || 0; }); return t; }
function played_(uid, g, byVotes, byPlays) {
  var v = (((byVotes[uid] || {}).v) || {})[g.id] || {};
  if (v.pick || v.vote || (v.photo && !v.removed)) return true;
  var st = (((byPlays[uid] || {}).g) || {})[g.id];
  return !!st && !!(Object.keys(st.r || {}).length || (st.s || []).length || st.m);
}
function streakAt_(uid, date, games, byVotes, byPlays) {
  var n = 0;
  for (var i = 0; i < games.length; i++) { var g = games[i]; if (g.id > date) continue; if (played_(uid, g, byVotes, byPlays)) n++; else break; }
  return n;
}
function byId_(arr) { var o = {}; arr.forEach(function (d) { o[d.id] = d; }); return o; }
function realGames_(games) { return games.filter(function (g) { return /^\d{4}-\d\d-\d\d$/.test(g.id); }).sort(function (a, b) { return b.id < a.id ? -1 : b.id > a.id ? 1 : 0; }); }

/* ---------------- 1. settle finished games ---------------- */
function settle() {
  var TODAY = today_(), games = list_("games"), due = games.filter(function (g) { return g.date && g.date < TODAY && !g.awarded && /^\d{4}-\d\d-\d\d$/.test(g.id); });
  if (!due.length) return "nothing to settle";
  due.sort(function (a, b) { return a.id < b.id ? -1 : 1; });
  var votes = list_("gamevotes"), plays = list_("plays"), keys = byId_(list_("gamekeys")), byVotes = byId_(votes), byPlays = byId_(plays), all = realGames_(games);
  var awards = {}, writes = [];
  function award(uid, d, key, p, why, date) { var a = awards[uid] || (awards[uid] = { name: d.name || "Student", grade: d.grade || "", log: {} }); a.log[key] = { p: p, why: why, d: date }; }
  due.forEach(function (g) {
    var pts = Number(g.points) || 10, result = g.result || null, wins = {};
    if (g.type === "versus") {
      var a = 0, b = 0; votes.forEach(function (d) { var p = (((d.v || {})[g.id]) || {}).pick; if (p === "a") a++; else if (p === "b") b++; });
      result = result || { a: a, b: b, win: a === b ? "tie" : a > b ? "a" : "b" };
      votes.forEach(function (d) { var p = (((d.v || {})[g.id]) || {}).pick; if (p && (result.win === "tie" || p === result.win)) wins[d.id] = { p: pts, d: d }; });
    } else if (g.type === "photo") {
      var es = votes.map(function (d) { var v = ((d.v || {})[g.id]) || {}; return { uid: d.id, name: d.name, grade: d.grade, photo: v.photo, removed: v.removed, at: v.at || "" }; }).filter(function (x) { return x.photo && !x.removed; });
      var tally = {}; votes.forEach(function (d) { var v = (((d.v || {})[g.id]) || {}).vote; if (v) tally[v] = (tally[v] || 0) + 1; });
      es.sort(function (x, y) { return (tally[y.uid] || 0) - (tally[x.uid] || 0) || (x.at < y.at ? -1 : x.at > y.at ? 1 : 0); });
      if (!result) result = es.length ? { winner: es[0].uid, name: es[0].name || "", grade: es[0].grade || "", photo: es[0].photo, votes: tally[es[0].uid] || 0, entries: es.length, all: es.slice(0, 8).map(function (e) { return e.photo; }) } : { none: true };
      es.forEach(function (e) { wins[e.uid] = { p: e.uid === result.winner ? pts * 5 : pts, d: e }; });
    } else {
      var solved = 0, playedN = 0;
      plays.forEach(function (d) {
        var st = ((d.g || {})[g.id]); if (!st) return; playedN++; var n = 0;
        if (g.type === "quiz") {
          Object.keys(st.r || {}).forEach(function (i) { var r = st.r[i], it = (g.items || [])[i]; if (it && r && r.t && (it.h || []).indexOf(gh_(g.id, r.t)) >= 0) n++; });
          if (n && n === (g.items || []).length) solved++;
        } else {
          (st.s || []).forEach(function (x) { var h = gh_(g.id, (x.w || []).map(gnorm_).sort().join("")); if ((g.groups || []).some(function (q) { return q.h === h; })) n++; });
          if (n >= 4) solved++;
        }
        if (n) wins[d.id] = { p: n * pts, d: d };
      });
      result = { solved: solved, played: playedN, answers: (keys[g.id] || {}).answers || "" };
    }
    Object.keys(wins).forEach(function (uid) { award(uid, wins[uid].d, "g" + g.id, wins[uid].p, gameName_(g), g.date); });
    // streak bonus: every 5th game day in a row someone plays
    var who = {};
    votes.forEach(function (d) { var v = ((d.v || {})[g.id]) || {}; if (v.pick || v.vote || (v.photo && !v.removed)) who[d.id] = d; });
    plays.forEach(function (d) { var st = (d.g || {})[g.id]; if (st && (Object.keys(st.r || {}).length || (st.s || []).length || st.m)) who[d.id] = d; });
    Object.keys(who).forEach(function (uid) { var n = streakAt_(uid, g.id, all, byVotes, byPlays); if (n && n % STREAK_BONUS === 0) award(uid, who[uid], "s" + g.id, STREAK_BONUS, n + "-day streak", g.date); });
    writes.push(mergeWrite_("games/" + g.id, { awarded: true, result: result }, ["awarded", "result"]));
  });
  Object.keys(awards).forEach(function (uid) {
    var a = awards[uid], paths = ["name", "grade"].concat(Object.keys(a.log).map(function (k) { return fp_(["log", k]); }));
    writes.unshift(mergeWrite_("scores/" + uid, a, paths));   // points first, then mark the games awarded
  });
  commit_(writes);
  return "settled " + due.map(function (g) { return g.id; }).join(", ") + " for " + Object.keys(awards).length + " students";
}

/* ---------------- 2. summary document (scores/_stats) ---------------- */
function logDate_(k, x, chal, pred) {
  if (x && x.d) return x.d;
  if (/^[gs]\d{4}-\d\d-\d\d$/.test(k)) return k.slice(1);
  if (/^b[0-9a-z]+$/.test(k)) { var t = parseInt(k.slice(1), 36); if (t > 1.5e12 && t < 4e12) return Utilities.formatDate(new Date(t), TZ, "yyyy-MM-dd"); }
  if (chal[k]) return chal[k].date || null;
  if (pred[k]) return String(pred[k].closes || pred[k].created || "").slice(0, 10) || null;
  return null;
}
function writeStats() {
  var TODAY = today_(), signups = list_("signups"), replies = list_("replies"), posts = list_("posts"), scores = list_("scores");
  var chal = byId_(list_("challenges")), pred = byId_(list_("predictions"));
  var hearts = {}, sign = {}, rep = {}, notes = {}, owner = {};
  signups.forEach(function (d) { Object.keys(d.hearts || {}).forEach(function (k) { if (d.hearts[k]) hearts[k] = (hearts[k] || 0) + 1; }); Object.keys(d.events || {}).forEach(function (k) { sign[k] = (sign[k] || 0) + 1; }); });
  posts.forEach(function (p) { if (p.by) owner[p.id] = p.by; });
  replies.forEach(function (d) { Object.keys(d.items || {}).forEach(function (k) { var v = d.items[k]; if (!v || !v.postId) return; rep[v.postId] = (rep[v.postId] || 0) + 1; var o = owner[v.postId]; if (o && o !== d.id) (notes[o] = notes[o] || []).push({ postId: v.postId, name: v.name || "", text: String(v.text || "").slice(0, 120), at: v.at || "" }); }); });
  Object.keys(notes).forEach(function (o) { notes[o] = notes[o].sort(function (a, b) { return b.at < a.at ? -1 : 1; }).slice(0, 8); });
  var docs = scores.filter(function (d) { return d.id.charAt(0) !== "_"; }), grades = {};
  GRADES.forEach(function (g) { grades[g] = 0; });
  docs.forEach(function (d) { if (grades[d.grade] != null) grades[d.grade] += ptsOf_(d); });
  var people = docs.filter(function (d) { return !d.team; });
  var players = people.map(function (d) { return { id: d.id, name: d.name || "", grade: d.grade || "", pts: ptsOf_(d) }; }).filter(function (d) { return d.pts > 0; }).sort(function (a, b) { return b.pts - a.pts; }).slice(0, 15);
  function week(ws) {
    var we = addDays_(ws, 6);
    var rank = people.map(function (d) { var t = 0; Object.keys(d.log || {}).forEach(function (k) { var dt = logDate_(k, d.log[k], chal, pred); if (dt && dt >= ws && dt <= we) t += Number((d.log[k] || {}).p) || 0; }); return { id: d.id, name: d.name || "", grade: d.grade || "", pts: t }; })
      .filter(function (d) { return d.pts > 0; }).sort(function (a, b) { return b.pts - a.pts || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0); });
    return { ws: ws, rank: rank };
  }
  var ws = weekStart_(TODAY), last = week(addDays_(ws, -7));
  var data = { hearts: hearts, signups: sign, replies: rep, replyNotes: notes, grades: grades, players: players, week: week(ws), lastWeek: { ws: last.ws, rank: last.rank.slice(0, 3) }, at: new Date().toISOString(), by: "nightly" };
  commit_([replaceWrite_("scores/_stats", data)]);
  return "summary written (" + players.length + " players, " + data.week.rank.length + " this week)";
}

/* ---------------- 3. morning phone notification ---------------- */
function morningPush() {
  var TODAY = today_(), games = list_("games"), g = games.filter(function (x) { return x.id === TODAY; })[0];
  var mine = list_("mine").filter(function (d) { return d.push && d.push.token; });
  if (!mine.length) return "no one has notifications on";
  var votes = byId_(list_("gamevotes")), plays = byId_(list_("plays")), scores = byId_(list_("scores")), all = realGames_(games), yday = all.filter(function (x) { return x.id < TODAY; })[0];
  var sent = 0, dead = [];
  mine.forEach(function (d) {
    var uid = d.id, lines = [];
    var st = yday ? streakAt_(uid, yday.id, all, votes, plays) : 0;
    var got = yday ? (Number(((((scores[uid] || {}).log) || {})["g" + yday.id] || {}).p) || 0) : 0;
    if (got) lines.push("+" + got + " points from yesterday.");
    if (st) lines.push("You're on a " + st + "-day streak" + ((st + 1) % STREAK_BONUS === 0 ? ". Play today for +" + STREAK_BONUS + "." : "."));
    if (!g && !got) return;   // nothing worth a buzz
    var title = g ? "Today's game: " + gameName_(g) : "Results are in";
    var res = sendPush_(d.push.token, title, lines.join(" ") || "One game a day. Play now.", SITE_URL + "#play");
    if (res === "dead") dead.push(uid); else if (res) sent++;
  });
  if (dead.length) commit_(dead.map(function (uid) { return mergeWrite_("mine/" + uid, { push: null }, ["push"]); }));
  return "sent " + sent + ", removed " + dead.length + " expired";
}
function sendPush_(token, title, body, url) {
  var res = UrlFetchApp.fetch("https://fcm.googleapis.com/v1/projects/" + PROJECT_ID + "/messages:send", {
    method: "post", contentType: "application/json", muteHttpExceptions: true, headers: { Authorization: "Bearer " + ScriptApp.getOAuthToken() },
    payload: JSON.stringify({ message: { token: token, data: { title: title, body: body, url: url }, webpush: { headers: { Urgency: "high", TTL: "43200" } } } }) });
  var code = res.getResponseCode();
  if (code === 404 || (code === 400 && /UNREGISTERED|INVALID_ARGUMENT/.test(res.getContentText()))) return "dead";
  return code < 300;
}

/* ---------------- 4. weekly email digest (opt-in) ---------------- */
function weeklyDigest() {
  var TODAY = today_(), ws = weekStart_(addDays_(TODAY, 1)), mine = list_("mine").filter(function (d) { return d.digest && d.digestSent !== ws; });
  if (!mine.length) return "nobody to email";
  var priv = byId_(list_("private")), events = list_("events"), opps = list_("opps"), stats = (call_("get", BASE + "/scores/_stats") || {}).fields;
  stats = stats ? decFields_(stats) : {};
  var in7 = addDays_(TODAY, 8), evs = events.filter(function (e) { return e.date && e.date > TODAY && e.date <= in7 && e.type !== "meeting" && !e.grade; }).sort(function (a, b) { return a.date < b.date ? -1 : 1; });
  var dls = opps.filter(function (o) { return o.deadline && o.deadline > TODAY && o.deadline <= in7; });
  var winners = ((stats.lastWeek || {}).rank || []).map(function (w, i) { return (i + 1) + ". " + w.name; }).join(", ");
  var esc = function (t) { return String(t || "").replace(/[&<>]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]; }); };
  var fmt = function (s) { return Utilities.formatDate(parse_(s), TZ, "EEE, MMM d"); };
  var html = "<div style='font-family:Arial,sans-serif;max-width:560px'><h2 style='margin:0 0 8px'>Your week at Avenues</h2>" +
    (evs.length ? "<h3>Coming up</h3><ul>" + evs.slice(0, 8).map(function (e) { return "<li><b>" + esc(fmt(e.date)) + "</b> " + esc(e.title) + (e.location ? " (" + esc(e.location) + ")" : "") + "</li>"; }).join("") + "</ul>" : "") +
    (dls.length ? "<h3>Deadlines</h3><ul>" + dls.map(function (o) { return "<li>Apply by " + esc(fmt(o.deadline)) + ": " + esc(o.title) + "</li>"; }).join("") + "</ul>" : "") +
    (winners ? "<p><b>Last week's winners:</b> " + esc(winners) + "</p>" : "") +
    "<p><a href='" + SITE_URL + "' style='background:#F4B400;color:#14202E;padding:10px 16px;text-decoration:none;font-weight:bold'>Open Student Hub</a></p>" +
    "<p style='color:#56606C;font-size:12px'>You get this because you turned on the weekly email in MySpace. Turn it off there any time.</p></div>";
  var sent = 0, writes = [];
  for (var i = 0; i < mine.length && sent < DIGEST.capPerRun && MailApp.getRemainingDailyQuota() > 0; i++) {
    var email = (priv[mine[i].id] || {}).email; if (!email) continue;
    MailApp.sendEmail({ to: email, subject: "Your week at Avenues", htmlBody: html, name: "Avenues Student Hub" });
    writes.push(mergeWrite_("mine/" + mine[i].id, { digestSent: ws }, ["digestSent"])); sent++;
  }
  if (writes.length) commit_(writes);
  return "emailed " + sent + (mine.length > sent ? " (" + (mine.length - sent) + " left for tomorrow)" : "");
}

/* ---------------- home games ----------------
 * Keeps one "Home games this week" bulletin post per week (id homegames-<Monday>) with this week's varsity home games.
 * Mirrors homeGamesIn(), gameLine(), homeGamesPost() and postHomeGames() in stuco-hub.html; the text must come out
 * identical in both, so change both together. A post a council member edited or deleted is left alone. */
var GDAYS_ = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"], GMONTHS_ = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function homeGamesIn_(data, from, to) {
  return ((data && data.events) || []).filter(function (e) {
    return e.type === "game" && e.homeAway === "home" && e.level === "Varsity" && e.status !== "cancelled" && !e.hidden && e.start &&
      e.start.slice(0, 10) >= from && e.start.slice(0, 10) <= to;
  }).sort(function (a, b) { return a.start < b.start ? -1 : a.start > b.start ? 1 : 0; }).map(function (e) {
    return { date: e.start.slice(0, 10), time: e.timeTbd ? "" : e.start.slice(11, 16), team: e.team || "", opp: e.opponent || "",
      place: [/avenues/i.test(e.venue || "") ? "" : e.venue || "", e.subsite || ""].filter(function (x, i, a) { return x && a.indexOf(x) === i; }).join(", ") };
  });
}
function gameLine_(g) {
  var p = g.date.split("-").map(Number), wd = GDAYS_[new Date(p[0], p[1] - 1, p[2]).getDay()], t = "Time TBD";
  if (g.time) { var hm = g.time.split(":").map(Number); t = ((hm[0] + 11) % 12 + 1) + ":" + pad_(hm[1]) + (hm[0] < 12 ? " AM" : " PM"); }
  return wd + ", " + GMONTHS_[p[1] - 1] + " " + p[2] + " · " + t + " · " + g.team + (g.opp ? " vs " + g.opp : "") + (g.place ? " · " + g.place : "");
}
function homeGamesPost_(games) {
  return { title: games.length === 1 ? "Home game this week: " + games[0].team + (games[0].opp ? " vs " + games[0].opp : "") : games.length + " home games this week",
    body: "Come cheer on the Aviators at home:\n\n" + games.map(gameLine_).join("\n") + "\n\nFrom the Aviators athletics schedule. Times can change, so check avenues.org before you go." };
}
function homeGames() {
  var res = UrlFetchApp.fetch(ATHLETICS_URL, { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) return "schedule unavailable (" + res.getResponseCode() + ")";
  var data = JSON.parse(res.getContentText()), today = today_(), wk = weekStart_(today), path = "bulletin/homegames-" + wk;
  var cur = call_("get", BASE + "/" + path), old = cur ? decFields_(cur.fields) : null;
  if (old && (old.removed || old.body !== old.autoBody)) return "left alone (edited or removed by council)";
  var from = (old && old.from) || today, games = homeGamesIn_(data, from, addDays_(wk, 6));
  if (!games.length) { if (old) call_("delete", BASE + "/" + path); return "no varsity home games"; }
  var post = homeGamesPost_(games);
  if (old && old.title === post.title && old.body === post.body) return "up to date (" + games.length + ")";
  var doc = old || {};
  Object.keys(post).forEach(function (k) { doc[k] = post[k]; });
  doc.autoBody = post.body; doc.games = games; doc.from = from; doc.tag = "Sports"; doc.auto = true;
  doc.date = (old && old.date) || today; doc.author = (old && old.author) || ""; doc.pinned = !!(old && old.pinned); doc.at = (old && old.at) || new Date().toISOString();
  commit_([replaceWrite_(path, doc)]);
  return (old ? "updated" : "posted") + " (" + games.length + ")";
}
