# ComfyMate 🤖

[ [English](README.md) | 简体中文 ]

> **ComfyMate 是一个深度嵌入 ComfyUI 画布、真正懂工作流上下文的 AI 智能助手。**  
> 无需离开 ComfyUI 界面，即可实时感知画布拓扑、深度解析节点连接与参数含义、秒级一键排查运行时报错。

---

## 🌟 为什么选择 ComfyMate？

市面上的很多 AI 聊天插件只是一个独立的悬浮聊天窗，每次遇到问题都需要手动复制粘贴节点名称、参数、甚至冗长的终端报错日志。

**ComfyMate 完全不同。** 它作为 ComfyUI 原生扩展，与画布底层深度绑定：
- 🧠 **工作流拓扑自动感知**：自动将当前画布中复杂的节点网络、连线关系和参数配置提取为高密度 DSL，AI 真正看懂“数据从哪里来、流向哪里”。
- 🎯 **选中节点精准聚焦**：在画板中点击任意节点，ComfyMate 立即捕获该节点及其上下游所有输入输出，有针对性地回答细节。
- 🖼️ **多模态视觉直连 (Vision)**：支持直接从剪贴板粘贴（`Cmd+V` / `Ctrl+V`）或拖拽图片到输入框，与 AI 探讨生图效果对比、节点配置截图或报错图像。
- 💾 **本地持久化会话管理 (Multi-Session)**：消息记录与附件 100% 自动落盘至本地硬盘（`storage/sessions/`），按会话独立归档。支持随时「➕ 新建会话」与「🕒 历史会话抽屉」，彻底告别浏览器 LocalStorage 5MB 配额上限与缓存清理丢失。
- 🚨 **报错一键自动诊断**：自动捕获 ComfyUI 执行异常与堆栈日志，逆向回溯推导模型缺失、尺寸不匹配、未连接或配置错误。
- 🏠 **本地模型优先 (Local-First)**：深度适配 **Ollama** 与 **LM Studio**，工作流结构与生图提示词 100% 留在本地，安全且零调用成本。
- ⚡ **主流云端大模型全兼容**：原生支持 **DeepSeek**、**OpenAI**、**Anthropic (Claude)**、**OpenRouter**、**SiliconFlow (硅基流动)** 等任意兼容 OpenAI 规范的 API。
- 🗜️ **超高压缩比拓扑算法**：过滤冗余的坐标、尺寸和样式数据，画布上下文压缩率超 80%+，大幅节省 Token 消耗并加速推理。

---

## 🚀 安装指南

### 方法 1：Git Clone 安装（推荐）

1. 打开终端，进入你的 ComfyUI 根目录下的 `custom_nodes` 文件夹：
   ```bash
   cd ComfyUI/custom_nodes/
   git clone https://github.com/jjeejj/ComfyMate.git
   ```
2. 重启 ComfyUI 即可。

*(依赖说明：ComfyMate 仅依赖 Python 标准库及 ComfyUI 原生自带的 `aiohttp`，无需额外安装繁琐依赖)。*

### 方法 2：Comfy Registry / Nodes Manager 安装（推荐）

