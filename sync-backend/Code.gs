/**
 * Immersion Tracker web - account sync backend.
 *
 * A Google Apps Script bound to a Google Sheet, deployed as a web app ("Anyone" can access). It is
 * separate from the race server on purpose: races keep working whatever happens here.
 *
 * Each account's data is one JSON file in a Drive folder ("Immersion Tracker web sync"); the
 * Sheet only indexes accounts, devices and link codes, so it stays small and readable. A device
 * proves who it is with a long secret token (only its SHA-256 is stored here).
 *
 * Data is a set of records {coll, id, updatedAt, deleted, data}. A push merges records one by one -
 * the newer updatedAt wins (ties go to the newcomer) - and gives every accepted record the next
 * revision number; a pull returns everything after the revision a device last saw. Deletes are kept
 * as tombstones so they reach every device.
 *
 * Actions (POST, JSON body): ping, create, push, pull, sync, manifest, get, linkCode, linkClaim,
 * devices, unlink.
 * See SETUP.md for deploying.
 *
 * Speed (v2): every call used to queue for one script-wide lock and read the whole account file
 * from Drive. Now a pull takes no lock (a push replaces the file in one write, so a pull sees it
 * whole, before or after); an account's latest revision is kept in script properties, so a device
 * that's up to date is answered without opening the file; 'sync' is a push and the first pull page
 * in one call; and which account a token belongs to is cached rather than looked up in the Sheet.
 *
 * First stop stands (v3): a session running on the phone can be stopped in the web app, but the
 * phone only hears that on its next sync - if it stops the session itself first (paused the
 * player), its later stop used to win as the newer edit, undoing the web's stop and counting the
 * time twice next to the timer started on the computer. A device that saw an entry running and now
 * sends it stopped marks the change 'closes'; if the account already has that session stopped
 * earlier (or discarded), that's kept and the device takes it on its pull. Older devices don't
 * send the mark and are merged as before.
 *
 * Lighter (v5):
 * - A journal: a push used to rewrite the whole account file, however little it added. Records
 *   pushed since the file was last written now go into a small second file (its id in script
 *   properties, 'journal:<accountId>'), folded into the account file once it holds JOURNAL_FOLD
 *   records. The account file then holds everything up to revision 'baseRev:<accountId>', and a
 *   pull from at or after that reads only the journal. Accounts without one carry on as before
 *   until their next push makes it.
 * - No echo: the reply to 'sync' leaves out the records that very call took (the device has them
 *   as it sent them), and 'push'/'sync' replies list the revision each one got ('revs').
 * - The daily check for missing records: 'manifest' answers each record's revision (no data) and
 *   'get' the records a device asks for, so it fetches only what it hasn't seen rather than the
 *   whole account. Older devices still read everything with 'pull', which works as before.
 */

var SYNC_VERSION = 5;
var ACCOUNTS_SHEET = 'Accounts';
var ACCOUNT_HEADERS = ['accountId', 'fileId', 'name', 'createdAt', 'lastSeen'];
var DEVICES_SHEET = 'Devices';
var DEVICE_HEADERS = ['tokenHash', 'accountId', 'deviceName', 'createdAt', 'lastSeen'];
var LINK_SHEET = 'LinkCodes';
var LINK_HEADERS = ['code', 'accountId', 'expiresAt'];
var FOLDER_NAME = 'Immersion Tracker web sync';
var COLLECTIONS = { entry: 1, profile: 1, opening: 1, grant: 1, tradeIn: 1, egg: 1, prefs: 1 };
var CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
var LINK_CODE_MILLIS = 10 * 60 * 1000;
var MAX_RECORD_CHARS = 30000;
var MAX_PUSH = 3000;
var PULL_PAGE = 4000;
/** Records the journal holds before they're folded into the account file (see v5 above). */
var JOURNAL_FOLD = 400;
/** Most records one 'get' returns. */
var GET_MAX = 2000;
/** A device's "last seen" (Settings > Your devices) is noted at most this often. */
var SEEN_EVERY_MILLIS = 10 * 60 * 1000;
/** How long a token -> account lookup is cached (CacheService's longest). */
var DEVICE_CACHE_SECONDS = 6 * 60 * 60;
/** Re-reads of an account file that comes back older than its last write (see fullDoc_). */
var STALE_RETRIES = 4;
var STALE_WAIT_MILLIS = 1500;

function doGet() {
  return json_({ ok: true, service: 'immersion-tracker-sync', version: SYNC_VERSION });
}

