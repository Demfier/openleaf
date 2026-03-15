import {
  searchSemanticScholar,
  searchOpenAlex,
  searchSerper,
} from '@shared/api-clients'
import { deduplicate } from '@shared/deduplicator'
import { rankPapers } from '@shared/debate-ranker'
import { extractKeywords } from '@shared/keyword-extractor'
import type { ExtensionSettings, ParagraphResult } from '@shared/types'
import {
  FRIENDLY_SYSTEM_PROMPT,
  FIRE_SYSTEM_PROMPT,
  REVIEW_USER_PROMPT,
} from '@shared/review-prompts'

async function getSettings(): Promise<ExtensionSettings> {
  const { settings } = await chrome.storage.sync.get('settings')
  return {
    llmBaseUrl: 'http://localhost:11434/v1',
    llmApiKey: '',
    llmModel: 'llama3.1:8b',
    semanticScholarApiKey: '',
    serperApiKey: '',
    openAlexEmail: '',
    scoreThreshold: 60,
    maxResultsPerSource: 10,
    maxResultsPerParagraph: 5,
    ...settings,
  }
}

async function processParagraph(
  paragraph: { index: number; text: string },
  settings: ExtensionSettings,
  fullDocText: string
): Promise<ParagraphResult | null> {
  const query = extractKeywords(paragraph.text)
  if (!query) return null

  const [s2, oa, serper] = await Promise.allSettled([
    searchSemanticScholar(query, settings),
    searchOpenAlex(query, settings),
    searchSerper(query, settings),
  ])

  const allPapers = [
    ...(s2.status === 'fulfilled' ? s2.value : []),
    ...(oa.status === 'fulfilled' ? oa.value : []),
    ...(serper.status === 'fulfilled' ? serper.value : []),
  ]

  if (!allPapers.length) return null

  const unique = deduplicate(allPapers)
  const ranked = await rankPapers(query, unique, settings, fullDocText)

  const filtered = ranked
    .filter(p => p.score >= settings.scoreThreshold)
    .sort((a, b) => b.score - a.score)
    .slice(0, settings.maxResultsPerParagraph)

  if (!filtered.length) return null

  const preview =
    paragraph.text.length > 100
      ? paragraph.text.slice(0, 100) + '...'
      : paragraph.text

  return {
    paragraphIndex: paragraph.index,
    paragraphPreview: preview,
    suggestions: filtered,
  }
}

// Keep service worker alive during long-running searches.
// Chrome kills service workers after ~30s of inactivity.
let keepAliveInterval: ReturnType<typeof setInterval> | null = null

function startKeepAlive() {
  stopKeepAlive()
  keepAliveInterval = setInterval(() => {
    chrome.runtime.getPlatformInfo(() => {})
  }, 20000)
}

function stopKeepAlive() {
  if (keepAliveInterval) {
    clearInterval(keepAliveInterval)
    keepAliveInterval = null
  }
}

// Port-based streaming for paragraph-by-paragraph results
chrome.runtime.onConnect.addListener(port => {
  if (port.name !== 'citation-search') return

  let disconnected = false
  port.onDisconnect.addListener(() => {
    disconnected = true
    stopKeepAlive()
  })

  function safeSend(msg: any) {
    if (disconnected) return
    try {
      port.postMessage(msg)
    } catch {
      disconnected = true
    }
  }

  port.onMessage.addListener(async message => {
    if (message.type !== 'SEARCH_CITATIONS') return

    startKeepAlive()

    const settings = await getSettings()
    const paragraphs: { index: number; text: string }[] = message.paragraphs
    const fullText: string = message.fullText || ''

    const beginDoc = fullText.indexOf('\\begin{document}')
    const endDoc = fullText.indexOf('\\end{document}')
    const bodyText = beginDoc >= 0
      ? fullText.slice(
          beginDoc + '\\begin{document}'.length,
          endDoc >= 0 ? endDoc : undefined
        )
      : fullText
    const cleanedFullText = extractKeywords(bodyText.slice(0, 4000))

    safeSend({
      type: 'SEARCH_STARTED',
      totalParagraphs: paragraphs.length,
    })

    let completedCount = 0

    for (const paragraph of paragraphs) {
      if (disconnected) break

      try {
        const result = await processParagraph(
          paragraph,
          settings,
          cleanedFullText
        )
        completedCount++
        safeSend({
          type: 'PARAGRAPH_RESULT',
          result,
          completedCount,
          totalParagraphs: paragraphs.length,
        })
      } catch (err: any) {
        completedCount++
        console.warn('[OpenLeaf] Error processing paragraph:', err)
        safeSend({
          type: 'PARAGRAPH_RESULT',
          result: null,
          completedCount,
          totalParagraphs: paragraphs.length,
        })
      }
    }

    safeSend({ type: 'SEARCH_COMPLETE' })
    stopKeepAlive()
  })
})

// Port for paper review (streamed)
chrome.runtime.onConnect.addListener(port => {
  if (port.name !== 'paper-review') return

  let disconnected = false
  port.onDisconnect.addListener(() => {
    disconnected = true
    stopKeepAlive()
  })

  function safeSend(msg: any) {
    if (disconnected) return
    try { port.postMessage(msg) } catch { disconnected = true }
  }

  port.onMessage.addListener(async message => {
    if (message.type !== 'START_REVIEW') return

    startKeepAlive()
    const settings = await getSettings()
    const mode: 'friendly' | 'fire' = message.mode || 'friendly'
    const fullText: string = message.fullText || ''

    const systemPrompt =
      mode === 'fire' ? FIRE_SYSTEM_PROMPT : FRIENDLY_SYSTEM_PROMPT
    const userPrompt = REVIEW_USER_PROMPT.replace('{paperText}', fullText.slice(0, 12000))

    safeSend({ type: 'REVIEW_STARTED' })

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      }
      if (settings.llmApiKey) {
        headers['Authorization'] = `Bearer ${settings.llmApiKey}`
      }

      const resp = await fetch(`${settings.llmBaseUrl}/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: settings.llmModel,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          temperature: mode === 'fire' ? 0.7 : 0.4,
          stream: true,
        }),
        signal: AbortSignal.timeout(180000),
      })

      if (!resp.ok) throw new Error(`LLM returned ${resp.status}`)

      const reader = resp.body?.getReader()
      if (!reader) throw new Error('No response body')

      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        if (disconnected) break
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const data = line.slice(6).trim()
          if (data === '[DONE]') continue
          try {
            const parsed = JSON.parse(data)
            const delta = parsed.choices?.[0]?.delta?.content
            if (delta) {
              safeSend({ type: 'REVIEW_CHUNK', text: delta })
            }
          } catch { /* skip malformed chunks */ }
        }
      }

      safeSend({ type: 'REVIEW_COMPLETE' })
    } catch (err: any) {
      console.warn('[OpenLeaf] Review failed:', err)
      safeSend({ type: 'REVIEW_ERROR', error: err.message })
    }

    stopKeepAlive()
  })
})

// Simple message handler for settings
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'GET_SETTINGS') {
    getSettings().then(settings =>
      sendResponse({ type: 'SETTINGS_RESPONSE', settings })
    )
    return true
  }
})

chrome.runtime.onInstalled.addListener(details => {
  if (details.reason === 'install') {
    chrome.runtime.openOptionsPage()
  }
})
