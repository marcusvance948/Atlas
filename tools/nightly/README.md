# Nightly script

One Google Apps Script that runs every hour and does what's due, so nothing waits for a council member to open the site:

It also checks every 10 minutes for council members who were just tagged on the council calendar and emails them, and at 7:00 emails (and notifies, if they turned phone notifications on) each council member their unchecked calendar items due today or tomorrow. If you installed an earlier version, paste the new `Code.gs` and run `setup()` again so the 10-minute trigger is added.

| When (New York time) | What |
|---|---|
| 5:00 | Settle yesterday's games: points, streak bonuses (+5 every 5th game day in a row). Then rewrite the summary. |
| 7:00 | Morning phone notification to students who turned it on: today's game, their streak, yesterday's points. |
| 12:00 and 16:00 | Rewrite the summary (`scores/_stats`) so like, sign-up and reply counts, the leaderboard and weekly ranks stay fresh. |
| Sunday 17:00 (Mon and Tue if needed) | Weekly email to students who turned it on. |

The site still settles points itself if a council member opens it first; both use the same rules and never double-count.

## Set it up (about 10 minutes, once)

1. Sign in to Google with the account that **owns the Firebase project** (`atlas-bae05`). The script signs in to Firestore as this account, so it must be an Owner or Editor of the project. No keys or passwords are stored.
2. Go to https://script.google.com → **New project**. Name it "Student Hub nightly".
3. Click the gear (**Project Settings**) and tick **Show "appsscript.json" manifest file in editor**.
4. Back in the editor: open `appsscript.json`, replace everything with this folder's `appsscript.json`. Open `Code.gs`, replace everything with this folder's `Code.gs`. Click **Save**.
5. Pick **setup** in the function menu at the top and click **Run**. Allow access when Google asks (Firestore, sending notifications, sending email, running on a schedule).
6. The **Execution log** should end with `Set up. First run: {"settle":…,"stats":"summary written …"}`. Done. It now runs every hour.

To run the settle and summary jobs by hand any time, run **runNow**.

## Student list from your Google Sheet

The script keeps the site's student list matched to your Google Sheet, so you never paste it into the site.

1. In the script editor, find `var ROSTER_SHEET = "";` near the top of `Code.gs` and paste your sheet's link between the quotes. (Keep the link out of the public repo; only paste it in the editor.)
2. Make sure the account running the script can open the sheet (if someone else owns it, share it with that account, view access is enough).
3. Run **setup** again and allow the new access (Google Sheets and Drive, read-only). It adds a 10-minute check.

From then on: edit the sheet, and within 10 minutes the site's student list matches. The first tab is read. Columns: Email, Name, Grade, Birthday, StuCo, Club leader. Under StuCo put "yes" or the person's position (e.g. Treasurer); leave it blank for everyone else.

- People on your approved email list (Members page) keep council access even if they're not in the sheet.
- Positions, invites and sign-ins already saved are kept.
- If the sheet suddenly has less than half the people, the sync adds and updates but removes nobody, and the Members page warns you. If it has no rows with an email, it stops and changes nothing.
- Members → President controls shows "Synced from your Google Sheet: N people, last change picked up …".

## Phone notifications (optional)

1. Firebase console → **Project settings → Cloud Messaging**. Under **Web configuration → Web Push certificates**, click **Generate key pair** and copy the key.
2. On the site, signed in as president: **MySpace → Notifications → Set up phone notifications**, paste the key, save.
3. Students turn on **Phone notifications** in MySpace. On iPhone this only works after adding Student Hub to the home screen (iOS 16.4 or later).

If the Execution log shows errors from `fcm.googleapis.com`, open Google Cloud console → APIs & Services and make sure **Firebase Cloud Messaging API** is enabled for the project.

## Weekly email

Students turn on **Weekly email** in MySpace. Emails go from the account that runs the script. A Gmail account can email about 100 people a day, so with more sign-ups the script sends 90 on Sunday and the rest on Monday and Tuesday. A Google Workspace account can send about 1,500 a day; raise `DIGEST.capPerRun` in `Code.gs` if you use one.

## If something goes wrong

- **Executions** (left sidebar) lists every run with its log.
- `403 PERMISSION_DENIED` from Firestore: the account running the script isn't an Owner or Editor of the Firebase project.
- To stop it: **Triggers** (clock icon) → delete the `tick` trigger.

## Keep in sync with the site

`settle()` and `writeStats()` mirror `settleGames()` and `writeStats()` in `stuco-hub.html`. Change both together, then run the tests on a Mac from this folder:

```bash
osascript -l JavaScript -e 'ObjC.import("Foundation");eval($.NSString.stringWithContentsOfFileEncodingError("test.js",4,null).js)'
```

`test.js` fakes Google's services and the database, and checks the answer hashing against the site, scoring for each game type, streak bonuses, the summary, notifications and the email (24 checks).
