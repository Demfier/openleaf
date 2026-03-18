import { splitIntoParagraphs } from '@shared/keyword-extractor'
import type { ParagraphResult, RankedPaper } from '@shared/types'

// --- Page Bridge ---
// Content scripts run in an isolated world and can't access JS properties
// on DOM elements (like cmView). We inject a script into the page context
// that can access CodeMirror and communicates back via postMessage.

let msgId = 0

function injectPageBridge(): void {
  const script = document.createElement('script')
  script.src = chrome.runtime.getURL('dist/page-bridge.js')
  ;(document.head || document.documentElement).appendChild(script)
  script.onload = () => script.remove()
}

function sendToPage<T>(action: string, data?: Record<string, any>): Promise<T> {
  const id = ++msgId
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      window.removeEventListener('message', handler)
      reject(new Error('Page bridge timeout'))
    }, 10000)

    function handler(event: MessageEvent) {
      if (event.data?.source !== 'openleaf-page') return
      if (event.data.id !== id) return
      window.removeEventListener('message', handler)
      clearTimeout(timeout)
      resolve(event.data as T)
    }

    window.addEventListener('message', handler)
    window.postMessage({ source: 'openleaf-content', action, id, ...data }, window.location.origin)
  })
}

async function getEditorText(): Promise<string | null> {
  const resp = await sendToPage<{ text: string | null }>('getEditorText')
  return resp.text
}

async function getBibText(): Promise<string | null> {
  const resp = await sendToPage<{ text: string | null }>('getBibText')
  return resp.text
}

function parseExistingBibEntries(bibText: string): { dois: Set<string>; arxivIds: Set<string>; titles: Set<string> } {
  const dois = new Set<string>()
  const arxivIds = new Set<string>()
  const titles = new Set<string>()

  for (const m of bibText.matchAll(/doi\s*=\s*\{([^}]+)\}/gi))
    dois.add(m[1].toLowerCase().trim())
  for (const m of bibText.matchAll(/doi\s*=\s*"([^"]+)"/gi))
    dois.add(m[1].toLowerCase().trim())

  for (const m of bibText.matchAll(/eprint\s*=\s*\{([^}]+)\}/gi))
    arxivIds.add(m[1].toLowerCase().replace(/v\d+$/, '').trim())
  for (const m of bibText.matchAll(/arxiv\.org\/abs\/([^\s"{}]+)/gi))
    arxivIds.add(m[1].toLowerCase().replace(/v\d+$/, '').trim())

  for (const m of bibText.matchAll(/title\s*=\s*\{([^}]+)\}/gi))
    titles.add(m[1].toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 60))
  for (const m of bibText.matchAll(/title\s*=\s*"([^"]+)"/gi))
    titles.add(m[1].toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 60))

  return { dois, arxivIds, titles }
}

function isAlreadyInBib(
  paper: RankedPaper,
  dois: Set<string>,
  arxivIds: Set<string>,
  titles: Set<string>
): boolean {
  if (paper.doi && dois.has(paper.doi.toLowerCase().trim())) return true
  if (paper.arxivId && arxivIds.has(paper.arxivId.toLowerCase().replace(/v\d+$/, '').trim())) return true
  const normTitle = paper.title.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 60)
  return titles.has(normTitle)
}

async function appendToBibFile(bibtex: string): Promise<boolean> {
  const resp = await sendToPage<{ success: boolean; reason?: string }>(
    'appendToBibFile',
    { bibtex }
  )
  if (!resp.success && resp.reason === 'no-bib-file') {
    await navigator.clipboard.writeText(bibtex)
    return false
  }
  return resp.success
}

// --- Cache ---

function getCacheKey(): string {
  // Prism uses query param ?u=UUID as project identifier
  const prismProject = new URLSearchParams(window.location.search).get('u')
  if (prismProject) return `openleaf_cache_prism_${prismProject}`
  // Overleaf uses the URL path (e.g. "/project/abc123")
  return `openleaf_cache_${window.location.pathname}`
}

