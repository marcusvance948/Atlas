# Handoff: Atlas (Avenues Student Hub)

Everything a new session needs to keep building this site. Last updated 2026-11-17 (council calendar, 10th Avenue street scene, speed pass).

## What it is

A community site for high school students at Avenues The World School, run by Student Council. The president (Alexander) is the owner and approves everything.

- **Live site:** https://marcusvance948.github.io/Atlas/ (GitHub Pages, serving the `pages` branch).
- **Repo:** https://github.com/marcusvance948/Atlas (public). `main` holds the source; `pages` holds the built site. Moved from Codeberg on 2026-11-16; the old Codeberg repo is retired.
- **Approval rule:** a ruleset protects `main` and `pages`. Anyone but the owner needs a pull request with 1 approval from the owner; new pushes cancel the approval; no force-push or deletion. Collaborators: work on a branch and open a PR against `main`, never push to `main` or `pages`.
- **Backend:** Firebase project `atlas-bae05` (Google sign-in + Cloud Firestore, free plan). President's Firebase user ID: `4Dtjya2UUbdNGnynIZ8zCKRzfdT2`.
- **Second copy:** a claude.ai artifact, https://claude.ai/artifact/32d7F77SoUYbsDNwsQUiV3. Same source file. It can't enforce the student list, so the GitHub Pages site is the real one.

## Files

| File | Role |
|---|---|
| `stuco-hub.html` | The whole app, one file (HTML, CSS, JS). Edit this. |
| `tools/build_site.py` | Wraps the app with Firebase into `site/index.html`. Run after every change. |
| `site/firebase-adapter.js` | Gives the app the same `window.claude.use()` interface on top of Firebase (auth, Firestore, photos as data URLs in `photos/`, downloads). |
| `site/firebase-config.js` | Firebase web config + `OWNER_UID`. |
| `firestore.rules` | Security rules. The president pastes them into Firebase → Firestore → Rules → Publish after every change. Always tell him. |
| `tools/artifact-capabilities.json` | The `capabilities` value to pass when publishing the claude.ai artifact if rules change. |
| `tools/nightly/` | Apps Script (`Code.gs` + `appsscript.json`), hourly plus a 10-minute trigger for council calendar tag emails (`plannerMail`); 7:00 council calendar due reminders (`plannerDue`); 5:00 settles games and streak bonuses, rewrites `scores/_stats` at 5/12/16, 7:00 morning push to students with `mine/<uid>.push`, Sunday 17:00 weekly email to `mine/<uid>.digest` (email from `private/<uid>`). Signs in as the Google account that owns the Firebase project (no keys). Mirrors `settleGames()`/`writeStats()`; change both together. Not yet installed. |
| `tools/calendar-feed/` | Apps Script web app that serves school events as a subscribable .ics feed (reads public `events` over Firestore REST, no keys). President deploys it and pastes the link in Explore → Events → Connect calendar feed (`CFG.icsUrl`). Not yet installed. |
| `tools/make_icons.py` | Draws the pixel app icons into `site/icons/`. `build_site.py` also writes `site/manifest.webmanifest` and `site/sw.js` (network-first service worker, so the site installs to the home screen). |
| `tools/google-slides/` | Apps Script that rebuilds a Google Slides lost-and-found deck from Firestore hourly. Not yet installed by the president. |
| `student-list-template.csv` | Columns for the student list (Email, Name, Grade, Birthday, StuCo, Club leader). |

## Publishing a change (exact steps)

```bash
# 1. clone if the folder is gone (the old one was a temporary session folder)
git clone https://github.com/marcusvance948/Atlas.git && cd Atlas
# owner: run `gh auth switch -u marcusvance948` first (this repo belongs to that GitHub account; management89/Atlas and alexanderh8809-oss/Atlas are archived older copies)

# 2. after editing stuco-hub.html
python3 tools/build_site.py
git add -A && git commit -m "…"      # end messages with the Co-Authored-By line
SPLIT=$(git subtree split --prefix site)
git push origin main "${SPLIT}:refs/heads/pages"   # owner only; force-push is blocked by the ruleset
# collaborators instead: git push origin <branch> && gh pr create --base main
```

