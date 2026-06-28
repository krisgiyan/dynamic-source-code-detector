#!/usr/bin/env node
import { detect } from './detector.js';
import type { DetectOptions, DetectionResult } from './types.js';

// ---------------------------------------------------------------------------
// ANSI color helpers (no external deps)
// ---------------------------------------------------------------------------
const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
};

function colorize(text: string, ...codes: string[]): string {
  if (!process.stdout.isTTY) return text;
  return codes.join('') + text + c.reset;
}

// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

function parseArgs(argv: string[]): { url: string | null; options: DetectOptions; json: boolean; help: boolean } {
  const args = argv.slice(2);
  let url: string | null = null;
  let json = false;
  let help = false;
  const options: DetectOptions = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--help' || arg === '-h') {
      help = true;
    } else if (arg === '--json') {
      json = true;
    } else if (arg === '--no-headless') {
      options.useHeadless = false;
    } else if (arg === '--threshold' || arg === '-t') {
      const val = parseFloat(args[++i] ?? '');
      if (!isNaN(val) && val >= 0 && val <= 1) options.confidenceThreshold = val;
    } else if (arg === '--timeout') {
      const val = parseInt(args[++i] ?? '', 10);
      if (!isNaN(val)) options.fetchTimeout = val;
    } else if (arg === '--headless-timeout') {
      const val = parseInt(args[++i] ?? '', 10);
      if (!isNaN(val)) options.headlessTimeout = val;
    } else if (arg === '--browser' || arg === '-b') {
      const val = args[++i] as DetectOptions['browser'];
      if (val === 'chromium' || val === 'firefox' || val === 'webkit') {
        options.browser = val;
      }
    } else if (!arg.startsWith('-')) {
      url = arg;
    }
  }

  return { url, options, json, help };
}

// ---------------------------------------------------------------------------
// Output formatting
// ---------------------------------------------------------------------------

function renderResult(result: DetectionResult): void {
  const isDynamic = result.isDynamic;
  const pct = Math.round(result.confidence * 100);

  const statusIcon = isDynamic ? colorize('✗ DYNAMIC', c.bold, c.red) : colorize('✓ STATIC', c.bold, c.green);
  const recColor = isDynamic ? c.yellow : c.green;
  const rec = colorize(result.recommendation === 'headless' ? 'headless browser' : 'plain fetch', c.bold, recColor);

  console.log('');
  console.log(colorize('  dynamic-source-code-detector', c.bold, c.cyan));
  console.log(colorize('  ────────────────────────────────────', c.dim));

  if (result.url) {
    console.log(`  ${colorize('URL', c.dim)}          ${result.url}`);
  }
  console.log(`  ${colorize('Result', c.dim)}       ${statusIcon}`);
  console.log(`  ${colorize('Confidence', c.dim)}   ${pct}%`);
  console.log(`  ${colorize('Rendering', c.dim)}    ${result.renderingType}`);
  if (result.framework) {
    console.log(`  ${colorize('Framework', c.dim)}    ${result.framework}`);
  }
  console.log(`  ${colorize('Recommend', c.dim)}    use ${rec} to scrape`);
  console.log(`  ${colorize('Method', c.dim)}       ${result.method}`);

  if (result.signals.length > 0) {
    console.log('');
    console.log(colorize('  Signals detected:', c.dim));
    for (const signal of result.signals) {
      const icon = signal.type === 'dynamic' ? colorize('↑', c.red) : colorize('↓', c.green);
      const weight = colorize(`(${Math.round(signal.weight * 100)}%)`, c.gray);
      console.log(`    ${icon} ${signal.description} ${weight}`);
    }
  }

  console.log('');
}

// ---------------------------------------------------------------------------
// Help text
// ---------------------------------------------------------------------------

function printHelp(): void {
  console.log(`
${colorize('dynamic-source-code-detector', c.bold, c.cyan)} (dscd)

  Detect whether a URL requires JavaScript rendering or can be scraped statically.
  Falls back to Playwright headless browser only when static analysis is uncertain.

${colorize('Usage:', c.bold)}
  dscd <url> [options]

${colorize('Options:', c.bold)}
  --no-headless            Disable Playwright escalation (static analysis only)
  --threshold, -t <0-1>   Confidence threshold for headless escalation (default: 0.7)
  --browser, -b <name>    Playwright browser: chromium | firefox | webkit (default: chromium)
  --timeout <ms>          HTTP request timeout in ms (default: 10000)
  --headless-timeout <ms> Playwright timeout in ms (default: 30000)
  --json                  Output result as JSON
  --help, -h              Show this help

${colorize('Exit codes:', c.bold)}
  0  Static — plain HTTP fetch is sufficient
  1  Dynamic — headless browser recommended
  2  Error

${colorize('Examples:', c.bold)}
  dscd https://example.com
  dscd https://react-app.com --no-headless --json
  dscd https://ambiguous-site.com --browser firefox --threshold 0.8
`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const { url, options, json, help } = parseArgs(process.argv);

  if (help || !url) {
    printHelp();
    process.exit(0);
  }

  const normalizedUrl = /^https?:\/\//i.test(url) ? url : `https://${url}`;

  let result: DetectionResult;

  try {
    result = await detect(normalizedUrl, options);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (json) {
      console.error(JSON.stringify({ error: msg }));
    } else {
      console.error(colorize(`\n  Error: ${msg}`, c.red));
    }
    process.exit(2);
  }

  if (json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    renderResult(result);
  }

  // Exit code reflects scraping recommendation
  process.exit(result.isDynamic ? 1 : 0);
}

main();
