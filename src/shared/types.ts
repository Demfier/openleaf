export interface Paper {
  title: string
  authors: string[]
  year: number | null
  abstract: string
  citationCount: number
  doi: string | null
  arxivId: string | null
  openAlexId: string | null
  url: string | null
  source: 'semantic_scholar' | 'openalex' | 'serper'
  relevanceScore: number
}

export interface RankedPaper extends Paper {
  score: number
  reasoning: { for: string; against: string } | null
  bibtex: string
  citeKey: string
}

export interface ParagraphResult {
  paragraphIndex: number
  paragraphPreview: string
  suggestions: RankedPaper[]
}

export type SearchStatus = 'idle' | 'loading' | 'success' | 'error'

export interface SearchResponse {
  results: ParagraphResult[]
}

export interface ExtensionSettings {
  llmBaseUrl: string
  llmApiKey: string
  llmModel: string
  semanticScholarApiKey: string
  serperApiKey: string
  openAlexEmail: string
  scoreThreshold: number
  maxResultsPerSource: number
  maxResultsPerParagraph: number
}

export const DEFAULT_SETTINGS: ExtensionSettings = {
  llmBaseUrl: 'http://localhost:11434/v1',
  llmApiKey: '',
  llmModel: 'llama3.1:8b',
  semanticScholarApiKey: '',
  serperApiKey: '',
  openAlexEmail: '',
  scoreThreshold: 60,
  maxResultsPerSource: 10,
  maxResultsPerParagraph: 5,
}

// Messages between content script and background worker
export type MessageType =
  | { type: 'SEARCH_CITATIONS'; paragraphs: { index: number; text: string }[] }
  | { type: 'SEARCH_RESULT'; results: ParagraphResult[] }
  | { type: 'SEARCH_ERROR'; error: string }
  | { type: 'GET_SETTINGS' }
  | { type: 'SETTINGS_RESPONSE'; settings: ExtensionSettings }