- In zsh, write `"${SPLIT}:refs/…"` with braces: `"$SPLIT:r…"` breaks because `:r` is a zsh modifier.
- The live site updates within a minute or two. Check with `curl -s https://marcusvance948.github.io/Atlas/ | grep -c <new function name>`.
- GitHub sign-in is through `gh` (keychain). Never handle the president's passwords or tokens.
- Then republish the claude.ai artifact from `stuco-hub.html` (pass `tools/artifact-capabilities.json` only if rules changed).

## How the app is organized

- **Student tabs (4), no third level:** Today (`#home`: short pixel banner with a greeting, three live cards, one merged "Coming up" list of events, deadlines, sign-up closings, opportunity deadlines and private reminders, then announcements, the community feed with stories, Grade Race, birthdays, playlists, photo belt), Explore (Events with a Month view, Clubs, Opportunities), Play (one page: today's game, challenges, predictions, leaderboard; empty sections hide for students), StuCo (one page, side menu: Feedback, Polls, Lost and found, Our work). MySpace (`#myspace`) opens from the avatar in the top bar. `#bulletin` is the full announcements archive (under Today).
- **Old links:** `ALIAS` maps retired names (hub, community, create, collabs, life, connect, explore, challenges, dares, leaderboard) to their new place and section; keep it when renaming routes.
- **Council view** (switch in the menu): Overview, Calendar, Tasks, Proposals, Attendance, Members, History, plus edit buttons everywhere. `council()` is false in student preview.
- **Routing:** `ROUTES` maps hash names to tabs; `VIEWFN` in `render()` maps them to view functions. `head(context,title,actions)` puts the title in the pixel banner.
- **Pixel scene:** animated Avenues building (time of day, season, plane with Aviator name, truck with latest news, birthday banner) in the Today banner and every page banner. The street is the real corner, 10th Avenue and West 25th Street (`drawBackdrop`): bike lane, parking lane with school buses, two lanes of one-way traffic, ladder crosswalks, the High Line over 25th Street, the glass building across the street, street signs. A traffic light runs on a 30-second cycle (`light()` in `startScene`): cars and bikes stop at the line (`drive`), people cross on the walk signal. It draws at 30 frames a second and pauses when scrolled out of view.
- **Council calendar** (`#planner`, council view only; `planner`, `planForm`, `planItem`): one shared month any council member can add to on any day. Every item is a checklist item in `plans/<id>` (council-only collection). Tagging members (`tags`) puts it in their Inbox at once and sets `mail: true` + `notify: [uid]`; `tools/nightly` `plannerMail()` (every 10 minutes) emails them and clears both, and `plannerDue()` (7:00) emails and pushes each person their unchecked items due today or tomorrow (tagged people, or whoever added it if nobody is tagged). Only members with a council profile can be tagged. The `plans` rule must be published in Firebase, and the artifact needs `tools/artifact-capabilities.json` passed again. **Repeating items** (`PLAN_REPEAT`, `planDates`): a new item can repeat every week, every other week or monthly until a date (default June 15). Each date is its own `plans` doc sharing `series`; only the first notifies (the rest have `quiet:true`, skipped in the Inbox, with `mail:false`). Editing or deleting a series item has an "also apply to later dates" box (title, time, notes and tags; dates stay put).
- **Loading:** on the website the Firebase scripts are `defer`red and the app boots at DOMContentLoaded, so the page paints first. jsPDF and JSZip load only when a proposal is exported (`needLib`), Firebase Messaging only when notifications are switched (`needMessaging` in the adapter). Snapshot bursts are drawn once (`dataChanged`). Keep it that way: no new blocking scripts in the head.
- **Daily games:** `games/<date>`; answers hashed, readable keys in `gamekeys/` (council only); a council member's browser settles points the next day (`settleGames`). Until then students see their own points as "+N pending" (`myPending()`, worked out from their own plays, photo entries and unconfirmed challenges; display only). Overview shows a "Points to settle" alert with a button if a finished game hasn't been settled. **Rewards:** top 3 players each Monday to Sunday win the weekly prize (`_settings.weekPrize`, set in Play → Set the prizes); weekly totals use the `d` date on each score log entry (older entries fall back to the date in the key). **Streaks** count game days played in a row (a day with no game never breaks one); settlement adds +5 (`s<date>` log key) on every 5th day. The old $20 / 1000-point personal goal is gone. Practice mode for council (`trial`).
- **Access:** student list pasted from a Google Sheet into `roster/<email>`; StuCo column = council; "Only listed emails can join" toggle. Student posts wait in `submissions/` for council approval.
- **Notifications (MySpace):** phone notifications (FCM; key in `CFG.vapidKey`, set by the president; token saved to `mine/<uid>.push`; `sw.js` shows them) and a weekly email opt-in (`mine/<uid>.digest`). Both are sent by `tools/nightly`.
- **Inbox** (bell in the top bar): built in the browser from existing data (approvals, council replies and status changes, replies to your posts, points and streak bonuses, weekly placing, shout-outs, saved-opportunity and RSVP reminders). Seen time is `mine/<uid>.inboxSeen`. Approvals now save `decidedAt`. Phone push comes from `tools/nightly`.
- **Data loading (read budget):** Firestore bills one read per document. Each page listens only to what it shows (`ensureData()`, `BASE_STUDENT`, `PAGE_NEEDS`, `QUERIES` near the end of the script): `self` = only your own doc, `query` = limited (newest N, upcoming), `all` = whole collection. Counts that need everyone's docs (likes, sign-ups, replies, reply notifications, grade totals, top players, weekly ranks) come from `scores/_stats`, rewritten by a council browser on Overview (`writeStats`, at most every 30 s, only when changed). Who's going to an event is a per-event query (`loadGoing`). The skills search loads profiles only when you type. Council view still loads everything it needs for approvals and settlement. The adapter adds `db.query()` (no offline persistence: it made second visits hang on the cached copy); the claude.ai artifact has no queries, so it falls back to loading everything. Measured with 300 test students: a student opening Today went from ~2,200 reads to ~80; visiting every page ~250. When adding a feature, add its collections to `PAGE_NEEDS` and never subscribe a per-student collection with `all` on a student page.
- **Announcements (bulletin):** cards show a category, an "Important" label, a "New" dot (posted since this device's last visit, `atlas.lastVisit` in localStorage), a relative date, and Read more for long posts. Message text supports `- ` bullet lists, `**bold**` and https links (`fmtBody`). Fields: `level` (normal / important / popup), optional `until` (stop showing after), optional `link` + `linkLabel` (button). Important and popup posts show a dismissible red bar at the top of every student page (`alertBar`) and stay at the top of Announcements for 14 days (`isImportant`). Popup posts also open once per device (`maybePopup`, remembered in `atlas.popups`). Lunch posts (with `menu`) are hidden from Announcements; they feed the Lunch card on Today (`lunchMenu`, day tabs Mon to Fri). Finals game-day posts are `important`.
- **Automatic posts (`postAuto()`):** a council member's browser keeps these bulletin posts; each has `auto: true` and `autoBody`. If council edits the text (`body` no longer equals `autoBody`) or deletes it (auto posts get `removed: true` instead of being deleted, and are hidden), it is never touched again.
  - **Game day** (`gameday-<date>`, tag Sports): on the day of a varsity home game, or an NYSAIS or ACIS final/championship (home or away; `isFinal`). Source: the public file behind avenues.org's athletics page, `https://storage.googleapis.com/avenues-athletics-data/schedule.json`. `tools/nightly` posts the same thing at 6:00 (`gameDay()`), with identical text; change both together. The `games` list also shows in "Coming up". The old weekly `homegames-<Monday>` post is retired automatically.
  - **Lunch** (`lunch-<Monday>`, tag Lunch): reads the dining team's Google Slides deck (`LUNCH_DECK`) through its public PowerPoint export, unzips it in the browser, and reads the table on the "Lower & Upper Division" slide (rows: entree, vegetarian entree, sides, sandwich). Saves `menu` by date; Today shows "Lunch today". Browser only (not in tools/nightly). If the dining team changes the slide layout, `lunchFromRows()` is where to fix it.
- **Clubs:** each club has a color (`color`, one of `CLUB_COLORS`; otherwise picked from its name) and its own page at `#club/<id>` (`clubPage`): one-line pitch, about (formatted like announcements), meeting time, leaders, contact, how to join, website, photos (first is the cover), club announcements and updates. Leaders (roster `clubs`, from the "Club leader" column) and council edit it with **Edit club page** (`clubPageForm`); leaders can't rename a club (the rules check the name). **Post an update** can also send it to school announcements: the bulletin post gets `clubKey`, `clubName`, `clubColor` and shows in the club's color with a link to the club page. Leader posts still go through council approval (`clubdrafts` → `cp-approve`). Students can **Add your club** (a `club` submission); approving it creates the club, and if the president approves a request from someone who said they lead it, their roster row gets that club (note: re-importing the student list replaces roster rows, so add them to the sheet's Club leader column too). The `clubs` rule change must be published in Firebase.
- **President controls (Members page):** **Add council member by email** (`councilForm`) writes the person's student-list row with `council: true` and a `role`, and adds them to the approved emails. They get council access the moment they sign in; once they create a profile, auto-approve gives it that role. **Remove example data** (`clearSample`) deletes everything the sample council created (`sample: true` in members, events, tasks, bulletin, proposals, meetings) and their roles.
- **Proposals archive:** the Proposals list is the archive: every proposal, grouped by school year, with a search box that matches any word anywhere in a proposal (title, text, budget lines, sponsor name; `propText`) and a stage filter. Matches outside the title show a highlighted snippet.
- **Attendance:** states are Present, Late, Absent and **N/A** (not elected yet, or not expected; old "excused" marks show as N/A). Opens on **All meetings**: a column per meeting (oldest to newest, upcoming ones faded), P/L/A/N/A boxes council clicks to cycle, and each member's rate (`attStats`: present or late, out of meetings marked other than N/A; under 75% red). Quorum counts only members not N/A. **+ Add meetings** (`meetingSeries`) creates a meeting for every chosen weekday (Thursday by default, weekly or every other week) in a date range, with a checkbox per date to skip holidays; dates that already have a meeting are skipped. **Remove meetings** (`meetingRemove`) deletes ticked meetings, with quick picks for upcoming or unmarked ones. **Elected on…** under a member's name marks them N/A at every earlier meeting. **Take roll** is the single-meeting view.
- **Office hours** (Explore → Office hours, `#officehours`): `OFFICE_HOURS` in `stuco-hub.html`, transcribed from the Upper Division office hours sheet (no emails kept). Replace it when a new sheet comes out. Days follow the 10-day rotation: council sets "Today is Day N" on that page (`scores/_settings.dayCycle`), and `schoolDay()` counts weekdays from there. It does not know holidays, so council sets it again after a break. Today shows "Office hours today" once it's set.
- **Instagram (@avenuesed):** not automated. Instagram has no public feed access; it needs a token from the account owner (the school's communications team) through Meta's Instagram API.
- **Data per person** lives in `<collection>/<uid>` documents with an `items` map (suggestions, signups, lostfound, bookings, gamevotes, replies…), written only by that person.

## Testing approach that works

Serve a copy locally (`python3 -m http.server`), add a doctype/viewport wrapper, open it in the browser pane, stub `db` with an in-memory object, set `me`/`isPres`/`CFG`/`S.*`, and render every route in both modes. Syntax-check the script with `osascript -l JavaScript` and `new Function(src)`.

## Open items

- President still to do: publish `firestore.rules` again (new `plans` rule for the council calendar); install `tools/nightly`, or if it is already installed paste the new `Code.gs` and run `setup()` again (adds the 10-minute trigger) (then add the Web Push key in MySpace); install `tools/calendar-feed`; publish the latest `firestore.rules`; import the real student list; test that school Google accounts can sign in (unknown; if blocked, the list needs personal emails); set up bookable rooms; install the Google Slides script.
- Possible next steps: rebrand the visible name from "Avenues Student Hub" to **Atlas**; Google Search Console verification; automatic publishing on merge; move saved opportunities from the browser to the account.
- A GitHub repo `AlexanderHuangAvenuesPresident/Avenues-Student-Hub` exists but is empty and unused. Collaborators send pull requests to `marcusvance948/Atlas`.

## How the president works

- Judge every change against his 7-point rubric: visual design, branding, navigation, engagement, community, functionality, adoption.
- Design: Franklin Gothic (Libre Franklin), pixel-cut shapes, no generic AI looks, at most about three filters per row, few tabs.
- He wants things built, tested, published, then a plain summary of what changed and what he has to do.