async function saveCache(): Promise<void> {
  const key = getCacheKey()
  await chrome.storage.local.set({
    [key]: {
      results: currentResults,
      addedKeys: [...addedKeys],
      reviewText,
      reviewMode,
      reviewStatus: reviewStatus === 'loading' ? 'success' : reviewStatus,
      timestamp: Date.now(),
    },
  })
}

async function loadCache(): Promise<boolean> {
  const key = getCacheKey()
  const data = await chrome.storage.local.get(key)
  const cached = data[key]
  if (!cached) return false

  let hasData = false

  if (cached.results && cached.results.length > 0) {
    currentResults = cached.results
    addedKeys = new Set(cached.addedKeys || [])
    searchStatus = 'success'
    hasData = true
  }

  if (cached.reviewText) {
    reviewText = cached.reviewText
    reviewMode = cached.reviewMode || 'friendly'
    reviewStatus = 'success'
    hasData = true
  }

  return hasData
}

async function clearCache(): Promise<void> {
  const key = getCacheKey()
  await chrome.storage.local.remove(key)
}

// --- Bib Cache ---

let existingBibEntries = {
  dois: new Set<string>(),
  arxivIds: new Set<string>(),
  titles: new Set<string>(),
}

// Stored so runSearch() can await it on the first click if still in progress
let bibCachePromise: Promise<void> | null = null

async function refreshBibCache(): Promise<void> {
  try {
    const bibText = await getBibText()
    if (bibText) existingBibEntries = parseExistingBibEntries(bibText)
  } catch { /* ignore */ }
}

// --- UI State ---

let panelRoot: HTMLDivElement | null = null
let currentResults: ParagraphResult[] = []
let addedKeys = new Set<string>()
let searchStatus: 'idle' | 'loading' | 'success' | 'error' = 'idle'
let errorMessage = ''

// Tab state
let activeTab: 'citations' | 'review' = 'citations'

// Review state
let reviewText = ''
let reviewStatus: 'idle' | 'loading' | 'success' | 'error' = 'idle'
let reviewMode: 'friendly' | 'fire' = 'friendly'
let reviewError = ''

// --- Panel UI ---

function createPanel(): HTMLDivElement {
  if (panelRoot) return panelRoot
  panelRoot = document.createElement('div')
  panelRoot.id = 'openleaf-panel'
  document.body.appendChild(panelRoot)
  renderPanel()
  return panelRoot
}

function togglePanel(): void {
  if (!panelRoot) createPanel()
  else panelRoot.classList.toggle('openleaf-hidden')
}

function renderPanel(): void {
  if (!panelRoot) return

  panelRoot.innerHTML = `
    <div class="openleaf-header">
      <span class="openleaf-title">OpenLeaf</span>
      <button class="openleaf-close" id="openleaf-close">&times;</button>
    </div>
    <div class="openleaf-tabs">
      <button class="openleaf-tab ${activeTab === 'citations' ? 'openleaf-tab-active' : ''}" data-tab="citations">Citations</button>
      <button class="openleaf-tab ${activeTab === 'review' ? 'openleaf-tab-active' : ''}" data-tab="review">Review</button>
    </div>
    ${activeTab === 'citations' ? renderCitationsTab() : renderReviewTab()}
  `

  // Tab switching
  panelRoot.querySelectorAll('.openleaf-tab').forEach(el => {
    el.addEventListener('click', () => {
      activeTab = (el as HTMLElement).dataset.tab as 'citations' | 'review'
      renderPanel()
    })
  })

  // Common
  panelRoot.querySelector('#openleaf-close')?.addEventListener('click', togglePanel)

  if (activeTab === 'citations') {
    bindCitationEvents()
  } else {
    bindReviewEvents()
  }
}

