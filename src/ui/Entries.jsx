import { useMemo, useState } from 'preact/hooks'
import { useStore, useNow, editEntry, deleteEntries, deleteAllUncategorized, profileById, update, getState, ANKI, PODCAST, READING } from '../store.js'
import { durationOf, typeLabel, isUnresolved, LISTENING } from '../model/rules.js'
import { dayLabel, dayStart, formatHm, formatTime, formatDateTime, HOUR } from '../model/time.js'
import { HomeTabs, Dialog, Confirm, DurationInput, hmToMillis, EntryLabel, TypeBadge, TypeIcon, Icon, LanguageChip, LanguageFilterChip, Seg, toast, useListEntrance, useRiseIn } from './common.jsx'
import { Stats } from './Stats.jsx'
import { HomeMenu } from './Home.jsx'

/** The phone's EntryRow: the language's mark (by the "Entry language label" setting), the title and
 *  artist, and a grey pill with the duration. */
export function EntryRow({ entry, now, onClick, selected, onLongPress, entrance }) {
  const rise = useRiseIn(entrance)
  const profile = profileById(entry.languageProfileId)
  const style = getState().settings.entryLabelStyle
  const running = entry.endTimeMillis == null
  let pressTimer = null
  const down = () => { if (onLongPress) pressTimer = setTimeout(() => { pressTimer = null; onLongPress() }, 450) }
  const up = () => clearTimeout(pressTimer)
  const title = entry.mediaTitle || (entry.isManual ? `Manual ${typeLabel(entry.contentType).toLowerCase()} session` : typeLabel(entry.contentType))
  return (
    <div ref={rise} class={`entry ${selected ? 'sel' : ''}`} onClick={onClick} onPointerDown={down} onPointerUp={up} onPointerLeave={up}
      onContextMenu={onLongPress ? (e) => { e.preventDefault(); onLongPress() } : undefined}>
      {selected ? <Icon name="check_circle" size={18} color="var(--primary)" />
        : !profile && entry.contentType === LISTENING ? <Icon name="music_note" size={18} color="var(--on-surface-variant)" />
        : profile && style === 'CHIP' ? <LanguageChip profile={profile} />
          : style === 'ICON' ? <TypeBadge type={entry.contentType} profile={profile} />
            : <span class="dot" style={{ background: profile?.colorHex || '#BFBFCC' }} />}
      <div class="grow">
        <div class="title ellipsis">{title}</div>
        {entry.mediaArtist && <div class="small muted ellipsis">{entry.mediaArtist}</div>}
      </div>
      <div class="dur">{running ? `${formatHm(durationOf(entry, now))} so far` : formatHm(durationOf(entry, now))}</div>
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
      {confirm && <Confirm title="Delete all uncategorized entries?" text="This deletes everything in this folder with no language assigned, except Study (it counts in races). This can't be undone." confirmLabel="Delete all" danger onConfirm={deleteAllUncategorized} onClose={() => setConfirm(false)} />}
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
  // The length opens the editor; where it can, it sits on a soft pill with a pencil, so it reads as tappable.
  const ms = durationOf(entry, now)
  const canTapLength = !running
  const color = profile?.colorHex || 'var(--on-surface-variant)'
  return (
    <Dialog title={null} onClose={onClose}>
      <div class="col entry-details" style="gap:0">
        <div class="row" style="gap:12px">
          <span class="ed-icon" style={{ background: `color-mix(in srgb, ${color} 15%, transparent)`, color }}><TypeIcon type={entry.contentType} size={22} /></span>
          <div class="grow" style="min-width:0">
            <button class="ed-title" title="Change title" onClick={() => setMode('title')}>
              <span class="title-large ellipsis">{entry.mediaTitle || typeLabel(entry.contentType)}</span><Icon name="edit" size={16} />
            </button>
            <div class="muted small ellipsis">{[entry.mediaArtist, entry.isManual ? 'Added by hand' : typeLabel(entry.contentType)].filter(Boolean).join(', ')}</div>
          </div>
        </div>

        {/* How long, and when: one panel, the length large in the middle. */}
        <div class="ed-panel">
          <button class={`ed-length ${canTapLength ? 'tappable' : ''}`} style={{ '--c': color, color }} disabled={!canTapLength} title={canTapLength ? 'Change duration' : undefined} onClick={() => canTapLength && setMode('dur')}>
            <span class="ed-figure">{formatHm(ms)}</span>
            {canTapLength && <Icon name="edit" size={18} />}
          </button>
          <div class="ed-when">
            {running ? <span class="ed-live" style={{ background: color }} /> : <Icon name="schedule" size={14} />}
            {running ? `Started ${formatTime(entry.startTimeMillis)}` : `${formatDateTime(entry.startTimeMillis)} – ${formatTime(entry.endTimeMillis)}`}
          </div>
        </div>

        {/* The kind, fixable afterwards - listening and reading swap; not while it's running (only
            one of each type runs at a time). */}
        {!running && (entry.contentType === PODCAST || entry.contentType === READING) && (<>
          <div class="section-header ed-label">Type</div>
          <div class="ed-seg" role="radiogroup">
            {[[PODCAST, 'Listening'], [READING, 'Reading']].map(([t, l]) => (
              <button key={t} role="radio" class={entry.contentType === t ? 'on' : ''} style={{ '--c': color }} aria-checked={entry.contentType === t}
                onClick={() => entry.contentType !== t && editEntry(entry.id, { contentType: t })}><TypeIcon type={t} size={18} />{l}</button>
            ))}
          </div>
        </>)}

        {/* Not for music: it isn't tracked by language. */}
        {entry.contentType !== LISTENING && (<>
          <div class="section-header ed-label">Language</div>
          <div class="chips wrap" style="gap:8px">
            {languages.map((p) => <LanguageFilterChip key={p.id} profile={p} selected={entry.languageProfileId === p.id} onClick={() => editEntry(entry.id, { languageProfileId: p.id })} />)}
            <button class={`pill-toggle ${entry.languageProfileId == null ? 'on' : ''}`} onClick={() => editEntry(entry.id, { languageProfileId: null })}>Uncategorized</button>
          </div>
        </>)}

        {entry.detectionReason && <div class="ed-note"><Icon name="info" size={14} />{entry.detectionReason}</div>}

        <button class={`btn ${armDelete ? 'danger' : 'text danger'}`} style="margin-top:20px" onClick={() => {
          if (!armDelete) { setArmDelete(true); return }
          const copy = { ...entry }
          deleteEntries([entry.id])
          onClose()
          toast('Entry deleted', { label: 'Undo', run: () => restoreEntry(copy) })
        }}><Icon name="delete" size={18} />{armDelete ? 'Tap again to confirm delete' : 'Delete entry'}</button>
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

/** Stats or All entries, like the phone: two pages of their own, each opened from Home's menu
 *  ([params].tab). All entries is the uncategorized folder, then each day; a selection bar shows
 *  while rows are picked. */
export function Entries({ params, nav }) {
  const s = useStore()
  const now = useNow(1000)
  const tab = params?.tab === 'entries' ? 'entries' : 'stats'
  // All entries' rows rise into place as they scroll into view (the phone's riseIn).
  const entrance = useListEntrance(tab)
  const [menuOpen, setMenuOpen] = useState(false)
  const [limit, setLimit] = useState(PAGE)
  const [selected, setSelected] = useState(new Set())
  const [details, setDetails] = useState(null)
  const [confirm, setConfirm] = useState(false)
  const [pickingLang, setPickingLang] = useState(false)

  const sorted = useMemo(() => [...s.entries].sort((a, b) => b.startTimeMillis - a.startTimeMillis), [s.entries])
  // Anki without a language (from before Anki was a mode of each language) is always listed.
  const uncategorized = sorted.filter((e) => isUnresolved(e) && (s.settings.logUncategorized || e.contentType === ANKI))
  const shown = sorted.filter((e) => !isUnresolved(e)).slice(0, limit)
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
      {menuOpen && <HomeMenu nav={nav} current={tab} onClose={() => setMenuOpen(false)} />}
      {/* The menu button where Home has it: the header's right-hand end. */}
      {s.settings.quietUi ? <HomeTabs current={tab} nav={nav} /> : (
        <div class="row page-head">
          <h1 class="page-title grow">{tab === 'stats' ? 'Stats' : 'Entries'}</h1>
          <button class="icon-btn" title="Menu: stats and all entries" onClick={() => setMenuOpen(true)}><Icon name="menu" /></button>
        </div>
      )}
      {selecting && (
        <div class="sel-bar">
          <button class="icon-btn" title="Cancel" onClick={() => setSelected(new Set())}><Icon name="close" /></button>
          <b class="grow">{selected.size} selected</b>
          <button class="icon-btn" title="Change language" onClick={() => setPickingLang(true)}><Icon name="language" /></button>
          <button class="icon-btn" title="Delete" onClick={() => setConfirm(true)}><Icon name="delete" /></button>
        </div>
      )}
      {tab === 'stats' && !selecting ? <Stats /> : (
        <div style="margin-top:12px">
          {uncategorized.length > 0 && <UncategorizedFolder entries={uncategorized} now={now} onOpen={setDetails} />}
          {uncategorized.length > 0 && groups.length > 0 && <div class="divider" style="margin:12px 0" />}
          {!groups.length && !uncategorized.length && <div class="empty"><b>No entries yet</b><br /><span class="muted">Start a timer on Home, or log a session you did earlier.</span></div>}
          {groups.map((g, i) => {
            const ids = g.entries.map((e) => e.id)
            const allSel = ids.every((id) => selected.has(id))
            return (
              <div key={g.day}>
                {i > 0 && !s.settings.quietUi && <div class="divider" style="margin:12px 0" />}
                {/* Folio: the day as a small section label with its total at the end (the phone's day header). */}
                <div class={`row clickable ${s.settings.quietUi ? 'day-head day-group-head' : ''}`} style={s.settings.quietUi ? undefined : 'padding:4px 0'} onClick={selecting ? () => setSelected((prev) => { const n = new Set(prev); ids.forEach((id) => (allSel ? n.delete(id) : n.add(id))); return n }) : undefined}>
                  {selecting && <Icon name={allSel ? 'check_circle' : 'expand_more'} size={18} color={allSel ? 'var(--primary)' : 'var(--on-surface-variant)'} />}
                  {s.settings.quietUi
                    ? <><span class="grow">{dayLabel(g.day, now)}</span><span class="day-total">{formatHm(g.entries.reduce((t, e) => t + durationOf(e, now), 0))}</span></>
                    : <h2>{dayLabel(g.day, now)}</h2>}
                </div>
                <div class="list">
                  {g.entries.map((e) => (
                    <EntryRow key={e.id} entry={e} now={now} entrance={entrance} selected={selected.has(e.id)}
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
      {/* The selection bar's Language (as the phone's BatchLanguageSheet): the same choices as one entry's
          Change language, for every picked row at once. */}
      {pickingLang && (() => {
        const n = selected.size
        const pick = (p) => {
          [...selected].forEach((id) => editEntry(id, { languageProfileId: p ? p.id : null }))
          setSelected(new Set())
          setPickingLang(false)
          toast(`${n} ${n === 1 ? 'entry' : 'entries'} moved to ${p ? p.name : 'Uncategorized'}`)
        }
        return (
          <Dialog title={`Language for ${n} ${n === 1 ? 'entry' : 'entries'}`} onClose={() => setPickingLang(false)} sheet={false}>
            <div class="col">
              {s.profiles.filter((p) => !p.isAnki).map((p) => <button key={p.id} class="btn tonal" style={{ justifyContent: 'flex-start' }} onClick={() => pick(p)}><LanguageChip profile={p} /></button>)}
              {s.settings.logUncategorized && <button class="btn text" onClick={() => pick(null)}>Uncategorized</button>}
            </div>
          </Dialog>
        )
      })()}
      {confirm && <Confirm title={`Delete ${selected.size} ${selected.size === 1 ? 'entry' : 'entries'}?`} text="This can't be undone." confirmLabel="Delete" danger
        onConfirm={() => { deleteEntries([...selected]); setSelected(new Set()) }} onClose={() => setConfirm(false)} />}
    </>
  )
}
