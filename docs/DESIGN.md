# ComfyMate 系统设计文档 (System Design Specification)

> **版本**：v0.1.0 (Draft)  
> **定位**：ComfyUI 上下文感知 AI 助手扩展 (Context-Aware Workflow AI Assistant for ComfyUI)  
> **核心标语**：*ComfyMate is an AI assistant that understands your ComfyUI workflow.*

---

## 1. 系统概述与设计哲学

ComfyMate 是一个深度集成在 ComfyUI 画布内部的智能工作流副驾驶（Copilot）。不同于外部通用聊天工具，ComfyMate 将 **ComfyUI 运行时画板上下文（画布拓扑、节点参数、选区焦点、执行异常）** 作为与大模型交互的第一公民。

### 1.1 设计原则
1. **Context-Native（原生上下文）**：AI 默认感知用户当前在看什么、选了什么、哪里连错了，无需用户在 Prompt 中人工搬运节点名称和参数。
2. **Local-First & Privacy（本地优先与隐私合规）**：原生支持 Ollama、LM Studio 等本地开源大模型，敏感工作流与生图提示词不强制离境。
3. **Zero Friction（零摩擦集成）**：前端纯原生 ES Modules，零编译打包负担；后端仅使用标准 ComfyUI PromptServer 路由挂载，开箱即用。
4. **Token-Efficiency（拓扑精简与高能效比）**：摒弃臃肿的 Raw Graph JSON，通过自研拓扑精简算法将画板数据压缩为高信息密度的拓扑 DSL，节约 80%+ 的 Token 开销并大幅提高模型推理准确性。

---

## 2. 系统整体架构

系统由 **ComfyUI Web 前端扩展 (`web/`)**、**ComfyUI Python 后端服务 (`py/`)** 以及 **外部/本地 LLM Provider** 协同组成。

```
┌────────────────────────────────────────────────────────────────────────┐
│                          ComfyUI Web Frontend                          │
│                                                                        │
│   ┌─────────────────────────┐          ┌────────────────────────────┐  │
│   │    LiteGraph Canvas     │          │    ComfyMate UI Layer      │  │
│   │  - Nodes & Links        │          │  - Sidebar / Floating Pane │  │
│   │  - Selected Nodes       │          │  - Stream Markdown View    │  │
│   │  - Execution Events     │          │  - Context Status Badges   │  │
│   └────────────┬────────────┘          └─────────────┬──────────────┘  │
│                │                                     │                 │
│                ▼                                     │                 │
│   ┌───────────────────────────┐                      │                 │
│   │     Context Extractor     │                      │                 │
│   │  - Graph DSL Serializer   │                      │                 │
│   │  - Node Selection Filter  │                      │                 │
│   │  - Error Stack Interceptor│                      │                 │
│   └────────────┬──────────────┘                      │                 │
│                │ Compact Context                     │ User Prompt     │
│                └──────────────────┬──────────────────┘                 │
│                                   │                                    │
│                                   ▼                                    │
│                      [ ComfyMate Client Service ]                      │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ HTTP POST (SSE Stream)
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                        ComfyMate Python Backend                        │
│                                                                        │
│   ┌────────────────────────────────────────────────────────────────┐   │
│   │         ComfyUI PromptServer Hook (aiohttp Web Server)         │   │
│   │  - /comfymate/api/chat (SSE 流式输出)                           │   │
│   │  - /comfymate/api/config (本地设置读写)                        │   │
│   │  - /comfymate/api/models (模型联通性测试与列表探测)             │   │
│   └───────────────────────────────┬────────────────────────────────┘   │
│                                   │                                    │
│   ┌───────────────────────────────┴────────────────────────────────┐   │
│   │                   Prompt & Context Assembler                   │   │
│   │  - System Prompt Injection                                     │   │
│   │  - ComfyUI Node Schema Enrichment (可选注入 /object_info)      │   │
│   └───────────────────────────────┬────────────────────────────────┘   │
│                                   │                                    │
│   ┌───────────────────────────────┴────────────────────────────────┐   │
│   │                   Unified LLM Client Layer                     │   │
│   │  - OpenAI-compatible Driver (OpenAI / DeepSeek / Claude / etc.)│   │
│   │  - Local Engine Driver (Ollama / LM Studio / vLLM)             │   │
│   └───────────────────────────────┬────────────────────────────────┘   │
└───────────────────────────────────┼────────────────────────────────────┘
                                    │
                 ┌──────────────────┴──────────────────┐
                 ▼                                     ▼
      [ Cloud Model APIs ]                   [ Local Engine ]
   (DeepSeek, OpenAI, Gemini)             (Ollama, LM Studio)
```

