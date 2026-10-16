// Copies the Zoo catalog (animals.json + photos) from the Android app's assets, so both apps
// always share one catalog. Only copies files that changed.
import { cpSync, existsSync, mkdirSync, statSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const from = join(here, '../../app/src/main/assets/zoo')
const to = join(here, '../public/zoo')
if (!existsSync(from)) { console.warn('Zoo assets not found at', from); process.exit(0) }
mkdirSync(join(to, 'img'), { recursive: true })
let copied = 0
const copy = (a, b) => {
  if (existsSync(b) && statSync(b).size === statSync(a).size && statSync(b).mtimeMs >= statSync(a).mtimeMs) return
  cpSync(a, b); copied++
}
copy(join(from, 'animals.json'), join(to, 'animals.json'))
for (const f of readdirSync(join(from, 'img'))) copy(join(from, 'img', f), join(to, 'img', f))
console.log(`Zoo catalog synced (${copied} files updated)`)
