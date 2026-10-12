/**
 * Render General Settings Pane (Language, Temperature, Max Tokens).
 */
export function renderGeneralPane(ctx, container) {
  const currentLang = ctx.config?.language || "auto";
  const currentTemp = typeof ctx.config?.temperature === "number" ? ctx.config.temperature : 0.7;
  const currentMaxTokens = ctx.config?.max_tokens || 4096;
  const syncWfChat = ctx.config?.sync_workflow_chat !== false;

  const detectedLangCode = ctx.detectComfyLanguage();
  const isZh = ctx.getEffectiveLang() === "zh";
  const detectedLangText =
    detectedLangCode === "zh"
      ? (isZh ? "中文 (zh)" : "Chinese (zh)")
      : (isZh ? "英文 (en)" : "English (en)");

  const isMac = typeof navigator !== "undefined" && (/Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent));
  const primaryKbd = isMac ? "⌥ Option + C" : "Alt + C";
  const shortcutTooltip = isMac ? ctx.t("shortcutTooltipMac") : ctx.t("shortcutTooltipOther");

  container.innerHTML = `
    <div class="cm-general-pane-container">
      <!-- 1. Language Section Card -->
      <div class="cm-settings-card">
        <div class="cm-card-header">
          <div class="cm-card-header-icon">🌐</div>
          <div>
            <div class="cm-card-title">${ctx.t("sectionLanguage")}</div>
            <div class="cm-card-desc">${ctx.t("sectionLanguageDesc")}</div>
          </div>
        </div>

        <div class="cm-setting-row">
          <div class="cm-setting-label-col">
            <div class="cm-setting-row-title">${ctx.t("displayLang")}</div>
            <div class="cm-setting-row-desc">${ctx.t("displayLangDesc")}</div>
          </div>
          <div class="cm-setting-control-col">
            <select class="comfymate-input cm-setting-select" id="cm-cfg-lang">
              <option value="auto" ${currentLang === 'auto' ? 'selected' : ''}>${ctx.t("langAuto")}</option>
              <option value="zh" ${currentLang === 'zh' ? 'selected' : ''}>${ctx.t("langZh")}</option>
              <option value="en" ${currentLang === 'en' ? 'selected' : ''}>${ctx.t("langEn")}</option>
            </select>
          </div>
        </div>

        <div class="cm-detected-locale-chip">
          <span class="cm-chip-sparkle">✨</span>
          <span class="cm-chip-text">${ctx.t("detectedLocalePrefix")} <b>${detectedLangText}</b></span>
          <span class="cm-chip-tag">${ctx.t("detectedActive")}</span>
        </div>
      </div>

      <!-- 2. Generation Parameters Card -->
      <div class="cm-settings-card">
        <div class="cm-card-header">
          <div class="cm-card-header-icon">🎛️</div>
          <div>
            <div class="cm-card-title">${ctx.t("sectionModelParams")}</div>
            <div class="cm-card-desc">${ctx.t("sectionModelParamsDesc")}</div>
          </div>
        </div>

        <!-- Temperature -->
        <div class="cm-setting-stack-row">
          <div class="cm-setting-row-header">
            <div>
              <div class="cm-setting-row-title">${ctx.t("tempLabel")}</div>
              <div class="cm-setting-row-desc">${ctx.t("tempDesc")}</div>
            </div>
            <span class="cm-val-badge" id="cm-txt-temp-val">${currentTemp.toFixed(1)}</span>
          </div>

          <div class="cm-slider-wrap">
            <input type="range" min="0" max="1.5" step="0.1" value="${currentTemp}" class="cm-range-slider" id="cm-cfg-temp" />
            <div class="cm-slider-ticks">
              <span>${ctx.t("tempPrecise")}</span>
              <span>${ctx.t("tempBalanced")}</span>
              <span>${ctx.t("tempCreative")}</span>
            </div>
          </div>
        </div>

        <div class="cm-card-divider"></div>

        <!-- Max Output Tokens -->
        <div class="cm-setting-row">
          <div class="cm-setting-label-col">
            <div class="cm-setting-row-title">${ctx.t("maxTokensLabel")}</div>
            <div class="cm-setting-row-desc">${ctx.t("maxTokensDesc")}</div>
          </div>
          <div class="cm-setting-control-col">
            <select class="comfymate-input cm-setting-select" id="cm-cfg-max-tokens">
              <option value="2048" ${currentMaxTokens === 2048 ? 'selected' : ''}>2048 Tokens</option>
              <option value="4096" ${currentMaxTokens === 4096 ? 'selected' : ''}>4096 Tokens (${ctx.t("recommendTag")})</option>
              <option value="8192" ${currentMaxTokens === 8192 ? 'selected' : ''}>8192 Tokens</option>
              <option value="16384" ${currentMaxTokens === 16384 ? 'selected' : ''}>16384 Tokens</option>
            </select>
          </div>
        </div>
      </div>

      <!-- 3. Workflow Linkage Card -->
      <div class="cm-settings-card">
        <div class="cm-card-header">
          <div class="cm-card-header-icon">🎨</div>
          <div>
            <div class="cm-card-title">${ctx.t("sectionWorkflowSync") || "画布与对话联动"}</div>
            <div class="cm-card-desc">${ctx.t("sectionWorkflowSyncDesc") || "控制每个画布标签页是否独立维护专属聊天记录"}</div>
          </div>
        </div>

        <div class="cm-setting-row">
          <div class="cm-setting-label-col">
            <div class="cm-setting-row-title">${ctx.t("syncWorkflowChatLabel") || "每个画布对应专属对话 (推荐)"}</div>
            <div class="cm-setting-row-desc">${ctx.t("syncWorkflowChatDesc") || "切换 ComfyUI 画布标签页时自动切换到该画布的历史对话，提问更专注精准"}</div>
          </div>
          <div class="cm-setting-control-col">
            <input type="checkbox" id="cm-cfg-sync-wf" ${syncWfChat ? 'checked' : ''} style="width: 18px; height: 18px; accent-color: #3b82f6; cursor: pointer;" />
          </div>
        </div>
      </div>

      <!-- 4. Dedicated Footer with Version, Shortcut and Save Button -->
      <div class="cm-general-footer">
        <div class="cm-general-footer-info">
          <span class="cm-footer-ver">✨ ComfyMate</span>
          <span class="cm-footer-dot">·</span>
          <span class="cm-footer-shortcut" title="${shortcutTooltip}">
            <kbd class="cm-kbd">${primaryKbd}</kbd>
            <span>${ctx.t("footerShortcut")}</span>
          </span>
        </div>
        <div style="display:flex; align-items:center; gap:8px;">
          <span class="cm-tag-badge" id="cm-saved-general-badge" style="display:none; background:rgba(34,197,94,0.15); color:#4ade80; border:1px solid rgba(34,197,94,0.3); font-weight:600;">✓ ${ctx.t("saved") || "已保存"}</span>
          <button class="comfymate-send-btn cm-btn-save-primary" id="cm-btn-save-general">
            ${ctx.t("save")}
          </button>
        </div>
      </div>
    </div>
  `;

  const langSelect = container.querySelector("#cm-cfg-lang");
  const tempSlider = container.querySelector("#cm-cfg-temp");
  const tempVal = container.querySelector("#cm-txt-temp-val");
  const maxTokensSelect = container.querySelector("#cm-cfg-max-tokens");
  const syncWfCheckbox = container.querySelector("#cm-cfg-sync-wf");

  tempSlider.addEventListener("input", (e) => {
    tempVal.textContent = parseFloat(e.target.value).toFixed(1);
  });

  container.querySelector("#cm-btn-save-general").addEventListener("click", () => {
    if (!ctx.config) ctx.config = {};
    ctx.config.language = langSelect.value;
    ctx.config.temperature = parseFloat(tempSlider.value);
    ctx.config.max_tokens = parseInt(maxTokensSelect.value, 10);
    ctx.config.sync_workflow_chat = syncWfCheckbox ? syncWfCheckbox.checked : true;
    ctx.saveConfig();
    ctx.updateStaticUIText();

    const savedBadge = container.querySelector("#cm-saved-general-badge");
    if (savedBadge) {
      savedBadge.style.display = "inline";
      setTimeout(() => {
        if (savedBadge) savedBadge.style.display = "none";
      }, 2500);
    }
  });
}
