#!/usr/bin/env python3
import os
import runpy
import warnings

warnings.warn(
    "Script 'gemini_web2api.py' is deprecated. Use 'gembridge' instead. "
    "Will be removed in v2.0.",
    DeprecationWarning,
    stacklevel=2,
)
_runpy_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "gembridge.py")
runpy.run_path(_runpy_path, run_name="__main__")
