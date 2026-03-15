import { DEFAULT_SETTINGS, type ExtensionSettings } from '@shared/types'

const FIELDS: (keyof ExtensionSettings)[] = [
  'llmBaseUrl',
  'llmApiKey',
  'llmModel',
  'semanticScholarApiKey',
  'serperApiKey',
  'openAlexEmail',
  'scoreThreshold',
  'maxResultsPerSource',
  'maxResultsPerParagraph',
]

const NUM_FIELDS = new Set([
  'scoreThreshold',
  'maxResultsPerSource',
  'maxResultsPerParagraph',
])

async function loadSettings(): Promise<void> {
  const { settings = {} } = await chrome.storage.sync.get('settings')
  const merged = { ...DEFAULT_SETTINGS, ...settings }

  for (const field of FIELDS) {
    const el = document.getElementById(field) as HTMLInputElement
    if (el) el.value = String(merged[field])
  }
}

async function saveSettings(): Promise<void> {
  const settings: Record<string, any> = {}
  for (const field of FIELDS) {
    const el = document.getElementById(field) as HTMLInputElement
    if (!el) continue
    settings[field] = NUM_FIELDS.has(field)
      ? parseInt(el.value, 10) || DEFAULT_SETTINGS[field]
      : el.value
  }

  await chrome.storage.sync.set({ settings })

  const status = document.getElementById('status')!
  status.style.display = 'block'
  setTimeout(() => {
    status.style.display = 'none'
  }, 2000)
}

document.addEventListener('DOMContentLoaded', loadSettings)
document.getElementById('save')?.addEventListener('click', saveSettings)
