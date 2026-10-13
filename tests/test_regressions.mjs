import assert from "node:assert/strict";
import { test } from "node:test";
import { renderMarkdown } from "../web/src/components/markdown/markdown.js";
import { QueueRunner } from "../web/src/services/queue_runner.js";
import { CanvasActionManager } from "../web/src/canvas/actions.js";
import { ChatUI } from "../web/chat_ui.js";
import { ApiClient } from "../web/src/services/api.js";

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};
const tick = () => new Promise((resolve) => setImmediate(resolve));
class MockApi extends EventTarget {
  emit(type, detail) { this.dispatchEvent(Object.assign(new Event(type), { detail })); }
}

// These cases reach the same renderer used by streaming, final answers and history restore.
test("Markdown escapes node labels, attributes and spoofed placeholders without reparsing generated HTML", () => {
  for (const source of [
    "`Node #1 [<img src=x onerror=alert(1)>]`",
    "Node #1 [<svg onload=alert(1)>]",
    '__CM_CODE_BLOCK_<img src=x onerror=alert(1)>__',
    '[click](https://example.com/"onmouseover="alert&#40;1&#41;)',
    '[click](https://example.com/`#1`)',
    '[click](javascript:alert(1))',
  ]) {
    const html = renderMarkdown(source);
    assert.doesNotMatch(html, /<img|<svg|href="[^"]*"onmouseover|href="[^"]*<span|href="javascript:/i);
  }
  assert.match(renderMarkdown("`Node #3 [KSampler]`"), /data-node-id="3"/);
  assert.match(renderMarkdown("__Node #1__"), /<strong><span[^>]+>📍 Node #1<\/span><\/strong>/);
  assert.match(renderMarkdown("__[docs](https://example.com)__"), /<strong><a /);
  assert.match(renderMarkdown("[**docs**](https://example.com/?a=1&b=2)"), /href="https:\/\/example.com\/\?a=1&amp;b=2"[^>]*><strong>docs<\/strong>/);
  assert.match(renderMarkdown("# Title\n\n- item\n\n> quote"), /<h1.*<ul.*<blockquote/s);
  assert.doesNotMatch(renderMarkdown("\u0000CMINLINE0\u0000 `Node #1 [<img src=x>]`"), /<img/);
  const translated = renderMarkdown("Node #1", () => '\" onmouseover=\"bad');
  assert.doesNotMatch(translated, /title="" onmouseover/);
});

test("code, inline code and action cards preserve dollar tokens and copy payloads", () => {
  const code = "echo $$ $& $` $' $1";
  const html = renderMarkdown("```bash\n" + code + "\n```\n\n`$$ $&`\n\n```text\nlast\n```");
  assert.match(html, /echo \$\$ \$&amp; \$` \$&#039; \$1/);
  assert(html.includes(`data-code="${encodeURIComponent(code + "\n")}"`));
  assert.match(html, /<code class="cm-inline-code">\$\$ \$&amp;<\/code>/);
  assert.match(html, /last/);
  assert.match(renderMarkdown("```bash\necho $$"), /echo \$\$/);
  // Exercise all card paths, including markup-looking fields and special replacement tokens.
  for (const action of [
    { action: "set_parameters", node_id: 1, parameters: { text: '<img src=x> $$ $&' } },
    { action: "recommend_nodes", nodes: [{ type: "LoadImage", reason: '$$ $& <img src=x>' }] },
    { action: "connect_nodes", from_node: 1, to_node: 2, from_slot: 0, to_slot: 0 },
    { action: "auto_layout", scope: "all" },
    { action: "queue_prompt", eval_prompt: '" <img src=x>' },
  ]) {
    action.reason = '$$ $& <img src=x>';
    const card = renderMarkdown("```comfymate-action\n" + JSON.stringify(action) + "\n```");
    assert.match(card, /cm-action-card/);
    assert.doesNotMatch(card, /<img/);
    assert.match(card, /\$\$ \$&amp;/);
  }
  // Prefix collisions cannot restore someone else's block, even with 12 real blocks.
  const blocks = Array.from({ length: 12 }, (_, i) => `\`\`\`text\nblock${i}\n\`\`\``).join("\n");
  const rendered = renderMarkdown(blocks + "\n__CM_CODE_BLOCK_0__\n\u0000CMBLOCK0\u0000");
  assert.equal((rendered.match(/cm-code-wrapper/g) || []).length, 12);
});

test("native submission keeps hooks and binds only its exported prompt, buffering early events", async () => {
  const api = new MockApi();
  const reply = deferred();
  const prompt = { output: { 1: {} }, workflow: {} };
  let nativeCalled = false, afterQueued = false;
  const originalExport = async () => prompt;
  const originalSubmit = async (number, data) => {
    assert.equal(number, 0);
    if (data !== prompt) return { prompt_id: "foreign-submit" };
    return reply.promise;
  };
  api.queuePrompt = originalSubmit;
  const app = { api, graphToPrompt: originalExport, async queuePrompt() {
    nativeCalled = true;
    this.processingQueue = true;
    try {
      const exported = await this.graphToPrompt();
      await api.queuePrompt(0, { output: {}, workflow: {} }); // unrelated API submission
      await api.queuePrompt(0, exported);
      afterQueued = true;
      return true;
    } finally { this.processingQueue = false; }
  } };
  const runner = new QueueRunner(app);
  let complete;
  const run = runner.run({ onComplete: (result) => { complete = result; } });
  await tick();
  api.emit("execution_start", { prompt_id: "other" });
  api.emit("execution_error", { prompt_id: "other", exception_message: "wrong" });
  api.emit("execution_start", { prompt_id: "own" });
  api.emit("executed", { prompt_id: "other", node: 8, output: { images: [{ filename: "wrong.png" }] } });
  api.emit("executed", { prompt_id: "own", node: 8, output: { images: [{ filename: "own.png" }] } });
  api.emit("executing", { prompt_id: "other", node: null });
  api.emit("executing", { prompt_id: "own", node: null });
  reply.resolve({ prompt_id: "own" });
  assert.equal((await run).success, true);
  assert(nativeCalled && afterQueued);
  assert.equal(complete.promptId, "own");
  assert.deepEqual(complete.images.map((i) => i.filename), ["own.png"]);
  assert.equal(app.graphToPrompt, originalExport);
  assert.equal(api.queuePrompt, originalSubmit);
});

test("queue filters progress/errors, handles interruptions and preserves an ongoing run", async () => {
  const api = new MockApi();
  const runner = new QueueRunner({ api, queuePrompt: async () => ({ prompt_id: "own" }) });
  let progress = 0, error;
  await runner.run({ onProgress: () => progress++, onError: (e) => { error = e; } });
  assert.equal((await runner.run()).success, false);
  assert.equal(runner.getStatus(), "queuing");
  api.emit("progress", { prompt_id: "other", value: 1, max: 2 });
  api.emit("execution_error", { prompt_id: "other" });
  api.emit("executing", { prompt_id: "other", node: null });
  assert.equal(runner.getStatus(), "queuing");
  api.emit("progress", { prompt_id: "own", value: 1, max: 2 });
  assert.equal(progress, 1);
  api.emit("execution_interrupted", { prompt_id: "own", exception_message: "interrupted" });
  assert.equal(runner.getStatus(), "error");
  assert.equal(error.exception_message, "interrupted");
});

test("queue submission rejection, cancellation and API fallback have correct contracts", async () => {
  for (const result of [false, undefined, {}]) {
    const runner = new QueueRunner({ api: new MockApi(), queuePrompt: async () => result });
    assert.equal((await runner.run()).success, false);
    assert.equal(runner.getStatus(), "error");
    assert.equal(runner.listeners.length, 0);
  }
  const api = new MockApi(), prompt = { output: { 1: {} }, workflow: {} };
  api.queuePrompt = async (number, data) => { assert.equal(number, 0); assert.equal(data, prompt); return { prompt_id: "api-own" }; };
  const runner = new QueueRunner({ api, graphToPrompt: async () => prompt });
  assert.equal((await runner.run()).success, true);
  api.emit("execution_success", { prompt_id: "api-own" });
  assert.equal(runner.getStatus(), "completed");
  const late = deferred();
  const cancelled = new QueueRunner({ api, queuePrompt: () => late.promise });
  const run = cancelled.run(); cancelled.cancel();
  late.resolve({ prompt_id: "late" });
  assert.equal((await run).success, false);
  assert.equal(cancelled.getStatus(), "idle");
});

function graphFixture() {
  let nextId = 20;
  const links = new Map();
  const target = { id: 3, inputs: [{ name: "image", type: "IMAGE", link: null }], disconnectInput(slot) {
    links.delete(this.inputs[slot].link); this.inputs[slot].link = null;
  } };
  const makeSource = (id) => ({ id, outputs: [{ name: "IMAGE", type: "IMAGE" }], connect(slot, node, input) {
    node.disconnectInput(input);
    const link = { id: nextId++, origin_id: id, origin_slot: slot, target_id: node.id, target_slot: input };
    links.set(link.id, link); node.inputs[input].link = link.id; return link;
  } });
  const first = makeSource(1), second = makeSource(2);
  const nodes = new Map([[1, first], [2, second], [3, target]]);
  const graph = { links, getNodeById: (id) => nodes.get(id), setDirtyCanvas() {} };
  const manager = new CanvasActionManager({ graph });
  manager.flashNode = manager.centerOnNode = () => {};
  return { first, second, target, links, nodes, manager };
}

test("connection undo restores old endpoints and rejects stale records and null rejections", () => {
  const { first, second, target, links, nodes, manager } = graphFixture();
  first.connect(0, target, 0);
  const original = target.inputs[0].link;
  const result = manager.connectNodes({ from_node: 2, from_slot: 0, to_node: 3, to_slot: 0 });
  assert(result.success); assert.notEqual(target.inputs[0].link, original);
  // UI serializes the undo record into an HTML data attribute.
  assert(manager.disconnectNodes(JSON.parse(JSON.stringify(result.links))).success);
  assert.equal(links.get(target.inputs[0].link).origin_id, 1);
  const applied = manager.connectNodes({ from_node: 2, from_slot: 0, to_node: 3, to_slot: 0 });
  first.connect(0, target, 0);
  const manual = target.inputs[0].link;
  assert.equal(manager.disconnectNodes(applied.links).success, false);
  assert.equal(target.inputs[0].link, manual);
  second.connect = () => null;
  assert.equal(manager.connectNodes({ from_node: 2, from_slot: 0, to_node: 3, to_slot: 0 }).success, false);
  assert.equal(target.inputs[0].link, manual);
  // New graph/node instances can reuse the same IDs and link IDs; old cards cannot undo them.
  const another = graphFixture();
  another.first.connect(0, another.target, 0);
  another.second.connect(0, another.target, 0);
  const reused = another.target.inputs[0].link;
  manager.app.graph = another.manager.app.graph;
  assert.equal(manager.disconnectNodes(applied.links).success, false);
  assert.equal(another.target.inputs[0].link, reused);
});

test("reapplying a connection leaves the existing link unchanged on undo", () => {
  const { first, target, manager } = graphFixture();
  first.connect(0, target, 0); const original = target.inputs[0].link;
  const result = manager.connectNodes({ from_node: 1, from_slot: 0, to_node: 3, to_slot: 0 });
  assert(result.success); assert(manager.disconnectNodes(result.links).success);
  assert.equal(target.inputs[0].link, original);
});

function sessionFixture() {
  const c = Object.create(ChatUI.prototype);
  Object.assign(c, { activeWorkflow: { name: "A" }, messages: [{ role: "user", content: "one" }],
    currentSessionId: null, currentSessionTitle: "A", _workflowChatCache: {}, panel: { querySelector: () => null },
    _setStreamingState() {}, _renderMessages() {}, _updateStaticUIText() {}, _updateHeaderWorkflowBadge() {},
    extractor: { clearError() {} }, t: (k) => k });
  return c;
}

test("session IDs are allocated before I/O; saves serialize and late responses cannot revive cleared/switched sessions", async () => {
  const original = ApiClient.saveSession;
  const first = deferred(), second = deferred();
  const calls = [];
  ApiClient.saveSession = (data) => { calls.push(data); return calls.length === 1 ? first.promise : second.promise; };
  try {
    const c = sessionFixture();
    const save1 = c._saveCurrentSession(); const id = c.currentSessionId;
    assert(id?.startsWith("sess_"));
    c.messages.push({ role: "assistant", content: "two" });
    const save2 = c._saveCurrentSession();
    await tick(); assert.equal(calls.length, 1);
    c._createNewSession();
    first.resolve({ status: "ok", session: { id, title: "old" } }); await save1; await tick();
    assert.equal(c.currentSessionId, null); assert.equal(c._workflowChatCache.A.sessionId, null);
    assert.equal(calls.length, 2); assert.equal(calls[1].id, id);
    assert.equal(calls[0].messages.length, 1); assert.equal(calls[1].messages.length, 2);
    c.activeWorkflow = { name: "B" }; c.currentSessionId = "B-id"; c.currentSessionTitle = "B";
    second.resolve({ status: "ok", session: { id, title: "old" } }); await save2;
    assert.equal(c.currentSessionId, "B-id"); assert.equal(c.currentSessionTitle, "B");
  } finally { ApiClient.saveSession = original; }
});

test("stale history loads cannot override a newer session selection or clear", async () => {
  const original = ApiClient.getSession;
  const loadA = deferred();
  ApiClient.getSession = (id) => id === "old" ? loadA.promise : Promise.resolve({ status: "ok", session: { id, workflow_name: "A", messages: [] } });
  try {
    const c = sessionFixture();
    const old = c._switchSession("old"); await c._switchSession("new");
    loadA.resolve({ status: "ok", session: { id: "old", workflow_name: "A", messages: [] } }); await old;
    assert.equal(c.currentSessionId, "new");
  } finally { ApiClient.getSession = original; }
});

// Minimal DOM shapes let us exercise real sendMessage ownership and finally cleanup.
const element = () => ({ style: {}, classList: { add() {}, remove() {} }, appendChild() {},
  remove() { this.parentNode = null; }, removeAttribute() {}, querySelector() { return { textContent: "" }; }, parentNode: {} });
test("switching history during a stream aborts and discards late events/final answers", async () => {
  const oldDocument = globalThis.document, oldStream = ApiClient.streamChat, oldSave = ApiClient.saveSession, oldGet = ApiClient.getSession;
  globalThis.document = { createElement: element };
  const late = deferred(); let signal;
  ApiClient.streamChat = async (options) => { signal = options.signal; await late.promise; options.onEvent({ type: "content", text: "A answer" }); };
  ApiClient.saveSession = async (data) => ({ status: "ok", session: data });
  ApiClient.getSession = async () => ({ status: "ok", session: { id: "B-id", workflow_name: "A", messages: [{ role: "user", content: "B question" }] } });
  try {
    const c = sessionFixture();
    Object.assign(c, { ready: Promise.resolve(), attachedImages: [], config: { providers: [{ id: "p" }] },
      panel: { querySelector: (sel) => sel === "#cm-input" ? { value: "A question", style: {} } : { value: "p::m" } },
      extractor: { captureContext: () => ({}), clearError() {} }, _appendMessage: element,
      _renderAttachedImages() {}, _isProviderConfigured: () => true, _getEffectiveLang: () => "en", _scrollToBottom() {} });
    const sending = c.sendMessage(); await tick();
    await c._switchSession("B-id"); assert(signal.aborted);
    late.resolve(); await sending;
    assert.equal(c.currentSessionId, "B-id");
    assert.deepEqual(c.messages, [{ role: "user", content: "B question" }]);
  } finally { globalThis.document = oldDocument; ApiClient.streamChat = oldStream; ApiClient.saveSession = oldSave; ApiClient.getSession = oldGet; }
});

test("testConnection passes both an explicit proxy and an explicitly empty proxy", async () => {
  const original = globalThis.fetch;
  const bodies = [];
  globalThis.fetch = async (_, options) => { bodies.push(JSON.parse(options.body)); return { status: 200, json: async () => ({ status: "ok" }) }; };
  try {
    await ApiClient.testConnection({ proxy: "http://127.0.0.1:7890" });
    await ApiClient.testConnection({ proxy: "" });
    assert.equal(bodies[0].proxy, "http://127.0.0.1:7890"); assert.equal(bodies[1].proxy, "");
  } finally { globalThis.fetch = original; }
});

test("concurrent workflow exports cannot bind a foreign submission to a native test", async () => {
  const api = new MockApi(), auth = deferred();
  const app = { api, graphToPrompt: async (name = "own") => ({ name }), async queuePrompt() {
    this.processingQueue = true;
    try {
      await auth.promise;
      const own = await this.graphToPrompt();
      await api.queuePrompt(0, own);
      return true;
    } finally { this.processingQueue = false; }
  } };
  const originalSubmit = api.queuePrompt = async (_, prompt) => ({ prompt_id: prompt.name });
  const originalExport = app.graphToPrompt;
  const runner = new QueueRunner(app); let completed = false;
  const run = runner.run({ onComplete: () => { completed = true; } });
  const foreign = await app.graphToPrompt("foreign");
  await api.queuePrompt(0, foreign);
  api.emit("execution_start", { prompt_id: "foreign" });
  api.emit("execution_success", { prompt_id: "foreign" });
  auth.resolve();
  assert.equal((await run).success, false);
  assert.equal(completed, false);
  assert.equal(runner.activePromptId, null);
  assert.equal(runner.getStatus(), "error");
  assert.equal(api.queuePrompt, originalSubmit); assert.equal(app.graphToPrompt, originalExport);
});

test("normal chat persists the answer; an older aborted request cannot reset a newer stream", async () => {
  const oldDocument = globalThis.document, oldStream = ApiClient.streamChat, oldSave = ApiClient.saveSession;
  globalThis.document = { createElement: element };
  const first = deferred(), second = deferred(); let call = 0;
  const saves = [];
  ApiClient.saveSession = async (data) => { saves.push(data); return { status: "ok", session: data }; };
  ApiClient.streamChat = async (options) => {
    const index = ++call;
    await (index === 1 ? first : second).promise;
    options.onEvent({ type: "content", text: "new answer" });
  };
  try {
    const c = sessionFixture();
    Object.assign(c, { ready: Promise.resolve(), attachedImages: [], config: { providers: [{ id: "p" }] },
      panel: { querySelector: (sel) => sel === "#cm-input" ? { value: "question", style: {} } : { value: "p::m" } },
      extractor: { captureContext: () => ({}), clearError() {} }, _appendMessage: element,
      _setStreamingState(value) { this.isStreaming = value; }, _renderAttachedImages() {},
      _isProviderConfigured: () => true, _getEffectiveLang: () => "en", _scrollToBottom() {} });
    const old = c.sendMessage(); await tick(); c.stopGeneration();
    const current = c.sendMessage(); await tick(); const controller = c.abortController;
    first.reject(Object.assign(new Error("stopped"), { name: "AbortError" })); await old;
    assert.equal(c.isStreaming, true); assert.equal(c.abortController, controller);
    second.resolve(); await current; await tick();
    assert.equal(c.isStreaming, false);
    assert.equal(c.messages.at(-1).content, "new answer");
    assert.equal(saves.at(-1).messages.at(-1).content, "new answer");
    assert(saves.every((save) => save.id === c.currentSessionId));
  } finally { globalThis.document = oldDocument; ApiClient.streamChat = oldStream; ApiClient.saveSession = oldSave; }
});
