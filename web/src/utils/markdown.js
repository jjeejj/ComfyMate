/**
 * Fast, lightweight and robust Markdown parser and code block formatter for ComfyMate.
 * Supports headings, lists, tables, blockquotes, horizontal rules, inline formatting,
 * and code blocks with copy buttons.
 */
export function renderMarkdown(text, t = (k) => k) {
  if (!text) return "";

  // 1. Pre-process and extract code blocks (both complete and open/streaming)
  const codeBlocks = [];
  let processed = text.replace(/```([a-zA-Z0-9_+-]*)\n([\s\S]*?)```/g, (match, lang, code) => {
    const idx = codeBlocks.length;
    codeBlocks.push({ lang: lang || "text", code });
    return `\n__CM_CODE_BLOCK_${idx}__\n`;
  });

  // Handle open/streaming code block at the end
  processed = processed.replace(/```([a-zA-Z0-9_+-]*)\n([\s\S]*)$/, (match, lang, code) => {
    const idx = codeBlocks.length;
    codeBlocks.push({ lang: lang || "text", code });
    return `\n__CM_CODE_BLOCK_${idx}__\n`;
  });

  // Helper: parse inline markdown elements with protection for inline code
  function parseInline(str) {
    if (!str) return "";

    // Extract inline code snippets first to protect them from bold/italic formatting
    const inlineCodes = [];
    let s = str.replace(/`([^`]+)`/g, (m, c) => {
      const idx = inlineCodes.length;
      inlineCodes.push(c);
      return `__CM_INLINE_CODE_${idx}__`;
    });

    // Escape raw HTML entities
    s = s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

    // Markdown Links: [text](url)
    s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a class="cm-link" href="$2" target="_blank" rel="noopener">$1</a>');

    // Bold: **text** or __text__
    s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    s = s.replace(/(^|\W)__([^_]+)__(?=\W|$)/g, "$1<strong>$2</strong>");

    // Italic: *text* or _text_
    s = s.replace(/\*([^*]+)\*/g, "<em>$1</em>");
    s = s.replace(/(^|\s)_([^_]+)_(?=\s|$)/g, "$1<em>$2</em>");

    // Strikethrough: ~~text~~
    s = s.replace(/~~([^~]+)~~/g, "<del>$1</del>");

    // 1. Support plain text "Node #123 [Type]" or "Node #123"
    // (Must run BEFORE restoring inline codes so it never matches inside already-generated tags)
    s = s.replace(/(?:[📍📌🎯]\s*)?\bNode #(\d+)(?:\s*\[([^\]]+)\])?/gu, (match, nid, ntype) => {
      const cleanType = ntype ? ntype.replace(/^[📍📌🎯]\s*/u, "").trim() : "";
      const label = cleanType ? `Node #${nid} [${cleanType}]` : `Node #${nid}`;
      return `<span class="cm-node-tag" data-node-id="${nid}" title="${t("locateNode") || "在画布中定位此节点"}">📍 ${label}</span>`;
    });

    // 2. Restore inline code snippets safely
    inlineCodes.forEach((c, idx) => {
      const esc = c
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");

      const cleanC = c.replace(/^[📍📌🎯]\s*/u, "").trim();
      const nodeMatch = cleanC.match(/^(?:Node\s*)?#(\d+)(?:\s*\[([^\]]+)\])?$/iu);
      if (nodeMatch) {
        const nid = nodeMatch[1];
        const ntype = nodeMatch[2] ? nodeMatch[2].trim() : "";
        const label = ntype ? `Node #${nid} [${ntype}]` : `Node #${nid}`;
        s = s.replace(`__CM_INLINE_CODE_${idx}__`, `<span class="cm-node-tag" data-node-id="${nid}" title="${t("locateNode") || "在画布中定位此节点"}">📍 ${label}</span>`);
      } else {
        s = s.replace(`__CM_INLINE_CODE_${idx}__`, `<code class="cm-inline-code">${esc}</code>`);
      }
    });

    return s;
  }

  const lines = processed.split("\n");
  const output = [];
  let inUl = false;
  let inOl = false;
  let inBlockquote = false;
  let inTable = false;

  function closeAll() {
    if (inUl) {
      output.push("</ul>");
      inUl = false;
    }
    if (inOl) {
      output.push("</ol>");
      inOl = false;
    }
    if (inBlockquote) {
      output.push("</blockquote>");
      inBlockquote = false;
    }
    if (inTable) {
      output.push("</tbody></table>");
      inTable = false;
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Code block placeholder
    if (trimmed.startsWith("__CM_CODE_BLOCK_") && trimmed.endsWith("__")) {
      closeAll();
      output.push(trimmed);
      continue;
    }

    // Horizontal rule: ---, ***, ___
    if (/^(?:---|\*\*\*|___)\s*$/.test(trimmed)) {
      closeAll();
      output.push('<hr class="cm-hr"/>');
      continue;
    }

    // Headings: # H1, ## H2, ### H3, etc.
    const headingMatch = trimmed.match(/^(#{1,6})\s+(.*)$/);
    if (headingMatch) {
      closeAll();
      const level = headingMatch[1].length;
      output.push(`<h${level} class="cm-h${level}">${parseInline(headingMatch[2])}</h${level}>`);
      continue;
    }

    // Blockquote: > text
    const quoteMatch = line.match(/^>\s?(.*)$/);
    if (quoteMatch) {
      if (inUl || inOl || inTable) closeAll();
      if (!inBlockquote) {
        output.push('<blockquote class="cm-blockquote">');
        inBlockquote = true;
      }
      output.push(`<p class="cm-p">${parseInline(quoteMatch[1])}</p>`);
      continue;
    } else if (inBlockquote) {
      output.push("</blockquote>");
      inBlockquote = false;
    }

    // Markdown Table: | Col 1 | Col 2 |
    if (trimmed.startsWith("|") && trimmed.endsWith("|") && trimmed.includes("|")) {
      if (inUl || inOl || inBlockquote) closeAll();
      const cols = trimmed.slice(1, -1).split("|").map((c) => c.trim());
      // Check if separator line (e.g. |---|---|)
      if (cols.every((c) => /^:?-+:?$/.test(c))) {
        continue; // delimiter row, skip
      }
      if (!inTable) {
        output.push('<table class="cm-table"><thead><tr>');
        cols.forEach((c) => output.push(`<th>${parseInline(c)}</th>`));
        output.push("</tr></thead><tbody>");
        inTable = true;
        continue;
      } else {
        output.push("<tr>");
        cols.forEach((c) => output.push(`<td>${parseInline(c)}</td>`));
        output.push("</tr>");
        continue;
      }
    } else if (inTable) {
      output.push("</tbody></table>");
      inTable = false;
    }

    // Unordered List: - item, * item, + item
    const ulMatch = line.match(/^\s*[-*+]\s+(.*)$/);
    if (ulMatch) {
      if (inOl || inBlockquote || inTable) closeAll();
      if (!inUl) {
        output.push('<ul class="cm-ul">');
        inUl = true;
      }
      output.push(`<li class="cm-li">${parseInline(ulMatch[1])}</li>`);
      continue;
    } else if (inUl && trimmed === "") {
      output.push("</ul>");
      inUl = false;
    }

    // Ordered List: 1. item, 2. item
    const olMatch = line.match(/^\s*(\d+)\.\s+(.*)$/);
    if (olMatch) {
      if (inUl || inBlockquote || inTable) closeAll();
      if (!inOl) {
        output.push('<ol class="cm-ol">');
        inOl = true;
      }
      output.push(`<li class="cm-li">${parseInline(olMatch[2])}</li>`);
      continue;
    } else if (inOl && trimmed === "") {
      output.push("</ol>");
      inOl = false;
    }

    // Empty blank line
    if (trimmed === "") {
      closeAll();
      continue;
    }

    // Regular paragraph line
    closeAll();
    output.push(`<p class="cm-p">${parseInline(trimmed)}</p>`);
  }

  closeAll();
  let html = output.join("\n");

  // Restore code blocks with syntax block wrapper or interactive action card
  codeBlocks.forEach((item, idx) => {
    // Check if this is an executable action block
    const isActionLang = item.lang && item.lang.toLowerCase() === "comfymate-action";
    const isJsonAction =
      (item.lang === "json" || !item.lang || item.lang === "text") &&
      item.code.includes('"action"') &&
      item.code.includes('"set_parameters"');

    if (isActionLang || isJsonAction) {
      try {
        const parsed = JSON.parse(item.code);
        if (parsed && parsed.action === "set_parameters" && parsed.node_id) {
          const nodeId = parsed.node_id;
          const params = parsed.parameters || {};
          const reason = parsed.reason || "";
          const paramsJsonStr = encodeURIComponent(JSON.stringify(params));
          const reasonEsc = reason
            ? reason.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
            : "";

          const paramRows = Object.entries(params)
            .map(([k, v]) => {
              const kEsc = String(k).replace(/&/g, "&amp;").replace(/</g, "&lt;");
              const vEsc = String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;");
              return `<div class="cm-action-param-row"><span class="cm-action-param-key">${kEsc}:</span> <span class="cm-action-param-val">${vEsc}</span></div>`;
            })
            .join("");

          const cardHtml = `
            <div class="cm-action-card" data-action="set_parameters" data-node-id="${nodeId}" data-params="${paramsJsonStr}">
              <div class="cm-action-header">
                <div class="cm-action-title">
                  <span class="cm-action-icon">⚡</span>
                  <span>${t("suggestedAction") || "AI 建议参数调整"}</span>
                </div>
                <button class="cm-action-btn-locate" type="button" data-node-id="${nodeId}" title="${t("locateNode") || "在画布中定位节点"}">
                  <span>📍</span> <span>Node #${nodeId}</span>
                </button>
              </div>
              <div class="cm-action-body">
                <div class="cm-action-params">${paramRows}</div>
                ${reasonEsc ? `<div class="cm-action-reason">${reasonEsc}</div>` : ""}
              </div>
              <div class="cm-action-footer">
                <button class="cm-action-btn cm-action-btn-apply" type="button" data-node-id="${nodeId}" data-params="${paramsJsonStr}">
                  <span>▶️</span> <span>${t("applyParams") || "应用到画布"}</span>
                </button>
              </div>
            </div>
          `;
          html = html.replace(`__CM_CODE_BLOCK_${idx}__`, cardHtml);
          return;
        }
      } catch (e) {
        // Fall back to normal code block rendering
      }
    }

    const escapedCode = item.code
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
    const blockHtml = `
      <div class="cm-code-wrapper">
        <div class="cm-code-header">
          <span class="cm-code-lang">${item.lang}</span>
          <button class="cm-code-copy" data-code="${encodeURIComponent(item.code)}">${t("copyCode") || "Copy"}</button>
        </div>
        <pre><code class="language-${item.lang}">${escapedCode}</code></pre>
      </div>
    `;
    html = html.replace(`__CM_CODE_BLOCK_${idx}__`, blockHtml);
  });

  return html;
}