function doPost(e) {
  var lock = null;
  try {
    var req = JSON.parse(e.postData.contents);
    var now = Date.now();
    if (req.action === 'ping') return json_({ ok: true, version: SYNC_VERSION });
    // Only reads, so they don't queue behind another device's push.
    if (req.action === 'pull') return json_(pull_(req, now));
    if (req.action === 'manifest') return json_(manifest_(req, now));
    if (req.action === 'get') return json_(get_(req, now));
    lock = LockService.getScriptLock();
    lock.waitLock(25000);
    switch (req.action) {
      case 'create': return json_(create_(req, now));
      case 'push': return json_(push_(req, now));
      case 'sync': return json_(sync_(req, now));
      case 'linkCode': return json_(linkCode_(req, now));
      case 'linkClaim': return json_(linkClaim_(req, now));
      case 'devices': return json_(devices_(req, now));
      case 'unlink': return json_(unlink_(req, now));
      default: throw new Error('Unknown action: ' + req.action);
    }
  } catch (err) {
    return json_({ ok: false, error: String((err && err.message) || err) });
  } finally {
    if (lock) { try { lock.releaseLock(); } catch (ignored) {} }
  }
}

function json_(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
}

function sheet_(name, headers) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(headers);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function rows_(sheet) {
  var last = sheet.getLastRow();
  if (last < 2) return [];
  return sheet.getRange(2, 1, last - 1, sheet.getLastColumn()).getValues();
}

function hash_(text) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(text), Utilities.Charset.UTF_8);
  return bytes.map(function (b) { return ('0' + (b & 255).toString(16)).slice(-2); }).join('');
}

function newToken_() {
  return Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
}

function folder_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('folderId');
  if (id) {
    try { return DriveApp.getFolderById(id); } catch (ignored) {}
  }
  var folder = DriveApp.createFolder(FOLDER_NAME);
  props.setProperty('folderId', folder.getId());
  return folder;
}

function readDoc_(fileId) {
  var text = DriveApp.getFileById(fileId).getBlob().getDataAsString('UTF-8');
  var doc = text ? JSON.parse(text) : null;
  return doc && doc.records ? doc : { rev: 0, records: {} };
}

function writeDoc_(fileId, doc) {
  DriveApp.getFileById(fileId).setContent(JSON.stringify(doc));
}

/** The device for req.token - {accountId, fileId, tokenHash} - or throws. Notes it was just seen
 *  (in script properties, not the Sheet: a pull holds no lock, and a row can move while it runs). */
function device_(token, now) {
  token = String(token || '');
  if (token.length < 32) throw new Error('This device isn\'t signed in');
  var h = hash_(token);
  var cache = CacheService.getScriptCache();
  var cached = cache.get('dev:' + h);
  var device = cached ? JSON.parse(cached) : null;
  if (!device) {
    var rows = rows_(sheet_(DEVICES_SHEET, DEVICE_HEADERS));
    for (var i = 0; i < rows.length && !device; i++) {
      if (String(rows[i][0]) === h) device = { accountId: String(rows[i][1]), fileId: account_(String(rows[i][1])).fileId, tokenHash: h, seen: 0 };
    }
    if (!device) throw new Error('This device was signed out - sign in again with a code or your recovery key');
  }
  if (now - device.seen >= SEEN_EVERY_MILLIS) {
    PropertiesService.getScriptProperties().setProperty('seen:' + h, String(now));
    device.seen = now;
    cache.put('dev:' + h, JSON.stringify(device), DEVICE_CACHE_SECONDS);
  }
  return device;
}

function forgetDevice_(tokenHash) {
  CacheService.getScriptCache().remove('dev:' + tokenHash);
  PropertiesService.getScriptProperties().deleteProperty('seen:' + tokenHash);
}

/** The account's latest revision, or null if not noted yet (an account last pushed to before v2). */
function savedRev_(accountId) {
  var v = PropertiesService.getScriptProperties().getProperty('rev:' + accountId);
  return v == null ? null : Number(v);
}

function account_(accountId) {
  var rows = rows_(sheet_(ACCOUNTS_SHEET, ACCOUNT_HEADERS));
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i][0]) === accountId) return { fileId: String(rows[i][1]), name: String(rows[i][2] || ''), row: i + 2 };
  }
  throw new Error('That account no longer exists');
}

