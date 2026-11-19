/**
 * Avenues Student Hub: nightly jobs. Runs on its own every hour and does what's due:
 *   05:00  settle yesterday's games (points, streak bonuses), then rewrite the summary (scores/_stats)
 *   07:00  morning phone notification (today's game, your streak, yesterday's points)
 *   12:00, 16:00  rewrite the summary so like, sign-up and reply counts stay fresh
 *   Sunday 17:00  weekly email digest to students who turned it on
 *   every 10 minutes  council calendar: email members who were just tagged on an item
 *   07:00  council calendar: email and phone reminder for items due today or tomorrow
 *   every 10 minutes  student list: if the Google Sheet changed, update roster/ to match (ROSTER_SHEET below)
 *   06:00  game-day bulletin post (varsity home games, NYSAIS and ACIS finals) from the Aviators athletics schedule
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
// The student list's Google Sheet (paste its link here in the Apps Script editor, not in the public repo).
// Columns: Email, Name, Grade, Birthday, StuCo, Club leader. The account running this script must be able to open it.
var ROSTER_SHEET = "";
var ATHLETICS_URL = "https://storage.googleapis.com/avenues-athletics-data/schedule.json";

/* ---------------- schedule ---------------- */
function setup() {
  ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger("tick").timeBased().everyHours(1).create();
  ScriptApp.newTrigger("plannerMail").timeBased().everyMinutes(10).create();
  ScriptApp.newTrigger("syncRoster").timeBased().everyMinutes(10).create();
  var r = runNow();
  Logger.log("Set up. First run: " + JSON.stringify(r));
}
function tick() {
  var now = new Date(), h = +Utilities.formatDate(now, TZ, "H"), dow = +Utilities.formatDate(now, TZ, "u") % 7, out = {};
  if (h === 5) out.settle = settle();
  if (STATS_HOURS.indexOf(h) >= 0) out.stats = writeStats();
  if (h === GAMES_HOUR) out.games = gameDay();
  if (h === PUSH_HOUR) out.push = morningPush();
  if (h === PUSH_HOUR) out.planner = plannerDue();
  // Sunday evening, then Monday and Tuesday for anyone the daily email limit left out
  if (h === DIGEST.hour && [DIGEST.day, (DIGEST.day + 1) % 7, (DIGEST.day + 2) % 7].indexOf(dow) >= 0) out.digest = weeklyDigest();
  if (Object.keys(out).length) Logger.log(JSON.stringify(out));
}
/** Run everything except notifications and email right now (safe to run any time). */
function runNow() { return { roster: syncRoster(true), settle: settle(), stats: writeStats(), games: gameDay() }; }

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

/* ---------------- game day ----------------
 * On the day of a varsity home game, or an NYSAIS or ACIS final (home or away), one bulletin post (id gameday-<date>).
 * Mirrors isFinal, gameDayGames(), gameTime(), gameLine(), gameDayPost() and autoPost() in stuco-hub.html; the text
 * must come out identical in both, so change both together. A post a council member edited or deleted is left alone.
 * (The weekly lunch post is made by a council member's browser only.) */