ComfyMate 支持通过现代官方 [Comfy Registry](https://registry.comfy.org) 一键安装：
```bash
comfy node registry-install comfymate
```
在 ComfyUI 官方 Nodes Manager / ComfyUI-Manager 搜索框输入 `ComfyMate`，点击 **Install** 即可。  
> 详细发布与维护指南请参阅 [发布文档 (Publishing Guide)](docs/PUBLISHING.md)。

---

## 📖 使用说明 (How to Use)

ComfyMate 设计追求极致的顺手与零心智负担。以下是完整的使用流程与核心功能说明：

### 1. 唤出/隐藏助手面板

你可以通过以下任意一种便捷方式随时打开 ComfyMate：

| 唤出方式 | 操作方法 |
| :--- | :--- |
| **右侧边吸附把手** | 点击屏幕右侧边居中的 **`✨ ComfyMate`** 垂直把手标签（不遮挡主画布，随时可点）。 |
| **全局快捷键** | 按 **`Alt + C`**（Windows / Linux）或 **`⌥ Option + C`**（macOS）。<br>*(同时也支持 `Cmd/Ctrl + J`、`Alt/Option + M`、`Cmd/Ctrl + Shift + M`，按 `Esc` 可快速收起)*。 |
| **节点右键菜单** | 右键点击画布中的任意节点 &rarr; 选择 **`✨ Explain this Node with ComfyMate`**（自动唤出并针对该节点提问）。 |
| **画布空白处右键** | 右键点击画布空白区域 &rarr; 选择 **`✨ Toggle ComfyMate Copilot`**。 |
| **顶部扩展菜单** | 点击顶部菜单栏的 `Extensions` &rarr; **`✨ ComfyMate AI Copilot`**。 |

> **提示：** 拖拽 ComfyMate 面板左边缘可自由调整窗口宽度，面板会自动记忆你的宽度偏好。

---

### 2. 快速上手：配置 LLM 模型

首次使用时，点击面板顶部的 **⚙️ 设置图标**（或欢迎气泡中的“前往配置”按钮）：

#### 选项 A：本地模型 (Ollama / LM Studio) —— 推荐（私密、免费）
- **Ollama**：
  - **接口协议**：`OpenAI-Compatible`
  - **Base URL**：`http://localhost:11434/v1`
  - **API Key**：填写任意字符（如 `ollama`）
  - **模型名称**：填写本地已拉取的模型，如 `deepseek-r1:8b`、`llama3:8b`、`qwen2.5:7b` 等。
- **LM Studio**：
  - **Base URL**：`http://localhost:1234/v1`
  - **API Key**：`lm-studio`
  - **模型名称**：填写 LM Studio 中启动的模型标识。

#### 选项 B：云端模型 API
- **DeepSeek**：
  - **Base URL**：`https://api.deepseek.com`
  - **API Key**：填写你的 DeepSeek API Key（`sk-***`）
  - **模型名称**：`deepseek-chat` 或 `deepseek-reasoner`
- **OpenAI**：
  - 选择预设 **OpenAI**，填入 API Key，并选择 `gpt-4o`、`gpt-4o-mini` 或 `o3-mini`。
- **Anthropic (Claude)**：
  - 选择预设 **Anthropic**，填入 API Key，并选择 `claude-3-7-sonnet-20250219` 等模型。
- **OpenRouter / 硅基流动 / 其它中转**：
  - 填入对应服务商的 Base URL、API Key 与模型名称即可。

填写后点击 **测试连接**，验证无误后点击 **保存配置**。  
在聊天界面顶部，你可以通过 **模型切换下拉框** 随时无缝切换正在使用的模型。

---

### 3. 典型使用场景与交互指南

#### 场景 1：解读复杂/陌生工作流
当你从开源社区下载了一个复杂的节点流，不知道整体执行逻辑：
1. 在 ComfyUI 中载入该工作流。
2. 打开 ComfyMate，点击快捷操作胶囊 **`🗺️ 解释工作流`**（或直接在输入框发送：*“帮我梳理这个工作流的整体逻辑和生图链路”*）。
3. ComfyMate 会全盘分析节点拓扑（如 Checkpoint 加载 &rarr; CLIP 提示词编码 &rarr; KSampler 采样 &rarr; VAE 解码 &rarr; 图像后处理），输出清晰的模块化讲解。

#### 场景 2：探究具体节点的作用与参数
遇到不熟悉的节点（例如各种采样器、LoRA 堆叠器、ControlNet 预处理器）：
1. 在画布上**鼠标单选或框选**目标节点。
2. 观察面板顶部的上下文标签，会实时更新为 **`[已选节点: 1个]`**。
3. 点击 **`🎯 解释选中节点`**，或直接右键节点选择 **`✨ Explain this Node with ComfyMate`**。
4. 可以进一步追问深入问题：
   - *“这个 KSampler 中的 cfg 和 denoise 参数在这套工作流里具体起什么作用？”*
   - *“为什么这个节点的 latent 输入不是直接来自 Empty Latent？”*
   - *“这个 ControlNet 的 strength 推荐设置在什么范围？”*

#### 场景 3：运行报错一键排查定位
运行 ComfyUI 遇到红色节点报错时：
1. ComfyMate 会在后台自动拦截本次运行的异常堆栈与出错节点 ID。
2. 面板上下文状态栏亮起红色的 **`[🚨 检测到报错]`** 标签。
3. 点击 **`🚨 排查报错`** 胶囊按钮（或直接询问：*“刚才运行为什么报错了？”*）。
4. AI 会精确指出：
   - 报错节点名称与节点编号（如 `KSampler (#3)`）；
   - 导致错误的根本原因（例如：模型权重文件缺失、张量分辨率不兼容、VAE 格式不匹配、未连线的必要输入端口、显存超限等）；
   - 具体一步一步的修复步骤。

#### 场景 4：改造与扩展工作流建议
想要给现有工作流添加新能力：
- *“我想把这个文生图工作流改成图生图，需要替换或增加哪些节点？”*
- *“我想给这个人物生图加上 Face Detailer 面部重绘，应该怎么连线？”*
- *“如何在这个工作流里串联放大算法（Hi-Res Fix）？”*

#### 场景 5：剪贴板图片多模态直接对话
遇到生图瑕疵、复杂节点参数配置或界面错误：
1. 复制生图结果、局部截图或错误弹窗（支持微信/QQ/系统截图工具 `Cmd+Ctrl+Shift+4` 或 `Win+Shift+S`）。
2. 在 ComfyMate 输入框直接按 **`Cmd + V`**（或 **`Ctrl + V`**），或直接从桌面**拖拽图片**放入输入框。
3. 输入框上方将即时显示图片卡片缩略图（支持多图，最多 4 张）。
4. 向支持 Vision 的模型（如 `gpt-4o`、`claude-3-7-sonnet` 或本地视觉模型）提问：
   - *“这张生图的人物手指出现畸变，结合我当前工作流，推荐用哪个 Negative 提示词或 Inpaint 节点修复？”*
   - *“帮我看一下截图里的这个自定义节点参数设置是否合理？”*

---

### 4. 通用设置与个性化调节

在 **⚙️ 设置 &rarr; 常规设置** 中，可进行个性化调整：
- **显示语言**：支持 **自动检测**（自动跟随 ComfyUI 语言设置或浏览器语言）、**简体中文** 与 **English**。
- **温度值 (Temperature)**：可拖动滑块从 0.0 至 1.5 自由调节，附带【严谨 0.2】、【平衡 0.7】、【发散 1.2】预设提示。
- **最大生成长度 (Max Output Tokens)**：支持 2048、4096（推荐）、8192 或 16384 Tokens。
- **清空历史 (🗑️)**：点击面板右上角垃圾桶图标，随时开启新一轮对话。
- **停止生成**：模型生成过程中，发送按钮会自动切换为“停止”，随时打断输出。

---

## ⚙️ 常见模型服务商配置对照表

| 服务商 | Base URL | 推荐模型示例 | 说明 |
| :--- | :--- | :--- | :--- |
| **Ollama** *(本地)* | `http://localhost:11434/v1` | `deepseek-r1:8b`, `qwen2.5:7b` | 免费、私密、纯离线、无需密钥 |
| **LM Studio** *(本地)* | `http://localhost:1234/v1` | 界面加载的模型名称 | 本地需开启 Local Server |
| **DeepSeek** | `https://api.deepseek.com` | `deepseek-chat`, `deepseek-reasoner` | 极高性价比与出色中文理解 |
| **OpenAI** | `https://api.openai.com/v1` | `gpt-4o`, `gpt-4o-mini`, `o3-mini` | 需要 OpenAI API 密钥 |
| **Anthropic** | `https://api.anthropic.com/v1` | `claude-3-7-sonnet-20250219` | 原生 Claude Messages 协议支持 |
| **OpenRouter** | `https://openrouter.ai/api/v1` | 任选支持模型 | 一个 Key 聚合全球数十种大模型 |


---

## 🛣️ 发展路线 (Roadmap)

- [x] **v0.1.0 (当前版本)**：
  - 画布拓扑轻量化提取与智能压缩
  - 选中节点上下文精准捕获与右键菜单直达
  - 执行异常与错误日志自动拦截排查
  - 多模型服务商支持 (Ollama, DeepSeek, OpenAI, Anthropic, OpenRouter 等)
  - 顶栏快速模型切换器
  - 边框拖拽调节与全局快捷键体系
- [ ] **v0.2.0 (知识库与 RAG 检索)**：
  - 官方核心节点与主流 Custom Nodes 文档深度索引
  - 社区高质量节点库与使用范例检索
- [ ] **v0.3.0 (画布交互闭环)**：
  - AI 辅助一键添加节点、参数填入、自动连线
  - 智能整理画布节点排版、自动子图封装
- [ ] **v0.4.0 (自主工作流 Agent)**：
  - 自动执行测试生图、多模态结果反思评价与循环调参

---

## 📄 开源许可 (License)

本项目采用 [MIT 许可证](LICENSE)。
