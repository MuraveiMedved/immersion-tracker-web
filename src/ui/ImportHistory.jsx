// Settings > Backup > Import history (the phone's ImportHistorySheet.kt): every Toggl / PolyLogger
// import, where each group in it went (or that it was left out), and a tap to count a group
// differently - Listening, Reading, Study, Music or a category of your own, made right there.
import { useEffect, useMemo, useState } from 'preact/hooks'
import { useStore, useImportHistory, saveImportHistory, getImportHistory, rerouteImported, removeImportedRows, IMPORT_TAGS, PODCAST, READING, ANKI, LISTENING } from '../store.js'
import { summaries, totals, rowsOf, withGroup, earlierGroups, reconstruct } from '../model/importHistory.js'
import { customType, typeLabel } from '../model/rules.js'
import { formatHm } from '../model/time.js'
import { NewCategoryDialog } from './Categories.jsx'
import { Dialog, Confirm, Icon, TypeIcon, toast } from './common.jsx'

const SOURCE_NAME = { toggl: 'Toggl Track', polylogger: 'PolyLogger' }
const CATEGORY_PALETTE = ['#E0A15E', '#5EB8A8', '#D9779A', '#8E9BE6', '#B39363', '#7CB86A']

/** A colour per destination - the theme's own for the built-in kinds, a calm palette for categories. */
function destColor(type, categories) {
  if (type == null) return 'var(--outline-variant)'
  if (type === PODCAST) return 'var(--primary)'
  if (type === READING) return 'var(--tertiary)'
  if (type === ANKI) return 'var(--secondary)'
  if (type === LISTENING) return 'var(--on-surface-variant)'
  const i = Math.max(0, categories.findIndex((c) => customType(c.id) === type))
  return CATEGORY_PALETTE[i % CATEGORY_PALETTE.length]
}

const month = (ms) => new Date(ms).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })
function groupMeta(count, ms, first, last) {
  const base = `${count} session${count === 1 ? '' : 's'}, ${formatHm(ms, true)}`
  if (!first || !last) return base
  const a = month(first), b = month(last)
  return a === b ? `${base}, ${a}` : `${base}, ${a} to ${b}`
}

function destLabel(type, profile) {
  if (type == null) return 'Left out'
  if (type === LISTENING) return typeLabel(type)
  return profile ? `${typeLabel(type)} in ${profile.name}` : `${typeLabel(type)}, no language`
}

