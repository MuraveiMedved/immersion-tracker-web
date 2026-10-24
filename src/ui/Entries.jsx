import { useMemo, useState } from 'preact/hooks'
import { useStore, useNow, editEntry, deleteEntries, deleteAllUncategorized, profileById, update, getState, ANKI, PODCAST, READING } from '../store.js'
import { durationOf, typeLabel } from '../model/rules.js'
import { dayLabel, dayStart, formatHm, formatTime, formatDateTime, HOUR } from '../model/time.js'
import { Dialog, Confirm, DurationInput, hmToMillis, EntryLabel, TypeBadge, TypeIcon, Icon, LanguageChip, Seg, toast } from './common.jsx'
import { Stats } from './Stats.jsx'

/** The phone's EntryRow: the language's mark (by the "Entry language label" setting), the title and
 *  artist, and a grey pill with the duration. */
export function EntryRow({ entry, now, onClick, selected, onLongPress }) {
  const profile = profileById(entry.languageProfileId)
  const style = getState().settings.entryLabelStyle
  const running = entry.endTimeMillis == null
  let pressTimer = null
  const down = () => { if (onLongPress) pressTimer = setTimeout(() => { pressTimer = null; onLongPress() }, 450) }
  const up = () => clearTimeout(pressTimer)
  const title = entry.mediaTitle || (entry.isManual ? `Manual ${typeLabel(entry.contentType).toLowerCase()} session` : typeLabel(entry.contentType))
  return (
    <div class={`entry ${selected ? 'sel' : ''}`} onClick={onClick} onPointerDown={down} onPointerUp={up} onPointerLeave={up}
      onContextMenu={onLongPress ? (e) => { e.preventDefault(); onLongPress() } : undefined}>
      {selected ? <Icon name="check_circle" size={18} color="var(--primary)" />
        : profile && style === 'CHIP' ? <LanguageChip profile={profile} />
          : style === 'ICON' ? <TypeBadge type={entry.contentType} profile={profile} />
            : <span class="dot" style={{ background: profile?.colorHex || '#BFBFCC' }} />}
      <div class="grow">
        <div class="title ellipsis">{title}</div>
        {entry.mediaArtist && <div class="small muted ellipsis">{entry.mediaArtist}</div>}
      </div>
      <div class="dur">{running ? `${formatHm(durationOf(entry, now))} · now` : formatHm(durationOf(entry, now))}</div>
    </div>
  )
}

