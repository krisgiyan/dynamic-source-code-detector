# dynamic-source-code-detector

Detects whether a webpage requires JavaScript rendering or can be scraped with a plain HTTP request. Useful tool for scraping when you want to escalate to headless browser only when necessary.

## How it works

1. **Fetches the page** with a plain HTTP request.
2. **Analyzes the raw HTML** for signals: empty SPA root containers, bundled JS patterns, SSR data blobs, static generators, CMS fingerprints, and word-count heuristics.
3. **Escalates to Playwright** only when static analysis confidence falls below the threshold (default 70%). The rendered DOM is compared against raw HTML — significant expansion means content is dynamically generated.

Returns a result with `isDynamic`, `renderingType` (`csr` | `ssr` | `ssg` | `static` | `hybrid`), `framework`, `confidence`, and the `recommendation` (`fetch` or `headless`).

## Installation

```bash
//NOT YET!
npm install dynamic-source-code-detector
```

Playwright is an optional peer dependency. It's only needed if you want headless escalation:

```bash
npm install playwright
npx playwright install chromium
```

## CLI

```bash
node dist/cli.js <url> [options]
```

**Options**

| Flag | Description | Default |
|---|---|---|
| `--no-headless` | Disable Playwright escalation | — |
| `-t, --threshold <0-1>` | Confidence threshold for escalation | `0.7` |
| `-b, --browser <name>` | `chromium`, `firefox`, or `webkit` | `chromium` |
| `--timeout <ms>` | HTTP request timeout | `10000` |
| `--headless-timeout <ms>` | Playwright navigation timeout | `30000` |
| `--json` | Output raw JSON | — |

**Exit codes:** `0` = static (plain fetch is fine), `1` = dynamic (headless recommended), `2` = error.

**Examples**

```bash
node dist/cli.js https://example.com
node dist/cli.js https://react-app.com --no-headless --json
node dist/cli.js https://ambiguous-site.com --browser firefox --threshold 0.8
```

## Programmatic API

### `detect(url, options?)`

Fetches the URL and runs full detection (static analysis + optional headless escalation).

```ts
import { detect } from 'dynamic-source-code-detector';

const result = await detect('https://example.com');

console.log(result.isDynamic);       // boolean
console.log(result.renderingType);   // 'csr' | 'ssr' | 'ssg' | 'static' | 'hybrid' | 'unknown'
console.log(result.framework);       // 'Next.js' | 'React' | 'Vue' | ... | undefined
console.log(result.confidence);      // 0–1
console.log(result.recommendation);  // 'fetch' | 'headless'
console.log(result.signals);         // evidence collected during analysis
```

**Options**

```ts
interface DetectOptions {
  confidenceThreshold?: number;   // default: 0.7
  useHeadless?: boolean;          // default: true
  browser?: 'chromium' | 'firefox' | 'webkit'; // default: 'chromium'
  fetchTimeout?: number;          // ms, default: 10000
  headlessTimeout?: number;       // ms, default: 30000
  headers?: Record<string, string>;
}
```

### `analyzeHtml(html)`

Analyzes raw HTML without making any network requests. Headless escalation is not available.

```ts
import { analyzeHtml } from 'dynamic-source-code-detector';

const result = analyzeHtml('<html>...</html>');
```

## Running locally

### Dev Container (recommended)

Requires [VS Code](https://code.visualstudio.com/) and the [Dev Containers extension](https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.remote-containers).

The container is based on the official Playwright image so Chromium, Firefox, and WebKit are pre-installed — no extra browser setup needed.

1. Open the repo in VS Code.
2. When prompted, click **Reopen in Container** (or run `Dev Containers: Reopen in Container` from the command palette).
3. `npm install` runs automatically on container creation.
4. Build and run:

```bash
npm run build
node dist/cli.js https://example.com
```

### Manual

```bash
git clone https://github.com/ikristiyan/dynamic-source-code-detector
cd dynamic-source-code-detector
npm install
npm run build
node dist/cli.js https://example.com
```

> If you want headless escalation outside the Dev Container, install Playwright browsers manually: `npx playwright install chromium`

Use `npm run dev` to rebuild automatically on file changes during development.

## License

MIT
