import test from 'node:test'
import assert from 'node:assert/strict'
import { customThemeColors, customScheme, isDarkCustom, setCustomThemes, schemeFor, isDarkFor, presetLabel } from '../src/model/theme.js'
import { defaultState } from '../src/store.js'
import { collect, applyRecords } from '../src/model/sync.js'

// The same pairs and results as the phone's CustomThemeTest: one theme must look the same on both.
const GOLDENS = [
  [
    '#101524',
    '#FF8800',
    {
      'background': '#101524',
      'surface': '#1E2331',
      'surfaceVariant': '#2A2F3C',
      'lowest': '#0D111D',
      'low': '#171C2B',
      'container': '#1C212F',
      'high': '#282C3A',
      'highest': '#343845',
      'onSurface': '#F2F2F7',
      'onSurfaceVariant': '#BABBC2',
      'outline': '#535761',
      'outlineVariant': '#3B3F4B',
      'primary': '#FF8800',
      'onPrimary': '#FFFFFF',
      'primaryContainer': '#53351A',
      'onPrimaryContainer': '#F7C894',
      'secondary': '#FC9D31',
      'secondaryContainer': '#402C1D',
      'onSecondaryContainer': '#F7C894'
    }
  ],
  [
    '#F5F0E6',
    '#2E7D5B',
    {
      'background': '#F5F0E6',
      'surface': '#F9F6F0',
      'surfaceVariant': '#DFDAD1',
      'lowest': '#FCFBF8',
      'low': '#F7F3EB',
      'container': '#F0EBE1',
      'high': '#E9E4DB',
      'highest': '#DFDAD1',
      'onSurface': '#1A1B3A',
      'onSurfaceVariant': '#515065',
      'outline': '#B0ADA6',
      'outlineVariant': '#C9C5BD',
      'primary': '#2E7D5B',
      'onPrimary': '#FFFFFF',
      'primaryContainer': '#BDD0BF',
      'onPrimaryContainer': '#224247',
      'secondary': '#2A6954',
      'secondaryContainer': '#CDD9CA',
      'onSecondaryContainer': '#224247'
    }
  ],
  [
    '#808080',
    '#808080',
    {
      'background': '#606060',
      'surface': '#6A6A6A',
      'surfaceVariant': '#717171',
      'lowest': '#4D4D4D',
      'low': '#656565',
      'container': '#686868',
      'high': '#707070',
      'highest': '#787878',
      'onSurface': '#F2F2F7',
      'onSurfaceVariant': '#CECED1',
      'outline': '#8D8D8D',
      'outlineVariant': '#7D7D7D',
      'primary': '#C0C0C0',
      'onPrimary': '#1A1B3A',
      'primaryContainer': '#7B7B7B',
      'onPrimaryContainer': '#DEDEE1',
      'secondary': '#CACACB',
      'secondaryContainer': '#737373',
      'onSecondaryContainer': '#DEDEE1'
    }
  ],
  [
    '#000000',
    '#000000',
    {
      'background': '#000000',
      'surface': '#0F0F0F',
      'surfaceVariant': '#1C1C1C',
      'lowest': '#000000',
      'low': '#080808',
      'container': '#0D0D0D',
      'high': '#1A1A1A',
      'highest': '#262626',
      'onSurface': '#F2F2F7',
      'onSurfaceVariant': '#B6B6B9',
      'outline': '#474747',
      'outlineVariant': '#2E2E2E',
      'primary': '#666666',
      'onPrimary': '#FFFFFF',
      'primaryContainer': '#1D1D1D',
      'onPrimaryContainer': '#BABABD',
      'secondary': '#828283',
      'secondaryContainer': '#141414',
      'onSecondaryContainer': '#BABABD'
    }
  ],
  [
    '#FFFFFF',
    '#FFFF00',
    {
      'background': '#FFFFFF',
      'surface': '#FFFFFF',
      'surfaceVariant': '#E8E8E8',
      'lowest': '#FFFFFF',
      'low': '#FFFFFF',
      'container': '#FAFAFA',
      'high': '#F2F2F2',
      'highest': '#E8E8E8',
      'onSurface': '#1A1B3A',
      'onSurfaceVariant': '#53546B',
      'outline': '#B8B8B8',
      'outlineVariant': '#D1D1D1',
      'primary': '#999900',
      'onPrimary': '#FFFFFF',
      'primaryContainer': '#E2E2B8',
      'onPrimaryContainer': '#4D4D23',
      'secondary': '#80800C',
      'secondaryContainer': '#EBEBCC',
      'onSecondaryContainer': '#4D4D23'
    }
  ],
  [
    '#3A6EA5',
    '#3A6EA5',
    {
      'background': '#346395',
      'surface': '#406C9B',
      'surfaceVariant': '#4A74A1',
      'lowest': '#2A4F77',
      'low': '#3A6898',
      'container': '#3E6B9A',
      'high': '#4873A0',
      'highest': '#527AA5',
      'onSurface': '#F2F2F7',
      'onSurfaceVariant': '#C3CEDF',
      'outline': '#6D8FB3',
      'outlineVariant': '#597FA8',
      'primary': '#9DB7D2',
      'onPrimary': '#1A1B3A',
      'primaryContainer': '#517BA6',
      'onPrimaryContainer': '#D0DAE8',
      'secondary': '#AEC3D9',
      'secondaryContainer': '#4974A1',
      'onSecondaryContainer': '#D0DAE8'
    }
  ]
]

