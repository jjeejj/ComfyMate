import { ContextExtractor } from "./src/canvas/extractor.js";
import { CanvasActionManager } from "./src/canvas/actions.js";
import { I18nManager, FORMAT_PRESETS } from "./src/i18n/index.js";
import { renderMarkdown } from "./src/components/markdown/index.js";
import { ApiClient } from "./src/services/api.js";
import { SettingsModal } from "./src/components/settings_modal/index.js";
import { Toast, escapeHtml } from "./src/components/toast/index.js";
import { loadTemplate, renderTemplate } from "./src/utils/template_loader.js";

export class ChatUI {
  constructor(app) {
    this.app = app;
    this.extractor = new ContextExtractor(app);
    this.actions = new CanvasActionManager(app);
    this.messages = [];
    this.isStreaming = false;
    this.abortController = null;
    this._activeChatRequest = null;
    this.isVisible = false;
    this.config = null;
    this.attachedImages = [];

    // Session Management State
    this.currentSessionId = null;
    this.currentSessionTitle = "";

    // Workflow Sync & Multi-Canvas State
    this.activeWorkflow = null;
    this._lastWorkflowKey = null;
    this._workflowChatCache = {}; // in-memory cache: wfName -> { sessionId, title, messages }
    this._workflowDrafts = {};
    this._workflowCheckTimer = null;
    this._workflowObserver = null;
    // Clean up any legacy localStorage session keys so server disk files are the sole source of truth
    try {
      localStorage.removeItem("comfymate_wf_session_map");
      localStorage.removeItem("comfymate_chat_history");
      localStorage.removeItem("comfymate_last_active_session_id");
      localStorage.removeItem("comfymate_chat_history_latest");
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const k = localStorage.key(i);
        if (k && k.startsWith("comfymate_chat_history_wf_")) {
          localStorage.removeItem(k);
        }
      }
    } catch (_) {}

    // Settings Modal State
    this.settingsTab = "models";
    this.editingProviderId = null;
    this.isAddingNew = false;
    this._contextInterval = null;

    // Asynchronous DOM & component initialization
    this.panel = null;
    this.settingsModal = null;

    // Fast-path: preload cached config from localStorage to prevent blank states on refresh
    try {
      const cached = localStorage.getItem("comfymate_config_cache");
      if (cached) {
        this.config = JSON.parse(cached);
      }
    } catch (_) {}

