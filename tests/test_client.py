"""Test suite for GemBridge client (deterministic test engine)."""

import json
import unittest

from gembridge.client import GemBridgeClient


class DeterministicClientTests(unittest.TestCase):
    """Tests for the deterministic test mode client."""

    def setUp(self):
        self.client = GemBridgeClient(mode="test")

    def test_health_check(self):
        """Health check should report ready in test mode."""
        health = self.client.check_health()
        self.assertTrue(health["healthy"])
        self.assertEqual(health["status"], "ready")
        self.assertEqual(health["mode"], "test")

    def test_list_models(self):
        """list_models should include flagship models."""
        models = self.client.list_models()
        ids = [m["id"] for m in models]
        self.assertIn("gemini-3.1-pro", ids)
        self.assertIn("gemini-3.8-flash", ids)
        self.assertIn("gemini-3.1-ultra", ids)
        self.assertIn("gemini-3.5-pro", ids)

    def test_list_models_all_owned_by_google(self):
        """Every model must have owned_by=google."""
        models = self.client.list_models()
        for m in models:
            self.assertEqual(m["owned_by"], "google")


class GeminiProCompletionTests(unittest.TestCase):
    """Tests for gemini-3.1-pro deterministic completions."""

    def setUp(self):
        self.client = GemBridgeClient(mode="test")

    def test_chat_completion_returns_valid_structure(self):
        """Chat completion for gemini-3.1-pro must return OpenAI-compatible JSON."""
        result = self.client.create_chat_completion({
            "model": "gemini-3.1-pro",
            "messages": [{"role": "user", "content": "Explain deep-context reasoning"}],
        })
        self.assertEqual(result["object"], "chat.completion")
        self.assertEqual(len(result["choices"]), 1)
        self.assertEqual(result["choices"][0]["finish_reason"], "stop")
        self.assertEqual(result["model"], "gemini-3.1-pro")

    def test_chat_completion_contains_reasoning_trace(self):
        """gemini-3.1-pro response should mention deep-context reasoning."""
        result = self.client.create_chat_completion({
            "model": "gemini-3.1-pro",
            "messages": [{"role": "user", "content": "Test reasoning"}],
        })
        content = result["choices"][0]["message"]["content"]
        self.assertIn("Deep-Context Reasoning", content)
        self.assertIn("gemini-3.1-pro", content)

    def test_chat_completion_has_usage(self):
        """Response must include usage tokens."""
        result = self.client.create_chat_completion({
            "model": "gemini-3.1-pro",
            "messages": [{"role": "user", "content": "Token count test"}],
        })
        self.assertIn("usage", result)
        self.assertGreater(result["usage"]["total_tokens"], 0)

    def test_alias_gemini_pro_resolves(self):
        """gemini-pro alias should resolve to gemini-3.1-pro."""
        result = self.client.create_chat_completion({
            "model": "gemini-pro",
            "messages": [{"role": "user", "content": "Alias test"}],
        })
        self.assertEqual(result["model"], "gemini-3.1-pro")


class GeminiFlashCompletionTests(unittest.TestCase):
    """Tests for gemini-3.8-flash deterministic completions."""

    def setUp(self):
        self.client = GemBridgeClient(mode="test")

    def test_chat_completion_returns_valid_structure(self):
        """Chat completion for gemini-3.8-flash must return OpenAI-compatible JSON."""
        result = self.client.create_chat_completion({
            "model": "gemini-3.8-flash",
            "messages": [{"role": "user", "content": "Quick response test"}],
        })
        self.assertEqual(result["object"], "chat.completion")
        self.assertEqual(result["model"], "gemini-3.8-flash")

    def test_chat_completion_contains_flash_signature(self):
        """gemini-3.8-flash response should mention high-throughput."""
        result = self.client.create_chat_completion({
            "model": "gemini-3.8-flash",
            "messages": [{"role": "user", "content": "Speed test"}],
        })
        content = result["choices"][0]["message"]["content"]
        self.assertIn("High-Throughput", content)

    def test_streaming_completion(self):
        """Streaming for gemini-3.8-flash must yield SSE chunks ending with [DONE]."""
        result = self.client.create_chat_completion({
            "model": "gemini-3.8-flash",
            "messages": [{"role": "user", "content": "Stream test"}],
            "stream": True,
        })
        chunks = list(result)
        self.assertGreater(len(chunks), 0)
        self.assertTrue(chunks[-1].strip().endswith("[DONE]"))

        # Verify role chunk
        first_data = chunks[0].replace("data: ", "").strip()
        first_chunk = json.loads(first_data)
        self.assertEqual(first_chunk["choices"][0]["delta"]["role"], "assistant")

    def test_alias_gemini_flash_resolves(self):
        """gemini-flash alias should resolve to gemini-3.8-flash."""
        result = self.client.create_chat_completion({
            "model": "gemini-flash",
            "messages": [{"role": "user", "content": "Alias test"}],
        })
        self.assertEqual(result["model"], "gemini-3.8-flash")


class GeminiUltraCompletionTests(unittest.TestCase):
    """Tests for gemini-3.1-ultra deterministic completions."""

    def setUp(self):
        self.client = GemBridgeClient(mode="test")

    def test_chat_completion_multimodal_signature(self):
        """gemini-3.1-ultra response should mention multimodal verification."""
        result = self.client.create_chat_completion({
            "model": "gemini-3.1-ultra",
            "messages": [{"role": "user", "content": "Complex math verification"}],
        })
        content = result["choices"][0]["message"]["content"]
        self.assertIn("Multimodal", content)
        self.assertIn("Mathematical Verification", content)

    def test_alias_gemini_ultra_resolves(self):
        """gemini-ultra alias should resolve to gemini-3.1-ultra."""
        result = self.client.create_chat_completion({
            "model": "gemini-ultra",
            "messages": [{"role": "user", "content": "Alias test"}],
        })
        self.assertEqual(result["model"], "gemini-3.1-ultra")


class LegacyModelCompletionTests(unittest.TestCase):
    """Tests for backward-compat legacy models."""

    def setUp(self):
        self.client = GemBridgeClient(mode="test")

    def test_gemini_2_0_flash(self):
        """gemini-2.0-flash should produce a legacy response."""
        result = self.client.create_chat_completion({
            "model": "gemini-2.0-flash",
            "messages": [{"role": "user", "content": "Legacy test"}],
        })
        content = result["choices"][0]["message"]["content"]
        self.assertIn("Legacy", content)

    def test_gemini_1_5_pro(self):
        """gemini-1.5-pro should produce a legacy response."""
        result = self.client.create_chat_completion({
            "model": "gemini-1.5-pro",
            "messages": [{"role": "user", "content": "Legacy test"}],
        })
        content = result["choices"][0]["message"]["content"]
        self.assertIn("Legacy", content)


if __name__ == "__main__":
    unittest.main()
