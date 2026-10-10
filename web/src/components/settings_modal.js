import { renderModelsPane } from "./settings/models_pane.js";
import { renderGeneralPane } from "./settings/general_pane.js";
import { loadTemplate, renderTemplate } from "../utils/template_loader.js";

/**
 * Settings Modal Dialog Controller.
 */
export class SettingsModal {
  constructor(appContext) {
    this.ctx = appContext;
    this.modalEl = null;
    this.currentTab = "models";
    this.ready = this._createDOM();
  }

  async _createDOM() {
    this.modalEl = document.createElement("div");
    this.modalEl.className = "comfymate-modal-backdrop hidden";
    this.modalEl.id = "cm-settings-dialog-backdrop";

    const rawTemplate = await loadTemplate("./settings_modal.html", import.meta.url);
    this.modalEl.innerHTML = renderTemplate(rawTemplate, (k) => this.ctx.t(k));
    document.body.appendChild(this.modalEl);

    // Close buttons & backdrop click
    this.modalEl.querySelector("#cm-modal-close").addEventListener("click", () => this.close());
    this.modalEl.addEventListener("click", (e) => {
      if (e.target === this.modalEl) this.close();
    });

    // Sidebar navigation tabs
    this.modalEl.querySelectorAll(".cm-nav-item").forEach((item) => {
      item.addEventListener("click", (e) => {
        const tab = e.currentTarget.getAttribute("data-tab");
        this.switchTab(tab);
      });
    });
  }

  async open(tab = "models") {
    await this.ready;
    this.modalEl.classList.remove("hidden");
    this.switchTab(tab);
  }

  close() {
    this.modalEl.classList.add("hidden");
    this.ctx.editingProviderId = null;
    this.ctx.isAddingNew = false;
  }

  isOpen() {
    return !this.modalEl.classList.contains("hidden");
  }

  switchTab(tabName) {
    this.currentTab = tabName;
    this.modalEl.querySelectorAll(".cm-nav-item").forEach((item) => {
      if (item.getAttribute("data-tab") === tabName) {
        item.classList.add("active");
      } else {
        item.classList.remove("active");
      }
    });

    const titleEl = this.modalEl.querySelector("#cm-pane-title");
    const subtitleEl = this.modalEl.querySelector("#cm-pane-subtitle");
    const bodyEl = this.modalEl.querySelector("#cm-dialog-pane-body");

    if (tabName === "models") {
      titleEl.textContent = this.ctx.t("modelsTitle");
      subtitleEl.textContent = this.ctx.t("modelsSubtitle");
      renderModelsPane(this.ctx, bodyEl);
    } else if (tabName === "general") {
      titleEl.textContent = this.ctx.t("generalTitle");
      subtitleEl.textContent = this.ctx.t("generalSubtitle");
      renderGeneralPane(this.ctx, bodyEl);
    }
  }

  updateText() {
    if (!this.modalEl) return;
    this.modalEl.querySelector("#cm-txt-set-title").textContent = this.ctx.t("settingsTitle");
    this.modalEl.querySelector("#cm-tab-general").textContent = this.ctx.t("navGeneral");
    this.modalEl.querySelector("#cm-tab-models").textContent = this.ctx.t("navModels");
  }
}
