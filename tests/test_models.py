"""Test suite for GemBridge model registry and catalog."""

import json
import threading
import unittest
from unittest import mock

from gembridge.config import CONFIG
from gembridge.models import MODELS, MODEL_ALIASES, resolve_model, get_openai_model_list
from gembridge.server import GeminiHandler, ThreadedServer


class ModelRegistryTests(unittest.TestCase):
    """Unit tests for model registry contents."""

    def test_gemini_4_argon_in_registry(self):
        """gemini-4-argon must be registered as frontier model."""
        self.assertIn("gemini-4-argon", MODELS)
        self.assertEqual(MODELS["gemini-4-argon"]["mode"], 3)
        self.assertIn("Argon", MODELS["gemini-4-argon"]["desc"])

    def test_gemini_3_1_pro_in_registry(self):
        """gemini-3.1-pro must be registered."""
        self.assertIn("gemini-3.1-pro", MODELS)
        self.assertEqual(MODELS["gemini-3.1-pro"]["mode"], 3)

    def test_gemini_3_8_flash_in_registry(self):
        """gemini-3.8-flash must be registered."""
        self.assertIn("gemini-3.8-flash", MODELS)
        self.assertEqual(MODELS["gemini-3.8-flash"]["mode"], 1)

    def test_gemini_3_1_ultra_in_registry(self):
        """gemini-3.1-ultra must be registered."""
        self.assertIn("gemini-3.1-ultra", MODELS)
        self.assertEqual(MODELS["gemini-3.1-ultra"]["mode"], 3)

    def test_gemini_3_5_pro_in_registry(self):
        """gemini-3.5-pro must be registered."""
        self.assertIn("gemini-3.5-pro", MODELS)

    def test_gemini_3_5_flash_in_registry(self):
        """gemini-3.5-flash must be registered."""
        self.assertIn("gemini-3.5-flash", MODELS)

    def test_backward_compat_gemini_2_0_flash(self):
        """gemini-2.0-flash must remain for backward compat."""
        self.assertIn("gemini-2.0-flash", MODELS)

    def test_backward_compat_gemini_2_0_pro_exp(self):
        """gemini-2.0-pro-exp-02-05 must remain for backward compat."""
        self.assertIn("gemini-2.0-pro-exp-02-05", MODELS)

    def test_backward_compat_gemini_1_5_pro(self):
        """gemini-1.5-pro must remain for backward compat."""
        self.assertIn("gemini-1.5-pro", MODELS)

    def test_backward_compat_gemini_1_5_flash(self):
        """gemini-1.5-flash must remain for backward compat."""
        self.assertIn("gemini-1.5-flash", MODELS)


class ModelAliasTests(unittest.TestCase):
    """Tests for model alias resolution."""

    def test_gemini_argon_alias(self):
        """gemini-argon and argon should resolve to gemini-4-argon."""
        self.assertEqual(MODEL_ALIASES["gemini-argon"], "gemini-4-argon")
        self.assertEqual(MODEL_ALIASES["argon"], "gemini-4-argon")
        name, mode, think, error, extra = resolve_model("gemini-argon")
        self.assertEqual(name, "gemini-4-argon")
        self.assertEqual(mode, 3)

    def test_gemini_pro_alias(self):
        """gemini-pro should resolve to gemini-3.1-pro."""
        self.assertEqual(MODEL_ALIASES["gemini-pro"], "gemini-3.1-pro")

    def test_gemini_flash_alias(self):
        """gemini-flash should resolve to gemini-3.8-flash."""
        self.assertEqual(MODEL_ALIASES["gemini-flash"], "gemini-3.8-flash")

    def test_gemini_ultra_alias(self):
        """gemini-ultra should resolve to gemini-3.1-ultra."""
        self.assertEqual(MODEL_ALIASES["gemini-ultra"], "gemini-3.1-ultra")

    def test_resolve_model_with_alias(self):
        """resolve_model should resolve aliases to canonical names."""
        name, mode, think, error, extra = resolve_model("gemini-pro")
        self.assertEqual(name, "gemini-3.1-pro")
        self.assertEqual(mode, 3)
        self.assertIsNone(error)

    def test_resolve_model_flash_alias(self):
        """resolve_model should resolve gemini-flash to gemini-3.8-flash."""
        name, mode, think, error, extra = resolve_model("gemini-flash")
        self.assertEqual(name, "gemini-3.8-flash")
        self.assertEqual(mode, 1)
        self.assertIsNone(error)

    def test_resolve_model_ultra_alias(self):
        """resolve_model should resolve gemini-ultra to gemini-3.1-ultra."""
        name, mode, think, error, extra = resolve_model("gemini-ultra")
        self.assertEqual(name, "gemini-3.1-ultra")
        self.assertEqual(mode, 3)
        self.assertIsNone(error)