function addDevice_(accountId, name, now) {
  var token = newToken_();
  sheet_(DEVICES_SHEET, DEVICE_HEADERS).appendRow([hash_(token), accountId, String(name || 'Device').slice(0, 60), now, now]);
  return token;
}

function create_(req, now) {
  var accountId = Utilities.getUuid();
  var file = folder_().createFile(accountId + '.json', JSON.stringify({ rev: 0, records: {} }), 'application/json');
  sheet_(ACCOUNTS_SHEET, ACCOUNT_HEADERS).appendRow([accountId, file.getId(), String(req.name || '').slice(0, 40), now, now]);
  PropertiesService.getScriptProperties().setProperty('rev:' + accountId, '0');
  var token = addDevice_(accountId, req.deviceName, now);
  return { ok: true, version: SYNC_VERSION, accountId: accountId, token: token };
}

function cleanRecord_(r) {
  if (!r || !COLLECTIONS[r.coll]) return null;
  var id = String(r.id == null ? '' : r.id).slice(0, 80);
  if (!id) return null;
  var updatedAt = Number(r.updatedAt);
  if (!isFinite(updatedAt) || updatedAt <= 0) return null;
  var deleted = !!r.deleted;
  var data = deleted ? null : r.data;
  if (!deleted && (data === undefined || JSON.stringify(data).length > MAX_RECORD_CHARS)) return null;
  return { coll: r.coll, id: id, updatedAt: updatedAt, deleted: deleted, data: data, closes: !deleted && r.closes === true };
}

/** Whether [old] - the account's copy of an entry a device is now sending stopped ('closes') -
 *  was already stopped no later than that, or discarded, by another device. */
function stoppedFirst_(old, r) {
  if (r.coll !== 'entry' || !old) return false;
  if (old.deleted) return true;
  var end = old.data && old.data.endTimeMillis;
  return end != null && r.data && r.data.endTimeMillis != null && Number(end) <= Number(r.data.endTimeMillis);
}

/** Merges [changes] into [doc], newest edit winning; returns the records taken. */
function merge_(doc, changes, now) {
  var accepted = [];
  changes.forEach(function (raw) {
    var r = cleanRecord_(raw);
    if (!r) return;
    var key = r.coll + ':' + r.id;
    var old = doc.records[key];
    // Never later than "now" here - a device with a clock running fast can't win every conflict
    // for ever after.
    r.updatedAt = Math.min(r.updatedAt, now + 60 * 1000);
    if (old && old.updatedAt > r.updatedAt) return;
    var closes = r.closes;
    delete r.closes;
    if (closes && stoppedFirst_(old, r)) return;
    doc.rev += 1;
    r.rev = doc.rev;
    doc.records[key] = r;
    accepted.push(r);
  });
  return accepted;
}

/** The account's journal - {rev, records} pushed since the account file was last written - and
 *  its file id; null when it has none yet (an account last pushed to before v5). */
function journal_(accountId) {
  var id = PropertiesService.getScriptProperties().getProperty('journal:' + accountId);
  if (!id) return null;
  var doc = readDoc_(id);
  return { id: id, rev: doc.rev, records: doc.records };
}

/** The revision the account file holds everything up to, or null without a journal. */
function baseRev_(accountId) {
  var v = PropertiesService.getScriptProperties().getProperty('baseRev:' + accountId);
  return v == null ? null : Number(v);
}

/**
 * The whole account: the account file with the journal's records over it, and the journal (null
 * if none). Drive can hand back a copy from before its last write for a moment; merging into that
 * and writing it back loses what that write added, and numbers new records with revisions devices
 * have already pulled past (so they never see them). With [retry] (a push), a copy older than the
 * revision noted after each write is read again for a few seconds, and if it's still behind,
 * revisions are at least never let go backwards (devices re-send anything lost - 'Missing
 * records' in sync.js / WebSyncRepository).
 */
function fullDoc_(device, retry) {
  var saved = savedRev_(device.accountId);
  var journal = journal_(device.accountId);
  // With a journal, the account file only has to be as new as its last fold.
  var fileWant = journal ? baseRev_(device.accountId) : saved;
  var behind = function (doc, want) { return retry && want != null && doc.rev < want; };
  var doc = readDoc_(device.fileId);
  for (var tries = 0; behind(doc, fileWant) && tries < STALE_RETRIES; tries++) {
    Utilities.sleep(STALE_WAIT_MILLIS);
    doc = readDoc_(device.fileId);
  }
  for (var t = 0; journal && behind(journal, saved) && t < STALE_RETRIES; t++) {
    Utilities.sleep(STALE_WAIT_MILLIS);
    journal = journal_(device.accountId);
  }
  if (journal) {
    Object.keys(journal.records).forEach(function (key) { doc.records[key] = journal.records[key]; });
    doc.rev = Math.max(doc.rev, journal.rev);
  }
  if (retry && saved != null && doc.rev < saved) doc.rev = saved;
  return { doc: doc, journal: journal };
}

