import { useMemo, useState } from 'preact/hooks'
import { useStore, useNow, editEntry, deleteEntries, deleteAllUncategorized, profileById, update, ANKI } from '../store.js'
import { durationOf, typeLabel } from '../model/rules.js'
import { dayLabel, dayStart, formatHm, formatTime, formatDateTime, HOUR } from '../model/time.js'
import { Dialog, Confirm, DurationInput, hmToMillis, EntryLabel, TypeBadge, TypeIcon, LanguageChip, Seg, toast } from './common.jsx'
import { Stats } from './Stats.jsx'

export function EntryRow({ entry, now, onClick, selected, onLongPress }) {
  const profile = profileById(entry.languageProfileId)
  const running = entry.endTimeMillis == null
  let pressTimer = null
  const down = () => { if (onLongPress) pressTimer = setTimeout(() => { pressTimer = null; onLongPress() }, 450) }
  const up = () => clearTimeout(pressTimer)
  return (
    <div class={`entry ${selected ? 'sel' : ''}`} onClick={onClick} onPointerDown={down} onPointerUp={up} onPointerLeave={up}
      onContextMenu={onLongPress ? (e) => { e.preventDefault(); onLongPress() } : undefined}>
      <TypeBadge type={entry.contentType} profile={profile} />
      <div class="grow">
        <div class="title ellipsis">{entry.mediaTitle || (entry.isManual ? `Manual ${typeLabel(entry.contentType).toLowerCase()} session` : typeLabel(entry.contentType))}</div>
        <div class="row small muted" style="gap:8px">
          {entry.contentType !== ANKI && <EntryLabel profile={profile} type={entry.contentType} />}
          <span>{running ? `${formatTime(entry.startTimeMillis)} · now` : `${formatTime(entry.startTimeMillis)} – ${formatTime(entry.endTimeMillis)}`}</span>
        </div>
      </div>
      <div class="dur" style={running ? 'color:#3ddc84' : ''}>{formatHm(durationOf(entry, now))}</div>
    </div>
  )
}

export function UncategorizedFolder({ entries, now, onOpen }) {
  const [open, setOpen] = useState(false)
  const [confirm, setConfirm] = useState(false)
  return (
    <div class="folder">
      <div class="row">
        <button class="btn text grow" style="justify-content:flex-start;padding:0" onClick={() => setOpen(!open)}>📁 Uncategorized ({entries.length}) {open ? '▴' : '▾'}</button>
        <button class="icon-btn" title="Delete all uncategorized entries" onClick={() => setConfirm(true)}>🗑</button>
      </div>
      {open && <div class="list" style="margin-top:8px">{entries.slice(0, 50).map((e) => <EntryRow key={e.id} entry={e} now={now} onClick={() => onOpen(e.id)} />)}</div>}
      {confirm && <Confirm title="Delete all uncategorized entries?" text="This deletes everything in this folder, with no language assigned. This can't be undone." confirmLabel="Delete all" danger onConfirm={deleteAllUncategorized} onClose={() => setConfirm(false)} />}
    </div>
  )
}

