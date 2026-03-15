// This script runs in the PAGE context (not the content script's isolated world).
// It can access CodeMirror's EditorView and Overleaf's internal APIs.
// Communicates with the content script via window.postMessage.

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
  // The file tree in Overleaf uses role="treeitem" with nested buttons/spans.
  // We need to find any element whose visible text is exactly "references.bib"
  // or ends with ".bib"
  const treeItems = document.querySelectorAll('[role="treeitem"]')
  for (const item of treeItems) {
    const nameEl = item.querySelector('button, span, .file-tree-name-button')
    const text = nameEl?.textContent?.trim()
    if (text && text.endsWith('.bib')) {
      // Click the treeitem itself or its first interactive child
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

  const match = walker.nextNode() as HTMLElement | null
  return match
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

window.addEventListener('message', (event) => {
  if (event.source !== window) return
  if (event.data?.source !== 'openleaf-content') return

  const { action, id } = event.data

  if (action === 'getEditorText') {
    const view = getEditorView()
    const text = view ? view.state.doc.toString() : null
    window.postMessage({ source: 'openleaf-page', action: 'editorText', id, text }, window.location.origin)
  }

  if (action === 'appendToBibFile') {
    const { bibtex } = event.data

    // Remember which file is currently open
    const openDocName = (window as any).overleaf?.unstable?.store?.get?.('editor.open_doc_name')

    const bibEl = findBibFileElement()
    if (!bibEl) {
      window.postMessage({
        source: 'openleaf-page', action: 'bibAppendResult', id,
        success: false, reason: 'no-bib-file',
      }, window.location.origin)
      return
    }

    // Click the .bib file to open it in the editor
    bibEl.click()

    // Wait for the editor to switch to the bib file
    setTimeout(() => {
      const view = getEditorView()
      if (!view) {
        window.postMessage({
          source: 'openleaf-page', action: 'bibAppendResult', id,
          success: false, reason: 'editor-not-found',
        }, window.location.origin)
        return
      }

      // Append bibtex at the end of the document
      const docLength = view.state.doc.length
      view.dispatch({
        changes: { from: docLength, insert: '\n\n' + bibtex + '\n' },
      })

      // Switch back to the original file
      setTimeout(() => {
        if (openDocName) {
          const origEl = findFileElement(openDocName)
          if (origEl) origEl.click()
        }
        window.postMessage({
          source: 'openleaf-page', action: 'bibAppendResult', id,
          success: true,
        }, window.location.origin)
      }, 400)
    }, 800)
  }
})
