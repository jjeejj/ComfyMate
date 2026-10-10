/**
 * Template Loader for ComfyMate
 * Loads standalone HTML template files and renders them with i18n placeholders.
 */

const templateCache = new Map();

/**
 * Fetch and cache raw HTML template from a relative file path.
 * Supports fallback HTML string in case fetch is unavailable.
 *
 * @param {string} relativePath - Relative path to the .html file
 * @param {string} importMetaUrl - import.meta.url of the caller module
 * @param {string} fallbackHtml - Fallback HTML template string
 * @returns {Promise<string>}
 */
export async function loadTemplate(relativePath, importMetaUrl, fallbackHtml = "") {
  const url = new URL(relativePath, importMetaUrl).href;
  if (templateCache.has(url)) {
    return templateCache.get(url);
  }

  try {
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    }
    const html = await res.text();
    templateCache.set(url, html);
    return html;
  } catch (err) {
    console.warn(`[ComfyMate] Could not load template from ${url}, using fallback:`, err);
    if (fallbackHtml) {
      templateCache.set(url, fallbackHtml);
      return fallbackHtml;
    }
    throw err;
  }
}

/**
 * Replace {{key}} placeholders in raw HTML with translated strings.
 *
 * @param {string} template - Raw HTML string containing {{key}} placeholders
 * @param {Function} t - Translation function (key, params) => string
 * @returns {string} Interpolated HTML string
 */
export function renderTemplate(template, t) {
  if (!template || typeof template !== "string") return "";
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (match, key) => {
    const val = t(key);
    return val !== undefined && val !== null ? val : match;
  });
}
