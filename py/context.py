from typing import Any, Dict, List, Optional

try:
    from .node_knowledge import get_node_info, format_node_spec_markdown
except ImportError:
    from py.node_knowledge import get_node_info, format_node_spec_markdown

SYSTEM_PROMPT = """You are ComfyMate, an expert AI assistant embedded directly inside ComfyUI.
Your mission is to help the user understand, troubleshoot, inspect, and optimize their ComfyUI workflow.

Guidelines:
1. Always ground your analysis in the provided "Workflow Context", "Selected Node(s)", and "Runtime Error" if available.
2. Refer to nodes specifically by their Type and ID using the format `Node #<ID> [<Type>]` or `[<Type>] (#<ID>)` (e.g. `Node #3 [KSampler]` or `KSampler (#3)`). The UI renders these as interactive tags so users can click to zoom, center, and highlight nodes on their canvas.
3. If the user asks why nodes are connected or how data flows, explain the upstream/downstream dependencies clearly (e.g. Model, VAE, CLIP, Latent).
4. If there is a runtime error or execution failure, trace the offending node and diagnose root causes such as missing model files, tensor dimension mismatches, missing inputs, or invalid parameters.
5. Interactive Canvas Action Blocks:
   When recommending concrete parameter adjustments for a node (such as steps, cfg, denoise, sampler_name, scheduler, seed, etc.), include an executable action block:
   ```comfymate-action
   {
     "action": "set_parameters",
     "node_id": 3,
     "parameters": {
       "steps": 25,
       "cfg": 7.0
     },
     "reason": "优化出图细节并防止画面过饱和"
   }
   ```
   The UI will automatically render this as an interactive card allowing the user to click "Apply to Canvas" to write values directly into the LiteGraph node widgets!
6. Interactive Node Recommendation Action Blocks:
   When recommending nodes that the user should add to their workflow (e.g. adding LoRA, ControlNet, Upscaler, Face Detailer, etc.), include an executable action block:
   ```comfymate-action
   {
     "action": "recommend_nodes",
     "nodes": [
       {
         "type": "ControlNetApplyAdvanced",
         "title": "Apply ControlNet (Advanced)",
         "reason": "用于将姿态骨骼或深度引导图应用到当前采样流程"
       }
     ]
   }
   ```
   The UI will render this as an interactive card with a 1-click "➕ Add to Canvas" button that automatically places and focuses the node on the user's canvas!
7. Interactive Node Connection Action Blocks:
   When recommending that the user connect output ports from one node to input ports of another node (or when completing a pipeline like VAE -> SaveImage, or Model/CLIP/VAE -> KSampler), include an executable action block:
   ```comfymate-action
   {
     "action": "connect_nodes",
     "connections": [
       {
         "from_node": 4,
         "from_slot": "IMAGE",
         "to_node": 5,
         "to_slot": "images",
         "reason": "将 VAE 解码输出的图像连接至保存图像节点"
       }
     ]
   }
   ```
   Or for a single connection:
   ```comfymate-action
   {
     "action": "connect_nodes",
     "from_node": 4,
     "from_slot": "IMAGE",
     "to_node": 5,
     "to_slot": "images",
     "reason": "连接图像输出至保存节点"
   }
   ```
   The UI will automatically render this as an interactive connection card allowing the user to click "🔗 Connect Nodes" to automatically link the ports on the canvas with 1 click, complete with undo support!
8. Interactive Canvas Auto Layout Action Blocks:
   When diagnosing an untidy, overlapping, or disorganized workflow, or when the user asks to clean up/organize/layout their canvas nodes, include an executable action block:
   ```comfymate-action
   {
     "action": "auto_layout",
     "reason": "按拓扑层级（模型加载 -> 条件引导 -> 采样器 -> 解码保存）自动重排节点，消除重叠与杂乱交错连线",
     "scope": "all"
   }
   ```
   The UI will render this as an interactive layout card allowing the user to click "📐 Auto Layout / 整理画布" to smoothly rearrange the nodes with 1 click, complete with animated transition and full undo support!
9. Interactive Test Generation (Closed-loop Queue Prompt) Action Blocks:
   When parameter adjustments or connections have been applied, or when the user asks to test run/generate the workflow to verify image quality, include an executable action block:
   ```comfymate-action
   {
     "action": "queue_prompt",
     "reason": "已调整采样步数与去噪强度，建议立即测试出图验证生成质量",
     "eval_prompt": "请评估画面细节清晰度、构图与提示词还原度"
   }
   ```
   The UI will render this as an interactive queue card allowing the user to click "🚀 Run Test Now / 立即测试出图" to trigger prompt execution with real-time progress, automatically capturing the output image for 1-click Multimodal Vision Evaluation!
10. Provide actionable, concise, and structured answers (using Markdown, bullet points, and code blocks where helpful).
11. Be conversational, helpful, and technically accurate with modern ComfyUI best practices.
"""


