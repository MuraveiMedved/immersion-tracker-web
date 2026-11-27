// Settings > Tracking > Categories (the phone's CategoriesSheet.kt): the user's own kinds of activity -
// each a name, one of 30 icons and whether it counts as immersion. Made here, they appear wherever
// Listening / Reading / Study do: goals, Add a session, an entry's type, Stats.
import { useState } from 'preact/hooks'
import { useStore, saveCustomCategory, deleteCustomCategory, customCategorySessionCount, PODCAST, READING, ANKI } from '../store.js'
import { CATEGORY_ICON_KEYS, CATEGORY_NAME_MAX, DEFAULT_CATEGORY_ICON, BUILT_IN_TYPE_NAMES, categoryIconKey, customType, newCategoryId, typeLabel } from '../model/rules.js'
import { Dialog, Switch, SettingRow, Icon, TypeIcon, toast } from './common.jsx'

/** The list: each category (tap to edit, the bin to delete), then Add a category. */
export function CategoriesDialog({ onClose }) {
  const s = useStore()
  const categories = s.settings.customCategories || []
  const [editing, setEditing] = useState(null)
  const [deleting, setDeleting] = useState(null)
  return (
    <Dialog title="Categories" onClose={onClose} actions={<button class="btn text" onClick={onClose}>Done</button>}>
      <div class="col" style="gap:8px">
        <p class="muted small" style="margin:0">Kinds of activity of your own, next to Listening, Reading and Study. Each can have its own daily goal in every language, its own sessions and a filter in Stats.</p>
        {!categories.length && (
          <div class="cat-empty">
            <Icon name="category" size={32} color="var(--on-surface-variant)" />
            <div class="s-title">No categories yet</div>
            <div class="muted small">Add one for anything you do that isn't listening, reading or study - watching, speaking, grammar.</div>
          </div>
        )}
        <div class="col" style="gap:0">
          {categories.map((c) => (
            <SettingRow key={c.id} icon={<Icon name={categoryIconKey(c.icon)} size={22} />} title={c.name}
              hint={c.immersion ? 'Counts as immersion' : 'Kept apart from immersion'} onClick={() => setEditing(c)}>
              <button class="icon-btn" title={`Delete ${c.name}`} onClick={(e) => { e.stopPropagation(); setDeleting(c) }}><Icon name="delete" size={22} /></button>
            </SettingRow>
          ))}
        </div>
        <button class="btn" style="margin-top:4px" onClick={() => setEditing({ id: newCategoryId(), name: '', icon: DEFAULT_CATEGORY_ICON, immersion: true })}>
          <Icon name="add" size={18} />Add a category
        </button>
      </div>
      {editing && <CategoryEditDialog category={editing} isNew={!categories.some((c) => c.id === editing.id)}
        takenNames={categories.filter((c) => c.id !== editing.id).map((c) => c.name.toLowerCase())}
        onClose={() => setEditing(null)} />}
      {deleting && <CategoryDeleteDialog category={deleting} others={categories.filter((c) => c.id !== deleting.id)} onClose={() => setDeleting(null)} />}
    </Dialog>
  )
}

/** A new category straight from where it's needed (Add a session): saved, then handed to onCreated. */
export function NewCategoryDialog({ onCreated, onClose }) {
  const s = useStore()
  const [fresh] = useState(() => ({ id: newCategoryId(), name: '', icon: DEFAULT_CATEGORY_ICON, immersion: true }))
  return <CategoryEditDialog category={fresh} isNew takenNames={(s.settings.customCategories || []).map((c) => c.name.toLowerCase())}
    onSaved={onCreated} onClose={onClose} />
}

/** Name, icon (one of 30, six to a row) and whether it counts as immersion - with the category as it
 *  will look at the top, kept live while it's made (the phone's CategoryEditDialog). */
