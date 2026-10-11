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

  _cleanWorkflowName(name) {
    if (!name || typeof name !== "string") return "";
    let cleaned = name.trim();
    // Strip trailing status dots, unsaved dirty markers (*), close buttons, whitespace
    cleaned = cleaned.replace(/[\*×✕x•·\s]+$/, "").trim();
    return cleaned;
  }

  _extractTabName(tabEl) {
    if (!tabEl) return "";
    let name = tabEl.getAttribute("title");
    if (name) {
      name = this._cleanWorkflowName(name);
      if (name && !["settings", "extensions", "manager"].includes(name.toLowerCase())) {
        return name;
      }
    }
    const labelEl = tabEl.querySelector(
      ".p-button-label, .workflow-label, [data-testid='workflow-label'], span.truncate, span:not(.close-button)"
    );
    if (labelEl) {
      name = labelEl.getAttribute("title") || labelEl.textContent;
      name = this._cleanWorkflowName(name);
      if (name && !["settings", "extensions", "manager"].includes(name.toLowerCase())) {
        return name;
      }
    }
    // Fallback: clone tab and remove close buttons / badge dots / SVG icons
    try {
      const clone = tabEl.cloneNode(true);
      clone.querySelectorAll(".close-button, [data-testid='close-workflow-button'], button, .p-badge, .dot, svg").forEach((el) => el.remove());
      name = this._cleanWorkflowName(clone.textContent);
      if (name && !["settings", "extensions", "manager"].includes(name.toLowerCase())) {
        return name;
      }
    } catch (_) {}
    return "";
  }

  /**
   * Resolve active workflow info from modern ComfyUI native tabs, Pinia, workspace manager or graph.
   */
  getCurrentWorkflowInfo() {
    // 0. Check ComfyUI modern Pinia workflow store if exposed (currentWorkflow or activeWorkflow)
    try {
      const piniaState = window.__pinia?.state?.value ||
        document.querySelector('#app')?.__vue_app__?.config?.globalProperties?.$pinia?.state?.value;
      const wfStore = piniaState?.workflow || piniaState?.workflowStore || piniaState?.workflows;
      const wf = wfStore?.currentWorkflow || wfStore?.activeWorkflow;
      if (wf && (wf.filename || wf.name || wf.path)) {
        const rawName = wf.filename || wf.name || (wf.path ? wf.path.split(/[/\\]/).pop() : "");
        const name = this._cleanWorkflowName(rawName);
        if (name) {
          const path = wf.path || name;
          return { id: path, name, path };
        }
      }
    } catch (_) {}

    // 1. Check ComfyUI modern PrimeVue ToggleButton tabs (WorkflowTabs.vue)
    try {
      const checkedToggleBtn = document.querySelector(
        '.workflow-tabs .p-togglebutton-checked, ' +
        '.workflow-tabs [data-p-checked="true"], ' +
        '.workflow-tabs [aria-pressed="true"], ' +
        '[data-testid*="workflow-tab"] .p-togglebutton-checked, ' +
        '.p-togglebutton-checked, ' +
        '.p-togglebutton[data-p-checked="true"], ' +
        '.p-togglebutton[aria-pressed="true"]'
      );
      if (checkedToggleBtn) {
        const isWorkflowTab = checkedToggleBtn.querySelector('.close-button, [data-testid="close-workflow-button"]') ||
          checkedToggleBtn.closest('.workflow-tabs, [data-testid*="workflow-tab"], .top-bar, .comfy-menu');
        if (isWorkflowTab) {
          const name = this._extractTabName(checkedToggleBtn);
          if (name) {
            const path = checkedToggleBtn.getAttribute('data-value') || checkedToggleBtn.getAttribute('value') || name;
            return { id: path || name, name, path: path || name };
          }
        }
      }
    } catch (_) {}

    // 2. Check tab elements associated with close buttons
    // In ComfyUI frontend, only workflow tabs have .close-button or [data-testid="close-workflow-button"]
    try {
      const allCloseButtons = document.querySelectorAll('.close-button, [data-testid="close-workflow-button"]');
      if (allCloseButtons.length > 0) {
        // Find the active tab among them
        for (const btn of allCloseButtons) {
          const tab = btn.closest('.p-togglebutton, [role="tab"], [data-testid*="workflow-tab"], .workflow-tab, button');
          if (tab) {
            const isActive = tab.classList.contains('p-togglebutton-checked') ||
              tab.classList.contains('active') ||
              tab.classList.contains('p-highlight') ||
              tab.getAttribute('data-p-checked') === 'true' ||
              tab.getAttribute('aria-pressed') === 'true' ||
              tab.getAttribute('data-state') === 'active' ||
              tab.getAttribute('aria-selected') === 'true' ||
              (tab.classList.contains('shrink-0') && !tab.classList.contains('shrink'));
            if (isActive) {
              const name = this._extractTabName(tab);
              if (name) {
                const path = tab.getAttribute('data-value') || tab.getAttribute('value') || name;
                return { id: path || name, name, path: path || name };
              }
            }
          }
        }
        // If only 1 tab exists with a close button, it is the only and active workflow
        if (allCloseButtons.length === 1) {
          const tab = allCloseButtons[0].closest('.p-togglebutton, [role="tab"], [data-testid*="workflow-tab"], .workflow-tab, button');
          if (tab) {
            const name = this._extractTabName(tab);
            if (name) {
              const path = tab.getAttribute('data-value') || tab.getAttribute('value') || name;
              return { id: path || name, name, path: path || name };
            }
          }
        }
      }
    } catch (_) {}

    // 3. Inspect standard / Radix WorkflowTabs containers
    const tabStrips = document.querySelectorAll(
      '[data-testid="workflow-tab-strip"], [data-testid*="workflow-tab"], .workflow-tabs, .workflow-tabs-container, nav[aria-label*="workflow" i]'
    );
    for (const tabStrip of tabStrips) {
      const activeTrigger = tabStrip.querySelector(
        '[data-state="active"], [aria-selected="true"], .active, .p-highlight, .p-togglebutton-checked, [data-p-checked="true"], [aria-pressed="true"]'
      );
      if (activeTrigger) {
        const tab = activeTrigger.closest('[data-testid*="workflow-tab"], .workflow-tab, .p-togglebutton, [role="tab"]') || activeTrigger;
        const name = this._extractTabName(tab);
        if (name) {
          const path = activeTrigger.getAttribute('value') || activeTrigger.getAttribute('data-value') || tab.getAttribute('data-value') || name;
          return { id: path || name, name, path: path || name };
        }
      }

      // Check tab list in strip
      const tabs = tabStrip.querySelectorAll('[data-testid*="workflow-tab"], .workflow-tab, .p-togglebutton, [role="tab"]');
      if (tabs.length > 0) {
        for (const tab of tabs) {
          const isShrink0 = tab.classList.contains('shrink-0') && !tab.classList.contains('shrink');
          const isTabActive = isShrink0 ||
            tab.getAttribute('data-state') === 'active' ||
            tab.getAttribute('aria-selected') === 'true' ||
            tab.getAttribute('data-p-checked') === 'true' ||
            tab.getAttribute('aria-pressed') === 'true' ||
            tab.classList.contains('active') ||
            tab.classList.contains('p-highlight') ||
            tab.classList.contains('p-togglebutton-checked');
          if (isTabActive) {
            const name = this._extractTabName(tab);
            if (name) {
              const path = tab.getAttribute('data-value') || tab.getAttribute('value') || name;
              return { id: path || name, name, path: path || name };
            }
          }
        }
      }
    }

    // 4. Global workflow tab fallback (strictly scoped to workflow tabs, never sidebar)
    const globalTabs = document.querySelectorAll('[data-testid*="workflow-tab"], .workflow-tab');
    if (globalTabs.length > 0) {
      for (const tab of globalTabs) {
        const isShrink0 = tab.classList.contains('shrink-0') && !tab.classList.contains('shrink');
        const isTabActive = isShrink0 ||
          tab.getAttribute('data-state') === 'active' ||
          tab.getAttribute('aria-selected') === 'true' ||
          tab.getAttribute('data-p-checked') === 'true' ||
          tab.getAttribute('aria-pressed') === 'true' ||
          tab.classList.contains('active') ||
          tab.classList.contains('p-highlight') ||
          tab.classList.contains('p-togglebutton-checked');
        if (isTabActive) {
          const name = this._extractTabName(tab);
          if (name) {
            const path = tab.getAttribute('data-value') || tab.getAttribute('value') || name;
            return { id: path || name, name, path: path || name };
          }
        }
      }
    }

    // 5. Fallback: inspect any top tab bar (e.g. .comfy-menu-tabs, [role="tablist"] at top)
    const topTabList = document.querySelector('.comfy-menu [role="tablist"], .top-bar [role="tablist"], [role="tablist"]');
    if (topTabList) {
      const activeTab = topTabList.querySelector('[role="tab"][aria-selected="true"], [role="tab"][data-state="active"], [role="tab"].active, [role="tab"].p-highlight');
      if (activeTab) {
        const name = this._extractTabName(activeTab);
        if (name && !["settings", "extensions", "manager"].includes(name.toLowerCase())) {
          return { id: name, name, path: name };
        }
      }
    }

    // 6. Check Workspace Manager extension if present
    if (window.workspaceManager?.activeWorkflow) {
      const wf = window.workspaceManager.activeWorkflow;
      const name = this._cleanWorkflowName(wf.name || wf.title || wf.filename);
      if (name) {
        return { id: wf.id || name, name, path: wf.path || name };
      }
    }

    // 7. Check LiteGraph / app.graph extra metadata
    const graphExtra = this.app?.graph?.extra;
    if (graphExtra?.workspace?.filename) {
      const name = this._cleanWorkflowName(String(graphExtra.workspace.filename));
      if (name) return { id: name, name, path: name };
    }
    if (graphExtra?.title) {
      const name = this._cleanWorkflowName(String(graphExtra.title));
      if (name) return { id: name, name, path: name };
    }
    if (this.app?.graph?.workflow?.file_path) {
      const rawPath = String(this.app.graph.workflow.file_path);
      const name = this._cleanWorkflowName(rawPath.split(/[/\\]/).pop());
      if (name) return { id: name, name, path: rawPath };
    }
    if (this.app?.graph?.filename) {
      const name = this._cleanWorkflowName(String(this.app.graph.filename));
      if (name) return { id: name, name, path: name };
    }

    return null;
  }

  /**
   * Package all available context into a single payload.
   */
  captureContext() {
    const wf = this.getCurrentWorkflowInfo();
    return {
      workflow_name: wf?.name || null,
      selected_nodes: this.getSelectedNodes(),
      workflow_summary: this.getWorkflowSummary(),
      error_info: this.lastError,
    };
  }
}
