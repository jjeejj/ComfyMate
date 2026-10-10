# ComfyMate 架构设计与目录规范 (Architecture & Directory Specification)

> **版本**：v1.2.0  
> **定位**：ComfyUI 上下文感知 AI 助手模块化架构与工程规范  

---

## 1. 架构目标与设计原则

1. **零构建摩擦 (Zero Build Burden)**：前端保持纯原生 ES Modules，不引入 Webpack/Vite 等侵入式打包构建链路，直接利用现代浏览器原生 `import/export` 特性，保证即改即生效。
2. **安全模块隔离 (Directory Encapsulation)**：ComfyUI 默认会扫描并执行 `web/*.js` 下所有顶层脚本。为了防止内部工具模块被 ComfyUI 当作独立插件重复挂载，所有业务子模块统一部署在 `web/src/` 子目录下，由入口文件 `web/comfymate.js` 统一按需引用。
3. **协议高扩展 (Protocol Agnostic)**：大模型后端提供面向对象的 `BaseLLMProvider` 抽象基类，将 OpenAI 官方、Anthropic Claude、OpenAI 兼容协议（Ollama, LM Studio, vLLM, DeepSeek）以及未来的 Google Gemini 彻底解耦，单协议扩展零改动主业务。
4. **组件高内聚 (Component Cohesion)**：解耦单体 1400 行的 `chat_ui.js`，将国际化、网络通信、画布感知、UI 抽屉、设置弹窗分离为职责纯粹的小文件。

---

## 2. 完整目录结构

```bash
ComfyMate/
├── __init__.py                     # ComfyUI 插件声明入口 (WEB_DIRECTORY = "./web")
├── config.json                     # 用户本地持久化配置
├── requirements.txt                # 运行依赖 (aiohttp 等)
├── README.md                       # 项目说明
│
├── docs/                           # 文档中心
│   ├── PRD.md                      # 产品需求说明
│   ├── DESIGN.md                   # 初始设计规范
│   └── ARCHITECTURE.md             # 架构演进与目录设计规范 (本文档)
│
├── py/                             # 后端服务代码
│   ├── __init__.py
│   ├── server.py                   # aiohttp 路由中心 (挂载于 ComfyUI PromptServer)
│   ├── config.py                   # 本地配置安全持久化与迁移
│   ├── sessions.py                 # 本地对话历史会话安全持久化管理
│   ├── context.py                  # 上下文装配与提示词构建引擎
│   ├── llm.py                      # LLMClient 兼容门面 (统一代理至 providers)
│   │
│   └── providers/                  # 多模型协议适配层
│       ├── __init__.py
│       ├── base.py                 # BaseLLMProvider 抽象基类
│       ├── openai_provider.py      # OpenAI 协议及兼容协议 (支持 reasoning 思考流)
│       ├── anthropic_provider.py   # Anthropic 原生 Messages API 协议 (支持 thinking)
│       └── factory.py              # Provider 工厂类 (根据 api_type 动态分发)
│
├── web/                            # 前端 Web 扩展
│   ├── comfymate.js                # 前端主入口 (唯一由 ComfyUI 根目录扫描加载)
│   ├── chat_ui.js                  # ChatUI 门面编排器 (兼容现有入口引用)
│   ├── context_extractor.js        # 上下文提取器兼容门面
│   ├── comfymate.css               # 样式表 (暗黑优雅主题)
│   │
│   └── src/                        # 模块化源码 (ComfyUI 不会直接扫描子目录)
│       ├── i18n/                   # 多语言字典中心
│       │   ├── index.js            # 翻译代理与 ComfyUI 语言自动探测
│       │   ├── zh.js               # 中文字典
│       │   └── en.js               # 英文字典
│       │
│       ├── utils/                  # 通用工具
│       │   ├── markdown.js         # 轻量级 Markdown 语法、节点徽标与 Action 卡片渲染器
│       │   ├── template_loader.js  # HTML 视图模板异步加载与 i18n 编译引擎
│       │   └── toast.js            # 全局轻量通知组件
│       │
│       ├── services/               # 核心网络与通信服务
│       │   └── api.js              # 后端 HTTP API 封装 (配置读写/连通测试/流式对话)
│       │
│       ├── canvas/                 # 画布交互与感知
│       │   ├── extractor.js        # LiteGraph 拓扑抽取与报错监听
│       │   └── actions.js          # 画布双向联动 (节点镜头直达、参数写入/撤回、工作流体检)
│       │
│       └── components/             # UI 视图组件与独立模板
│           ├── panel.html          # 侧边栏主面板 HTML 模板
│           ├── settings_modal.html # 设置中心模态弹窗 HTML 模板
│           ├── settings_modal.js   # 设置对话框外壳管理
│           └── settings/           # 设置面板子模块
│               ├── models_pane.js  # 模型提供商列表与配置卡片
│               └── general_pane.js # 语言、温度与最大 Token 配置
│
└── tests/                          # 测试套件
    ├── test_context.py             # 画布拓扑与提示词装配测试
    ├── test_server_and_llm.py      # 服务接口与 LLM Client 门面测试
    └── test_providers.py           # Provider 协议适配器多态测试
```

---

## 3. 核心扩展场景规范

### 3.1 新增模型协议（例如 Google Gemini 或私有 RPC）
1. 在 `py/providers/` 下新建 `gemini_provider.py`，继承 `BaseLLMProvider`。
2. 实现 `stream_chat` 与 `list_models` 两个抽象方法。
3. 在 `py/providers/factory.py` 的映射表中注册 `gemini: GeminiProvider`。
4. 前端在 `FORMAT_PRESETS` 中添加选项。业务主逻辑、流式解析器零修改。

### 3.2 增加画布操作能力 (Agent Tool Calling)
1. 在 `py/` 注册 Tool 函数声明（如 `add_node(type, x, y)`、`link_nodes(origin, target)`）。
2. 大模型返回工具调用时，前端通过 `web/src/canvas/` 调度器调用 `app.graph.add()` 完成画布实时修改。
