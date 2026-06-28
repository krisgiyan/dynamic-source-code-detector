/** How the page renders its content */
export type RenderingType =
  | 'csr'     // Client-Side Rendering — JS builds the DOM in the browser
  | 'ssr'     // Server-Side Rendering — server sends full HTML, JS hydrates
  | 'ssg'     // Static Site Generation — pre-built HTML, no runtime server rendering
  | 'static'  // Plain static HTML — no framework or build tool detected
  | 'hybrid'  // Mix of SSR/SSG with some CSR islands
  | 'unknown';

/** How the detection result was determined */
export type DetectionMethod = 'static-analysis' | 'headless-comparison';

/** Recommended scraping approach */
export type Recommendation = 'fetch' | 'headless';

/** A single piece of evidence found during analysis */
export interface Signal {
  /** Short identifier for this signal */
  name: string;
  /** Human-readable explanation of what was found */
  description: string;
  /** Whether this signal suggests dynamic (CSR) or static content */
  type: 'dynamic' | 'static';
  /** How strongly this signal contributes to the final score (0–1) */
  weight: number;
}

/** Result returned by detect() and analyzeHtml() */
export interface DetectionResult {
  /** True if the page uses JavaScript to render meaningful content */
  isDynamic: boolean;
  /** True if a plain HTTP request returns all the page content */
  isFullyStatic: boolean;
  /** The detected rendering strategy */
  renderingType: RenderingType;
  /** JavaScript framework or SSG detected, if identifiable */
  framework?: string;
  /**
   * Confidence in the assessment (0–1).
   * Values closer to 1 mean high certainty; values near 0.5 mean ambiguous.
   */
  confidence: number;
  /** Recommended approach for scraping this page */
  recommendation: Recommendation;
  /** Which analysis method produced this result */
  method: DetectionMethod;
  /** All signals collected during analysis */
  signals: Signal[];
  /** The URL that was analyzed (only set when using detect()) */
  url?: string;
}

export interface DetectOptions {
  /**
   * Confidence threshold below which to escalate to headless browser.
   * If static analysis confidence is below this value, Playwright is used.
   * Range: 0–1, default: 0.7
   */
  confidenceThreshold?: number;
  /**
   * Whether to allow headless browser escalation.
   * When true, requires playwright to be installed.
   * Default: true
   */
  useHeadless?: boolean;
  /**
   * Which browser Playwright should use.
   * Default: 'chromium'
   */
  browser?: 'chromium' | 'firefox' | 'webkit';
  /**
   * HTTP request timeout in milliseconds.
   * Default: 10000
   */
  fetchTimeout?: number;
  /**
   * Headless browser navigation timeout in milliseconds.
   * Default: 30000
   */
  headlessTimeout?: number;
  /**
   * Custom HTTP headers to include with the fetch request.
   */
  headers?: Record<string, string>;
}

/** Result from headless browser comparison */
export interface HeadlessComparison {
  rawWordCount: number;
  renderedWordCount: number;
  /** Ratio of rendered/raw word counts. >1 means JS added content. */
  expansionRatio: number;
  /** True if the rendered DOM has significantly more content than the raw HTML */
  hasDynamicContent: boolean;
  confidence: number;
}