export function ImportHistoryDialog({ onClose }) {
  const s = useStore()
  const records = useImportHistory()
  const categories = s.settings.customCategories || []
  const [routing, setRouting] = useState(null)
  const [removing, setRemoving] = useState(null)
  const earlier = useMemo(() => earlierGroups(records, s.entries, IMPORT_TAGS), [records, s.entries])
  const profile = (id) => s.profiles.find((p) => p.id === id)
  // Imports made before history was kept come back one by one, as records of their own.
  useEffect(() => {
    const found = reconstruct(getImportHistory(), s.entries, IMPORT_TAGS, (type, lang) => destLabel(type, s.profiles.find((p) => p.id === lang)))
    if (found.length) saveImportHistory([...getImportHistory(), ...found])
  }, [records.length])

  const apply = (target, type, languageProfileId) => {
    const lang = type == null || type === LISTENING ? null : languageProfileId ?? null
    if (target.record) {
      const rows = rowsOf(target.record, target.group.project)
      rerouteImported(target.record.source, rows, target.group.type, type, lang)
      const fresh = getImportHistory().find((r) => r.id === target.record.id) || target.record
      saveImportHistory(getImportHistory().map((r) => (r.id === fresh.id ? withGroup(fresh, { ...target.group, type, languageProfileId: lang }) : r)))
      toast(type ? `${rows.length} sessions now count as ${typeLabel(type)}` : `${rows.length} sessions left out`)
    } else {
      const n = rerouteImported(target.source, target.rows, target.type, type, lang)
      toast(type ? `${n} sessions now count as ${typeLabel(type)}` : `${n} sessions removed`)
    }
    setRouting(null)
  }

  return (
    <Dialog wide title="Import history" onClose={onClose} actions={<button class="btn text" onClick={onClose}>Done</button>}>
      <div class="col" style="gap:12px">
        <p class="muted small" style="margin:0">Each import from Toggl Track and PolyLogger, and where everything in it went. Open one to count a part differently, or bring in what was left out.</p>
        {!records.length && !earlier.length && (
          <div class="cat-empty">
            <Icon name="history" size={36} color="var(--on-surface-variant)" />
            <div class="s-title">No imports yet</div>
            <div class="muted small">Import from Toggl Track or PolyLogger under Imports, and each import shows here.</div>
          </div>
        )}
        {records.map((record) => {
          const list = summaries(record)
          const counted = list.filter((x) => x.group.type != null)
          const left = list.filter((x) => x.group.type == null)
          const when = (record.reconstructed ? 'Around ' : '') + new Date(record.atMillis).toLocaleDateString(undefined, { dateStyle: 'medium' })
          const first = Math.min(...record.rows.map((r) => r.start)), last = Math.max(...record.rows.map((r) => r.end))
          const span = record.rows.length ? (month(first) === month(last) ? `Sessions from ${month(first)}` : `Sessions from ${month(first)} to ${month(last)}`) : null
          const note = record.reconstructed
            ? 'Imported before this history was kept, so it\'s grouped by where it went, and its date is roughly when. What it left out wasn\'t saved: import the file again to see that.'
            : record.fileNames?.length ? record.fileNames.join(', ') : null
          const ms = record.rows.reduce((n, r) => n + r.end - r.start, 0)
          const kept = counted.reduce((n, x) => n + x.count, 0)
          const keptMs = counted.reduce((n, x) => n + x.ms, 0)
          return (
            <EventRow key={record.id} icon="file_upload" title={SOURCE_NAME[record.source] || record.source}
              subtitle={`${when}, ${record.rows.length} sessions, ${formatHm(ms, true)}`} span={span} totals={totals(record)} categories={categories}
              leftOut={left.length} onRemove={() => setRemoving({ record, count: kept, ms: keptMs })}>
              {note && <div class="ih-note"><Icon name={record.reconstructed ? 'history' : 'file_upload'} size={15} /><span>{note}</span></div>}
              {counted.length > 0 && <div class="ih-label">Counted ({counted.length})</div>}
              {counted.map((x, i) => <GroupRow key={x.group.project} i={i} title={x.group.project || '(No project)'} meta={groupMeta(x.count, x.ms, x.first, x.last)}
                type={x.group.type} profile={profile(x.group.languageProfileId)} categories={categories} onClick={() => setRouting({ record, group: x.group, count: x.count, ms: x.ms, title: x.group.project || '(No project)' })} />)}
              {left.length > 0 && <>
                <div class="ih-label">Left out ({left.length})</div>
                <p class="muted small ih-pad" style="margin:0 0 2px">Not counted anywhere yet. Tap one to count it as something.</p>
              </>}
              {left.map((x, i) => <GroupRow key={x.group.project} i={counted.length + i} title={x.group.project || '(No project)'} meta={groupMeta(x.count, x.ms, x.first, x.last)}
                type={null} categories={categories} onClick={() => setRouting({ record, group: x.group, count: x.count, ms: x.ms, title: x.group.project || '(No project)' })} />)}
            </EventRow>
          )
        })}
        {earlier.length > 0 && (() => {
          const count = earlier.reduce((n, g) => n + g.count, 0)
          const ms = earlier.reduce((n, g) => n + g.ms, 0)
          const byType = new Map()
          for (const g of earlier) byType.set(g.type, (byType.get(g.type) || 0) + g.ms)
          return (
            <EventRow key="earlier" icon="history" muted title="Earlier imports" subtitle={`${count} sessions, ${formatHm(ms, true)}`}
              totals={[...byType.entries()].sort((a, b) => b[1] - a[1])} categories={categories} leftOut={0}
              onRemove={() => setRemoving({ earlier, count, ms })}>
              <p class="muted small ih-pad" style="margin:4px 0">Brought in before this history was kept, here or on another device, so they're grouped by where they went. What was left out then wasn't saved: import the file again to see it here.</p>
              {earlier.map((g, i) => <GroupRow key={g.key} i={i} title={SOURCE_NAME[g.source]} meta={groupMeta(g.count, g.ms, g.first, g.last)}
                type={g.type} profile={profile(g.languageProfileId)} categories={categories} onClick={() => setRouting({ ...g, title: SOURCE_NAME[g.source], earlier: true })} />)}
            </EventRow>
          )
        })()}
      </div>
      {routing && <RouteDialog target={routing} onApply={(t, l) => apply(routing, t, l)} onClose={() => setRouting(null)} />}
      {removing && <Confirm title={removing.record ? 'Remove this import?' : 'Remove earlier imports?'}
        text={`Its ${removing.count} sessions (${formatHm(removing.ms, true)}) go from your history, on all your devices. Import the file again to bring them back.`}
        confirmLabel="Remove" danger onConfirm={() => {
          const r = removing
          const gone = r.record ? removeImportedRows(r.record.source, r.record.rows) : r.earlier.reduce((n, g) => n + removeImportedRows(g.source, g.rows), 0)
          if (r.record) saveImportHistory(getImportHistory().filter((x) => x.id !== r.record.id))
          toast(`${gone} sessions removed`)
        }} onClose={() => setRemoving(null)} />}
    </Dialog>
  )
}

