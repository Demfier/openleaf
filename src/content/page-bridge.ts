// This script runs in the PAGE context (not the content script's isolated world).
// It can access CodeMirror/Monaco and Overleaf/Prism internal APIs.
// Communicates with the content script via window.postMessage.

function isPrism(): boolean {
  return window.location.hostname === 'prism.openai.com'
}

// --- Overleaf (CodeMirror 6) helpers ---

function getEditorView(): any {
  // Method 1: CM6 DOM property
  const cmEditor = document.querySelector('.cm-editor') as any
  if (cmEditor?.cmView?.view) return cmEditor.cmView.view

  // Method 2: Overleaf's unstable store
  const view = (window as any).overleaf?.unstable?.store?.get?.('editor.view')
  if (view) return view

  return null
}

function findBibFileElement(): HTMLElement | null {
  const treeItems = document.querySelectorAll('[role="treeitem"]')
  for (const item of treeItems) {
    const nameEl = item.querySelector('button, span, .file-tree-name-button')
    const text = nameEl?.textContent?.trim()
    if (text && text.endsWith('.bib')) {
      const clickTarget = (item.querySelector('button') || nameEl || item) as HTMLElement
      return clickTarget
    }
  }

  // Fallback: search ALL elements for .bib text
  const walker = document.createTreeWalker(
    document.body,
    NodeFilter.SHOW_ELEMENT,
    {
      acceptNode(node) {
        const el = node as HTMLElement
        const text = el.textContent?.trim()
        if (
          text &&
          text.endsWith('.bib') &&
          !text.includes(' ') &&
          text.length < 60 &&
          el.childElementCount === 0
        ) {
          return NodeFilter.FILTER_ACCEPT
        }
        return NodeFilter.FILTER_SKIP
      },
    }
  )

  return walker.nextNode() as HTMLElement | null
}

function findFileElement(name: string): HTMLElement | null {
  const treeItems = document.querySelectorAll('[role="treeitem"]')
  for (const item of treeItems) {
    const nameEl = item.querySelector('button, span, .file-tree-name-button')
    if (nameEl?.textContent?.trim() === name) {
      return (item.querySelector('button') || nameEl || item) as HTMLElement
    }
  }
  return null
}

// --- Prism (Monaco) helpers ---

function findPrismBibModel(): any | null {
  const monaco = (window as any).monaco
  if (!monaco?.editor) return null
  const models: any[] = monaco.editor.getModels()
  return models.find(m =>
    /@(article|book|inproceedings|incollection|misc|phdthesis|techreport|mastersthesis|unpublished)/i
      .test(m.getValue())
  ) ?? null
}

function findPrismFileButton(name: string): HTMLElement | null {
  for (const item of document.querySelectorAll('[role="treeitem"]')) {
    const span = item.querySelector('span.block')
    if (span?.textContent?.trim() === name) {
      return item.querySelector('button[data-file-row-click="true"]') as HTMLElement
    }
  }
  return null
}

function findPrismBibFileButton(): HTMLElement | null {
  for (const item of document.querySelectorAll('[role="treeitem"]')) {
    const span = item.querySelector('span.block')
    if (span?.textContent?.trim().endsWith('.bib')) {
      return item.querySelector('button[data-file-row-click="true"]') as HTMLElement
    }
  }
  return null
}

function prismApplyBibEdit(bibModel: any, bibtex: string): void {
  const lineCount = bibModel.getLineCount()
  const colCount = bibModel.getLineMaxColumn(lineCount)
  bibModel.applyEdits([{
    range: { startLineNumber: lineCount, startColumn: colCount, endLineNumber: lineCount, endColumn: colCount },
    text: '\n\n' + bibtex + '\n',
    forceMoveMarkers: true,
  }])
}

// --- Message handler ---