    this.ready = this._init();
  }

  async _init() {
    await this._createDOM();
    this.settingsModal = new SettingsModal(this._getComponentContext());
    await this._loadConfig();
    this._initWorkflowTracker();
    await this._restoreHistory();
    this._startBootWorkflowWatcher();
    this._startContextSync();
    this._setupGlobalShortcuts();
  }

  /* ---------------- Internal Context for Subcomponents ---------------- */

  _getComponentContext() {
    return {
      t: (key, params) => this.t(key, params),
      toast: Toast,
      getEffectiveLang: () => this._getEffectiveLang(),
      detectComfyLanguage: () => I18nManager.detectComfyLanguage(),
      get config() {
        return this._owner.config;
      },
      set config(v) {
        this._owner.config = v;
      },
      get editingProviderId() {
        return this._owner.editingProviderId;
      },
      set editingProviderId(v) {
        this._owner.editingProviderId = v;
      },
      get isAddingNew() {
        return this._owner.isAddingNew;
      },
      set isAddingNew(v) {
        this._owner.isAddingNew = v;
      },
      saveConfig: () => this._saveConfigToServer(),
      isProviderConfigured: (p) => this._isProviderConfigured(p),
      testConnection: (id, apiType, url, key, model, models, proxy = "") => this._testConnectionEndpoint(id, apiType, url, key, model, models, proxy),
      apiTestConnection: (params) => ApiClient.testConnection(params),
      updateStaticUIText: () => this._updateStaticUIText(),
      switchSettingsTab: (tab) => this.settingsModal.switchTab(tab),
      _owner: this,
    };
  }

  /* ---------------- Localization ---------------- */

  _getEffectiveLang() {
    const pref = this.config?.language || "auto";
    return I18nManager.getEffectiveLanguage(pref);
  }

  t(key, params = {}) {
    return I18nManager.translate(key, params, this._getEffectiveLang());
  }

  /* ---------------- DOM Construction & Event Binding ---------------- */

  async _createDOM() {
    this.panel = document.createElement("div");
    this.panel.className = "comfymate-panel hidden";

    const rawTemplate = await loadTemplate("./src/components/panel/panel.html", import.meta.url);
    this.panel.innerHTML = renderTemplate(rawTemplate, (k) => this.t(k));
    document.body.appendChild(this.panel);

    this._updateStaticUIText();
    if (this.config) {
      this._renderModelSelector();
    }
    this._bindEvents();
    this._bindResizer();
  }

  _updateStaticUIText() {
    if (!this.panel) return;
    this.panel.querySelector("#cm-txt-copilot").textContent = this.t("copilot");
    this.panel.querySelector("#cm-txt-model-label").textContent = this.t("modelLabel");
    this.panel.querySelector("#cm-pill-wf").textContent = this.t("explainWf");
    this.panel.querySelector("#cm-pill-sel").textContent = this.t("explainSel");
    this.panel.querySelector("#cm-pill-err").textContent = this.t("diagnoseErr");
    const pillDoc = this.panel.querySelector("#cm-pill-doctor");
    if (pillDoc) pillDoc.textContent = this.t("doctorBtn") || "🩺 工作流体检";
    this.panel.querySelector("#cm-input").placeholder = this.t("placeholder");

    // Update workflow context tag
    this._updateHeaderWorkflowBadge();

    if (this.messages.length === 0) {
      const welcomeEl = this.panel.querySelector("#cm-welcome-msg");
      if (welcomeEl) {
        const configuredProviders = (this.config?.providers || []).filter((p) => this._isProviderConfigured(p));
        let welcomeHtml = this.t("welcome");
        if (this.activeWorkflow && this.activeWorkflow.name) {
          const greetingText = renderMarkdown(this.t("workflowLinkedGreeting", { name: this.activeWorkflow.name }), (k) => this.t(k));
          welcomeHtml = `
            <div class="cm-wf-greeting" style="margin-bottom:12px; padding:10px 12px; background:rgba(59,130,246,0.12); border:1px solid rgba(59,130,246,0.3); border-radius:8px; font-size:12px; line-height:1.5; color:#93c5fd;">
              ${greetingText}
            </div>
            ${welcomeHtml}
          `;
        }
        if (configuredProviders.length === 0) {
          welcomeHtml += `
            <div class="cm-unconfigured-banner" style="margin-top:14px; padding:12px 14px; background:rgba(59,130,246,0.08); border:1px solid rgba(59,130,246,0.25); border-radius:10px; display:flex; flex-direction:column; gap:10px; align-items:flex-start; width:100%; box-sizing:border-box;">
              <div style="font-size:12px; color:#cbd5e1; line-height:1.5;">
                <b style="color:#93c5fd; display:block; margin-bottom:3px;">✨ ${this.t("unconfiguredNoticeTitle")}:</b>
                <span>${this.t("unconfiguredNoticeDesc")}</span>
              </div>
              <button class="comfymate-send-btn" id="cm-btn-welcome-config" style="padding:6px 14px; font-size:12px; white-space:nowrap; cursor:pointer; align-self:flex-start;">
                ⚙️ ${this.t("goToSettings")}
              </button>
            </div>
          `;
        }
        welcomeEl.innerHTML = welcomeHtml;
        const welcomeConfigBtn = welcomeEl.querySelector("#cm-btn-welcome-config");
        if (welcomeConfigBtn) {
          welcomeConfigBtn.onclick = () => this.openSettings();
        }
      }
    } else {
      const welcomeEl = this.panel.querySelector("#cm-welcome-msg");
      if (welcomeEl) welcomeEl.remove();
    }
    this.panel.querySelector("#cm-btn-send").textContent = this.isStreaming ? this.t("stop") : this.t("send");

    const btnQueue = this.panel.querySelector("#cm-btn-queue");
    if (btnQueue) btnQueue.title = this.t("btnQueueTitle") || "测试出图";
    const btnLayout = this.panel.querySelector("#cm-btn-layout");
    if (btnLayout) btnLayout.title = this.t("btnLayoutTitle") || "一键整理排版";
    const btnNew = this.panel.querySelector("#cm-btn-new-chat");
    if (btnNew) btnNew.title = this.t("btnNewChatTitle") || "新建会话";
    const btnSess = this.panel.querySelector("#cm-btn-sessions");
    if (btnSess) btnSess.title = this.t("btnSessionsTitle") || "历史会话";
    this.panel.querySelector("#cm-btn-settings").title = this.t("btnSettingsTitle");
    this.panel.querySelector("#cm-btn-close").title = this.t("btnCloseTitle");
    this.panel.querySelector("#cm-resizer").title = this.t("resizerTitle");
    this.panel.querySelector("#cm-active-model-select").title = this.t("modelSelectorTitle");

    const pillLayout = this.panel.querySelector("#cm-pill-layout");
    if (pillLayout) pillLayout.textContent = this.t("layoutBtn") || "📐 整理画布";
    const pillQueue = this.panel.querySelector("#cm-pill-queue");
    if (pillQueue) pillQueue.textContent = this.t("queueBtn") || "🚀 测试出图";

    const edgeHandle = document.querySelector("#cm-edge-handle");
    if (edgeHandle) {
      edgeHandle.title = this.t("drawerTooltip");
    }

    if (this.settingsModal) {
      this.settingsModal.updateText();
    }
  }

  _setupGlobalShortcuts() {
    const handleKeydown = (e) => {
      // 1. Esc key: close sessions overlay or settings modal if open, or collapse panel if focused
      if (e.key === "Escape") {
        const sessionsOverlay = this.panel.querySelector("#cm-sessions-overlay");
        if (sessionsOverlay && !sessionsOverlay.classList.contains("hidden")) {
          e.preventDefault();
          e.stopPropagation();
          this._closeSessionsOverlay();
          return;
        }
        if (this.settingsModal && this.settingsModal.isOpen()) {
          e.preventDefault();
          e.stopPropagation();
          this.closeSettings();
          return;
        }

        if (this.isVisible && (document.activeElement?.closest?.(".comfymate-panel") || document.activeElement === document.body)) {
          e.preventDefault();
          e.stopPropagation();
          this.toggle(false);
          return;
        }
      }

      // 2. Normalize key detection:
      // Physical key check works across layouts, caps lock, and Mac Option modifier characters
      const isKeyC =
        e.code === "KeyC" ||
        (e.key && (e.key.toLowerCase() === "c" || e.key === "ç"));
      const isKeyM =
        e.code === "KeyM" ||
        (e.key && (e.key.toLowerCase() === "m" || e.key === "µ"));
      const isKeyJ =
        e.code === "KeyJ" ||
        (e.key && (e.key.toLowerCase() === "j" || e.key === "∆"));

      // 3. Supported toggle combinations:
      // - Option+C / Alt+C (Primary: ultra-ergonomic left-hand thumb+index, 'C' for Copilot/Chat)
      // - Option+M / Alt+M (Ergonomic alternative, 'M' for Mate)
      // - Cmd+J / Ctrl+J (Developer favorite, VS Code panel style)
      // - Cmd+Shift+M / Ctrl+Shift+M (Developer combo, avoids macOS Cmd+M "Minimize Window")
      // - Cmd+M / Ctrl+M (Direct fallback if browser permits)
      const isAltC = e.altKey && !e.ctrlKey && !e.metaKey && isKeyC;
      const isAltM = e.altKey && !e.ctrlKey && !e.metaKey && isKeyM;
      const isCmdJ = (e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && isKeyJ;
      const isShiftM = (e.metaKey || e.ctrlKey) && e.shiftKey && isKeyM;
      const isCtrlOrCmdM = (e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && isKeyM;

      if (isAltC || isAltM || isCmdJ || isShiftM || isCtrlOrCmdM) {
        e.preventDefault();
        e.stopPropagation();
        this.toggle();
      }
    };

    // Use capture: true so ComfyUI / LiteGraph canvas event listeners cannot swallow the shortcut
    window.addEventListener("keydown", handleKeydown, { capture: true });
  }

  _bindResizer() {
    const resizer = this.panel.querySelector("#cm-resizer");
    let isResizing = false;

    // Restore saved width if available
    try {
      const savedWidth = localStorage.getItem("comfymate_panel_width");
      if (savedWidth) {
        const w = parseInt(savedWidth, 10);
        if (!isNaN(w) && w >= 380 && w <= window.innerWidth * 0.92) {
          this.panel.style.width = `${w}px`;
        }
      }
    } catch (_) {}

    resizer.addEventListener("mousedown", (e) => {
      isResizing = true;
      resizer.classList.add("resizing");
      document.body.style.userSelect = "none";
      document.body.style.cursor = "ew-resize";
      e.preventDefault();
    });

    window.addEventListener("mousemove", (e) => {
      if (!isResizing) return;
      const minW = 380;
      const maxW = Math.max(minW, Math.floor(window.innerWidth * 0.92));
      const targetW = window.innerWidth - e.clientX - 16;
      const clampedW = Math.max(minW, Math.min(targetW, maxW));
      this.panel.style.width = `${clampedW}px`;
      try {
        localStorage.setItem("comfymate_panel_width", String(clampedW));
      } catch (_) {}
    });

    window.addEventListener("mouseup", () => {
      if (isResizing) {
        isResizing = false;
        resizer.classList.remove("resizing");
        document.body.style.userSelect = "";
        document.body.style.cursor = "";
      }
    });
  }

  _bindEvents() {
    const queueHeaderBtn = this.panel.querySelector("#cm-btn-queue");
    if (queueHeaderBtn) queueHeaderBtn.addEventListener("click", () => this._handleQueuePrompt());

    const layoutBtn = this.panel.querySelector("#cm-btn-layout");
    if (layoutBtn) layoutBtn.addEventListener("click", () => this._handleAutoLayout());

    const newChatBtn = this.panel.querySelector("#cm-btn-new-chat");
    if (newChatBtn) newChatBtn.addEventListener("click", () => this._createNewSession());

    const sessionsBtn = this.panel.querySelector("#cm-btn-sessions");
    if (sessionsBtn) sessionsBtn.addEventListener("click", () => this._toggleSessionsOverlay());

    const closeSessionsBtn = this.panel.querySelector("#cm-btn-close-sessions");
    if (closeSessionsBtn) closeSessionsBtn.addEventListener("click", () => this._closeSessionsOverlay());

    const newChatDrawerBtn = this.panel.querySelector("#cm-btn-new-chat-drawer");
    if (newChatDrawerBtn) newChatDrawerBtn.addEventListener("click", () => {
      this._createNewSession();
      this._closeSessionsOverlay();
    });

    this.panel.querySelector("#cm-btn-close").addEventListener("click", () => this.toggle(false));
    this.panel.querySelector("#cm-btn-settings").addEventListener("click", () => this.openSettings());

    const wfTag = this.panel.querySelector("#cm-tag-workflow");
    if (wfTag) {
      wfTag.addEventListener("click", () => {
        if (this.activeWorkflow?.name) {
          Toast.info(this.t("linkedWorkflowTip") || "当前对话已与此画布工作流绑定");
        }
      });
    }

    const activeModelSelect = this.panel.querySelector("#cm-active-model-select");
    activeModelSelect.addEventListener("mousedown", () => {
      if (activeModelSelect.options.length <= 1 && this.config) {
        this._renderModelSelector();
      }
    });

    activeModelSelect.addEventListener("change", (e) => {
      const val = e.target.value;
      if (!val) {
        this.openSettings();
        return;
      }
      const sepIdx = val.indexOf("::");
      if (sepIdx !== -1 && this.config) {
        const pid = val.substring(0, sepIdx);
        const model = val.substring(sepIdx + 2);
        this.config.active_provider_id = pid;
        this.config.active_model = model;
        try {
          localStorage.setItem("comfymate_config_cache", JSON.stringify(this.config));
        } catch (_) {}
        ApiClient.saveConfig({
          active_provider_id: pid,
          active_model: model,
        }).catch((err) => console.warn("[ComfyMate] Failed to auto-save active model:", err));
      }
    });

    const input = this.panel.querySelector("#cm-input");
    const sendBtn = this.panel.querySelector("#cm-btn-send");

    sendBtn.addEventListener("click", () => {
      if (this.isStreaming) {
        this.stopGeneration();
      } else {
        this.sendMessage();
      }
    });

    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        // Prevent premature sending during IME composition (e.g. Windows Microsoft Pinyin)
        if (e.isComposing || e.keyCode === 229) {
          return;
        }
        e.preventDefault();
        this.sendMessage();
      }
    });

    input.addEventListener("input", () => {
      input.style.height = "auto";
      input.style.height = `${Math.min(Math.max(input.scrollHeight, 40), 120)}px`;
    });

    // Image paste & drag/drop listeners
    const inputArea = this.panel.querySelector("#cm-input-area");
    this.panel.addEventListener("paste", (e) => {
      if (e.target.closest(".comfymate-dialog") || e.target.closest(".comfymate-modal-backdrop")) {
        return;
      }
      this._handlePaste(e);
    });

    if (inputArea) {
      inputArea.addEventListener("dragover", (e) => {
        e.preventDefault();
        inputArea.style.borderColor = "rgba(59, 130, 246, 0.6)";
      });
      inputArea.addEventListener("dragleave", () => {
        inputArea.style.borderColor = "";
      });
      inputArea.addEventListener("drop", (e) => {
        e.preventDefault();
        inputArea.style.borderColor = "";
        const files = e.dataTransfer?.files;
        if (!files) return;
        for (const file of files) {
          if (file.type.startsWith("image/")) {
            this._addAttachedImage(file);
          }
        }
      });
    }

    const previewBar = this.panel.querySelector("#cm-image-preview-bar");
    if (previewBar) {
      previewBar.addEventListener("click", (e) => {
        const removeBtn = e.target.closest(".cm-img-preview-remove");
        if (removeBtn) {
          const idx = parseInt(removeBtn.getAttribute("data-idx"), 10);
          if (!isNaN(idx)) {
            this.attachedImages.splice(idx, 1);
            this._renderAttachedImages();
          }
        }
      });
    }

    this.panel.querySelectorAll(".comfymate-pill[data-action]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        const targetBtn = e.target.closest(".comfymate-pill[data-action]");
        const action = targetBtn?.getAttribute("data-action");
        if (action === "explain_workflow") {
          this.sendMessage(this.t("promptExplainWf"));
        } else if (action === "explain_selected") {
          const selected = this.extractor.getSelectedNodes();
          if (selected.length === 0) {
            Toast.warning(this.t("selectNodesFirst") || "请先在画布上选中要分析的节点。");
            return;
          }
          this.sendMessage(this.t("promptExplainSel"));
        } else if (action === "diagnose_error") {
          const err = this.extractor.getLastError ? this.extractor.getLastError() : this.extractor.lastError;
          if (err) {
            this.sendMessage(this.t("promptDiagnoseErr"));
          } else {
            // Check workflow health issues
            const report = this.actions.diagnoseWorkflow();
            if (report && report.issues && report.issues.length > 0) {
              const msg = this.t("noRuntimeErrorWithIssues", { n: report.issues.length }) ||
                `💡 **当前未捕获到运行时崩溃报错**，但体检发现当前工作流存在 **${report.issues.length} 处潜在配置问题**（如未连接的槽位或参数异常）。\n\n已为您展示体检报告，您可以点击报告下方的「让 AI 提供修复方案」一键修复。`;
              this._appendMessage("assistant", msg);
              this._runDoctorCheck();
            } else {
              this.sendMessage(this.t("promptDiagnosePotential") || "请帮我全面排查当前工作流的节点配置与连线，分析是否存在可能导致执行失败、报错或生成异常的潜在问题。");
            }
          }
        } else if (action === "doctor_check") {
          this._runDoctorCheck();
        } else if (action === "auto_layout") {
          this._handleAutoLayout();
        } else if (action === "queue_prompt") {
          this._handleQueuePrompt();
        }
      });
    });

    // Clicking Selected Tag: Locate the selected node on canvas
    this.panel.querySelector("#cm-tag-selected").addEventListener("click", () => {
      const selected = this.extractor.getSelectedNodes();
      if (selected.length > 0) {
        this.actions.locateNode(selected[0].id);
      }
    });

    // Clicking Error Tag: Locate offending error node on canvas
    this.panel.querySelector("#cm-tag-error").addEventListener("click", () => {
      if (this.extractor.lastError?.node_id) {
        this.actions.locateNode(this.extractor.lastError.node_id);
      } else {
        this.sendMessage(this.t("promptDiagnoseErr"));
      }
    });

    // Delegated click handler for messages area: Copy, Node Tags, Action Cards, Doctor Reports
    this.panel.querySelector("#cm-messages").addEventListener("click", (e) => {
      // 1. Code copy button
      const copyBtn = e.target.closest(".cm-code-copy");
      if (copyBtn) {
        const code = decodeURIComponent(copyBtn.getAttribute("data-code") || "");
        if (code) {
          const onCopied = () => {
            const origText = copyBtn.textContent;
            copyBtn.textContent = this.t("copiedCode") || "已复制!";
            setTimeout(() => {
              copyBtn.textContent = origText;
            }, 2000);
          };

          if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
            navigator.clipboard.writeText(code).then(onCopied).catch(() => {
              this._fallbackCopyText(code);
              onCopied();
            });
          } else {
            this._fallbackCopyText(code);
            onCopied();
          }
        }
        return;
      }

      // 2. Clickable Node Tag: Locate node on canvas
      const nodeTag = e.target.closest(".cm-node-tag");
      if (nodeTag) {
        const nodeId = nodeTag.getAttribute("data-node-id");
        if (nodeId) {
          const res = this.actions.locateNode(nodeId);
          if (!res.success) {
            Toast.warning(this.t("nodeNotFound", { id: nodeId }));
          }
        }
        return;
      }

      // 3. Action Card: Locate Node button
      const locateBtn = e.target.closest(".cm-action-btn-locate, .cm-doctor-locate");
      if (locateBtn) {
        const nodeId = locateBtn.getAttribute("data-node-id");
        if (nodeId) {
          const res = this.actions.locateNode(nodeId);
          if (!res.success) {
            Toast.warning(this.t("nodeNotFound", { id: nodeId }));
          }
        }
        return;
      }

      // 4. Action Card: Apply Parameters button
      const applyBtn = e.target.closest(".cm-action-btn-apply");
      if (applyBtn) {
        const card = applyBtn.closest(".cm-action-card");
        const nodeId = applyBtn.getAttribute("data-node-id");
        const rawParams = decodeURIComponent(applyBtn.getAttribute("data-params") || "{}");
        try {
          const params = JSON.parse(rawParams);
          const res = this.actions.applyParameters(nodeId, params);
          if (res.success) {
            if (card) {
              const footer = card.querySelector(".cm-action-footer");
              if (footer) {
                const oldValsJson = encodeURIComponent(JSON.stringify(res.oldValues));
                footer.innerHTML = `
                  <span class="cm-action-applied-badge">✅ ${this.t("actionApplied") || "已生效"}</span>
                  <button class="cm-action-btn cm-action-btn-undo" type="button" data-node-id="${nodeId}" data-old-values="${oldValsJson}">
                    <span>↩️</span> <span>${this.t("undoParams") || "撤销修改"}</span>
                  </button>
                `;
              }
            }
          } else {
            Toast.error(this.t("applyFailed", { msg: res.message || "Unknown error" }));
          }
        } catch (err) {
          console.error("[ComfyMate] Failed to apply params:", err);
          Toast.error(this.t("applyFailed", { msg: err.message }));
        }
        return;
      }

      // 5. Action Card: Undo Parameters button
      const undoBtn = e.target.closest(".cm-action-btn-undo");
      if (undoBtn) {
        const card = undoBtn.closest(".cm-action-card");
        const nodeId = undoBtn.getAttribute("data-node-id");
        const rawOldVals = decodeURIComponent(undoBtn.getAttribute("data-old-values") || "{}");
        try {
          const oldValues = JSON.parse(rawOldVals);
          const res = this.actions.undoParameters(nodeId, oldValues);
          if (res.success) {
            if (card) {
              const footer = card.querySelector(".cm-action-footer");
              const origParamsJson = card.getAttribute("data-params") || "{}";
              if (footer) {
                footer.innerHTML = `
                  <button class="cm-action-btn cm-action-btn-apply" type="button" data-node-id="${nodeId}" data-params="${origParamsJson}">
                    <span>▶️</span> <span>${this.t("applyParams") || "应用到画布"}</span>
                  </button>
                `;
              }
            }
          }
        } catch (err) {
          console.error("[ComfyMate] Failed to undo params:", err);
        }
        return;
      }

      // 6. Doctor Card: Ask AI to Fix
      const askAiBtn = e.target.closest(".cm-doctor-btn-ask-ai");
      if (askAiBtn) {
        const prompt = this.t("promptDoctorFix") || "请针对体检报告中发现的工作流问题，分析根因并给出具体的参数优化与修复操作。";
        this.sendMessage(prompt);
        return;
      }

      // 7. Recommended Nodes Card: Add Node to Canvas button
      const addNodeBtn = e.target.closest(".cm-node-rec-btn-add");
      if (addNodeBtn) {
        const rawNodeType = addNodeBtn.getAttribute("data-node-type");
        const nodeType = decodeURIComponent(rawNodeType || "");
        if (nodeType) {
          const res = this.actions.addNodeToCanvas(nodeType);
          if (res.success) {
            addNodeBtn.classList.add("cm-added");
            addNodeBtn.innerHTML = `<span>✅</span> <span>${this.t("actionApplied") || "已添加"}</span>`;
            Toast.success(this.t("nodeAddedToCanvas", { name: res.nodeTitle }));
          } else {
            Toast.error(this.t("nodeAddFailed", { msg: res.message || "Failed to add node" }));
          }
        }
        return;
      }

      // 8. Connect Nodes Card: Connect button
      const connectBtn = e.target.closest(".cm-action-btn-connect");
      if (connectBtn) {
        const card = connectBtn.closest(".cm-action-card");
        const rawConns = decodeURIComponent(connectBtn.getAttribute("data-connections") || "[]");
        try {
          const connections = JSON.parse(rawConns);
          const res = this.actions.connectNodes(connections);
          if (res.success) {
            if (card) {
              const footer = card.querySelector(".cm-action-footer");
              if (footer) {
                const linksJson = encodeURIComponent(JSON.stringify(res.links));
                footer.innerHTML = `
                  <span class="cm-action-applied-badge">✅ ${this.t("connectionApplied") || "已连接"}</span>
                  <button class="cm-action-btn cm-action-btn-disconnect" type="button" data-links="${linksJson}">
                    <span>↩️</span> <span>${this.t("disconnectNodes") || "撤回连线"}</span>
                  </button>
                `;
              }
            }
            Toast.success(this.t("connectionSuccess") || "已成功连接节点端口");
          } else {
            const errMsg = (res.errors && res.errors[0]) || "Connection failed";
            Toast.error(this.t("connectionFailed", { msg: errMsg }));
          }
        } catch (err) {
          console.error("[ComfyMate] Failed to connect nodes:", err);
          Toast.error(this.t("connectionFailed", { msg: err.message }));
        }
        return;
      }

      // 9. Connect Nodes Card: Disconnect (Undo) button
      const disconnectBtn = e.target.closest(".cm-action-btn-disconnect");
      if (disconnectBtn) {
        const card = disconnectBtn.closest(".cm-action-card");
        const rawLinks = decodeURIComponent(disconnectBtn.getAttribute("data-links") || "[]");
        try {
          const links = JSON.parse(rawLinks);
          const res = this.actions.disconnectNodes(links);
          if (res.success) {
            if (card) {
              const footer = card.querySelector(".cm-action-footer");
              const origConnsJson = card.getAttribute("data-connections") || "[]";
              if (footer) {
                footer.innerHTML = `
                  <button class="cm-action-btn cm-action-btn-connect" type="button" data-connections="${origConnsJson}">
                    <span>🔗</span> <span>${this.t("connectNodes") || "一键连线"}</span>
                  </button>
                `;
              }
            }
            Toast.info(this.t("disconnectSuccess") || "已撤回节点连线");
          }
        } catch (err) {
          console.error("[ComfyMate] Failed to disconnect nodes:", err);
        }
        return;
      }

      // 10. Auto Layout Card: Apply Layout button
      const applyLayoutBtn = e.target.closest(".cm-action-btn-layout");
      if (applyLayoutBtn) {
        const card = applyLayoutBtn.closest(".cm-action-card");
        const scope = applyLayoutBtn.getAttribute("data-scope") || "all";
        const res = this.actions.autoLayout({ scope, animate: true });
        if (res.success) {
          if (card) {
            const footer = card.querySelector(".cm-action-footer");
            if (footer && res.oldPositions) {
              const oldPosJson = encodeURIComponent(JSON.stringify(res.oldPositions));
              footer.innerHTML = `
                <span class="cm-action-applied-badge">✅ ${this.t("layoutApplied") || "已规整"}</span>
                <button class="cm-action-btn cm-action-btn-undo-layout" type="button" data-old-positions="${oldPosJson}" data-scope="${scope}">
                  <span>↩️</span> <span>${this.t("undoLayout") || "撤回排版"}</span>
                </button>
              `;
            }
          }
          Toast.success(this.t("layoutSuccess", { n: res.nodeCount }) || `已成功按拓扑层级规整 ${res.nodeCount} 个节点排版`);
        } else {
          Toast.error(this.t("layoutFailed", { msg: res.message || "Layout failed" }));
        }
        return;
      }

      // 11. Auto Layout Card: Undo Layout button
      const undoLayoutBtn = e.target.closest(".cm-action-btn-undo-layout");
      if (undoLayoutBtn) {
        const card = undoLayoutBtn.closest(".cm-action-card");
        const rawOldPos = decodeURIComponent(undoLayoutBtn.getAttribute("data-old-positions") || "{}");
        const scope = undoLayoutBtn.getAttribute("data-scope") || "all";
        try {
          const oldPositions = JSON.parse(rawOldPos);
          const res = this.actions.undoLayout(oldPositions, true);
          if (res.success) {
            if (card) {
              const footer = card.querySelector(".cm-action-footer");
              if (footer) {
                footer.innerHTML = `
                  <button class="cm-action-btn cm-action-btn-layout" type="button" data-scope="${scope}">
                    <span>📐</span> <span>${this.t("applyLayout") || "一键整理排版"}</span>
                  </button>
                `;
              }
            }
            Toast.info(this.t("undoLayoutSuccess") || "已恢复原有节点排版");
          }
        } catch (err) {
          console.error("[ComfyMate] Failed to undo layout:", err);
        }
        return;
      }

      // 12. Queue Prompt Card: Run Test Generation button
      const queueBtn = e.target.closest(".cm-action-btn-queue");
      if (queueBtn) {
        const card = queueBtn.closest(".cm-action-card");
        const rawEvalPrompt = queueBtn.getAttribute("data-eval-prompt") || "";
        const evalPrompt = rawEvalPrompt ? decodeURIComponent(rawEvalPrompt) : "";
        this._handleQueuePrompt(card, evalPrompt);
        return;
      }

      // 13. Queue Prompt Card: Vision Evaluation button
      const evalBtn = e.target.closest(".cm-action-btn-eval");
      if (evalBtn) {
        const rawImgUrl = evalBtn.getAttribute("data-img-url") || "";
        const rawEvalPrompt = evalBtn.getAttribute("data-eval-prompt") || "";
        const imgUrl = rawImgUrl ? decodeURIComponent(rawImgUrl) : "";
        const evalPrompt = rawEvalPrompt ? decodeURIComponent(rawEvalPrompt) : "";
        this._handleVisionEval(imgUrl, evalPrompt);
        return;
      }

      // 14. Queue Prompt Card: Diagnose Execution Error button
      const diagBtn = e.target.closest(".cm-action-btn-diagnose");
      if (diagBtn) {
        const rawErr = decodeURIComponent(diagBtn.getAttribute("data-error") || "{}");
        try {
          const errObj = JSON.parse(rawErr);
          const prefix = this.t("diagnosePromptPrefix") || "工作流在执行时发生报错：";
          const errDetail = errObj.exception_message || errObj.message || "Unknown error";
          const tb = errObj.traceback ? `\n\`\`\`text\n${errObj.traceback}\n\`\`\`` : "";
          this.sendMessage(`${prefix}${errDetail}${tb}`);
        } catch (_) {
          this.sendMessage(this.t("promptDiagnoseErr"));
        }
        return;
      }

      // 15. Queue Prompt Result: View full generated image
      const imgCard = e.target.closest(".cm-queue-img-card");
      if (imgCard) {
        const url = imgCard.getAttribute("data-url");
        if (url) {
          this._openImagePopup(url);
        }
        return;
      }
    });
  }

  _handleAutoLayout() {
    const res = this.actions.autoLayout({ scope: "all", animate: true });
    if (res.success) {
      Toast.success(this.t("layoutSuccess", { n: res.nodeCount }) || `已成功按拓扑层级规整 ${res.nodeCount} 个节点排版`);
    } else {
      Toast.warning(res.message || this.t("layoutFailed", { msg: "" }));
    }
  }

  async _handleQueuePrompt(cardEl = null, evalPrompt = "") {
    if (this._isQueueRunning) {
      Toast.warning(this.t("runningQueue") || "执行生图中...");
      return;
    }

    this._isQueueRunning = true;
    Toast.info(this.t("queueStartedToast") || "已提交出图任务至队列");

    let statusBadge = cardEl?.querySelector(".cm-queue-status-badge");
    let progressContainer = cardEl?.querySelector(".cm-queue-progress-container");
    let progressFill = cardEl?.querySelector(".cm-queue-progress-fill");
    let progressText = cardEl?.querySelector(".cm-queue-progress-text");
    let progressPercent = cardEl?.querySelector(".cm-queue-progress-percent");
    let resultContainer = cardEl?.querySelector(".cm-queue-result-container");
    let footer = cardEl?.querySelector(".cm-action-footer");
    let queueBtn = cardEl?.querySelector(".cm-action-btn-queue");

    if (queueBtn) {
      queueBtn.disabled = true;
      queueBtn.innerHTML = `<span>⏳</span> <span>${this.t("runningQueue") || "执行生图中..."}</span>`;
    }

    if (statusBadge) {
      statusBadge.className = "cm-queue-status-badge cm-queue-status-running";
      statusBadge.textContent = this.t("queueQueued") || "排队中...";
    }

    if (progressContainer) {
      progressContainer.classList.remove("hidden");
    }

    const res = await this.actions.queuePrompt({
      onStatusChange: (status, meta) => {
        if (status === "executing" && statusBadge) {
          statusBadge.textContent = meta?.nodeTitle
            ? `${this.t("runningQueue") || "生图中"}: ${meta.nodeTitle}`
            : (this.t("runningQueue") || "生图中...");
        }
      },
      onProgress: ({ percent, nodeTitle }) => {
        if (progressFill) progressFill.style.width = `${percent}%`;
        if (progressPercent) progressPercent.textContent = `${percent}%`;
        if (progressText) {
          progressText.textContent = nodeTitle
            ? `${nodeTitle} (${percent}%)`
            : `${percent}%`;
        }
      },
      onComplete: async ({ images, durationMs }) => {
        this._isQueueRunning = false;
        Toast.success(this.t("queueSuccessToast") || "工作流出图已完成！");

        const sec = Math.round(durationMs / 1000);
        if (statusBadge) {
          statusBadge.className = "cm-queue-status-badge cm-queue-status-completed";
          statusBadge.textContent = `✅ ${this.t("queueSuccess") || "出图完成"} (${sec}s)`;
        }

        if (progressContainer) {
          progressContainer.classList.add("hidden");
        }

        if (resultContainer && images && images.length > 0) {
          resultContainer.classList.remove("hidden");
          const imgCards = images.map((img) => `
            <div class="cm-queue-img-card" data-url="${img.url}">
              <img src="${img.url}" alt="${img.filename}" title="${this.t("viewGeneratedImage") || "查看生成大图"}" />
            </div>
          `).join("");

          resultContainer.innerHTML = `
            <div class="cm-queue-images-grid">${imgCards}</div>
          `;
        }

        if (footer) {
          const firstImgUrl = images?.[0]?.url || "";
          const safeEvalPrompt = evalPrompt || this.t("evalPromptDefault") || "请对刚才生成的图片进行多模态审美与质量评估，检查构图、细节、光影、肢体结构，并给出具体的参数微调建议。";
          const encodedEvalPrompt = encodeURIComponent(safeEvalPrompt);
          const encodedImgUrl = encodeURIComponent(firstImgUrl);

          footer.innerHTML = `
            <button class="cm-action-btn cm-action-btn-eval" type="button" data-img-url="${encodedImgUrl}" data-eval-prompt="${encodedEvalPrompt}">
              <span>🔍</span> <span>${this.t("visionEvalBtn") || "视觉多模态评估"}</span>
            </button>
            <button class="cm-action-btn cm-action-btn-queue" type="button" data-eval-prompt="${encodeURIComponent(evalPrompt || "")}">
              <span>🚀</span> <span>${this.t("runQueue") || "再次出图"}</span>
            </button>
          `;
        }

        if (!cardEl) {
          this._postQueueCompletionMessage(images, durationMs, evalPrompt);
        }
      },
      onError: (errPayload) => {
        this._isQueueRunning = false;
        const msg = errPayload.exception_message || errPayload.message || "Execution error";
        Toast.error(this.t("queueFailedToast", { msg }));

        if (statusBadge) {
          statusBadge.className = "cm-queue-status-badge cm-queue-status-error";
          statusBadge.textContent = `❌ ${this.t("queueFailed") || "出图失败"}`;
        }

        if (progressContainer) {
          progressContainer.classList.add("hidden");
        }

        if (footer) {
          const rawErr = encodeURIComponent(JSON.stringify(errPayload));
          footer.innerHTML = `
            <button class="cm-action-btn cm-action-btn-diagnose" type="button" data-error="${rawErr}">
              <span>🔧</span> <span>${this.t("diagnoseErrorBtn") || "诊断报错原因"}</span>
            </button>
            <button class="cm-action-btn cm-action-btn-queue" type="button" data-eval-prompt="${encodeURIComponent(evalPrompt || "")}">
              <span>🚀</span> <span>${this.t("runQueue") || "重新测试"}</span>
            </button>
          `;
        }
      },
    });

    if (!res.success) {
      this._isQueueRunning = false;
      if (queueBtn) queueBtn.disabled = false;
      Toast.error(this.t("queueFailedToast", { msg: res.error?.message || "Failed to trigger queue" }));
    }
  }

  async _handleVisionEval(imgUrl, evalPrompt) {
    if (!imgUrl) return;
    try {
      const dataUrl = await this.actions.queueRunner.fetchImageAsDataUrl(imgUrl);
      if (dataUrl) {
        this.attachedImages.push({
          dataUrl,
          name: "output_eval.png",
          localUrl: imgUrl,
        });
        this._renderAttachedImages();
      }
      const promptText = evalPrompt || this.t("evalPromptDefault") || "请对刚才生成的图片进行多模态审美与质量评估，检查构图、细节、光影、肢体结构，并给出具体的参数微调建议。";
      this.sendMessage(promptText);
    } catch (err) {
      console.warn("[ComfyMate] Failed to attach image for vision eval:", err);
      this.sendMessage(evalPrompt || this.t("evalPromptDefault"));
    }
  }

  _postQueueCompletionMessage(images, durationMs, evalPrompt) {
    const sec = Math.round(durationMs / 1000);
    const imgItems = (images || []).map((img) => `
      <div class="cm-queue-img-card" data-url="${img.url}">
        <img src="${img.url}" alt="${img.filename}" title="${this.t("viewGeneratedImage") || "查看生成大图"}" />
      </div>
    `).join("");

    const firstImgUrl = images?.[0]?.url || "";
    const safeEvalPrompt = evalPrompt || this.t("evalPromptDefault") || "请对刚才生成的图片进行多模态审美与质量评估，检查构图、细节、光影、肢体结构，并给出具体的参数微调建议。";
    const encodedEvalPrompt = encodeURIComponent(safeEvalPrompt);
    const encodedImgUrl = encodeURIComponent(firstImgUrl);

    const msgHtml = `
      <div class="cm-action-card cm-queue-card" data-action="queue_prompt">
        <div class="cm-action-header">
          <div class="cm-action-title">
            <span class="cm-action-icon">🚀</span>
            <span>${this.t("queuePromptTitle") || "闭环测试出图"}</span>
          </div>
          <span class="cm-queue-status-badge cm-queue-status-completed">✅ ${this.t("queueSuccess") || "出图完成"} (${sec}s)</span>
        </div>
        <div class="cm-action-body">
          <div class="cm-queue-result-container">
            <div class="cm-queue-images-grid">${imgItems}</div>
          </div>
        </div>
        <div class="cm-action-footer">
          <button class="cm-action-btn cm-action-btn-eval" type="button" data-img-url="${encodedImgUrl}" data-eval-prompt="${encodedEvalPrompt}">
            <span>🔍</span> <span>${this.t("visionEvalBtn") || "视觉多模态评估"}</span>
          </button>
        </div>
      </div>
    `;

    const messagesContainer = this.panel.querySelector("#cm-messages");
    const msgDiv = document.createElement("div");
    msgDiv.className = "comfymate-message assistant";
    msgDiv.innerHTML = msgHtml;
    messagesContainer.appendChild(msgDiv);
    this._scrollToBottom();

    this.messages.push({
      role: "assistant",
      content: `🚀 **${this.t("queuePromptTitle") || "闭环测试出图"}**：出图完成 (${sec}s)，生成了 ${(images || []).length} 张图像。`,
    });
    this._saveCurrentSession();
  }

  _openImagePopup(imgUrl) {
    if (!imgUrl) return;
    const w = window.open("");
    if (w && w.document) {
      w.document.title = "ComfyMate Image Viewer";
      const body = w.document.body;
      body.style.cssText = "margin:0; background:#09090b; display:flex; align-items:center; justify-content:center; min-height:100vh;";
      const fullImg = w.document.createElement("img");
      fullImg.src = imgUrl;
      fullImg.style.cssText = "max-width:100%; max-height:100vh; object-fit:contain;";
      body.appendChild(fullImg);
    }
  }

  async toggle(forceState) {
    await this.ready;
    this.isVisible = forceState !== undefined ? forceState : !this.isVisible;
    if (this.isVisible) {
      this.panel.classList.remove("hidden");
      if (!this.config) {
        this._loadConfig();
      } else {
        this._renderModelSelector();
      }
      // Immediately verify and bind current active workflow tab
      const wf = this.extractor.getCurrentWorkflowInfo();
      if (wf && wf.name) {
        if (!this.activeWorkflow || this.activeWorkflow.name !== wf.name) {
          await this._handleWorkflowTabSelected(wf);
        } else {
          this._updateHeaderWorkflowBadge();
        }
      } else {
        this._checkWorkflowChange();
        this._updateHeaderWorkflowBadge();
      }
      this.panel.querySelector("#cm-input")?.focus();
    } else {
      this.panel.classList.add("hidden");
    }
  }

  _startContextSync() {
    if (this._contextInterval) {
      clearInterval(this._contextInterval);
    }
    this._contextInterval = setInterval(() => {
      // Keep workflow active state synchronized in background so drawer is never stale
      this._checkWorkflowChange();

      if (!this.isVisible) return;

      const summary = this.extractor.getWorkflowSummary();
      const selected = this.extractor.getSelectedNodes();
      const lastError = this.extractor.lastError;

      this._updateHeaderWorkflowBadge();

      const tagSel = this.panel.querySelector("#cm-tag-selected");
      if (selected.length > 0) {
        tagSel.style.display = "inline-flex";
        tagSel.textContent = this.t("selectedNodes", {
          n: `${selected.length} (${selected.map((n) => n.title).join(", ")})`,
        });
      } else {
        tagSel.style.display = "none";
      }

      const tagErr = this.panel.querySelector("#cm-tag-error");
      if (lastError) {
        tagErr.style.display = "inline-flex";
        tagErr.textContent = `🚨 #${lastError.node_id || "?"}`;
      } else {
        tagErr.style.display = "none";
      }
    }, 600);
  }

  stopGeneration() {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    this._setStreamingState(false);
  }

  _setStreamingState(streaming) {
    this.isStreaming = streaming;
    const sendBtn = this.panel.querySelector("#cm-btn-send");
    if (streaming) {
      sendBtn.textContent = this.t("stop");
      sendBtn.classList.add("stop");
    } else {
      sendBtn.textContent = this.t("send");
      sendBtn.classList.remove("stop");
    }
  }

  /* ---------------- Vision / Image Handling ---------------- */

  _handlePaste(e) {
    const now = Date.now();
    if (this._lastPasteTime && now - this._lastPasteTime < 120) {
      return;
    }

    const clipboardData = e.clipboardData || window.clipboardData;
    if (!clipboardData) return;

    const files = clipboardData.files;
    let imageFiles = [];

    if (files && files.length > 0) {
      for (const file of files) {
        if (file.type && file.type.startsWith("image/")) {
          imageFiles.push(file);
        }
      }
    }

    if (imageFiles.length === 0 && clipboardData.items) {
      for (const item of clipboardData.items) {
        if (item.kind === "file" && item.type && item.type.startsWith("image/")) {
          const file = item.getAsFile();
          if (file) {
            imageFiles.push(file);
          }
        }
      }
    }

    if (imageFiles.length > 0) {
      this._lastPasteTime = now;
      e.preventDefault();
      for (const file of imageFiles) {
        this._addAttachedImage(file);
      }
    }
  }

  async _addAttachedImage(file) {
    if (this.attachedImages.length >= 4) {
      Toast.warning(this.t("maxImagesReached") || "最多支持同时附加 4 张图片");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      Toast.warning(this.t("imageTooLarge") || "图片大小不能超过 10MB");
      return;
    }

    try {
      const dataUrl = await this._processImageFile(file);
      // Guard against duplicate image
      if (this.attachedImages.some((img) => img.dataUrl === dataUrl)) {
        return;
      }
      const imgItem = {
        dataUrl,
        name: file.name || "pasted_image.png",
        localUrl: null,
      };
      this.attachedImages.push(imgItem);
      this._renderAttachedImages();

      // Asynchronously upload to local storage backend to avoid LocalStorage quota limits
      ApiClient.uploadAttachment({
        dataUrl,
        filename: file.name || "pasted_image.png",
      }).then((res) => {
        if (res && res.status === "ok" && res.url) {
          imgItem.localUrl = res.url;
        }
      }).catch((err) => {
        console.warn("[ComfyMate] Failed to save attachment to local disk, falling back to dataUrl:", err);
      });
    } catch (err) {
      console.warn("[ComfyMate] Error processing image:", err);
    }
  }

  _processImageFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          // Downscale to max 1280px to optimize tokens, speed and storage
          const maxDim = 1280;
          let w = img.width;
          let h = img.height;
          if (!w || !h) {
            resolve(e.target.result);
            return;
          }
          if (w > maxDim || h > maxDim) {
            if (w > h) {
              h = Math.round((h * maxDim) / w);
              w = maxDim;
            } else {
              w = Math.round((w * maxDim) / h);
              h = maxDim;
            }
          }
          const canvas = document.createElement("canvas");
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext("2d");
          ctx.drawImage(img, 0, 0, w, h);
          const compressedUrl = canvas.toDataURL("image/jpeg", 0.88);
          resolve(compressedUrl);
        };
        img.onerror = () => resolve(e.target.result);
        img.src = e.target.result;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  _renderAttachedImages() {
    const previewBar = this.panel.querySelector("#cm-image-preview-bar");
    if (!previewBar) return;

    if (this.attachedImages.length === 0) {
      previewBar.style.display = "none";
      previewBar.innerHTML = "";
      return;
    }

    previewBar.style.display = "flex";
    previewBar.innerHTML = this.attachedImages
      .map(
        (img, idx) => `
        <div class="cm-img-preview-card">
          <img src="${img.dataUrl}" class="cm-img-preview-thumb" alt="preview" />
          <button type="button" class="cm-img-preview-remove" data-idx="${idx}" title="${this.t('removeImage') || '移除图片'}">✕</button>
        </div>
      `
      )
      .join("");
  }

  async sendMessage(customText = null) {
    await this.ready;
    if (this.isStreaming) return;

    const input = this.panel.querySelector("#cm-input");
    const rawText = (customText || input.value).trim();
    // Prioritize persistent local storage URLs to keep localStorage usage under a few KB
    const imagesToSend = [...this.attachedImages.map((img) => img.localUrl || img.dataUrl)];

    if (!rawText && imagesToSend.length === 0) return;

    const text = rawText || (imagesToSend.length > 0 ? (this.t("defaultImagePrompt") || "请结合当前工作流分析这张图片") : "");

    if (!customText) {
      input.value = "";
      input.style.height = "";
      this.attachedImages = [];
      this._renderAttachedImages();
    }

    this._setStreamingState(true);
    this._appendMessage("user", text, imagesToSend);
    this.messages.push({
      role: "user",
      content: text,
      images: imagesToSend.length > 0 ? imagesToSend : undefined,
    });
    this._saveCurrentSession();


    const configuredProviders = (this.config?.providers || []).filter((p) => this._isProviderConfigured(p));
    if (configuredProviders.length === 0) {
      this._setStreamingState(false);
      const assistantDiv = this._appendMessage("assistant", "");
      const contentBox = document.createElement("div");
      contentBox.className = "cm-markdown-body";
      contentBox.innerHTML = `
        <div style="background:rgba(239,68,68,0.1); border:1px solid rgba(239,68,68,0.3); border-radius:10px; padding:12px 14px; margin-top:4px; display:flex; flex-direction:column; gap:10px; align-items:flex-start; width:100%; box-sizing:border-box;">
          <div style="font-size:12.5px; line-height:1.5;">
            <div style="font-weight:600; color:#f87171; margin-bottom:3px;">${this.t("noConfiguredModels")}</div>
            <div style="color:#e4e4e7;">${this.t("unconfiguredSendTip")}</div>
          </div>
          <button class="comfymate-send-btn" id="cm-btn-send-config" style="padding:6px 14px; font-size:12px; cursor:pointer; align-self:flex-start;">⚙️ ${this.t("goToSettings")}</button>
        </div>
      `;
      assistantDiv.appendChild(contentBox);
      const btn = contentBox.querySelector("#cm-btn-send-config");
      if (btn) btn.onclick = () => this.openSettings();
      this._scrollToBottom();
      return;
    }

    const context = this.extractor.captureContext();

    const assistantDiv = this._appendMessage("assistant", "");

    // 1. Collapsible Thinking Accordion (default collapsed, no 'open' attribute)
    const thinkingBox = document.createElement("details");
    thinkingBox.className = "cm-thinking";
    thinkingBox.style.display = "none";
    thinkingBox.innerHTML = `
      <summary class="cm-thinking-header">
        <span class="cm-thinking-icon">💭</span>
        <span class="cm-thinking-status">${this.t("thinkingProcess")}</span>
        <span class="cm-thinking-arrow">›</span>
      </summary>
      <div class="cm-thinking-body"></div>
    `;

    // 2. Typing / Pulsing loading indicator (shown while waiting for first response)
    const typingIndicator = document.createElement("div");
    typingIndicator.className = "cm-typing-indicator";
    typingIndicator.innerHTML = `
      <span class="cm-typing-dot"></span>
      <span class="cm-typing-dot"></span>
      <span class="cm-typing-dot"></span>
      <span class="cm-typing-text">${this.t("thinkingOngoing") || "正在思考..."}</span>
    `;

    // 3. Main markdown content box
    const contentBox = document.createElement("div");
    contentBox.className = "cm-markdown-body";

    assistantDiv.appendChild(thinkingBox);
    assistantDiv.appendChild(typingIndicator);
    assistantDiv.appendChild(contentBox);

    this._setStreamingState(true);
    this.abortController = new AbortController();
    const request = {
      controller: this.abortController,
      sessionId: this.currentSessionId,
      workflowName: this.activeWorkflow?.name || "",
      messages: this.messages,
    };
    this._activeChatRequest = request;
    const ownsRequest = () => this._activeChatRequest === request
      && this.currentSessionId === request.sessionId
      && (this.activeWorkflow?.name || "") === request.workflowName
      && this.messages === request.messages;


    const startTime = Date.now();
    let fullRawContent = "";
    let fullAnswer = "";
    let fullThinking = "";
    let hasError = false;
    let errorMessage = "";
    const activeModelVal = this.panel.querySelector("#cm-active-model-select").value;
    let modelOverride = {};
    if (activeModelVal) {
      const sepIdx = activeModelVal.indexOf("::");
      if (sepIdx !== -1) {
        const pid = activeModelVal.substring(0, sepIdx);
        const m = activeModelVal.substring(sepIdx + 2);
        modelOverride = { provider_id: pid, model: m };
      }
    }

    try {
      await ApiClient.streamChat({
        messages: request.messages,
        context: context,
        model_config: modelOverride,
        language: this._getEffectiveLang(),
        signal: request.controller.signal,
        onEvent: (event) => {
          if (!ownsRequest() || request.controller.signal.aborted) return;
          if (event.type === "thinking") {
            thinkingBox.style.display = "block";
            fullThinking += event.text;
            thinkingBox.querySelector(".cm-thinking-body").textContent = fullThinking;
            const elapsed = Math.max(1, Math.round((Date.now() - startTime) / 1000));
            thinkingBox.querySelector(".cm-thinking-status").textContent = `${this.t("thinkingProcess")} (${elapsed}s)`;
            this._scrollToBottom();
          } else if (event.type === "content") {
            fullRawContent += event.text;

            // Extract potential <think>...</think> tags if model emitted them directly in text
            let currentThinking = fullThinking;
            let currentAnswer = fullRawContent;

            const closeThinkIdx = fullRawContent.indexOf("</think>");
            if (closeThinkIdx !== -1) {
              const startThink = fullRawContent.startsWith("<think>") ? 7 : 0;
              const thinkPart = fullRawContent.slice(startThink, closeThinkIdx).trim();
              currentThinking = (fullThinking ? fullThinking + "\n" : "") + thinkPart;
              currentAnswer = fullRawContent.slice(closeThinkIdx + 8).trimStart();
            } else if (fullRawContent.startsWith("<think>")) {
              currentThinking = (fullThinking ? fullThinking + "\n" : "") + fullRawContent.slice(7).trim();
              currentAnswer = "";
            }

            if (currentThinking) {
              thinkingBox.style.display = "block";
              thinkingBox.querySelector(".cm-thinking-body").textContent = currentThinking;
              if (currentAnswer) {
                thinkingBox.querySelector(".cm-thinking-status").textContent = this.t("thinkingDone");
              } else {
                const elapsed = Math.max(1, Math.round((Date.now() - startTime) / 1000));
                thinkingBox.querySelector(".cm-thinking-status").textContent = `${this.t("thinkingProcess")} (${elapsed}s)`;
              }
            }

            if (currentAnswer) {
              if (typingIndicator.parentNode) typingIndicator.remove();
              fullAnswer = currentAnswer;
              contentBox.innerHTML = renderMarkdown(fullAnswer, (k) => this.t(k)) + '<span class="cm-cursor"></span>';
            } else if (currentThinking) {
              const typingText = typingIndicator.querySelector(".cm-typing-text");
              if (typingText) typingText.textContent = this.t("thinkingOngoing") || "正在思考...";
            }
            this._scrollToBottom();
          } else if (event.type === "error") {
            hasError = true;
            errorMessage = event.text;
            if (typingIndicator.parentNode) typingIndicator.remove();
            const errTitle = (this.t("errorDetected") || "调用报错").replace(/^[🚨\s]+/u, "");
            contentBox.innerHTML = `
              <div class="cm-chat-error-card" style="padding:10px 14px; background:rgba(239,68,68,0.12); border:1px solid rgba(239,68,68,0.35); border-radius:8px; color:#fca5a5; font-size:12.5px; line-height:1.5;">
                <div style="font-weight:600; color:#ef4444; margin-bottom:4px; display:flex; align-items:center; gap:6px;">
                  <span>🚨</span> <span>${escapeHtml(errTitle)}</span>
                </div>
                <div style="white-space:pre-wrap; word-break:break-word;">${escapeHtml(event.text)}</div>
              </div>
            `;
            this._scrollToBottom();
          }
        },
      });

      if (!ownsRequest() || request.controller.signal.aborted) return;
      if (!hasError) {
        if (typingIndicator.parentNode) typingIndicator.remove();

        // Final extraction of <think>...</think> if needed
        let finalThinking = fullThinking;
        let finalAnswer = fullAnswer || fullRawContent;

        const closeThinkIdx = fullRawContent.indexOf("</think>");
        if (closeThinkIdx !== -1) {
          const startThink = fullRawContent.startsWith("<think>") ? 7 : 0;
          const thinkPart = fullRawContent.slice(startThink, closeThinkIdx).trim();
          finalThinking = (fullThinking ? fullThinking + "\n" : "") + thinkPart;
          finalAnswer = fullRawContent.slice(closeThinkIdx + 8).trimStart();
        }

        if (finalThinking) {
          thinkingBox.style.display = "block";
          thinkingBox.querySelector(".cm-thinking-body").textContent = finalThinking;
          thinkingBox.querySelector(".cm-thinking-status").textContent = this.t("thinkingDone");
          // Ensure it stays collapsed by default
          thinkingBox.removeAttribute("open");
        }

        if (!finalAnswer && finalThinking) {
          finalAnswer = finalThinking;
        }

        if (finalAnswer) {
          contentBox.innerHTML = renderMarkdown(finalAnswer, (k) => this.t(k));
          this.messages.push({
            role: "assistant",
            content: finalAnswer,
            thinking: finalThinking || undefined,
          });
          this._saveCurrentSession();
        } else {
          contentBox.innerHTML = `<span style="color:#a1a1aa; font-style:italic;">${this.t("emptyReplyNotice")}</span>`;
        }
      }
    } catch (err) {
      if (!ownsRequest()) return;
      if (typingIndicator.parentNode) typingIndicator.remove();
      if (err.name === "AbortError") {
        contentBox.innerHTML = renderMarkdown(fullAnswer, (k) => this.t(k)) + ` <i style="color:#71717a;">(${this.t("generationStopped")})</i>`;
      } else {
        contentBox.innerHTML = `
          <div class="cm-chat-error-card" style="padding:10px 14px; background:rgba(239,68,68,0.12); border:1px solid rgba(239,68,68,0.35); border-radius:8px; color:#fca5a5; font-size:12.5px; line-height:1.5;">
            <div style="font-weight:600; color:#ef4444; margin-bottom:4px;">🚨 ${this.t("networkError")}</div>
            <div style="white-space:pre-wrap; word-break:break-word;">${escapeHtml(err.message)}</div>
          </div>
        `;
      }
    } finally {
      if (typingIndicator.parentNode) typingIndicator.remove();
      if (this._activeChatRequest === request) {
        this._activeChatRequest = null;
        this._setStreamingState(false);
        this.abortController = null;
        this._scrollToBottom();
      }
    }
  }

  _appendMessage(role, text, images = []) {
    const messagesContainer = this.panel.querySelector("#cm-messages");
    const welcomeMsg = this.panel.querySelector("#cm-welcome-msg");
    if (welcomeMsg) {
      welcomeMsg.remove();
    }
    const msgDiv = document.createElement("div");
    msgDiv.className = `comfymate-message ${role}`;

    if (role === "user") {
      if (images && images.length > 0) {
        const imgContainer = document.createElement("div");
        imgContainer.className = "cm-msg-images";
        for (const imgUrl of images) {
          const imgEl = document.createElement("img");
          imgEl.src = imgUrl;
          imgEl.className = "cm-msg-image";
          imgEl.alt = "attached image";
          imgEl.title = this.t("viewFullImage") || "点击查看大图";
          imgEl.addEventListener("click", () => {
            const w = window.open("");
            if (w && w.document) {
              w.document.title = "ComfyMate Image Viewer";
              const body = w.document.body;
              body.style.cssText = "margin:0; background:#09090b; display:flex; align-items:center; justify-content:center; min-height:100vh;";
              const fullImg = w.document.createElement("img");
              fullImg.src = imgUrl;
              fullImg.style.cssText = "max-width:100%; max-height:100vh; object-fit:contain;";
              body.appendChild(fullImg);
            }
          });
          imgContainer.appendChild(imgEl);
        }
        msgDiv.appendChild(imgContainer);
      }
      if (text) {
        const textSpan = document.createElement("span");
        textSpan.textContent = text;
        msgDiv.appendChild(textSpan);
      }
    } else if (role === "assistant" && text) {
      const contentBox = document.createElement("div");
      contentBox.className = "cm-markdown-body";
      contentBox.innerHTML = renderMarkdown(text, (k) => this.t(k));
      msgDiv.appendChild(contentBox);
      this.messages.push({ role: "assistant", content: text });
      this._saveCurrentSession();
    }
    messagesContainer.appendChild(msgDiv);
    this._scrollToBottom();
    return msgDiv;
  }

  _scrollToBottom() {
    const messagesContainer = this.panel.querySelector("#cm-messages");
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }

  /* ---------------- Workflow & Canvas Synchronization ---------------- */

  _initWorkflowTracker() {
    // 1. Listen for user tab clicks on ComfyUI top tab bar (PrimeVue togglebuttons, Radix tabs, etc.)
    document.addEventListener("click", (e) => {
      const tabTarget = e.target.closest(
        '.workflow-tab, [data-testid*="workflow-tab"], [data-testid="workflow-tab-strip"] [role="tab"], .workflow-tabs [role="tab"], .workflow-tabs-container [role="tab"], .p-togglebutton, .workflow-tabs .p-button, .workflow-tabs button'
      );
      if (tabTarget) {
        // Exclude close button clicks
        if (e.target.closest('[data-testid="close-workflow-button"], .close-button, button.close')) {
          return;
        }

        let clickedName = this.extractor._extractTabName(tabTarget);
        if (clickedName) {
          console.log("[ComfyMate] User clicked workflow tab directly:", clickedName);
          const path = tabTarget.getAttribute('data-value') || tabTarget.getAttribute('value') || clickedName;
          this._handleWorkflowTabSelected({ id: path || clickedName, name: clickedName, path: path || clickedName });
        }
        setTimeout(() => {
          this.onGraphOrWorkflowChanged();
        }, 60);
      }
    }, true);

    // 2. Observe DOM mutations on tab attributes or active state changes (including child insertions)
    try {
      const observer = new MutationObserver((mutations) => {
        let shouldCheck = false;
        for (const m of mutations) {
          if (m.type === "attributes") {
            const target = m.target;
            if (target && (
              target.classList?.contains("p-togglebutton") ||
              target.classList?.contains("workflow-tab") ||
              target.getAttribute?.("role") === "tab" ||
              target.closest?.(".workflow-tabs, [data-testid*='workflow-tab'], .p-togglebutton, .top-bar, .comfy-menu")
            )) {
              shouldCheck = true;
              break;
            }
          } else if (m.type === "childList") {
            for (const node of m.addedNodes) {
              if (node.nodeType === 1) { // Node.ELEMENT_NODE
                if (
                  node.classList?.contains("p-togglebutton") ||
                  node.classList?.contains("workflow-tab") ||
                  node.classList?.contains("workflow-tabs") ||
                  node.querySelector?.(".p-togglebutton, .workflow-tab, [data-testid*='workflow-tab'], .close-button")
                ) {
                  shouldCheck = true;
                  break;
                }
              }
            }
            if (shouldCheck) break;
          }
        }
        if (shouldCheck) {
          this.onGraphOrWorkflowChanged();
        }
      });
      observer.observe(document.body, {
        attributes: true,
        childList: true,
        subtree: true,
        attributeFilter: ["data-state", "aria-selected", "aria-pressed", "data-p-checked", "class"],
      });
      this._workflowObserver = observer;
    } catch (e) {
      console.warn("[ComfyMate] Could not initialize workflow tab observer:", e);
    }
  }

  _startBootWorkflowWatcher() {
    if (this._bootWatcherTimer) {
      clearInterval(this._bootWatcherTimer);
    }
    let checks = 0;
    const maxChecks = 35; // 35 * 200ms = 7 seconds of boot watching
    this._bootWatcherTimer = setInterval(async () => {
      checks++;
      const currentWf = this.extractor?.getCurrentWorkflowInfo();
      if (currentWf && currentWf.name) {
        clearInterval(this._bootWatcherTimer);
        this._bootWatcherTimer = null;

        // If we restored messages during boot and current workflow tab just finished mounting:
        if (this.messages && this.messages.length > 0) {
          this._isBootRestoring = false;
          this.activeWorkflow = currentWf;
          this._lastWorkflowKey = currentWf.name;
          this._updateHeaderWorkflowBadge();
          if (this.currentSessionId) {
            this._workflowChatCache[currentWf.name] = {
              sessionId: this.currentSessionId,
              title: this.currentSessionTitle,
              messages: [...this.messages],
            };
            // Ensure disk session file has workflow_name recorded
            this._saveCurrentSession(currentWf.name, this.currentSessionId, this.messages, this.currentSessionTitle);
          }
          return;
        }

        if (!this.activeWorkflow || this.activeWorkflow.name !== currentWf.name) {
          console.log("[ComfyMate] Boot workflow watcher auto-detected active workflow:", currentWf.name);
          await this._handleWorkflowTabSelected(currentWf);
          return;
        } else {
          this._updateHeaderWorkflowBadge();
          return;
        }
      }
      if (checks >= maxChecks) {
        this._isBootRestoring = false;
        clearInterval(this._bootWatcherTimer);
        this._bootWatcherTimer = null;
      }
    }, 200);
  }

  async _handleWorkflowTabSelected(wf) {
    if (!wf || !wf.name) return;
    if (this.isStreaming) return;
    if (this._lastWorkflowKey === wf.name && this.activeWorkflow?.name === wf.name) return;

    const prevKey = this._lastWorkflowKey;
    const syncEnabled = this.config?.sync_workflow_chat !== false;
    if (syncEnabled) {
      await this._switchWorkflowChat(wf, prevKey);
    } else {
      this.activeWorkflow = wf;
      this._lastWorkflowKey = wf.name;
      this._updateHeaderWorkflowBadge();
    }
  }

  onGraphOrWorkflowChanged() {
    if (this._workflowCheckTimer) {
      clearTimeout(this._workflowCheckTimer);
    }
    this._workflowCheckTimer = setTimeout(() => {
      this._checkWorkflowChange();
    }, 60);
  }

  async _checkWorkflowChange() {
    if (this.isStreaming) {
      return;
    }
    const wf = this.extractor.getCurrentWorkflowInfo();
    const currentKey = wf ? wf.name : null;

    if (currentKey && currentKey !== this._lastWorkflowKey) {
      const prevKey = this._lastWorkflowKey;
      const syncEnabled = this.config?.sync_workflow_chat !== false;
      if (syncEnabled && wf) {
        await this._switchWorkflowChat(wf, prevKey);
      } else {
        this.activeWorkflow = wf;
        this._lastWorkflowKey = currentKey;
        this._updateHeaderWorkflowBadge();
      }
    } else if (wf && (!this.activeWorkflow || this.activeWorkflow.name !== wf.name)) {
      this.activeWorkflow = wf;
      this._updateHeaderWorkflowBadge();
    }
  }

  _updateHeaderWorkflowBadge() {
    if (!this.panel) return;
    const tagWf = this.panel.querySelector("#cm-tag-workflow");
    if (tagWf) {
      const summary = this.extractor?.getWorkflowSummary();
      const nodeCount = summary ? summary.total_nodes : 0;
      const wfInfo = this.activeWorkflow || this.extractor?.getCurrentWorkflowInfo();
      if (wfInfo && wfInfo.name) {
        if (!this.activeWorkflow) this.activeWorkflow = wfInfo;
        const countText = this.t("wfNodes", { n: nodeCount }) || `${nodeCount} 节点`;
        const nodeUnit = countText.replace(/^[^:]*:\s*/, "") || `${nodeCount} 节点`;
        tagWf.textContent = `🎨 ${wfInfo.name} (${nodeUnit})`;
        tagWf.title = `${this.t("linkedWorkflowTip") || "当前对话已与此画布工作流绑定"}: ${wfInfo.name}`;
      } else {
        tagWf.textContent = this.t("wfNodes", { n: nodeCount });
        tagWf.title = "";
      }
    }
  }

  async _switchWorkflowChat(wf, prevKey) {
    if (!wf || !wf.name) return;
    this.stopGeneration();
    const newWfName = wf.name;

    // Increment switch token to invalidate any previous in-flight switch requests
    this._switchGenerationToken = (this._switchGenerationToken || 0) + 1;
    const switchToken = this._switchGenerationToken;

    // 1. Preserve input draft for previous workflow
    const inputEl = this.panel?.querySelector("#cm-input");
    if (inputEl && prevKey) {
      const currentVal = inputEl.value;
      if (currentVal && currentVal.trim()) {
        this._workflowDrafts[prevKey] = currentVal;
      } else {
        delete this._workflowDrafts[prevKey];
      }
    }

    // 2. Commit previous workflow session immediately before mutating pointers
    if (prevKey && this.messages && this.messages.length > 0) {
      const prevSessionId = this.currentSessionId;
      const prevTitle = this.currentSessionTitle;
      const prevMessages = [...this.messages];

      // Stash in-memory cache for instant switching
      this._workflowChatCache[prevKey] = {
        sessionId: prevSessionId,
        title: prevTitle,
        messages: prevMessages,
      };

      // Persist to server local JSON file (detached)
      this._saveCurrentSession(prevKey, prevSessionId, prevMessages, prevTitle);
    }

    // 3. Immediately update active workflow pointer and badge
    this.activeWorkflow = wf;
    this._lastWorkflowKey = newWfName;
    this._updateHeaderWorkflowBadge();

    // 4. Synchronously switch view if in-memory cache exists
    if (this._workflowChatCache[newWfName]) {
      const cached = this._workflowChatCache[newWfName];
      this.currentSessionId = cached.sessionId;
      this.currentSessionTitle = cached.title || newWfName;
      this.messages = [...cached.messages];
      this._renderMessages(this.messages);
      if (inputEl) inputEl.value = this._workflowDrafts[newWfName] || "";
      return;
    }

    // Only clear messages if prevKey is non-null (actual tab switch by user)
    // or if we have no messages currently loaded
    if (prevKey !== null || !this.messages || this.messages.length === 0) {
      this.messages = [];
      this.currentSessionId = null;
      this.currentSessionTitle = newWfName;
      const messagesContainer = this.panel?.querySelector("#cm-messages");
      if (messagesContainer) {
        messagesContainer.innerHTML = `
          <div class="comfymate-message assistant" id="cm-welcome-msg"></div>
        `;
      }
      this._updateStaticUIText();
      if (inputEl) inputEl.value = this._workflowDrafts[newWfName] || "";
    }

    // 5. Query server session files for a session matching newWfName
    try {
      const res = await ApiClient.getSessions();
      if (this._switchGenerationToken !== switchToken || this.activeWorkflow?.name !== newWfName) {
        return; // Discard stale response
      }
      if (res && res.status === "ok" && Array.isArray(res.sessions) && res.sessions.length > 0) {
        let match = res.sessions.find((s) => s.workflow_name === newWfName);
        if (!match && prevKey === null) {
          // On boot restore, if no session has this exact workflow_name, check if top session has empty workflow_name
          const top = res.sessions[0];
          if (!top.workflow_name || top.workflow_name === newWfName) {
            match = top;
          }
        }
        if (match) {
          const detailRes = await ApiClient.getSession(match.id);
          if (this._switchGenerationToken !== switchToken || this.activeWorkflow?.name !== newWfName) {
            return;
          }
          if (detailRes && detailRes.status === "ok" && detailRes.session) {
            this.currentSessionId = detailRes.session.id;
            this.currentSessionTitle = detailRes.session.title || newWfName;
            this.messages = Array.isArray(detailRes.session.messages) ? detailRes.session.messages : [];
            this._workflowChatCache[newWfName] = {
              sessionId: this.currentSessionId,
              title: this.currentSessionTitle,
              messages: [...this.messages],
            };
            this._renderMessages(this.messages);
            return;
          }
        }
      }
    } catch (_) {}

    // 6. Initialize clean session for this workflow if none found
    if (this._switchGenerationToken === switchToken && this.activeWorkflow?.name === newWfName) {
      this._workflowChatCache[newWfName] = {
        sessionId: null,
        title: newWfName,
        messages: [],
      };
      if (!this.messages || this.messages.length === 0) {
        const messagesContainer = this.panel?.querySelector("#cm-messages");
        if (messagesContainer) {
          messagesContainer.innerHTML = `
            <div class="comfymate-message assistant" id="cm-welcome-msg"></div>
          `;
        }
        this._updateStaticUIText();
      }
    }
  }

  _createNewSessionForWorkflow(wf) {
    this.stopGeneration();
    this._switchGenerationToken = (this._switchGenerationToken || 0) + 1;
    const wfName = wf?.name || "";
    this.messages = [];
    this.currentSessionId = null;
    this.currentSessionTitle = wfName;
    if (wfName) {
      this._workflowChatCache[wfName] = {
        sessionId: null,
        title: wfName,
        messages: [],
      };
    }

    const messagesContainer = this.panel?.querySelector("#cm-messages");
    if (messagesContainer) {
      messagesContainer.innerHTML = `
        <div class="comfymate-message assistant" id="cm-welcome-msg"></div>
      `;
    }
    this._updateStaticUIText();
    this.extractor.clearError();
  }

  /* ---------------- Session & History Management ---------------- */

  _newSessionId() {
    return `sess_${globalThis.crypto?.randomUUID?.() || `${Date.now()}_${Math.random().toString(36).slice(2)}`}`;
  }

  async _saveCurrentSession(targetWfName = null, targetSessionId = null, targetMessages = null, targetTitle = null) {
    const wfName = targetWfName !== null ? targetWfName : (this.activeWorkflow?.name || "");
    const messages = targetMessages !== null ? [...targetMessages] : [...this.messages];
    if (!messages.length) return;

    // Allocate identity before the first network request, so overlapping saves cannot create duplicates.
    const detached = targetWfName !== null;
    const sessId = targetSessionId || (detached ? this._newSessionId() : (this.currentSessionId || this._newSessionId()));
    if (!detached) this.currentSessionId = sessId;
    let title = targetTitle || this.currentSessionTitle;
    if (!title) {
      const firstUserMsg = messages.find((m) => m.role === "user");
      title = wfName || firstUserMsg?.content?.trim().split("\n")[0].slice(0, 32) || this.t("newChat");
      if (!detached) this.currentSessionTitle = title;
    }
    if (wfName) {
      this._workflowChatCache[wfName] = { sessionId: sessId, title, messages };
    }

    this._sessionSaveQueues ||= new Map();
    const previous = this._sessionSaveQueues.get(sessId) || Promise.resolve();
    const save = previous.catch(() => {}).then(() => ApiClient.saveSession({
      id: sessId, title, workflow_name: wfName, messages,
    }));
    this._sessionSaveQueues.set(sessId, save);
    try {
      const res = await save;
      if (res?.status === "ok" && res.session?.id === sessId) {
        if (this.currentSessionId === sessId && (this.activeWorkflow?.name || "") === wfName) {
          this.currentSessionTitle = res.session.title;
        }
        const cached = this._workflowChatCache[wfName];
        if (cached?.sessionId === sessId) cached.title = res.session.title;
      }
    } catch (err) {
      console.warn("[ComfyMate] Failed to save session to disk:", err);
    } finally {
      if (this._sessionSaveQueues.get(sessId) === save) this._sessionSaveQueues.delete(sessId);
    }
  }

  async _restoreHistory() {
    const syncEnabled = this.config?.sync_workflow_chat !== false;

    let currentWf = this.extractor?.getCurrentWorkflowInfo();
    if (!currentWf) {
      // Retry briefly to allow ComfyUI graph/topbar/Pinia to finish mounting
      for (let i = 0; i < 6; i++) {
        await new Promise((r) => setTimeout(r, 100));
        currentWf = this.extractor?.getCurrentWorkflowInfo();
        if (currentWf) break;
      }
    }

    if (currentWf && currentWf.name) {
      this.activeWorkflow = currentWf;
      this._lastWorkflowKey = currentWf.name;
      this._updateHeaderWorkflowBadge();

      if (syncEnabled) {
        await this._switchWorkflowChat(currentWf, null);
        if (this.messages && this.messages.length > 0) {
          this._isBootRestoring = true;
          return;
        }
      }
    }

    // Fallback: Restore latest session directly from server local session files
    try {
      const res = await ApiClient.getSessions();
      if (res && res.status === "ok" && Array.isArray(res.sessions) && res.sessions.length > 0) {
        let targetSession = null;
        const currentWfName = currentWf?.name;

        // Try matching workflow name first
        if (currentWfName) {
          targetSession = res.sessions.find((s) => s.workflow_name === currentWfName);
        }
        // Otherwise take the latest session file on disk
        if (!targetSession) {
          targetSession = res.sessions[0];
        }

        if (targetSession) {
          const detailRes = await ApiClient.getSession(targetSession.id);
          if (detailRes && detailRes.status === "ok" && detailRes.session) {
            const sess = detailRes.session;
            this.currentSessionId = sess.id;
            this.currentSessionTitle = sess.title || "";
            this.messages = Array.isArray(sess.messages) ? sess.messages : [];
            this._renderMessages(this.messages);

            const wfKey = sess.workflow_name || currentWfName || "";
            if (wfKey) {
              this._workflowChatCache[wfKey] = {
                sessionId: sess.id,
                title: sess.title,
                messages: [...this.messages],
              };
            }
            if (currentWfName && currentWfName !== wfKey) {
              this._workflowChatCache[currentWfName] = {
                sessionId: sess.id,
                title: sess.title,
                messages: [...this.messages],
              };
            }
            this._isBootRestoring = true;
            return;
          }
        }
      }
    } catch (e) {
      console.warn("[ComfyMate] Could not load sessions from disk:", e);
    }

    this._createNewSession();
  }

  _renderMessages(saved) {
    this.messages = [];
    const messagesContainer = this.panel.querySelector("#cm-messages");
    messagesContainer.innerHTML = "";

    for (const item of saved) {
      if (!item || !item.role || (!item.content && !item.images)) continue;
      this.messages.push(item);

      if (item.role === "user") {
        const userDiv = document.createElement("div");
        userDiv.className = "comfymate-message user";

        if (item.images && item.images.length > 0) {
          const imgContainer = document.createElement("div");
          imgContainer.className = "cm-msg-images";
          for (const imgUrl of item.images) {
            const imgEl = document.createElement("img");
            imgEl.src = imgUrl;
            imgEl.className = "cm-msg-image";
            imgEl.alt = "attached image";
            imgEl.title = this.t("viewFullImage") || "点击查看大图";
            imgEl.addEventListener("click", () => {
              window.open(imgUrl, "_blank");
            });
            imgContainer.appendChild(imgEl);
          }
          userDiv.appendChild(imgContainer);
        }

        if (item.content) {
          const textSpan = document.createElement("span");
          textSpan.textContent = item.content;
          userDiv.appendChild(textSpan);
        }

        messagesContainer.appendChild(userDiv);
      } else if (item.role === "assistant") {
        const assistantDiv = document.createElement("div");
        assistantDiv.className = "comfymate-message assistant";

        if (item.thinking) {
          const thinkingBox = document.createElement("details");
          thinkingBox.className = "cm-thinking";
          thinkingBox.innerHTML = `
            <summary class="cm-thinking-header">
              <span class="cm-thinking-icon">💭</span>
              <span class="cm-thinking-status">${this.t("thinkingDone")}</span>
              <span class="cm-thinking-arrow">›</span>
            </summary>
            <div class="cm-thinking-body">${escapeHtml(item.thinking)}</div>
          `;
          assistantDiv.appendChild(thinkingBox);
        }

        const contentBox = document.createElement("div");
        contentBox.className = "cm-markdown-body";
        contentBox.innerHTML = renderMarkdown(item.content, (k) => this.t(k));
        assistantDiv.appendChild(contentBox);

        messagesContainer.appendChild(assistantDiv);
      }
    }

    this._scrollToBottom();
  }

  async _switchSession(sessionId) {
    this.stopGeneration();
    const switchToken = this._switchGenerationToken = (this._switchGenerationToken || 0) + 1;
    try {
      const res = await ApiClient.getSession(sessionId);
      if (this._switchGenerationToken !== switchToken) return;
      if (res && res.status === "ok" && res.session) {
        const sessionWfName = res.session.workflow_name;

        // If session belongs to a different workflow than active, try to switch canvas tab
        if (sessionWfName && (!this.activeWorkflow || this.activeWorkflow.name !== sessionWfName)) {
          const tabs = document.querySelectorAll(
            '.p-togglebutton, [data-testid*="workflow-tab"], .workflow-tab, [role="tab"]'
          );
          for (const tab of tabs) {
            const name = this.extractor._extractTabName(tab);
            if (name === sessionWfName) {
              const trigger = tab.querySelector('[role="tab"], button, [data-state]') || tab;
              trigger.click();
              break;
            }
          }
          this.activeWorkflow = { id: sessionWfName, name: sessionWfName, path: sessionWfName };
          this._lastWorkflowKey = sessionWfName;
          this._updateHeaderWorkflowBadge();
        }

        this.currentSessionId = res.session.id;
        this.currentSessionTitle = res.session.title || "";
        this.messages = Array.isArray(res.session.messages) ? res.session.messages : [];
        this._renderMessages(this.messages);

        const wfName = sessionWfName || (this.activeWorkflow?.name || "");
        if (wfName) {
          this._workflowChatCache[wfName] = {
            sessionId: this.currentSessionId,
            title: this.currentSessionTitle,
            messages: [...this.messages],
          };
        }
        return;
      }
    } catch (e) {
      console.warn(`[ComfyMate] Failed to load session ${sessionId}:`, e);
    }
  }

  _createNewSession() {
    this.stopGeneration();
    this._switchGenerationToken = (this._switchGenerationToken || 0) + 1;
    const wfName = this.activeWorkflow?.name;
    if (wfName) {
      // Explicitly mark cache as clean blank session so returning to this workflow won't revive old session
      this._workflowChatCache[wfName] = {
        sessionId: null,
        title: wfName,
        messages: [],
      };
    }
    this.messages = [];
    this.currentSessionId = null;
    this.currentSessionTitle = wfName || "";
    const messagesContainer = this.panel?.querySelector("#cm-messages");
    if (messagesContainer) {
      messagesContainer.innerHTML = `
        <div class="comfymate-message assistant" id="cm-welcome-msg"></div>
      `;
    }
    this._updateStaticUIText();
    this.extractor.clearError();
  }

  clearChat() {
    this._createNewSession();
  }

  _toggleSessionsOverlay() {
    const overlay = this.panel.querySelector("#cm-sessions-overlay");
    if (!overlay) return;
    if (overlay.classList.contains("hidden")) {
      this._openSessionsOverlay();
    } else {
      this._closeSessionsOverlay();
    }
  }

  async _openSessionsOverlay() {
    const overlay = this.panel.querySelector("#cm-sessions-overlay");
    if (!overlay) return;
    overlay.classList.remove("hidden");
    await this._loadSessionsList();
  }

  _closeSessionsOverlay() {
    const overlay = this.panel.querySelector("#cm-sessions-overlay");
    if (overlay) overlay.classList.add("hidden");
  }

  async _loadSessionsList() {
    const listEl = this.panel.querySelector("#cm-sessions-list");
    if (!listEl) return;
    listEl.innerHTML = `<div style="text-align:center; padding:24px 0; color:#71717a; font-size:12px;">${this.t("loadingSessions") || "正在加载会话..."}</div>`;

    try {
      const res = await ApiClient.getSessions();
      if (!res || res.status !== "ok" || !Array.isArray(res.sessions) || res.sessions.length === 0) {
        listEl.innerHTML = `
          <div class="cm-sessions-empty">
            <span style="font-size:26px;">💬</span>
            <span>${this.t("noSessions") || "暂无历史会话记录"}</span>
          </div>
        `;
        return;
      }

      listEl.innerHTML = res.sessions.map((sess) => {
        const isActive = sess.id === this.currentSessionId;
        const timeStr = this._formatRelativeTime(sess.updated_at);
        const countStr = this.t("msgCount", { n: sess.message_count || 0 }) || `${sess.message_count || 0} 条消息`;
        const safeTitle = escapeHtml(sess.title || "新会话");
        const wfName = sess.workflow_name ? escapeHtml(sess.workflow_name) : "";
        const isCurrentCanvas = this.activeWorkflow?.name && sess.workflow_name === this.activeWorkflow.name;

        return `
          <div class="cm-session-card ${isActive ? 'active' : ''}" data-id="${sess.id}">
            <div class="cm-session-card-header">
              <span class="cm-session-card-title" title="${safeTitle}">${safeTitle}</span>
              <button type="button" class="cm-session-card-del" data-del-id="${sess.id}" title="${escapeHtml(this.t('delConfirm', { name: sess.title }) || '删除此会话')}">🗑️</button>
            </div>
            <div class="cm-session-card-meta">
              ${wfName ? `<span class="cm-wf-badge" title="关联工作流: ${wfName}">🎨 ${wfName}</span>` : ''}
              ${isCurrentCanvas ? `<span class="cm-wf-active-badge">${this.t("currentCanvasTag") || "✨ 当前画布"}</span>` : ''}
              <span>${countStr}</span>
              <span>·</span>
              <span>${timeStr}</span>
            </div>
          </div>
        `;
      }).join("");

      listEl.querySelectorAll(".cm-session-card").forEach((card) => {
        card.addEventListener("click", async (e) => {
          if (e.target.closest(".cm-session-card-del")) return;
          const id = card.getAttribute("data-id");
          if (id) {
            await this._switchSession(id);
            this._closeSessionsOverlay();
          }
        });
      });

      listEl.querySelectorAll(".cm-session-card-del").forEach((btn) => {
        btn.addEventListener("click", async (e) => {
          e.stopPropagation();
          const id = btn.getAttribute("data-del-id");
          if (!id) return;
          if (confirm(this.t("deleteSessionConfirm") || "确定要删除此会话吗？本地文件也将被清除。")) {
            try {
              await ApiClient.deleteSession(id);
              for (const [wfK, item] of Object.entries(this._workflowChatCache)) {
                if (item?.sessionId === id) {
                  delete this._workflowChatCache[wfK];
                }
              }

              if (id === this.currentSessionId) {
                this._createNewSession();
              }
              await this._loadSessionsList();
            } catch (delErr) {
              Toast.error(delErr.message || "删除会话失败");
            }
          }
        });
      });
    } catch (err) {
      console.warn("[ComfyMate] Failed to list sessions:", err);
      listEl.innerHTML = `<div style="text-align:center; padding:20px; color:#f87171; font-size:12px;">加载会话失败</div>`;
    }
  }

  _formatRelativeTime(timestamp) {
    if (!timestamp) return "";
    const diff = Math.max(0, Date.now() - timestamp);
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return this.t("timeJustNow") || "刚刚";
    if (mins < 60) return this.t("timeMinsAgo", { n: mins }) || `${mins} 分钟前`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return this.t("timeHoursAgo", { n: hours }) || `${hours} 小时前`;
    const days = Math.floor(hours / 24);
    if (days < 7) return this.t("timeDaysAgo", { n: days }) || `${days} 天前`;
    const d = new Date(timestamp);
    return `${d.getMonth() + 1}-${d.getDate()}`;
  }


  /* ---------------- Multi-Provider & Model Selector ---------------- */

  _isProviderConfigured(p) {
    if (!p) return false;
    const baseUrl = (p.base_url || "").trim();
    let isLocal = false;
    if (baseUrl) {
      try {
        const url = new URL(baseUrl.startsWith("http") ? baseUrl : `http://${baseUrl}`);
        const host = url.hostname;
        isLocal =
          host === "localhost" ||
          host === "127.0.0.1" ||
          host === "0.0.0.0" ||
          host.startsWith("192.168.") ||
          host.startsWith("10.") ||
          host.endsWith(".local") ||
          host.endsWith(".lan");
      } catch (_) {
        isLocal = baseUrl.includes("localhost") || baseUrl.includes("127.0.0.1");
      }
    }
    if (isLocal) {
      return Boolean(p.enabled !== false);
    }
    const hasKey = Boolean(
      (p.api_key && p.api_key.trim().length > 0) ||
      (p.api_key_masked && p.api_key_masked.trim().length > 0)
    );
    return Boolean(hasKey && p.enabled !== false);
  }

  _renderModelSelector() {
    const selector = this.panel?.querySelector("#cm-active-model-select");
    if (!selector) return;
    selector.innerHTML = "";

    const allProviders = this.config?.providers || [];
    const configuredProviders = allProviders.filter((p) => this._isProviderConfigured(p));

    if (configuredProviders.length === 0) {
      const opt = document.createElement("option");
      opt.textContent = this.t("noConfiguredModels") || "⚠️ 未配置模型 (点击去设置)";
      opt.value = "";
      opt.selected = true;
      selector.appendChild(opt);
      selector.value = "";
      selector.selectedIndex = 0;
      return;
    }

    let targetVal = (this.config?.active_provider_id && this.config?.active_model)
      ? `${this.config.active_provider_id}::${this.config.active_model}`
      : "";

    for (const p of configuredProviders) {
      const optgroup = document.createElement("optgroup");
      optgroup.label = p.name || p.id;

      const models = (p.models && p.models.length > 0) ? p.models : ["default"];
      for (const m of models) {
        const opt = document.createElement("option");
        const val = `${p.id}::${m}`;
        opt.value = val;
        opt.textContent = `${p.name || 'Provider'}: ${m}`;
        optgroup.appendChild(opt);
      }
      selector.appendChild(optgroup);
    }

    // Bulletproof selection sync across all WebKit and Chromium browser engines:
    const allOptions = Array.from(selector.querySelectorAll("option"));
    if (allOptions.length === 0) return;

    let targetIdx = allOptions.findIndex((o) => o.value && o.value === targetVal);
    if (targetIdx === -1) {
      targetIdx = allOptions.findIndex((o) => Boolean(o.value));
      if (targetIdx === -1) targetIdx = 0;
      targetVal = allOptions[targetIdx].value;

      if (targetVal) {
        const sep = targetVal.indexOf("::");
        if (sep !== -1) {
          const pid = targetVal.substring(0, sep);
          const model = targetVal.substring(sep + 2);
          if (this.config) {
            this.config.active_provider_id = pid;
            this.config.active_model = model;
            try {
              localStorage.setItem("comfymate_config_cache", JSON.stringify(this.config));
            } catch (_) {}
            ApiClient.saveConfig({
              active_provider_id: pid,
              active_model: model,
            }).catch(() => {});
          }
        }
      }
    }

    // Explicitly update DOM state: option.selected, selector.selectedIndex, and selector.value
    allOptions.forEach((opt, idx) => {
      const isSelected = (idx === targetIdx);
      opt.selected = isSelected;
      opt.defaultSelected = isSelected;
    });

    selector.selectedIndex = targetIdx;
    selector.value = targetVal;
  }

  async openSettings() {
    await this.ready;
    this.settingsModal?.open(this.settingsTab || "models");
  }

  closeSettings() {
    this.settingsModal.close();
    this.editingProviderId = null;
    this.isAddingNew = false;
    this._renderModelSelector();
  }

  async _testConnectionEndpoint(providerId, apiType, baseUrl, apiKey, model = null, models = [], proxy = "") {
    try {
      const data = await ApiClient.testConnection({
        id: providerId,
        api_type: apiType,
        base_url: baseUrl,
        api_key: apiKey,
        model,
        models,
        proxy,
      });
      if (data.status === "ok") {
        let detailsHtml = "";
        let toastMessage = "";
        if (data.model) {
          toastMessage = this.t("testSuccessModel", { model: data.model });
          detailsHtml = `
            <div style="display:flex; align-items:center; gap:6px; margin-top:3px;">
              <span style="color:#93c5fd; font-size:11.5px; font-weight:600;">${this.t("testedModel")}:</span>
              <span class="cm-model-sample-pill" style="border-color:#3b82f6; color:#93c5fd; background:rgba(59,130,246,0.18); font-weight:600;">${escapeHtml(data.model)}</span>
            </div>
          `;
        } else if (data.models && data.models.length > 0) {
          toastMessage = this.t("testSuccessModels", { n: data.models.length });
          const sampleCount = Math.min(data.models.length, 6);
          const samplePills = data.models.slice(0, sampleCount).map((m) => {
            const name = typeof m === "string" ? m : (m.id || "");
            return `<span class="cm-model-sample-pill">${escapeHtml(name)}</span>`;
          }).join("");
          const moreCount = data.models.length - sampleCount;
          const moreTag = moreCount > 0 ? `<span style="color:#71717a; font-size:11px; margin-left:4px;">(+${moreCount})</span>` : "";
          detailsHtml = `
            <div style="margin-bottom:3px; font-weight:600; color:#93c5fd;">${this.t("testSample")}:</div>
            <div style="display:flex; flex-wrap:wrap; gap:4px; align-items:center;">
              ${samplePills}${moreTag}
            </div>
          `;
        } else {
          toastMessage = this.t("testSuccess");
        }
        Toast.show({
          type: "success",
          title: this.t("testConnSuccessTitle"),
          message: toastMessage,
          details: detailsHtml,
          duration: 4500,
        });
      } else {
        let failMessage = data.message;
        if (data.code === "timeout") {
          failMessage = this.t("testTimeout", { model: data.model || "" });
        } else if (data.code === "stream_error" || data.code === "test_fail") {
          failMessage = this.t("testModelFail", { model: data.model || "", msg: data.message || "" });
        } else if (!failMessage) {
          failMessage = this.t("testError", { msg: "Unknown error" });
        }
        Toast.show({
          type: "error",
          title: this.t("testConnFailTitle"),
          message: failMessage,
          duration: 5000,
        });
      }
    } catch (e) {
      Toast.show({
        type: "error",
        title: this.t("testConnFailTitle"),
        message: this.t("testFailed", { err: e.message }),
        duration: 5000,
      });
    }
  }

  async _loadConfig(retries = 2) {
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const data = await ApiClient.getConfig();
        if (data && data.status === "ok" && data.config) {
          this.config = data.config;
          try {
            localStorage.setItem("comfymate_config_cache", JSON.stringify(data.config));
          } catch (_) {}
          this._updateStaticUIText();
          this._renderModelSelector();
          return;
        }
      } catch (e) {
        if (attempt < retries) {
          await new Promise((r) => setTimeout(r, 350 * (attempt + 1)));
        } else {
          console.warn("[ComfyMate] Could not load settings after retries:", e);
        }
      }
    }
  }

  async _saveConfigToServer() {
    try {
      const res = await ApiClient.saveConfig(this.config);
      if (res && res.status === "ok" && res.config) {
        this.config = res.config;
        try {
          localStorage.setItem("comfymate_config_cache", JSON.stringify(res.config));
        } catch (_) {}
        this._updateStaticUIText();
        this._renderModelSelector();
      }
    } catch (e) {
      console.error("[ComfyMate] Failed to save config:", e);
    }
  }

  _runDoctorCheck() {
    const report = this.actions.diagnoseWorkflow();

    const messagesContainer = this.panel.querySelector("#cm-messages");
    const welcomeMsg = messagesContainer?.querySelector("#cm-welcome-msg");
    if (welcomeMsg) {
      welcomeMsg.remove();
    }

    const msgDiv = document.createElement("div");
    msgDiv.className = "comfymate-message assistant";

    let contentHtml = "";
    if (report.healthy) {
      contentHtml = `
        <div class="cm-doctor-card healthy">
          <div class="cm-doctor-header">
            <span class="cm-doctor-icon">🎉</span>
            <div class="cm-doctor-title-group">
              <div class="cm-doctor-title">${this.t("workflowDoctor") || "工作流健康体检"}</div>
              <div class="cm-doctor-subtitle">${this.t("wfNodes", { n: report.totalNodes })}</div>
            </div>
          </div>
          <div class="cm-doctor-body">
            <div class="cm-doctor-success-text">${this.t("doctorHealthy") || "工作流健康状况良好！所有核心连线与参数均正常。"}</div>
          </div>
        </div>
      `;
    } else {
      const issueItems = report.issues.map((iss) => {
        const icon = iss.severity === "critical" ? "🚨" : iss.severity === "warning" ? "⚠️" : "ℹ️";
        const badgeClass = `cm-doctor-badge ${iss.severity}`;
        return `
          <div class="cm-doctor-issue-item">
            <div class="cm-doctor-issue-top">
              <span class="${badgeClass}">${icon} Node #${iss.nodeId} [${escapeHtml(iss.title)}]</span>
              <button class="cm-action-btn-locate cm-doctor-locate" type="button" data-node-id="${iss.nodeId}" title="${this.t("locateNode") || "在画布中定位此节点"}">
                <span>📍</span> <span>${this.t("locateNode") || "定位"}</span>
              </button>
            </div>
            <div class="cm-doctor-issue-msg">${escapeHtml(iss.message)}</div>
            ${iss.fixSuggestion ? `<div class="cm-doctor-issue-fix">💡 ${escapeHtml(iss.fixSuggestion)}</div>` : ""}
          </div>
        `;
      }).join("");

      contentHtml = `
        <div class="cm-doctor-card">
          <div class="cm-doctor-header">
            <span class="cm-doctor-icon">🩺</span>
            <div class="cm-doctor-title-group">
              <div class="cm-doctor-title">${this.t("workflowDoctor") || "工作流健康体检报告"}</div>
              <div class="cm-doctor-subtitle">${this.t("doctorFoundIssues", { n: report.issues.length })} (${this.t("wfNodes", { n: report.totalNodes })})</div>
            </div>
          </div>
          <div class="cm-doctor-body">
            <div class="cm-doctor-issues-list">${issueItems}</div>
          </div>
          <div class="cm-doctor-footer">
            <button class="cm-doctor-btn-ask-ai" type="button">
              <span>🤖</span> <span>${this.t("doctorAskAi") || "让 AI 提供修复方案"}</span>
            </button>
          </div>
        </div>
      `;
    }

    msgDiv.innerHTML = contentHtml;
    messagesContainer.appendChild(msgDiv);
    this._scrollToBottom();

    // Persist to session history
    this.messages.push({
      role: "assistant",
      content: report.healthy
        ? `🩺 **工作流健康体检**：全部 ${report.totalNodes} 个节点检查通过，核心连线正常。`
        : `🩺 **工作流健康体检报告**：共扫描 ${report.totalNodes} 个节点，发现 ${report.issues.length} 个潜在问题。`,
    });
    this._saveCurrentSession();
  }

  _fallbackCopyText(text) {
    try {
      const textArea = document.createElement("textarea");
      textArea.value = text;
      textArea.style.position = "fixed";
      textArea.style.left = "-9999px";
      textArea.style.top = "0";
      textArea.style.opacity = "0";
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();
      document.execCommand("copy");
      document.body.removeChild(textArea);
    } catch (e) {
      console.warn("[ComfyMate] Fallback copy failed:", e);
    }
  }
}
