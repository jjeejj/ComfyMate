import { findPreset, getProviderDisplayName, FORMAT_PRESETS } from "../../i18n/index.js";
import { escapeHtml } from "../../utils/toast.js";

/**
 * Render Models Settings Pane (Provider list & 3-format editor).
 */
export function renderModelsPane(ctx, container) {
  container.innerHTML = "";
  if (!ctx.config || !ctx.config.providers) return;

  const listWrapper = document.createElement("div");
  listWrapper.style.display = "flex";
  listWrapper.style.flexDirection = "column";
  listWrapper.style.gap = "8px";

  // 1. Providers Card List
  for (const p of ctx.config.providers) {
    const card = document.createElement("div");
    card.className = "cm-provider-card";

    const isConfigured = ctx.isProviderConfigured(p);
    const isAnthropic =
      p.api_type === "anthropic" ||
      (p.name && p.name.toLowerCase().includes("anthropic"));
    const isOpenAI =
      (p.api_type === "openai" || !p.api_type) && p.name === "OpenAI";
    let badgeText = "";
    if (isAnthropic) {
      badgeText = "Anthropic";
    } else if (isOpenAI) {
      badgeText = "OpenAI";
    } else {
      badgeText = ctx.t("badgeCompatible");
    }
    const displayName = getProviderDisplayName(p, ctx.getEffectiveLang());

    card.innerHTML = `
      <div class="cm-provider-info">
        <span class="cm-provider-name">${escapeHtml(displayName)}</span>
        <span class="cm-tag-badge">${escapeHtml(badgeText)}</span>
        <span class="cm-status-dot ${isConfigured ? 'configured' : 'unconfigured'}" title="${isConfigured ? ctx.t('configuredDot') : ctx.t('unconfiguredDot')}"></span>
        ${!isConfigured ? `<span style="font-size:11px; color:#a1a1aa;">${ctx.t('unconfiguredTag')}</span>` : ""}
      </div>
      <div class="cm-card-actions">
        <button class="cm-card-btn cm-btn-edit-p" data-id="${p.id}">${ctx.t("editBtn")}</button>
        <button class="cm-card-btn danger cm-btn-del-p" data-id="${p.id}">${ctx.t("delBtn")}</button>
      </div>
    `;

    card.querySelector(".cm-btn-edit-p").addEventListener("click", () => {
      ctx.editingProviderId = p.id;
      ctx.isAddingNew = false;
      renderModelsPane(ctx, container);
    });

    const delBtn = card.querySelector(".cm-btn-del-p");
    if (delBtn) {
      delBtn.addEventListener("click", () => {
        if (confirm(ctx.t("delConfirm", { name: displayName }))) {
          ctx.config.providers = ctx.config.providers.filter((pr) => pr.id !== p.id);
          if (ctx.config.active_provider_id === p.id) {
            const remaining = ctx.config.providers.find((pr) => ctx.isProviderConfigured(pr)) || ctx.config.providers[0];
            if (remaining) {
              ctx.config.active_provider_id = remaining.id;
              ctx.config.active_model = remaining.models[0] || "default";
            } else {
              ctx.config.active_provider_id = null;
              ctx.config.active_model = null;
            }
          }
          if (ctx.editingProviderId === p.id) {
            ctx.editingProviderId = null;
          }
          ctx.saveConfig();
          renderModelsPane(ctx, container);
        }
      });
    }

    listWrapper.appendChild(card);
  }

  if (ctx.config.providers.length === 0 && !ctx.editingProviderId && !ctx.isAddingNew) {
    const guideCard = document.createElement("div");
    guideCard.style.cssText =
      "text-align: center; padding: 32px 18px; border: 1px dashed rgba(59,130,246,0.3); background: rgba(59,130,246,0.04); border-radius: 12px; display: flex; flex-direction: column; align-items: center;";
    guideCard.innerHTML = `
      <div style="font-size: 26px; margin-bottom: 8px;">👋</div>
      <div style="font-size: 14px; font-weight: 600; color: #f4f4f5; margin-bottom: 6px;">${ctx.t("welcomeFirstTimeTitle")}</div>
      <div style="font-size: 12px; color: #a1a1aa; line-height: 1.5; margin-bottom: 16px; max-width: 380px;">${ctx.t("welcomeFirstTimeDesc")}</div>
      <button class="comfymate-send-btn" id="cm-btn-first-add" style="padding: 8px 20px; font-size: 12.5px; font-weight: 600;">${ctx.t("addFirstProviderBtn")}</button>
    `;
    guideCard.querySelector("#cm-btn-first-add").addEventListener("click", () => {
      ctx.isAddingNew = true;
      ctx.editingProviderId = null;
      renderModelsPane(ctx, container);
    });
    listWrapper.appendChild(guideCard);
  }

  container.appendChild(listWrapper);

  // 2. Edit or Add Card (Simplified to OpenAI, Anthropic, and OpenAI-Compatible formats)
  if (ctx.editingProviderId || ctx.isAddingNew) {
    let targetP = null;

    if (ctx.isAddingNew) {
      targetP = {
        id: "provider_" + Date.now(),
        name: ctx.t("customProviderDefaultName"),
        api_type: "openai",
        base_url: "http://localhost:11434/v1",
        api_key: "",
        models: ["deepseek-r1:8b", "qwen2.5:7b"],
        temperature: 0.7,
        max_tokens: 4096,
      };
    } else {
      targetP = ctx.config.providers.find((pr) => pr.id === ctx.editingProviderId);
    }

    if (targetP) {
      let currentModels = Array.isArray(targetP.models) ? [...targetP.models] : [];
      let selectedModel = (currentModels.includes(ctx.config?.active_model) ? ctx.config.active_model : null) || currentModels[0] || "";
      const formCard = document.createElement("div");
      formCard.className = "cm-edit-card";

      let currentMode = "__custom__";
      if (targetP.api_type === "anthropic" || (targetP.name && targetP.name.toLowerCase().includes("anthropic"))) {
        currentMode = "anthropic";
      } else if (targetP.name === "OpenAI" && (!targetP.api_type || targetP.api_type === "openai")) {
        currentMode = "openai";
      }

      const isCustom = currentMode === "__custom__";
      const matchedPreset = findPreset(currentMode);

      const currentKeyPlaceholder = isCustom
        ? ctx.t("customKeyPlaceholder")
        : ((ctx.getEffectiveLang() === "en" ? matchedPreset?.key_placeholder_en : matchedPreset?.key_placeholder_zh) || ctx.t("cloudKeyPlaceholder"));

      formCard.innerHTML = `
        <!-- 1. Format Select (Only 3 options: OpenAI, Anthropic, OpenAI Compatible) -->
        <div class="comfymate-setting-group">
          <label class="comfymate-setting-label">${ctx.t("providerSelectLabel")}</label>
          <select class="comfymate-input" id="cm-edit-preset-select">
            <option value="openai" ${currentMode === "openai" ? 'selected' : ''}>${ctx.t("optOpenAI")}</option>
            <option value="anthropic" ${currentMode === "anthropic" ? 'selected' : ''}>${ctx.t("optAnthropic")}</option>
            <option value="__custom__" ${isCustom ? 'selected' : ''}>${ctx.t("optOpenAICompatible")}</option>
          </select>
        </div>

        <!-- 1.1 Custom Name (shown only if custom / compatible mode) -->
        <div class="comfymate-setting-group" id="cm-box-custom-name" style="display: ${isCustom ? 'flex' : 'none'};">
          <label class="comfymate-setting-label">${ctx.t("providerName")}</label>
          <input class="comfymate-input" id="cm-edit-custom-name" value="${isCustom ? (targetP.name || '') : ''}" placeholder="${ctx.t('customNamePlaceholder')}" />
        </div>

        <!-- 2. API Base URL (Directly visible and editable) -->
        <div class="comfymate-setting-group">
          <label class="comfymate-setting-label">${ctx.t("baseUrl")}</label>
          <input class="comfymate-input" id="cm-edit-url" value="${targetP.base_url || (matchedPreset ? matchedPreset.base_url : 'http://localhost:11434/v1')}" placeholder="http://localhost:11434/v1" />
        </div>

        <!-- 3. API Key -->
        <div class="comfymate-setting-group">
          <label class="comfymate-setting-label">${ctx.t("apiKey")}</label>
          <input
            type="text"
            class="comfymate-input"
            id="cm-edit-key"
            value="${targetP.api_key_masked || targetP.api_key || ''}"
            placeholder="${currentKeyPlaceholder}"
            autocomplete="off"
            spellcheck="false"
            style="font-family: ui-monospace, SFMono-Regular, Menlo, monospace;"
          />
        </div>

        <!-- 4. Available Models Manager (Visual Tags & Quick Add) -->
        <div class="comfymate-setting-group">
          <div class="cm-model-manager-card">
            <div class="cm-model-header-row">
              <div class="cm-model-header-left">
                <label class="comfymate-setting-label" style="margin:0;">${ctx.t("modelsList")}</label>
                <span class="cm-model-count-badge" id="cm-model-count"></span>
              </div>
              <div class="cm-model-header-actions">
                <button type="button" class="comfymate-pill" id="cm-btn-fetch" style="font-size:11px; color:#60a5fa; padding:2px 8px; cursor:pointer;">
                  ${ctx.t("fetchModels")}
                </button>
                <button type="button" class="cm-model-btn-clear" id="cm-btn-clear-models" title="${ctx.t("clearAllModels")}">
                  ${ctx.t("clearAllModels")}
                </button>
              </div>
            </div>

            <!-- Chips Container -->
            <div class="cm-model-chips-container" id="cm-model-chips"></div>

            <!-- Add Input Row -->
            <div class="cm-model-input-row">
              <input class="cm-model-add-input" id="cm-input-new-model" placeholder="${ctx.t("addModelPlaceholder")}" />
              <button type="button" class="cm-model-add-btn" id="cm-btn-add-model">${ctx.t("addModelBtn")}</button>
            </div>
          </div>
        </div>

        <!-- Footer Actions -->
        <div style="display:flex; justify-content:space-between; align-items:center; margin-top:8px;">
          <div>
            ${!ctx.isAddingNew ? `<button class="cm-card-btn danger" id="cm-btn-del-in-edit">${ctx.t("delBtn")}</button>` : ""}
          </div>
          <div style="display:flex; gap:8px;">
            <button class="cm-btn-ghost" id="cm-btn-cancel-edit">${ctx.t("cancel")}</button>
            <button class="cm-card-btn" id="cm-btn-test-edit" style="border:1px solid #3b82f6; color:#93c5fd; padding:6px 12px;">${ctx.t("testConn")}</button>
            <button class="comfymate-send-btn" id="cm-btn-save-edit" style="padding:6px 18px;">${ctx.t("save")}</button>
          </div>
        </div>
      `;

      const presetSelect = formCard.querySelector("#cm-edit-preset-select");
      const customNameBox = formCard.querySelector("#cm-box-custom-name");
      const customNameInput = formCard.querySelector("#cm-edit-custom-name");
      const urlInput = formCard.querySelector("#cm-edit-url");
      const keyInput = formCard.querySelector("#cm-edit-key");

      const chipsContainer = formCard.querySelector("#cm-model-chips");
      const countBadge = formCard.querySelector("#cm-model-count");
      const inputNewModel = formCard.querySelector("#cm-input-new-model");
      const btnAddModel = formCard.querySelector("#cm-btn-add-model");
      const btnClearModels = formCard.querySelector("#cm-btn-clear-models");

      function updateModelsView() {
        countBadge.textContent = ctx.t("modelsCount", { n: currentModels.length });
        chipsContainer.innerHTML = "";

        if (currentModels.length === 0) {
          selectedModel = "";
          const emptyTip = document.createElement("span");
          emptyTip.className = "cm-model-empty-tip";
          emptyTip.textContent = ctx.t("noModelsConfigured");
          chipsContainer.appendChild(emptyTip);
        } else {
          if (!selectedModel || !currentModels.includes(selectedModel)) {
            selectedModel = currentModels[0];
          }
          currentModels.forEach((modelName, index) => {
            const isSelected = modelName === selectedModel;
            const chip = document.createElement("span");
            chip.className = `cm-model-chip ${isSelected ? "active" : ""}`;
            chip.style.cursor = "pointer";
            chip.title = isSelected ? ctx.t("modelActiveTip") : ctx.t("modelSelectTip");

            const labelSpan = document.createElement("span");
            labelSpan.textContent = (isSelected ? "✓ " : "") + modelName;
            chip.appendChild(labelSpan);

            chip.addEventListener("click", () => {
              selectedModel = modelName;
              updateModelsView();
            });

            const delBtn = document.createElement("button");
            delBtn.type = "button";
            delBtn.className = "cm-model-chip-del";
            delBtn.title = ctx.t("delBtn");
            delBtn.textContent = "×";
            delBtn.addEventListener("click", (e) => {
              e.stopPropagation();
              currentModels.splice(index, 1);
              if (selectedModel === modelName) {
                selectedModel = currentModels[0] || "";
              }
              updateModelsView();
            });
            chip.appendChild(delBtn);

            chipsContainer.appendChild(chip);
          });
        }
      }

      function addModelFromInput() {
        const val = inputNewModel.value.trim();
        if (!val) return;
        const items = val.split(/[\r\n,]+/).map((s) => s.trim()).filter((s) => s.length > 0);
        let addedAny = false;
        items.forEach((item) => {
          if (!currentModels.includes(item)) {
            currentModels.push(item);
            addedAny = true;
          }
        });
        inputNewModel.value = "";
        if (addedAny) {
          if (!selectedModel && currentModels.length > 0) {
            selectedModel = currentModels[0];
          }
          updateModelsView();
        }
      }

      btnAddModel.addEventListener("click", addModelFromInput);
      inputNewModel.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          addModelFromInput();
        }
      });

      btnClearModels.addEventListener("click", () => {
        if (currentModels.length === 0) return;
        if (confirm(ctx.t("clearAllModelsConfirm"))) {
          currentModels = [];
          updateModelsView();
        }
      });

      updateModelsView();

      presetSelect.addEventListener("change", (e) => {
        const val = e.target.value;
        if (val === "__custom__") {
          customNameBox.style.display = "flex";
          if (!customNameInput.value) {
            customNameInput.value = ctx.t("customProviderDefaultName");
          }
          if (!urlInput.value || urlInput.value.includes("api.openai.com") || urlInput.value.includes("api.anthropic.com")) {
            urlInput.value = "http://localhost:11434/v1";
          }
          keyInput.placeholder = ctx.t("customKeyPlaceholder");
          if (ctx.isAddingNew || currentModels.length === 0) {
            currentModels = ["deepseek-r1:8b", "qwen2.5:7b"];
          }
        } else if (val === "openai") {
          customNameBox.style.display = "none";
          urlInput.value = "https://api.openai.com/v1";
          keyInput.placeholder = ctx.t("openaiKeyPlaceholder");
          if (ctx.isAddingNew || currentModels.length === 0) {
            currentModels = ["gpt-4o", "gpt-4o-mini", "o3-mini"];
          }
        } else if (val === "anthropic") {
          customNameBox.style.display = "none";
          urlInput.value = "https://api.anthropic.com/v1";
          keyInput.placeholder = ctx.t("anthropicKeyPlaceholder");
          if (ctx.isAddingNew || currentModels.length === 0) {
            currentModels = ["claude-3-7-sonnet-20250219", "claude-3-5-sonnet-20241022", "claude-3-5-haiku-20241022"];
          }
        }
        updateModelsView();
      });

      // Cancel
      formCard.querySelector("#cm-btn-cancel-edit").addEventListener("click", () => {
        ctx.editingProviderId = null;
        ctx.isAddingNew = false;
        renderModelsPane(ctx, container);
      });

      // Delete from within edit
      const delInEditBtn = formCard.querySelector("#cm-btn-del-in-edit");
      if (delInEditBtn) {
        delInEditBtn.addEventListener("click", () => {
          const displayName = getProviderDisplayName(targetP, ctx.getEffectiveLang());
          if (confirm(ctx.t("delConfirm", { name: displayName }))) {
            ctx.config.providers = ctx.config.providers.filter((pr) => pr.id !== targetP.id);
            if (ctx.config.active_provider_id === targetP.id) {
              const remaining =
                ctx.config.providers.find((pr) => ctx.isProviderConfigured(pr)) || ctx.config.providers[0];
              if (remaining) {
                ctx.config.active_provider_id = remaining.id;
                ctx.config.active_model = remaining.models[0] || "default";
              } else {
                ctx.config.active_provider_id = null;
                ctx.config.active_model = null;
              }
            }
            ctx.editingProviderId = null;
            ctx.isAddingNew = false;
            ctx.saveConfig();
            renderModelsPane(ctx, container);
          }
        });
      }

      // Test connection
      const testBtn = formCard.querySelector("#cm-btn-test-edit");
      testBtn.addEventListener("click", async () => {
        const origText = testBtn.textContent;
        testBtn.textContent = "⏳ " + ctx.t("testing");
        testBtn.disabled = true;
        const apiType = presetSelect.value === "anthropic" ? "anthropic" : "openai";
        const modelToTest = selectedModel || currentModels[0] || inputNewModel.value.trim() || "";
        try {
          await ctx.testConnection(targetP.id, apiType, urlInput.value.trim(), keyInput.value.trim(), modelToTest, currentModels);
        } finally {
          testBtn.textContent = origText;
          testBtn.disabled = false;
        }
      });

      // Fetch models
      formCard.querySelector("#cm-btn-fetch").addEventListener("click", async () => {
        const fetchBtn = formCard.querySelector("#cm-btn-fetch");
        const origText = fetchBtn.textContent;
        fetchBtn.textContent = "⏳...";
        fetchBtn.disabled = true;
        const apiType = presetSelect.value === "anthropic" ? "anthropic" : "openai";
        try {
          const data = await ctx.apiTestConnection({
            id: targetP.id,
            api_type: apiType,
            base_url: urlInput.value.trim(),
            api_key: keyInput.value.trim(),
            fetch_models_only: true,
          });
          if (data.status === "ok" && data.models && data.models.length > 0) {
            data.models.forEach((m) => {
              const cleanM = (typeof m === "string" ? m : (m.id || "")).trim();
              if (cleanM && !currentModels.includes(cleanM)) {
                currentModels.push(cleanM);
              }
            });
            if (!selectedModel && currentModels.length > 0) {
              selectedModel = currentModels[0];
            }
            updateModelsView();
            if (ctx.toast) {
              ctx.toast.success(ctx.t("fetchSuccess", { n: data.models.length }));
            }
          } else {
            if (ctx.toast) {
              ctx.toast.warning(ctx.t("fetchEmpty"));
            }
          }
        } catch (e) {
          if (ctx.toast) {
            ctx.toast.error(ctx.t("fetchFailed", { err: e.message }));
          }
        } finally {
          fetchBtn.textContent = origText;
          fetchBtn.disabled = false;
        }
      });

      // Save
      formCard.querySelector("#cm-btn-save-edit").addEventListener("click", () => {
        const chosenMode = presetSelect.value;
        const isCustomMode = chosenMode === "__custom__";
        let apiType = "openai";
        let newName = "";

        if (chosenMode === "anthropic") {
          apiType = "anthropic";
          newName = "Anthropic";
        } else if (chosenMode === "openai") {
          apiType = "openai";
          newName = "OpenAI";
        } else {
          apiType = "openai";
          newName = customNameInput.value.trim() || ctx.t("customProviderDefaultName");
        }

        const newUrl = urlInput.value.trim() || (chosenMode === "anthropic" ? "https://api.anthropic.com/v1" : (chosenMode === "openai" ? "https://api.openai.com/v1" : "http://localhost:11434/v1"));
        const newKey = keyInput.value.trim();

        targetP.api_type = apiType;
        targetP.name = newName;
        targetP.base_url = newUrl;
        targetP.api_key = newKey;
        targetP.models = [...currentModels];

        if (!isCustomMode && !newKey) {
          if (ctx.toast) {
            ctx.toast.warning(ctx.t("cloudUnconfiguredNotice"));
          }
        }

        if (ctx.isAddingNew) {
          ctx.config.providers.push(targetP);
          if (ctx.isProviderConfigured(targetP)) {
            ctx.config.active_provider_id = targetP.id;
            ctx.config.active_model = selectedModel || targetP.models[0] || null;
          }
        } else if (ctx.config.active_provider_id === targetP.id) {
          if (selectedModel && currentModels.includes(selectedModel)) {
            ctx.config.active_model = selectedModel;
          } else if (currentModels.length > 0) {
            ctx.config.active_model = currentModels[0];
          } else {
            ctx.config.active_model = null;
          }
        }

        ctx.saveConfig();
        ctx.editingProviderId = null;
        ctx.isAddingNew = false;
        renderModelsPane(ctx, container);
      });

      container.appendChild(formCard);
    }
  } else if (ctx.config.providers.length > 0) {
    // Add Provider Button
    const addBtn = document.createElement("button");
    addBtn.className = "cm-card-btn";
    addBtn.style.cssText =
      "padding: 12px; border: 1px dashed rgba(255,255,255,0.18); border-radius: 10px; width: 100%; font-weight: 600; color: #93c5fd; background: rgba(59,130,246,0.06);";
    addBtn.textContent = ctx.t("addProviderBtn");
    addBtn.onclick = () => {
      ctx.isAddingNew = true;
      ctx.editingProviderId = null;
      renderModelsPane(ctx, container);
    };
    container.appendChild(addBtn);
  }
}
