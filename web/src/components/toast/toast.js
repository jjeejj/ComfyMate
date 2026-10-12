/**
 * Modern non-blocking Toast notification system for ComfyMate.
 */

export function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

class ToastManager {
  constructor() {
    this.container = null;
  }

  _ensureContainer() {
    if (this.container && document.body.contains(this.container)) return;
    this.container = document.createElement("div");
    this.container.className = "cm-toast-container";
    document.body.appendChild(this.container);
  }

  show({ title = "", message = "", details = null, type = "info", duration = 4000 } = {}) {
    this._ensureContainer();

    const toast = document.createElement("div");
    toast.className = `cm-toast cm-toast-${type}`;

    let icon = "ℹ️";
    if (type === "success") icon = "✅";
    else if (type === "error") icon = "❌";
    else if (type === "warning") icon = "⚠️";

    toast.innerHTML = `
      <div class="cm-toast-icon">${icon}</div>
      <div class="cm-toast-content">
        ${title ? `<div class="cm-toast-title">${escapeHtml(title)}</div>` : ""}
        ${message ? `<div class="cm-toast-message">${escapeHtml(message)}</div>` : ""}
        ${details ? `<div class="cm-toast-details">${details}</div>` : ""}
      </div>
      <button class="cm-toast-close" type="button" title="Close">✕</button>
    `;

    const closeBtn = toast.querySelector(".cm-toast-close");
    let timer = null;

    const dismiss = () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      toast.classList.add("cm-toast-fadeout");
      setTimeout(() => {
        if (toast.parentNode) {
          toast.parentNode.removeChild(toast);
        }
      }, 250);
    };

    closeBtn.addEventListener("click", dismiss);
    this.container.appendChild(toast);

    if (duration > 0) {
      timer = setTimeout(dismiss, duration);
    }

    return dismiss;
  }

  success(message, title = "", duration = 4000) {
    return this.show({ message, title, type: "success", duration });
  }

  error(message, title = "", duration = 5000) {
    return this.show({ message, title, type: "error", duration });
  }

  warning(message, title = "", duration = 4000) {
    return this.show({ message, title, type: "warning", duration });
  }

  info(message, title = "", duration = 3500) {
    return this.show({ message, title, type: "info", duration });
  }
}

export const Toast = new ToastManager();
export const showToast = (opts) => {
  if (typeof opts === "string") {
    return Toast.info(opts);
  }
  return Toast.show(opts);
};
