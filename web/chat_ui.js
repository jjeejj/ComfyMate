import { ContextExtractor } from "./src/canvas/extractor.js";
import { I18nManager, FORMAT_PRESETS } from "./src/i18n/index.js";
import { renderMarkdown } from "./src/utils/markdown.js";
import { ApiClient } from "./src/services/api.js";
import { SettingsModal } from "./src/components/settings_modal.js";
import { Toast, escapeHtml } from "./src/utils/toast.js";

export class ChatUI {
  constructor(app) {
    this.app = app;
    this.extractor = new ContextExtractor(app);
    this.messages = [];
    this.isStreaming = false;
    this.abortController = null;
    this.isVisible = false;
    this.config = null;
    this.attachedImages = [];

    // Session Management State
    this.currentSessionId = null;
    this.currentSessionTitle = "";

    // Settings Modal State
    this.settingsTab = "models";
    this.editingProviderId = null;
    this.isAddingNew = false;
    this._contextInterval = null;

    // Create UI elements
    this._createDOM();
    this.settingsModal = new SettingsModal(this._getComponentContext());

    this._restoreHistory();
    this._loadConfig();
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
      testConnection: (id, apiType, url, key, model, models) => this._testConnectionEndpoint(id, apiType, url, key, model, models),
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

  _createDOM() {
    this.panel = document.createElement("div");
    this.panel.className = "comfymate-panel hidden";
    this.panel.innerHTML = `
      <div class="comfymate-resizer" id="cm-resizer" title="${this.t('resizerTitle')}"></div>

      <div class="comfymate-header">
        <div class="comfymate-header-title">
          <span>✨ ComfyMate</span>
          <span class="comfymate-header-badge" id="cm-txt-copilot">${this.t('copilot')}</span>
        </div>
        <div class="comfymate-header-actions">
          <button class="comfymate-icon-btn" id="cm-btn-new-chat" title="${this.t('btnNewChatTitle') || '新建会话'}">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
          </button>
          <button class="comfymate-icon-btn" id="cm-btn-sessions" title="${this.t('btnSessionsTitle') || '历史会话'}">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
          </button>
          <button class="comfymate-icon-btn" id="cm-btn-settings" title="${this.t('btnSettingsTitle')}">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
          </button>
          <button class="comfymate-icon-btn" id="cm-btn-close" title="${this.t('btnCloseTitle')}">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
          </button>
        </div>
      </div>

      <!-- Quick Model Switcher in Chat Header -->
      <div class="comfymate-model-bar">
        <span class="cm-model-bar-label" id="cm-txt-model-label">${this.t('modelLabel')}</span>
        <select class="cm-model-selector" id="cm-active-model-select" title="${this.t('modelSelectorTitle')}"></select>
      </div>

      <div class="comfymate-context-bar" id="cm-context-bar">
        <span class="comfymate-tag" id="cm-tag-workflow">${this.t('wfNodes', { n: 0 })}</span>
        <span class="comfymate-tag selected" id="cm-tag-selected" style="display:none;">${this.t('selectedNodes', { n: 0 })}</span>
        <span class="comfymate-tag error" id="cm-tag-error" style="display:none;">${this.t('errorDetected')}</span>
      </div>

      <div class="comfymate-quick-actions">
        <button class="comfymate-pill" data-action="explain_workflow" id="cm-pill-wf">${this.t('explainWf')}</button>
        <button class="comfymate-pill" data-action="explain_selected" id="cm-pill-sel">${this.t('explainSel')}</button>
        <button class="comfymate-pill" data-action="diagnose_error" id="cm-pill-err">${this.t('diagnoseErr')}</button>
      </div>

      <div class="comfymate-messages" id="cm-messages">
        <div class="comfymate-message assistant" id="cm-welcome-msg"></div>
      </div>

      <!-- Sessions History Overlay -->
      <div class="cm-sessions-overlay hidden" id="cm-sessions-overlay">
        <div class="cm-sessions-header">
          <div class="cm-sessions-title">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
            <span>${this.t('sessionsHistory') || '历史会话'}</span>
          </div>
          <div class="cm-sessions-actions">
            <button class="comfymate-send-btn" id="cm-btn-new-chat-drawer" style="padding:4px 10px; font-size:11.5px; border-radius:6px; cursor:pointer;">+ ${this.t('newChat') || '新建会话'}</button>
            <button class="comfymate-icon-btn" id="cm-btn-close-sessions" title="关闭">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
            </button>
          </div>
        </div>
        <div class="cm-sessions-list" id="cm-sessions-list"></div>
      </div>


      <div class="comfymate-input-area" id="cm-input-area">
        <div class="cm-image-preview-bar" id="cm-image-preview-bar" style="display:none;"></div>
        <div class="cm-input-row">
          <textarea class="comfymate-textarea" id="cm-input" placeholder="${this.t('placeholder')}"></textarea>
          <button class="comfymate-send-btn" id="cm-btn-send">${this.t('send')}</button>
        </div>
      </div>

    `;
    document.body.appendChild(this.panel);

    this._updateStaticUIText();
    this._bindEvents();
    this._bindResizer();
  }

  _updateStaticUIText() {
    this.panel.querySelector("#cm-txt-copilot").textContent = this.t("copilot");
    this.panel.querySelector("#cm-txt-model-label").textContent = this.t("modelLabel");
    this.panel.querySelector("#cm-pill-wf").textContent = this.t("explainWf");
    this.panel.querySelector("#cm-pill-sel").textContent = this.t("explainSel");
    this.panel.querySelector("#cm-pill-err").textContent = this.t("diagnoseErr");
    this.panel.querySelector("#cm-input").placeholder = this.t("placeholder");
    if (this.messages.length === 0) {
      const welcomeEl = this.panel.querySelector("#cm-welcome-msg");
      if (welcomeEl) {
        const configuredProviders = (this.config?.providers || []).filter((p) => this._isProviderConfigured(p));
        let welcomeHtml = this.t("welcome");
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

    const btnNew = this.panel.querySelector("#cm-btn-new-chat");
    if (btnNew) btnNew.title = this.t("btnNewChatTitle") || "新建会话";
    const btnSess = this.panel.querySelector("#cm-btn-sessions");
    if (btnSess) btnSess.title = this.t("btnSessionsTitle") || "历史会话";
    this.panel.querySelector("#cm-btn-settings").title = this.t("btnSettingsTitle");
    this.panel.querySelector("#cm-btn-close").title = this.t("btnCloseTitle");
    this.panel.querySelector("#cm-resizer").title = this.t("resizerTitle");
    this.panel.querySelector("#cm-active-model-select").title = this.t("modelSelectorTitle");

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


    const activeModelSelect = this.panel.querySelector("#cm-active-model-select");
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
        const action = e.target.getAttribute("data-action");
        if (action === "explain_workflow") {
          this.sendMessage(this.t("promptExplainWf"));
        } else if (action === "explain_selected") {
          const selected = this.extractor.getSelectedNodes();
          if (selected.length === 0) {
            Toast.warning(this.t("selectNodesFirst"));
            return;
          }
          this.sendMessage(this.t("promptExplainSel"));
        } else if (action === "diagnose_error") {
          if (!this.extractor.lastError) {
            Toast.info(this.t("noErrorDetected"));
            return;
          }
          this.sendMessage(this.t("promptDiagnoseErr"));
        }
      });
    });

