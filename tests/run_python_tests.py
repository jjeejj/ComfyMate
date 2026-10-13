"""Run every Python test offline without touching user configuration or histories."""
import importlib
import runpy
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))


def main():
    with tempfile.TemporaryDirectory(prefix="comfymate-tests-") as directory:
        base = Path(directory)
        folder_paths = types.SimpleNamespace(get_user_directory=lambda: str(base / "user"))
        with patch.dict(sys.modules, {"folder_paths": folder_paths}):
            # Initial import may migrate legacy plugin data; don't copy real user data into tests.
            with patch("shutil.copy2"):
                modules = {name: importlib.import_module(f"py.{name}") for name in ("config", "sessions", "server")}
            with patch.object(modules["config"], "__file__", str(base / "plugin/py/config.py")), \
                 patch.object(modules["sessions"], "__file__", str(base / "plugin/py/sessions.py")), \
                 patch.object(modules["server"], "__file__", str(base / "plugin/py/server.py")):
                modules["server"].ATTACHMENTS_DIR = modules["server"].get_attachments_dir()
                suite = unittest.TestSuite()
                loader = unittest.TestLoader()
                for path in sorted((ROOT / "tests").glob("test_*.py")):
                    namespace = runpy.run_path(str(path))
                    for name, obj in namespace.items():
                        if name.startswith("test_") and callable(obj):
                            suite.addTest(unittest.FunctionTestCase(obj, description=f"{path.name}:{name}"))
                        elif isinstance(obj, type) and issubclass(obj, unittest.TestCase):
                            suite.addTests(loader.loadTestsFromTestCase(obj))
                result = unittest.TextTestRunner(verbosity=2).run(suite)
                return 0 if result.wasSuccessful() else 1


if __name__ == "__main__":
    sys.exit(main())