function DestBar({ totals: list, categories, showKey = true }) {
  const sum = Math.max(1, list.reduce((n, [, ms]) => n + ms, 0))
  return (
    <div class="ih-pad">
      <div class="ih-bar" role="img" aria-label={list.map(([t, ms]) => `${t == null ? 'Left out' : typeLabel(t)} ${formatHm(ms, true)}`).join(', ')}>
        {list.map(([t, ms]) => <span key={String(t)} style={{ flexGrow: Math.max(ms / sum, 0.01), background: destColor(t, categories) }} />)}
      </div>
      {showKey && <div class="ih-key">
        {list.map(([t, ms]) => <span key={String(t)}><i style={{ background: destColor(t, categories) }} />{t == null ? 'Left out' : typeLabel(t)} {formatHm(ms, true)}</span>)}
      </div>}
    </div>
  )
}

/** One import as a row: what and when, a bar of where its time went and how much was left out; tapped,
 *  it opens to its groups. The bin removes it (after asking). */
function EventRow({ icon, muted, title, subtitle, span, totals: list, categories, leftOut, onRemove, children }) {
  const [open, setOpen] = useState(false)
  return (
    <section class={`ih-panel ih-event ${open ? 'open' : ''}`}>
      <div class="ih-event-head" role="button" tabIndex={0} aria-expanded={open} onClick={() => setOpen(!open)}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), setOpen(!open))}>
        <header class="ih-head">
          <span class={`ih-badge ${muted ? 'muted-badge' : ''}`}><Icon name={icon} size={21} /></span>
          <div class="grow">
            <div class="s-title ellipsis">{title}</div>
            <div class="muted small">{subtitle}</div>
            {span && <div class="muted small" style="opacity:.8">{span}</div>}
          </div>
          <button class="icon-btn" title="Remove this import" aria-label="Remove this import" onClick={(e) => { e.stopPropagation(); onRemove() }}><Icon name="delete" size={20} /></button>
          <span class="ih-chevron"><Icon name="expand_more" size={22} /></span>
        </header>
        <div class="ih-bar-row">
          <div class="grow"><DestBar totals={list} categories={categories} showKey={open} /></div>
          {leftOut > 0 && !open && <span class="ih-left-pill">{leftOut} left out</span>}
        </div>
      </div>
      {open && <div class="ih-event-body">{children}</div>}
    </section>
  )
}

function GroupRow({ title, meta, type, profile, categories, onClick, i }) {
  const color = destColor(type, categories)
  return (
    <button class={`ih-row ${type == null ? 'left' : ''}`} style={{ '--i': Math.min(i, 10) }} onClick={onClick}>
      <div class="grow">
        <div class="ih-title">{title}</div>
        <div class="muted small">{meta}</div>
        <span class={`ih-chip ${type == null ? 'out' : ''}`} style={{ '--c': color }}>
          {type == null ? <Icon name="block" size={14} /> : <TypeIcon type={type} size={14} color={color} />}
          {profile && type != null && type !== LISTENING && <i class="dot" style={{ background: profile.colorHex }} />}
          {destLabel(type, profile)}
        </span>
      </div>
      <Icon name="chevron_right" size={20} color="var(--on-surface-variant)" />
    </button>
  )
}

