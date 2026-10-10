# ComfyMate 🤖

[ English | [简体中文](README_CN.md) ]

> **ComfyMate is an embedded AI copilot that truly understands your ComfyUI workflow.**  
> Effortlessly inspect canvas topology, understand complex node configurations, and troubleshoot runtime errors in real time without leaving ComfyUI.

---

## 🌟 Why ComfyMate?

Most AI chat plugins simply open a detached LLM window where you have to manually copy and paste node names, parameters, or terminal errors. 

**ComfyMate is different.** It is deeply integrated into the ComfyUI canvas:
- 🧠 **Canvas Topology Awareness**: Automatically parses nodes, parameter values, and connection links into an ultra-compact representation.
- 🎯 **Selected Node Focus**: Click any node on the canvas, and ComfyMate immediately isolates its inputs, outputs, and parameters.
- 🔍 **Click-to-Locate & Visual Pulsing**: Click interactive node badges (`Node #3 [KSampler]`) in chat to automatically pan, center, and highlight the node on canvas with a pulsing blue outline.
- ⚡ **One-Click Parameter Apply & Undo**: AI-recommended parameters are rendered as interactive action cards. Apply changes to LiteGraph widgets with a single click, with instant rollback support.
- 🩺 **Workflow Doctor**: Pre-run static graph health check detecting disconnected inputs, unlinked VAE/CLIP ports, invalid dimensions, empty prompts, and orphan nodes.
- 🖼️ **Multimodal Vision Chat**: Paste images directly from clipboard (`Cmd+V` / `Ctrl+V`) or drag & drop screenshots to ask AI about generated results, error popups, or node setups.
- 💾 **Update-Safe Persistent Storage**: Configurations, conversations, and attachments automatically persist in ComfyUI's standard user directory (`ComfyUI/user/default/comfymate/`), completely immune to updates, re-clones, or registry reinstalls.
- 🚨 **One-Click Error Diagnostics**: Automatically intercepts ComfyUI execution errors and stack traces, pinpointing missing models, dimension mismatches, or invalid parameters.
- 🏠 **Local-First & Private**: First-class support for local LLM engines like **Ollama** and **LM Studio**. Your workflow data and prompts never have to leave your machine.
- ⚡ **Multi-Provider Cloud Support**: Native support for **OpenAI**, **Anthropic Claude**, **DeepSeek**, **OpenRouter**, **SiliconFlow**, and any OpenAI-compatible API.
- 🗜️ **Token-Efficient Compression**: Proprietary graph serialization compresses heavy raw graph data by over 80%, ensuring fast inference and minimal token usage.

---

## 🚀 Installation

### Option 1: Git Clone (Recommended)

1. Navigate to the `custom_nodes` folder inside your ComfyUI root directory:
   ```bash
   cd ComfyUI/custom_nodes/
   git clone https://github.com/jjeejj/ComfyMate.git
   ```
2. Restart ComfyUI.

*(Dependencies: ComfyMate relies only on standard Python libraries and `aiohttp`, which is already bundled with ComfyUI).*

### Option 2: Comfy Registry / Nodes Manager (Recommended)

