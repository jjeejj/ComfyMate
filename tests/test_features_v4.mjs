/**
 * Automated Test Suite for ComfyMate v0.4.0 Capabilities:
 * 1. 🔗 Smart Node Connection & Disconnect Undo (connect_nodes)
 * 2. 📐 Topological Auto-Layout & Coordinate Undo (auto_layout)
 * 3. 🚀 Closed-loop Queue Prompt & Vision Eval Harness (queue_prompt)
 * 4. 📝 Action Card Markdown Rendering
 * 5. 🌐 Bilingual i18n Key Parity
 */

import { CanvasActionManager } from "../web/src/canvas/actions.js";
import { QueueRunner } from "../web/src/services/queue_runner.js";
import { renderMarkdown } from "../web/src/components/markdown/markdown.js";
import { zh } from "../web/src/i18n/zh.js";
import { en } from "../web/src/i18n/en.js";

// Helper assertions
function assert(condition, message) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

console.log("==================================================");
console.log("🧪 Running ComfyMate v0.4.0 Feature Test Suite");
console.log("==================================================");

// ----------------------------------------------------
// 1. Test: connect_nodes & disconnectNodes
// ----------------------------------------------------
function testConnectNodes() {
  console.log("\n[Test 1] 🔗 Smart Node Connection & Undo...");

  let connectCalled = false;
  let disconnectCalled = false;
  const links = {};

  const node1 = {
    id: 1,
    type: "LoadImage",
    pos: [100, 100],
    inputs: [],
    outputs: [{ name: "IMAGE", type: "IMAGE", links: [] }],
    connect(outSlot, targetNode, inSlot) {
      connectCalled = true;
      this.outputs[outSlot].links.push(999);
      targetNode.inputs[inSlot].link = 999;
      links[999] = { id: 999, origin_id: this.id, origin_slot: outSlot, target_id: targetNode.id, target_slot: inSlot };
      return links[999];
    },
    disconnectInput(slot) {
      disconnectCalled = true;
      this.inputs[slot].link = null;
    },
  };

  const node2 = {
    id: 2,
    type: "PreviewImage",
    pos: [400, 100],
    inputs: [{ name: "images", type: "IMAGE", link: null }],
    outputs: [],
    disconnectInput(slot) {
      disconnectCalled = true;
      this.inputs[slot].link = null;
    },
  };

  const nodeMap = new Map([[1, node1], [2, node2]]);
  const mockApp = {
    graph: {
      getNodeById: (id) => nodeMap.get(id),
      links,
      setDirtyCanvas: () => {},
    },
    canvas: {
      setDirty: () => {},
    },
  };

  const mgr = new CanvasActionManager(mockApp);

  // Apply connection
  const res = mgr.connectNodes([
    { from_node: 1, from_slot: "IMAGE", to_node: 2, to_slot: "images" },
  ]);

  assert(res.success === true, "connectNodes returned success");
  assert(connectCalled === true, "LiteGraph connect() was called");
  assert(res.links && res.links.length === 1, "Connection links recorded");

  // Undo connection
  const undoRes = mgr.disconnectNodes(res.links);
  assert(undoRes.success === true, "disconnectNodes returned success");
  assert(disconnectCalled === true, "LiteGraph disconnectInput() was called");

  console.log("  ✅ Node connection and undo disconnect verified successfully!");
}

