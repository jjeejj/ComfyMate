"""Node Knowledge Base for ComfyMate.

Provides node definition extraction, parameter specification,
search, and recommendation capabilities by introspecting ComfyUI's
`nodes.NODE_CLASS_MAPPINGS` at runtime, with an offline built-in fallback.
"""

import logging
import re
from typing import Any, Dict, List, Optional

logger = logging.getLogger("ComfyMate")

# Common built-in core ComfyUI node specifications (offline fallback & baseline)
BUILTIN_CORE_NODES: Dict[str, Dict[str, Any]] = {
    "KSampler": {
        "class_name": "KSampler",
        "display_name": "KSampler",
        "category": "sampling",
        "description": "Main latent diffusion sampling node. Applies noise reduction steps using the selected model, sampler, and scheduler.",
        "inputs": {
            "model": {"type": "MODEL", "required": True},
            "positive": {"type": "CONDITIONING", "required": True},
            "negative": {"type": "CONDITIONING", "required": True},
            "latent_image": {"type": "LATENT", "required": True},
            "seed": {"type": "INT", "required": True, "default": 0, "min": 0, "max": 18446744073709551615},
            "steps": {"type": "INT", "required": True, "default": 20, "min": 1, "max": 10000},
            "cfg": {"type": "FLOAT", "required": True, "default": 8.0, "min": 0.0, "max": 100.0, "step": 0.1},
            "sampler_name": {
                "type": "COMBO",
                "required": True,
                "choices": ["euler", "euler_ancestral", "heun", "heunpp2", "dpm_2", "dpm_2_ancestral", "lms", "dpm_fast", "dpm_adaptive", "dpmpp_2s_ancestral", "dpmpp_sde", "dpmpp_sde_gpu", "dpmpp_2m", "dpmpp_2m_sde", "dpmpp_2m_sde_gpu", "dpmpp_3m_sde", "dpmpp_3m_sde_gpu", "ddpm", "lcm", "ddim", "uni_pc"],
            },
            "scheduler": {
                "type": "COMBO",
                "required": True,
                "choices": ["normal", "karras", "exponential", "sgm_uniform", "simple", "ddim_uniform", "beta"],
            },
            "denoise": {"type": "FLOAT", "required": True, "default": 1.0, "min": 0.0, "max": 1.0, "step": 0.01},
        },
        "outputs": [{"type": "LATENT", "name": "LATENT"}],
    },
    "CheckpointLoaderSimple": {
        "class_name": "CheckpointLoaderSimple",
        "display_name": "Load Checkpoint",
        "category": "loaders",
        "description": "Loads a standard diffusion checkpoint model (Safetensors / Ckpt) containing MODEL, CLIP, and VAE.",
        "inputs": {
            "ckpt_name": {"type": "COMBO", "required": True, "description": "Name of the checkpoint file in models/checkpoints"},
        },
        "outputs": [
            {"type": "MODEL", "name": "MODEL"},
            {"type": "CLIP", "name": "CLIP"},
            {"type": "VAE", "name": "VAE"},
        ],
    },
    "CLIPTextEncode": {
        "class_name": "CLIPTextEncode",
        "display_name": "CLIP Text Encode (Prompt)",
        "category": "conditioning",
        "description": "Encodes a natural language text prompt into conditioning latent vectors using the CLIP model.",
        "inputs": {
            "clip": {"type": "CLIP", "required": True},
            "text": {"type": "STRING", "required": True, "multiline": True, "default": ""},
        },
        "outputs": [{"type": "CONDITIONING", "name": "CONDITIONING"}],
    },
    "VAEDecode": {
        "class_name": "VAEDecode",
        "display_name": "VAE Decode",
        "category": "latent",
        "description": "Decodes compressed latent image representations into pixel-space RGB images using the VAE model.",
        "inputs": {
            "samples": {"type": "LATENT", "required": True},
            "vae": {"type": "VAE", "required": True},
        },
        "outputs": [{"type": "IMAGE", "name": "IMAGE"}],
    },
    "VAEEncode": {
        "class_name": "VAEEncode",
        "display_name": "VAE Encode",
        "category": "latent",
        "description": "Encodes a pixel-space RGB image into compressed latent space for img2img workflows.",
        "inputs": {
            "pixels": {"type": "IMAGE", "required": True},
            "vae": {"type": "VAE", "required": True},
        },
        "outputs": [{"type": "LATENT", "name": "LATENT"}],
    },
    "EmptyLatentImage": {
        "class_name": "EmptyLatentImage",
        "display_name": "Empty Latent Image",
        "category": "latent",
        "description": "Generates a blank empty latent tensor with specified width, height, and batch size.",
        "inputs": {
            "width": {"type": "INT", "required": True, "default": 512, "min": 64, "max": 8192, "step": 8},
            "height": {"type": "INT", "required": True, "default": 512, "min": 64, "max": 8192, "step": 8},
            "batch_size": {"type": "INT", "required": True, "default": 1, "min": 1, "max": 64},
        },
        "outputs": [{"type": "LATENT", "name": "LATENT"}],
    },
    "SaveImage": {
        "class_name": "SaveImage",
        "display_name": "Save Image",
        "category": "image",
        "description": "Saves generated images to the output directory with metadata and workflow pnginfo.",
        "inputs": {
            "images": {"type": "IMAGE", "required": True},
            "filename_prefix": {"type": "STRING", "required": True, "default": "ComfyUI"},
        },
        "outputs": [],
    },
    "LoraLoader": {
        "class_name": "LoraLoader",
        "display_name": "Load LoRA",
        "category": "loaders",
        "description": "Loads a LoRA (Low-Rank Adaptation) network and patches both the MODEL and CLIP conditioning.",
        "inputs": {
            "model": {"type": "MODEL", "required": True},
            "clip": {"type": "CLIP", "required": True},
            "lora_name": {"type": "COMBO", "required": True},
            "strength_model": {"type": "FLOAT", "required": True, "default": 1.0, "min": -100.0, "max": 100.0, "step": 0.01},
            "strength_clip": {"type": "FLOAT", "required": True, "default": 1.0, "min": -100.0, "max": 100.0, "step": 0.01},
        },
        "outputs": [
            {"type": "MODEL", "name": "MODEL"},
            {"type": "CLIP", "name": "CLIP"},
        ],
    },
    "ControlNetLoader": {
        "class_name": "ControlNetLoader",
        "display_name": "Load ControlNet Model",
        "category": "loaders",
        "description": "Loads a ControlNet model weights file from models/controlnet.",
        "inputs": {
            "control_net_name": {"type": "COMBO", "required": True},
        },
        "outputs": [{"type": "CONTROL_NET", "name": "CONTROL_NET"}],
    },
    "ControlNetApplyAdvanced": {
        "class_name": "ControlNetApplyAdvanced",
        "display_name": "Apply ControlNet (Advanced)",
        "category": "conditioning/controlnet",
        "description": "Applies ControlNet structural guidance to conditioning with start/end percentage timing.",
        "inputs": {
            "positive": {"type": "CONDITIONING", "required": True},
            "negative": {"type": "CONDITIONING", "required": True},
            "control_net": {"type": "CONTROL_NET", "required": True},
            "image": {"type": "IMAGE", "required": True},
            "strength": {"type": "FLOAT", "required": True, "default": 1.0, "min": 0.0, "max": 10.0, "step": 0.01},
            "start_percent": {"type": "FLOAT", "required": True, "default": 0.0, "min": 0.0, "max": 1.0, "step": 0.001},
            "end_percent": {"type": "FLOAT", "required": True, "default": 1.0, "min": 0.0, "max": 1.0, "step": 0.001},
        },
        "outputs": [
            {"type": "CONDITIONING", "name": "positive"},
            {"type": "CONDITIONING", "name": "negative"},
        ],
    },
    "UpscaleModelLoader": {
        "class_name": "UpscaleModelLoader",
        "display_name": "Load Upscale Model",
        "category": "loaders",
        "description": "Loads an ESRGAN / RealESRGAN super-resolution upscale model from models/upscale_models.",
        "inputs": {
            "model_name": {"type": "COMBO", "required": True},
        },
        "outputs": [{"type": "UPSCALE_MODEL", "name": "UPSCALE_MODEL"}],
    },
    "ImageUpscaleWithModel": {
        "class_name": "ImageUpscaleWithModel",
        "display_name": "Upscale Image (using Model)",
        "category": "image/upscaling",
        "description": "Upscales an input image using an upscale super-resolution model.",
        "inputs": {
            "upscale_model": {"type": "UPSCALE_MODEL", "required": True},
            "image": {"type": "IMAGE", "required": True},
        },
        "outputs": [{"type": "IMAGE", "name": "IMAGE"}],
    },
}

