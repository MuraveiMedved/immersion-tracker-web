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
 * Actions (POST, JSON body): ping, create, push, pull, linkCode, linkClaim, devices, unlink.
 * See SETUP.md for deploying.
 */

var SYNC_VERSION = 1;
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

function doGet() {
  return json_({ ok: true, service: 'immersion-tracker-sync', version: SYNC_VERSION });
}

function doPost(e) {
  var lock = null;
  try {
    var req = JSON.parse(e.postData.contents);
    var now = Date.now();
    if (req.action === 'ping') return json_({ ok: true, version: SYNC_VERSION });
    lock = LockService.getScriptLock();
    lock.waitLock(25000);
    switch (req.action) {
      case 'create': return json_(create_(req, now));
      case 'push': return json_(push_(req, now));
      case 'pull': return json_(pull_(req, now));
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

/** The device row for req.token (and its account), or throws. Notes the device was just seen. */
function device_(token, now) {
  token = String(token || '');
  if (token.length < 32) throw new Error('This device isn\'t signed in');
  var h = hash_(token);
  var sheet = sheet_(DEVICES_SHEET, DEVICE_HEADERS);
  var rows = rows_(sheet);
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i][0]) === h) {
      sheet.getRange(i + 2, 5).setValue(now);
      return { accountId: String(rows[i][1]), row: i + 2, tokenHash: h };
    }
  }
  throw new Error('This device was signed out - sign in again with a code or your recovery key');
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
  return { coll: r.coll, id: id, updatedAt: updatedAt, deleted: deleted, data: data };
}

/** Merges the device's changed records, newest edit winning. Replies with the new revision; the
 *  device then pulls whatever it hasn't seen. */
function push_(req, now) {
  var device = device_(req.token, now);
  var account = account_(device.accountId);
  var doc = readDoc_(account.fileId);
  var changes = Array.isArray(req.changes) ? req.changes.slice(0, MAX_PUSH) : [];
  var accepted = 0;
  changes.forEach(function (raw) {
    var r = cleanRecord_(raw);
    if (!r) return;
    var key = r.coll + ':' + r.id;
    var old = doc.records[key];
    // Never later than "now" here - a device with a clock running fast can't win every conflict
    // for ever after.
    r.updatedAt = Math.min(r.updatedAt, now + 60 * 1000);
    if (old && old.updatedAt > r.updatedAt) return;
    doc.rev += 1;
    r.rev = doc.rev;
    doc.records[key] = r;
    accepted++;
  });
  if (accepted) writeDoc_(account.fileId, doc);
  sheet_(ACCOUNTS_SHEET, ACCOUNT_HEADERS).getRange(account.row, 5).setValue(now);
  return { ok: true, version: SYNC_VERSION, rev: doc.rev, accepted: accepted, taken: changes.length };
}

/** Every record changed after req.sinceRev, oldest first, a page at a time. */
function pull_(req, now) {
  var device = device_(req.token, now);
  var account = account_(device.accountId);
  var doc = readDoc_(account.fileId);
  var since = Number(req.sinceRev) || 0;
  var out = [];
  Object.keys(doc.records).forEach(function (key) {
    var r = doc.records[key];
    if (r.rev > since) out.push(r);
  });
  out.sort(function (a, b) { return a.rev - b.rev; });
  var more = out.length > PULL_PAGE;
  if (more) out = out.slice(0, PULL_PAGE);
  return { ok: true, version: SYNC_VERSION, rev: more ? out[out.length - 1].rev : doc.rev, more: more, records: out, accountId: device.accountId };
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
  var list = rows_(sheet_(DEVICES_SHEET, DEVICE_HEADERS))
    .filter(function (row) { return String(row[1]) === device.accountId; })
    .map(function (row) {
      return { id: String(row[0]).slice(0, 10), name: String(row[2] || 'Device'), lastSeen: Number(row[4]) || 0, thisDevice: String(row[0]) === device.tokenHash };
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
    if (String(rows[i][1]) === device.accountId && String(rows[i][0]).slice(0, 10) === target) sheet.deleteRow(i + 2);
  }
  return { ok: true, version: SYNC_VERSION };
}
