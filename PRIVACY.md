# Privacy Policy — OpenLeaf

**Last updated:** March 14, 2026

## Summary

OpenLeaf does not collect, store, or transmit any personal data. Everything stays in your browser.

## What data does OpenLeaf access?

- **Document text** from your Overleaf editor — read locally in the browser to extract paragraphs for citation search and paper review. This text is never sent to any server controlled by the developer.

- **API keys** you configure in the extension options — stored locally in your browser via `chrome.storage.sync`. These are only used to authenticate requests to the services **you** choose to configure (e.g., Semantic Scholar, OpenRouter, Ollama).

## What data is sent to third parties?

When you click "Find Citations", **extracted keywords** (not your full document) are sent as search queries to:

- **Semantic Scholar** ([semanticscholar.org](https://www.semanticscholar.org/product/api)) — receives search query keywords. Subject to the [Semantic Scholar API Terms](https://allenai.org/privacy-policy/2025-02-19).
- **OpenAlex** ([openalex.org](https://openalex.org)) — receives search query keywords. Free, open academic data. Subject to [OpenAlex Terms](https://openalex.org/OpenAlex_termsofservice.pdf).
- **Serper** ([serper.dev](https://serper.dev)) — receives search query keywords (only if you provide a Serper API key). Subject to [Serper Terms](https://serper.dev/terms).

When you use "Review Paper" or citation ranking, **document text** is sent to:

- **Your configured LLM endpoint** (e.g., Ollama, OpenRouter, OpenAI) — receives paragraph text or full document content for ranking and review. This goes to whatever LLM service **you** choose and configure.

**Important details:**
- The extension strips LaTeX commands and extracts only key terms before sending search queries — your raw document is not sent to search APIs.
- All requests go directly from your browser to the respective APIs. The developer has no server and never sees any of this data.
- If you use **Ollama** (the default), the LLM calls stay entirely on your machine — no data leaves your device for ranking or review.
- Each third-party API is subject to its own privacy policy and terms of service.

## What data is stored?

- **Extension settings** (API keys, model name, base URL) — stored in `chrome.storage.sync` (encrypted, synced across your Chrome profile)
- **Cached results** (citation suggestions, reviews) — stored in `chrome.storage.local` per project, cleared when you click "Clear"

## What data is NOT collected?

- No analytics or telemetry
- No tracking pixels or cookies
- No user accounts or sign-ups
- No data is sent to the developer or any developer-controlled server

## Contact

For questions about this privacy policy, open an issue at [github.com/demfier/openleaf](https://github.com/demfier/openleaf/issues).
