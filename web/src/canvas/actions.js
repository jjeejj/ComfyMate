/**
 * Canvas Action Manager for ComfyMate
 * Handles bidirectional canvas interactions:
 * 1. Locating, centering, and visually pulsing nodes on the canvas
 * 2. Applying parameter adjustments directly to node widgets
 * 3. Reverting/undoing parameter changes
 * 4. Workflow Doctor: automated workflow topology & parameter diagnostics
 */

export class CanvasActionManager {
  constructor(app) {
    this.app = app;
    this.history = []; // History of applied parameter adjustments for undo
  }

  /**
   * Find a LiteGraph node by numeric or string ID.
   */
  getNode(nodeId) {
    if (nodeId === null || nodeId === undefined) return null;
    const id = typeof nodeId === "number" ? nodeId : parseInt(nodeId, 10);
    if (isNaN(id)) return null;
    return this.app?.graph?.getNodeById(id) || null;
  }

  /**
   * Center the canvas viewport smoothly or directly on the given node.
   */
  centerOnNode(node) {
    const canvas = this.app?.canvas;
    if (!canvas || !node) return false;

    // Use LiteGraph native centerOnNode if available
    if (typeof canvas.centerOnNode === "function") {
      try {
        canvas.centerOnNode(node);
        canvas.setDirty(true, true);
        return true;
      } catch (e) {
        console.warn("[ComfyMate] Native centerOnNode failed, falling back to offset calc:", e);
      }
    }

    // Manual camera centering calculation
    try {
      const scale = canvas.ds?.scale || 1;
      const canvasEl = canvas.canvas;
      const width = canvasEl?.width || window.innerWidth;
      const height = canvasEl?.height || window.innerHeight;

      const nodeX = Array.isArray(node.pos) ? node.pos[0] : 0;
      const nodeY = Array.isArray(node.pos) ? node.pos[1] : 0;
      const nodeW = Array.isArray(node.size) ? node.size[0] : 140;
      const nodeH = Array.isArray(node.size) ? node.size[1] : 80;

      const centerX = nodeX + nodeW / 2;
      const centerY = nodeY + nodeH / 2;

      if (canvas.ds?.offset) {
        canvas.ds.offset[0] = -centerX + (width / 2) / scale;
        canvas.ds.offset[1] = -centerY + (height / 2) / scale;
      }
      canvas.setDirty(true, true);
      return true;
    } catch (e) {
      console.warn("[ComfyMate] Failed to center canvas on node:", e);
      return false;
    }
  }

  /**
   * Flash a pulsing visual highlight on the node to draw the user's attention.
   */
  flashNode(node) {
    const canvas = this.app?.canvas;
    if (!canvas || !node) return;

    const originalBoxcolor = node.boxcolor;
    const originalColor = node.color;
    let count = 0;

    const pulseInterval = setInterval(() => {
      count++;
      if (count % 2 === 1) {
        node.boxcolor = "#3b82f6"; // ComfyMate electric blue
        node.color = "#2563eb";
      } else {
        node.boxcolor = originalBoxcolor;
        node.color = originalColor;
      }
      canvas.setDirty(true, true);

      if (count >= 6) {
        clearInterval(pulseInterval);
        node.boxcolor = originalBoxcolor;
        node.color = originalColor;
        canvas.setDirty(true, true);
      }
    }, 200);
  }

  /**
   * Locate, center, select, and highlight a node on the canvas.
   */
  locateNode(nodeId, flash = true) {
    const node = this.getNode(nodeId);
    if (!node) {
      console.warn(`[ComfyMate] Node #${nodeId} not found on canvas`);
      return { success: false, nodeId };
    }

    const canvas = this.app?.canvas;
    if (!canvas) return { success: false, nodeId };

    // Deselect other nodes and select target node
    if (typeof canvas.deselectAllNodes === "function") {
      canvas.deselectAllNodes();
    }
    if (typeof canvas.selectNode === "function") {
      canvas.selectNode(node);
    }

    // Center viewport on node
    this.centerOnNode(node);

    // Pulse visual highlight
    if (flash) {
      this.flashNode(node);
    }

    return {
      success: true,
      nodeId: node.id,
      nodeTitle: node.title || node.type || `Node #${node.id}`,
    };
  }