var GDAYS_ = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
function isFinal_(e) {
  return /\b(nysais|acis)\b/i.test([e.eventName, e.opponent, e.venue].join(" ")) && /\bfinals?\b|championship/i.test([e.eventName, e.opponent].join(" "));
}
function gameDayGames_(data, day) {
  return ((data && data.events) || []).filter(function (e) {
    return e.type === "game" && e.status !== "cancelled" && !e.hidden && e.start && e.start.slice(0, 10) === day &&
      ((e.homeAway === "home" && e.level === "Varsity") || isFinal_(e));
  }).sort(function (a, b) { return a.start < b.start ? -1 : a.start > b.start ? 1 : 0; }).map(function (e) {
    return { date: e.start.slice(0, 10), time: e.timeTbd ? "" : e.start.slice(11, 16), team: e.team || "", opp: e.opponent || "", home: e.homeAway === "home", final: isFinal_(e), label: e.eventName || "",
      place: [/avenues/i.test(e.venue || "") ? "" : e.venue || "", e.subsite || ""].filter(function (x, i, a) { return x && a.indexOf(x) === i; }).join(", ") };
  });
}
function gameTime_(t) { if (!t) return "time TBD"; var hm = t.split(":").map(Number); return ((hm[0] + 11) % 12 + 1) + ":" + pad_(hm[1]) + (hm[0] < 12 ? " AM" : " PM"); }
function gameLine_(g) { return gameTime_(g.time) + " · " + (g.final ? (g.label || "Final") + ": " : "") + g.team + (g.opp ? (g.home ? " vs " : " at ") + g.opp : "") + (g.place ? " · " + g.place : ""); }
function gameDayPost_(games) {
  var one = games.length === 1 ? games[0] : null, fin = games.some(function (g) { return g.final; });
  return { title: one ? (one.final ? "Final today: " : "Home game today: ") + one.team + (one.opp ? (one.home ? " vs " : " at ") + one.opp : "") + ", " + gameTime_(one.time) : games.length + " big games today",
    body: (fin ? "It's championship day. Come cheer on the Aviators:" : "Come cheer on the Aviators at home:") + "\n\n" + games.map(gameLine_).join("\n") + "\n\nFrom the Aviators athletics schedule. Times can change, so check avenues.org before you go." };
}
function gameDay() {
  var res = UrlFetchApp.fetch(ATHLETICS_URL, { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) return "schedule unavailable (" + res.getResponseCode() + ")";
  var today = today_(), games = gameDayGames_(JSON.parse(res.getContentText()), today), path = "bulletin/gameday-" + today;
  var cur = call_("get", BASE + "/" + path), old = cur ? decFields_(cur.fields) : null;
  if (old && (old.removed || old.body !== old.autoBody)) return "left alone (edited or removed by council)";
  if (!games.length) { if (old) call_("delete", BASE + "/" + path); return "no big games today"; }
  var post = gameDayPost_(games);
  if (old && old.title === post.title && old.body === post.body) return "up to date";
  var doc = old || {};
  doc.title = post.title; doc.body = post.body; doc.games = games; doc.tag = "Sports"; doc.level = games.some(function (x) { return x.final; }) ? "important" : "normal"; doc.autoBody = post.body; doc.auto = true;
  doc.date = (old && old.date) || today; doc.author = (old && old.author) || ""; doc.pinned = !!(old && old.pinned); doc.at = (old && old.at) || new Date().toISOString();
  commit_([replaceWrite_(path, doc)]);
  return (old ? "updated" : "posted") + " (" + games.length + ")";
}

/* ---------------- 6. council calendar: tag emails and due-date reminders ---------------- */
/** Documents in a collection where one field equals a value (reads only the matches). */
function where_(col, field, value) {
  var r = call_("post", BASE + ":runQuery", { structuredQuery: { from: [{ collectionId: col }], where: { fieldFilter: { field: { fieldPath: field }, op: "EQUAL", value: enc_(value) } } } }) || [];
  return r.filter(function (x) { return x.document; }).map(function (x) { var o = decFields_(x.document.fields); o.id = x.document.name.split("/").pop(); return o; });
}
function esc_(t) { return String(t || "").replace(/[&<>]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]; }); }
function emailOf_(uid, cache) {
  if (!(uid in cache)) { var d = call_("get", BASE + "/private/" + encodeURIComponent(uid)); cache[uid] = d && d.fields ? (decFields_(d.fields).email || "") : ""; }
  return cache[uid];
}
function planDate_(s) { return Utilities.formatDate(parse_(s), TZ, "EEEE, MMMM d"); }
function planButton_() { return "<p><a href='" + SITE_URL + "#planner' style='background:#F4B400;color:#14202E;padding:10px 16px;text-decoration:none;font-weight:bold'>Open the council calendar</a></p>"; }
/** Every 10 minutes: email the council members who were just tagged on a calendar item (the site sets mail:true and notify:[uid]). */
function plannerMail() {
  var pending = where_("plans", "mail", true);
  if (!pending.length) return "no new tags";
  var cache = {}, sent = 0, writes = [];
  pending.forEach(function (p) {
    var left = [];
    (p.notify || []).forEach(function (uid) {
      var email = emailOf_(uid, cache);
      if (!email) return;   // no account yet, nothing to send
      if (MailApp.getRemainingDailyQuota() < 1) { left.push(uid); return; }
      MailApp.sendEmail({ to: email, name: "Avenues Student Council", subject: (p.byName || "A council member") + " tagged you: " + p.title,
        htmlBody: "<div style='font-family:Arial,sans-serif;max-width:560px'><h2 style='margin:0 0 8px'>" + esc_(p.title) + "</h2>" +
          "<p><b>" + esc_(p.byName || "A council member") + "</b> tagged you on the council calendar for <b>" + esc_(planDate_(p.date)) + "</b>.</p>" +
          (p.notes ? "<p style='white-space:pre-wrap'>" + esc_(p.notes) + "</p>" : "") + planButton_() + "</div>" });
      sent++;
    });
    writes.push(mergeWrite_("plans/" + p.id, { mail: left.length > 0, notify: left }, ["mail", "notify"]));
  });
  commit_(writes);
  return "emailed " + sent + " tagged";
}
/** 7:00: one email (and a phone notification, if on) per person listing their unchecked items due today or tomorrow. */
function plannerDue() {
  var TODAY = today_(), TOMORROW = addDays_(TODAY, 1), per = {};
  list_("plans").forEach(function (p) {
    if (p.done || !p.title || (p.date !== TODAY && p.date !== TOMORROW)) return;
    ((p.tags && p.tags.length) ? p.tags : [p.by]).forEach(function (uid) { if (uid) (per[uid] = per[uid] || []).push(p); });
  });
  var uids = Object.keys(per);
  if (!uids.length) return "nothing due";
  var cache = {}, mine = byId_(list_("mine")), sent = 0;
  uids.forEach(function (uid) {
    var items = per[uid].sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
    var line = function (p) { return (p.date === TODAY ? "Today" : "Tomorrow") + ": " + p.title; };
    var push = (mine[uid] || {}).push;
    if (push && push.token) sendPush_(push.token, items.length === 1 ? line(items[0]) : items.length + " council items due", items.length === 1 ? "On the council calendar." : items.map(line).join(" · "), SITE_URL + "#planner");
    var email = emailOf_(uid, cache);
    if (!email || MailApp.getRemainingDailyQuota() < 1) return;
    MailApp.sendEmail({ to: email, name: "Avenues Student Council", subject: items.length === 1 ? "Due " + line(items[0]).replace(/^T/, "t") : items.length + " council items due",
      htmlBody: "<div style='font-family:Arial,sans-serif;max-width:560px'><h2 style='margin:0 0 8px'>Due on the council calendar</h2><ul>" +
        items.map(function (p) { return "<li><b>" + (p.date === TODAY ? "Today" : "Tomorrow") + "</b>: " + esc_(p.title) + "</li>"; }).join("") + "</ul>" + planButton_() + "</div>" });
    sent++;
  });
  return "reminded " + sent;
}


