import * as cheerio from 'cheerio';
import type { Signal } from '../types.js';

export interface StaticAnalysisResult {
  signals: Signal[];
  framework: string | undefined;
  /** 0 = fully static, 1 = fully dynamic */
  dynamicScore: number;
}

function countWords(text: string): number {
  return text.split(/\s+/).filter((w) => w.length > 2).length;
}

function getBodyText($: cheerio.CheerioAPI): string {
  const $body = $('body').clone();
  $body.find('script, style, noscript').remove();
  return $body.text().replace(/\s+/g, ' ').trim();
}

function hasEmptyElement($: cheerio.CheerioAPI, selector: string): boolean {
  const el = $(selector).first();
  if (!el.length) return false;
  const text = el.clone().find('script, style').remove().end().text().trim();
  const childCount = el.children().length;
  return text.length < 30 && childCount === 0;
}

// Framework detection (returns the first match)

function detectFramework($: cheerio.CheerioAPI, html: string): string | undefined {
  // Next.js — presence of __NEXT_DATA__ or /_next/ assets
  if ($('script#__NEXT_DATA__').length || html.includes('/_next/static/')) {
    // App Router uses __NEXT_F chunks instead
    if (html.includes('__NEXT_F') && !$('script#__NEXT_DATA__').length) {
      return 'Next.js (App Router)';
    }
    return 'Next.js';
  }

  // Nuxt
  if (html.includes('window.__NUXT__') || html.includes('/_nuxt/')) return 'Nuxt';

  // Remix
  if (html.includes('window.__remixContext') || html.includes('__remixManifest')) return 'Remix';

  // SvelteKit
  if (html.includes('__sveltekit_') || html.includes('/_app/immutable/')) return 'SvelteKit';

  // Gatsby
  if ($('#gatsby-focus-wrapper').length || html.includes('window.___gatsby')) return 'Gatsby';

  // Astro
  if ($('astro-island').length || html.includes('@astro/') || html.includes('astro:')) return 'Astro';

  // Create React App
  if (
    html.includes('You need to enable JavaScript to run this app') ||
    (hasEmptyElement($, '#root') && html.includes('/static/js/'))
  )
    return 'Create React App';

  // Angular — ng-version attribute on app root or angular-specific scripts
  if ($('[ng-version]').length || $('app-root').length) return 'Angular';

  // Vue (generic Vite or Vue CLI)
  if (hasEmptyElement($, '#app') && (html.includes('chunk-vendors') || html.includes('vue'))) return 'Vue';

  // React (generic — Vite + React, custom setup)
  if (hasEmptyElement($, '#root') && html.includes('react')) return 'React';

  return undefined;
}

// Signal detection

