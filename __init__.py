"""
ComfyMate - Context-Aware Workflow AI Assistant for ComfyUI
"""

import os
from .py import server

print("\n" + "=" * 55)
print("  🤖 [ComfyMate] Custom Node & Web Extension Loaded!")
print("=" * 55 + "\n")

# ComfyUI Web Extension configuration
WEB_DIRECTORY = "./web"

# Custom Node Mappings (ComfyMate is an assistant extension, but mappings are required by ComfyUI loader)
NODE_CLASS_MAPPINGS = {}
NODE_DISPLAY_NAME_MAPPINGS = {}

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]