---

## 3. 前端架构与交互设计 (`web/`)

前端基于 ComfyUI 标准扩展 API (`app.registerExtension`) 实现，保持轻量无第三方打包依赖。

### 3.1 UI 组成与布局
- **侧边栏抽屉 (Sidebar Drawer) / 悬浮浮窗 (Floating Window)**：
  - 支持右侧贴边停靠、折叠收起、自由拖拽调整宽度。
  - 在 ComfyUI 顶部工具栏（或新版 Side Menu）注册专属图标入口。
- **上下文指示器 (Context Status Badges)**：
  - 动态显示当前注入的上下文信息（如 `[工作流: 18个节点]`、`[已选中: KSampler #3]`、`[错误: 节点 #5]`）。
  - 用户可勾选/取消勾选是否携带当前图上下文，保留隐私控制权。
- **快捷动作条 (Quick Action Pills)**：
  - `解释当前工作流`
  - `排查当前报错`
  - `解释选中的节点`
  - `转换为图生图方案建议`
- **Markdown & 代码流式渲染器**：
  - 支持实时打字机效果、代码高亮、节点名称高亮标签。

### 3.2 上下文提取器 (Context Extractor)
为了避免直接传送数万 Token 的 `app.graph.serialize()`，前端提取器实施以下策略：

1. **图拓扑精简 (Graph Topology Serialization)**：
   - 过滤掉 UI 视口、坐标 `pos`、大小 `size`、插槽位置、配色 `flags` 等无用元数据。
   - 保留字段：`id`、`type`、`title`、`inputs`（当前设置的值与来源连线 `[source_node_id, slot_name]`）、`outputs`。
2. **焦点感知 (Selected Nodes Focus)**：
   - 监听 `app.canvas.selected_nodes`。
   - 若用户选中了 1~N 个节点，将选中节点的详细参数（Widget Values）以优先重点形式标注，并提取其直接上游（Upstream）与下游（Downstream）邻接节点。
3. **错误事件监听 (Runtime Error Interceptor)**：
   - 监听 ComfyUI WebSocket 事件 `execution_error` 与 `execution_interrupted`。
   - 捕获 `node_id`、`exception_type`、`exception_message`、`traceback`，在前端面板即时提示“发现运行异常，点击一键诊断”。

---

## 4. 后端架构设计 (`py/`)

后端基于 ComfyUI 的 `server.PromptServer.instance`，通过 `aiohttp` 挂载独立命名空间的 REST API。

### 4.1 目录划分
```text
ComfyMate/
├── __init__.py               # ComfyUI 扩展入口，注册 WEB_DIRECTORY
├── py/
│   ├── __init__.py
│   ├── server.py             # aiohttp 路由处理与 SSE 流式响应
│   ├── config.py             # 用户配置持久化 (存储于用户本地目录)
│   ├── context.py            # 上下文格式化与 System Prompt 模版组装
│   └── llm.py                # 统一 LLM 适配器 (OpenAI 协议 / Ollama / 异步流)
├── web/
│   ├── comfymate.js          # ComfyUI 前端扩展入口
│   ├── comfymate.css         # 样式文件 (深色模式适配 ComfyUI)
│   ├── context_extractor.js  # 画布拓扑提取与精简算法
│   └── chat_ui.js            # 聊天窗口渲染与交互
├── docs/
│   ├── PRD.md                # 原始需求文档
│   └── DESIGN.md             # 本系统设计文档
├── requirements.txt
└── README.md
```

### 4.2 API 路由规范

#### 1. 聊天接口：`POST /comfymate/api/chat`
* **协议**：Server-Sent Events (SSE) 流式传输（`text/event-stream`）。
* **请求体 (Request JSON)**：
  ```json
  {
    "messages": [
      {"role": "user", "content": "为什么 KSampler 连接不上？"}
    ],
    "context": {
      "workflow_summary": { ... },
      "selected_nodes": [ ... ],
      "error_info": null
    },
    "model_config": {
      "provider": "ollama",
      "model": "deepseek-r1:8b",
      "temperature": 0.7
    }
  }
  ```
* **响应流 (SSE Data Stream)**：
  ```
  data: {"content": "根据当前"}
  data: {"content": "工作流显示，KSampler 的"}
  data: {"content": " latent_image 未接输入..."}
  data: [DONE]
  ```

#### 2. 配置管理：`GET / POST /comfymate/api/config`
* 读取与保存用户的模型配置（Base URL、API Key、Model Name、Temperature、默认 Prompt）。
* 本地持久化路径位于当前插件根目录下的 `config.json`（已加入 `.gitignore` 避免泄露）。