  /**
   * Apply recommended parameter values to widgets of a specific node.
   * Stores previous values to support undo operations.
   */
  applyParameters(nodeId, parameters) {
    const node = this.getNode(nodeId);
    if (!node) {
      return { success: false, message: `Node #${nodeId} not found` };
    }

    if (!node.widgets || !Array.isArray(node.widgets)) {
      return { success: false, message: `Node #${nodeId} has no configurable widgets` };
    }

    const applied = [];
    const skipped = [];
    const oldValues = {};

    for (const [rawKey, rawVal] of Object.entries(parameters)) {
      const targetName = rawKey.trim().toLowerCase();
      // Find matching widget (case-insensitive name match)
      const widget = node.widgets.find(
        (w) => w.name && w.name.trim().toLowerCase() === targetName
      );

      if (widget) {
        const oldVal = widget.value;
        oldValues[widget.name] = oldVal;

        // Cast value if widget has specific options or type requirements
        let finalVal = rawVal;
        if (typeof oldVal === "number" && typeof rawVal === "string") {
          const num = Number(rawVal);
          if (!isNaN(num)) finalVal = num;
        }

        widget.value = finalVal;

        // Trigger widget callback if registered so ComfyUI internal state updates
        if (typeof widget.callback === "function") {
          try {
            widget.callback(widget.value, this.app.canvas, node, [0, 0], null);
          } catch (e) {
            console.warn(`[ComfyMate] Widget callback error for ${widget.name}:`, e);
          }
        }

        applied.push({
          key: widget.name,
          oldVal,
          newVal: finalVal,
        });
      } else {
        skipped.push(rawKey);
      }
    }

    if (applied.length > 0) {
      if (this.app?.graph) {
        this.app.graph.setDirtyCanvas(true, true);
      }
      this.history.push({
        nodeId: node.id,
        nodeTitle: node.title || node.type,
        oldValues,
        appliedAt: Date.now(),
      });
    }

    return {
      success: applied.length > 0,
      nodeId: node.id,
      nodeTitle: node.title || node.type,
      applied,
      skipped,
      oldValues,
    };
  }

  /**
   * Revert parameter adjustments back to previous values.
   */
  undoParameters(nodeId, oldValues) {
    const node = this.getNode(nodeId);
    if (!node || !node.widgets || !oldValues) {
      return { success: false, message: "Node or previous values not found" };
    }

    const reverted = [];
    for (const [key, oldVal] of Object.entries(oldValues)) {
      const widget = node.widgets.find((w) => w.name && w.name === key);
      if (widget) {
        widget.value = oldVal;
        if (typeof widget.callback === "function") {
          try {
            widget.callback(widget.value, this.app.canvas, node, [0, 0], null);
          } catch (e) {
            console.warn(`[ComfyMate] Widget callback error reverting ${key}:`, e);
          }
        }
        reverted.push({ key, value: oldVal });
      }
    }

    if (reverted.length > 0 && this.app?.graph) {
      this.app.graph.setDirtyCanvas(true, true);
    }

    return {
      success: reverted.length > 0,
      nodeId: node.id,
      nodeTitle: node.title || node.type,
      reverted,
    };
  }

