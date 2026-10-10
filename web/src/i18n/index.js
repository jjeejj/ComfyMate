import { zh } from "./zh.js";
import { en } from "./en.js";

const DICTIONARIES = { zh, en };

export const FORMAT_PRESETS = [
  {
    id: "openai",
    api_type: "openai",
    name_zh: "OpenAI",
    name_en: "OpenAI",
    base_url: "https://api.openai.com/v1",
    models: ["gpt-4o", "gpt-4o-mini", "o3-mini"],
    key_placeholder_zh: "输入 OpenAI API 密钥 (sk-...)",
    key_placeholder_en: "Enter OpenAI API Key (sk-...)",
  },
  {
    id: "anthropic",
    api_type: "anthropic",
    name_zh: "Anthropic (Claude)",
    name_en: "Anthropic (Claude)",
    base_url: "https://api.anthropic.com/v1",
    models: [
      "claude-3-7-sonnet-20250219",
      "claude-3-5-sonnet-20241022",
      "claude-3-5-haiku-20241022",
    ],
    key_placeholder_zh: "输入 Anthropic API 密钥 (sk-ant-...)",
    key_placeholder_en: "Enter Anthropic API Key (sk-ant-...)",
  },
];

export function findPreset(nameOrId) {
  if (!nameOrId) return null;
  return FORMAT_PRESETS.find(
    (p) =>
      p.id === nameOrId ||
      p.name_zh === nameOrId ||
      p.name_en === nameOrId ||
      p.name === nameOrId
  );
}

export function getProviderDisplayName(p, lang) {
  if (!p) return "";
  const name = typeof p === "string" ? p : p.name;
  const found = findPreset(name);
  if (found) return lang === "en" ? found.name_en : found.name_zh;
  return name;
}

export class I18nManager {
  static detectComfyLanguage() {
    try {
      // 1. Check ComfyUI settings and localStorage (including popular plugins like AIGODLIKE)
      const candidates = [
        window.localStorage?.getItem("Comfy.Locale"),
        window.localStorage?.getItem("ComfyUI.Locale"),
        window.localStorage?.getItem("AG.Locale"),
        window.localStorage?.getItem("locale"),
        window.localStorage?.getItem("language"),
        window.app?.ui?.settings?.getSettingValue?.("Comfy.Locale"),
        window.app?.ui?.settings?.getSettingValue?.("AG.Locale"),
        document.documentElement?.lang,
      ];

      for (const cand of candidates) {
        if (cand && typeof cand === "string") {
          const lower = cand.toLowerCase();
          if (lower.startsWith("zh") || lower.includes("chinese") || lower.includes("zh_cn")) return "zh";
          if (lower.startsWith("en") || lower.includes("english")) return "en";
        }
      }

      // 2. Check navigator.languages list
      if (typeof navigator !== "undefined" && Array.isArray(navigator.languages)) {
        for (const l of navigator.languages) {
          if (typeof l === "string" && l.toLowerCase().startsWith("zh")) {
            return "zh";
          }
        }
      }

      // 3. Check navigator.language
      if (typeof navigator !== "undefined" && navigator.language && navigator.language.toLowerCase().startsWith("zh")) {
        return "zh";
      }

      // 4. Timezone heuristics (Greater China region default to Chinese)
      try {
        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
        if (/Shanghai|Chongqing|Harbin|Urumqi|Beijing|Hong_Kong|Taipei|Macau/i.test(tz)) {
          return "zh";
        }
      } catch (_) {}
    } catch (e) {}
    return "en";
  }

  static getEffectiveLanguage(configLanguage) {
    if (configLanguage === "zh") return "zh";
    if (configLanguage === "en") return "en";
    return this.detectComfyLanguage();
  }

  static translate(key, params = {}, lang = "zh") {
    const dict = DICTIONARIES[lang] || DICTIONARIES.zh;
    let str = dict[key] || DICTIONARIES.zh[key] || key;
    for (const [k, v] of Object.entries(params)) {
      str = str.replaceAll(`{${k}}`, v);
    }
    return str;
  }
}
