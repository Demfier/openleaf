import type { Paper } from './types'

function escapeTeX(str: string): string {
  if (!str) return ''
  return str
    .replace(/\\/g, '\\textbackslash ')
    .replace(/[{}&%$#_^~]/g, char => `\\${char}`)
}

export function formatBibtex(
  paper: Paper,
  existingKeys?: Set<string>
): { bibtex: string; citeKey: string } {
  const authorPart =
    paper.authors && paper.authors.length > 0
      ? paper.authors[0]
          .split(/\s+/)
          .pop()!
          .toLowerCase()
          .replace(/[^a-z]/g, '')
      : 'unknown'
  const yearPart = paper.year || 'nd'
  let citeKey = `${authorPart}${yearPart}`

  if (existingKeys) {
    let suffix = 2
    const base = citeKey
    while (existingKeys.has(citeKey)) {
      citeKey = `${base}_${suffix}`
      suffix++
    }
  }

  const authors = (paper.authors || []).map(escapeTeX).join(' and ')
  const fields: string[] = []
  fields.push(`  title = {${escapeTeX(paper.title)}}`)
  if (authors) fields.push(`  author = {${authors}}`)
  if (paper.year) fields.push(`  year = {${paper.year}}`)
  if (paper.doi) fields.push(`  doi = {${paper.doi}}`)
  if (paper.arxivId) {
    fields.push(`  eprint = {${paper.arxivId}}`)
    fields.push(`  archivePrefix = {arXiv}`)
  }
  if (paper.url) fields.push(`  url = {${paper.url}}`)

  const bibtex = `@article{${citeKey},\n${fields.join(',\n')}\n}`
  return { bibtex, citeKey }
}
