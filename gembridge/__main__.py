"""Entry point: python -m gembridge"""
import argparse
import os
import sys

from .config import CONFIG, load_config, find_config
from .models import MODELS
from .gemini import HAS_HTTPX
from .server import GeminiHandler, ThreadedServer
from . import __version__


def main():
    parser = argparse.ArgumentParser(description="Gemini Web to OpenAI API")
    parser.add_argument("--port", type=int, default=None)
    parser.add_argument("--config", type=str, default=None)
    parser.add_argument("--cookie-file", type=str, default=None)
    parser.add_argument("--proxy", type=str, default=None, help="HTTP proxy, e.g. http://127.0.0.1:7890")
    parser.add_argument("--version", action="version", version=f"GemBridge {__version__}")
    parser.add_argument("--audit", action="store_true", help="Run anti-scraping static audit on repository")
    parser.add_argument("--whoami", action="store_true", help="Audit and display auth provenance details")
    parser.add_argument("--verify", action="store_true", help="Run in-process E2E verification suite")
    args = parser.parse_args()

    # ── --audit: Static compliance scan ──────────────────────────────────────
    if args.audit:
        from .compliance import run_static_anti_scraping_audit
        root_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        print(f"Running anti-scraping compliance audit on: {root_dir}")
        passed, violations = run_static_anti_scraping_audit(root_dir)
        if passed:
            print("[PASS] Anti-scraping compliance audit PASSED: 0 forbidden patterns found.")
            sys.exit(0)
        else:
            print("[FAIL] Anti-scraping compliance audit FAILED:")
            for v in violations:
                print(f"  - {v}")
            sys.exit(1)

    # ── --verify: In-process E2E verification ────────────────────────────────
    if args.verify:
        from .verify import run_inprocess_verification
        success = run_inprocess_verification()
        sys.exit(0 if success else 1)

    config_path = args.config or os.environ.get("GEM_BRIDGE_CONFIG") or os.environ.get("GEMINI_WEB2API_CONFIG") or find_config()
    if config_path:
        load_config(config_path)

    if args.port:
        CONFIG["port"] = args.port
    if args.cookie_file:
        CONFIG["cookie_file"] = args.cookie_file
    if args.proxy:
        CONFIG["proxy"] = args.proxy

    # ── --whoami: Auth provenance audit ──────────────────────────────────────
    if args.whoami:
        from .identity import format_whoami_text
        print(format_whoami_text())
        sys.exit(0)

    port = CONFIG["port"]
    server = ThreadedServer((CONFIG["host"], port), GeminiHandler)
    print(f"GemBridge v{__version__}")
    print(f"  Listening: http://{CONFIG['host']}:{port}")
    print(f"  Base URL:  http://localhost:{port}/v1")
    print(f"  Models:    {', '.join(MODELS.keys())}")
    print(f"  Cookie:    {'yes' if CONFIG.get('cookie_file') else 'none (anonymous)'}")
    print(f"  Proxy:     {CONFIG.get('proxy') or 'system env'}")
    print(f"  Streaming: {'httpx (true streaming)' if HAS_HTTPX else 'urllib (buffered)'}")
    print(f"  Temporary: {'yes' if CONFIG.get('temporary_chats', False) else 'no'}")
    print()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")
        server.shutdown()


if __name__ == "__main__":
    main()
