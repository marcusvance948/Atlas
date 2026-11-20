# Atlas

Read `HANDOFF.md` first. It explains the app, the build, and how to publish.

## Rules for collaborators
- Never push to `main` or `pages`. Both are protected, and the owner approves every change.
- Make each change on its own branch, run `python3 tools/build_site.py`, commit, push the branch, and open a pull request against `main` (`gh pr create --base main`).
- Only the owner publishes, by merging the pull request. The site then publishes itself (`.github/workflows/publish.yml`).
