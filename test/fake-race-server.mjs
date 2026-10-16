// Runs race-backend/Code.gs locally with an in-memory fake of the Apps Script services, so the web
// app's races and friends can be tried without touching the real Google Sheet.
//   node test/fake-race-server.mjs        -> http://localhost:8799/exec
// In the web app: Social -> Race server link -> http://localhost:8799/exec
import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import vm from 'node:vm'

const code = readFileSync(new URL('../../race-backend/Code.gs', import.meta.url), 'utf8')
const sheets = new Map()

function makeSheet(name) {
  const rows = []
  const sheet = {
    getName: () => name,
    appendRow: (r) => { rows.push([...r]) },
    setFrozenRows: () => {},
    getLastRow: () => rows.length,
    getLastColumn: () => rows.reduce((m, r) => Math.max(m, r.length), 0),
    insertRowBefore: (i) => { rows.splice(i - 1, 0, []) },
    deleteRow: (i) => { rows.splice(i - 1, 1) },
    getRange: (row, col, nRows = 1, nCols = 1) => ({
      getValues: () => Array.from({ length: nRows }, (_, i) => Array.from({ length: nCols }, (_, j) => rows[row - 1 + i]?.[col - 1 + j] ?? '')),
      getValue: () => rows[row - 1]?.[col - 1] ?? '',
      setValue: (v) => { (rows[row - 1] ||= [])[col - 1] = v },
      setValues: (vals) => vals.forEach((r, i) => r.forEach((v, j) => { (rows[row - 1 + i] ||= [])[col - 1 + j] = v })),
    }),
  }
  return sheet
}

const context = vm.createContext({
  SpreadsheetApp: { getActiveSpreadsheet: () => ({ getSheetByName: (n) => sheets.get(n) || null, insertSheet: (n) => { const s = makeSheet(n); sheets.set(n, s); return s } }) },
  LockService: { getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => {} }) },
  ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (t) => ({ text: t, setMimeType() { return this } }) },
  Utilities: { getUuid: () => randomUUID() },
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
}).listen(8799, () => console.log('Fake race server on http://localhost:8799/exec'))