/** Pick a kind (or leave it out), then a language; the one button says exactly what will happen. */
function RouteDialog({ target, onApply, onClose }) {
  const s = useStore()
  const categories = s.settings.customCategories || []
  const fromType = target.record ? target.group.type : target.type
  const fromLang = target.record ? target.group.languageProfileId : target.languageProfileId
  const [type, setType] = useState(fromType)
  const [lang, setLang] = useState(fromLang ?? null)
  const [creating, setCreating] = useState(false)
  const unchanged = type === fromType && (type == null || type === LISTENING || lang === (fromLang ?? null))
  const kinds = [PODCAST, READING, ANKI, LISTENING, ...categories.map((c) => customType(c.id))]
  const count = target.count
  const label = unchanged ? "That's where it is now"
    : type == null ? `${target.earlier ? 'Remove' : 'Leave out'} ${count} sessions`
    : `Count ${count} sessions as ${typeLabel(type)}`
  return (
    <Dialog title={target.title} onClose={onClose} actions={<>
      <button class="btn text" onClick={onClose}>Cancel</button>
      <button class={`btn ${type == null && target.earlier ? 'danger' : ''}`} disabled={unchanged || !count} onClick={() => onApply(type, lang)}>{label}</button>
    </>}>
      <div class="col" style="gap:10px">
        <div class="muted small">{count} sessions, {formatHm(target.ms, true)}</div>
        <div class="form-label">Count it as</div>
        <div class="ih-kinds" role="radiogroup">
          {kinds.map((k, i) => (
            <button key={k} role="radio" aria-checked={type === k} class={`ih-kind ${type === k ? 'on' : ''}`} style={{ '--c': destColor(k, categories), '--i': i }} onClick={() => setType(k)}>
              <span class="ih-kind-icon"><TypeIcon type={k} size={17} /></span>{typeLabel(k)}
            </button>
          ))}
          <button class="ih-kind dashed" style={{ '--c': 'var(--primary)', '--i': kinds.length }} onClick={() => setCreating(true)}>
            <span class="ih-kind-icon"><Icon name="add" size={17} /></span>New category
          </button>
          <button role="radio" aria-checked={type == null} class={`ih-kind ${type == null ? 'on' : ''}`} style={{ '--c': target.earlier ? 'var(--danger)' : 'var(--on-surface-variant)', '--i': kinds.length + 1 }} onClick={() => setType(null)}>
            <span class="ih-kind-icon"><Icon name={target.earlier ? 'delete' : 'block'} size={17} /></span>{target.earlier ? 'Remove' : 'Leave out'}
          </button>
        </div>
        {type != null && type !== LISTENING && <>
          <div class="form-label">Language</div>
          <div class="chips wrap" style="gap:8px">
            {s.profiles.filter((p) => !p.isAnki).map((p) => (
              <button key={p.id} class={`chip ih-lang ${lang === p.id ? 'on' : ''}`} onClick={() => setLang(p.id)}><span class="dot" style={{ background: p.colorHex }} />{p.name}</button>
            ))}
            <button class={`chip ih-lang ${lang == null ? 'on' : ''}`} onClick={() => setLang(null)}>Uncategorized</button>
          </div>
        </>}
        {type == null && <p class={`small ${target.earlier ? 'err' : 'muted'}`} style="margin:4px 0 0">{target.earlier
          ? 'These came in before history was kept, so removing them can only be undone by importing the file again.'
          : 'They stop counting anywhere, and stay here to bring back whenever you like.'}</p>}
      </div>
      {creating && <NewCategoryDialog onCreated={(c) => { setType(customType(c.id)); setCreating(false) }} onClose={() => setCreating(false)} />}
    </Dialog>
  )
}