function renderCitationsTab(): string {
  return `
    <div class="openleaf-toolbar">
      <button class="openleaf-btn openleaf-btn-primary" id="openleaf-search"
        ${searchStatus === 'loading' ? 'disabled' : ''}>
        ${searchStatus === 'loading'
          ? 'Searching...'
          : '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>Search'
        }
      </button>
      ${searchStatus === 'success' ? '<button class="openleaf-btn" id="openleaf-clear">Clear</button>' : ''}
    </div>
    ${errorMessage ? `<div class="openleaf-error">${escapeHtml(errorMessage)}</div>` : ''}
    <div class="openleaf-results">
      ${searchStatus === 'idle' ? renderEmptyState() : ''}
      ${searchStatus === 'loading' || searchStatus === 'success' ? currentResults.map(renderParagraph).join('') : ''}
      ${searchStatus === 'loading' ? `<div class="openleaf-progress">${escapeHtml(progressText)}</div>` : ''}
      ${searchStatus === 'success' && !currentResults.length ? '<div class="openleaf-loading">No suggestions found for this document.</div>' : ''}
    </div>
  `
}

function renderReviewTab(): string {
  return `
    <div class="openleaf-toolbar openleaf-review-toolbar">
      <div class="openleaf-mode-toggle">
        <button class="openleaf-mode-btn ${reviewMode === 'friendly' ? 'openleaf-mode-active' : ''}" data-mode="friendly" title="Constructive, supportive review">&#129309; Friendly</button>
        <button class="openleaf-mode-btn ${reviewMode === 'fire' ? 'openleaf-mode-active openleaf-mode-fire' : ''}" data-mode="fire" title="Harsh Reviewer #2 mode">&#128293; Fire</button>
      </div>
      <div style="display:flex;gap:8px">
        <button class="openleaf-btn openleaf-btn-primary" id="openleaf-review"
          ${reviewStatus === 'loading' ? 'disabled' : ''} style="flex:1">
          ${reviewStatus === 'loading' ? 'Reviewing...' : 'Review Paper'}
        </button>
        ${reviewStatus === 'success' ? '<button class="openleaf-btn" id="openleaf-review-clear">Clear</button>' : ''}
      </div>
    </div>
    ${reviewError ? `<div class="openleaf-error">${escapeHtml(reviewError)}</div>` : ''}
    <div class="openleaf-results openleaf-review-content">
      ${reviewStatus === 'idle' ? renderReviewEmptyState() : ''}
      ${reviewStatus === 'loading' || reviewStatus === 'success' ? `<div class="openleaf-review-text">${renderMarkdown(reviewText)}</div>` : ''}
      ${reviewStatus === 'loading' ? '<div class="openleaf-progress">Reviewing your paper...</div>' : ''}
    </div>
  `
}

function renderReviewEmptyState(): string {
  return `
    <div class="openleaf-empty">
      <div class="openleaf-empty-icon" style="font-size:32px">
        <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" width="48" height="48"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z" fill="#4f9c45" opacity="0.7"/><path d="M7 9h10v1.5H7V9zm0 3h7v1.5H7V12z" fill="white"/></svg>
      </div>
      <div class="openleaf-empty-title">Get feedback on your paper</div>
      <div class="openleaf-empty-desc">
        Choose <b>Friendly</b> for constructive suggestions or <b>Fire</b> for the dreaded Reviewer #2 experience.
      </div>
    </div>
  `
}