    this.panel.querySelector("#cm-tag-error").addEventListener("click", () => {
      this.sendMessage(this.t("promptDiagnoseErr"));
    });

    // Delegated click handler for code block copy buttons
    this.panel.querySelector("#cm-messages").addEventListener("click", (e) => {
      const copyBtn = e.target.closest(".cm-code-copy");
      if (copyBtn) {
        const code = decodeURIComponent(copyBtn.getAttribute("data-code") || "");
        if (code) {
          navigator.clipboard.writeText(code).then(() => {
            const origText = copyBtn.textContent;
            copyBtn.textContent = this.t("copiedCode") || "已复制!";
            setTimeout(() => {
              copyBtn.textContent = origText;
            }, 2000);
          }).catch((err) => {
            console.warn("[ComfyMate] Copy failed:", err);
          });
        }
      }
    });
  }

  toggle(forceState) {
    this.isVisible = forceState !== undefined ? forceState : !this.isVisible;
    if (this.isVisible) {
      this.panel.classList.remove("hidden");
      this.panel.querySelector("#cm-input").focus();
    } else {
      this.panel.classList.add("hidden");
    }
  }

  _startContextSync() {
    if (this._contextInterval) {
      clearInterval(this._contextInterval);
    }
    this._contextInterval = setInterval(() => {
      if (!this.isVisible) return;
      const summary = this.extractor.getWorkflowSummary();
      const selected = this.extractor.getSelectedNodes();
      const lastError = this.extractor.lastError;

      const tagWf = this.panel.querySelector("#cm-tag-workflow");
      tagWf.textContent = this.t("wfNodes", { n: summary ? summary.total_nodes : 0 });

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
        messages: this.messages,
        context: context,
        model_config: modelOverride,
        language: this._getEffectiveLang(),
        signal: this.abortController.signal,
        onEvent: (event) => {
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
            contentBox.innerHTML = `
              <div class="cm-chat-error-card" style="padding:10px 14px; background:rgba(239,68,68,0.12); border:1px solid rgba(239,68,68,0.35); border-radius:8px; color:#fca5a5; font-size:12.5px; line-height:1.5;">
                <div style="font-weight:600; color:#ef4444; margin-bottom:4px; display:flex; align-items:center; gap:6px;">
                  <span>🚨</span> <span>${this.t("errorDetected") || "调用报错"}</span>
                </div>
                <div style="white-space:pre-wrap; word-break:break-word;">${escapeHtml(event.text)}</div>
              </div>
            `;
            this._scrollToBottom();
          }
        },
      });

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
      this._setStreamingState(false);
      this.abortController = null;
      this._scrollToBottom();
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
    }
    messagesContainer.appendChild(msgDiv);
    this._scrollToBottom();
    return msgDiv;
  }

  _scrollToBottom() {
    const messagesContainer = this.panel.querySelector("#cm-messages");
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }

  /* ---------------- Session & History Management ---------------- */

  _saveCurrentSession() {
    this._saveHistory();

    if (!this.messages || this.messages.length === 0) return;

    let title = this.currentSessionTitle;
    if (!title) {
      const firstUserMsg = this.messages.find((m) => m.role === "user");
      if (firstUserMsg && firstUserMsg.content) {
        title = firstUserMsg.content.trim().split("\n")[0].slice(0, 32);
      } else {
        title = this.t("newChat") || "新会话";
      }
      this.currentSessionTitle = title;
    }

    ApiClient.saveSession({
      id: this.currentSessionId || undefined,
      title: title,
      messages: this.messages,
    }).then((res) => {
      if (res && res.status === "ok" && res.session) {
        this.currentSessionId = res.session.id;
        this.currentSessionTitle = res.session.title;
      }
    }).catch((err) => {
      console.warn("[ComfyMate] Failed to save session to disk:", err);
    });
  }

  _saveHistory() {
    try {
      const toSave = this.messages.slice(-50);
      localStorage.setItem("comfymate_chat_history", JSON.stringify(toSave));
    } catch (e) {
      console.warn("[ComfyMate] Failed to save chat history with images, falling back to text-only:", e);
      try {
        const textOnly = this.messages.slice(-50).map((m) => {
          if (m.images) {
            const { images, ...rest } = m;
            return rest;
          }
          return m;
        });
        localStorage.setItem("comfymate_chat_history", JSON.stringify(textOnly));
      } catch (err2) {
        console.warn("[ComfyMate] Failed to save chat history to localStorage:", err2);
      }
    }
  }

  async _restoreHistory() {
    try {
      const res = await ApiClient.getSessions();
      if (res && res.status === "ok" && Array.isArray(res.sessions) && res.sessions.length > 0) {
        const latestSession = res.sessions[0];
        await this._switchSession(latestSession.id);
        return;
      }
    } catch (e) {
      console.warn("[ComfyMate] Could not load sessions from disk, trying localStorage:", e);
    }
    this._restoreFromLocalStorage();
  }

  _restoreFromLocalStorage() {
    try {
      const raw = localStorage.getItem("comfymate_chat_history");
      if (!raw) return;
      const saved = JSON.parse(raw);
      if (!Array.isArray(saved) || saved.length === 0) return;

      this.messages = [];
      this._renderMessages(saved);

      // Auto-migrate localStorage chat history to disk session
      if (this.messages.length > 0) {
        this._saveCurrentSession();
      }
    } catch (e) {
      console.warn("[ComfyMate] Failed to restore chat history from localStorage:", e);
    }
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
    try {
      const res = await ApiClient.getSession(sessionId);
      if (res && res.status === "ok" && res.session) {
        this.currentSessionId = res.session.id;
        this.currentSessionTitle = res.session.title || "";
        this._renderMessages(res.session.messages || []);
        this._saveHistory();
        return;
      }
    } catch (e) {
      console.warn(`[ComfyMate] Failed to load session ${sessionId}:`, e);
    }
  }

  _createNewSession() {
    this.messages = [];
    this.currentSessionId = null;
    this.currentSessionTitle = "";
    try {
      localStorage.removeItem("comfymate_chat_history");
    } catch (_) {}
    const messagesContainer = this.panel.querySelector("#cm-messages");
    messagesContainer.innerHTML = `
      <div class="comfymate-message assistant" id="cm-welcome-msg"></div>
    `;
    this._updateStaticUIText();
    this.extractor.clearError();
    Toast.info(this.t("newChatCreated") || "已开启新会话");
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
        return `
          <div class="cm-session-card ${isActive ? 'active' : ''}" data-id="${sess.id}">
            <div class="cm-session-card-header">
              <span class="cm-session-card-title" title="${safeTitle}">${safeTitle}</span>
              <button type="button" class="cm-session-card-del" data-del-id="${sess.id}" title="${escapeHtml(this.t('delConfirm', { name: sess.title }) || '删除此会话')}">🗑️</button>
            </div>
            <div class="cm-session-card-meta">
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
            Toast.info(this.t("sessionSwitched", { title: card.querySelector(".cm-session-card-title")?.textContent || id }));
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
              Toast.info(this.t("sessionDeleted") || "会话已删除");
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
    if (!p || !p.base_url) return false;
    let isLocal = false;
    try {
      const url = new URL(p.base_url.startsWith("http") ? p.base_url : `http://${p.base_url}`);
      const host = url.hostname;
      isLocal =
        host === "localhost" ||
        host === "127.0.0.1" ||
        host === "0.0.0.0" ||
        host.startsWith("192.168.") ||
        host.startsWith("10.") ||
        host.endsWith(".local");
    } catch (_) {
      isLocal = p.base_url.includes("localhost") || p.base_url.includes("127.0.0.1");
    }
    if (isLocal) {
      return Boolean(p.models && p.models.length > 0 && p.enabled !== false);
    }
    const hasKey = Boolean(
      (p.api_key && p.api_key.trim().length > 0) ||
      (p.api_key_masked && p.api_key_masked.trim().length > 0)
    );
    return Boolean(hasKey && p.enabled !== false);
  }

  _renderModelSelector() {
    const selector = this.panel.querySelector("#cm-active-model-select");
    selector.innerHTML = "";

    const allProviders = this.config?.providers || [];
    const configuredProviders = allProviders.filter((p) => this._isProviderConfigured(p));

    if (configuredProviders.length === 0) {
      const opt = document.createElement("option");
      opt.textContent = this.t("noConfiguredModels");
      opt.value = "";
      selector.appendChild(opt);
      return;
    }

    let activeFound = false;

    for (const p of configuredProviders) {
      const optgroup = document.createElement("optgroup");
      optgroup.label = p.name || p.id;

      const models = (p.models && p.models.length > 0) ? p.models : ["default"];
      for (const m of models) {
        const opt = document.createElement("option");
        opt.value = `${p.id}::${m}`;
        opt.textContent = m;
        if (p.id === this.config.active_provider_id && m === this.config.active_model) {
          opt.selected = true;
          activeFound = true;
        }
        optgroup.appendChild(opt);
      }
      selector.appendChild(optgroup);
    }

    if (!activeFound && selector.options.length > 0 && selector.options[0].value) {
      selector.selectedIndex = 0;
      const [pid, model] = selector.value.split("::");
      this.config.active_provider_id = pid;
      this.config.active_model = model;
      ApiClient.saveConfig({
        active_provider_id: pid,
        active_model: model,
      }).catch((err) => console.warn("[ComfyMate] Failed to auto-save active model:", err));
    }
  }

  openSettings() {
    this.settingsModal.open(this.settingsTab || "models");
  }

  closeSettings() {
    this.settingsModal.close();
    this.editingProviderId = null;
    this.isAddingNew = false;
  }

  async _testConnectionEndpoint(providerId, apiType, baseUrl, apiKey, model = null, models = []) {
    try {
      const data = await ApiClient.testConnection({
        id: providerId,
        api_type: apiType,
        base_url: baseUrl,
        api_key: apiKey,
        model,
        models,
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

  async _loadConfig() {
    try {
      const data = await ApiClient.getConfig();
      if (data.status === "ok") {
        this.config = data.config;
        this._updateStaticUIText();
        this._renderModelSelector();
      }
    } catch (e) {
      console.warn("[ComfyMate] Could not load settings:", e);
    }
  }

  async _saveConfigToServer() {
    try {
      const res = await ApiClient.saveConfig(this.config);
      if (res.status === "ok") {
        this.config = res.config;
        this._updateStaticUIText();
        this._renderModelSelector();
      }
    } catch (e) {
      console.error("[ComfyMate] Failed to save config:", e);
    }
  }
}