#### 3. 模型探测接口：`POST /comfymate/api/test_connection`
* 验证目标 Base URL 及 API Key 是否有效，拉取 Ollama / OpenAI 可用模型列表。

---

## 5. 上下文拓扑压缩与 Prompt 工程规范

### 5.1 拓扑 DSL 规范（Token 瘦身）
将庞大的 LiteGraph JSON 压缩为 LLM 最擅长解析的 **紧凑 DAG 描述**：

```markdown
## Current Workflow Context (Summary)
Total Nodes: 6
- Node #4 [CheckpointLoaderSimple]: ckpt_name="v1-5-pruned-emaonly.safetensors" -> outputs: MODEL, CLIP, VAE
- Node #6 [CLIPTextEncode] (Positive Prompt): text="1girl, solo, masterpice" <- from #4:CLIP
- Node #7 [CLIPTextEncode] (Negative Prompt): text="blurry, bad hands" <- from #4:CLIP
- Node #5 [EmptyLatentImage]: width=512, height=512, batch_size=1 -> outputs: LATENT
- Node #3 [KSampler]: steps=20, cfg=8.0, sampler="euler", scheduler="normal", denoise=1.0 <- inputs: model from #4, positive from #6, negative from #7, latent_image from #5
- Node #8 [VAEDecode]: <- samples from #3:LATENT, vae from #4:VAE
- Node #9 [SaveImage]: <- images from #8:IMAGE

## Focus / Selected Node(s)
User selected Node #3 [KSampler].
```
* **效果对比**：原 JSON 约 3000~8000 tokens，压缩后仅需 **200~400 tokens**，同时大幅减少坐标干扰，模型对拓扑上游与下游的因果推断准确率显著上升。

### 5.2 System Prompt 核心策略
```markdown
You are ComfyMate, an expert assistant embedded directly inside ComfyUI.
Your mission is to help users understand, troubleshoot, and optimize their ComfyUI workflows.

Guidelines:
1. Ground your answers in the provided "Workflow Context" and "Focus / Selected Node(s)".
2. When mentioning nodes, always refer to them by their Name and ID (e.g. `KSampler (#3)`).
3. If user points to a specific error, trace upstream nodes to identify type mismatch, missing models, or invalid parameters.
4. Keep explanations structured, concise, and actionable for ComfyUI practitioners.
```

---

## 6. 版本规划与里程碑 (Roadmap)

### 阶段一：V1 MVP (当前实现重点)
- [x] 系统架构与设计文档沉淀。
- [ ] 插件基础结构初始化 (`__init__.py`, `py/`, `web/`)。
- [ ] 前端侧边栏交互 UI (Chat 窗口、折叠、配置面板)。
- [ ] 前端 Context 提取器（拓扑精简、选中节点捕获、错误捕获）。
- [ ] 后端 OpenAI-compatible / Ollama 统一客户端与 SSE 流式转发。
- [ ] 针对“节点答疑”、“工作流解释”、“报错排查”的 Prompt 模版优化。

### 阶段二：V2 知识增强与检索 (RAG & Node Index)
- 索引 ComfyUI 内置节点库及主流 Custom Nodes（如 ComfyUI-Manager, ControlNet, IP-Adapter）文档与 README。
- 节点参数用途实时 Hover 提示与查询。

### 阶段三：V3 工作流交互与辅助 (Workflow Mutation)
- 引入 Tool Calls / Actions：AI 可返回操作指令。
- 前端执行器解析指令：在画布上高亮节点、修改参数、自动连线或一键添加节点组（例如自动组装 ControlNet 链路）。

### 阶段四：V4 自主闭环 Agent (Autonomous Loop & Harness)
- 引入正式的 **Execution Harness**：自动化下发生图任务至 Prompt 队列。
- 捕获生成图片并结合 Vision 大模型（VLM）进行审美与缺陷诊断。
- 实现 “修改参数 -> 运行生图 -> 多模态评估 -> 迭代优化” 闭环。

---

## 7. 研发评测机制 (Internal Eval Harness)

在开发阶段，提供一个脱离 ComfyUI 前端的本地离线评测脚本 `tests/eval_context.py`：
- 输入：预存的经典 Workflow JSON（Txt2Img, Img2Img, Inpaint, SDXL, 故障流）。
- 校验：
  1. 拓扑压缩器输出的 Token 压缩比是否 > 70%。
  2. 测试 Ollama (本地 7B/8B/14B 模型) 与云端 API 在解释拓扑与报错时的准确率。
  3. 保证 Prompt 迭代过程中的回归稳定性。