test('custom theme colours match the phone', () => {
  for (const [page, accent, expected] of GOLDENS) assert.deepEqual(customThemeColors(page, accent), expected)
})

test('a mid-tone page moves out of the unreadable band', () => {
  const theme = { id: 'a', name: 'Grey', page: '#808080', accent: '#808080' }
  const c = customThemeColors(theme.page, theme.accent)
  assert.notEqual(c.background, '#808080')
  assert.equal(typeof isDarkCustom(theme), 'boolean')
})

test('a custom preset resolves through the saved themes, and falls back to Slate once gone', () => {
  const theme = { id: 'a', name: 'Mine', page: '#F5F0E6', accent: '#2E7D5B' }
  setCustomThemes([theme])
  assert.equal(presetLabel('custom:a'), 'Mine')
  assert.equal(isDarkFor('custom:a'), false)
  assert.deepEqual(schemeFor('custom:a', true), customScheme(theme))
  setCustomThemes([])
  assert.deepEqual(schemeFor('custom:a', true), schemeFor('SLATE', true))
  assert.equal(presetLabel('custom:a'), 'Slate')
})

test('themes sync as their own record, not with the settings', () => {
  const s = defaultState()
  assert.equal(collect(s).prefs.has('uiThemes'), false) // never touched: says nothing to other devices
  s.settings.customThemes = [{ id: 'a', name: 'Mine', page: '#101010', accent: '#FF8800' }]
  const out = collect(s)
  assert.deepEqual(JSON.parse(out.prefs.get('uiThemes')).themes, s.settings.customThemes)
  assert.equal('customThemes' in JSON.parse(out.prefs.get('settings')), false)
  s.settings.customThemes = []
  s.settings.customThemesTouched = true
  assert.deepEqual(JSON.parse(collect(s).prefs.get('uiThemes')).themes, []) // the last one deleted
})

test('losing the theme in use goes back to the preset; a bad theme is left out', () => {
  const s = defaultState()
  s.settings.uiColorPreset = 'custom:a'
  applyRecords(s, [{ coll: 'prefs', id: 'uiThemes', deleted: false, data: { themes: [{ id: 'b', name: 'B', page: 'nope', accent: '#000000' }, { id: 'c', name: 'C', page: '#000000', accent: '#FFFFFF' }] } }])
  assert.deepEqual(s.settings.customThemes.map((t) => t.id), ['c'])
  assert.equal(s.settings.uiColorPreset, 'SLATE')
})

test('the background image never syncs', () => {
  const s = defaultState()
  s.settings.bgImage = 123
  assert.equal('bgImage' in JSON.parse(collect(s).prefs.get('settings')), false)
})