class OpenAIModelListTests(unittest.TestCase):
    """Tests for the OpenAI-compatible model list."""

    def test_get_openai_model_list_returns_entries(self):
        models = get_openai_model_list()
        self.assertGreater(len(models), 0)

    def test_all_models_owned_by_google(self):
        """Every model entry must have owned_by='google'."""
        models = get_openai_model_list()
        for m in models:
            self.assertEqual(m["owned_by"], "google",
                             f"Model {m['id']} has owned_by={m['owned_by']}")

    def test_flagship_models_in_list(self):
        """gemini-3.1-pro and gemini-3.8-flash must appear."""
        models = get_openai_model_list()
        ids = [m["id"] for m in models]
        self.assertIn("gemini-3.1-pro", ids)
        self.assertIn("gemini-3.8-flash", ids)

    def test_aliases_in_list(self):
        """Alias entries should also appear in the model list."""
        models = get_openai_model_list()
        ids = [m["id"] for m in models]
        self.assertIn("gemini-pro", ids)
        self.assertIn("gemini-flash", ids)
        self.assertIn("gemini-ultra", ids)

    def test_model_entries_have_required_fields(self):
        """Each model must have id, object, created, owned_by."""
        models = get_openai_model_list()
        for m in models:
            self.assertIn("id", m)
            self.assertEqual(m["object"], "model")
            self.assertIn("created", m)
            self.assertIn("owned_by", m)


class ModelEndpointTests(unittest.TestCase):
    """HTTP integration tests for GET /v1/models."""

    @classmethod
    def setUpClass(cls):
        cls.server = ThreadedServer(("127.0.0.1", 0), GeminiHandler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.port = cls.server.server_address[1]
        cls._saved_config = dict(CONFIG)
        CONFIG["api_keys"] = []
        CONFIG["log_requests"] = False

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join(timeout=5)
        CONFIG.clear()
        CONFIG.update(cls._saved_config)

    def _get(self, path):
        import http.client
        conn = http.client.HTTPConnection("127.0.0.1", self.port, timeout=5)
        conn.request("GET", path)
        resp = conn.getresponse()
        body = json.loads(resp.read().decode())
        conn.close()
        return resp.status, body

    def test_v1_models_returns_flagship(self):
        """GET /v1/models must include gemini-3.1-pro and gemini-3.8-flash."""
        status, body = self._get("/v1/models")
        self.assertEqual(status, 200)
        ids = [m["id"] for m in body.get("data", [])]
        self.assertIn("gemini-3.1-pro", ids)
        self.assertIn("gemini-3.8-flash", ids)

    def test_v1_models_owned_by_google(self):
        """All models in GET /v1/models must have owned_by=google."""
        status, body = self._get("/v1/models")
        self.assertEqual(status, 200)
        for m in body.get("data", []):
            self.assertEqual(m["owned_by"], "google")

    def test_v1_models_includes_legacy(self):
        """GET /v1/models must include backward-compat legacy models."""
        status, body = self._get("/v1/models")
        ids = [m["id"] for m in body.get("data", [])]
        self.assertIn("gemini-2.0-flash", ids)
        self.assertIn("gemini-1.5-pro", ids)
        self.assertIn("gemini-1.5-flash", ids)


if __name__ == "__main__":
    unittest.main()