export function analyzeHtml(html: string): StaticAnalysisResult {
  const $ = cheerio.load(html);
  const signals: Signal[] = [];

  const framework = detectFramework($, html);
  const bodyText = getBodyText($);
  const wordCount = countWords(bodyText);
  const htmlSize = html.length;
  const textRatio = htmlSize > 0 ? bodyText.length / htmlSize : 0;

  // Dynamic signals

  // CRA noscript message — definitive CSR indicator
  if (html.includes('You need to enable JavaScript to run this app')) {
    signals.push({
      name: 'cra-noscript',
      description: 'Create React App noscript message found — page requires JavaScript',
      type: 'dynamic',
      weight: 1.0,
    });
  }

  // Empty SPA root elements
  if (hasEmptyElement($, '#root')) {
    signals.push({
      name: 'empty-root',
      description: '<div id="root"> exists but is empty — typical CSR container',
      type: 'dynamic',
      weight: 0.85,
    });
  }

  if (hasEmptyElement($, '#app')) {
    signals.push({
      name: 'empty-app',
      description: '<div id="app"> exists but is empty — typical Vue CSR container',
      type: 'dynamic',
      weight: 0.8,
    });
  }

  if (hasEmptyElement($, '#__next')) {
    signals.push({
      name: 'empty-next-container',
      description: '<div id="__next"> is empty — Next.js CSR mode',
      type: 'dynamic',
      weight: 0.85,
    });
  }

  // Angular empty app-root
  if ($('app-root').length && $('app-root').children().length === 0 && $('app-root').text().trim().length < 10) {
    signals.push({
      name: 'empty-angular-root',
      description: '<app-root> is empty — Angular CSR',
      type: 'dynamic',
      weight: 0.9,
    });
  }

  // Bundle/chunk script patterns (strong CSR indicator when combined with empty containers)
  const scriptSrcs = $('script[src]')
    .map((_, el) => $(el).attr('src') ?? '')
    .get();

  const bundlePatterns = [
    /\/static\/js\/main\./,
    /\.bundle\.js/,
    /chunk-vendors/,
    /vendors~main/,
    /[a-f0-9]{8,}\.js$/, // content-hashed bundles
    /\/dist\/(runtime|polyfills|main|vendor)\.js/,
  ];

  const bundleScriptCount = scriptSrcs.filter((src) => bundlePatterns.some((p) => p.test(src))).length;
  if (bundleScriptCount > 0) {
    signals.push({
      name: 'bundle-scripts',
      description: `${bundleScriptCount} bundled JS file(s) detected (webpack/vite output)`,
      type: 'dynamic',
      weight: Math.min(0.5 + bundleScriptCount * 0.05, 0.65),
    });
  }

  // Very low text-to-HTML ratio with scripts present
  const hasScripts = $('script').length > 0;
  if (hasScripts && textRatio < 0.05 && wordCount < 50) {
    signals.push({
      name: 'low-text-ratio',
      description: `Body has fewer than 50 readable words (${wordCount}) relative to HTML size — likely CSR`,
      type: 'dynamic',
      weight: 0.6,
    });
  }

  // Type="module" scripts (common in Vite-based SPA setups)
  const moduleScripts = $('script[type="module"]').length;
  if (moduleScripts > 0 && wordCount < 100) {
    signals.push({
      name: 'module-scripts-sparse-content',
      description: `${moduleScripts} ES module script(s) with little body text — possible Vite SPA`,
      type: 'dynamic',
      weight: 0.45,
    });
  }

  // Static signals

  // SSR data blobs — server rendered the page but JS hydrates it
  if ($('script#__NEXT_DATA__').length) {
    const data = $('script#__NEXT_DATA__').text();
    const hasProps = data.includes('"props"') || data.includes('"pageProps"');
    signals.push({
      name: 'nextjs-ssr-data',
      description: '__NEXT_DATA__ script found — Next.js SSR/SSG pre-rendered content',
      type: 'static',
      weight: hasProps ? 0.75 : 0.5,
    });
  }

  if (html.includes('window.__NUXT__')) {
    signals.push({
      name: 'nuxt-ssr-data',
      description: 'window.__NUXT__ found — Nuxt SSR pre-rendered content',
      type: 'static',
      weight: 0.7,
    });
  }

  if (html.includes('window.__remixContext')) {
    signals.push({
      name: 'remix-ssr-data',
      description: 'window.__remixContext found — Remix SSR content',
      type: 'static',
      weight: 0.7,
    });
  }

  if (html.includes('__sveltekit_data') || html.includes('__sveltekit_')) {
    // SvelteKit can be SSR or CSR — presence alone is neutral, but check for content
    if (wordCount > 100) {
      signals.push({
        name: 'sveltekit-ssr',
        description: 'SvelteKit SSR with substantial pre-rendered content',
        type: 'static',
        weight: 0.6,
      });
    }
  }

  // Static generator meta tags
  const generatorMeta = $('meta[name="generator"]').attr('content') ?? '';

  const staticGenerators = ['Hugo', 'Jekyll', 'Eleventy', 'Pelican', 'Hexo', 'Ghost', 'Zola', 'MkDocs'];
  for (const gen of staticGenerators) {
    if (generatorMeta.toLowerCase().includes(gen.toLowerCase())) {
      signals.push({
        name: 'static-generator',
        description: `Static site generator detected: ${gen}`,
        type: 'static',
        weight: 0.95,
      });
      break;
    }
  }

  // WordPress / Drupal / Joomla (server-rendered CMS)
  if (
    generatorMeta.toLowerCase().includes('wordpress') ||
    html.includes('/wp-content/') ||
    html.includes('/wp-includes/')
  ) {
    signals.push({
      name: 'wordpress',
      description: 'WordPress detected — server-rendered CMS',
      type: 'static',
      weight: 0.85,
    });
  }

  if (html.includes('Drupal.settings') || html.includes('/sites/default/files/')) {
    signals.push({
      name: 'drupal',
      description: 'Drupal detected — server-rendered CMS',
      type: 'static',
      weight: 0.85,
    });
  }

  // Substantial pre-rendered body text
  if (wordCount > 300) {
    signals.push({
      name: 'rich-content',
      description: `${wordCount} readable words found in raw HTML — content is pre-rendered`,
      type: 'static',
      weight: 0.75,
    });
  } else if (wordCount > 100) {
    signals.push({
      name: 'moderate-content',
      description: `${wordCount} readable words in raw HTML — likely at least partially pre-rendered`,
      type: 'static',
      weight: 0.5,
    });
  }

  // Semantic HTML with actual content (article, main, section with non-trivial text)
  const semanticText = $('main, article, [role="main"]')
    .clone()
    .find('script, style')
    .remove()
    .end()
    .text()
    .trim();

  if (semanticText.length > 200) {
    signals.push({
      name: 'semantic-content',
      description: 'Substantial content inside <main> or <article> — server-rendered',
      type: 'static',
      weight: 0.65,
    });
  }

  // Gatsby SSG — focus wrapper with actual children
  if ($('#gatsby-focus-wrapper').length && !hasEmptyElement($, '#gatsby-focus-wrapper')) {
    signals.push({
      name: 'gatsby-ssg',
      description: 'Gatsby with pre-rendered content detected',
      type: 'static',
      weight: 0.7,
    });
  }

  // Astro — typically fully or partially static
  if ($('astro-island').length || html.includes('@astro/')) {
    signals.push({
      name: 'astro-framework',
      description: 'Astro detected — mostly static with optional interactive islands',
      type: 'static',
      weight: 0.6,
    });
  }

  // No scripts at all — definitely static
  if ($('script').length === 0) {
    signals.push({
      name: 'no-scripts',
      description: 'No <script> tags found — fully static HTML',
      type: 'static',
      weight: 0.9,
    });
  }

  // Score calculation

  const dynamicWeight = signals.filter((s) => s.type === 'dynamic').reduce((sum, s) => sum + s.weight, 0);
  const staticWeight = signals.filter((s) => s.type === 'static').reduce((sum, s) => sum + s.weight, 0);
  const totalWeight = dynamicWeight + staticWeight;

  const dynamicScore = totalWeight > 0 ? dynamicWeight / totalWeight : 0.5;

  return { signals, framework, dynamicScore };
}
