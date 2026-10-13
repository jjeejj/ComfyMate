/**
 * Fast, lightweight and robust Markdown parser and code block formatter for ComfyMate.
 * Supports headings, lists, tables, blockquotes, horizontal rules, inline formatting,
 * and code blocks with copy buttons.
 */
function escapeHtml(str) {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function renderMarkdown(text, tArg = (k) => k) {
  if (!text) return "";
  const translate = typeof tArg === "function" ? tArg : (k) => (tArg && tArg[k]) || k;
  const t = (key) => escapeHtml(translate(key));
  let blockPrefix = "\u0000CMBLOCK";
  while (text.includes(blockPrefix)) blockPrefix += "X";

  // 1. Pre-process and extract code blocks (both complete and open/streaming)
  const codeBlocks = [];
  let processed = text.replace(/```([a-zA-Z0-9_+-]*)\n([\s\S]*?)```/g, (match, lang, code) => {
    const idx = codeBlocks.length;
    codeBlocks.push({ lang: lang || "text", code });
    return `\n${blockPrefix}${idx}\u0000\n`;
  });

  // Handle open/streaming code block at the end
  processed = processed.replace(/```([a-zA-Z0-9_+-]*)\n([\s\S]*)$/, (match, lang, code) => {
    const idx = codeBlocks.length;
    codeBlocks.push({ lang: lang || "text", code });
    return `\n${blockPrefix}${idx}\u0000\n`;
  });

  // Tokenize raw inline input before formatting. Generated HTML is never parsed again.
  function parseInline(str) {
    if (!str) return "";
    const fragments = [];
    let prefix = "\u0000CMINLINE";
    while (str.includes(prefix)) prefix += "X";
    const nodeTag = (nid, type = "") => {
      const cleanType = type.replace(/^[📍📌🎯]\s*/u, "").trim();
      const label = cleanType ? `Node #${nid} [${cleanType}]` : `Node #${nid}`;
      return `<span class="cm-node-tag" data-node-id="${nid}" title="${t("locateNode")}">📍 ${escapeHtml(label)}</span>`;
    };
    let s = str.replace(/`([^`]+)`|\[([^\]]+)\]\(((?:https?:\/\/|\/|#)[^\s)]+)\)|(?:[📍📌🎯]\s*)?(?<![a-zA-Z0-9])Node #(\d+)(?:\s*\[([^\]]+)\])?/gu,
      (match, code, label, url, nid, type) => {
        let html;
        if (code !== undefined) {
          const node = code.replace(/^[📍📌🎯]\s*/u, "").trim()
            .match(/^(?:Node\s*)?#(\d+)(?:\s*\[([^\]]+)\])?$/iu);
          html = node ? nodeTag(node[1], node[2]) : `<code class="cm-inline-code">${escapeHtml(code)}</code>`;
        } else if (url !== undefined) {
          html = `<a class="cm-link" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${parseInline(label)}</a>`;
        } else {
          html = nodeTag(nid, type);
        }
        const idx = fragments.push(html) - 1;
        return `${prefix}${idx}\u0000`;
      });
    s = escapeHtml(s);
    s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    s = s.replace(/(^|\W)__([^_]+)__(?=\W|$)/g, "$1<strong>$2</strong>");
    s = s.replace(/\*([^*]+)\*/g, "<em>$1</em>");
    s = s.replace(/(^|\s)_([^_]+)_(?=\s|$)/g, "$1<em>$2</em>");
    s = s.replace(/~~([^~]+)~~/g, "<del>$1</del>");
    fragments.forEach((fragment, idx) => {
      s = s.replace(`${prefix}${idx}\u0000`, () => fragment);
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
    if (codeBlocks.some((_, idx) => trimmed === `${blockPrefix}${idx}\u0000`)) {
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
      (item.code.includes('"set_parameters"') || item.code.includes('"recommend_nodes"') || item.code.includes('"connect_nodes"') || item.code.includes('"auto_layout"'));

    if (isActionLang || isJsonAction) {
      try {
        const parsed = JSON.parse(item.code);
        if (parsed && parsed.action === "set_parameters") {
          const rawNodeId = parseInt(parsed?.node_id, 10);
          if (!isNaN(rawNodeId)) {
            const nodeId = rawNodeId;
            const params = (parsed.parameters && typeof parsed.parameters === "object") ? parsed.parameters : {};
            const reason = parsed.reason || "";
            const paramsJsonStr = encodeURIComponent(JSON.stringify(params));
            const reasonEsc = escapeHtml(reason);

            const paramRows = Object.entries(params)
              .map(([k, v]) => {
                const kEsc = escapeHtml(k);
                const vEsc = escapeHtml(v);
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
            html = html.replace(`${blockPrefix}${idx}\u0000`, () => cardHtml);
            return;
          }
        } else if (parsed && parsed.action === "recommend_nodes" && Array.isArray(parsed.nodes) && parsed.nodes.length > 0) {
          const nodesList = parsed.nodes;
          const nodeItems = nodesList.map((n) => {
            const typeEsc = escapeHtml(n.type || "");
            const titleEsc = escapeHtml(n.title || n.type || "Node");
            const reasonEsc = escapeHtml(n.reason || "");
            const encodedType = encodeURIComponent(n.type || "");
            return `
              <div class="cm-node-rec-item">
                <div class="cm-node-rec-info">
                  <div class="cm-node-rec-name">
                    <span class="cm-node-rec-icon">🧩</span>
                    <span class="cm-node-rec-title">${titleEsc}</span>
                    <span class="cm-node-rec-type">(${typeEsc})</span>
                  </div>
                  ${reasonEsc ? `<div class="cm-node-rec-reason">${reasonEsc}</div>` : ""}
                </div>
                <button class="cm-node-rec-btn-add" type="button" data-node-type="${encodedType}" title="${t("addNodeToCanvas") || "添加到画布"}">
                  <span>➕</span> <span>${t("addNode") || "添加到画布"}</span>
                </button>
              </div>
            `;
          }).join("");

          const cardHtml = `
            <div class="cm-action-card cm-node-rec-card" data-action="recommend_nodes">
              <div class="cm-action-header">
                <div class="cm-action-title">
                  <span class="cm-action-icon">💡</span>
                  <span>${t("recommendedNodes") || "AI 推荐节点"}</span>
                </div>
                <span class="cm-node-rec-count">${nodesList.length} ${t("nodesCount") || "个节点"}</span>
              </div>
              <div class="cm-action-body">
                <div class="cm-node-rec-list">
                  ${nodeItems}
                </div>
              </div>
            </div>
          `;
          html = html.replace(`${blockPrefix}${idx}\u0000`, () => cardHtml);
          return;
        } else if (parsed && parsed.action === "connect_nodes") {
          const rawList = Array.isArray(parsed.connections) && parsed.connections.length > 0
            ? parsed.connections
            : (parsed.from_node !== undefined && parsed.to_node !== undefined)
              ? [{
                  from_node: parsed.from_node,
                  from_slot: parsed.from_slot,
                  to_node: parsed.to_node,
                  to_slot: parsed.to_slot,
                  reason: parsed.reason || ""
                }]
              : [];

          if (rawList.length > 0) {
            const overallReason = parsed.reason ? escapeHtml(parsed.reason) : "";
            const connItems = rawList.map((c) => {
              const fromNid = parseInt(c.from_node, 10);
              const toNid = parseInt(c.to_node, 10);
              const fromSlot = escapeHtml(String(c.from_slot ?? ""));
              const toSlot = escapeHtml(String(c.to_slot ?? ""));
              const reasonEsc = c.reason ? escapeHtml(c.reason) : "";

              return `
                <div class="cm-conn-item">
                  <div class="cm-conn-flow">
                    <button class="cm-action-btn-locate cm-conn-node-badge" type="button" data-node-id="${fromNid}" title="${t("locateNode") || "在画布中定位节点"}">
                      <span>📍</span> <span>Node #${fromNid}</span>
                    </button>
                    <span class="cm-conn-slot cm-conn-slot-out" title="${t("fromSlot") || "输出端口"}">${fromSlot}</span>
                    <span class="cm-conn-arrow">➜</span>
                    <span class="cm-conn-slot cm-conn-slot-in" title="${t("toSlot") || "输入端口"}">${toSlot}</span>
                    <button class="cm-action-btn-locate cm-conn-node-badge" type="button" data-node-id="${toNid}" title="${t("locateNode") || "在画布中定位节点"}">
                      <span>📍</span> <span>Node #${toNid}</span>
                    </button>
                  </div>
                  ${reasonEsc && reasonEsc !== overallReason ? `<div class="cm-conn-item-reason">${reasonEsc}</div>` : ""}
                </div>
              `;
            }).join("");

            const connectionsJsonStr = encodeURIComponent(JSON.stringify(rawList));
            const cardHtml = `
              <div class="cm-action-card cm-connect-nodes-card" data-action="connect_nodes" data-connections="${connectionsJsonStr}">
                <div class="cm-action-header">
                  <div class="cm-action-title">
                    <span class="cm-action-icon">🔗</span>
                    <span>${t("suggestedConnection") || "AI 建议连线"}</span>
                  </div>
                  <span class="cm-conn-count">${rawList.length} ${t("connectionsCount") || "条连线"}</span>
                </div>
                <div class="cm-action-body">
                  <div class="cm-conn-list">
                    ${connItems}
                  </div>
                  ${overallReason ? `<div class="cm-action-reason">${overallReason}</div>` : ""}
                </div>
                <div class="cm-action-footer">
                  <button class="cm-action-btn cm-action-btn-connect" type="button" data-connections="${connectionsJsonStr}">
                    <span>🔗</span> <span>${t("connectNodes") || "一键连线"}</span>
                  </button>
                </div>
              </div>
            `;
            html = html.replace(`${blockPrefix}${idx}\u0000`, () => cardHtml);
            return;
          }
        } else if (parsed && parsed.action === "auto_layout") {
          const reasonEsc = parsed.reason ? escapeHtml(parsed.reason) : "";
          const scope = parsed.scope === "selected" ? "selected" : "all";
          const scopeBadge = scope === "selected" ? (t("scopeSelected") || "选中节点") : (t("scopeAll") || "全部节点");

          const cardHtml = `
            <div class="cm-action-card cm-layout-card" data-action="auto_layout" data-scope="${scope}">
              <div class="cm-action-header">
                <div class="cm-action-title">
                  <span class="cm-action-icon">📐</span>
                  <span>${t("autoLayoutTitle") || "AI 画布拓扑规整"}</span>
                </div>
                <span class="cm-layout-badge">${scopeBadge}</span>
              </div>
              <div class="cm-action-body">
                <div class="cm-layout-desc">
                  <span>${reasonEsc || (t("autoLayoutDefaultReason") || "自动分析当前工作流的上下游连线关系，按照拓扑层级深度重排节点位置，消除重叠与杂乱交错连线。")}</span>
                </div>
              </div>
              <div class="cm-action-footer">
                <button class="cm-action-btn cm-action-btn-layout" type="button" data-scope="${scope}">
                  <span>📐</span> <span>${t("applyLayout") || "一键整理排版"}</span>
                </button>
              </div>
            </div>
          `;
          html = html.replace(`${blockPrefix}${idx}\u0000`, () => cardHtml);
          return;
        } else if (parsed && parsed.action === "queue_prompt") {
          const reasonEsc = parsed.reason ? escapeHtml(parsed.reason) : "";
          const evalPrompt = parsed.eval_prompt ? encodeURIComponent(parsed.eval_prompt) : "";
          const defaultReason = t("queuePromptDefaultReason") || "建议立即测试出图以验证工作流与参数调整效果。";

          const cardHtml = `
            <div class="cm-action-card cm-queue-card" data-action="queue_prompt" data-eval-prompt="${evalPrompt}">
              <div class="cm-action-header">
                <div class="cm-action-title">
                  <span class="cm-action-icon">🚀</span>
                  <span>${t("queuePromptTitle") || "闭环测试出图"}</span>
                </div>
                <span class="cm-queue-status-badge cm-queue-status-idle">${t("queueReady") || "准备就绪"}</span>
              </div>
              <div class="cm-action-body">
                <div class="cm-queue-desc">
                  <span>${reasonEsc || defaultReason}</span>
                </div>
                <div class="cm-queue-progress-container hidden">
                  <div class="cm-queue-progress-bar">
                    <div class="cm-queue-progress-fill" style="width: 0%"></div>
                  </div>
                  <div class="cm-queue-progress-info">
                    <span class="cm-queue-progress-text">${t("queueQueued") || "排队中..."}</span>
                    <span class="cm-queue-progress-percent">0%</span>
                  </div>
                </div>
                <div class="cm-queue-result-container hidden"></div>
              </div>
              <div class="cm-action-footer">
                <button class="cm-action-btn cm-action-btn-queue" type="button" data-eval-prompt="${evalPrompt}">
                  <span>🚀</span> <span>${t("runQueue") || "立即测试出图"}</span>
                </button>
              </div>
            </div>
          `;
          html = html.replace(`${blockPrefix}${idx}\u0000`, () => cardHtml);
          return;
        }
      } catch (e) {
        // Fall back to normal code block rendering
      }
    }

    const escapedCode = escapeHtml(item.code);
    const blockHtml = `
      <div class="cm-code-wrapper">
        <div class="cm-code-header">
          <span class="cm-code-lang">${item.lang}</span>
          <button class="cm-code-copy" data-code="${encodeURIComponent(item.code)}">${t("copyCode") || "Copy"}</button>
        </div>
        <pre><code class="language-${item.lang}">${escapedCode}</code></pre>
      </div>
    `;
    html = html.replace(`${blockPrefix}${idx}\u0000`, () => blockHtml);
  });

  return html;
}
