/**
 * Context Extractor for ComfyUI LiteGraph Canvas
 * Converts heavy raw graph JSON into token-efficient topology summaries.
 */
export class ContextExtractor {
  constructor(app) {
    this.app = app;
    this.lastError = null;
    this._setupErrorInterceptor();
  }

  _setupErrorInterceptor() {
    if (this.app?.api) {
      this.app.api.addEventListener("execution_error", (event) => {
        const detail = event.detail;
        this.lastError = {
          node_id: detail?.node_id,
          node_type: detail?.node_type,
          exception_type: detail?.exception_type,
          message: detail?.exception_message,
          traceback: Array.isArray(detail?.traceback)
            ? detail.traceback.join("\n")
            : detail?.traceback,
          timestamp: Date.now(),
        };
        console.warn("[ComfyMate] Intercepted execution error:", this.lastError);
      });
    }
  }

  clearError() {
    this.lastError = null;
  }

  _getNodeTitle(node) {
    return node?.title || node?.type || "Unknown";
  }

  _getNodeMode(node) {
    if (node.mode === 2) return "Muted";
    if (node.mode === 4) return "Bypassed";
    return "Active";
  }

  /**
   * Get the currently selected nodes on the canvas with detailed upstream and downstream links.
   */
  getSelectedNodes() {
    const canvas = this.app?.canvas;
    const graph = this.app?.graph;
    if (!canvas || !canvas.selected_nodes || !graph) return [];

    const links = graph.links || {};
    const selected = Object.values(canvas.selected_nodes);

    return selected.map((node) => {
      // 1. Widgets & parameters
      const widgetValues = {};
      if (node.widgets) {
        node.widgets.forEach((w) => {
          if (w.name) {
            let val = w.value;
            if (typeof val === "string" && val.length > 80) {
              val = val.substring(0, 77) + "...";
            }
            widgetValues[w.name] = val;
          }
        });
      }

      // 2. Upstream Inputs (Where data comes from)
      const inputs = {};
      if (node.inputs) {
        node.inputs.forEach((inp) => {
          if (inp.link !== null && inp.link !== undefined && links[inp.link]) {
            const linkObj = links[inp.link];
            const originNode = graph.getNodeById(linkObj.origin_id);
            const originTitle = this._getNodeTitle(originNode);
            inputs[inp.name] = `Connected from Node #${linkObj.origin_id} [${originTitle}] (${inp.type || linkObj.type})`;
          } else {
            inputs[inp.name] = `Not Connected (${inp.type || "ANY"})`;
          }
        });
      }

      // 3. Downstream Outputs (Where data goes to)
      const outputs = {};
      if (node.outputs) {
        node.outputs.forEach((out, slotIdx) => {
          const outName = out.name || `slot_${slotIdx}`;
          if (out.links && out.links.length > 0) {
            const targets = [];
            out.links.forEach((linkId) => {
              const linkObj = links[linkId];
              if (linkObj) {
                const targetNode = graph.getNodeById(linkObj.target_id);
                const targetTitle = this._getNodeTitle(targetNode);
                targets.push(`Node #${linkObj.target_id} [${targetTitle}]`);
              }
            });
            outputs[outName] = targets.length > 0 ? targets.join(", ") : "Unconnected";
          } else {
            outputs[outName] = "Unconnected";
          }
        });
      }

      return {
        id: node.id,
        type: node.type,
        title: this._getNodeTitle(node),
        mode: this._getNodeMode(node),
        widgets_values: widgetValues,
        inputs: inputs,
        outputs: outputs,
      };
    });
  }

  /**
   * Produce a compact DAG topological summary of the current workflow.
   */
  getWorkflowSummary() {
    const graph = this.app?.graph;
    if (!graph || !graph._nodes) return null;

    const nodes = graph._nodes;
    const links = graph.links || {};

    const nodeDescriptions = [];

    for (const node of nodes) {
      const nid = node.id;
      const ntype = node.type;
      const title = node.title && node.title !== ntype ? ` "${node.title}"` : "";
      const mode = this._getNodeMode(node);

      // Compact upstream inputs
      const inputLinks = [];
      if (node.inputs) {
        for (const inp of node.inputs) {
          if (inp.link && links[inp.link]) {
            const linkObj = links[inp.link];
            const originNode = graph.getNodeById(linkObj.origin_id);
            const originType = originNode ? originNode.type : `Node#${linkObj.origin_id}`;
            inputLinks.push(`${inp.name}<-#${linkObj.origin_id}[${originType}]`);
          }
        }
      }

      // Compact key widgets (e.g. model name, seed, steps, etc.)
      const widgetSummaries = [];
      if (node.widgets) {
        for (const w of node.widgets) {
          if (!w.name) continue;
          let val = w.value;
          if (typeof val === "string" && val.length > 40) {
            val = val.substring(0, 37) + "...";
          }
          widgetSummaries.push(`${w.name}=${JSON.stringify(val)}`);
        }
      }

      let desc = `Node #${nid} [${ntype}${title}]`;
      if (mode !== "Active") {
        desc += ` (${mode})`;
      }
      if (widgetSummaries.length > 0) {
        desc += ` (${widgetSummaries.slice(0, 4).join(", ")})`;
      }
      if (inputLinks.length > 0) {
        desc += ` inputs: [${inputLinks.join(", ")}]`;
      }

      nodeDescriptions.push(desc);
    }

    return {
      total_nodes: nodes.length,
      nodes_desc: nodeDescriptions,
    };
  }

  /**
   * Package all available context into a single payload.
   */
  captureContext() {
    return {
      selected_nodes: this.getSelectedNodes(),
      workflow_summary: this.getWorkflowSummary(),
      error_info: this.lastError,
    };
  }
}
