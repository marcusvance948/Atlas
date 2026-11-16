# Avenues Student Hub

The student hub and Student Council workspace for Avenues The World School.

**Website:** https://marcusvance948.github.io/Atlas/

## What's in it

**For students (four tabs)**
- **Today:** the home page. What's coming up (events, deadlines, sign-ups closing, opportunity deadlines, your own reminders) in one list, announcements, the community feed with recaps and memes, the Grade Race, birthdays and playlists.
- **Explore:** events with sign-ups (list or month view), every club, and a searchable opportunities board with a Save list.
- **Play:** today's game, challenges, predictions and the leaderboard on one page.
- **StuCo:** feedback and problem reports, polls, lost and found, and everything Student Council has done.
- **MySpace:** open it from your picture in the top bar. Your profile, private calendar, posts, saved opportunities and room bookings.

**For council members**
- A Student view / Council view switch, so the president can see exactly what students see.
- **Tasks:** the president assigns tasks or leaves them open. Members accept their tasks and mark them started or done.
- **Proposals:** written in a built-in template that formats itself as you type. They export as a PDF and as a .docx that opens in Google Docs, and move from Draft to a roll-call vote.
- **Attendance** with an automatic quorum check, **member profiles** approved by the president, and a **history** log of every change.

## Who can do what

| Who | How | What they can do |
|---|---|---|
| Anyone | Just open the site | Read the bulletin, calendar, events and opportunities |
| Students | Sign in with Google | Everything on the student side; sign up for events, vote, suggest, share playlists and birthdays |
| Council members | Sign in, create a profile, get approved by the president | Edit the school site; council pages |
| President | The user ID set in `firebase-config.js` and `firestore.rules` | Everything, including assigning tasks and approving members |

The rules in `firestore.rules` enforce this on Firebase's servers, not just in the page.

## Files

| File | What it is |
|---|---|
| `stuco-hub.html` | The whole app. The single source for both the claude.ai artifact and the website. |
| `site/` | The website, served by GitHub Pages from the `pages` branch. |
| `site/index.html` | Built from `stuco-hub.html` by `tools/build_site.py`. Don't edit it by hand. |
| `site/firebase-config.js` | Your Firebase project settings and the president's user ID. |
| `site/firebase-adapter.js` | Connects the app to Firebase (Google sign-in, database, photos, downloads). |
| `firestore.rules` | Database security rules. Paste into the Firebase console. |
| `tools/build_site.py` | Rebuilds `site/` after the app changes. |

## Setting up Firebase (one time, free)

1. Go to https://console.firebase.google.com and click **Create a project**. Use a Google account made for Student Council, not a personal one. Google Analytics isn't needed.
2. **Authentication → Get started → Google → Enable**, then save.
3. **Authentication → Settings → Authorized domains → Add domain:** `marcusvance948.github.io`
4. **Firestore Database → Create database.** Pick a location near you and start in **production mode**.
5. **Project settings (gear icon) → General → Your apps → Web (`</>`)**. Register an app called "Student Hub" (no Firebase Hosting), then copy the `firebaseConfig` values into `site/firebase-config.js`.
6. Open the site and sign in with Google. A box at the bottom shows your user ID. Paste it into `site/firebase-config.js` (`OWNER_UID`) and into `firestore.rules` (replace `PASTE_PRESIDENT_UID`).
7. **Firestore Database → Rules:** replace everything with the contents of `firestore.rules` and click **Publish**.
8. Push the updated `site/firebase-config.js` and refresh the site. You're the president.

Optional: to let only school accounts sign up, vote and suggest, edit `allowedEmail()` in `firestore.rules`.

### Photos

Firebase's file storage now needs a paid plan, so photos are shrunk and stored in Firestore instead, around 100 to 500 KB each. The free plan holds about 1 GB, a few thousand photos. If the site outgrows that, move photos to Firebase Storage on the Blaze plan.

## The student list

One Google Sheet drives who can join and what they can do. Give it these column headers (see `student-list-template.csv`):

| Column | What goes in it |
|---|---|
| Email | The student's sign-in email |
| Name | Shown on the leaderboard and birthday banners |
| Grade | 9 to 12. Sets their Grade Race team |
| Birthday | Month and day, like 3/14. Optional |
| StuCo | "yes" for council members |
| Club leader | The club's name, exactly as listed on the Clubs page. Separate several with a semicolon |

To load it, the president selects the cells in the sheet, copies them, and pastes them under Members → President controls → Student list, then clicks Import list. Importing again replaces the old list. The site keeps its own copy, so the sheet is not read live; re-import after changes.

Club leaders can post updates and photos for their club. Each post waits on the Clubs page until any council member approves it.

## Lost and found deck in Google Slides

`tools/google-slides/` keeps a Google Slides deck in sync with the lost and found page: a title slide, then one slide per open item with its photo and details. It refreshes every hour, so the deck's share link is always current.

Set it up once, signed in to the Google account that created the Firebase project:

1. Create a blank deck in Google Slides and name it, for example "Avenues Lost and Found".
2. **Extensions → Apps Script.**
3. Click the gear (Project Settings) and turn on **Show "appsscript.json" manifest file in editor**.
4. Back in the editor, replace `appsscript.json` with `tools/google-slides/appsscript.json`, and `Code.gs` with `tools/google-slides/Code.gs`. Save.
5. Reload the deck. A **Lost and found** menu appears. Choose **Refresh automatically every hour** and allow the permissions Google asks for.
6. Share the deck (Share → Anyone with the link can view) and paste its link into the site under StuCo → Lost and found → Connect a deck.

## Updating the website

```bash
python3 tools/build_site.py
git add -A && git commit -m "Update site"
git push origin main
SPLIT=$(git subtree split --prefix site)
git push origin "${SPLIT}:refs/heads/pages"
```

## Getting listed on Google

1. Go to https://search.google.com/search-console and add the property `https://marcusvance948.github.io/Atlas/` using the **URL prefix** option.
2. To verify, pick **HTML tag**, copy the `<meta name="google-site-verification" ...>` tag, and add it to the head in `tools/build_site.py`. Rebuild, push, then click **Verify**.
3. Under **Sitemaps**, submit `sitemap.xml`. Then use **URL inspection → Request indexing**.

Google usually lists a new site within a few days to two weeks.
