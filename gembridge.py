#!/usr/bin/env python3
"""GemBridge compatibility launcher.

The canonical implementation lives in the gembridge package.
"""
from gembridge.__main__ import main

if __name__ == "__main__":
    raise SystemExit(main())