/** Merges the device's records into its account (under the lock). What it takes goes into the
 *  journal, folded into the account file once that's big enough (see v5 above). Files are written
 *  before the revision is noted, so a pull that sees the new revision always finds what has it. */
function pushInto_(device, req, now) {
  var account = fullDoc_(device, true);
  var doc = account.doc;
  var changes = Array.isArray(req.changes) ? req.changes.slice(0, MAX_PUSH) : [];
  var before = doc.rev;
  var taken = merge_(doc, changes, now);
  if (taken.length) {
    var props = PropertiesService.getScriptProperties();
    var journal = account.journal;
    if (!journal) {
      // The account file holds everything up to before this push; what follows goes in the journal.
      props.setProperty('baseRev:' + device.accountId, String(before));
      journal = { id: null, rev: 0, records: {} };
    }
    taken.forEach(function (r) { journal.records[r.coll + ':' + r.id] = r; });
    journal.rev = doc.rev;
    if (Object.keys(journal.records).length >= JOURNAL_FOLD) {
      writeDoc_(device.fileId, doc);
      props.setProperty('baseRev:' + device.accountId, String(doc.rev));
      journal.records = {};
    }
    var text = JSON.stringify({ rev: journal.rev, records: journal.records });
    if (journal.id) {
      DriveApp.getFileById(journal.id).setContent(text);
    } else {
      var file = folder_().createFile(device.accountId + '.journal.json', text, 'application/json');
      props.setProperty('journal:' + device.accountId, file.getId());
    }
  }
  var saved = savedRev_(device.accountId);
  if (saved == null || doc.rev > saved) PropertiesService.getScriptProperties().setProperty('rev:' + device.accountId, String(doc.rev));
  var revs = {};
  taken.forEach(function (r) { revs[r.coll + ':' + r.id] = r.rev; });
  return { doc: doc, accepted: taken.length, taken: changes.length, revs: revs };
}

/** One page of the records in [doc] changed after [since], oldest first - leaving out those in
 *  [skip] ({key: rev} a 'sync' just took from the device asking). */
function page_(doc, since, accountId, skip) {
  var out = [];
  Object.keys(doc.records).forEach(function (key) {
    var r = doc.records[key];
    if (r.rev > since && !(skip && skip[key] === r.rev)) out.push(r);
  });
  out.sort(function (a, b) { return a.rev - b.rev; });
  var more = out.length > PULL_PAGE;
  if (more) out = out.slice(0, PULL_PAGE);
  return { ok: true, version: SYNC_VERSION, rev: more ? out[out.length - 1].rev : doc.rev, more: more, records: out, accountId: accountId };
}

/** Merges the device's changed records. Replies with the new revision; the device then pulls
 *  whatever it hasn't seen (or uses 'sync', which does both). */
function push_(req, now) {
  var device = device_(req.token, now);
  var result = pushInto_(device, req, now);
  return { ok: true, version: SYNC_VERSION, rev: result.doc.rev, accepted: result.accepted, taken: result.taken, revs: result.revs };
}

/** A push and the first page of what the device hasn't seen - without what it just sent - from
 *  one read of the account. If 'more' is set, the device carries on with 'pull'. */
function sync_(req, now) {
  var device = device_(req.token, now);
  var result = pushInto_(device, req, now);
  var reply = page_(result.doc, Number(req.sinceRev) || 0, device.accountId, result.revs);
  reply.accepted = result.accepted;
  reply.taken = result.taken;
  reply.revs = result.revs;
  return reply;
}

/** Every record changed after req.sinceRev, oldest first, a page at a time. Takes no lock; a device
 *  already up to date gets its answer without a file being opened, and one behind by only what's
 *  in the journal gets it from the journal alone. */
function pull_(req, now) {
  var device = device_(req.token, now);
  var since = Number(req.sinceRev) || 0;
  var rev = savedRev_(device.accountId);
  if (rev != null && since >= rev) return { ok: true, version: SYNC_VERSION, rev: since, more: false, records: [], accountId: device.accountId };
  var baseRev = baseRev_(device.accountId);
  if (baseRev != null && since >= baseRev) {
    var journal = journal_(device.accountId);
    if (journal) return page_({ rev: journal.rev, records: journal.records }, since, device.accountId);
  }
  return page_(fullDoc_(device, false).doc, since, device.accountId);
}

