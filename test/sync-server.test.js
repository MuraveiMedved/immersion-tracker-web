// The sync server (sync-backend/Code.gs) run against in-memory fakes of Drive, Sheets and the other
// Apps Script services - checked against the version before it (sync-backend-v4.gs, as deployed
// until v5), including an account that version wrote.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { randomUUID, createHash } from 'node:crypto'
import vm from 'node:vm'

const CURRENT = new URL('../sync-backend/Code.gs', import.meta.url)
const V4 = new URL('./sync-backend-v4.gs', import.meta.url)

/** Shared storage - what a deployment keeps between versions. */
function storage() {
  return { sheets: new Map(), files: new Map(), props: new Map(), cache: new Map(), reads: new Map() }
}

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

/** [file] running on [st], with a clock the test moves. Returns call(body) -> reply. */
function server(file, st, clock) {
  const makeFile = (id, content) => {
    if (content !== undefined) st.files.set(id, content)
    return {
      getId: () => id,
      getBlob: () => ({ getDataAsString: () => { st.reads.set(id, (st.reads.get(id) || 0) + 1); return st.files.get(id) } }),
      setContent: (t) => { st.files.set(id, t) },
    }
  }
  const folder = { getId: () => 'folder', createFile: (name, content) => makeFile(randomUUID(), content) }
  const context = vm.createContext({
    SpreadsheetApp: { getActiveSpreadsheet: () => ({ getSheetByName: (n) => st.sheets.get(n) || null, insertSheet: (n) => { const s = makeSheet(); st.sheets.set(n, s); return s } }) },
    LockService: { getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => {} }) },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (t) => ({ text: t, setMimeType() { return this } }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => st.props.get(k) ?? null, setProperty: (k, v) => st.props.set(k, String(v)), deleteProperty: (k) => st.props.delete(k) }) },
    CacheService: { getScriptCache: () => ({ get: (k) => st.cache.get(k) ?? null, put: (k, v) => st.cache.set(k, String(v)), remove: (k) => st.cache.delete(k) }) },
    DriveApp: {
      createFolder: () => folder,
      getFolderById: () => folder,
      getFileById: (id) => { if (!st.files.has(id)) throw new Error('no file'); return makeFile(id) },
    },
    Utilities: {
      getUuid: () => randomUUID(),
      DigestAlgorithm: { SHA_256: 'sha256' },
      Charset: { UTF_8: 'utf8' },
      sleep: () => {},
      computeDigest: (alg, text) => [...createHash('sha256').update(text).digest()].map((b) => (b > 127 ? b - 256 : b)),
    },
    Date: class extends Date { static now() { return clock.now } },
    JSON, Math, Number, String, Object, Array, Error, isFinite,
  })
  vm.runInContext(readFileSync(file, 'utf8'), context)
  return (body) => {
    const reply = JSON.parse(context.doPost({ postData: { contents: JSON.stringify(body) } }).text)
    if (!reply.ok) throw new Error(reply.error)
    return reply
  }
}

const entry = (id, at, extra = {}) => ({ coll: 'entry', id: String(id), updatedAt: at, deleted: false, data: { id, startTimeMillis: at, ...extra } })

/** Everything after [since], every page. */
function pullAll(call, token, since = 0) {
  const out = []
  for (;;) {
    const r = call({ action: 'pull', token, sinceRev: since })
    out.push(...r.records)
    since = r.rev
    if (!r.more) return { records: out, rev: since }
  }
}

const byKey = (records) => Object.fromEntries(records.map((r) => [`${r.coll}:${r.id}`, r]))

test('a sync reply leaves out what it just took, and says what revision each got', () => {
  const clock = { now: 1_000_000 }
  const call = server(CURRENT, storage(), clock)
  const { token } = call({ action: 'create', name: 'a', deviceName: 'phone' })
  const other = call({ action: 'linkClaim', code: call({ action: 'linkCode', token }).code, deviceName: 'web' }).token
  call({ action: 'push', token: other, changes: [entry(1, 10)] })
  const reply = call({ action: 'sync', token, sinceRev: 0, changes: [entry(2, 20), entry(3, 30)] })
  // The other device's record comes; this one's own two don't.
  assert.deepEqual(reply.records.map((r) => r.id), ['1'])
  assert.deepEqual(reply.revs, { 'entry:2': 2, 'entry:3': 3 })
  assert.equal(reply.rev, 3)
  // The other device gets them on its pull.
  assert.deepEqual(pullAll(call, other, 1).records.map((r) => r.id), ['2', '3'])
})

test('a push goes into the journal; a pull from after the last fold reads only the journal', () => {
  const clock = { now: 1_000_000 }
  const st = storage()
  const call = server(CURRENT, st, clock)
  const { token, accountId } = call({ action: 'create', name: 'a', deviceName: 'phone' })
  const accountFile = st.sheets.get('Accounts').getRange(2, 2).getValues()[0][0]
  const before = st.files.get(accountFile)
  call({ action: 'push', token, changes: [entry(1, 10), entry(2, 20)] })
  assert.equal(st.files.get(accountFile), before) // the account file isn't rewritten
  assert.ok(st.props.get(`journal:${accountId}`))
  assert.equal(st.props.get(`baseRev:${accountId}`), '0')
  const reads = st.reads.get(accountFile) || 0
  assert.deepEqual(pullAll(call, token, 0).records.map((r) => r.id), ['1', '2'])
  assert.equal(st.reads.get(accountFile) || 0, reads) // answered from the journal
  assert.deepEqual(pullAll(call, token, 1).records.map((r) => r.id), ['2'])
})

