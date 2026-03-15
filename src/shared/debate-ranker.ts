import type { Paper, RankedPaper, ExtensionSettings } from './types'
import { formatBibtex } from './bibtex-formatter'

const SYSTEM_PROMPT = `You are a research assistant evaluating whether academic papers are relevant citations for a research paper. You will be given the full paper context and a specific paragraph that needs citations.

Evaluate each candidate paper based on:
- Relevance to the specific paragraph's claims and topic
- Relevance to the overall paper's research area and contribution
- Whether it provides supporting evidence, methodology, or important context

For each candidate paper, you must:
1. Give 1-2 concise arguments FOR why this paper should be cited.
2. Give 1-2 concise arguments AGAINST citing it.
3. Score its relevance from 0 to 100, where 100 means it is a perfect citation.

Respond in this exact format for each paper (no other text):

[paper_id]
FOR: Your arguments for citing this paper
AGAINST: Your arguments against citing this paper
SCORE: XX/100`

const SCORE_REGEX =
  /\[([^\]]+)\][\s\S]*?FOR:\s*([\s\S]*?)AGAINST:\s*([\s\S]*?)SCORE:\s*(\d+)\s*\/\s*100/g

function buildUserPrompt(paragraphText: string, papers: Paper[], fullDocText?: string): string {
  const candidates = papers
    .map((p, i) => {
      const authors = (p.authors || []).slice(0, 3).join(', ')
      const abstract = (p.abstract || '').slice(0, 300)
      return `[paper_${i}] Title: ${p.title}\nAuthors: ${authors}\nAbstract: ${abstract}`
    })
    .join('\n\n')

  let prompt = ''
  if (fullDocText) {
    prompt += `## Full paper context (summary):\n${fullDocText}\n\n`
  }
  prompt += `## Specific paragraph needing citations:\n${paragraphText}\n\n## Candidate papers:\n${candidates}`
  return prompt
}

function parseResponse(
  text: string
): Map<string, { score: number; forArg: string; againstArg: string }> {
  const results = new Map<
    string,
    { score: number; forArg: string; againstArg: string }
  >()
  const regex = new RegExp(SCORE_REGEX.source, SCORE_REGEX.flags)
  let match
  while ((match = regex.exec(text)) !== null) {
    const id = match[1].trim()
    const forArg = match[2].trim()
    const againstArg = match[3].trim()
    const score = parseInt(match[4], 10)
    if (!isNaN(score)) {
      results.set(id, { score, forArg, againstArg })
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

export async function rankPapers(
  paragraphText: string,
  papers: Paper[],
  settings: ExtensionSettings,
  fullDocText?: string
): Promise<RankedPaper[]> {
  if (!papers.length) return []

  const existingKeys = new Set<string>()

  // Try LLM ranking
  try {
    const prompt = buildUserPrompt(paragraphText, papers, fullDocText)

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
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: prompt },
        ],
        temperature: 0.3,
      }),
      signal: AbortSignal.timeout(60000),
    })

    if (!resp.ok) throw new Error(`LLM returned ${resp.status}`)

    const data = await resp.json()
    const content = data?.choices?.[0]?.message?.content || ''
    const scoreMap = parseResponse(content)

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

      const maxCit = Math.max(...papers.map(p => p.citationCount || 0))
      return {
        ...paper,
        score: heuristicScore(paper, maxCit),
        reasoning: null,
        bibtex,
        citeKey,
      }
    })
  } catch (err) {
    console.warn('[OpenLeaf] LLM ranking failed, using heuristic fallback:', err)
    const maxCit = Math.max(...papers.map(p => p.citationCount || 0), 1)
    return papers.map(paper => {
      const { bibtex, citeKey } = formatBibtex(paper, existingKeys)
      existingKeys.add(citeKey)
      return {
        ...paper,
        score: heuristicScore(paper, maxCit),
        reasoning: null,
        bibtex,
        citeKey,
      }
    })
  }
}
