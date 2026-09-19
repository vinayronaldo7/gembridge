"""GemBridge Client: Deterministic test engine and API transport.

Follows the openbridge/claudit dual-mode client pattern:
- 'test' mode: deterministic response synthesis for offline testing and CI
- 'api' mode: maps model IDs to Google Generative Language API endpoints
"""

import json
import time
import uuid
import urllib.error
import urllib.request
from typing import Any, Dict, Generator, List, Optional, Union

from .models import MODELS, MODEL_ALIASES, get_openai_model_list, resolve_model


class GemBridgeClient:
    """Client for dispatching requests in test or API mode."""

    def __init__(self, mode: str = "test", api_key: Optional[str] = None,
                 api_base_url: str = "https://generativelanguage.googleapis.com"):
        self.mode = mode
        self.api_key = api_key
        self.api_base_url = api_base_url

    def list_models(self) -> List[Dict[str, Any]]:
        """Return model list in OpenAI-compatible schema."""
        return get_openai_model_list()

    def check_health(self) -> Dict[str, Any]:
        """Non-destructive health check."""
        return {
            "healthy": True,
            "status": "ready",
            "mode": self.mode,
            "upstream": "deterministic-test-adapter" if self.mode == "test" else self.api_base_url,
            "models_available": len(self.list_models()),
        }

    def create_chat_completion(
        self, request_data: Dict[str, Any]
    ) -> Union[Dict[str, Any], Generator[str, None, None]]:
        """Execute chat completion against deterministic engine or Google API."""
        stream = request_data.get("stream", False)

        if self.mode == "test":
            return self._handle_deterministic_completion(request_data, stream)

        return self._handle_api_completion(request_data, stream)

    # ─── Deterministic Test Engine ──────────────────────────────────────────

    def _handle_deterministic_completion(
        self, request_data: Dict[str, Any], stream: bool
    ) -> Union[Dict[str, Any], Generator[str, None, None]]:
        """Deterministic response synthesis for local testing and CI."""
        messages = request_data.get("messages", [])
        last_msg = messages[-1].get("content", "") if messages else ""
        if isinstance(last_msg, list):
            last_msg = " ".join(
                item.get("text", "") for item in last_msg
                if isinstance(item, dict) and "text" in item
            )

        model = request_data.get("model", "gemini-3.6-flash")
        # Resolve aliases
        model = MODEL_ALIASES.get(model, model)

        timestamp = int(time.time())
        completion_id = f"chatcmpl-gembridge-{timestamp}"

        content = self._generate_deterministic_text(model, last_msg)

        if stream:
            def gen():
                # Initial role chunk
                role_chunk = {
                    "id": completion_id, "object": "chat.completion.chunk",
                    "created": timestamp, "model": model,
                    "choices": [{"index": 0, "delta": {"role": "assistant"}, "finish_reason": None}],
                }
                yield f"data: {json.dumps(role_chunk)}\n\n"
                # Content chunk
                content_chunk = {
                    "id": completion_id, "object": "chat.completion.chunk",
                    "created": timestamp, "model": model,
                    "choices": [{"index": 0, "delta": {"content": content}, "finish_reason": None}],
                }
                yield f"data: {json.dumps(content_chunk, ensure_ascii=False)}\n\n"
                # Stop chunk
                stop_chunk = {
                    "id": completion_id, "object": "chat.completion.chunk",
                    "created": timestamp, "model": model,
                    "choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}],
                }
                yield f"data: {json.dumps(stop_chunk)}\n\n"
                yield "data: [DONE]\n\n"

            return gen()
        else:
            return {
                "id": completion_id,
                "object": "chat.completion",
                "created": timestamp,
                "model": model,
                "choices": [{
                    "index": 0,
                    "message": {
                        "role": "assistant",
                        "content": content,
                    },
                    "finish_reason": "stop",
                }],
                "usage": {
                    "prompt_tokens": max(10, len(last_msg) // 4),
                    "completion_tokens": max(20, len(content) // 4),
                    "total_tokens": max(30, (len(last_msg) + len(content)) // 4),
                },
            }

    def _generate_deterministic_text(self, model: str, last_msg: str) -> str:
        """Generate model-tier-specific deterministic response text."""
        snippet = last_msg[:60] if last_msg else "empty"

        if "3.1-pro" in model and "enhanced" not in model:
            return (
                f"[Gemini 3.1 Pro Deep-Context Reasoning]\n"
                f"Step 1 (Context Analysis): Processing multi-million token context window for '{snippet}'.\n"
                f"Step 2 (Reasoning Chain): Establishing cross-document causal links and semantic anchors.\n"
                f"Step 3 (Synthesis): Deep-context reasoning trace complete. "
                f"Deterministic verification passed for {model}."
            )
        elif "3.8-flash" in model:
            return (
                f"[Gemini 3.8 Flash High-Throughput Response]\n"
                f"Rapid low-latency execution for: '{snippet}'.\n"
                f"Processing completed in <50ms simulated latency. "
                f"High-throughput pipeline verified for {model}."
            )
        elif "3.1-ultra" in model:
            return (
                f"[Gemini 3.1 Ultra Multimodal Verification]\n"
                f"Step 1 (Visual Analysis): Multimodal input parsing for '{snippet}'.\n"
                f"Step 2 (Mathematical Verification): Complex numerical proof verified.\n"
                f"Step 3 (Cross-Modal Synthesis): Integrated multimodal output generated. "
                f"Ultra-class verification complete for {model}."
            )
        elif "3.5-pro" in model:
            return (
                f"[Gemini 3.5 Pro Extended Context]\n"
                f"Extended context processing for: '{snippet}'.\n"
                f"Next-gen pro reasoning verified for {model}."
            )
        elif "3.5-flash" in model and "thinking" not in model:
            return (
                f"[Gemini 3.5 Flash]\n"
                f"High-speed response for: '{snippet}'. "
                f"Flash-tier processing verified for {model}."
            )
        elif "2.0" in model or "1.5" in model:
            return (
                f"[Gemini Legacy ({model})]\n"
                f"Backward-compatible response for: '{snippet}'. "
                f"Legacy model path verified."
            )
        else:
            return (
                f"[GemBridge Deterministic ({model})]\n"
                f"Successfully processed request: '{snippet}'. "
                f"Deterministic test engine verified."
            )

    # ─── Google Generative Language API Mode ─────────────────────────────────

    def _handle_api_completion(
        self, request_data: Dict[str, Any], stream: bool
    ) -> Union[Dict[str, Any], Generator[str, None, None]]:
        """Forward request to Google Generative Language API.

        Maps OpenAI chat/completions format to Google's
        /v1beta/models/{model}:generateContent endpoint.
        """
        model = request_data.get("model", "gemini-3.6-flash")
        model = MODEL_ALIASES.get(model, model)

        messages = request_data.get("messages", [])
        contents = []
        system_instruction = None

        for msg in messages:
            role = msg.get("role", "user")
            content = msg.get("content", "")

            if role == "system":
                system_instruction = content if isinstance(content, str) else str(content)
            elif role == "assistant":
                text = content if isinstance(content, str) else str(content)
                contents.append({"role": "model", "parts": [{"text": text}]})
            else:
                text = content if isinstance(content, str) else str(content)
                contents.append({"role": "user", "parts": [{"text": text}]})

        if not contents:
            contents = [{"role": "user", "parts": [{"text": "Hello"}]}]

        google_payload = {
            "contents": contents,
            "generationConfig": {},
        }
        if system_instruction:
            google_payload["systemInstruction"] = {
                "parts": [{"text": system_instruction}]
            }
        if "temperature" in request_data:
            google_payload["generationConfig"]["temperature"] = request_data["temperature"]
        if "max_tokens" in request_data:
            google_payload["generationConfig"]["maxOutputTokens"] = request_data["max_tokens"]

        endpoint = "streamGenerateContent" if stream else "generateContent"
        url = f"{self.api_base_url}/v1beta/models/{model}:{endpoint}"
        if self.api_key:
            url += f"?key={self.api_key}"

        headers = {
            "Content-Type": "application/json",
            "User-Agent": "GemBridge-Client/1.2.0",
        }
        payload_bytes = json.dumps(google_payload).encode("utf-8")
        req = urllib.request.Request(url, data=payload_bytes, headers=headers, method="POST")

        try:
            resp = urllib.request.urlopen(req, timeout=180)
            if stream:
                return self._stream_google_response(resp, model)
            else:
                body = json.loads(resp.read().decode("utf-8"))
                return self._convert_google_to_openai(body, model)
        except urllib.error.HTTPError as e:
            err_body = ""
            try:
                err_body = e.read().decode("utf-8")
            except Exception:
                pass
            raise RuntimeError(f"Google API Error ({e.code}): {err_body}")
        except urllib.error.URLError as e:
            raise RuntimeError(f"Connection failed to {self.api_base_url}: {e.reason}")

    def _convert_google_to_openai(
        self, google_resp: Dict[str, Any], model: str
    ) -> Dict[str, Any]:
        """Convert Google generateContent response to OpenAI format."""
        candidates = google_resp.get("candidates", [])
        text = ""
        if candidates:
            parts = candidates[0].get("content", {}).get("parts", [])
            text = "".join(p.get("text", "") for p in parts)

        usage_meta = google_resp.get("usageMetadata", {})
        return {
            "id": f"chatcmpl-gembridge-{int(time.time())}",
            "object": "chat.completion",
            "created": int(time.time()),
            "model": model,
            "choices": [{
                "index": 0,
                "message": {"role": "assistant", "content": text},
                "finish_reason": "stop",
            }],
            "usage": {
                "prompt_tokens": usage_meta.get("promptTokenCount", len(text) // 4),
                "completion_tokens": usage_meta.get("candidatesTokenCount", len(text) // 4),
                "total_tokens": usage_meta.get("totalTokenCount", len(text) // 2),
            },
        }

    def _stream_google_response(self, response, model: str) -> Generator[str, None, None]:
        """Parse Google streaming response into OpenAI SSE chunks."""
        completion_id = f"chatcmpl-gembridge-{int(time.time())}"
        timestamp = int(time.time())

        try:
            for line in response:
                decoded = line.decode("utf-8").strip()
                if not decoded or not decoded.startswith("{"):
                    continue
                try:
                    chunk = json.loads(decoded)
                    candidates = chunk.get("candidates", [])
                    if candidates:
                        parts = candidates[0].get("content", {}).get("parts", [])
                        for part in parts:
                            text = part.get("text", "")
                            if text:
                                delta_chunk = {
                                    "id": completion_id,
                                    "object": "chat.completion.chunk",
                                    "created": timestamp, "model": model,
                                    "choices": [{"index": 0, "delta": {"content": text}, "finish_reason": None}],
                                }
                                yield f"data: {json.dumps(delta_chunk, ensure_ascii=False)}\n\n"
                except json.JSONDecodeError:
                    continue
        finally:
            response.close()

        stop_chunk = {
            "id": completion_id, "object": "chat.completion.chunk",
            "created": timestamp, "model": model,
            "choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}],
        }
        yield f"data: {json.dumps(stop_chunk)}\n\n"
        yield "data: [DONE]\n\n"