_cached_runtime_nodes: Optional[Dict[str, Dict[str, Any]]] = None


def _parse_input_spec(spec: Any) -> Dict[str, Any]:
    """Parse ComfyUI INPUT_TYPES entry into a normalized dict."""
    if not isinstance(spec, (list, tuple)) or len(spec) == 0:
        return {"type": "UNKNOWN"}

    raw_type = spec[0]
    options = spec[1] if len(spec) > 1 and isinstance(spec[1], dict) else {}

    if isinstance(raw_type, list):
        return {
            "type": "COMBO",
            "choices": [str(c) for c in raw_type[:50]],  # cap choices length
            "default": raw_type[0] if raw_type else None,
            **options,
        }

    info: Dict[str, Any] = {"type": str(raw_type)}
    for k in ("default", "min", "max", "step", "multiline"):
        if k in options:
            info[k] = options[k]
    return info


def _introspect_single_node(
    class_name: str,
    node_cls: Any,
    display_name: Optional[str] = None,
) -> Optional[Dict[str, Any]]:
    """Introspect a single ComfyUI node class and extract its specifications."""
    try:
        category = getattr(node_cls, "CATEGORY", "custom")
        desc = getattr(node_cls, "DESCRIPTION", "") or (node_cls.__doc__ or "").strip()
        d_name = display_name or class_name

        # Introspect INPUT_TYPES
        inputs: Dict[str, Any] = {}
        if hasattr(node_cls, "INPUT_TYPES") and callable(node_cls.INPUT_TYPES):
            try:
                raw_inputs = node_cls.INPUT_TYPES()
                for in_cat in ("required", "optional"):
                    if in_cat in raw_inputs and isinstance(raw_inputs[in_cat], dict):
                        for in_name, in_spec in raw_inputs[in_cat].items():
                            parsed = _parse_input_spec(in_spec)
                            parsed["required"] = (in_cat == "required")
                            inputs[in_name] = parsed
            except Exception:
                pass

        # Introspect RETURN_TYPES
        return_types = getattr(node_cls, "RETURN_TYPES", ())
        return_names = getattr(node_cls, "RETURN_NAMES", None) or return_types
        outputs: List[Dict[str, str]] = []
        for i, r_type in enumerate(return_types):
            r_name = return_names[i] if i < len(return_names) else str(r_type)
            outputs.append({"type": str(r_type), "name": str(r_name)})

        return {
            "class_name": class_name,
            "display_name": d_name,
            "category": str(category),
            "description": str(desc),
            "inputs": inputs,
            "outputs": outputs,
        }
    except Exception:
        return None