export function EntryDetails({ id, onClose }) {
  const s = useStore()
  const now = useNow(1000)
  const entry = s.entries.find((e) => e.id === id)
  const [mode, setMode] = useState(null)
  const [armDelete, setArmDelete] = useState(false)
  if (!entry) return null
  const profile = profileById(entry.languageProfileId)
  const running = entry.endTimeMillis == null
  const languages = s.profiles.filter((p) => !p.isAnki)
  return (
    <Dialog title={entry.mediaTitle || typeLabel(entry.contentType)} onClose={onClose}>
      <div class="col" style="gap:10px">
        <div class="row"><TypeIcon type={entry.contentType} size={22} color={profile?.colorHex} /><span>{typeLabel(entry.contentType)}</span>{entry.contentType !== ANKI && <LanguageChip profile={profile} />}</div>
        <div class="muted small">
          {running ? `${formatHm(durationOf(entry, now))} so far · still tracking` : `${formatDateTime(entry.startTimeMillis)} – ${formatTime(entry.endTimeMillis)} · ${formatHm(durationOf(entry))}`}
        </div>
        {entry.detectionReason && <div class="muted tiny">{entry.detectionReason}</div>}
        <div class="divider" />
        {entry.contentType !== ANKI && <button class="btn tonal" onClick={() => setMode('lang')}>Change language</button>}
        {!running && <button class="btn tonal" onClick={() => setMode('dur')}>Change duration</button>}
        <button class="btn tonal" onClick={() => setMode('title')}>Change title</button>
        <button class={`btn ${armDelete ? 'danger' : 'text danger'}`} onClick={() => {
          if (!armDelete) { setArmDelete(true); return }
          const copy = { ...entry }
          deleteEntries([entry.id])
          onClose()
          toast('Entry deleted', { label: 'Undo', run: () => restoreEntry(copy) })
        }}>{armDelete ? 'Tap again to confirm delete' : 'Delete entry'}</button>
      </div>
      {mode === 'lang' && (
        <Dialog title="Change language" onClose={() => setMode(null)} sheet={false}>
          <div class="col">
            {languages.map((p) => <button key={p.id} class="btn tonal" style={{ justifyContent: 'flex-start' }} onClick={() => { editEntry(entry.id, { languageProfileId: p.id }); setMode(null) }}><LanguageChip profile={p} /></button>)}
            <button class="btn text" onClick={() => { editEntry(entry.id, { languageProfileId: null }); setMode(null) }}>Uncategorized</button>
          </div>
        </Dialog>
      )}
      {mode === 'dur' && <DurationEdit entry={entry} onClose={() => setMode(null)} />}
      {mode === 'title' && <TitleEdit entry={entry} onClose={() => setMode(null)} />}
    </Dialog>
  )
}

function restoreEntry(entry) {
  update((s) => { s.entries.push(entry) })
}

function DurationEdit({ entry, onClose }) {
  const ms = durationOf(entry)
  const [h, setH] = useState(String(Math.floor(ms / HOUR)))
  const [m, setM] = useState(String(Math.floor((ms % HOUR) / 60000)))
  return (
    <Dialog title="Change duration" onClose={onClose} sheet={false} actions={<>
      <button class="btn text" onClick={onClose}>Cancel</button>
      <button class="btn" onClick={() => { editEntry(entry.id, { endTimeMillis: entry.startTimeMillis + hmToMillis(h, m) }); onClose() }}>Save</button>
    </>}>
      <p class="muted small" style="margin-top:0">This changes how long this entry counted toward your totals.</p>
      <DurationInput hours={h} minutes={m} onHours={setH} onMinutes={setM} autoFocus />
    </Dialog>
  )
}

function TitleEdit({ entry, onClose }) {
  const [t, setT] = useState(entry.mediaTitle)
  const save = () => { if (t.trim()) { editEntry(entry.id, { mediaTitle: t.trim() }); onClose() } }
  return (
    <Dialog title="Change title" onClose={onClose} sheet={false} actions={<>
      <button class="btn text" onClick={onClose}>Cancel</button>
      <button class="btn" disabled={!t.trim()} onClick={save}>Save</button>
    </>}>
      <input class="input" value={t} autoFocus onInput={(e) => setT(e.currentTarget.value)} onKeyDown={(e) => e.key === 'Enter' && save()} />
    </Dialog>
  )
}

const PAGE = 120

