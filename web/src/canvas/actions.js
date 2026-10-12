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

      const nodeX = node.pos && typeof node.pos[0] === "number" ? node.pos[0] : 0;
      const nodeY = node.pos && typeof node.pos[1] === "number" ? node.pos[1] : 0;
      const nodeW = node.size && typeof node.size[0] === "number" ? node.size[0] : 140;
      const nodeH = node.size && typeof node.size[1] === "number" ? node.size[1] : 80;

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
   * Renders an electric-blue glowing animated outline around the ENTIRE node border for 3 complete breathing cycles.
   */
  flashNode(node) {
    const canvas = this.app?.canvas;
    if (!canvas || !node) return;

    // Cancel any ongoing pulse animation on this node
    if (typeof node.__cm_pulse_cancel === "function") {
      try {
        node.__cm_pulse_cancel();
      } catch (_) {}
    }

    const origDrawForeground = node.onDrawForeground;
    const originalBoxcolor = node.boxcolor;
    const originalColor = node.color;

    const pulseCycles = 3;
    const cycleDuration = 450; // ms per pulse cycle (total ~1350ms)
    const totalDuration = pulseCycles * cycleDuration;
    const startTime = performance.now();

    let animId = null;
    let currentAlpha = 0;

    const cleanup = () => {
      if (animId !== null) {
        cancelAnimationFrame(animId);
        animId = null;
      }
      node.onDrawForeground = origDrawForeground;
      node.boxcolor = originalBoxcolor;
      node.color = originalColor;
      node.__cm_pulse_cancel = null;
      canvas.setDirty(true, true);
    };

    node.__cm_pulse_cancel = cleanup;

    // Helper to draw clean rounded rectangle
    const drawRoundedRect = (ctx, x, y, w, h, r) => {
      ctx.beginPath();
      if (typeof ctx.roundRect === "function") {
        ctx.roundRect(x, y, w, h, [r]);
      } else {
        ctx.moveTo(x + r, y);
        ctx.lineTo(x + w - r, y);
        ctx.arcTo(x + w, y, x + w, y + r, r);
        ctx.lineTo(x + w, y + h - r);
        ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
        ctx.lineTo(x + r, y + h);
        ctx.arcTo(x, y, x + r, y, r);
        ctx.closePath();
      }
    };

    // Chain onDrawForeground to render the glowing outer border around the ENTIRE node
    node.onDrawForeground = function (ctx, c) {
      if (typeof origDrawForeground === "function") {
        try {
          origDrawForeground.apply(this, arguments);
        } catch (_) {}
      }

      if (currentAlpha > 0.01) {
        ctx.save();
        const scale = canvas.ds?.scale || 1;
        const pad = Math.max(3, 4 / scale);

        // Correctly handle Float32Array and regular Array for node dimensions
        const isCollapsed = Boolean(node.flags?.collapsed);
        const nodeW = node.size && typeof node.size[0] === "number" ? node.size[0] : 140;
        const nodeH = node.size && typeof node.size[1] === "number" ? node.size[1] : 80;

        let titleHeight = (window.LiteGraph && window.LiteGraph.NODE_TITLE_HEIGHT) || 30;
        if (node.constructor && window.LiteGraph && node.constructor.title_mode === window.LiteGraph.NO_TITLE) {
          titleHeight = 0;
        }

        // Determine local bounds: (0, 0) in onDrawForeground is at node.pos
        // Title bar extends upwards from y = -titleHeight to y = 0
        // Node body extends downwards from y = 0 to y = nodeH
        let localX = 0;
        let localY = titleHeight > 0 ? -titleHeight : 0;
        let localW = isCollapsed ? (node._collapsed_width || nodeW) : (nodeW + 1);
        let localH = isCollapsed ? titleHeight : (nodeH + titleHeight);

        // If LiteGraph provides getBounding, use it for exact pixel fidelity
        if (typeof node.getBounding === "function") {
          try {
            const b = node.getBounding();
            if (b && typeof b[0] === "number" && typeof b[2] === "number" && b[2] > 0 && b[3] > 0) {
              const posX = node.pos && typeof node.pos[0] === "number" ? node.pos[0] : 0;
              const posY = node.pos && typeof node.pos[1] === "number" ? node.pos[1] : 0;
              localX = b[0] - posX;
              localY = b[1] - posY;
              localW = b[2];
              localH = b[3];
            }
          } catch (_) {}
        }

        const x = localX - pad;
        const y = localY - pad;
        const w = localW + pad * 2;
        const h = localH + pad * 2;

        const isBoxShape = Boolean(
          node._shape === (window.LiteGraph && window.LiteGraph.BOX_SHAPE) ||
          node.constructor?.shape === (window.LiteGraph && window.LiteGraph.BOX_SHAPE)
        );
        const baseRadius = isBoxShape ? 2 : ((canvas && canvas.round_radius) || 8);
        const radius = Math.min(Math.max(baseRadius, baseRadius / scale), Math.min(w, h) / 2);

        // Outer electric blue glowing pulse border around the ENTIRE node (body + title bar)
        // Layer 1: Ambient glowing aura with breathing shadow blur
        ctx.lineWidth = Math.max(4, 5.5 / scale);
        ctx.strokeStyle = `rgba(59, 130, 246, ${currentAlpha * 0.95})`;
        ctx.shadowColor = "rgba(59, 130, 246, 0.95)";
        ctx.shadowBlur = Math.max(16, 24 / scale) * currentAlpha;
        drawRoundedRect(ctx, x, y, w, h, radius);
        ctx.stroke();

        // Layer 2: Ultra-crisp bright core border line
        ctx.lineWidth = Math.max(2, 2.5 / scale);
        ctx.strokeStyle = `rgba(147, 197, 253, ${currentAlpha * 0.95})`;
        ctx.shadowBlur = 0;
        ctx.stroke();

        // Layer 3: Subtle ambient translucent tint during peak brightness
        ctx.fillStyle = `rgba(59, 130, 246, ${currentAlpha * 0.08})`;
        ctx.fill();

        ctx.restore();
      }
    };

    // 60fps smooth pulse loop
    const step = (now) => {
      const elapsed = now - startTime;
      if (elapsed >= totalDuration) {
        cleanup();
        return;
      }

      // Smooth sine wave for each pulse breathing cycle
      const cycleProgress = (elapsed % cycleDuration) / cycleDuration;
      currentAlpha = Math.sin(cycleProgress * Math.PI);

      // Also pulse node box and title colors
      if (currentAlpha > 0.4) {
        node.boxcolor = "#3b82f6";
        node.color = "#2563eb";
      } else {
        node.boxcolor = originalBoxcolor;
        node.color = originalColor;
      }

      canvas.setDirty(true, true);
      animId = requestAnimationFrame(step);
    };

    animId = requestAnimationFrame(step);
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
        if (typeof oldVal === "boolean") {
          if (typeof rawVal === "string") {
            finalVal = rawVal.toLowerCase() === "true" || rawVal === "1";
          } else {
            finalVal = Boolean(rawVal);
          }
        } else if (
          typeof oldVal === "number" ||
          widget.type === "number" ||
          widget.type === "INT" ||
          widget.type === "FLOAT"
        ) {
          let num = Number(rawVal);
          if (!isNaN(num)) {
            if (
              widget.type === "INT" ||
              (widget.options && Number.isInteger(widget.options.step) && widget.options.step >= 1)
            ) {
              num = Math.round(num);
            }
            if (widget.options) {
              if (typeof widget.options.min === "number" && num < widget.options.min) {
                num = widget.options.min;
              }
              if (typeof widget.options.max === "number" && num > widget.options.max) {
                num = widget.options.max;
              }
            }
            finalVal = num;
          }
        } else if (widget.options && Array.isArray(widget.options.values)) {
          const matchedVal = widget.options.values.find(
            (opt) => String(opt).trim().toLowerCase() === String(rawVal).trim().toLowerCase()
          );
          if (matchedVal !== undefined) {
            finalVal = matchedVal;
          }
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
   * Add a new node to the canvas by node type.
   * Places it intelligently (adjacent to selected node or centered in view),
   * adds it to the graph, selects it, and pulses it with highlight animation.
   */
  addNodeToCanvas(nodeType, options = {}) {
    if (!nodeType) {
      return { success: false, message: "Node type is required" };
    }

    const graph = this.app?.graph;
    const canvas = this.app?.canvas;
    const LiteGraph = window.LiteGraph;

    if (!graph || !LiteGraph) {
      return { success: false, message: "ComfyUI LiteGraph canvas not available" };
    }

    // Create node instance via LiteGraph
    let node = null;
    try {
      node = LiteGraph.createNode(nodeType);
    } catch (e) {
      console.error(`[ComfyMate] Failed to instantiate node '${nodeType}':`, e);
    }

    if (!node) {
      return { success: false, message: `Node type '${nodeType}' is not installed or registered in ComfyUI` };
    }

    // Determine target position
    let targetX = 100;
    let targetY = 100;

    // Check if there is an active selected node to place alongside
    const selectedNodes = canvas?.selected_nodes ? Object.values(canvas.selected_nodes) : [];
    const refNode = selectedNodes.length > 0 ? selectedNodes[selectedNodes.length - 1] : null;

    if (refNode && Array.isArray(refNode.pos)) {
      const refW = Array.isArray(refNode.size) ? refNode.size[0] : 200;
      targetX = refNode.pos[0] + refW + 60;
      targetY = refNode.pos[1];
    } else if (canvas?.ds) {
      // Center in current viewport
      const scale = canvas.ds.scale || 1;
      const canvasEl = canvas.canvas;
      const w = canvasEl?.width || window.innerWidth;
      const h = canvasEl?.height || window.innerHeight;
      const offsetX = canvas.ds.offset?.[0] || 0;
      const offsetY = canvas.ds.offset?.[1] || 0;

      targetX = (w / 2) / scale - offsetX - (Array.isArray(node.size) ? node.size[0] / 2 : 100);
      targetY = (h / 2) / scale - offsetY - (Array.isArray(node.size) ? node.size[1] / 2 : 50);
    }

    node.pos = [Math.round(targetX), Math.round(targetY)];

    try {
      graph.add(node);
    } catch (e) {
      console.error("[ComfyMate] Error adding node to graph:", e);
      return { success: false, message: `Failed to add node to graph: ${e.message}` };
    }

    // If options.parameters provided, apply them
    if (options.parameters && typeof options.parameters === "object") {
      this.applyParameters(node.id, options.parameters);
    }

    // Focus, select, and pulse on the newly created node
    this.locateNode(node.id, true);

    return {
      success: true,
      nodeId: node.id,
      nodeType: node.type || nodeType,
      nodeTitle: node.title || node.type || nodeType,
      node,
    };
  }

  /**
   * Helper: Resolve output slot index on a source node by name, index, or type.
   */
  _resolveOutputSlot(node, slotRef) {
    if (!node || !node.outputs || !Array.isArray(node.outputs) || node.outputs.length === 0) {
      return -1;
    }

    if (slotRef === undefined || slotRef === null) {
      return node.outputs.length === 1 ? 0 : -1;
    }

    // Direct numeric index check
    if (typeof slotRef === "number") {
      return slotRef >= 0 && slotRef < node.outputs.length ? slotRef : -1;
    }

    const strRef = String(slotRef).trim();
    const numIdx = parseInt(strRef, 10);
    if (!isNaN(numIdx) && String(numIdx) === strRef && numIdx >= 0 && numIdx < node.outputs.length) {
      return numIdx;
    }

    const lowerRef = strRef.toLowerCase();

    // 1. Exact match on slot name
    let idx = node.outputs.findIndex(
      (out) => out && out.name && out.name.trim().toLowerCase() === lowerRef
    );
    if (idx !== -1) return idx;

    // 2. Exact match on slot type
    idx = node.outputs.findIndex(
      (out) => out && out.type && String(out.type).trim().toLowerCase() === lowerRef
    );
    if (idx !== -1) return idx;

    // 3. Substring match on slot name
    idx = node.outputs.findIndex(
      (out) => out && out.name && (out.name.toLowerCase().includes(lowerRef) || lowerRef.includes(out.name.toLowerCase()))
    );
    if (idx !== -1) return idx;

    // 4. Fallback if single output
    if (node.outputs.length === 1) return 0;

    return -1;
  }

  /**
   * Helper: Resolve input slot index on a target node by name, index, type, or common aliases.
   */
  _resolveInputSlot(node, slotRef, preferredType = null) {
    if (!node || !node.inputs || !Array.isArray(node.inputs) || node.inputs.length === 0) {
      return -1;
    }

    if (slotRef === undefined || slotRef === null) {
      // If preferredType provided, try matching by type first
      if (preferredType) {
        const pType = String(preferredType).trim().toLowerCase();
        const pIdx = node.inputs.findIndex(
          (inp) => inp && inp.type && String(inp.type).trim().toLowerCase() === pType
        );
        if (pIdx !== -1) return pIdx;
      }
      return node.inputs.length === 1 ? 0 : -1;
    }

    // Direct numeric index check
    if (typeof slotRef === "number") {
      return slotRef >= 0 && slotRef < node.inputs.length ? slotRef : -1;
    }

    const strRef = String(slotRef).trim();
    const numIdx = parseInt(strRef, 10);
    if (!isNaN(numIdx) && String(numIdx) === strRef && numIdx >= 0 && numIdx < node.inputs.length) {
      return numIdx;
    }

    const lowerRef = strRef.toLowerCase();

    // 1. Exact match on slot name
    let idx = node.inputs.findIndex(
      (inp) => inp && inp.name && inp.name.trim().toLowerCase() === lowerRef
    );
    if (idx !== -1) return idx;

    // 2. Exact match on slot type
    idx = node.inputs.findIndex(
      (inp) => inp && inp.type && String(inp.type).trim().toLowerCase() === lowerRef
    );
    if (idx !== -1) return idx;

    // 3. Common domain aliases
    const aliasMap = {
      image: ["images", "image", "pixels"],
      images: ["images", "image", "pixels"],
      pixels: ["pixels", "image", "images"],
      latent: ["samples", "latent", "latents"],
      latents: ["samples", "latent", "latents"],
      samples: ["samples", "latent", "latents"],
      model: ["model"],
      clip: ["clip"],
      vae: ["vae"],
      mask: ["mask", "masks"],
      masks: ["mask", "masks"],
      conditioning: ["positive", "negative", "conditioning"],
      positive: ["positive", "conditioning"],
      negative: ["negative", "conditioning"],
    };

    const aliases = aliasMap[lowerRef] || [];
    for (const alias of aliases) {
      idx = node.inputs.findIndex(
        (inp) => inp && inp.name && inp.name.trim().toLowerCase() === alias
      );
      if (idx !== -1) return idx;
    }

    // 4. Substring match on slot name
    idx = node.inputs.findIndex(
      (inp) => inp && inp.name && (inp.name.toLowerCase().includes(lowerRef) || lowerRef.includes(inp.name.toLowerCase()))
    );
    if (idx !== -1) return idx;

    // 5. Fallback match by preferredType
    if (preferredType) {
      const pType = String(preferredType).trim().toLowerCase();
      idx = node.inputs.findIndex(
        (inp) => inp && inp.type && String(inp.type).trim().toLowerCase() === pType
      );
      if (idx !== -1) return idx;
    }

    // 6. Fallback if single input
    if (node.inputs.length === 1) return 0;

    return -1;
  }

  /**
   * Connect output port(s) from source node(s) to input port(s) of target node(s).
   * Supports single connection or batch connections list.
   * Highlights connected nodes and supports undo/disconnection.
   */
  connectNodes(connectionOrList) {
    if (!connectionOrList) {
      return { success: false, errors: ["No connection parameters provided"] };
    }

    const list = Array.isArray(connectionOrList)
      ? connectionOrList
      : connectionOrList.connections && Array.isArray(connectionOrList.connections)
        ? connectionOrList.connections
        : [connectionOrList];

    if (list.length === 0) {
      return { success: false, errors: ["Empty connection list"] };
    }

    const graph = this.app?.graph;
    if (!graph) {
      return { success: false, errors: ["ComfyUI graph not available"] };
    }

    const successful = [];
    const errors = [];

    for (const item of list) {
      const fromNodeId = item.from_node ?? item.fromNode;
      const toNodeId = item.to_node ?? item.toNode;
      const fromSlotRef = item.from_slot ?? item.fromSlot;
      const toSlotRef = item.to_slot ?? item.toSlot;

      const sourceNode = this.getNode(fromNodeId);
      if (!sourceNode) {
        errors.push(`Source Node #${fromNodeId} not found on canvas`);
        continue;
      }

      const targetNode = this.getNode(toNodeId);
      if (!targetNode) {
        errors.push(`Target Node #${toNodeId} not found on canvas`);
        continue;
      }

      const outSlotIdx = this._resolveOutputSlot(sourceNode, fromSlotRef);
      if (outSlotIdx === -1) {
        errors.push(`Output slot '${fromSlotRef}' not found on Node #${fromNodeId} [${sourceNode.title || sourceNode.type}]`);
        continue;
      }

      const outSlotObj = sourceNode.outputs?.[outSlotIdx];
      const preferredType = outSlotObj?.type;

      const inSlotIdx = this._resolveInputSlot(targetNode, toSlotRef, preferredType);
      if (inSlotIdx === -1) {
        errors.push(`Input slot '${toSlotRef}' not found on Node #${toNodeId} [${targetNode.title || targetNode.type}]`);
        continue;
      }

      const inSlotObj = targetNode.inputs?.[inSlotIdx];

      // Execute LiteGraph connection
      try {
        const connectRes = sourceNode.connect(outSlotIdx, targetNode, inSlotIdx);
        const linkId = targetNode.inputs?.[inSlotIdx]?.link;
        if (connectRes === false && (linkId === null || linkId === undefined)) {
          errors.push(`LiteGraph rejected connection between Node #${sourceNode.id} [${outSlotObj?.name}] and Node #${targetNode.id} [${inSlotObj?.name}]`);
          continue;
        }
      } catch (err) {
        console.error(`[ComfyMate] Error connecting Node #${sourceNode.id} to #${targetNode.id}:`, err);
        errors.push(`Failed to link Node #${sourceNode.id} to #${targetNode.id}: ${err.message}`);
        continue;
      }

      const linkId = targetNode.inputs?.[inSlotIdx]?.link;
      const record = {
        linkId: linkId !== undefined ? linkId : null,
        fromNodeId: sourceNode.id,
        fromNodeTitle: sourceNode.title || sourceNode.type,
        fromSlot: outSlotIdx,
        fromSlotName: outSlotObj?.name || `slot_${outSlotIdx}`,
        toNodeId: targetNode.id,
        toNodeTitle: targetNode.title || targetNode.type,
        toSlot: inSlotIdx,
        toSlotName: inSlotObj?.name || `slot_${inSlotIdx}`,
      };

      successful.push(record);

      // Flash visual highlight on both nodes
      this.flashNode(targetNode);
      this.flashNode(sourceNode);
    }

    if (successful.length > 0) {
      if (graph.setDirtyCanvas) {
        graph.setDirtyCanvas(true, true);
      }
      // Center canvas on the last connected target node
      const lastTarget = this.getNode(successful[successful.length - 1].toNodeId);
      if (lastTarget) {
        this.centerOnNode(lastTarget);
      }
    }

    return {
      success: successful.length > 0,
      links: successful,
      errors,
    };
  }

  /**
   * Disconnect previously created node connections (Undo action).
   */
  disconnectNodes(linksList) {
    if (!linksList) {
      return { success: false, message: "No link info provided" };
    }

    const list = Array.isArray(linksList) ? linksList : [linksList];
    const graph = this.app?.graph;
    let disconnectedCount = 0;

    for (const record of list) {
      const toNodeId = record.toNodeId ?? record.to_node;
      const toSlot = record.toSlot ?? record.to_slot;
      const linkId = record.linkId ?? record.link_id;

      let disconnected = false;

      // Method 1: Disconnect via targetNode.disconnectInput
      if (toNodeId !== undefined && toSlot !== undefined) {
        const targetNode = this.getNode(toNodeId);
        if (targetNode && typeof targetNode.disconnectInput === "function") {
          try {
            targetNode.disconnectInput(toSlot);
            disconnected = true;
          } catch (e) {
            console.warn(`[ComfyMate] Error disconnecting input on Node #${toNodeId}:`, e);
          }
        }
      }

      // Method 2: Disconnect via graph.removeLink
      if (!disconnected && linkId !== null && linkId !== undefined && graph && typeof graph.removeLink === "function") {
        try {
          graph.removeLink(linkId);
          disconnected = true;
        } catch (e) {
          console.warn(`[ComfyMate] Error removing link #${linkId}:`, e);
        }
      }

      if (disconnected) {
        disconnectedCount++;
      }
    }

    if (disconnectedCount > 0 && graph && graph.setDirtyCanvas) {
      graph.setDirtyCanvas(true, true);
    }

    return {
      success: disconnectedCount > 0,
      count: disconnectedCount,
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
