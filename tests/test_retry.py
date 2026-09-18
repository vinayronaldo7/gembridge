"""Retry tests for GemBridge upstream no-text responses."""
import sys
import os
import unittest
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from gembridge.gemini import (
    generate,
    generate_stream,
    _is_no_text_error,
    NO_TEXT_ERROR_MESSAGE,
)
from tests.test_empty_response import (
    METADATA_ONLY_RESPONSE,
    CONTENT_BEARING_RESPONSE,
)


class IsNoTextErrorTests(unittest.TestCase):
    def test_recognises_no_text_runtime_error(self):
        self.assertTrue(_is_no_text_error(RuntimeError(NO_TEXT_ERROR_MESSAGE)))

    def test_rejects_bard_error_info(self):
        self.assertFalse(
            _is_no_text_error(RuntimeError("Gemini upstream rejected request: BardErrorInfo [123]"))
        )

    def test_rejects_unrelated_runtime_error(self):
        self.assertFalse(
            _is_no_text_error(RuntimeError("Gemini stream content changed during retry"))
        )

    def test_rejects_non_runtime_error(self):
        self.assertFalse(_is_no_text_error(ValueError("not a runtime error")))


class GenerateRetryTests(unittest.TestCase):
    """generate() must retry ONLY on no-text errors."""

    def _patch_urlopen(self, responses):
        import gembridge.gemini as gem

        calls = {"count": 0}

        class _FakeResp:
            def __init__(self, body):
                self._body = body.encode() if isinstance(body, str) else body
                self.status = 200

            def read(self):
                return self._body

        def _fake_urlopen(req, *args, **kwargs):
            idx = calls["count"]
            calls["count"] += 1
            return _FakeResp(responses[idx])

        return _fake_urlopen, calls

    def test_retries_then_succeeds(self):
        import gembridge.gemini as gem

        fake, calls = self._patch_urlopen([METADATA_ONLY_RESPONSE, CONTENT_BEARING_RESPONSE])
        with mock.patch.object(gem.urllib.request, "urlopen", fake), \
             mock.patch.object(gem.time, "sleep"):
            result = generate("hello", 1, 4)
        self.assertEqual(result, "Hello world")
        self.assertEqual(calls["count"], 2)

    def test_exhausts_attempts_and_raises(self):
        import gembridge.gemini as gem

        fake, calls = self._patch_urlopen([METADATA_ONLY_RESPONSE] * 10)
        with mock.patch.object(gem.urllib.request, "urlopen", fake), \
             mock.patch.object(gem.time, "sleep"):
            with self.assertRaises(RuntimeError) as ctx:
                generate("hello", 1, 4)
        self.assertIn("no text content", str(ctx.exception))
        self.assertEqual(calls["count"], 3)

    def test_single_call_success(self):
        import gembridge.gemini as gem

        fake, calls = self._patch_urlopen([CONTENT_BEARING_RESPONSE])
        with mock.patch.object(gem.urllib.request, "urlopen", fake):
            result = generate("hello", 1, 4)
        self.assertEqual(result, "Hello world")
        self.assertEqual(calls["count"], 1)

    def test_bard_error_not_retried(self):
        import gembridge.gemini as gem

        fake, calls = self._patch_urlopen(["BardErrorInfo [403]"])
        with mock.patch.object(gem.urllib.request, "urlopen", fake):
            with self.assertRaises(RuntimeError) as ctx:
                generate("hello", 1, 4)
        self.assertIn("BardErrorInfo", str(ctx.exception))
        self.assertEqual(calls["count"], 1)


class GenerateStreamRetryTests(unittest.TestCase):
    """generate_stream must retry on no-text and never emit partial success."""

    def _mock_httpx(self, raw_bodies):
        idx = {"i": 0}

        class _Resp:
            def __init__(self, body):
                self._body = body

            def raise_for_status(self):
                pass

            def iter_text(self):
                for line in self._body.split("\n"):
                    yield line + "\n"

        class _Ctx:
            def __init__(self_inner, body):
                self_inner._resp = _Resp(body)

            def __enter__(self_inner):
                return self_inner._resp

            def __exit__(self_inner, *a):
                pass

        class _Client:
            def stream(self_inner, method, url, **kwargs):
                idx["i"] += 1
                return _Ctx(raw_bodies[idx["i"] - 1])

        return _Client(), idx

    def test_stream_retries_then_succeeds(self):
        import gembridge.gemini as gem

        client, idx = self._mock_httpx([METADATA_ONLY_RESPONSE, CONTENT_BEARING_RESPONSE])
        with mock.patch.object(gem, "_get_httpx_client", lambda: client), \
             mock.patch.object(gem.time, "sleep"):
            chunks = list(generate_stream("hello", 1, 4))
        self.assertEqual("".join(chunks), "Hello world")

    def test_stream_exhausts_attempts_and_raises(self):
        import gembridge.gemini as gem

        client, idx = self._mock_httpx([METADATA_ONLY_RESPONSE] * 10)
        with mock.patch.object(gem, "_get_httpx_client", lambda: client), \
             mock.patch.object(gem.time, "sleep"):
            with self.assertRaises(RuntimeError):
                list(generate_stream("hello", 1, 4))


if __name__ == "__main__":
    unittest.main()