window.addEventListener('message', (event) => {
  if (event.source !== window) return
  if (event.data?.source !== 'openleaf-content') return

  const { action, id } = event.data

  // ── getEditorText ──────────────────────────────────────────────────────────

  if (action === 'getEditorText') {
    if (isPrism()) {
      const monaco = (window as any).monaco
      const models: any[] = monaco?.editor?.getModels() ?? []
      const texModel = models.find(m => {
        const v = m.getValue()
        return v.includes('\\documentclass') || v.includes('\\begin{document}')
      })
      const text = texModel?.getValue()
        ?? monaco?.editor?.getEditors()?.[0]?.getModel()?.getValue()
        ?? null
      window.postMessage({ source: 'openleaf-page', action: 'editorText', id, text }, window.location.origin)
      return
    }

    // Overleaf
    const view = getEditorView()
    const text = view ? view.state.doc.toString() : null
    window.postMessage({ source: 'openleaf-page', action: 'editorText', id, text }, window.location.origin)
  }

  // ── getBibText ─────────────────────────────────────────────────────────────

  if (action === 'getBibText') {
    if (isPrism()) {
      // Monaco keeps all models in memory — try direct access first (no file switch)
      const bibModel = findPrismBibModel()
      if (bibModel) {
        window.postMessage({ source: 'openleaf-page', action: 'bibText', id, text: bibModel.getValue() }, window.location.origin)
        return
      }

      // Model not loaded yet — click the bib file to load it, then switch back
      const currentFile = new URLSearchParams(window.location.search).get('m')
      const bibBtn = findPrismBibFileButton()
      if (!bibBtn) {
        window.postMessage({ source: 'openleaf-page', action: 'bibText', id, text: null }, window.location.origin)
        return
      }
      bibBtn.click()
      setTimeout(() => {
        const text = findPrismBibModel()?.getValue() ?? null
        if (currentFile) findPrismFileButton(currentFile)?.click()
        setTimeout(() => {
          window.postMessage({ source: 'openleaf-page', action: 'bibText', id, text }, window.location.origin)
        }, 400)
      }, 800)
      return
    }

    // Overleaf
    const openDocName = (window as any).overleaf?.unstable?.store?.get?.('editor.open_doc_name')

    if (openDocName && openDocName.endsWith('.bib')) {
      const view = getEditorView()
      const text = view ? view.state.doc.toString() : null
      window.postMessage({ source: 'openleaf-page', action: 'bibText', id, text }, window.location.origin)
      return
    }

    const bibEl = findBibFileElement()
    if (!bibEl) {
      window.postMessage({ source: 'openleaf-page', action: 'bibText', id, text: null }, window.location.origin)
      return
    }

    bibEl.click()
    setTimeout(() => {
      const view = getEditorView()
      const text = view ? view.state.doc.toString() : null
      if (openDocName) findFileElement(openDocName)?.click()
      setTimeout(() => {
        window.postMessage({ source: 'openleaf-page', action: 'bibText', id, text }, window.location.origin)
      }, 400)
    }, 800)
  }

  // ── appendToBibFile ────────────────────────────────────────────────────────

  if (action === 'appendToBibFile') {
    const { bibtex } = event.data

    if (isPrism()) {
      // Try direct model edit — no file switching needed if model is in memory
      let bibModel = findPrismBibModel()
      if (bibModel) {
        prismApplyBibEdit(bibModel, bibtex)
        window.postMessage({ source: 'openleaf-page', action: 'bibAppendResult', id, success: true }, window.location.origin)
        return
      }

      // Model not loaded — switch to bib file, edit, switch back
      const currentFile = new URLSearchParams(window.location.search).get('m')
      const bibBtn = findPrismBibFileButton()
      if (!bibBtn) {
        window.postMessage({ source: 'openleaf-page', action: 'bibAppendResult', id, success: false, reason: 'no-bib-file' }, window.location.origin)
        return
      }
      bibBtn.click()
      setTimeout(() => {
        bibModel = findPrismBibModel()
        if (bibModel) prismApplyBibEdit(bibModel, bibtex)
        if (currentFile) findPrismFileButton(currentFile)?.click()
        setTimeout(() => {
          window.postMessage({ source: 'openleaf-page', action: 'bibAppendResult', id, success: !!bibModel, reason: bibModel ? undefined : 'no-bib-file' }, window.location.origin)
        }, 400)
      }, 800)
      return
    }

    // Overleaf
    const openDocName = (window as any).overleaf?.unstable?.store?.get?.('editor.open_doc_name')
    const bibEl = findBibFileElement()
    if (!bibEl) {
      window.postMessage({ source: 'openleaf-page', action: 'bibAppendResult', id, success: false, reason: 'no-bib-file' }, window.location.origin)
      return
    }

    bibEl.click()
    setTimeout(() => {
      const view = getEditorView()
      if (!view) {
        window.postMessage({ source: 'openleaf-page', action: 'bibAppendResult', id, success: false, reason: 'editor-not-found' }, window.location.origin)
        return
      }
      const docLength = view.state.doc.length
      view.dispatch({ changes: { from: docLength, insert: '\n\n' + bibtex + '\n' } })

      setTimeout(() => {
        if (openDocName) findFileElement(openDocName)?.click()
        window.postMessage({ source: 'openleaf-page', action: 'bibAppendResult', id, success: true }, window.location.origin)
      }, 400)
    }, 800)
  }
})
