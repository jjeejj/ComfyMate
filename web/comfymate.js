import { app } from "../../scripts/app.js";
import { ChatUI } from "./chat_ui.js";
import { I18nManager } from "./src/i18n/index.js";

console.log("[ComfyMate] Loading ComfyMate Web Extension...");

function getLocalText(key, params = {}) {
  const chat = window.__comfymate_instance;
  if (chat) return chat.t(key, params);
  const lang = I18nManager.detectComfyLanguage();
  return I18nManager.translate(key, params, lang);
}

app.registerExtension({
  name: "ComfyMate.Assistant",
  commands: [
    {
      id: "comfymate.toggle",
      icon: "pi pi-sparkles",
      label: "✨ ComfyMate AI Copilot",
      function: () => {
        window.__comfymate_instance?.toggle();
      },
      defaultShortcut: "Alt+C",
    },
  ],
  menuCommands: [
    {
      path: ["Extensions", "✨ ComfyMate AI Copilot"],
      commands: ["comfymate.toggle"],
    },
  ],
  getCanvasMenuItems() {
    return [
      {
        content: getLocalText("canvasMenuToggle"),
        callback: () => {
          window.__comfymate_instance?.toggle();
        },
      },
    ];
  },
  getNodeMenuItems(node) {
    return [
      {
        content: getLocalText("nodeMenuExplain"),
        callback: () => {
          window.__comfymate_instance?.toggle(true);
          const prompt = getLocalText("promptExplainNode", { id: node.id, name: node.title || node.type });
          window.__comfymate_instance?.sendMessage(prompt);
        },
      },
    ];
  },
  afterConfigureGraph() {
    window.__comfymate_instance?.onGraphOrWorkflowChanged();
  },
  nodeCreated() {
    window.__comfymate_instance?.onGraphOrWorkflowChanged();
  },
  graphChanged() {
    window.__comfymate_instance?.onGraphOrWorkflowChanged();
  },
  async setup() {
    console.log("[ComfyMate] Setting up extension...");

    // 1. Inject Stylesheet
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = new URL("./comfymate.css", import.meta.url).href;
    document.head.appendChild(link);

    // 2. Initialize Chat UI
    const chatUI = new ChatUI(app);
    window.__comfymate_instance = chatUI;
    await chatUI.ready;

    // Staggered boot checks to ensure active workflow tab is picked up as soon as ComfyUI mounts
    setTimeout(() => chatUI.onGraphOrWorkflowChanged(), 350);
    setTimeout(() => chatUI.onGraphOrWorkflowChanged(), 1000);
    setTimeout(() => chatUI.onGraphOrWorkflowChanged(), 2500);

    // 3. Right-edge sleek drawer handle (Always visible, clean and non-intrusive)
    const addEdgeDrawerHandle = () => {
      // Clean up top bar button if it exists
      const existingTopBtn = document.querySelector("#cm-topbar-btn");
      if (existingTopBtn) existingTopBtn.remove();

      if (document.querySelector("#cm-edge-handle")) return;
      const handle = document.createElement("div");
      handle.id = "cm-edge-handle";
      handle.innerHTML = `<span>✨</span><span style="font-size:11px; writing-mode: vertical-rl; letter-spacing:1px; margin-top:3px;">ComfyMate</span>`;
      handle.title = chatUI.t("drawerTooltip");
      handle.style.cssText = `
        position: fixed;
        right: 0;
        top: 45%;
        transform: translateY(-50%);
        z-index: 999999;
        display: flex;
        flex-direction: column;
        align-items: center;
        padding: 10px 5px;
        border-radius: 8px 0 0 8px;
        background: linear-gradient(180deg, #2563eb, #1d4ed8);
        color: #ffffff;
        border: 1px solid rgba(255, 255, 255, 0.25);
        border-right: none;
        cursor: pointer;
        font-weight: 600;
        font-size: 12px;
        box-shadow: -4px 4px 18px rgba(0, 0, 0, 0.5);
        transition: transform 0.15s ease, box-shadow 0.15s ease, background 0.15s ease;
      `;
      handle.onmouseover = () => {
        handle.style.transform = "translateY(-50%) translateX(-3px)";
        handle.style.boxShadow = "-6px 6px 22px rgba(37, 99, 235, 0.6)";
      };
      handle.onmouseout = () => {
        handle.style.transform = "translateY(-50%) translateX(0)";
        handle.style.boxShadow = "-4px 4px 18px rgba(0, 0, 0, 0.5)";
      };
      handle.onclick = () => {
        chatUI.toggle();
      };
      document.body.appendChild(handle);
    };

    addEdgeDrawerHandle();
    let retries = 0;
    const handleInterval = setInterval(() => {
      retries++;
      addEdgeDrawerHandle();
      if (document.querySelector("#cm-edge-handle") || retries >= 10) {
        clearInterval(handleInterval);
      }
    }, 1500);

    console.log("[ComfyMate] Extension setup complete!");
  },
});