function CategoryEditDialog({ category, isNew, takenNames, onClose, onSaved }) {
  const [name, setName] = useState(category.name)
  const [icon, setIcon] = useState(categoryIconKey(category.icon))
  const [immersion, setImmersion] = useState(category.immersion)
  const trimmed = name.trim()
  // Not one of the built-in names either, so two kinds never read the same.
  const clash = takenNames.includes(trimmed.toLowerCase()) || BUILT_IN_TYPE_NAMES.some((n) => n.toLowerCase() === trimmed.toLowerCase())
  const canSave = trimmed.length > 0 && !clash
  const save = () => {
    if (!canSave) return
    const saved = { id: category.id, name: trimmed, icon, immersion }
    saveCustomCategory(saved)
    if (onSaved) onSaved(saved)
    else onClose()
  }
  return (
    <Dialog title={isNew ? 'New category' : 'Edit category'} onClose={onClose} actions={<>
      <button class="btn text" onClick={onClose}>Cancel</button>
      <button class="btn grow" disabled={!canSave} onClick={save}>{isNew ? 'Create' : 'Save'}</button>
    </>}>
      <div class={`col cat-edit ${immersion ? '' : 'apart'}`} style="gap:14px">
        <div class="cat-preview">
          <span class="cat-preview-icon"><Icon key={icon} name={icon} size={30} /></span>
          <div class="grow" style="min-width:0">
            <div class={`cat-preview-name ${trimmed ? '' : 'empty'}`}>{trimmed || 'Watching'}</div>
            <div class="cat-preview-kind small">{immersion ? 'Counts as immersion' : 'Kept apart from immersion'}</div>
          </div>
        </div>
        <label class="field">Name
          <span class={`title-field ${clash ? 'error' : ''}`}>
            <input placeholder="Watching" aria-label="Name" maxLength={CATEGORY_NAME_MAX} value={name} autoFocus={isNew}
              onInput={(e) => setName(e.currentTarget.value.slice(0, CATEGORY_NAME_MAX))} onKeyDown={(e) => e.key === 'Enter' && save()} />
            <span class="muted small">{name.length} / {CATEGORY_NAME_MAX}</span>
          </span>
          {clash && <span class="small err">There's already one with that name</span>}
        </label>
        <div class="form-label">How it counts</div>
        <div class="cat-counts" role="radiogroup" aria-label="How it counts">
          <button type="button" role="radio" aria-checked={immersion} class={`cat-count ${immersion ? 'on' : ''}`} style="--c: var(--primary)" onClick={() => setImmersion(true)}>
            <Icon name="auto_awesome" size={20} /><b>Counts as immersion</b><span class="muted small">Adds to Today, Momentum, races, the Zoo and the General goal</span>
          </button>
          <button type="button" role="radio" aria-checked={!immersion} class={`cat-count ${!immersion ? 'on' : ''}`} style="--c: var(--secondary)" onClick={() => setImmersion(false)}>
            <Icon name="adjust" size={20} /><b>Kept apart</b><span class="muted small">Its own time and goals, like Study</span>
          </button>
        </div>
        <div class="form-label">Icon</div>
        <div class="icon-grid round" role="radiogroup" aria-label="Icon">
          {CATEGORY_ICON_KEYS.map((key, i) => (
            <button key={key} type="button" role="radio" aria-checked={key === icon} aria-label={key.replace(/_/g, ' ')} title={key.replace(/_/g, ' ')}
              class={`icon-cell ${key === icon ? 'on' : ''}`} style={{ '--row': Math.floor(i / 6) }} onClick={() => setIcon(key)}><Icon name={key} size={22} /></button>
          ))}
        </div>
      </div>
    </Dialog>
  )
}

/** Deleting keeps the time: its sessions move to a kind picked here (Listening if it counted as
 *  immersion, else Study, to start with); its goals go from every language. */
function CategoryDeleteDialog({ category, others, onClose }) {
  const count = customCategorySessionCount(category.id)
  const targets = [PODCAST, READING, ANKI, ...others.map((c) => customType(c.id))]
  const [moveTo, setMoveTo] = useState(category.immersion ? PODCAST : ANKI)
  return (
    <Dialog title={`Delete ${category.name}?`} sheet={false} onClose={onClose} actions={<>
      <button class="btn text" onClick={onClose}>Cancel</button>
      <button class="btn danger" onClick={() => {
        deleteCustomCategory(category.id, moveTo)
        toast(count ? `${category.name} deleted, its sessions moved to ${typeLabel(moveTo)}` : `${category.name} deleted`)
        onClose()
      }}>Delete</button>
    </>}>
      <div class="col" style="gap:10px">
        {count === 0 ? <p style="margin:0">It has no sessions yet.</p> : <>
          <p style="margin:0">{count === 1 ? 'Its session is kept - move it to:' : `Its ${count} sessions are kept - move them to:`}</p>
          <div class="chips wrap" style="gap:8px" role="radiogroup">
            {targets.map((t) => (
              <button key={t} type="button" role="radio" aria-checked={t === moveTo} class={`chip move-target ${t === moveTo ? 'on' : ''}`} onClick={() => setMoveTo(t)}>
                <TypeIcon type={t} size={16} />{typeLabel(t)}
              </button>
            ))}
          </div>
        </>}
        <p class="muted small" style="margin:0">Its goals go with it.</p>
      </div>
    </Dialog>
  )
}