/** Every record's revision, tombstones included, as {coll: {id: rev}} - no data. With 'get',
 *  what a device's daily check for missing records uses instead of pulling everything. */
function manifest_(req, now) {
  var device = device_(req.token, now);
  var doc = fullDoc_(device, false).doc;
  var out = {};
  Object.keys(doc.records).forEach(function (key) {
    var r = doc.records[key];
    (out[r.coll] = out[r.coll] || {})[r.id] = r.rev;
  });
  return { ok: true, version: SYNC_VERSION, rev: doc.rev, manifest: out };
}

/** The records req.keys ('coll:id', at most GET_MAX) name, as they are now - any it hasn't are
 *  left out. */
function get_(req, now) {
  var device = device_(req.token, now);
  var doc = fullDoc_(device, false).doc;
  var keys = Array.isArray(req.keys) ? req.keys.slice(0, GET_MAX) : [];
  var out = [];
  keys.forEach(function (key) { if (doc.records[String(key)]) out.push(doc.records[String(key)]); });
  return { ok: true, version: SYNC_VERSION, rev: doc.rev, records: out };
}

function linkCode_(req, now) {
  var device = device_(req.token, now);
  var sheet = sheet_(LINK_SHEET, LINK_HEADERS);
  var rows = rows_(sheet);
  for (var i = rows.length - 1; i >= 0; i--) {
    if (String(rows[i][1]) === device.accountId || Number(rows[i][2]) < now) sheet.deleteRow(i + 2);
  }
  var taken = {};
  rows_(sheet).forEach(function (row) { taken[String(row[0])] = true; });
  var code = '';
  for (var attempt = 0; attempt < 50 && (!code || taken[code]); attempt++) {
    code = '';
    for (var j = 0; j < 6; j++) code += CODE_ALPHABET.charAt(Math.floor(Math.random() * CODE_ALPHABET.length));
  }
  sheet.appendRow([code, device.accountId, now + LINK_CODE_MILLIS]);
  return { ok: true, version: SYNC_VERSION, code: code, expiresAt: now + LINK_CODE_MILLIS };
}

/** A new device trades a link code (shown on a signed-in device) for its own token. */
function linkClaim_(req, now) {
  var code = String(req.code || '').trim().toUpperCase();
  if (!code) throw new Error('Enter the code from your other device');
  var sheet = sheet_(LINK_SHEET, LINK_HEADERS);
  var rows = rows_(sheet);
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i][0]) !== code) continue;
    if (Number(rows[i][2]) < now) throw new Error('That code has expired - get a new one');
    var accountId = String(rows[i][1]);
    sheet.deleteRow(i + 2);
    return { ok: true, version: SYNC_VERSION, accountId: accountId, token: addDevice_(accountId, req.deviceName, now) };
  }
  throw new Error('That code isn\'t right - check it on your other device');
}

function devices_(req, now) {
  var device = device_(req.token, now);
  var props = PropertiesService.getScriptProperties();
  var list = rows_(sheet_(DEVICES_SHEET, DEVICE_HEADERS))
    .filter(function (row) { return String(row[1]) === device.accountId; })
    .map(function (row) {
      var seen = Number(props.getProperty('seen:' + String(row[0]))) || 0;
      return { id: String(row[0]).slice(0, 10), name: String(row[2] || 'Device'), lastSeen: Math.max(Number(row[4]) || 0, seen), thisDevice: String(row[0]) === device.tokenHash };
    });
  return { ok: true, version: SYNC_VERSION, devices: list };
}

/** Signs a device out (req.deviceId from 'devices'; blank = this one). */
function unlink_(req, now) {
  var device = device_(req.token, now);
  var target = String(req.deviceId || device.tokenHash.slice(0, 10));
  var sheet = sheet_(DEVICES_SHEET, DEVICE_HEADERS);
  var rows = rows_(sheet);
  for (var i = rows.length - 1; i >= 0; i--) {
    if (String(rows[i][1]) === device.accountId && String(rows[i][0]).slice(0, 10) === target) {
      sheet.deleteRow(i + 2);
      forgetDevice_(String(rows[i][0]));
    }
  }
  return { ok: true, version: SYNC_VERSION };
}
