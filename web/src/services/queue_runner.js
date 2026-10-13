/**
 * QueueRunner for ComfyMate
 * Handles closed-loop workflow execution harnessing:
 * 1. Submitting workflow execution via ComfyUI app.queuePrompt
 * 2. Listening to real-time execution events (progress, executing node, output images)
 * 3. Capturing generated images for Multimodal Vision (VLM) evaluation
 * 4. Error interception & diagnostic guidance
 */

export class QueueRunner {
  constructor(app) {
    this.app = app;
    this.status = "idle"; // "idle" | "queuing" | "executing" | "completed" | "error"
    this.activePromptId = null;
    this.listeners = [];
    this.outputImages = [];
    this.startTime = 0;
  }

  /**
   * Check if ComfyUI queue prompt capability is accessible.
   */
  isSupported() {
    return !!(this.app && (typeof this.app.queuePrompt === "function" || this.app.api));
  }

  /**
   * Get the current execution status.
   */
  getStatus() {
    return this.status;
  }

  /**
   * Build a standard ComfyUI image view URL from image output metadata.
   */
  buildImageUrl(imgMeta) {
    if (!imgMeta || !imgMeta.filename) return "";
    const filename = encodeURIComponent(imgMeta.filename);
    const subfolder = encodeURIComponent(imgMeta.subfolder || "");
    const type = encodeURIComponent(imgMeta.type || "output");
    const query = `filename=${filename}&subfolder=${subfolder}&type=${type}`;

    if (this.app?.api?.apiURL && typeof this.app.api.apiURL === "function") {
      try {
        return this.app.api.apiURL(`/view?${query}`);
      } catch (_) {}
    }
    return `/view?${query}`;
  }