def clear_node_cache() -> None:
    """Clear memory cache to force re-introspection on next access."""
    global _cached_runtime_nodes
    _cached_runtime_nodes = None


def get_all_registered_nodes(force_refresh: bool = False) -> Dict[str, Dict[str, Any]]:
    """Return all registered ComfyUI nodes.
    Introspects live ComfyUI `nodes.NODE_CLASS_MAPPINGS` if available;
    otherwise falls back to BUILTIN_CORE_NODES.
    """
    global _cached_runtime_nodes
    if _cached_runtime_nodes is not None and not force_refresh:
        return _cached_runtime_nodes

    try:
        import nodes
        mappings = getattr(nodes, "NODE_CLASS_MAPPINGS", {})
        display_mappings = getattr(nodes, "NODE_DISPLAY_NAME_MAPPINGS", {})

        result: Dict[str, Dict[str, Any]] = {}
        for class_name, node_cls in mappings.items():
            display_name = display_mappings.get(class_name, class_name)
            node_info = _introspect_single_node(class_name, node_cls, display_name)
            if node_info:
                result[class_name] = node_info

        # Merge with builtin fallback to ensure rich baseline info
        for k, v in BUILTIN_CORE_NODES.items():
            if k not in result:
                result[k] = v
            else:
                # Fill missing description if blank
                if not result[k].get("description") and v.get("description"):
                    result[k]["description"] = v["description"]

        _cached_runtime_nodes = result
        return result
    except Exception:
        # Standalone or test environment
        _cached_runtime_nodes = dict(BUILTIN_CORE_NODES)
        return _cached_runtime_nodes


