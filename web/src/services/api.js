/**
 * Backend API Client for ComfyMate.
 */
export class ApiClient {
  static async _handleResponse(resp, actionName = "Request") {
    if (!resp.ok) {
      let errorMsg = `${actionName} failed (HTTP ${resp.status})`;
      try {
        const errJson = await resp.json();
        if (errJson && errJson.message) {
          errorMsg = errJson.message;
        }
      } catch (_) {
        // Response wasn't JSON
      }
      throw new Error(errorMsg);
    }
    return await resp.json();
  }

  static async getConfig() {
    const resp = await fetch("/comfymate/api/config");
    return await this._handleResponse(resp, "Get config");
  }

  static async saveConfig(config) {
    const resp = await fetch("/comfymate/api/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(config),
    });
    return await this._handleResponse(resp, "Save config");
  }

  static async testConnection({ id, api_type, base_url, api_key, model, models, proxy, fetch_models_only = false }) {
    const resp = await fetch("/comfymate/api/test_connection", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id,
        api_type,
        base_url,
        api_key,
        model,
        models,
        fetch_models_only,
        proxy,
      }),
    });
    // For test connection, status 400/504 can still return structured error details
    if (resp.status >= 500) {
      let errText = `HTTP ${resp.status}`;
      try {
        const d = await resp.json();
        if (d && d.message) errText = d.message;
      } catch (_) {}
      throw new Error(errText);
    }
    return await resp.json();
  }

  static async streamChat({ messages, context, model_config, language, signal, onEvent }) {
    const resp = await fetch("/comfymate/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages,
        context,
        model_config,
        language,
      }),
      signal,
    });

    if (!resp.ok) {
      let errDetail = `HTTP ${resp.status}`;
      try {
        const errJson = await resp.json();
        if (errJson && errJson.message) errDetail = errJson.message;
      } catch (_) {}
      throw new Error(errDetail);
    }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith("data: ")) {
          const jsonStr = trimmed.substring(6).trim();
          if (jsonStr === "[DONE]") return;
          try {
            const event = JSON.parse(jsonStr);
            onEvent(event);
          } catch (e) {
            console.warn("[ComfyMate] Failed to parse SSE event:", jsonStr);
          }
        }
      }
    }
  }

  static async uploadAttachment({ dataUrl, filename }) {
    const resp = await fetch("/comfymate/api/upload_attachment", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: dataUrl, filename }),
    });
    return await this._handleResponse(resp, "Upload attachment");
  }

  static async getSessions() {
    const resp = await fetch("/comfymate/api/sessions");
    return await this._handleResponse(resp, "Get sessions");
  }

  static async getSession(sessionId) {
    const resp = await fetch(`/comfymate/api/sessions/${encodeURIComponent(sessionId)}`);
    return await this._handleResponse(resp, "Get session");
  }

  static async saveSession(sessionData) {
    const resp = await fetch("/comfymate/api/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(sessionData),
    });
    return await this._handleResponse(resp, "Save session");
  }

  static async deleteSession(sessionId) {
    const resp = await fetch(`/comfymate/api/sessions/${encodeURIComponent(sessionId)}`, {
      method: "DELETE",
    });
    return await this._handleResponse(resp, "Delete session");
  }

  static async searchNodes(query = "", limit = 15, refresh = false) {
    const params = new URLSearchParams({ q: query, limit: String(limit) });
    if (refresh) params.set("refresh", "1");
    const resp = await fetch(`/comfymate/api/nodes/search?${params.toString()}`);
    return await this._handleResponse(resp, "Search nodes");
  }

  static async getNodeInfo(nodeType, refresh = false) {
    const params = new URLSearchParams({ type: nodeType });
    if (refresh) params.set("refresh", "1");
    const resp = await fetch(`/comfymate/api/nodes/info?${params.toString()}`);
    return await this._handleResponse(resp, "Get node info");
  }
}