test('the journal is folded into the account file once it is full, losing nothing', () => {
  const clock = { now: 1_000_000 }
  const st = storage()
  const call = server(CURRENT, st, clock)
  const { token, accountId } = call({ action: 'create', name: 'a', deviceName: 'phone' })
  const accountFile = st.sheets.get('Accounts').getRange(2, 2).getValues()[0][0]
  for (let batch = 0; batch < 9; batch++) {
    clock.now += 1000
    call({ action: 'push', token, changes: Array.from({ length: 50 }, (_, i) => entry(batch * 50 + i, clock.now)) })
  }
  // 400 reached on the 8th batch: folded; the 9th is in a fresh journal.
  assert.equal(JSON.parse(st.files.get(accountFile)).rev, 400)
  assert.equal(st.props.get(`baseRev:${accountId}`), '400')
  assert.equal(Object.keys(JSON.parse(st.files.get(st.props.get(`journal:${accountId}`))).records).length, 50)
  const all = pullAll(call, token, 0)
  assert.equal(all.records.length, 450)
  assert.equal(all.rev, 450)
  assert.deepEqual(pullAll(call, token, 420).records.map((r) => r.rev), Array.from({ length: 30 }, (_, i) => 421 + i))
  // An edit to a record that's in the account file wins over it.
  clock.now += 1000
  call({ action: 'push', token, changes: [entry(5, clock.now, { mediaTitle: 'edited' })] })
  assert.equal(byKey(pullAll(call, token, 0).records)['entry:5'].data.mediaTitle, 'edited')
})

test('manifest and get: every revision, then just the records asked for', () => {
  const clock = { now: 1_000_000 }
  const call = server(CURRENT, storage(), clock)
  const { token } = call({ action: 'create', name: 'a', deviceName: 'phone' })
  call({ action: 'push', token, changes: [entry(1, 10), entry(2, 20), { coll: 'profile', id: '7', updatedAt: 5, deleted: false, data: { name: 'x' } }] })
  call({ action: 'push', token, changes: [{ coll: 'entry', id: '1', updatedAt: 30, deleted: true }] })
  const m = call({ action: 'manifest', token })
  assert.deepEqual(m.manifest, { entry: { 1: 4, 2: 2 }, profile: { 7: 3 } })
  assert.equal(m.rev, 4)
  const got = call({ action: 'get', token, keys: ['entry:1', 'profile:7', 'entry:99'] })
  assert.deepEqual(got.records.map((r) => `${r.coll}:${r.id}:${r.deleted}`), ['entry:1:true', 'profile:7:false'])
})

test('an account the previous version wrote carries on, and old devices see the same as before', () => {
  const clock = { now: 1_000_000 }
  const st = storage()
  const old = server(V4, st, clock)
  const { token } = old({ action: 'create', name: 'a', deviceName: 'phone' })
  old({ action: 'push', token, changes: [entry(1, 10), entry(2, 20)] })
  const call = server(CURRENT, st, clock)
  // A device still on v4's ways: push, then pull everything.
  assert.deepEqual(pullAll(call, token, 0).records.map((r) => r.id), ['1', '2'])
  clock.now += 1000
  call({ action: 'push', token, changes: [entry(3, clock.now), entry(1, clock.now, { mediaTitle: 'x' })] })
  const all = pullAll(call, token, 0)
  assert.deepEqual(all.records.map((r) => `${r.id}@${r.rev}`), ['2@2', '3@3', '1@4'])
  assert.deepEqual(pullAll(call, token, 2).records.map((r) => r.id), ['3', '1'])
  assert.equal(call({ action: 'manifest', token }).rev, 4)
})

test('the same pushes give the same account in v4 and now (random runs)', () => {
  let seed = 7
  const rand = (n) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n }
  for (let run = 0; run < 20; run++) {
    const clocks = [{ now: 1_000_000 }, { now: 1_000_000 }]
    const calls = [server(V4, storage(), clocks[0]), server(CURRENT, storage(), clocks[1])]
    const tokens = calls.map((c) => {
      const t = c({ action: 'create', name: 'a', deviceName: 'phone' }).token
      return [t, c({ action: 'linkClaim', code: c({ action: 'linkCode', token: t }).code, deviceName: 'web' }).token]
    })
    const steps = 40 + rand(60)
    for (let step = 0; step < steps; step++) {
      const device = rand(2)
      const tick = rand(3) * 1000
      const changes = Array.from({ length: 1 + rand(120) }, () => {
        const id = rand(500)
        const at = 1_000_000 + step * 1000 - rand(5000)
        return rand(10) === 0 ? { coll: 'entry', id: String(id), updatedAt: at, deleted: true } : entry(id, at, { v: rand(1000) })
      })
      const action = rand(2) ? 'push' : 'sync'
      for (let i = 0; i < 2; i++) {
        clocks[i].now += tick
        calls[i]({ action, token: tokens[i][device], changes, sinceRev: 0 })
      }
    }
    const [a, b] = calls.map((c, i) => pullAll(c, tokens[i][0], 0))
    assert.equal(b.rev, a.rev)
    assert.deepEqual(byKey(b.records), byKey(a.records))
    const since = rand(a.rev)
    assert.deepEqual(pullAll(calls[1], tokens[1][1], since).records, pullAll(calls[0], tokens[0][1], since).records)
  }
})
