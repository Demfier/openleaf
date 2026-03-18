import type { Paper, ExtensionSettings } from './types'

// --- Semantic Scholar ---

export async function searchSemanticScholar(
  query: string,
  settings: ExtensionSettings
): Promise<Paper[]> {
  const fields = 'title,authors,year,abstract,citationCount,externalIds,url,venue,publicationVenue'
  const url = `https://api.semanticscholar.org/graph/v1/paper/search?query=${encodeURIComponent(query)}&fields=${fields}&limit=${settings.maxResultsPerSource}`

  const headers: Record<string, string> = {}
  if (settings.semanticScholarApiKey) {
    headers['x-api-key'] = settings.semanticScholarApiKey
  }

  try {
    const resp = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(10000),
    })
    if (!resp.ok) return []
    const data = await resp.json()
    if (!data?.data) return []

    return data.data.map((p: any, i: number) => ({
      title: p.title || '',
      authors: (p.authors || []).map((a: any) => a.name),
      year: p.year || null,
      abstract: p.abstract || '',
      citationCount: p.citationCount || 0,
      doi: p.externalIds?.DOI || null,
      arxivId: p.externalIds?.ArXiv || null,
      openAlexId: null,
      url: p.url || null,
      venue: p.publicationVenue?.name || p.venue || null,
      source: 'semantic_scholar' as const,
      relevanceScore: 1 - i / Math.max(data.data.length, 1),
    }))
  } catch {
    return []
  }
}

// --- OpenAlex ---

function reconstructAbstract(
  invertedIndex: Record<string, number[]> | null
): string {
  if (!invertedIndex) return ''
  const words: string[] = []
  for (const [word, positions] of Object.entries(invertedIndex)) {
    for (const pos of positions) {
      words[pos] = word
    }
  }
  return words.filter(Boolean).join(' ')
}

export async function searchOpenAlex(
  query: string,
  settings: ExtensionSettings
): Promise<Paper[]> {
  const url = `https://api.openalex.org/works?search=${encodeURIComponent(query)}&sort=relevance_score:desc&per_page=${settings.maxResultsPerSource}&select=id,doi,title,authorships,publication_year,cited_by_count,abstract_inverted_index,ids,primary_location,type`

  const headers: Record<string, string> = {}
  if (settings.openAlexEmail) {
    headers['User-Agent'] = `OpenLeafExtension/1.0 (mailto:${settings.openAlexEmail})`
  }

  try {
    const resp = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(10000),
    })
    if (!resp.ok) return []
    const data = await resp.json()
    if (!data?.results) return []

    return data.results.map((w: any, i: number) => ({
      title: w.title || '',
      authors: (w.authorships || []).map(
        (a: any) => a.author?.display_name || ''
      ),
      year: w.publication_year || null,
      abstract: reconstructAbstract(w.abstract_inverted_index),
      citationCount: w.cited_by_count || 0,
      doi: w.doi ? w.doi.replace('https://doi.org/', '') : null,
      arxivId: null,
      openAlexId: w.id || null,
      url: w.doi ? `https://doi.org/${w.doi.replace('https://doi.org/', '')}` : null,
      venue: w.primary_location?.source?.display_name || null,
      source: 'openalex' as const,
      relevanceScore: 1 - i / Math.max(data.results.length, 1),
    }))
  } catch {
    return []
  }
}

// --- arXiv enrichment ---
// For papers that have an arXiv ID but no author data (typically from Serper),
// fetch full metadata from Semantic Scholar's paper lookup endpoint.

export async function enrichArxivPapers(papers: Paper[], settings: ExtensionSettings): Promise<void> {
  const toEnrich = papers.filter(p => p.arxivId && (!p.authors || p.authors.length === 0))
  if (!toEnrich.length) return

  const headers: Record<string, string> = {}
  if (settings.semanticScholarApiKey) headers['x-api-key'] = settings.semanticScholarApiKey

  await Promise.allSettled(toEnrich.map(async paper => {
    try {
      const id = paper.arxivId!.replace(/v\d+$/, '')
      const resp = await fetch(
        `https://api.semanticscholar.org/graph/v1/paper/arXiv:${id}?fields=title,authors,year,venue,publicationVenue,externalIds`,
        { headers, signal: AbortSignal.timeout(5000) }
      )
      if (!resp.ok) return
      const data = await resp.json()

      if (data.authors?.length) paper.authors = data.authors.map((a: any) => a.name)
      if (!paper.year && data.year) paper.year = data.year
      if (!paper.venue) paper.venue = data.publicationVenue?.name || data.venue || null
      if (!paper.doi && data.externalIds?.DOI) paper.doi = data.externalIds.DOI
    } catch { /* ignore */ }
  }))
}

// --- Serper (Google Scholar) ---

export async function searchSerper(
  query: string,
  settings: ExtensionSettings
): Promise<Paper[]> {
  if (!settings.serperApiKey) return []

  try {
    const resp = await fetch('https://google.serper.dev/scholar', {
      method: 'POST',
      headers: {
        'X-API-KEY': settings.serperApiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ q: query, num: settings.maxResultsPerSource }),
      signal: AbortSignal.timeout(10000),
    })
    if (!resp.ok) return []
    const data = await resp.json()
    if (!data?.organic) return []

    return data.organic.map((r: any, i: number) => {
      let arxivId: string | null = null
      if (r.link) {
        const m = r.link.match(/arxiv\.org\/abs\/([\d.]+[v\d]*)/)
        if (m) arxivId = m[1]
      }
      return {
        title: r.title || '',
        authors: [],
        year: r.year || null,
        abstract: r.snippet || '',
        citationCount: r.citedBy || 0,
        doi: null,
        arxivId,
        openAlexId: null,
        url: r.link || null,
        venue: r.publication || null,
        source: 'serper' as const,
        relevanceScore: 1 - i / Math.max(data.organic.length, 1),
      }
    })
  } catch {
    return []
  }
}
