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
