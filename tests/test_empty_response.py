"""Regression tests for GemBridge upstream empty-response handling.

Fixtures are built programmatically to avoid Python string-escape issues
with the deeply-nested JSON that Gemini's StreamGenerate endpoint returns.
"""
import unittest
from unittest import mock

from gembridge.gemini import extract_response_text, generate_stream, _extract_texts_from_line


def _wrb_metadata_line(conversation_id, request_id, **extra):
    """Build a metadata-only wrb.fr line (inner[4] == null)."""
    import json
    inner = [null_marker(), [conversation_id, request_id], dict(extra)]
    inner_str = json.dumps(inner)
    return '[["wrb.fr",null,' + json.dumps(inner_str) + ']]'


def null_marker():
    return None


def _wrb_content_line(conversation_id, request_id, text):
    """Build a content-bearing wrb.fr line (inner[4] is a non-empty list)."""
    import json
    inner = [
        null_marker(),
        [conversation_id, request_id],
        null_marker(),
        null_marker(),
        [
            [
                "rc_test",
                [text],
                null_marker(), null_marker(), null_marker(), null_marker(),
                null_marker(), null_marker(), [1], "en",
                null_marker(), null_marker(),
                                [null_marker(), null_marker(), null_marker(), null_marker(),
                                 null_marker(), null_marker(), null_marker(), []],
                null_marker(), null_marker(), null_marker(), null_marker(),
                null_marker(), null_marker(), null_marker(), null_marker(),
                null_marker(), null_marker(), null_marker(), null_marker(),
                null_marker(), null_marker(), null_marker(), [],
                null_marker(), null_marker(), null_marker(), null_marker(),
                null_marker(), null_marker(), null_marker(), null_marker(),
                null_marker()
            ]
        ],
        null_marker(), null_marker(), "IN",
        null_marker(), null_marker(), null_marker(), null_marker(),
        null_marker(), false_marker(), null_marker(), null_marker(),
        null_marker(), null_marker(), "en",
        null_marker(), null_marker(), null_marker(), true_marker(),
        [null_marker(), [false_marker(), true_marker(), false_marker()],
         [false_marker(), false_marker(), false_marker(), false_marker(),
          false_marker(), false_marker(), false_marker()]],
        false_marker(),
        [[[[null_marker(), [null_marker(), 0, text]]]]],
        null_marker(), null_marker(), null_marker(), null_marker(),
        null_marker(), null_marker(), null_marker(), null_marker(),
        null_marker(), null_marker(), null_marker(), null_marker(),
        null_marker(), null_marker(), null_marker(), null_marker(),
        null_marker(), "3.5 Flash-Lite", true_marker(),
        [[[[1004, "Longer", 5, null_marker(), ["expand", "https://example.com", null_marker(), true_marker()]]]]],
        null_marker(), 2, null_marker(), null_marker(), null_marker(),
        null_marker(), null_marker(), null_marker(), null_marker(),
        null_marker(), null_marker(), null_marker(), null_marker(),
        null_marker(), 6, 1
    ]
    inner_str = json.dumps(inner)
    return '[["wrb.fr",null,' + json.dumps(inner_str) + ']]'


def false_marker():
    return False


def true_marker():
    return True


def _build_metadata_only_response():
    """A Gemini response containing ONLY metadata-only wrb.fr lines."""
    lines = [
        ")]}'",
        "177",
        _wrb_metadata_line("c_xxx", "r_yyy", **{"18": "r_yyy", "21": ["token"], "44": True}),
        "141",
        _wrb_metadata_line("c_xxx", "r_yyy", **{"11": ["Some Refusal"], "44": True}),
        "101",
        _wrb_metadata_line("c_xxx", "r_yyy", **{"26": "AwAAA", "44": True}),
        "101",
        _wrb_metadata_line("c_xxx", "r_yyy", **{"44": True, "46": ["c_xxx", ""], "52": []}),
        "59",
        '[["di",1234],["af.httprm",1233,"9999999999999999999",1]]',
        "27",
        '[["e",12,null,null,1234]]',
    ]
    return "\n".join(lines) + "\n"


def _build_content_bearing_response(text):
    """A Gemini response containing one content-bearing wrb.fr line."""
    lines = [
        ")]}'",
        "177",
        _wrb_metadata_line("c_xxx", "r_yyy", **{"18": "r_yyy", "21": ["t"], "44": True}),
        "1479",
        _wrb_content_line("c_xxx", "r_yyy", text),
    ]
    return "\n".join(lines) + "\n"


METADATA_ONLY_RESPONSE = _build_metadata_only_response()
CONTENT_BEARING_RESPONSE = _build_content_bearing_response("Hello world")


class ExtractResponseTextTests(unittest.TestCase):
    def test_metadata_only_response_raises_runtime_error(self):
        with self.assertRaises(RuntimeError) as ctx:
            extract_response_text(METADATA_ONLY_RESPONSE)
        self.assertIn("no text content", str(ctx.exception))

    def test_content_bearing_response_returns_text(self):
        result = extract_response_text(CONTENT_BEARING_RESPONSE)
        self.assertEqual(result, "Hello world")

    def test_empty_raw_string_raises(self):
        with self.assertRaises(RuntimeError):
            extract_response_text("")

    def test_whitespace_only_response_raises(self):
        with self.assertRaises(RuntimeError):
            extract_response_text("   \n\n\n  ")


class GenerateStreamEmptyTests(unittest.TestCase):
    """generate_stream must raise when upstream yields zero text deltas."""

    def _mock_httpx_empty(self):
        """Return a mock httpx client whose stream yields no text deltas."""
        empty_raw = METADATA_ONLY_RESPONSE

        class _Resp:
            def raise_for_status(self):
                pass

            def iter_text(self):
                for line in empty_raw.split("\n"):
                    yield line + "\n"

        class _Ctx:
            def __enter__(self_inner):
                return _Resp()

            def __exit__(self_inner, *a):
                pass

        class _Client:
            def stream(self_inner, method, url, **kwargs):
                return _Ctx()

        return _Client()

    def test_generate_stream_raises_on_zero_text(self):
        with mock.patch("gembridge.gemini._get_httpx_client", self._mock_httpx_empty):
            gen = generate_stream("hello", 1, 4)
            chunks = []
            with self.assertRaises(RuntimeError):
                for delta in gen:
                    chunks.append(delta)
            self.assertEqual(chunks, [])


if __name__ == "__main__":
    unittest.main()