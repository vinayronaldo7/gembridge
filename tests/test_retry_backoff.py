"""DH-11 regression tests: exponential backoff + max_no_text_retries."""
import sys
import os
import unittest
from unittest import mock

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import gembridge.gemini as gem
from gembridge.gemini import (
    generate,
    generate_stream,
    _no_text_delay,
    _is_no_text_error,
    NO_TEXT_ERROR_MESSAGE,
)
from tests.test_empty_response import (
    METADATA_ONLY_RESPONSE,
    CONTENT_BEARING_RESPONSE,
)


class NoTextDelayTests(unittest.TestCase):
    def test_exponential_growth(self):
        self.assertEqual(_no_text_delay(0), 2)    # 2 * 1
        self.assertEqual(_no_text_delay(1), 4)    # 2 * 2
        self.assertEqual(_no_text_delay(2), 8)    # 2 * 4
        self.assertEqual(_no_text_delay(3), 16)   # 2 * 8

    def test_uses_base_delay(self):
        custom = dict(gem.CONFIG)
        custom["retry_delay_sec"] = 5
        with mock.patch.object(gem, "CONFIG", custom):
            self.assertEqual(_no_text_delay(0), 5)
            self.assertEqual(_no_text_delay(2), 20)


class GenerateBudgetTests(unittest.TestCase):
    """max_no_text_retries overrides retry_attempts for the no-text path."""

    def _patch_urlopen(self, responses):
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

    def test_uses_max_no_text_retries_when_set(self):
        fake, calls = self._patch_urlopen([METADATA_ONLY_RESPONSE] * 10)
        with mock.patch.object(gem.urllib.request, "urlopen", fake), \
             mock.patch.object(gem.time, "sleep"), \
             mock.patch.dict(gem.CONFIG, {"max_no_text_retries": 5, "retry_attempts": 3}, clear=False):
            with self.assertRaises(RuntimeError):
                generate("hello", 1, 4)
        self.assertEqual(calls["count"], 5)

    def test_falls_back_to_retry_attempts_when_unset(self):
        fake, calls = self._patch_urlopen([METADATA_ONLY_RESPONSE] * 10)
        with mock.patch.object(gem.urllib.request, "urlopen", fake), \
             mock.patch.object(gem.time, "sleep"), \
             mock.patch.dict(gem.CONFIG, {"retry_attempts": 3}, clear=False):
            # remove max_no_text_retries so the fallback path is exercised
            gem.CONFIG.pop("max_no_text_retries", None)
            with self.assertRaises(RuntimeError):
                generate("hello", 1, 4)
        self.assertEqual(calls["count"], 3)

    def test_general_error_not_retried_even_with_budget(self):
        def _fake_urlopen(req, *args, **kwargs):
            raise RuntimeError("connection reset")

        with mock.patch.object(gem.urllib.request, "urlopen", _fake_urlopen):
            with self.assertRaises(RuntimeError) as ctx:
                generate("hello", 1, 4)
        self.assertIn("connection reset", str(ctx.exception))


class GenerateDelayTests(unittest.TestCase):
    """Exponential delays are applied between no-text retries."""

    def test_delays_are_exponential(self):
        import gembridge.gemini as gem

        sleeps = []

        class _FakeResp:
            def __init__(self, body):
                self._body = body.encode() if isinstance(body, str) else body
                self.status = 200

            def read(self):
                return self._body

        call_count = {"i": 0}

        def _fake_urlopen(req, *a, **k):
            body = METADATA_ONLY_RESPONSE if call_count["i"] < 2 else CONTENT_BEARING_RESPONSE
            call_count["i"] += 1
            return _FakeResp(body)

        def _fake_sleep(seconds):
            sleeps.append(seconds)

        with mock.patch.object(gem.urllib.request, "urlopen", _fake_urlopen), \
             mock.patch.object(gem.time, "sleep", _fake_sleep):
            result = generate("hello", 1, 4)
        self.assertEqual(result, "Hello world")
        self.assertEqual(sleeps, [2, 4])  # 2*1, 2*2


class GenerateStreamBudgetTests(unittest.TestCase):
    """Streaming path honours max_no_text_retries and exponential delay."""

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

    def test_stream_uses_max_no_text_retries(self):
        client, idx = self._mock_httpx([METADATA_ONLY_RESPONSE] * 10)
        with mock.patch.object(gem, "_get_httpx_client", lambda: client), \
             mock.patch.object(gem.time, "sleep"), \
             mock.patch.dict(gem.CONFIG, {"max_no_text_retries": 4, "retry_attempts": 3}, clear=False):
            with self.assertRaises(RuntimeError):
                list(generate_stream("hello", 1, 4))
        self.assertEqual(idx["i"], 4)

    def test_stream_exponential_delays(self):
        client, idx = self._mock_httpx([METADATA_ONLY_RESPONSE, CONTENT_BEARING_RESPONSE])
        sleeps = []
        with mock.patch.object(gem, "_get_httpx_client", lambda: client), \
             mock.patch.object(gem.time, "sleep", lambda s: sleeps.append(s)):
            chunks = list(generate_stream("hello", 1, 4))
        self.assertEqual("".join(chunks), "Hello world")
        self.assertEqual(sleeps, [2])  # 2 * 1


if __name__ == "__main__":
    unittest.main()