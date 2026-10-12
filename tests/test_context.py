import os
import sys

# Ensure repository root is in python path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from py.config import load_config
from py.context import prepare_messages, format_context_block


def test_context_formatting():
    mock_context = {
        "selected_nodes": [
            {
                "id": 3,
                "type": "KSampler",
                "title": "KSampler",
                "widgets_values": {"seed": 42, "steps": 20, "cfg": 8.0, "sampler_name": "euler"},
                "inputs": {"model": "Linked(link_id: 1, type: MODEL)"},
            }
        ],
        "workflow_summary": {
            "total_nodes": 4,
            "nodes_desc": [
                'Node #4 [CheckpointLoaderSimple] (ckpt_name="v1-5-pruned.safetensors")',
                'Node #3 [KSampler] inputs: [model<-#4]',
                'Node #8 [VAEDecode] inputs: [samples<-#3, vae<-#4]',
                'Node #9 [SaveImage] inputs: [images<-#8]',
            ],
        },
        "error_info": {
            "node_id": 3,
            "node_type": "KSampler",
            "exception_type": "RuntimeError",
            "message": "Sizes of tensors must match except in dimension 0",
            "traceback": "Traceback (most recent call last):\n  File 'nodes.py', line 123 in sample\nRuntimeError",
        },
    }

    formatted = format_context_block(mock_context)
    assert "Node #3 [KSampler]" in formatted
    assert "Sizes of tensors must match" in formatted
    assert "Total Nodes: 4" in formatted
    assert "Official Node Specifications" in formatted
    assert "KSampler" in formatted

    messages = [{"role": "user", "content": "为什么报错了？"}]
    final_msgs = prepare_messages(messages, context=mock_context)
    assert len(final_msgs) == 2
    assert final_msgs[0]["role"] == "system"
    assert "ComfyMate" in final_msgs[0]["content"]
    assert "为什么报错了？" in final_msgs[1]["content"]
    assert "Sizes of tensors must match" in final_msgs[1]["content"]

    print("✅ Context formatting test passed!")


def test_config():
    cfg = load_config()
    assert "providers" in cfg
    assert "active_provider_id" in cfg
    print("✅ Config test passed!")


def test_system_prompt_actions():
    from py.context import build_system_prompt
    prompt = build_system_prompt()
    assert "comfymate-action" in prompt
    assert "set_parameters" in prompt
    assert "recommend_nodes" in prompt
    assert "connect_nodes" in prompt
    assert "Node #<ID>" in prompt
    print("✅ System prompt action instructions test passed!")


def test_node_knowledge():
    from py.node_knowledge import get_node_info, search_nodes, get_all_registered_nodes
    
    # Check all registered nodes returns at least baseline
    all_nodes = get_all_registered_nodes()
    assert len(all_nodes) >= 10
    assert "KSampler" in all_nodes
    assert "CheckpointLoaderSimple" in all_nodes

    # Check get_node_info
    ksampler = get_node_info("KSampler")
    assert ksampler is not None
    assert ksampler["class_name"] == "KSampler"
    assert "inputs" in ksampler
    assert "steps" in ksampler["inputs"]
    assert ksampler["inputs"]["steps"]["type"] == "INT"

    # Check search_nodes
    search_res = search_nodes("lora")
    assert any(n["class_name"] == "LoraLoader" for n in search_res)

    print("✅ Node knowledge test passed!")


if __name__ == "__main__":
    test_context_formatting()
    test_config()
    test_system_prompt_actions()
    test_node_knowledge()
