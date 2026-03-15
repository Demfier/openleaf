import type { Paper } from './types'

function normalizeTitle(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]/g, '')
}

function mergeInto(target: Paper, source: Paper): void {
  if (!target.abstract && source.abstract) target.abstract = source.abstract
  if (!target.doi && source.doi) target.doi = source.doi
  if (!target.arxivId && source.arxivId) target.arxivId = source.arxivId
  if (!target.openAlexId && source.openAlexId)
    target.openAlexId = source.openAlexId
  if (!target.url && source.url) target.url = source.url
  if ((!target.authors || target.authors.length === 0) && source.authors)
    target.authors = source.authors
  if (!target.year && source.year) target.year = source.year
  if (source.citationCount > target.citationCount)
    target.citationCount = source.citationCount
  if (source.relevanceScore > target.relevanceScore)
    target.relevanceScore = source.relevanceScore
}

export function deduplicate(papers: Paper[]): Paper[] {
  const seen = new Map<string, Paper>()
  const unique: Paper[] = []

  for (const paper of papers) {
    if (!paper.title) continue

    const keys: string[] = []
    if (paper.arxivId)
      keys.push(`arxiv:${paper.arxivId.replace(/v\d+$/, '').toLowerCase()}`)
    if (paper.doi) keys.push(`doi:${paper.doi.toLowerCase()}`)
    if (paper.openAlexId) keys.push(`oalex:${paper.openAlexId}`)
    keys.push(`title:${normalizeTitle(paper.title)}`)

    let isDuplicate = false
    for (const key of keys) {
      if (seen.has(key)) {
        mergeInto(seen.get(key)!, paper)
        isDuplicate = true
        break
      }
    }

    if (!isDuplicate) {
      for (const key of keys) seen.set(key, paper)
      unique.push(paper)
    }
  }

  return unique
}
