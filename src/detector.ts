import { analyzeHtml as runSignalAnalysis } from './analyzers/signals.js';
import { compareWithHeadless } from './analyzers/headless.js';
import { fetchPage } from './fetcher.js';
import type {
  DetectionResult,
  DetectOptions,
  RenderingType,
  Signal,
} from './types.js';

const DEFAULT_CONFIDENCE_THRESHOLD = 0.7;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function scoreToConfidence(dynamicScore: number): number {
  // Distance from 0.5 (total uncertainty), scaled to 0–1
  return Math.abs(dynamicScore - 0.5) * 2;
}

function scoreToRenderingType(
  dynamicScore: number,
  framework: string | undefined,
  signals: Signal[],
): RenderingType {
  const hasSSRBlob = signals.some((s) =>
    ['nextjs-ssr-data', 'nuxt-ssr-data', 'remix-ssr-data', 'sveltekit-ssr'].includes(s.name),
  );
  const hasStaticGenerator = signals.some((s) =>
    ['static-generator', 'wordpress', 'drupal', 'gatsby-ssg'].includes(s.name),
  );

  if (hasStaticGenerator) return 'ssg';
  if (hasSSRBlob && dynamicScore < 0.5) return 'ssr';
  if (hasSSRBlob && dynamicScore >= 0.5) return 'hybrid';
  if (dynamicScore >= 0.7) return 'csr';
  if (dynamicScore <= 0.3) return 'static';

  // Ambiguous zone
  if (framework?.startsWith('Next.js')) return 'ssr';
  if (framework === 'Nuxt') return 'ssr';
  if (framework === 'Remix') return 'ssr';

  return 'unknown';
}

function buildResult(
  dynamicScore: number,
  confidence: number,
  signals: Signal[],
  framework: string | undefined,
  method: DetectionResult['method'],
  url?: string,
): DetectionResult {
  const isDynamic = dynamicScore >= 0.5;
  const renderingType = scoreToRenderingType(dynamicScore, framework, signals);

  return {
    isDynamic,
    isFullyStatic: !isDynamic,
    renderingType,
    framework,
    confidence,
    recommendation: isDynamic ? 'headless' : 'fetch',
    method,
    signals,
    url,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Analyzes a URL to determine if it requires JavaScript rendering.
 *
 * 1. Fetches the page with a plain HTTP request.
 * 2. Runs heuristic signal analysis on the raw HTML.
 * 3. If confidence is below the threshold, escalates to Playwright.
 */
export async function detect(url: string, options: DetectOptions = {}): Promise<DetectionResult> {
  const confidenceThreshold = options.confidenceThreshold ?? DEFAULT_CONFIDENCE_THRESHOLD;
  const useHeadless = options.useHeadless !== false;

  // Step 1: Fetch
  const { html, finalUrl } = await fetchPage(url, options);

  // Step 2: Static analysis
  const { signals, framework, dynamicScore } = runSignalAnalysis(html);
  const staticConfidence = scoreToConfidence(dynamicScore);

  // Step 3: If confidence is high enough, return without headless
  if (staticConfidence >= confidenceThreshold || !useHeadless) {
    return buildResult(dynamicScore, staticConfidence, signals, framework, 'static-analysis', finalUrl);
  }

  // Step 4: Escalate to Playwright
  const headless = await compareWithHeadless(finalUrl, html, options);

  if (!headless) {
    // Playwright not available or failed — return static analysis result with lower confidence
    return buildResult(dynamicScore, staticConfidence, signals, framework, 'static-analysis', finalUrl);
  }

  // Combine static signals with headless result
  const headlessSignal: Signal = {
    name: 'headless-comparison',
    description: `Playwright rendered ${headless.renderedWordCount} words vs ${headless.rawWordCount} in raw HTML (${headless.expansionRatio.toFixed(2)}x expansion)`,
    type: headless.hasDynamicContent ? 'dynamic' : 'static',
    weight: headless.confidence,
  };

  const allSignals = [...signals, headlessSignal];

  const dynamicWeight = allSignals.filter((s) => s.type === 'dynamic').reduce((sum, s) => sum + s.weight, 0);
  const staticWeight = allSignals.filter((s) => s.type === 'static').reduce((sum, s) => sum + s.weight, 0);
  const totalWeight = dynamicWeight + staticWeight;
  const combinedDynamicScore = totalWeight > 0 ? dynamicWeight / totalWeight : 0.5;
  const combinedConfidence = scoreToConfidence(combinedDynamicScore);

  return buildResult(combinedDynamicScore, combinedConfidence, allSignals, framework, 'headless-comparison', finalUrl);
}

/**
 * Analyzes raw HTML without making any network requests.
 * This only runs static signal analysis — headless comparison is not possible.
 */
export function analyzeHtml(html: string): DetectionResult {
  const { signals, framework, dynamicScore } = runSignalAnalysis(html);
  const confidence = scoreToConfidence(dynamicScore);
  return buildResult(dynamicScore, confidence, signals, framework, 'static-analysis');
}