export function UncategorizedFolder({ entries, now, onOpen }) {
  const [open, setOpen] = useState(false)
  const [confirm, setConfirm] = useState(false)
  return (
    <div class="folder">
      <div class="folder-head" onClick={() => setOpen(!open)}>
        <Icon name="folder" size={20} color="var(--on-surface-variant)" />
        <span class="grow body-large">Uncategorized ({entries.length})</span>
        <button class="icon-btn muted" title="Delete all uncategorized entries" onClick={(e) => { e.stopPropagation(); setConfirm(true) }}><Icon name="delete" size={20} /></button>
        <span class="muted"><Icon name={open ? 'expand_less' : 'expand_more'} /></span>
      </div>
      {open && <div class="list" style="margin:0 20px">{entries.slice(0, 50).map((e) => <EntryRow key={e.id} entry={e} now={now} onClick={() => onOpen(e.id)} />)}</div>}
      {confirm && <Confirm title="Delete all uncategorized entries?" text="This deletes everything in this folder with no language assigned, except Anki (it counts in races). This can't be undone." confirmLabel="Delete all" danger onConfirm={deleteAllUncategorized} onClose={() => setConfirm(false)} />}
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
        <div class="row"><TypeIcon type={entry.contentType} size={22} color={profile?.colorHex} /><span>{typeLabel(entry.contentType)}</span><LanguageChip profile={profile} /></div>
        <div class="muted small">
          {running ? `${formatHm(durationOf(entry, now))} so far · still tracking` : `${formatDateTime(entry.startTimeMillis)} – ${formatTime(entry.endTimeMillis)} · ${formatHm(durationOf(entry))}`}
        </div>
        {entry.detectionReason && <div class="muted tiny">{entry.detectionReason}</div>}
        <div class="divider" />
        {/* The mode, fixable afterwards - listening and reading swap; not while it's running (only
            one of each type runs at a time). */}
        {!running && (entry.contentType === PODCAST || entry.contentType === READING) && (
          <div class="row" style="gap:10px">
            <span class="title-medium grow">Change type</span>
            {[[PODCAST, 'Listening'], [READING, 'Reading']].map(([t, l]) => (
              <button key={t} class={`type-btn ${entry.contentType === t ? 'on' : ''}`} title={l} aria-label={l} aria-pressed={entry.contentType === t}
                onClick={() => entry.contentType !== t && editEntry(entry.id, { contentType: t })}><TypeIcon type={t} size={22} /></button>
            ))}
          </div>
        )}
        <button class="btn tonal" onClick={() => setMode('lang')}>Change language</button>
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

/** Entries, like the phone: Stats / All entries in a pill switcher (a selection bar stands in for it
 *  while rows are picked); All entries is the uncategorized folder, then each day. */
export function Entries({ params }) {
  const s = useStore()
  const now = useNow(1000)
  const [tab, setTab] = useState(params?.tab || 'stats')
  const [limit, setLimit] = useState(PAGE)
  const [selected, setSelected] = useState(new Set())
  const [details, setDetails] = useState(null)
  const [confirm, setConfirm] = useState(false)

  const sorted = useMemo(() => [...s.entries].sort((a, b) => b.startTimeMillis - a.startTimeMillis), [s.entries])
  // Anki without a language (from before Anki was a mode of each language) is always listed.
  const uncategorized = sorted.filter((e) => e.languageProfileId == null && (s.settings.logUncategorized || e.contentType === ANKI))
  const shown = sorted.filter((e) => e.languageProfileId != null).slice(0, limit)
  const groups = []
  for (const e of shown) {
    const d = dayStart(e.startTimeMillis)
    if (!groups.length || groups[groups.length - 1].day !== d) groups.push({ day: d, entries: [] })
    groups[groups.length - 1].entries.push(e)
  }
  const selecting = selected.size > 0
  const toggle = (id) => setSelected((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })

  return (
    <>
      <h1 class="page-title">Entries</h1>
      {selecting ? (
        <div class="sel-bar">
          <button class="icon-btn" title="Cancel" onClick={() => setSelected(new Set())}><Icon name="close" /></button>
          <b class="grow">{selected.size} selected</b>
          <button class="icon-btn" title="Delete" onClick={() => setConfirm(true)}><Icon name="delete" /></button>
        </div>
      ) : <Seg options={[['stats', 'Stats'], ['entries', 'All entries']]} value={tab} onChange={setTab} />}
      {tab === 'stats' && !selecting ? <Stats /> : (
        <div style="margin-top:12px">
          {uncategorized.length > 0 && <UncategorizedFolder entries={uncategorized} now={now} onOpen={setDetails} />}
          {uncategorized.length > 0 && groups.length > 0 && <div class="divider" style="margin:12px 0" />}
          {!groups.length && !uncategorized.length && <div class="empty">No entries yet.</div>}
          {groups.map((g, i) => {
            const ids = g.entries.map((e) => e.id)
            const allSel = ids.every((id) => selected.has(id))
            return (
              <div key={g.day}>
                {i > 0 && <div class="divider" style="margin:12px 0" />}
                <div class="row clickable" style="padding:4px 0" onClick={selecting ? () => setSelected((prev) => { const n = new Set(prev); ids.forEach((id) => (allSel ? n.delete(id) : n.add(id))); return n }) : undefined}>
                  {selecting && <Icon name={allSel ? 'check_circle' : 'expand_more'} size={18} color={allSel ? 'var(--primary)' : 'var(--on-surface-variant)'} />}
                  <h2>{dayLabel(g.day, now)}</h2>
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
        </div>
      )}
      {details != null && <EntryDetails id={details} onClose={() => setDetails(null)} />}
      {confirm && <Confirm title={`Delete ${selected.size} ${selected.size === 1 ? 'entry' : 'entries'}?`} text="This can't be undone." confirmLabel="Delete" danger
        onConfirm={() => { deleteEntries([...selected]); setSelected(new Set()) }} onClose={() => setConfirm(false)} />}
    </>
  )
}
