/**
 * Named User-Agent strings for the UA preset picker.
 *
 * The `scrapeman` entry is intentionally left as a placeholder string here;
 * the executor substitutes the real version + platform at runtime via
 * buildAutoHeaders(). All other entries are static strings.
 *
 * Chrome/Firefox strings track the latest stable release at the time of
 * each Scrapeman release. They are intentionally NOT kept auto-updating —
 * stability over freshness for a scraping tool.
 */
export const UA_PRESETS = {
  scrapeman: 'Scrapeman', // replaced at runtime with version + platform
  'chrome-macos':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'chrome-windows':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'firefox-macos':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:125.0) Gecko/20100101 Firefox/125.0',
  'firefox-windows':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0',
  'safari-macos':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_3) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.3 Safari/605.1.15',
  'safari-ios':
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  googlebot:
    'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
  curl: 'curl/8.7.1',
} as const;

export type UaPresetKey = keyof typeof UA_PRESETS;