// ----------------------------------------------------
// 2. Test: autoLayout & undoLayout
// ----------------------------------------------------
function testAutoLayout() {
  console.log("\n[Test 2] 📐 Topological Auto-Layout & Position Undo...");

  const nodes = [
    { id: 1, type: "CheckpointLoaderSimple", pos: [800, 500], size: [200, 100], inputs: [], outputs: [{ links: [10] }] },
    { id: 2, type: "CLIPTextEncode", pos: [900, 700], size: [200, 100], inputs: [], outputs: [{ links: [11] }] },
    { id: 3, type: "KSampler", pos: [200, 300], size: [240, 160], inputs: [{ link: 10 }, { link: 11 }], outputs: [{ links: [12] }] },
    { id: 4, type: "VAEDecode", pos: [100, 200], size: [180, 80], inputs: [{ link: 12 }], outputs: [{ links: [13, 14] }] },
    { id: 5, type: "SaveImage", pos: [50, 100], size: [220, 120], inputs: [{ link: 13 }], outputs: [] },
    { id: 6, type: "PreviewImage", pos: [50, 400], size: [220, 120], inputs: [{ link: 14 }], outputs: [] },
  ];

  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const linkMap = new Map([
    [10, { id: 10, origin_id: 1, target_id: 3 }],
    [11, { id: 11, origin_id: 2, target_id: 3 }],
    [12, { id: 12, origin_id: 3, target_id: 4 }],
    [13, { id: 13, origin_id: 4, target_id: 5 }],
    [14, { id: 14, origin_id: 4, target_id: 6 }],
  ]);

  const mockApp = {
    graph: {
      _nodes: nodes,
      getNodeById: (id) => nodeMap.get(id),
      links: linkMap,
      setDirtyCanvas: () => {},
    },
    canvas: {
      selected_nodes: {},
      setDirty: () => {},
    },
  };

  const mgr = new CanvasActionManager(mockApp);
  const res = mgr.autoLayout({ animate: false });

  assert(res.success === true, "autoLayout succeeded");
  assert(res.nodeCount === 6, "processed 6 nodes");

  const n1 = nodeMap.get(1);
  const n2 = nodeMap.get(2);
  const n3 = nodeMap.get(3);
  const n4 = nodeMap.get(4);
  const n5 = nodeMap.get(5);
  const n6 = nodeMap.get(6);

  // Layer 0: Loaders (leftmost)
  // Layer 1: KSampler (middle)
  // Layer 2: VAEDecode
  // Layer 3: Output images (rightmost)
  assert(n1.pos[0] === n2.pos[0], "Layer 0 nodes aligned on X axis");
  assert(n1.pos[0] < n3.pos[0], "Loaders are to the left of KSampler");
  assert(n3.pos[0] < n4.pos[0], "KSampler is to the left of VAE Decode");
  assert(n4.pos[0] < n5.pos[0], "VAE Decode is to the left of SaveImage");
  assert(n5.pos[0] === n6.pos[0], "SaveImage & PreviewImage in final layer");

  // Test Undo Layout
  const undoRes = mgr.undoLayout(res.oldPositions, false);
  assert(undoRes.success === true, "undoLayout succeeded");
  assert(n1.pos[0] === 800 && n1.pos[1] === 500, "Node 1 original position restored");
  assert(n5.pos[0] === 50 && n5.pos[1] === 100, "Node 5 original position restored");

  console.log("  ✅ Topological layering, barycenter ordering, and undo verified!");
}

// ----------------------------------------------------
// 3. Test: QueueRunner Execution & Capture
// ----------------------------------------------------
async function testQueueRunner() {
  console.log("\n[Test 3] 🚀 Closed-loop QueueRunner & Multimodal Capture...");

  class MockApi {
    constructor() {
      this.handlers = {};
    }
    addEventListener(name, fn) {
      if (!this.handlers[name]) this.handlers[name] = [];
      this.handlers[name].push(fn);
    }
    removeEventListener(name, fn) {
      if (this.handlers[name]) {
        this.handlers[name] = this.handlers[name].filter((h) => h !== fn);
      }
    }
    emit(name, detail) {
      (this.handlers[name] || []).forEach((fn) => fn({ detail }));
    }
    apiURL(path) {
      return "http://127.0.0.1:8188" + path;
    }
  }

  const mockApi = new MockApi();
  let promptQueued = false;

  const mockApp = {
    api: mockApi,
    graph: {
      getNodeById: (id) => ({ id, title: `Node #${id}` }),
    },
    queuePrompt: async () => {
      promptQueued = true;
      return { prompt_id: "pid-12345" };
    },
  };

  const runner = new QueueRunner(mockApp);
  assert(runner.isSupported() === true, "QueueRunner recognizes support");

  let progressTracked = [];
  let completePayload = null;

  const runPromise = runner.run({
    onProgress: (p) => progressTracked.push(p),
    onComplete: (res) => { completePayload = res; },
  });

  assert(runner.getStatus() === "queuing", "Status is queuing upon submit");

  await runPromise;

  // Simulate WebSocket events from ComfyUI
  mockApi.emit("execution_start", { prompt_id: "pid-12345" });
  mockApi.emit("progress", { value: 14, max: 28, node: 3, prompt_id: "pid-12345" });
  assert(runner.getStatus() === "executing", "Status is executing after progress");

  mockApi.emit("executed", {
    node: 9,
    prompt_id: "pid-12345",
    output: {
      images: [{ filename: "comfymate_sample.png", subfolder: "test", type: "output" }],
    },
  });

  // End of execution
  mockApi.emit("executing", { node: null, prompt_id: "pid-12345" });

  await runPromise;

  assert(runner.getStatus() === "completed", "Status marked as completed");
  assert(promptQueued === true, "app.queuePrompt() was called");
  assert(progressTracked.length === 1 && progressTracked[0].percent === 50, "Progress 50% captured");
  assert(completePayload && completePayload.images.length === 1, "Image output captured");
  assert(completePayload.images[0].url.includes("comfymate_sample.png"), "Image URL generated");

  // Error simulation
  let interceptedError = null;
  await runner.run({
    onError: (err) => { interceptedError = err; },
  });
  mockApi.emit("execution_error", {
    prompt_id: "pid-12345",
    node_id: 3,
    node_type: "KSampler",
    exception_message: "CUDA out of memory",
    traceback: ["Traceback..."],
  });
  assert(runner.getStatus() === "error", "Status is error after failure");
  assert(interceptedError && interceptedError.exception_message === "CUDA out of memory", "Error intercepted");

  console.log("  ✅ QueueRunner lifecycle, output image collection, and error handling verified!");
}