  /**
   * Fetch an image URL and convert it into a base64 DataURL for multimodal LLM consumption.
   */
  async fetchImageAsDataUrl(imageUrl) {
    if (!imageUrl) return null;
    try {
      const resp = await fetch(imageUrl);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const blob = await resp.blob();
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = (err) => reject(err);
        reader.readAsDataURL(blob);
      });
    } catch (err) {
      console.warn("[ComfyMate] Failed to convert image to DataURL:", err);
      return null;
    }
  }

  /**
   * Execute the workflow in ComfyUI and track progress until completion or error.
   *
   * @param {Object} callbacks
   * @param {Function} callbacks.onStatusChange - (status, meta) => void
   * @param {Function} callbacks.onProgress - ({ value, max, percent, node, nodeTitle }) => void
   * @param {Function} callbacks.onExecutingNode - ({ nodeId, nodeTitle }) => void
   * @param {Function} callbacks.onImageOutput - ({ images, promptId, nodeId }) => void
   * @param {Function} callbacks.onComplete - ({ promptId, images, durationMs }) => void
   * @param {Function} callbacks.onError - ({ error, node_id, exception_message, traceback }) => void
   */
  async run({
    onStatusChange = null,
    onProgress = null,
    onExecutingNode = null,
    onImageOutput = null,
    onComplete = null,
    onError = null,
  } = {}) {
    if (!this.isSupported()) {
      const err = new Error("ComfyUI app.queuePrompt is not available in the current environment");
      if (onError) onError({ error: err, message: err.message });
      return { success: false, error: err };
    }

    // Clean up any existing listeners before starting
    this.cancel();

    this.status = "queuing";
    this.outputImages = [];
    this.startTime = Date.now();
    this.activePromptId = null;

    if (onStatusChange) onStatusChange(this.status, { message: "Queuing workflow..." });

    const api = this.app?.api;
    const graph = this.app?.graph;

    const getNodeTitle = (nodeId) => {
      if (!nodeId || !graph) return String(nodeId || "");
      const n = graph.getNodeById(typeof nodeId === "number" ? nodeId : parseInt(nodeId, 10));
      return n?.title || n?.type || `Node #${nodeId}`;
    };

    // Helper to register managed event listeners that can be safely detached
    const addApiListener = (eventName, handler) => {
      if (api && typeof api.addEventListener === "function") {
        api.addEventListener(eventName, handler);
        this.listeners.push({ eventName, handler });
      }
    };

    let executionStarted = false;
    let finished = false;

    const cleanup = () => {
      this.listeners.forEach(({ eventName, handler }) => {
        try {
          if (api && typeof api.removeEventListener === "function") {
            api.removeEventListener(eventName, handler);
          }
        } catch (_) {}
      });
      this.listeners = [];
    };

    // 1. Listen for Execution Start
    const handleStart = (event) => {
      const pId = event?.detail?.prompt_id;
      if (pId) {
        this.activePromptId = pId;
        executionStarted = true;
      }
    };
    addApiListener("execution_start", handleStart);

    // 2. Listen for Progress Updates
    const handleProgress = (event) => {
      const d = event?.detail || {};
      const value = d.value || 0;
      const max = d.max || 1;
      const percent = Math.min(100, Math.round((value / max) * 100));
      const nodeId = d.node;
      const nodeTitle = getNodeTitle(nodeId);

      if (this.status !== "executing") {
        this.status = "executing";
        if (onStatusChange) onStatusChange(this.status, { percent, nodeTitle });
      }

      if (onProgress) {
        onProgress({
          value,
          max,
          percent,
          node: nodeId,
          nodeTitle,
        });
      }
    };
    addApiListener("progress", handleProgress);

    // 3. Listen for Currently Executing Node
    const handleExecuting = (event) => {
      const d = event?.detail;
      const nodeId = typeof d === "object" ? d?.node : d;
      const promptId = typeof d === "object" ? d?.prompt_id : null;

      if (promptId && !this.activePromptId) {
        this.activePromptId = promptId;
      }

      // In ComfyUI WebSocket protocol: when node is null/undefined, execution of the prompt is finished!
      if (nodeId === null || nodeId === undefined) {
        if (executionStarted || this.outputImages.length > 0) {
          finishSuccess();
        }
        return;
      }

      executionStarted = true;
      this.status = "executing";
      const nodeTitle = getNodeTitle(nodeId);

      if (onExecutingNode) {
        onExecutingNode({
          nodeId,
          nodeTitle,
        });
      }
      if (onStatusChange) {
        onStatusChange(this.status, { nodeTitle, nodeId });
      }
    };
    addApiListener("executing", handleExecuting);

    // 4. Listen for Executed Nodes with Output Artifacts (Images)
    const handleExecuted = (event) => {
      const d = event?.detail || {};
      const nodeId = d.node;
      const output = d.output;

      if (output && Array.isArray(output.images) && output.images.length > 0) {
        const newImages = output.images.map((img) => ({
          ...img,
          nodeId,
          url: this.buildImageUrl(img),
        }));

        this.outputImages.push(...newImages);

        if (onImageOutput) {
          onImageOutput({
            images: newImages,
            allImages: [...this.outputImages],
            promptId: d.prompt_id || this.activePromptId,
            nodeId,
          });
        }
      }
    };
    addApiListener("executed", handleExecuted);

    // 5. Listen for Execution Error
    const handleError = (event) => {
      if (finished) return;
      finished = true;
      cleanup();

      this.status = "error";
      const detail = event?.detail || {};
      const errPayload = {
        error: new Error(detail.exception_message || "ComfyUI execution error"),
        node_id: detail.node_id,
        node_type: detail.node_type,
        exception_type: detail.exception_type,
        exception_message: detail.exception_message,
        traceback: Array.isArray(detail.traceback) ? detail.traceback.join("\n") : detail.traceback,
      };

      if (onStatusChange) onStatusChange("error", errPayload);
      if (onError) onError(errPayload);
    };
    addApiListener("execution_error", handleError);

    // Finish handler when all steps complete
    const finishSuccess = () => {
      if (finished) return;
      finished = true;
      cleanup();

      this.status = "completed";
      const durationMs = Date.now() - this.startTime;

      const result = {
        promptId: this.activePromptId,
        images: [...this.outputImages],
        durationMs,
      };

      if (onStatusChange) onStatusChange("completed", result);
      if (onComplete) onComplete(result);
    };

    // Trigger the actual queue execution in ComfyUI
    try {
      if (typeof this.app.queuePrompt === "function") {
        await this.app.queuePrompt(0, 1);
      } else if (this.app.api && typeof this.app.api.queuePrompt === "function") {
        await this.app.api.queuePrompt(0, 1);
      } else {
        throw new Error("No available queuePrompt method found on ComfyUI app instance");
      }
      return { success: true };
    } catch (err) {
      if (finished) return { success: false, error: err };
      finished = true;
      cleanup();

      this.status = "error";
      const errPayload = {
        error: err,
        message: err.message,
      };

      if (onStatusChange) onStatusChange("error", errPayload);
      if (onError) onError(errPayload);
      return { success: false, error: err };
    }
  }

  /**
   * Cancel ongoing tracking and remove all event listeners.
   */
  cancel() {
    if (this.listeners.length > 0) {
      const api = this.app?.api;
      this.listeners.forEach(({ eventName, handler }) => {
        try {
          if (api && typeof api.removeEventListener === "function") {
            api.removeEventListener(eventName, handler);
          }
        } catch (_) {}
      });
      this.listeners = [];
    }
    this.status = "idle";
    this.activePromptId = null;
  }
}