def get_node_info(class_name: str, force_refresh: bool = False) -> Optional[Dict[str, Any]]:
    """Retrieve detailed node specification by class name or display name.
    If not cached or force_refresh is requested, queries live ComfyUI memory on the fly.
    """
    if not class_name:
        return None
    all_nodes = get_all_registered_nodes(force_refresh=force_refresh)

    # 1. Exact class_name match
    if class_name in all_nodes:
        return all_nodes[class_name]

    # 2. Case-insensitive class_name match
    target_lower = class_name.lower().strip()
    for k, v in all_nodes.items():
        if k.lower() == target_lower:
            return v

    # 3. Display name match
    for v in all_nodes.values():
        if v.get("display_name", "").lower() == target_lower:
            return v

    # 4. On-demand dynamic lookup from live nodes.NODE_CLASS_MAPPINGS
    try:
        import nodes
        mappings = getattr(nodes, "NODE_CLASS_MAPPINGS", {})
        display_mappings = getattr(nodes, "NODE_DISPLAY_NAME_MAPPINGS", {})
        if class_name in mappings:
            d_name = display_mappings.get(class_name, class_name)
            info = _introspect_single_node(class_name, mappings[class_name], d_name)
            if info:
                all_nodes[class_name] = info
                return info
    except Exception:
        pass

    return None


def search_nodes(query: str, limit: int = 15, force_refresh: bool = False) -> List[Dict[str, Any]]:
    """Fuzzy search registered nodes by class_name, display_name, category, or description."""
    all_nodes = get_all_registered_nodes(force_refresh=force_refresh)
    if not query or not query.strip():
        # Return popular core nodes by default
        return list(BUILTIN_CORE_NODES.values())[:limit]
    terms = [re.escape(t.lower()) for t in query.strip().split() if t.strip()]
    if not terms:
        return []

    scored_results = []
    for node in all_nodes.values():
        c_name = node.get("class_name", "").lower()
        d_name = node.get("display_name", "").lower()
        cat = node.get("category", "").lower()
        desc = node.get("description", "").lower()

        score = 0
        all_matched = True

        for term in terms:
            if term == c_name or term == d_name:
                score += 100
            elif c_name.startswith(term) or d_name.startswith(term):
                score += 50
            elif term in c_name or term in d_name:
                score += 30
            elif term in cat:
                score += 20
            elif term in desc:
                score += 10
            else:
                # Check inputs/outputs
                in_names = " ".join(node.get("inputs", {}).keys()).lower()
                out_names = " ".join([o.get("type", "") for o in node.get("outputs", [])]).lower()
                if term in in_names or term in out_names:
                    score += 15
                else:
                    all_matched = False
                    break

        if all_matched and score > 0:
            scored_results.append((score, node))

    scored_results.sort(key=lambda x: x[0], reverse=True)
    return [item[1] for item in scored_results[:limit]]


def format_node_spec_markdown(node: Dict[str, Any]) -> str:
    """Format a node specification into a compact Markdown block for LLM prompt."""
    c_name = node.get("class_name", "Unknown")
    d_name = node.get("display_name", c_name)
    cat = node.get("category", "general")
    desc = node.get("description", "")

    lines = [f"- **Node Specification: `{d_name}`** (`{c_name}`) [Category: `{cat}`]"]
    if desc:
        clean_desc = desc.split("\n")[0].strip()
        lines.append(f"  - Purpose: {clean_desc}")

    # Inputs summary
    inputs = node.get("inputs", {})
    if inputs:
        req_parts = []
        opt_parts = []
        for name, spec in inputs.items():
            t = spec.get("type", "ANY")
            extra = []
            if t == "COMBO" and spec.get("choices"):
                sample_choices = spec["choices"][:4]
                choices_str = ", ".join(f'"{c}"' for c in sample_choices)
                if len(spec["choices"]) > 4:
                    choices_str += "..."
                extra.append(f"choices: [{choices_str}]")
            elif t in ("INT", "FLOAT"):
                if "min" in spec and "max" in spec:
                    extra.append(f"{spec['min']}~{spec['max']}")
                if "default" in spec:
                    extra.append(f"def: {spec['default']}")

            extra_str = f" ({', '.join(extra)})" if extra else ""
            part_str = f"`{name}` ({t}{extra_str})"
            if spec.get("required"):
                req_parts.append(part_str)
            else:
                opt_parts.append(part_str)

        if req_parts:
            lines.append(f"  - Required Inputs: {', '.join(req_parts)}")
        if opt_parts:
            lines.append(f"  - Optional/Configurable: {', '.join(opt_parts)}")

    # Outputs summary
    outputs = node.get("outputs", [])
    if outputs:
        out_str = ", ".join(f"`{o.get('name', o.get('type'))}` ({o.get('type')})" for o in outputs)
        lines.append(f"  - Outputs: {out_str}")

    return "\n".join(lines)
