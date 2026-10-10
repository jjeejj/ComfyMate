# 📦 ComfyMate 发布指南 (Publishing Guide)

本指南介绍如何将 **ComfyMate** 插件发布到 **ComfyUI 官方生态**，使全球用户可以直接在 ComfyUI 原生界面中搜索、一键安装和自动更新。

---

## 方式 1：发布到官方 Comfy Registry（现代推荐标准）

现代 ComfyUI 桌面端和 Web V1 官方原生「**Nodes Manager**」直接连接官方注册表 [registry.comfy.org](https://registry.comfy.org)。

发布到该注册表后，用户在 Nodes Manager 中搜索 `ComfyMate` 或 `comfyui assistant` 即可一键点击 **Install**。

### 第 1 步：注册 Publisher 身份与获取 API Key

1. 访问官方注册表门户：[https://registry.comfy.org](https://registry.comfy.org/)；
2. 点击右上角 **Sign In**（直接使用 GitHub 账号登录即可）；
3. 创建你的 **Publisher**（发布者身份，例如 `jjeejj` 或 `comfymate`）；
4. 进入个人账号设置（Settings），生成一个 **Personal Access Token (API Key)** 并妥善保存。

### 第 2 步：核对 `pyproject.toml` 中的 `PublisherId`

打开项目根目录下的 `pyproject.toml`，将 `PublisherId` 修改为你刚申请的 Publisher ID：

```toml
[tool.comfy]
PublisherId = "你的_publisher_id"
DisplayName = "ComfyMate"
Icon = ""
includes = [
    "__init__.py",
    "py/**",
    "web/**",
    "requirements.txt",
    "README.md",
]
```

### 第 3 步：使用 `comfy-cli` 一键发布

在终端中执行：

```bash
# 1. 安装官方 CLI
pip install comfy-cli

# 2. 进入项目根目录
cd ComfyMate

# 3. 执行发布命令
comfy node publish
```

执行后按提示粘贴你的 **API Key**，CLI 将自动完成依赖检查、打包与上传。发布成功后数秒内即可在官方注册表中检索到。

### 第 4 步：(可选) 配置 GitHub Actions 自动发布 CI/CD

项目中已包含 `.github/workflows/publish.yml`。只需在 GitHub 仓库中：
1. 进入 **Settings > Secrets and variables > Actions**；
2. 新增 Secret：`REGISTRY_ACCESS_TOKEN`，填入第一步获取的 API Key；
3. 后续只要在 GitHub 提交新的版本标签（如 `git tag v1.0.1 && git push --tags`），GitHub Action 会自动将新版本推送至 Comfy Registry！

---

## 方式 2：提交到经典 ComfyUI-Manager 索引列表

旧版 ComfyUI-Manager 依赖 GitHub 上的 `custom-node-list.json`。为确保 100% 覆盖所有新老用户，建议同步提交：

1. 打开官方仓库：[https://github.com/ltdrdata/ComfyUI-Manager](https://github.com/ltdrdata/ComfyUI-Manager)；
2. Fork 该仓库，编辑根目录下的 `custom-node-list.json`；
3. 在 `custom_nodes` 数组中添加以下记录：
   ```json
   {
     "author": "jjeejj",
     "title": "ComfyMate",
     "reference": "https://github.com/jjeejj/ComfyMate",
     "files": [
       "https://github.com/jjeejj/ComfyMate"
     ],
     "install_type": "git-clone",
     "description": "Context-aware AI copilot for ComfyUI. Explains workflows, analyzes nodes, diagnoses errors, and supports image paste vision chat.",
     "pip": [
       "aiohttp"
     ]
   }
   ```
4. 提交 Pull Request，官方维护者合并后即可生效。