ComfyMate can be installed directly from the official [Comfy Registry](https://registry.comfy.org):
```bash
comfy node registry-install comfymate
```
Or search for `ComfyMate` in ComfyUI Nodes Manager / ComfyUI-Manager, click **Install**, and restart ComfyUI.  
> For publishing instructions, refer to the [Publishing Guide](docs/PUBLISHING.md).

---

## 📖 How to Use

ComfyMate is designed to be zero-friction and intuitive. Here is the step-by-step guide to get the most out of it:

### 1. Opening the Assistant

You can open the ComfyMate panel at any time using any of the following methods:

| Method | How to Trigger |
| :--- | :--- |
| **Right-Edge Drawer** | Click the sleek vertical **`✨ ComfyMate`** tab on the right edge of your screen. |
| **Keyboard Shortcut** | Press **`Alt + C`** (Windows / Linux) or **`⌥ Option + C`** (macOS). *(Also supports `Cmd/Ctrl + J`, `Alt/Option + M`, `Cmd/Ctrl + Shift + M`)*. |
| **Node Right-Click Menu** | Right-click any node on canvas &rarr; select **`✨ Explain this Node with ComfyMate`** (auto-opens & asks). |
| **Canvas Right-Click Menu** | Right-click any empty canvas area &rarr; select **`✨ Toggle ComfyMate Copilot`**. |
| **Top Menu Bar** | Navigate to `Extensions` &rarr; **`✨ ComfyMate AI Copilot`**. |

> **Tip:** You can drag the left edge of the ComfyMate panel to resize it to your preferred width. Your width preference is automatically saved.

---

### 2. Quick Setup: Configure Your LLM Provider

1. Open ComfyMate and click the **⚙️ Settings** icon in the top header (or click the settings button in the welcome message).
2. Choose either a **Local Model** (private & free) or a **Cloud API**:

#### A. Local LLM (Ollama / LM Studio) — Recommended for Privacy
- **Ollama**:
  - **API Type**: `OpenAI-Compatible`
  - **Base URL**: `http://localhost:11434/v1`
  - **API Key**: `ollama` (or any placeholder string)
  - **Model**: `deepseek-r1:8b`, `llama3:8b`, `qwen2.5:7b`, etc.
- **LM Studio**:
  - **Base URL**: `http://localhost:1234/v1`
  - **API Key**: `lm-studio`
  - **Model**: Your loaded local model ID.

#### B. Cloud LLM Providers
- **DeepSeek**:
  - **Base URL**: `https://api.deepseek.com`
  - **API Key**: `sk-***`
  - **Model**: `deepseek-chat` or `deepseek-reasoner`
- **OpenAI**:
  - Select the **OpenAI** preset, enter your API key, and select models like `gpt-4o` or `o3-mini`.
- **Anthropic (Claude)**:
  - Select the **Anthropic** preset, enter your API key, and use models like `claude-3-7-sonnet-20250219`.
- **OpenRouter / SiliconFlow / Other Compatible Services**:
  - Fill in the respective Base URL, API key, and model name.

3. Click **Test Connection** to ensure connectivity, then click **Save**.
4. *(Optional)* Switch between configured models instantly using the **Model Selector** dropdown at the top of the chat panel.

---

### 3. Everyday Use Cases & Interactions

#### Scenario A: Understanding an Unfamiliar Workflow
When you download a new workflow from Civitai or a friend:
1. Load the workflow onto your canvas.
2. Click the **`🗺️ Explain Workflow`** quick pill (or ask: *"Explain the pipeline and data flow of this workflow"*).
3. ComfyMate analyzes the entire topology (e.g. Checkpoint Loader &rarr; CLIP Text Encode &rarr; KSampler &rarr; VAE Decode &rarr; Save Image) and explains what the workflow does step-by-step.

#### Scenario B: Inspecting Specific Nodes and Parameters
Not sure what a particular node does or how its parameters affect output:
1. **Click to select** the node on your canvas.
2. Notice the context badge update to **`[Selected: 1 node]`**.
3. Click the **`🎯 Explain Selected`** quick pill, or right-click the node and select **`✨ Explain this Node with ComfyMate`**.
4. Ask detailed questions, such as:
   - *"What does the `denoise` parameter in this KSampler do?"*
   - *"Where does the model input of this node come from?"*
   - *"Why is the Latent output connected here?"*

#### Scenario C: One-Click Runtime Error Troubleshooting
When a workflow execution fails:
1. ComfyMate automatically captures the failure event and stack trace.
2. The red **`[🚨 Error Detected]`** tag lights up in the context bar.
3. Click the **`🚨 Diagnose Error`** quick pill (or ask: *"Why did the generation fail?"*).
4. ComfyMate analyzes the error trace and offending node, pinpointing reasons such as:
   - Missing checkpoint / LoRA / ControlNet model files
   - Tensor dimension mismatches (e.g. VAE latent size vs image size)
   - Missing input connections or type mismatches
   - CUDA out-of-memory or custom node version conflicts
   - Clear, step-by-step instructions on how to resolve the issue.

#### Scenario D: Workflow Modification & Expansion Guidance
Looking to enhance your generation pipeline:
- *"How can I convert this Text-to-Image workflow into an Image-to-Image workflow?"*
- *"Where should I insert an IP-Adapter or ControlNet node in this setup?"*
- *"How do I add a Hi-Res Fix / Ultimate SD Upscale step?"*

#### Scenario E: Multimodal Clipboard & Screenshot Chat
Got an artifact in your output image or an error popup?
1. Copy the image or take a screenshot (<kbd>Cmd+Ctrl+Shift+4</kbd> on macOS or <kbd>Win+Shift+S</kbd> on Windows).
2. Paste directly into the ComfyMate prompt box (<kbd>Cmd+V</kbd> / <kbd>Ctrl+V</kbd>) or drag and drop image files.
3. An image preview card will appear right above the input box (supports up to 4 images).
4. Ask vision-capable models (e.g., `gpt-4o`, `claude-3-7-sonnet`, or local vision models):
    - *"The hands in this generated image look deformed. Based on my workflow, what negative prompt or inpaint node should I use to fix it?"*
    - *"Is this node parameter configuration optimal for SDXL?"*

#### Scenario F: Pre-Run Workflow Health Check (Workflow Doctor)
Before spending time rendering or waiting for long queues:
1. Click the **`🩺 Workflow Doctor`** quick pill (or ask: *"Check my workflow for any issues"*).
2. ComfyMate statically analyzes graph links, node configurations, and prompt inputs.
3. Instantly spots common hidden bugs:
   - Disconnected KSampler inputs (missing Model, Positive, Negative, or Latent).
   - Unlinked VAE or CLIP connections.
   - Empty positive or negative text prompts.
   - Non-standard latent dimensions (dimensions not divisible by 8 or 64).
   - Floating orphan nodes cluttering the canvas.
4. Generates an organized health report with actionable recommendations to fix each issue.

#### Scenario G: Click-to-Locate Nodes & One-Click Parameter Apply
Interact bidirectionally with your canvas through AI responses:
1. **Click-to-Locate**: Whenever ComfyMate mentions a node (e.g. `Node #3 [KSampler]`), click the blue node badge in the chat bubble. The canvas camera instantly pans, centers, and triggers a pulsing blue outline on that exact node.
2. **One-Click Parameter Apply**: When ComfyMate suggests parameter optimizations (e.g., adjusting `cfg: 7.0`, `steps: 25`, or `denoise: 0.65`), an interactive action card appears. Click **`⚡ Apply Changes`** to write the parameters directly into the node's widgets on canvas.
3. **Safe Rollback**: Changed your mind? Click **`↩️ Undo`** on the action card to instantly restore the previous parameter values.

---

### 4. General Settings & Personalization

In the **⚙️ Settings &rarr; General** tab, you can customize:
- **Language**: Choose between **Auto** (auto-detects ComfyUI interface or browser language), **简体中文**, or **English**.
- **Temperature Slider**: Adjust response style from **Precise** (0.2) to **Balanced** (0.7) to **Creative** (1.2+).
- **Max Output Tokens**: Select between `2048`, `4096` (recommended), `8192`, or `16384` tokens.
- **Clear Chat (🗑️)**: Reset the conversation history at any time.
- **Stop Generation**: Stop streaming text at any time by clicking the Stop button.

---

## ⚙️ Provider Configuration Reference

| Provider | Base URL | Model Examples | Notes |
| :--- | :--- | :--- | :--- |
| **Ollama** *(Local)* | `http://localhost:11434/v1` | `deepseek-r1:8b`, `qwen2.5:7b` | Free, 100% private, no API key required |
| **LM Studio** *(Local)* | `http://localhost:1234/v1` | Loaded model identifier | Start local server in LM Studio first |
| **DeepSeek** | `https://api.deepseek.com` | `deepseek-chat`, `deepseek-reasoner` | High performance & very cost-effective |
| **OpenAI** | `https://api.openai.com/v1` | `gpt-4o`, `gpt-4o-mini`, `o3-mini` | Requires OpenAI API key |
| **Anthropic** | `https://api.anthropic.com/v1` | `claude-3-7-sonnet-20250219` | Native Claude Messages format supported |
| **OpenRouter** | `https://openrouter.ai/api/v1` | Any OpenRouter model ID | Access to dozens of models via single key |


---

## 🛣️ Roadmap

- [x] **v0.1.0 (Core Diagnostics & Multimodal)**:
  - Canvas topology extraction & token-efficient compression
  - Selected node context focus & canvas context menu
  - Real-time execution error capture & auto-diagnosis
  - Multi-provider support (Ollama, DeepSeek, OpenAI, Anthropic, OpenRouter)
  - Multimodal clipboard & screenshot vision chat
  - Draggable panel resizer & global shortcuts
- [x] **v0.2.0 (Canvas Interaction & Diagnostics)**:
  - 🎯 Click-to-locate node with canvas centering & pulsing visual highlight
  - ⚡ One-click parameter recommendation & apply with undo rollback
  - 🩺 Workflow Doctor: Pre-run static graph health check & missing link detection
  - 💾 Update-safe persistent storage under ComfyUI user directory (`user/default/comfymate/`)
  - 🧩 Component-based HTML template separation & dynamic i18n compilation
- [ ] **v0.3.0 (Knowledge & RAG)**:
  - Built-in documentation indexing for core ComfyUI nodes & popular custom nodes
  - Community node library lookup & recommended templates
- [ ] **v0.4.0 (Autonomous Workflow Agent)**:
  - AI-assisted node placement, parameter adjustment, and auto-wiring
  - One-click workflow layout tidying & sub-graph optimization
  - Closed-loop generation, multimodal output evaluation, and iterative parameter tuning

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).
