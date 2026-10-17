# Immersion Tracker - web

The Android app's features for iPhone, iPad, Mac and PC, as an installable web app (PWA): Home
(manual sessions, goal rings, streaks, Momentum), Entries + Stats, Social (races and friends on the
same race server as the phones), the Zoo, Settings (languages, appearance, imports, backups).
Not included: automatic tracking (a browser can't see other apps) and the book reader.

    npm install
    npm run dev       # http://localhost:5199 (also copies the Zoo catalog from ../app assets)
    npm run build     # static site in dist/ - host anywhere (GitHub Pages, Netlify, ...)
    npm test          # rule tests (Momentum, streaks, race scoring, eggs, imports)

Data lives in the browser (IndexedDB). With an account (Settings > Account & sync) it's also saved
online and synced between devices through the sync Apps Script in `sync-backend/` (see its
SETUP.md). Settings > Backup downloads/restores a file; Settings > Import reads a phone backup zip,
Toggl or PolyLogger CSVs.

Deploy: pushing to `main` on GitHub builds and publishes the site via
`.github/workflows/pages.yml` (repo Settings > Pages > Source: GitHub Actions). The Zoo photos in
`public/zoo` are committed, since the CI has no copy of the Android app's assets.

`node test/fake-sync-server.mjs` does the same for the sync script (port 8798).
`node test/fake-race-server.mjs` runs race-backend/Code.gs locally against an in-memory sheet
(http://localhost:8799/exec) - set it as the race server link to try races without touching the
real Sheet.

## Phone <-> web sync check

The Android app syncs with the same accounts (`app/.../data/websync/`). After changing what gets
synced, on either side:

1. `node test/fake-sync-server.mjs` (local copy of the sync script, port 8798).
2. In `Tracker APP`: `WEBSYNC_LIVE=1 ./gradlew testDebugUnitTest --tests "*WebSyncLiveTest.step1*"` -
   a phone makes an account and writes its recovery key to `/tmp/claude-501/websync-live-key.txt`.
3. Web app (dev server, a fresh origin such as http://webtest.localhost:5199): in the console
   `await __tracker.sync.joinAccount({ key: '<key>', url: 'http://localhost:8798/exec' })`, then add a
   language "Korean", a session titled "Added in the web app", rename "Phone session 10" to
   "Edited in the web app", hatch the Epic egg, and `await __tracker.sync.syncNow()`.
4. `WEBSYNC_LIVE=1 ./gradlew testDebugUnitTest --tests "*WebSyncLiveTest.step2*"` - a phone with the
   same history joins and checks it got all of that, without doubles.
