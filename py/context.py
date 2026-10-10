from typing import Any, Dict, List, Optional

SYSTEM_PROMPT = """You are ComfyMate, an expert AI assistant embedded directly inside ComfyUI.
Your mission is to help the user understand, troubleshoot, inspect, and optimize their ComfyUI workflow.

Guidelines:
1. Always ground your analysis in the provided "Workflow Context", "Selected Node(s)", and "Runtime Error" if available.
2. Refer to nodes specifically by their Type and ID (e.g. `KSampler (#3)` or `EmptyLatentImage (#5)`).
3. If the user asks why nodes are connected or how data flows, explain the upstream/downstream dependencies clearly (e.g. Model, VAE, CLIP, Latent).
4. If there is a runtime error or execution failure, trace the offending node and diagnose root causes such as missing model files, tensor dimension mismatches, missing inputs, or invalid parameters.
5. Provide actionable, concise, and structured answers (using Markdown, bullet points, and code blocks where helpful).
6. Be conversational, helpful, and technically accurate with modern ComfyUI best practices.
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

    # 1. Error Information
    error_info = context.get("error_info")
    if error_info:
        parts.append("### 🚨 Runtime Error Detected")
        node_id = error_info.get("node_id", "Unknown")
        node_type = error_info.get("node_type", "Unknown")
        exception_type = error_info.get("exception_type", "Error")
        message = error_info.get("message", "")
        traceback_str = error_info.get("traceback", "")

        parts.append(f"- **Failed Node**: {node_type} (ID: #{node_id})")
        parts.append(f"- **Exception**: `{exception_type}`: {message}")
        if traceback_str:
            parts.append(f"```text\n{traceback_str.strip()}\n```")

    # 2. Selected Nodes Focus
    selected_nodes = context.get("selected_nodes", [])
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
