import type { DetectOptions } from './types.js';

export interface FetchResult {
  html: string;
  finalUrl: string;
  statusCode: number;
  contentType: string;
}

const DEFAULT_HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.5',
  'Accept-Encoding': 'gzip, deflate, br',
  Connection: 'keep-alive',
  'Upgrade-Insecure-Requests': '1',
};

export async function fetchPage(url: string, options: DetectOptions = {}): Promise<FetchResult> {
  const controller = new AbortController();
  const timeoutMs = options.fetchTimeout ?? 10_000;
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      headers: { ...DEFAULT_HEADERS, ...options.headers },
      redirect: 'follow',
      signal: controller.signal,
    });

    if (!response.ok && response.status !== 304) {
      throw new Error(`HTTP ${response.status} ${response.statusText} for ${url}`);
    }

    const html = await response.text();

    return {
      html,
      finalUrl: response.url,
      statusCode: response.status,
      contentType: response.headers.get('content-type') ?? '',
    };
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      throw new Error(`Request timed out after ${timeoutMs}ms for ${url}`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