function renderMarkdown(text: string): string {
  if (!text) return ''
  let html = escapeHtml(text)
  // Bold
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  // Italic
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>')
  // Headers
  html = html.replace(/^##### (.+)$/gm, '<h5>$1</h5>')
  html = html.replace(/^#### (.+)$/gm, '<h4>$1</h4>')
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>')
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>')
  html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>')
  // List items
  html = html.replace(/^- (.+)$/gm, '<li>$1</li>')
  html = html.replace(/^(\d+)\. (.+)$/gm, '<li>$2</li>')
  // Paragraphs (double newline)
  html = html.replace(/\n\n/g, '</p><p>')
  // Single newlines within paragraphs
  html = html.replace(/\n/g, '<br>')
  return `<p>${html}</p>`
}

function bindCitationEvents(): void {
  if (!panelRoot) return

  panelRoot.querySelector('#openleaf-search')?.addEventListener('click', runSearch)
  panelRoot.querySelector('#openleaf-clear')?.addEventListener('click', () => {
    currentResults = []
    addedKeys = new Set()
    searchStatus = 'idle'
    errorMessage = ''
    clearCache()
    renderPanel()
  })

  panelRoot.querySelectorAll('.openleaf-para-header').forEach(el => {
    el.addEventListener('click', () => {
      const list = el.nextElementSibling as HTMLElement
      if (list) list.classList.toggle('openleaf-hidden')
      const arrow = el.querySelector('.openleaf-arrow')
      if (arrow) arrow.textContent = list?.classList.contains('openleaf-hidden') ? '>' : 'v'
    })
  })

  panelRoot.querySelectorAll('.openleaf-info-icon').forEach(el => {
    el.addEventListener('click', () => {
      const wrap = el.parentElement as HTMLElement
      if (wrap) wrap.classList.toggle('openleaf-info-open')
    })
  })

  panelRoot.querySelectorAll('.openleaf-add-btn').forEach(el => {
    el.addEventListener('click', async () => {
      const idx = parseInt(el.getAttribute('data-para')!, 10)
      const sidx = parseInt(el.getAttribute('data-sug')!, 10)
      const suggestion = currentResults[idx]?.suggestions[sidx]
      if (!suggestion) return

      const added = await appendToBibFile(suggestion.bibtex)
      addedKeys.add(suggestion.citeKey)
      if (suggestion.doi) existingBibEntries.dois.add(suggestion.doi.toLowerCase().trim())
      if (suggestion.arxivId) existingBibEntries.arxivIds.add(suggestion.arxivId.toLowerCase().replace(/v\d+$/, '').trim())
      existingBibEntries.titles.add(suggestion.title.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 60))
      saveCache()
      if (!added) {
        errorMessage = 'BibTeX copied to clipboard (no .bib file found). Paste it manually.'
      }
      renderPanel()
    })
  })

}

function bindReviewEvents(): void {
  if (!panelRoot) return

  panelRoot.querySelectorAll('.openleaf-mode-btn').forEach(el => {
    el.addEventListener('click', () => {
      reviewMode = (el as HTMLElement).dataset.mode as 'friendly' | 'fire'
      renderPanel()
    })
  })

  panelRoot.querySelector('#openleaf-review')?.addEventListener('click', runReview)
  panelRoot.querySelector('#openleaf-review-clear')?.addEventListener('click', () => {
    reviewText = ''
    reviewStatus = 'idle'
    reviewError = ''
    saveCache()
    renderPanel()
  })
}

async function runReview(): Promise<void> {
  reviewStatus = 'loading'
  reviewText = ''
  reviewError = ''
  renderPanel()

  try {
    const text = await getEditorText()
    if (!text) {
      throw new Error('Could not read editor content.')
    }

    const port = chrome.runtime.connect({ name: 'paper-review' })

    port.onMessage.addListener(msg => {
      if (msg.type === 'REVIEW_STARTED') {
        reviewStatus = 'loading'
        renderPanel()
      }

      if (msg.type === 'REVIEW_CHUNK') {
        reviewText += msg.text
        renderPanel()
        // Auto-scroll to bottom
        const content = panelRoot?.querySelector('.openleaf-review-content')
        if (content) content.scrollTop = content.scrollHeight
      }

      if (msg.type === 'REVIEW_COMPLETE') {
        reviewStatus = 'success'
        saveCache()
        renderPanel()
        port.disconnect()
      }

      if (msg.type === 'REVIEW_ERROR') {
        reviewStatus = 'error'
        reviewError = msg.error
        renderPanel()
        port.disconnect()
      }
    })

    port.onDisconnect.addListener(() => {
      if (reviewStatus === 'loading') {
        reviewStatus = reviewText ? 'success' : 'error'
        if (!reviewText) reviewError = 'Review connection lost. Try again.'
        renderPanel()
      }
    })

    port.postMessage({ type: 'START_REVIEW', mode: reviewMode, fullText: text })
  } catch (err: any) {
    reviewStatus = 'error'
    reviewError = err.message || 'Review failed'
    renderPanel()
  }
}

function renderEmptyState(): string {
  return `
    <div class="openleaf-empty">
      <div class="openleaf-empty-icon"><svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" width="48" height="48"><rect x="4" y="15" width="16" height="3.5" rx="0.8" fill="#4f9c45"/><rect x="5" y="10.5" width="16" height="3.5" rx="0.8" fill="#5aad50"/><rect x="6" y="6" width="16" height="3.5" rx="0.8" fill="#6bbe61"/></svg></div>
      <div class="openleaf-empty-title">Find relevant papers to cite</div>
      <div class="openleaf-empty-desc">Click "Search" to analyze the current document and discover papers paragraph by paragraph.</div>
    </div>
  `
}

function renderParagraph(result: ParagraphResult, pIdx: number): string {
  return `
    <div class="openleaf-para">
      <button class="openleaf-para-header">
        <span class="openleaf-arrow">v</span>
        <span class="openleaf-para-label">Paragraph ${result.paragraphIndex + 1}</span>
        <span class="openleaf-badge">${result.suggestions.length}</span>
      </button>
      <div class="openleaf-para-body">
        <p class="openleaf-para-preview">${escapeHtml(result.paragraphPreview)}</p>
        ${result.suggestions.map((s, sIdx) => renderSuggestion(s, pIdx, sIdx)).join('')}
      </div>
    </div>
  `
}

function getArticleUrl(s: RankedPaper): string | null {
  if (s.doi) return `https://doi.org/${s.doi}`
  if (s.arxivId) return `https://arxiv.org/abs/${s.arxivId}`
  if (s.url && /^https?:\/\//.test(s.url)) return s.url
  return null
}

function renderSuggestion(s: RankedPaper, pIdx: number, sIdx: number): string {
  const authors =
    s.authors.length > 3
      ? s.authors.slice(0, 3).join(', ') + ' et al.'
      : s.authors.join(', ')
  const abstractPreview =
    s.abstract.length > 150 ? s.abstract.slice(0, 150) + '...' : s.abstract
  const isAdded = addedKeys.has(s.citeKey)
  const articleUrl = getArticleUrl(s)
  const titleHtml = articleUrl
    ? `<a href="${escapeHtml(articleUrl)}" target="_blank" rel="noopener">${escapeHtml(s.title)}</a>`
    : escapeHtml(s.title)

  return `
    <div class="openleaf-card">
      <div class="openleaf-card-title">${titleHtml}</div>
      <div class="openleaf-card-meta">
        ${authors ? `<span>${escapeHtml(authors)}</span>` : ''}
        ${s.year ? `<span>${s.year}</span>` : ''}
        ${s.citationCount ? `<span>${s.citationCount} cit.</span>` : ''}
        <span class="openleaf-score">${s.score}/100</span>
        ${s.reasoning
          ? `<span class="openleaf-info-wrap"><span class="openleaf-info-icon" title="Why this score?">&#9432;</span><div class="openleaf-reasoning"><div class="openleaf-for"><span class="openleaf-icon-plus">+</span> ${escapeHtml(s.reasoning.for)}</div><div class="openleaf-against"><span class="openleaf-icon-minus">&minus;</span> ${escapeHtml(s.reasoning.against)}</div></div></span>`
          : ''
        }
      </div>
      ${abstractPreview ? `<p class="openleaf-card-abstract">${escapeHtml(abstractPreview)}</p>` : ''}
      <div class="openleaf-card-actions">
        ${isAdded
          ? '<span class="openleaf-added-label">&#10003; Added</span>'
          : `<button class="openleaf-add-btn openleaf-btn openleaf-btn-primary" data-para="${pIdx}" data-sug="${sIdx}">+ Add</button>`
        }
        ${articleUrl ? `<a class="openleaf-card-link" href="${escapeHtml(articleUrl)}" target="_blank" rel="noopener">View paper &rarr;</a>` : ''}
      </div>
    </div>
  `
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// --- Search (streaming via port) ---

let progressText = ''

async function runSearch(): Promise<void> {
  searchStatus = 'loading'
  errorMessage = ''
  currentResults = []
  progressText = 'Reading document...'
  renderPanel()

  // On the first click, wait for the bib cache to finish loading
  if (bibCachePromise) {
    await bibCachePromise
    bibCachePromise = null
  }

  try {
    const text = await getEditorText()
    if (!text) {
      throw new Error('Could not read editor content. Make sure the Code Editor tab is active.')
    }

    const paragraphs = splitIntoParagraphs(text)
    if (!paragraphs.length) {
      searchStatus = 'success'
      renderPanel()
      return
    }

    const port = chrome.runtime.connect({ name: 'citation-search' })

    port.onMessage.addListener(msg => {
      if (msg.type === 'SEARCH_STARTED') {
        progressText = `Processing 0/${msg.totalParagraphs} paragraphs...`
        renderPanel()
      }

      if (msg.type === 'PARAGRAPH_RESULT') {
        if (msg.result) {
          const suggestions = msg.result.suggestions.filter(
            (s: RankedPaper) => !isAlreadyInBib(s, existingBibEntries.dois, existingBibEntries.arxivIds, existingBibEntries.titles)
          )
          if (suggestions.length > 0) {
            currentResults = [...currentResults, { ...msg.result, suggestions }]
            saveCache()
          }
        }
        progressText = `Processing ${msg.completedCount}/${msg.totalParagraphs} paragraphs...`
        searchStatus = 'loading'
        renderPanel()
      }

      if (msg.type === 'SEARCH_COMPLETE') {
        searchStatus = 'success'
        progressText = ''
        saveCache()
        renderPanel()
        port.disconnect()
      }
    })

    port.onDisconnect.addListener(() => {
      if (searchStatus === 'loading') {
        // Keep whatever results we already have
        searchStatus = 'success'
        if (!currentResults.length) {
          errorMessage = 'Search was interrupted. Try again.'
        }
        progressText = ''
        renderPanel()
      }
    })

    port.postMessage({ type: 'SEARCH_CITATIONS', paragraphs, fullText: text })
  } catch (err: any) {
    searchStatus = 'error'
    errorMessage = err.message || 'Search failed'
    renderPanel()
  }
}

// --- FAB ---

function injectFAB(): void {
  const fab = document.createElement('button')
  fab.id = 'openleaf-fab'
  fab.innerHTML = `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><rect x="4" y="15" width="16" height="3.5" rx="0.8" fill="white"/><rect x="5" y="10.5" width="16" height="3.5" rx="0.8" fill="white"/><rect x="6" y="6" width="16" height="3.5" rx="0.8" fill="white"/></svg>`
  fab.title = 'OpenLeaf Citation Search'
  fab.addEventListener('click', () => {
    createPanel()
    panelRoot!.classList.remove('openleaf-hidden')
  })
  document.body.appendChild(fab)
}

// --- Init ---

async function init(): Promise<void> {
  injectPageBridge()

  // Load cached results
  const hasCached = await loadCache()

  function onEditorReady() {
    injectFAB()
    if (hasCached) createPanel()
    // Start loading bib cache immediately; small delay ensures page bridge is ready
    bibCachePromise = new Promise<void>(resolve =>
      setTimeout(() => refreshBibCache().finally(resolve), 500)
    )
  }

  const observer = new MutationObserver((_mutations, obs) => {
    if (document.querySelector('.cm-editor, .monaco-editor')) {
      obs.disconnect()
      onEditorReady()
    }
  })
  observer.observe(document.body, { childList: true, subtree: true })

  if (document.querySelector('.cm-editor, .monaco-editor')) {
    onEditorReady()
  }
}

init()
