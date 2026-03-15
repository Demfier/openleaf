<p align="center">
  <img src="public/icons/icon.svg" alt="OpenLeaf" width="80">
</p>

<h1 align="center">OpenLeaf</h1>
<p align="center"><strong>AI-powered citation search & paper review for Overleaf</strong></p>
<p align="center">Find relevant papers to cite and get feedback on your writing, without leaving the editor.</p>

<p align="center">
  <img src="promo/demo.gif" alt="OpenLeaf Demo" width="100%">
</p>

## How it works

1. Open any project on overleaf.com
2. Click the green **OpenLeaf** button in the bottom-right corner
3. **Citations tab** — click "Find Citations" to discover papers paragraph by paragraph, scored 0-100 with LLM reasoning
4. **Review tab** — get AI feedback on your paper in Friendly (constructive) or Fire (Reviewer #2) mode
5. Click **+ Add** to append BibTeX entries to your `.bib` file automatically

### Click to open OpenLeaf
![Editor with OpenLeaf button](promo/slide-0.png)

### Citation search — find papers paragraph by paragraph
![Citation search panel](promo/slide-1.png)

### LLM-scored results with reasoning
![Search results with scores](promo/slide-2.png)

### Friendly review — constructive mentor
![Friendly review mode](promo/slide-3.png)

### Fire review — the Reviewer #2 experience
![Fire review mode](promo/slide-4.png)

### Configure your LLM and API keys
![Options page](promo/slide-5.png)

## Install

### Option 1: Chrome Web Store
[openleaf extension link](https://chromewebstore.google.com/detail/openleaf-citation-search/jjcmeicpmfcimamdmchabfpjcljieafk)

### Option 2: Download ZIP (no npm needed)
1. Download [`openleaf-extension-v0.1.0.zip`](https://github.com/demfier/openleaf/releases/download/v0.1.0/openleaf-extension-v0.1.0.zip) from [Releases](https://github.com/demfier/openleaf/releases)
2. Unzip it
3. Go to `chrome://extensions`
4. Enable **Developer mode** (top right)
5. Click **Load unpacked**
6. Select the unzipped folder

### Option 3: From source
```bash
git clone https://github.com/demfier/openleaf.git
cd openleaf
npm install
npm run build
```
Then load in Chrome:
1. Go to `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select the `openleaf` folder

## Configuration

Click the extension icon → **Options** (or right-click → Options) to configure:

### LLM Backend (for citation ranking & paper review)

Works with any OpenAI-compatible API:

| Backend | Base URL | API Key? |
|---------|----------|----------|
| Ollama (default) | `http://localhost:11434/v1` | No |
| vLLM | `http://your-server:8000/v1` | Optional |
| OpenAI | `https://api.openai.com/v1` | Yes |
| OpenRouter | `https://openrouter.ai/api/v1` | Yes |
| Together | `https://api.together.xyz/v1` | Yes |
| Groq | `https://api.groq.com/openai/v1` | Yes |

### Paper Search APIs

- **Semantic Scholar** — works without key (rate-limited)
- **Serper** (Google Scholar) — optional, skipped if no key
- **OpenAlex** — no key needed, email improves rate limits

## Development

```bash
npm run dev    # build with watch mode
```

After changing code, go to `chrome://extensions` and click the reload button on the extension.

## Privacy

See [PRIVACY.md](PRIVACY.md). TL;DR: No data collection, no analytics, no accounts. Everything stays in your browser.

## License

MIT
