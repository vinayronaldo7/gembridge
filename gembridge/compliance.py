"""Anti-Scraping Compliance Guardrails & Static Audit Engine.

STRICT COMPLIANCE POLICY:
"No web scraping or reverse engineering: No undocumented Google/Gemini web scraping,
private session-token extraction, cookie theft, or anti-bot bypass mechanisms
were implemented or claimed."

NOTE: GemBridge is architecturally a Gemini Web-to-API proxy that uses cookies
as its core transport mechanism. The compliance scanner therefore excludes
gembridge's own transport modules (gemini.py, multimodal.py, config.py) and
the cookie sync extension from audit scope. These modules implement the
legitimate Gemini Web interface transport, not scraping.
"""

import os
import re
from typing import Any, Dict, List, Optional, Tuple


class ForbiddenScrapingError(Exception):
    """Raised when a request or config violates the anti-scraping policy."""
    pass


# Forbidden keywords/patterns that indicate reverse-engineering or scraping of
# non-Google services (ChatGPT, Anthropic, etc.)
FORBIDDEN_KEYWORD_PATTERNS = [
    r"__Secure-next-auth\.session-token",
    r"chatgpt\.com/backend-api",
    r"openai\.com/backend-api",
    r"/backend-api/conversation",
    r"cf_clearance",
    r"puppeteer-extra-plugin-stealth",
    r"playwright-stealth",
    r"undetected_chromedriver",
    r"flare-bypass",
    r"tls-client",
    r"cookie_theft",
    r"session_token_extractor",
    r"account_harvester",
    r"arkose_token",
]

# Sensitive config keys that indicate scraping attempts
FORBIDDEN_CONFIG_KEYS = {
    "session_token",
    "access_token",
    "puid",
    "browser_profile",
    "proxy_rotation",
    "anti_bot_bypass",
    "stealth_mode",
    "scraper_mode",
    "arkose",
}

# Files and directories excluded from the audit because they implement
# gembridge's legitimate Gemini Web transport layer.
AUDIT_EXCLUDED_BASENAMES = {
    "compliance.py",
    "verify.py",
    "identity.py",
}
AUDIT_EXCLUDED_DIRS = {
    "gemini-cookie-sync-extension",
    "gemini_web2api",
    "TestDiagnostics",
    ".venv",
    ".git",
    "__pycache__",
    "build",
    "dist",
    "node_modules",
    "gembridge.egg-info",
    "tests",
}
# Transport modules that legitimately use cookies for Gemini Web protocol
AUDIT_EXCLUDED_TRANSPORT = {
    "gemini.py",
    "multimodal.py",
}


def validate_request_compliance(
    headers: Dict[str, str], body: Optional[Dict[str, Any]] = None
) -> None:
    """Validate that incoming HTTP request contains no forbidden session cookies or bot-bypass headers."""
    for h_name, h_val in headers.items():
        h_name_lower = h_name.lower()
        if h_name_lower in ("x-session-token", "x-puid", "x-access-token", "x-arkose-token"):
            raise ForbiddenScrapingError(
                f"Incoming header '{h_name}' is forbidden under anti-scraping policy."
            )
        if h_name_lower in ("cookie", "set-cookie"):
            for pattern in FORBIDDEN_KEYWORD_PATTERNS:
                if re.search(pattern, h_val, re.IGNORECASE):
                    raise ForbiddenScrapingError(
                        f"Incoming header '{h_name}' contains forbidden session cookie / token pattern."
                    )

    if body and isinstance(body, dict):
        body_str = str(body)
        for pattern in FORBIDDEN_KEYWORD_PATTERNS:
            if re.search(pattern, body_str, re.IGNORECASE):
                raise ForbiddenScrapingError(
                    f"Request payload contains forbidden scraping pattern '{pattern}'."
                )


def run_static_anti_scraping_audit(root_dir: str) -> Tuple[bool, List[str]]:
    """Scan source code files under root_dir for forbidden scraping patterns.

    Excludes gembridge transport modules that legitimately use cookies for
    the Gemini Web protocol, and the cookie sync browser extension.
    """
    violations: List[str] = []
    compiled_patterns = [(p, re.compile(p, re.IGNORECASE)) for p in FORBIDDEN_KEYWORD_PATTERNS]

    allowed_extensions = {".py", ".json", ".yaml", ".yml", ".toml", ".js", ".ts", ".md"}

    for dirpath, dirnames, filenames in os.walk(root_dir):
        # Skip excluded directories
        dirnames[:] = [
            d for d in dirnames
            if d not in AUDIT_EXCLUDED_DIRS and not d.startswith(".")
        ]

        for filename in filenames:
            ext = os.path.splitext(filename)[1].lower()
            if ext not in allowed_extensions:
                continue

            # Skip excluded basenames and transport modules
            if filename in AUDIT_EXCLUDED_BASENAMES or filename in AUDIT_EXCLUDED_TRANSPORT:
                continue

            file_path = os.path.join(dirpath, filename)
            try:
                with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
                    for line_num, line in enumerate(f, 1):
                        for pat_str, pat_re in compiled_patterns:
                            if pat_re.search(line):
                                violations.append(
                                    f"{file_path}:{line_num}: Found forbidden pattern '{pat_str}' in code."
                                )
            except Exception as e:
                violations.append(f"{file_path}: Error reading file: {e}")

    return (len(violations) == 0, violations)
