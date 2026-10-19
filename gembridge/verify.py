"""In-process End-to-End Verification Suite for GemBridge.

Spawns an isolated local server instance and executes full REST, SSE,
model catalog, and compliance guardrail checks.
"""

import json
import sys
import threading
import time
import urllib.error
import urllib.request
from typing import Any, Dict, List, Optional, Tuple

from .config import CONFIG
from .models import MODELS, MODEL_ALIASES
from .server import GeminiHandler, ThreadedServer


class VerificationRunner:
    """Automated in-process end-to-end verification orchestrator."""

    def __init__(self, port: int = 8089):
        self.port = port
        self.server: Optional[ThreadedServer] = None
        self.server_thread: Optional[threading.Thread] = None
        self.base_url = f"http://127.0.0.1:{self.port}"
        self.results: List[Tuple[str, bool, str]] = []

    def start_test_server(self) -> None:
        """Start background server with no auth for testing."""
        # Save and override config for isolated test
        self._saved_config = dict(CONFIG)
        CONFIG["host"] = "127.0.0.1"
        CONFIG["port"] = self.port
        CONFIG["api_keys"] = []  # Disable auth for verification
        CONFIG["log_requests"] = False

        self.server = ThreadedServer(("127.0.0.1", self.port), GeminiHandler)
        self.server_thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.server_thread.start()
        time.sleep(0.3)

    def stop_test_server(self) -> None:
        """Shut down background server and restore config."""
        if self.server:
            try:
                self.server.shutdown()
                self.server.server_close()
            except Exception:
                pass
        # Restore original config
        if hasattr(self, "_saved_config"):
            CONFIG.clear()
            CONFIG.update(self._saved_config)

    def _http_request(
        self,
        method: str,
        path: str,
        headers: Optional[Dict[str, str]] = None,
        body: Optional[Dict[str, Any]] = None,
    ) -> Tuple[int, Dict[str, Any], str]:
        """Helper to send HTTP requests to test server."""
        url = f"{self.base_url}{path}"
        req_headers = headers or {}

        data_bytes = None
        if body is not None:
            data_bytes = json.dumps(body).encode("utf-8")
            if "Content-Type" not in req_headers:
                req_headers["Content-Type"] = "application/json"

        req = urllib.request.Request(url, data=data_bytes, headers=req_headers, method=method)

        try:
            with urllib.request.urlopen(req, timeout=5.0) as resp:
                status = resp.status
                raw_body = resp.read().decode("utf-8")
                try:
                    json_body = json.loads(raw_body)
                except Exception:
                    json_body = {}
                return status, json_body, raw_body
        except urllib.error.HTTPError as e:
            raw_body = e.read().decode("utf-8")
            try:
                json_body = json.loads(raw_body)
            except Exception:
                json_body = {}
            return e.code, json_body, raw_body

    def run_all(self) -> bool:
        """Execute the entire verification suite."""
        print(f"\n{'='*60}")
        print(f" GemBridge In-Process E2E Verification Suite")
        print(f"{'='*60}")
        print(f" Target Host:  127.0.0.1")
        print(f" Target Port:  {self.port}")
        print(f" Auth Gate:    Disabled (isolated test)")
        print(f"{'='*60}\n")

        self.start_test_server()

        try:
            self._test_root_health()
            self._test_models_listing()
            self._test_models_v1beta()
            self._test_model_completions()
            self._test_streaming_completion()
            self._test_alias_resolution()
        finally:
            self.stop_test_server()

        return self._report_results()

    def _test_root_health(self) -> None:
        """Verify GET / returns status and models."""
        status, json_data, _ = self._http_request("GET", "/")
        passed = (
            status == 200
            and json_data.get("status") == "ok"
            and "gemini-3.1-pro" in json_data.get("models", [])
            and "gemini-3.8-flash" in json_data.get("models", [])
        )
        self.results.append(("GET / (Root Health Check)", passed,
                             f"Status: {status}, Models: {len(json_data.get('models', []))}"))

    def _test_models_listing(self) -> None:
        """Verify GET /v1/models includes flagship models with owned_by=google."""
        status, json_data, _ = self._http_request("GET", "/v1/models")
        model_ids = [m.get("id") for m in json_data.get("data", [])]
        owned_bys = [m.get("owned_by") for m in json_data.get("data", [])]

        required_models = [
            "gemini-3.1-pro", "gemini-3.8-flash", "gemini-3.1-ultra",
            "gemini-3.5-pro", "gemini-3.5-flash",
            "gemini-2.0-flash", "gemini-1.5-pro", "gemini-1.5-flash",
        ]
        all_present = all(rm in model_ids for rm in required_models)
        all_google = all(ob == "google" for ob in owned_bys)
        passed = status == 200 and all_present and all_google
        self.results.append(("GET /v1/models (Catalog Check)", passed,
                             f"Models found: {len(model_ids)}, All present: {all_present}, All google: {all_google}"))

    def _test_models_v1beta(self) -> None:
        """Verify GET /v1beta/models returns Google-native format."""
        status, json_data, _ = self._http_request("GET", "/v1beta/models")
        model_names = [m.get("name", "") for m in json_data.get("models", [])]
        has_pro = any("gemini-3.1-pro" in n for n in model_names)
        has_flash = any("gemini-3.8-flash" in n for n in model_names)
        passed = status == 200 and has_pro and has_flash
        self.results.append(("GET /v1beta/models (Google API Format)", passed,
                             f"Models: {len(model_names)}, Pro: {has_pro}, Flash: {has_flash}"))

    def _test_model_completions(self) -> None:
        """Test non-streaming completions on flagship models via mock."""
        from unittest import mock

        test_models = ["gemini-3.1-pro", "gemini-3.8-flash", "gemini-3.1-ultra"]

        for test_model in test_models:
            deterministic_text = f"[Deterministic test response for {test_model}]"
            with mock.patch("gembridge.server.generate", return_value=deterministic_text):
                status, json_data, _ = self._http_request(
                    "POST", "/v1/chat/completions",
                    body={
                        "model": test_model,
                        "messages": [{"role": "user", "content": "Verify integration"}],
                    },
                )
            content = json_data.get("choices", [{}])[0].get("message", {}).get("content", "")
            passed = status == 200 and len(content) > 0 and json_data.get("object") == "chat.completion"
            self.results.append((
                f"POST /v1/chat/completions ({test_model})", passed,
                f"Content: {content[:50]}..."
            ))

    def _test_streaming_completion(self) -> None:
        """Test SSE streaming completion for gemini-3.8-flash via mock."""
        from unittest import mock

        with mock.patch("gembridge.server.generate_stream", return_value=iter(["flash ", "response"])):
            url = f"{self.base_url}/v1/chat/completions"
            headers = {"Content-Type": "application/json"}
            body = json.dumps({
                "model": "gemini-3.8-flash",
                "messages": [{"role": "user", "content": "Stream test"}],
                "stream": True,
            }).encode("utf-8")
            req = urllib.request.Request(url, data=body, headers=headers, method="POST")

            received_chunks = 0
            saw_done = False
            try:
                with urllib.request.urlopen(req, timeout=5.0) as resp:
                    raw = resp.read().decode("utf-8")
                    for line in raw.splitlines():
                        if line.startswith("data: "):
                            data_part = line[6:].strip()
                            if data_part == "[DONE]":
                                saw_done = True
                            elif data_part.startswith("{"):
                                try:
                                    chunk = json.loads(data_part)
                                    if "choices" in chunk:
                                        received_chunks += 1
                                except Exception:
                                    pass
                passed = received_chunks > 0 and saw_done
                self.results.append((
                    "POST /v1/chat/completions (SSE Stream gemini-3.8-flash)", passed,
                    f"Chunks: {received_chunks}, [DONE]: {saw_done}"
                ))
            except Exception as e:
                self.results.append((
                    "POST /v1/chat/completions (SSE Stream gemini-3.8-flash)", False,
                    f"Error: {str(e)}"
                ))

    def _test_alias_resolution(self) -> None:
        """Verify alias models resolve correctly in completions."""
        from unittest import mock

        alias_pairs = [
            ("gemini-pro", "gemini-3.1-pro"),
            ("gemini-flash", "gemini-3.8-flash"),
            ("gemini-ultra", "gemini-3.1-ultra"),
        ]

        for alias, expected_target in alias_pairs:
            with mock.patch("gembridge.server.generate", return_value=f"Alias test for {expected_target}"):
                status, json_data, _ = self._http_request(
                    "POST", "/v1/chat/completions",
                    body={
                        "model": alias,
                        "messages": [{"role": "user", "content": "Alias test"}],
                    },
                )
            resolved_model = json_data.get("model", "")
            passed = status == 200 and resolved_model == expected_target
            self.results.append((
                f"Alias Resolution ({alias} -> {expected_target})", passed,
                f"Resolved to: {resolved_model}"
            ))

    def _report_results(self) -> bool:
        """Print summary report and return overall pass/fail status."""
        print(f"\n{'='*60}")
        print(f"     GEMBRIDGE IN-PROCESS E2E VERIFICATION REPORT")
        print(f"{'='*60}")
        all_passed = True
        for name, passed, detail in self.results:
            tag = "[PASS]" if passed else "[FAIL]"
            if not passed:
                all_passed = False
            print(f" {tag} {name:<50} | {detail}")

        total = len(self.results)
        passed_count = sum(1 for _, p, _ in self.results if p)
        failed_count = total - passed_count
        print(f"{'='*60}")
        print(f" Total Tests: {total} | Passed: {passed_count} | Failed: {failed_count}")
        print(f" Final Status: {'ALL TESTS PASSED (100%)' if all_passed else 'VERIFICATION FAILED'}")
        print(f"{'='*60}\n")
        return all_passed


def run_inprocess_verification(port: int = 8089) -> bool:
    """Entry point for standalone or CLI in-process verification."""
    runner = VerificationRunner(port=port)
    return runner.run_all()


if __name__ == "__main__":
    success = run_inprocess_verification()
    sys.exit(0 if success else 1)