def build_system_prompt(custom_instruction: Optional[str] = None, language: str = "auto") -> str:
    """Build the system prompt with optional user custom instructions and language preference."""
    prompt = SYSTEM_PROMPT
    if language == "zh":
        prompt += "\n\nLanguage Preference: Please respond primarily in Simplified Chinese (简体中文)."
    elif language == "en":
        prompt += "\n\nLanguage Preference: Please respond primarily in English."
    elif language == "auto":
        prompt += "\n\nLanguage Preference: Please respond in the user's inquiry language (default to Simplified Chinese)."

    if custom_instruction and custom_instruction.strip():
        prompt += f"\n\nAdditional User Instructions:\n{custom_instruction.strip()}"
    return prompt


def format_context_block(context: Optional[Dict[str, Any]]) -> str:
    """Format workflow context, selected nodes, and error traces into a compact Markdown context block."""
    if not context:
        return ""

    parts = []

    # 0. Active Workflow Canvas Name
    workflow_name = context.get("workflow_name")
    if workflow_name:
        parts.append(f"### 🎨 Active Canvas Workflow: `{workflow_name}`")

    # 1. Error Information
    error_info = context.get("error_info")
    error_node_type = None
    if error_info:
        parts.append("### 🚨 Runtime Error Detected")
        node_id = error_info.get("node_id", "Unknown")
        node_type = error_info.get("node_type", "Unknown")
        error_node_type = node_type
        exception_type = error_info.get("exception_type", "Error")
        message = error_info.get("message", "")
        traceback_str = error_info.get("traceback", "")

        parts.append(f"- **Failed Node**: {node_type} (ID: #{node_id})")
        parts.append(f"- **Exception**: `{exception_type}`: {message}")
        if traceback_str:
            parts.append(f"```text\n{traceback_str.strip()}\n```")

    # 2. Selected Nodes Focus & Specifications
    selected_nodes = context.get("selected_nodes", [])
    relevant_specs = []
    seen_spec_types = set()

    if selected_nodes:
        parts.append("### 🎯 Currently Selected Node(s) Focus")
        for node in selected_nodes:
            nid = node.get("id")
            ntype = node.get("type")
            title = node.get("title", ntype)
            mode = node.get("mode", "Active")
            values = node.get("widgets_values", {})
            inputs = node.get("inputs", {})
            outputs = node.get("outputs", {})
            status = f" [Status: {mode}]" if mode != "Active" else ""
            parts.append(f"- **Node #{nid} [{title}]** (Type: `{ntype}`{status}):")
            if values:
                parts.append(f"  - Parameters/Widgets: `{values}`")
            if inputs:
                parts.append(f"  - Upstream Inputs: `{inputs}`")
            if outputs:
                parts.append(f"  - Downstream Outputs: `{outputs}`")

            if ntype and ntype not in seen_spec_types:
                spec = get_node_info(ntype)
                if spec:
                    relevant_specs.append(format_node_spec_markdown(spec))
                    seen_spec_types.add(ntype)

    # Include spec for crashing node if known and not already added
    if error_node_type and error_node_type not in seen_spec_types:
        spec = get_node_info(error_node_type)
        if spec:
            relevant_specs.append(format_node_spec_markdown(spec))
            seen_spec_types.add(error_node_type)

    if relevant_specs:
        parts.append("### 📚 Official Node Specifications (Ground Truth)")
        parts.extend(relevant_specs)

    # 3. Overall Workflow Summary
    workflow_summary = context.get("workflow_summary")
    if workflow_summary:
        parts.append("### 🗺️ Current Workflow Topology Summary")
        if isinstance(workflow_summary, str):
            parts.append(workflow_summary.strip())
        elif isinstance(workflow_summary, dict):
            total_nodes = workflow_summary.get("total_nodes", 0)
            nodes_desc = workflow_summary.get("nodes_desc", [])
            parts.append(f"Total Nodes: {total_nodes}")
            for desc in nodes_desc:
                parts.append(f"- {desc}")

    if not parts:
        return ""

    return "\n\n---\n## 📋 ComfyUI Context\n" + "\n".join(parts) + "\n---\n"


def prepare_messages(
    messages: List[Dict[str, str]],
    context: Optional[Dict[str, Any]] = None,
    custom_instruction: Optional[str] = None,
    language: str = "auto",
) -> List[Dict[str, str]]:
    """Assemble final message list to send to the LLM."""
    system_content = build_system_prompt(custom_instruction, language=language)
    context_str = format_context_block(context)

    final_messages = [{"role": "system", "content": system_content}]

    # Prepend context to the latest user message or inject as dedicated context message
    if context_str:
        # Find the last user message and append the context block to it
        user_msg_idx = -1
        for i in range(len(messages) - 1, -1, -1):
            if messages[i].get("role") == "user":
                user_msg_idx = i
                break

        if user_msg_idx != -1:
            augmented_messages = [dict(m) for m in messages]
            augmented_messages[user_msg_idx]["content"] = (
                f"{augmented_messages[user_msg_idx]['content']}\n\n{context_str}"
            )
            final_messages.extend(augmented_messages)
        else:
            final_messages.extend(messages)
    else:
        final_messages.extend(messages)

    return final_messages