export function Entries({ params }) {
  const s = useStore()
  const now = useNow(1000)
  const [tab, setTab] = useState(params?.tab || 'entries')
  const [limit, setLimit] = useState(PAGE)
  const [selected, setSelected] = useState(new Set())
  const [details, setDetails] = useState(null)
  const [confirm, setConfirm] = useState(false)
  const [filter, setFilter] = useState('all')

  const sorted = useMemo(() => [...s.entries].sort((a, b) => b.startTimeMillis - a.startTimeMillis), [s.entries])
  const shown = sorted.filter((e) => filter === 'all' || (filter === 'none' ? e.languageProfileId == null : e.languageProfileId === filter)).slice(0, limit)
  const groups = []
  for (const e of shown) {
    const d = dayStart(e.startTimeMillis)
    if (!groups.length || groups[groups.length - 1].day !== d) groups.push({ day: d, entries: [] })
    groups[groups.length - 1].entries.push(e)
  }
  const selecting = selected.size > 0
  const toggle = (id) => setSelected((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  const languages = s.profiles.filter((p) => !p.isAnki)

  return (
    <>
      <div class="row" style="margin-bottom:14px">
        <h1 class="grow" style="font-size:26px">{tab === 'stats' ? 'Stats' : 'Entries'}</h1>
      </div>
      <Seg options={[['entries', 'Entries'], ['stats', 'Stats']]} value={tab} onChange={setTab} />
      {tab === 'stats' ? <Stats /> : (
        <>
          <div class="chips scroll" style="margin-top:14px">
            <button class={`chip ${filter === 'all' ? 'on' : ''}`} onClick={() => setFilter('all')}>All</button>
            {languages.map((p) => <button key={p.id} class={`chip ${filter === p.id ? 'on' : ''}`} onClick={() => setFilter(p.id)}><span class="dot" style={{ background: p.colorHex }} />{p.name}</button>)}
            <button class={`chip ${filter === 'none' ? 'on' : ''}`} onClick={() => setFilter('none')}>Uncategorized</button>
          </div>
          {selecting && (
            <div class="banner" style="position:sticky;top:8px;z-index:5;margin-top:12px">
              <b class="grow">{selected.size} selected</b>
              <button class="btn text small" onClick={() => setSelected(new Set())}>Cancel</button>
              <button class="btn danger small" onClick={() => setConfirm(true)}>Delete</button>
            </div>
          )}
          {!groups.length && <div class="empty">No entries yet.</div>}
          {groups.map((g) => {
            const ids = g.entries.map((e) => e.id)
            const allSel = ids.every((id) => selected.has(id))
            const total = g.entries.filter((e) => e.languageProfileId != null && (e.contentType === 'PODCAST' || e.contentType === 'READING')).reduce((t, e) => t + durationOf(e, now), 0)
            return (
              <div key={g.day}>
                <div class="day-head">
                  <span class="grow">{dayLabel(g.day, now)}</span>
                  {selecting
                    ? <button class="btn text small" onClick={() => setSelected((prev) => { const n = new Set(prev); ids.forEach((id) => (allSel ? n.delete(id) : n.add(id))); return n })}>{allSel ? 'Deselect all from this day' : 'Select all from this day'}</button>
                    : <span>{formatHm(total)}</span>}
                </div>
                <div class="list">
                  {g.entries.map((e) => (
                    <EntryRow key={e.id} entry={e} now={now} selected={selected.has(e.id)}
                      onClick={() => (selecting ? toggle(e.id) : setDetails(e.id))} onLongPress={() => toggle(e.id)} />
                  ))}
                </div>
              </div>
            )
          })}
          {sorted.length > limit && <div class="center" style="margin-top:16px"><button class="btn tonal" onClick={() => setLimit(limit + PAGE)}>Load more</button></div>}
          {!selecting && groups.length > 0 && <p class="muted tiny center" style="margin-top:16px">Long-press (or right-click) an entry to select several.</p>}
        </>
      )}
      {details != null && <EntryDetails id={details} onClose={() => setDetails(null)} />}
      {confirm && <Confirm title={`Delete ${selected.size} ${selected.size === 1 ? 'entry' : 'entries'}?`} text="This can't be undone." confirmLabel="Delete" danger
        onConfirm={() => { deleteEntries([...selected]); setSelected(new Set()) }} onClose={() => setConfirm(false)} />}
    </>
  )
}