// ----------------------------------------------------
// 4. Test: Markdown Action Card Rendering
// ----------------------------------------------------
function testMarkdownRendering() {
  console.log("\n[Test 4] 📝 Action Card Markdown Rendering...");

  const content = `
\`\`\`comfymate-action
{
  "action": "connect_nodes",
  "reason": "对接 VAE 解码",
  "connections": [
    { "from_node": 3, "from_slot": "LATENT", "to_node": 8, "to_slot": "samples" }
  ]
}
\`\`\`

\`\`\`comfymate-action
{
  "action": "auto_layout",
  "reason": "拓扑分层规整",
  "scope": "all"
}
\`\`\`

\`\`\`comfymate-action
{
  "action": "queue_prompt",
  "reason": "测试出图验证",
  "eval_prompt": "评估画质与构图"
}
\`\`\`
`;

  const html = renderMarkdown(content, zh);

  assert(html.includes("cm-connect-nodes-card"), "connect_nodes card rendered");
  assert(html.includes("cm-action-btn-connect"), "connect button rendered");

  assert(html.includes("cm-layout-card"), "auto_layout card rendered");
  assert(html.includes("cm-action-btn-layout"), "auto layout button rendered");

  assert(html.includes("cm-queue-card"), "queue_prompt card rendered");
  assert(html.includes("cm-action-btn-queue"), "queue button rendered");
  assert(html.includes("data-eval-prompt"), "eval prompt attribute attached");

  console.log("  ✅ All 3 action cards correctly parsed and rendered in HTML!");
}

// ----------------------------------------------------
// 5. Test: i18n Bilingual Parity
// ----------------------------------------------------
function testI18nParity() {
  console.log("\n[Test 5] 🌐 Bilingual i18n Key Parity...");

  const zhKeys = Object.keys(zh);
  const enKeys = Object.keys(en);

  const missingInEn = zhKeys.filter((k) => !enKeys.includes(k));
  const missingInZh = enKeys.filter((k) => !zhKeys.includes(k));

  assert(missingInEn.length === 0, `Keys missing in en: ${missingInEn.join(", ")}`);
  assert(missingInZh.length === 0, `Keys missing in zh: ${missingInZh.join(", ")}`);
  assert(zhKeys.length === 239, `Total keys match expected count (got ${zhKeys.length})`);

  console.log(`  ✅ 100% parity across all ${zhKeys.length} keys in zh.js and en.js!`);
}

// Run all tests
async function runAll() {
  try {
    testConnectNodes();
    testAutoLayout();
    await testQueueRunner();
    testMarkdownRendering();
    testI18nParity();
    console.log("\n==================================================");
    console.log("🎉 ALL v0.4.0 FEATURE TESTS PASSED (5/5)!");
    console.log("==================================================\n");
  } catch (err) {
    console.error("\n❌ Test suite failed:", err);
    process.exit(1);
  }
}

runAll();