/* ---------------- student list from the Google Sheet ----------------
   Mirrors importRoster() in stuco-hub.html: the sheet is the list. Emails on the president's approved list keep
   council even if they're not in the sheet; saved positions, invites and sign-ins are kept; a title in the StuCo
   column becomes the position. Skips when the sheet hasn't changed, and never deletes people if the sheet suddenly
   looks empty or much shorter (wrong tab, lost sharing). */
function rosterBid_(e) { var h = 0; for (var i = 0; i < e.length; i++) h = ((h * 31) + e.charCodeAt(i)) >>> 0; return "r" + h.toString(36); }
function parseBday_(s) {
  if (!s) return null; var m;
  if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) return [+m[2], +m[3]];
  if ((m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})/))) return [+m[1], +m[2]];
  var d = new Date(s + " 2000"); return isNaN(d) ? null : [d.getMonth() + 1, d.getDate()];
}
function parseRosterRows_(rows) {
  rows = rows.map(function (r) { return r.map(function (c) { return String(c == null ? "" : c).trim(); }); }).filter(function (r) { return r.some(String); });
  if (!rows.length) return [];
  var idx = { email: 0, name: 1, grade: 2, bday: 3, council: 4, club: 5 }, h = rows[0].map(function (x) { return x.toLowerCase(); });
  if (!h.some(function (x) { return x.indexOf("@") >= 0; })) {
    var f = function (re) { for (var i = 0; i < h.length; i++) if (re.test(h[i])) return i; return -1; };
    idx = { email: f(/e-?mail/), name: f(/name/), grade: f(/grade|class|year/), bday: f(/birth|bday/), council: f(/stuco|council/), club: f(/club/) };
    rows.shift();
  }
  var out = [];
  rows.forEach(function (r) {
    var get = function (k) { return idx[k] >= 0 ? (r[idx[k]] || "").trim() : ""; }, email = get("email").toLowerCase();
    if (!/^[^@\s\/]+@[^@\s\/]+\.[^@\s\/]+$/.test(email)) return;
    var c = get("council"), e = { name: get("name"), grade: (get("grade").match(/\d+/) || [""])[0], council: !!c && !/^(n|no|false|0|-)$/i.test(c),
      clubs: get("club").split(/[;|]/).map(function (x) { return x.trim().toLowerCase(); }).filter(String) };
    if (e.council && !/^(y|yes|true|x|1|stuco|council|✓)$/i.test(c)) e.role = c.slice(0, 60);
    var b = parseBday_(get("bday")); if (b) { e.bm = b[0]; e.bd = b[1]; }
    out.push([email, e]);
  });
  return out;
}
function sameRow_(a, b) { var k = function (o) { var c = {}; Object.keys(o || {}).sort().forEach(function (x) { c[x] = o[x]; }); return JSON.stringify(c); }; return k(a) === k(b); }
/** force: run even if the sheet hasn't changed since the last sync. */
function syncRoster(force) {
  if (!ROSTER_SHEET) return "no sheet set (ROSTER_SHEET)";
  var ss = SpreadsheetApp.openByUrl(ROSTER_SHEET), props = PropertiesService.getScriptProperties();
  var changed = String(DriveApp.getFileById(ss.getId()).getLastUpdated().getTime());
  if (force !== true && props.getProperty("rosterSheetStamp") === changed) return "sheet unchanged";
  var rows = parseRosterRows_(ss.getSheets()[0].getDataRange().getDisplayValues());
  var have = byId_(list_("roster")), adm = call_("get", BASE + "/admin/access"), granted = {};
  ((adm && decFields_(adm.fields).emails) || []).forEach(function (e) { granted[String(e).toLowerCase()] = true; });
  var current = Object.keys(have).length;
  if (!rows.length) throw new Error("The student list sheet has no rows with an email. Check the first tab and its Email column.");
  var guard = current > 20 && rows.length < current / 2;   // looks wrong: add and update only, remove nobody
  var writes = [], keep = {}, bkeep = {}, births = list_("birthdays");
  rows.forEach(function (pair) {
    var email = pair[0], e = pair[1], o = have[email]; keep[email] = true;
    if (granted[email]) e.council = true;
    if (o) { if (!e.role && o.role) e.role = o.role; if (o.invitedAt) e.invitedAt = o.invitedAt; if (o.uid) e.uid = o.uid; }
    if (!o || !sameRow_(Object.assign({}, o, { id: undefined }), e)) writes.push(replaceWrite_("roster/" + email, e));
    if (e.bm && e.name) { var id = rosterBid_(email); bkeep[id] = true; var bd = { name: e.name, month: e.bm, day: e.bd, show: true, roster: true }, ob = births.filter(function (x) { return x.id === id; })[0];
      if (!ob || ob.name !== bd.name || ob.month !== bd.month || ob.day !== bd.day) writes.push(replaceWrite_("birthdays/" + id, bd)); }
  });
  var removed = 0;
  Object.keys(have).forEach(function (email) {
    if (keep[email]) return; var d = have[email];
    if (granted[email]) { if (!d.extra || !d.council) { var row = Object.assign({}, d); delete row.id; row.council = true; row.extra = true; writes.push(replaceWrite_("roster/" + email, row)); } }
    else if (!guard) { writes.push({ "delete": docName_("roster/" + email) }); removed++; }
  });
  if (!guard) births.forEach(function (b) { if (b.roster && !bkeep[b.id]) writes.push({ "delete": docName_("birthdays/" + b.id) }); });
  writes.push(mergeWrite_("config/access", { rosterSync: { at: new Date().toISOString(), rows: rows.length, held: guard } }, ["rosterSync"]));
  commit_(writes);
  props.setProperty("rosterSheetStamp", changed);
  return "student list: " + rows.length + " rows, " + (writes.length - 1) + " changes" + (removed ? ", " + removed + " removed" : "") + (guard ? " (held back removals: the sheet is less than half the current list)" : "");
}
