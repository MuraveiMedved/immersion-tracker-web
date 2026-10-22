// Runs sync-backend/Code.gs locally against in-memory fakes of Sheets, Drive and the other Apps
// Script services, so account sync can be tried without deploying anything.
//   node test/fake-sync-server.mjs     -> http://localhost:8798/exec
import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import { randomUUID, createHash } from 'node:crypto'
import vm from 'node:vm'

const code = readFileSync(new URL('../sync-backend/Code.gs', import.meta.url), 'utf8')
const sheets = new Map()
const files = new Map()
const props = new Map()
const cache = new Map()

function makeSheet() {
  const rows = []
  return {
    appendRow: (r) => { rows.push([...r]) },
    setFrozenRows: () => {},
    getLastRow: () => rows.length,
    getLastColumn: () => rows.reduce((m, r) => Math.max(m, r.length), 0),
    deleteRow: (i) => { rows.splice(i - 1, 1) },
    getRange: (row, col, nRows = 1, nCols = 1) => ({
      getValues: () => Array.from({ length: nRows }, (_, i) => Array.from({ length: nCols }, (_, j) => rows[row - 1 + i]?.[col - 1 + j] ?? '')),
      setValue: (v) => { (rows[row - 1] ||= [])[col - 1] = v },
    }),
  }
}

function makeFile(id, content) {
  files.set(id, content)
  return {
    getId: () => id,
    getBlob: () => ({ getDataAsString: () => files.get(id) }),
    setContent: (t) => { files.set(id, t) },
  }
}

const context = vm.createContext({
  SpreadsheetApp: { getActiveSpreadsheet: () => ({ getSheetByName: (n) => sheets.get(n) || null, insertSheet: (n) => { const s = makeSheet(); sheets.set(n, s); return s } }) },
  LockService: { getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => {} }) },
  ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (t) => ({ text: t, setMimeType() { return this } }) },
  PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => props.get(k) ?? null, setProperty: (k, v) => props.set(k, String(v)), deleteProperty: (k) => props.delete(k) }) },
  CacheService: { getScriptCache: () => ({ get: (k) => cache.get(k) ?? null, put: (k, v) => cache.set(k, String(v)), remove: (k) => cache.delete(k) }) },
  DriveApp: {
    createFolder: () => ({ getId: () => 'folder', createFile: (name, content) => makeFile(randomUUID(), content) }),
    getFolderById: () => ({ createFile: (name, content) => makeFile(randomUUID(), content) }),
    getFileById: (id) => { if (!files.has(id)) throw new Error('no file'); return makeFile(id, files.get(id)) },
  },
  Utilities: {
    getUuid: () => randomUUID(),
    DigestAlgorithm: { SHA_256: 'sha256' },
    Charset: { UTF_8: 'utf8' },
    sleep: () => {},
    computeDigest: (alg, text) => [...createHash('sha256').update(text).digest()].map((b) => (b > 127 ? b - 256 : b)),
  },
  Date, JSON, Math, Number, String, Object, Array, Error, isFinite,
})
vm.runInContext(code, context)

createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  if (req.method === 'OPTIONS') { res.end(); return }
  let body = ''
  req.on('data', (c) => { body += c })
  req.on('end', () => {
    const out = req.method === 'POST' ? context.doPost({ postData: { contents: body } }) : context.doGet()
    res.setHeader('Content-Type', 'application/json')
    res.end(out.text)
  })
}).listen(8798, () => console.log('Fake sync server on http://localhost:8798/exec'))
