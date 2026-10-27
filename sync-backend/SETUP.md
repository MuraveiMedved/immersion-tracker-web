# Sync server setup (one time)

The web app's accounts live in a separate Apps Script from the race server, so races keep working
whatever happens here. Each account is one JSON file in a Drive folder the script makes
("Immersion Tracker web sync"); the Sheet holds the account, device and link-code lists.

1. Make a new Google Sheet (e.g. "Immersion Tracker web sync").
2. Extensions > Apps Script. Replace everything in Code.gs with this folder's Code.gs and save.
3. Deploy > New deployment > type **Web app**. Execute as: **Me**. Who has access: **Anyone**.
   Deploy, allow the Drive/Sheets permissions it asks for, and copy the **Web app URL** (ends in /exec).
4. Put that URL in `web/src/model/sync.js` as `DEFAULT_SYNC_URL` (or paste it in the app under
   Settings > Account & sync).
5. Later changes: Deploy > Manage deployments > edit > Version: **New version** (keeps the URL).

Notes
- Everyone's synced history ends up in your Drive - you (the owner) can read it.
- Anyone with the URL can create accounts. Fine while the app is shared with friends; add a
  limit before announcing it publicly.
- Try changes locally first: `node test/fake-sync-server.mjs`, then use http://localhost:8798/exec
  as the sync server link.
- Version 5 (lighter syncs): each account gets a second Drive file, `<accountId>.journal.json`,
  holding what was pushed since the account file was last rewritten (folded in every 400
  records). Don't roll back to version 4 once 5 has run: v4 doesn't read the journal, so records
  in it would look missing until devices sent them again. Older apps keep working with v5.
  Tests: `npm test` runs `test/sync-server.test.js`, which checks v5 against v4
  (`test/sync-backend-v4.gs`), including an account v4 wrote.
