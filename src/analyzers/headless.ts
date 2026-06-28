import type { HeadlessComparison, DetectOptions } from '../types.js';

// Threshold: if rendered content has this much more text than raw HTML, it's dynamic
const DYNAMIC_EXPANSION_THRESHOLD = 1.25; // 25% more words after JS runs
const HIGH_CONFIDENCE_THRESHOLD = 1.6;    // 60% more → very confident it's dynamic

function countWords(text: string): number {
  return text.split(/\s+/).filter((w) => w.length > 2).length;
}

/**
 * Extracts visible word count from raw HTML using a regex-based approach
 * (avoids importing cheerio here since signals.ts already does that analysis).
 */
function countWordsInHtml(html: string): number {
  // Strip scripts, styles, and HTML tags
  const stripped = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return countWords(stripped);
}

/**
 * Uses Playwright to render the page and compares rendered DOM text content
 * against the raw HTML text content. A significant expansion ratio indicates
 * that JavaScript is generating meaningful content.
 *
 * Returns null if Playwright is not installed or the page fails to load.
 */
export async function compareWithHeadless(
  url: string,
  rawHtml: string,
  options: DetectOptions = {},
): Promise<HeadlessComparison | null> {
  let playwright: typeof import('playwright');

  try {
    playwright = await import('playwright');
  } catch {
    return null;
  }

  const browserType = options.browser ?? 'chromium';
  const timeout = options.headlessTimeout ?? 30_000;

  let browser;
  try {
    browser = await playwright[browserType].launch({ headless: true });
  } catch {
    return null;
  }

  try {
    const context = await browser.newContext({
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    });

    const page = await context.newPage();

    try {
      await page.goto(url, {
        waitUntil: 'networkidle',
        timeout,
      });
    } catch {
      // networkidle can time out on pages with long-polling; fall back to domcontentloaded
      await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout,
      });
      // Give scripts a moment to run after DOM is ready
      await page.waitForTimeout(2000);
    }

    const renderedText = await page.evaluate(() => {
      // Remove script and style nodes before measuring
      const clone = document.body.cloneNode(true) as HTMLElement;
      clone.querySelectorAll('script, style, noscript').forEach((el) => el.remove());
      return clone.innerText ?? clone.textContent ?? '';
    });

    const rawWordCount = countWordsInHtml(rawHtml);
    const renderedWordCount = countWords(renderedText);

    const expansionRatio = rawWordCount > 0 ? renderedWordCount / rawWordCount : renderedWordCount > 0 ? 999 : 1;

    const hasDynamicContent = expansionRatio >= DYNAMIC_EXPANSION_THRESHOLD;

    // Confidence scales with how far beyond the threshold the ratio is
    let confidence: number;
    if (!hasDynamicContent) {
      // Static: confidence based on how close to 1 the ratio is
      const distanceFromStatic = Math.abs(expansionRatio - 1);
      confidence = Math.max(0, 1 - distanceFromStatic / (DYNAMIC_EXPANSION_THRESHOLD - 1));
    } else if (expansionRatio >= HIGH_CONFIDENCE_THRESHOLD) {
      confidence = 0.95;
    } else {
      const range = HIGH_CONFIDENCE_THRESHOLD - DYNAMIC_EXPANSION_THRESHOLD;
      const position = expansionRatio - DYNAMIC_EXPANSION_THRESHOLD;
      confidence = 0.75 + (position / range) * 0.2;
    }

    return { rawWordCount, renderedWordCount, expansionRatio, hasDynamicContent, confidence };
  } finally {
    await browser.close();
  }
}