  /**
   * Inspect current workflow topology and parameters for common pitfalls:
   * 1. Missing required connections on essential nodes (KSampler, VAE, CLIP)
   * 2. Empty prompts on text encoders
   * 3. Non-standard latent dimensions (not multiple of 8 or 64)
   * 4. Suspicious sampling parameters (steps <= 0, cfg <= 0, denoise <= 0)
   * 5. Completely disconnected/orphan nodes
   * 6. Muted / Bypassed nodes
   */
  diagnoseWorkflow() {
    const graph = this.app?.graph;
    if (!graph || !graph._nodes || graph._nodes.length === 0) {
      return {
        totalNodes: 0,
        issues: [],
        healthy: true,
      };
    }

    const nodes = graph._nodes;
    const links = graph.links || {};
    const issues = [];

    for (const node of nodes) {
      const ntype = node.type || "";
      const nid = node.id;
      const title = node.title || ntype;

      // 1. Muted or Bypassed
      if (node.mode === 2) {
        issues.push({
          severity: "info",
          nodeId: nid,
          nodeType: ntype,
          title,
          message: `节点处于静音(Muted)状态，执行时将被跳过`,
          fixSuggestion: "如需生效，请右键开启 Mode -> Always",
        });
      } else if (node.mode === 4) {
        issues.push({
          severity: "info",
          nodeId: nid,
          nodeType: ntype,
          title,
          message: `节点处于旁路(Bypassed)状态，输入将直接旁路到输出`,
          fixSuggestion: "如需生效，请右键开启 Mode -> Always",
        });
      }

      // Helper to check if a specific input slot has an active link
      const isInputLinked = (inputName) => {
        if (!node.inputs) return false;
        const inp = node.inputs.find((i) => i.name && i.name.toLowerCase() === inputName.toLowerCase());
        return !!(inp && inp.link && links[inp.link]);
      };

      // 2. KSampler / KSamplerAdvanced checks
      if (ntype.includes("KSampler")) {
        const required = ["model", "positive", "negative", "latent_image"];
        const missing = required.filter((req) => !isInputLinked(req));
        if (missing.length > 0) {
          issues.push({
            severity: "critical",
            nodeId: nid,
            nodeType: ntype,
            title,
            message: `核心采样器缺少必要输入：[${missing.join(", ")}]`,
            fixSuggestion: `请连接 ${missing.join(" 与 ")} 端口，否则工作流无法生成`,
          });
        }

        // Widget checks
        if (node.widgets) {
          const stepsW = node.widgets.find((w) => w.name === "steps");
          if (stepsW && (stepsW.value <= 0 || stepsW.value > 150)) {
            issues.push({
              severity: "warning",
              nodeId: nid,
              nodeType: ntype,
              title,
              message: `步数设置异常 (steps = ${stepsW.value})`,
              fixSuggestion: "建议采样步数设置在 20 到 35 之间以获得最佳效率与质感",
            });
          }

          const cfgW = node.widgets.find((w) => w.name === "cfg");
          if (cfgW && (cfgW.value <= 0 || cfgW.value > 30)) {
            issues.push({
              severity: "warning",
              nodeId: nid,
              nodeType: ntype,
              title,
              message: `CFG 设置异常 (cfg = ${cfgW.value})`,
              fixSuggestion: "建议 CFG 设置在 5.0 到 8.5 之间，过高会导致画面过饱和烧焦",
            });
          }

          const denoiseW = node.widgets.find((w) => w.name === "denoise");
          if (denoiseW && denoiseW.value <= 0) {
            issues.push({
              severity: "warning",
              nodeId: nid,
              nodeType: ntype,
              title,
              message: `降噪幅度为 0 (denoise = 0)，采样器将不会改变图像`,
              fixSuggestion: "文生图通常需要 denoise = 1.0；图生图建议 0.5 到 0.75",
            });
          }
        }
      }

      // 3. VAEDecode / VAEEncode checks
      if (ntype === "VAEDecode") {
        if (!isInputLinked("samples")) {
          issues.push({
            severity: "critical",
            nodeId: nid,
            nodeType: ntype,
            title,
            message: "VAEDecode 缺少 samples (潜空间图像输入)",
            fixSuggestion: "请连接 KSampler 的 LATENT 输出到 samples 端口",
          });
        }
        if (!isInputLinked("vae")) {
          issues.push({
            severity: "critical",
            nodeId: nid,
            nodeType: ntype,
            title,
            message: "VAEDecode 缺少 vae 输入",
            fixSuggestion: "请连接 CheckpointLoaderSimple 或 VAE Loader 的 VAE 端口",
          });
        }
      }

      // 4. CLIPTextEncode checks
      if (ntype === "CLIPTextEncode") {
        if (!isInputLinked("clip")) {
          issues.push({
            severity: "critical",
            nodeId: nid,
            nodeType: ntype,
            title,
            message: "提示词编码器缺少 clip 输入",
            fixSuggestion: "请连接 CheckpointLoaderSimple 或 CLIP Loader 的 CLIP 端口",
          });
        }
        if (node.widgets) {
          const textW = node.widgets.find((w) => w.name === "text");
          if (textW && (!textW.value || !textW.value.toString().trim())) {
            issues.push({
              severity: "warning",
              nodeId: nid,
              nodeType: ntype,
              title,
              message: "提示词内容为空 (空文本)",
              fixSuggestion: "请输入正向或反向提示词以引导图像生成",
            });
          }
        }
      }

      // 5. EmptyLatentImage checks
      if (ntype === "EmptyLatentImage") {
        if (node.widgets) {
          const widthW = node.widgets.find((w) => w.name === "width");
          const heightW = node.widgets.find((w) => w.name === "height");
          if (widthW && widthW.value % 8 !== 0) {
            issues.push({
              severity: "warning",
              nodeId: nid,
              nodeType: ntype,
              title,
              message: `图像宽度 (${widthW.value}) 不是 8 的倍数`,
              fixSuggestion: "Stable Diffusion VAE 要求分辨率必须为 8 的整数倍 (例如 512, 768, 1024)",
            });
          }
          if (heightW && heightW.value % 8 !== 0) {
            issues.push({
              severity: "warning",
              nodeId: nid,
              nodeType: ntype,
              title,
              message: `图像高度 (${heightW.value}) 不是 8 的倍数`,
              fixSuggestion: "Stable Diffusion VAE 要求分辨率必须为 8 的整数倍 (例如 512, 768, 1024)",
            });
          }
        }
      }

      // 6. CheckpointLoaderSimple checks
      if (ntype === "CheckpointLoaderSimple") {
        if (node.widgets) {
          const ckptW = node.widgets.find((w) => w.name === "ckpt_name");
          if (!ckptW || !ckptW.value) {
            issues.push({
              severity: "critical",
              nodeId: nid,
              nodeType: ntype,
              title,
              message: "未选择基础大模型 (ckpt_name 为空)",
              fixSuggestion: "请在下拉框中选择一个已下载的模型权重文件",
            });
          }
        }
      }

      // 7. Floating / completely isolated nodes
      const hasInputs = node.inputs && node.inputs.length > 0;
      const hasOutputs = node.outputs && node.outputs.length > 0;
      const anyInputLinked = node.inputs && node.inputs.some((i) => i.link && links[i.link]);
      const anyOutputLinked = node.outputs && node.outputs.some((o) => o.links && o.links.length > 0);

      if ((hasInputs || hasOutputs) && !anyInputLinked && !anyOutputLinked && node.mode !== 2 && node.mode !== 4) {
        issues.push({
          severity: "info",
          nodeId: nid,
          nodeType: ntype,
          title,
          message: "悬空独立节点：没有任何输入与输出连线",
          fixSuggestion: "如不需要此节点可直接删除，或连接至相应流程中",
        });
      }
    }

    return {
      totalNodes: nodes.length,
      issues,
      healthy: issues.length === 0,
      criticalCount: issues.filter((i) => i.severity === "critical").length,
      warningCount: issues.filter((i) => i.severity === "warning").length,
      infoCount: issues.filter((i) => i.severity === "info").length,
    };
  }
}
