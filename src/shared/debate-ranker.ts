import type { Paper, RankedPaper, ExtensionSettings } from './types'
import { formatBibtex } from './bibtex-formatter'

const SYSTEM_PROMPT = `You are a research assistant evaluating academic papers as citation candidates for a paragraph in a research paper.

Score guide:
- 80-100: Paper directly introduces or presents the cited method, result, dataset, or concept
- 60-79: Paper is clearly relevant and expected in this context
- 40-59: Paper is related but not the most appropriate citation here
- 0-39: Paper is tangential or from a different domain

First, write one sentence identifying what specific claims or methods in the paragraph need citations (the NEEDS line). Then evaluate each paper using its actual number.

Output exactly this structure — no preamble, no extra text. Use the actual paper numbers (1, 2, 3, ...):

NEEDS: The paragraph introduces graph neural networks for molecule generation and needs citations for the GNN architecture and the generation task itself.

1.
FOR: Introduces the graph convolutional network used as the backbone in this work.
AGAINST: Focuses on node classification, not molecular generation specifically.
SCORE: 78

2.
FOR: Pioneering work on molecule generation that this paper directly builds upon.
AGAINST: Uses a VAE approach rather than the GNN method described here.
SCORE: 65

3.
FOR: ...
AGAINST: ...
SCORE: ...

Evaluate every paper in order using its number. Do not skip any paper.`

// Matches numbered entries (1., 2., …) with FOR/AGAINST on single lines and a bare SCORE
const SCORE_REGEX =
  /^(\d+)\.[^\n]*\nFOR:\s*([^\n]+)\nAGAINST:\s*([^\n]+)\nSCORE:\s*(\d+)/gm

function buildUserPrompt(paragraphText: string, papers: Paper[], fullDocText?: string): string {
  const candidates = papers
    .map((p, i) => {
      const authors = (p.authors || []).slice(0, 3).join(', ')
      const abstract = (p.abstract || '').slice(0, 300)
      return `${i + 1}. Title: ${p.title}\n   Authors: ${authors}\n   Abstract: ${abstract}`
    })
    .join('\n\n')

  let prompt = ''
  if (fullDocText) {
    prompt += `## Paper context:\n${fullDocText}\n\n`
  }
  prompt += `## Paragraph needing citations:\n${paragraphText}\n\n## Candidate papers:\n${candidates}`
  return prompt
}

function parseResponse(
  text: string
): Map<string, { score: number; forArg: string; againstArg: string }> {
  const results = new Map<string, { score: number; forArg: string; againstArg: string }>()
  const regex = new RegExp(SCORE_REGEX.source, SCORE_REGEX.flags)
  let match
  while ((match = regex.exec(text)) !== null) {
    const localIdx = parseInt(match[1], 10) - 1  // 1-based → 0-based
    const forArg = match[2].trim()
    const againstArg = match[3].trim()
    const score = parseInt(match[4], 10)
    if (!isNaN(score) && localIdx >= 0) {
      results.set(`paper_${localIdx}`, { score, forArg, againstArg })
    }
  }
  return results
}

function heuristicScore(paper: Paper, maxCitations: number): number {
  const posScore = (paper.relevanceScore || 0) * 100
  const citScore =
    maxCitations > 0
      ? (Math.log10((paper.citationCount || 0) + 1) /
        Math.log10(maxCitations + 1)) *
      100
      : 0
  return Math.round(0.7 * posScore + 0.3 * citScore)
}

// Max papers per LLM batch — keeps each request within timeout for local 8B models
const BATCH_SIZE = 10

async function rankBatch(
  paragraphText: string,
  batch: Paper[],
  batchOffset: number,
  settings: ExtensionSettings,
  fullDocText?: string
): Promise<Map<string, { score: number; forArg: string; againstArg: string }>> {
  const prompt = buildUserPrompt(paragraphText, batch, fullDocText)

  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (settings.llmApiKey) headers['Authorization'] = `Bearer ${settings.llmApiKey}`

  const resp = await fetch(`${settings.llmBaseUrl}/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: settings.llmModel,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: prompt },
      ],
      temperature: 0.2,
    }),
    signal: AbortSignal.timeout(60000),
  })

  if (!resp.ok) throw new Error(`LLM returned ${resp.status}`)

  const data = await resp.json()
  const content = data?.choices?.[0]?.message?.content || ''

  console.warn('[OpenLeaf] LLM raw response:', content)

  // Remap paper_0..N indices back to global indices
  const batchMap = parseResponse(content)
  console.warn('[OpenLeaf] Parsed entries:', batchMap.size)
  const globalMap = new Map<string, { score: number; forArg: string; againstArg: string }>()
  for (const [key, val] of batchMap) {
    const localIdx = parseInt(key.replace('paper_', ''), 10)
    globalMap.set(`paper_${batchOffset + localIdx}`, val)
  }
  return globalMap
}

export async function rankPapers(
  paragraphText: string,
  papers: Paper[],
  settings: ExtensionSettings,
  fullDocText?: string
): Promise<RankedPaper[]> {
  if (!papers.length) return []

  const existingKeys = new Set<string>()
  const maxCit = Math.max(...papers.map(p => p.citationCount || 0), 1)

  try {
    // Process all papers through the LLM in sequential batches
    const scoreMap = new Map<string, { score: number; forArg: string; againstArg: string }>()
    for (let i = 0; i < papers.length; i += BATCH_SIZE) {
      const batch = papers.slice(i, i + BATCH_SIZE)
      const batchMap = await rankBatch(paragraphText, batch, i, settings, fullDocText)
      for (const [k, v] of batchMap) scoreMap.set(k, v)
    }

    return papers.map((paper, i) => {
      const result = scoreMap.get(`paper_${i}`)
      const { bibtex, citeKey } = formatBibtex(paper, existingKeys)
      existingKeys.add(citeKey)

      if (result) {
        return {
          ...paper,
          score: result.score,
          reasoning: { for: result.forArg, against: result.againstArg },
          bibtex,
          citeKey,
        }
      }

      return { ...paper, score: heuristicScore(paper, maxCit), reasoning: null, bibtex, citeKey }
    })
  } catch (err) {
    console.warn('[OpenLeaf] LLM ranking failed, using heuristic fallback:', err)
    return papers.map(paper => {
      const { bibtex, citeKey } = formatBibtex(paper, existingKeys)
      existingKeys.add(citeKey)
      return { ...paper, score: heuristicScore(paper, maxCit), reasoning: null, bibtex, citeKey }
    })
  }
}
