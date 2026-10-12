import { renderModelsPane } from "./models_pane.js";
import { renderGeneralPane } from "./general_pane.js";
import { loadTemplate, renderTemplate } from "../../utils/template_loader.js";

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
    if (this.ctx._owner && typeof this.ctx._owner._renderModelSelector === "function") {
      this.ctx._owner._renderModelSelector();
    }
  }

  isOpen() {
    return !this.modalEl.classList.contains("hidden");
  }

  switchTab(tabName) {
    this.currentTab = tabName;
    const body = this.modalEl.querySelector("#cm-dialog-pane-body");
    const title = this.modalEl.querySelector("#cm-pane-title");
    const subtitle = this.modalEl.querySelector("#cm-pane-subtitle");

    this.modalEl.querySelectorAll(".cm-nav-item").forEach((item) => {
      if (item.getAttribute("data-tab") === tabName) {
        item.classList.add("active");
      } else {
        item.classList.remove("active");
      }
    });

    if (tabName === "general") {
      title.textContent = this.ctx.t("navGeneral");
      subtitle.textContent = this.ctx.t("generalSubtitle");
      renderGeneralPane(this.ctx, body);
    } else {
      title.textContent = this.ctx.t("modelsTitle");
      subtitle.textContent = this.ctx.t("modelsSubtitle");
      renderModelsPane(this.ctx, body);
    }
  }

  refresh() {
    if (this.isOpen()) {
      this.switchTab(this.currentTab);
    }
  }
}
