# ComfyMate 需求描述

## 1. 产品定位

ComfyMate 是一个集成在 ComfyUI 内部的 AI 助手扩展，目标是让用户在使用 ComfyUI 时，可以快速理解工作流、节点和参数，并直接通过自然语言获得帮助。

核心目标不是单纯提供一个聊天窗口，而是让 AI 能够理解当前 ComfyUI 上下文，成为一个真正的 Workflow Assistant。

## 2. 核心目标

用户在使用 ComfyUI 时，经常会遇到以下问题：

- 不知道某个节点是做什么的
- 不理解节点之间为什么这样连接
- 不清楚某个参数应该如何设置
- 下载别人 Workflow 后无法快速理解整体逻辑
- Workflow 报错时不知道问题出在哪
- 不知道应该使用哪个节点实现某个功能
- 需要频繁离开 ComfyUI 去搜索文档、GitHub 或教程

ComfyMate 希望把这些操作全部集中到 ComfyUI 内部完成。

用户无需离开当前工作流，只需要打开 ComfyMate，即可针对当前 Workflow 直接提问。

## 3. 使用方式

ComfyMate 以侧边栏或浮动聊天窗口的形式集成到 ComfyUI。

用户可以随时打开，例如：

> 这个节点是做什么的？  
> 为什么 KSampler 的 latent 要从这里传进来？  
> 帮我解释当前 Workflow。  
> 我选中的这几个节点之间是什么关系？  
> 为什么这个节点连接不上？  
> CFG 设置成 7 有什么作用？  
> 这个 Workflow 怎么改成图生图？  
> 我想增加 ControlNet，应该加哪些节点？  

AI 根据当前 ComfyUI 上下文直接回答，而不是只根据用户输入进行普通聊天。

## 4. AI 上下文能力

ComfyMate 应能够获取并理解以下上下文：

### 当前 Workflow
包括：
- 所有节点
- 节点类型
- 节点 ID
- 节点参数
- 节点之间的连接关系
- 输入输出类型
- Workflow JSON

AI 可以根据这些信息分析整个数据流。

### 当前选中节点
如果用户选中了一个或多个节点，ComfyMate 应优先把这些节点作为上下文。
例如用户选中 KSampler 后询问：
> 这个节点有什么作用？
AI 应直接知道用户指的是当前选中的 KSampler，而不需要用户重新输入节点名称。

### 当前错误信息
当 Workflow 执行失败时，可以将 ComfyUI 的错误信息、节点 ID 和相关节点信息提供给 AI。
AI 可以帮助判断：
- 哪个节点出错
- 为什么出错
- 是否缺少模型
- 是否参数错误
- 是否输入输出类型不匹配
- 是否 Custom Node 缺失

## 5. 节点知识能力

ComfyMate 应能够查询 ComfyUI 节点相关信息，包括：
- 节点名称
- 节点用途
- 输入参数
- 输出参数
- 参数含义
- 使用示例
- 官方文档
- Custom Node 文档

例如：用户询问“KSampler 的 scheduler 是什么？”，ComfyMate 可以结合节点定义和文档进行解释。

## 6. Workflow 解释能力

ComfyMate 应支持对整个 Workflow 进行结构化解释。
例如自动识别：
- 模型加载区域
- Prompt 编码区域
- Latent 生成区域
- Sampling 区域
- ControlNet 区域
- Upscale 区域
- 输出区域

然后告诉用户当前 Workflow 的执行流程。对于大型 Workflow，可以自动将节点划分为多个逻辑模块。

## 7. Workflow 辅助能力

后续可以支持 AI 直接操作 Workflow，例如：
- 添加节点 / 删除节点
- 修改节点参数
- 连接节点 / 断开连接
- 自动排布节点
- 创建 Group
- 根据需求生成 Workflow

## 8. 文档搜索

ComfyMate 可以同时搜索：
- ComfyUI 官方文档
- ComfyUI Node 文档
- Custom Node README
- 已安装插件说明
- GitHub 文档

## 9. 模型支持

AI Provider 应尽量采用统一接口设计。
优先支持：
- OpenAI-compatible API
- OpenAI
- Claude
- Gemini
- DeepSeek
- Ollama
- LM Studio

允许用户配置 Base URL、API Key、Model、Temperature、Context Length。

## 10. 本地优先

ComfyMate 应允许用户使用 ComfyUI + Ollama / LM Studio + 本地 LLM，实现完全本地 AI Assistant，避免将 Workflow 发送到第三方云端。

## 11. UI 设计

默认保持轻量，不干扰 ComfyUI 原有操作：
- 右侧 AI Sidebar / 浮动窗口
- 快捷打开按钮
- 当前上下文状态 (Context Badges)
- 当前选中节点提示
- Clear Context
- Model Selector

## 12. 第一版 MVP

优先完成：
1. ComfyUI 内置聊天界面
2. 获取当前 Workflow
3. 获取当前选中节点
4. 获取节点参数和连接关系
5. 将上下文发送给 LLM
6. 支持 OpenAI-compatible API
7. 支持 Ollama / LM Studio
8. AI 可以解释节点
9. AI 可以解释 Workflow
10. AI 可以分析 ComfyUI 报错

## 13. 后续版本
- **V2**: 文档搜索、Custom Node 文档索引、Workflow 自动分析、节点推荐
- **V3**: AI 修改节点参数、AI 增删节点、AI 自动连接节点、Workflow 自动生成
- **V4**: Agent Mode（自动运行、自动读取结果、Vision 模型评价、调参再生成）

## 14. 一句话定位

**ComfyMate 是一个能够理解当前 ComfyUI 工作流、节点和错误上下文的 AI 助手，让用户无需离开 ComfyUI 就能快速学习、排错和优化 Workflow。**
