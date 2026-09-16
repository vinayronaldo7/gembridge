# GemBridge Migration Plan

**Date**: 2026-09-15
**Status**: Design (Read-Only — No Files Modified)
**Author**: Senior Software Architect
**Reference**: AUDIT_REPORT.md

---

## A. Final Identity Map

Each old identity element mapped to its new form with required action.

| # | Layer | Old Name | New Name | Action Required | Priority |
|---|-------|----------|----------|----------------|----------|
| 1 | Project Display Name | Gemini Web2API | GemBridge | Update all docs, headers, descriptions | HIGH |
| 2 | Repository Directory | gemini-web2api | gembridge | Git remote rename, folder rename | HIGH |
| 3 | Python Distribution Name | gemini-web2api | gembridge | Update pyproject.toml | CRITICAL |
| 4 | Python Import Namespace | gemini_web2api | gembridge | Move package + create shim | CRITICAL |
| 5 | Root Script | gemini_web2api.py | gembridge.py | Rename + create wrapper | HIGH |
| 6 | CLI Entry Point | gemini-web2api | gembridge | Update pyproject.scripts | HIGH |
| 7 | Config Directory | ~/.config/gemini-web2api/ | ~/.config/gembridge/ | Update code + migration logic | MEDIUM |
| 8 | Config Env Variable | GEMINI_WEB2API_CONFIG | GEM_BRIDGE_CONFIG | Update code (with fallback) | MEDIUM |
| 9 | Docker Image/Container | gemini-web2api | gembridge | Update Dockerfile + compose | MEDIUM |
| 10 | Extension Folder | gemini-cookie-sync-extension | (unchanged) | Update internal references only | LOW |
| 11 | Version String | gemini-web2api v1.1.0 | GemBridge v1.1.0 | Update __version__ print/arg | LOW |
| 12 | Git Remote URL | github.com/Sophomoresty/gemini-web2api.git | github.com/Sophomoresty/gembridge.git | git remote set-url | HIGH |
| 13 | Original Attribution | gemini-web2api (project name) | gemini-web2api (original project name) | PRESERVE in attribution text | CRITICAL |

**Critical Constraint**: Model names (`gemini-3.5-flash`, `gemini-3.6-flash`, `gemini-3.7-flash`, `gemini-3.8-flash`) are NEVER renamed — they are Google model identifiers, not project identifiers. All mappings, modes, think values, and request payload behaviors for these models remain 100% unchanged.

---

## B. Package Migration Architecture

### Before (Current)

```
gemini-web2api/
├── gemini_web2api.py              # Standalone script (1112 lines)
├── gemini_web2api/                # Python package
│   ├── __init__.py
│   ├── __main__.py
│   ├── config.py
│   ├── gemini.py
│   ├── models.py
│   ├── server.py
│   ├── tools.py
│   └── multimodal.py
├── tests/
│   ├── __init__.py
│   └── test_modular_sync.py
├── cloudflare/
├── gemini-cookie-sync-extension/
├── pyproject.toml
├── Dockerfile
├── docker-compose.local.yml
├── README.md
├── README_CN.md
├── requirements.txt
├── config.json
├── config.example.json
├── logo.png
└── LICENSE
```

### After (Target)

```
gembridge/
├── gembridge.py                   # Thin compatibility launcher
├── gemini_web2api.py              # COMPATIBILITY SHIM (new, ~10 lines)
├── gemini_web2api/                # COMPATIBILITY SHIM package (new)
│   └── __init__.py                # Forwarding shim (~20 lines)
├── gembridge/                     # Primary Python package (moved from gemini_web2api/)
│   ├── __init__.py                # Updated
│   ├── __main__.py                # Updated
│   ├── config.py                  # Updated (config paths)
│   ├── gemini.py                  # Updated (minor)
│   ├── models.py                  # Unchanged
│   ├── server.py                  # Unchanged
│   ├── tools.py                   # Updated (minor)
│   └── multimodal.py              # Unchanged
├── tests/
│   ├── __init__.py                # Updated
│   └── test_modular_sync.py       # Updated (new imports)
├── cloudflare/                    # Updated (display names)
├── gemini-cookie-sync-extension/  # Updated (internal refs)
├── pyproject.toml                 # Updated
├── Dockerfile                     # Updated
├── docker-compose.local.yml       # Updated
├── README.md                      # Updated
├── README_CN.md                   # Preserved (Chinese, minimal updates)
├── requirements.txt               # Unchanged
├── config.json                    # Unchanged (format preserved)
├── config.example.json            # Unchanged (format preserved)
├── logo.png                       # Unchanged
└── LICENSE                        # Unchanged (MIT, no author)
```

---

## C. Compatibility Strategy

### C.1 Can `gemini_web2api` and `gembridge` Safely Coexist?

**Yes.** The dual-package strategy uses a forwarding shim:

- `gembridge/` is the **primary** package containing all real code
- `gemini_web2api/` is a **dead-simple forwarding shim** (~20 lines) that re-exports everything from `gembridge`
- Both coexist in the same directory without ambiguity because Python resolves imports by exact module name
- The shim emits `DeprecationWarning` on import to notify users

### C.2 How Are Relative Imports, Script Usage, and pip Affected?

| Scenario | Mechanism | Behavior |
|----------|-----------|----------|
| `from gembridge.config import CONFIG` | Direct import | Works immediately, primary path |
| `from gemini_web2api.config import CONFIG` | Shim re-export | Works with DeprecationWarning |
| `python gembridge.py` | Launcher | Delegates to gembridge package, equivalent to `python -m gembridge` |
| `python gemini_web2api.py` | Shim wrapper | Works with DeprecationWarning, calls gembridge.main() |
| `python -m gembridge` | Package __main__ | Works immediately, primary path |
| `python -m gemini_web2api` | Shim __main__ | Works with DeprecationWarning |
| `pip install .` | pyproject.toml | Installs `gembridge` package + CLI |
| `pip install .[streaming]` | Optional deps | httpx installed, same as before |
| `gemini-web2api` CLI | pyproject.scripts | **Removed** (replaced by `gembridge`) |
| `gembridge` CLI | pyproject.scripts | **New** entry point |

### C.3 Shim Implementation Details

**`gemini_web2api/__init__.py`** (compatibility shim):
- Emits DeprecationWarning
- Re-exports all public names from `gembridge` submodules
- Registers submodules in `sys.modules` so `mock.patch("gemini_web2api.server.generate")` works correctly

**`gemini_web2api.py`** (compatibility shim):
- Emits DeprecationWarning
- Imports and calls `gembridge.__main__.main()` or the new `gembridge.main()`
- Preserves shebang line

### C.4 Config Path Transition

The config path changes from `~/.config/gemini-web2api/` to `~/.config/gembridge/`. To avoid breaking existing users:

1. New code writes/reads from `~/.config/gembridge/`
2. If `~/.config/gembridge/config.json` doesn't exist, fall back to `~/.config/gemini-web2api/config.json`
3. On first successful read from old location, auto-migrate to new location
4. Env var `GEMINI_WEB2API_CONFIG` still works (explicit path takes precedence)
5. New env var `GEM_BRIDGE_CONFIG` is the primary replacement

### C.5 Impact Assessment

| Area | Impact | Mitigation |
|------|--------|------------|
| Existing `pip install gemini-web2api` | Users must `pip install gembridge` | README + upgrade guide |
| Existing `python gemini_web2api.py` | Works via shim with warning | Auto-migrate on next run |
| Existing `python -m gemini_web2api` | Works via shim with warning | Auto-migrate on next run |
| Existing config files at `~/.config/gemini-web2api/` | Auto-detected and migrated | Fallback + migration logic |
| Existing `import gemini_web2api` | Works via shim with warning | DeprecationWarning guides migration |
| Test suite | Must update imports | New test imports use `gembridge.*` |
| Docker images | Image name changes | New image: `gembridge` |
| CI/CD pipelines | Docker action uses `github.repository` variable | Auto-adapts on GitHub rename |

### C.6 Deprecated Elements

The following will be marked as deprecated and scheduled for removal in v2.0:

1. `gemini_web2api/` package — emits DeprecationWarning on import
2. `gemini_web2api.py` script — emits DeprecationWarning on execution
3. `gemini-web2api` CLI command — removed from pyproject.scripts
4. `GEMINI_WEB2API_CONFIG` env var — falls back to `GEM_BRIDGE_CONFIG`
5. `~/.config/gemini-web2api/` config dir — falls back to `~/.config/gembridge/`
6. `python -m gemini_web2api` — works via shim with warning
7. `python gemini_web2api.py` — works via shim with warning

---

## D. File-by-File Change Plan

### D.1 New Files

| File | Description | Lines | Risk |
|------|-------------|-------|------|
| `gembridge/__init__.py` | Primary package init (renamed from gemini_web2api/__init__.py) | 2 | LOW |
| `gembridge/__main__.py` | Package entry point (renamed from gemini_web2api/__main__.py) | 51 | LOW |
| `gembridge/config.py` | Config management (renamed from gemini_web2api/config.py) | 38 | LOW |
| `gembridge/gemini.py` | StreamGenerate protocol (renamed from gemini_web2api/gemini.py) | 280 | LOW |
| `gembridge/models.py` | Model definitions (renamed from gemini_web2api/models.py) | 72 | LOW |
| `gembridge/server.py` | HTTP server (renamed from gemini_web2api/server.py) | 596 | LOW |
| `gembridge/tools.py` | Tool calling (renamed from gemini_web2api/tools.py) | 344 | LOW |
| `gembridge/multimodal.py` | Multimodal upload (renamed from gemini_web2api/multimodal.py) | 175 | LOW |
| `gembridge.py` | Thin compatibility launcher (renamed from gemini_web2api.py) | ~10 | LOW |
| `gemini_web2api/__init__.py` | **NEW** — Compatibility shim | ~20 | MEDIUM |
| `gemini_web2api.py` | **NEW** — Compatibility shim wrapper | ~10 | MEDIUM |

### D.2 Modified Files

| File | Changes | Risk | Rationale |
|------|---------|------|-----------|
| `pyproject.toml` | name, scripts, description | CRITICAL | pip/publish breaks without this |
| `Dockerfile` | COPY path, CMD module | MEDIUM | Docker build breaks without this |
| `docker-compose.local.yml` | service name, container_name | MEDIUM | Compose stack name changes |
| `tests/__init__.py` | Docstring update | LOW | Accuracy |
| `tests/test_modular_sync.py` | Import paths + mock paths | CRITICAL | All tests fail without this |
| `README.md` | H1, alt text, CLI commands, Docker, branding | HIGH | User documentation accuracy |
| `README_CN.md` | H1, alt text (minimal) | LOW | Chinese doc accuracy |
| `cloudflare/README.MD` | Title, description, attribution, version history | MEDIUM | Deployment docs |
| `cloudflare/worker.js` | Header comment, attribution lines | MEDIUM | Deployment artifact |
| `gemini-cookie-sync-extension/manifest.json` | Description text | LOW | Extension metadata |
| `gemini-cookie-sync-extension/popup.js` | Instruction text in export message | LOW | User-facing string |
| `gemini-cookie-sync-extension/SETUP.md` | References to project path | LOW | Setup instructions |
| `.github/workflows/docker.yml` | None (uses github.repository variable) | NONE | Auto-adapts |
| `.dockerignore` | None | NONE | No project name references |
| `.gitignore` | None | NONE | No project name references |
| `config.example.json` | None | NONE | Config format unchanged |
| `config.json` | None | NONE | Config format unchanged |
| `requirements.txt` | None | NONE | No project name references |
| `LICENSE` | None | NONE | MIT, no name references |
| `logo.png` | None | NONE | Binary, not editable |

### D.3 Detailed Change Specifications

**`pyproject.toml`**:
- Line 2: `name = "gemini-web2api"` → `name = "gembridge"`
- Line 3: `version` unchanged
- Line 4: `description` updated to reference GemBridge
- Line 14: `gemini-web2api = "gemini_web2api.__main__:main"` → `gembridge = "gembridge.__main__:main"`
- Add: `gemini-web2api = { callable = "gemini_web2api.__main__:main", deprecated = true }` (alias, optional)

**`Dockerfile`**:
- Line 6: `COPY gemini_web2api/ ./gemini_web2api/` → `COPY gembridge/ ./gembridge/`
- Line 10: `CMD ["python", "-m", "gemini_web2api", ...]` → `CMD ["python", "-m", "gembridge", ...]`

**`docker-compose.local.yml`**:
- Line 2: `gemini-web2api:` → `gembridge:`
- Line 4: `container_name: gemini-web2api` → `container_name: gembridge`

**`tests/__init__.py`**:
- Line 1: `"""Tests for gemini-web2api."""` → `"""Tests for GemBridge."""`

**`tests/test_modular_sync.py`**:
- Lines 9-14: All `from gemini_web2api.*` → `from gembridge.*`
- Line 194+: All `@mock.patch("gemini_web2api.*")` → `@mock.patch("gembridge.*")`

**`gembridge.py`** (renamed from gemini_web2api.py, converted to thin launcher):
- Replaced 1112-line standalone implementation with thin wrapper
- Now delegates to `gembridge.__main__.main()`
- No business logic — no CONFIG, MODELS, server, streaming, or auth code
- Equivalent behavior to `python -m gembridge`

**`gemini_web2api.py`** (NEW shim):
```python
#!/usr/bin/env python3
import warnings
warnings.warn(
    "'gemini_web2api.py' is deprecated. Use 'gembridge' instead. "
    "Will be removed in v2.0.",
    DeprecationWarning, stacklevel=2
)
from gembridge import main
raise SystemExit(main())
```

**`gemini_web2api/__init__.py`** (NEW shim):
```python
import sys
import warnings
import gembridge

warnings.warn(
    "Package 'gemini_web2api' is deprecated. Use 'gembridge' instead. "
    "Will be removed in v2.0.",
    DeprecationWarning, stacklevel=2
)

# Re-export all submodules
import gembridge.config
import gembridge.models
import gembridge.server
import gembridge.gemini
import gembridge.tools
import gembridge.multimodal

# Register in sys.modules for mock.patch compatibility
sys.modules['gemini_web2api'] = gembridge
sys.modules['gemini_web2api.config'] = gembridge.config
sys.modules['gemini_web2api.models'] = gembridge.models
sys.modules['gemini_web2api.server'] = gembridge.server
sys.modules['gemini_web2api.gemini'] = gembridge.gemini
sys.modules['gemini_web2api.tools'] = gembridge.tools
sys.modules['gemini_web2api.multimodal'] = gembridge.multimodal

# Re-export public names
from gembridge.config import CONFIG, DEFAULT_CONFIG, load_config, find_config
from gembridge.models import MODELS, resolve_model
from gembridge.server import GeminiHandler, ThreadedServer
from gembridge.tools import google_contents_to_prompt, messages_to_prompt
from gembridge.multimodal import detect_image_mime, fetch_image_bytes, upload_image

__version__ = gembridge.__version__
```

**`gembridge/config.py`** (modified from gemini_web2api/config.py):
- Line 35: Config path updated with fallback logic:
  ```python
  CONFIG_DIRS = [
      os.path.expanduser("~/.config/gembridge"),
      os.path.expanduser("~/.config/gemini-web2api"),  # deprecated fallback
  ]
  ```

**`gembridge/__main__.py`** (modified):
- Line 1: Docstring updated
- Line 13: Description updated
- Line 18: Version string updated
- Line 21: `GEMINI_WEB2API_CONFIG` → `GEM_BRIDGE_CONFIG` (with env var fallback)
- Line 34: Print statement updated

**`README.md`**:
- Line 1: `# gemini-web2api` → `# GemBridge`
- Line 4: alt text updated
- Line 9: Attribution preserved verbatim
- CLI examples: `python gemini_web2api.py` → `python gembridge.py`
- Docker examples: image name updated
- All model names UNCHANGED

**`cloudflare/worker.js`**:
- Line 2: Title updated
- Lines 146-147: Attribution preserved (original project name stays)

**`cloudflare/README.MD`**:
- Line 1: Title updated
- Line 5: Description updated
- Line 293: Changelog entry preserved (historical accuracy)
- Line 299: Attribution preserved (original project reference)

---

## E. Migration Order

### Phase 1: Infrastructure (No User Impact)

**Step 1.1**: Rename directory and update Git remote
```bash
git mv gemini-web2api gembridge
git remote set-url origin https://github.com/Sophomoresty/gembridge.git
```

**Step 1.2**: Update pyproject.toml (package metadata)
- Change name, scripts, description
- Rationale: Prepares pip installation for new name

**Step 1.3**: Update Dockerfile and docker-compose.local.yml
- Update COPY paths and CMD instructions
- Rationale: Docker builds need new paths before next build

### Phase 2: Core Package Migration (High Impact, Shimmed)

**Step 2.1**: Move package contents
```bash
git mv gembridge/gemini_web2api gembridge/gembridge
```

**Step 2.2**: Create compatibility shim package
- Create `gembridge/gemini_web2api/__init__.py` with forwarding logic
- Rationale: Existing `import gemini_web2api` continues to work

**Step 2.3**: Convert standalone script to thin launcher
- Overwrite `gembridge/gembridge.py` with thin wrapper that delegates to `gembridge.__main__.main()`
- Rationale: Eliminates duplicate implementation; all logic lives in `gembridge/` package

**Step 2.4**: Create compatibility shim script
- Create `gembridge/gemini_web2api.py` wrapper
- Rationale: Existing `python gemini_web2api.py` continues to work

**Step 2.5**: No action required
- `gembridge.py` is now a thin launcher with no internal imports
- All business logic resides in `gembridge/` package

### Phase 3: Tests and Verification

**Step 3.1**: Update test imports
- Update `tests/test_modular_sync.py` all imports to `gembridge.*`
- Update all `@mock.patch` paths to `gembridge.*`
- Rationale: Tests must run against new package

**Step 3.2**: Update tests/__init__.py docstring

**Step 3.3**: Run full test suite
- `python -m pytest tests/` or `python -m unittest tests.test_modular_sync`
- Rationale: Verify all functionality preserved

### Phase 4: Documentation and Infrastructure

**Step 4.1**: Update README.md
- H1, alt text, CLI commands, Docker commands, attribution
- Rationale: User-facing documentation

**Step 4.2**: Update cloudflare/README.MD
- Title, description, changelog attribution
- Rationale: Deployment documentation

**Step 4.3**: Update cloudflare/worker.js header
- Title, attribution lines
- Rationale: Deployment artifact accuracy

**Step 4.4**: Update extension metadata
- manifest.json, popup.js, SETUP.md references
- Rationale: Extension accuracy

**Step 4.5**: Update README_CN.md (minimal)
- H1 and alt text only
- Rationale: Chinese documentation alignment

### Phase 5: Config Path Migration Logic

**Step 5.1**: Implement config path fallback in gembridge/config.py
- Primary: `~/.config/gembridge/`
- Fallback: `~/.config/gemini-web2api/`
- Auto-migrate on successful read
- Rationale: Zero-downtime config migration for users

**Step 5.2**: Implement env var fallback in gembridge/__main__.py
- Primary: `GEM_BRIDGE_CONFIG`
- Fallback: `GEMINI_WEB2API_CONFIG`
- Rationale: Backward compatibility for scripts/automation

---

## F. Validation Plan

### F.1 Python Unit Tests
```bash
cd gembridge && python -m unittest tests.test_modular_sync -v
```
**Pass Criteria**: All tests pass with 0 failures, 0 errors.
**Coverage**: Payload construction, message parsing, streaming, model resolution, image upload, SSE event sequences, function calling.

### F.2 Import Compatibility Tests
```bash
# Primary imports (must work)
python -c "from gembridge.config import CONFIG; print('OK')"
python -c "import gembridge; print(gembridge.__version__)"
python -c "from gembridge.models import resolve_model; print(resolve_model('gemini-3.8-flash'))"

# Legacy imports (must work with warning)
python -W all -c "import gemini_web2api" 2>&1 | grep DeprecationWarning
python -c "from gemini_web2api.config import CONFIG; print('OK')"

# Legacy script (must work with warning)
python -W all gemini_web2api.py --version 2>&1 | grep DeprecationWarning
python gemini_web2api.py --version 2>&1 | grep -v DeprecationWarning | grep "GemBridge"
```
**Pass Criteria**: Primary imports silent; legacy imports emit DeprecationWarning; all resolve correctly.

### F.3 CLI Tests
```bash
gembridge --version          # Must output "GemBridge v1.1.0"
gembridge --help             # Must show help with correct description
python gembridge.py --version # Must output "GemBridge v1.1.0"
python gembridge.py --help    # Must show help
```
**Pass Criteria**: Version string shows "GemBridge"; help text accurate.

### F.4 API Tests (Server Startup)
```bash
# Start server in background
python gembridge.py --port 18081 &
sleep 3
# Test health endpoint
curl -s http://localhost:18081/v1/models
# Test chat completions
curl -s -X POST http://localhost:18081/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"gemini-3.8-flash","messages":[{"role":"user","content":"hello"}]}'
kill %1
```
**Pass Criteria**: Server starts; endpoints respond; model names resolve correctly.

### F.5 Streaming Tests
```bash
curl -s -N -X POST http://localhost:18081/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"gemini-3.8-flash","messages":[{"role":"user","content":"hello"}],"stream":true}' | head -20
```
**Pass Criteria**: SSE stream with `data: ` events; `Content-Type: text/event-stream`.

### F.6 Gemini 3.8 Compatibility Tests
```python
# Verify model resolution (must be unchanged)
from gembridge.models import resolve_model
name, mode, think, error, extra = resolve_model("gemini-3.8-flash")
assert name == "gemini-3.8-flash" and mode == 1 and think == 4

name, mode, think, error, extra = resolve_model("gemini-3.8-flash@think=2")
assert name == "gemini-3.8-flash" and mode == 1 and think == 2

name, mode, think, error, extra = resolve_model("gemini-3.7-flash")
assert name == "gemini-3.7-flash" and mode == 1 and think == 4

name, mode, think, error, extra = resolve_model("gemini-3.6-flash")
assert name == "gemini-3.6-flash" and mode == 1 and think == 4

name, mode, think, error, extra = resolve_model("gemini-3.5-flash")
assert name == "gemini-3.5-flash" and mode == 1 and think == 4

# Verify payload mode category [79] (must be 1 = FAST for flash models)
from gembridge.gemini import _build_payload
inner = _decode_payload(_build_payload("hello", 1, 4))
assert inner[79] == 1
```
**Pass Criteria**: All model names resolve identically; payload structures unchanged.

### F.7 Kilo Code Compatibility
- Verify `gembridge` directory is recognized by Kilo Code (check `.kilo/kilo.jsonc` schema)
- Verify no Kilo Code config files reference old package name
- Verify agent sessions can locate and execute `gembridge.py`
**Pass Criteria**: Kilo Code loads project without errors; all file paths resolve.

### F.8 Docker Tests
```bash
cd gembridge && docker build -t gembridge . && docker run -d --name gembridge-test -p 18081:8081 gembridge
sleep 5
curl -s http://localhost:18081/v1/models
docker stop gembridge-test && docker rm gembridge-test
```
**Pass Criteria**: Image builds; container starts; API responds.

### F.9 Cloudflare Worker Tests
```bash
# Verify worker.js syntax
node -c cloudflare/worker.js
# Verify no Chinese in code comments (read-only check)
rg '[\u4e00-\u9fff]' cloudflare/worker.js --output
```
**Pass Criteria**: Syntax valid; remaining Chinese only in string literals/JSON examples.

### F.10 Git Diff Audit
```bash
cd gembridge && git diff --stat
cd gembridge && git status
cd gembridge && git diff --name-only
```
**Pass Criteria**: All expected files modified/renamed; no unexpected changes; no binary files modified (except logo.png which is unchanged).

---

## G. Rollback Plan

### G.1 Immediate Rollback (Within Same Commit)

Since all changes are in a single migration commit, rollback is a single revert:

```bash
cd gembridge
git revert HEAD --no-edit
# OR
git reset --hard HEAD~1
```

### G.2 Selective Rollback (Partial Failures)

If only certain aspects fail, selectively restore:

```bash
# Restore old package
git checkout HEAD~1 -- gemini_web2api/
# Restore old script
git checkout HEAD~1 -- gemini_web2api.py
# Restore pyproject.toml
git checkout HEAD~1 -- pyproject.toml
# Restore Docker config
git checkout HEAD~1 -- Dockerfile docker-compose.local.yml
# Restore tests
git checkout HEAD~1 -- tests/test_modular_sync.py
```

### G.3 Database/Config Migration Rollback

If config auto-migration has migrated `~/.config/gemini-web2api/config.json` → `~/.config/gembridge/config.json`:

```bash
# Reverse migration
mv ~/.config/gembridge/config.json ~/.config/gemini-web2api/config.json
rmdir ~/.config/gembridge 2>/dev/null
```

### G.4 Rollback Verification

After rollback:
```bash
python gemini_web2api.py --version    # Must work
python -m gemini_web2api --help       # Must work
pip uninstall gembridge               # Remove new package
pip install gemini-web2api            # Reinstall old (if published)
python -m pytest tests/               # Tests must pass
```

### G.5 Rollback Communication

- Document rollback procedure in README under "Rollback" section
- Notify all users via project changelog/announcement
- Maintain old package on PyPI for 30 days minimum

---

## H. Final Expected Repository Structure

```
gembridge/
├── gembridge/                           # Primary Python package
│   ├── __init__.py                      # "GemBridge: Gemini Web to OpenAI API proxy."
│   ├── __main__.py                      # Entry point: python -m gembridge
│   ├── config.py                        # Config management (~/.config/gembridge/)
│   ├── gemini.py                        # StreamGenerate protocol
│   ├── models.py                        # Model definitions (gemini-3.5/3.6/3.7/3.8-flash)
│   ├── server.py                        # HTTP server, API endpoints
│   ├── tools.py                         # Tool calling, message parsing
│   └── multimodal.py                    # Image upload, Scotty protocol
├── gemini_web2api/                      # COMPATIBILITY SHIM (deprecated)
│   └── __init__.py                      # Forwarding shim with DeprecationWarning
├── tests/
│   ├── __init__.py                      # "Tests for GemBridge."
│   └── test_modular_sync.py             # Updated imports (gembridge.*)
├── cloudflare/
│   ├── worker.js                        # Updated header, preserved attribution
│   └── README.MD                        # Updated title and descriptions
├── gemini-cookie-sync-extension/
│   ├── manifest.json                    # Updated description
│   ├── popup.js                         # Updated instruction text
│   ├── popup.html                       # Unchanged
│   ├── README.txt                       # Unchanged
│   └── SETUP.md                         # Updated project references
├── gembridge.py                         # Thin compatibility launcher
├── gemini_web2api.py                    # COMPATIBILITY SHIM (deprecated)
├── pyproject.toml                       # name="gembridge", scripts updated
├── Dockerfile                           # COPY gembridge/, CMD python -m gembridge
├── docker-compose.local.yml             # service: gembridge
├── README.md                            # H1: # GemBridge
├── README_CN.md                         # Minimal updates (H1 only)
├── requirements.txt                     # Unchanged
├── config.json                          # Unchanged format
├── config.example.json                  # Unchanged format
├── logo.png                             # Unchanged
├── LICENSE                              # Unchanged (MIT)
├── .gitignore                           # Unchanged
├── .dockerignore                        # Unchanged
└── .github/workflows/docker.yml         # Unchanged (auto-adapts)
```

---

## I. Risk Assessment

### CRITICAL
| ID | Risk | Probability | Impact | Mitigation |
|----|------|-------------|--------|------------|
| C1 | `pip install` breakage — users cannot install package by old name | High | High | Release `gembridge` on PyPI; maintain `gemini-web2api` as deprecated alias for 12 months |
| C2 | All tests fail due to import path changes | High | High | Shim package ensures `import gemini_web2api` still works during transition; tests updated to use `gembridge.*` |
| C3 | Docker build fails due to wrong COPY path | High | High | Dockerfile updated in same release; CI auto-adapts via `github.repository` |
| C4 | Original project attribution lost | Medium | Critical | Attribution text explicitly preserved in README and cloudflare docs |

### HIGH
| ID | Risk | Probability | Impact | Mitigation |
|----|------|-------------|--------|------------|
| H1 | Existing users' `import gemini_web2api` breaks | Medium | High | Compatibility shim package prevents breakage |
| H2 | `python gemini_web2api.py` fails for existing users | Medium | High | Shim script with DeprecationWarning |
| H3 | Config file not found at old path | Medium | High | Fallback logic in config.py reads both locations |
| H4 | Automation scripts using `gemini-web2api` CLI break | Medium | High | Update pyproject.scripts; consider maintaining old CLI as alias |
| H5 | Git remote URL stale after repo rename | High | Medium | Document `git remote set-url` in migration guide |

### MEDIUM
| ID | Risk | Probability | Impact | Mitigation |
|----|------|-------------|--------|------------|
| M1 | `mock.patch("gemini_web2api.*")` paths fail in tests | Medium | Medium | shim registers modules in sys.modules |
| M2 | `GEMINI_WEB2API_CONFIG` env var no longer recognized | Medium | Medium | Fallback to old env var name implemented |
| M3 | Docker Compose stack name changes | Medium | Medium | Update docker-compose file; document breaking change |
| M4 | Extension users confused by name change | Medium | Medium | Extension folder name unchanged; only internal text updated |
| M5 | Kilo Code project config needs refresh | Medium | Medium | .kilo config uses no hardcoded paths; auto-refreshes |

### LOW
| ID | Risk | Probability | Impact | Mitigation |
|----|------|-------------|--------|------------|
| L1 | Version string display changes | High | Low | Cosmetic only; no functional impact |
| L2 | README_CN.md H1 updated | High | Low | Minimal change; Chinese content preserved |
| L3 | Docker image tag name changes | High | Low | Standard rebuild; documented |
| L4 | Changelog reference to old name in cloudflare/README.MD | High | Low | Preserved for historical accuracy |

---

## J. Expert Recommendation

### Evaluation of Option C (Hybrid) from AUDIT_REPORT.md

**Option C as described in the audit report recommends**: renaming the package directory, renaming the root script, updating all imports, updating config paths, updating env vars, updating Docker, updating display names, and preserving attribution, with an optional compatibility shim.

### Recommendation: Implement Option C with Modifications

**Option C should be implemented, but with the following critical modifications**:

#### Modification 1: Shim is NOT optional — it is MANDATORY

The audit recommends the compatibility shim as optional. **This is incorrect.** Without a shim, every existing user of `import gemini_web2api`, `python gemini_web2api.py`, and `python -m gemini_web2api` will experience immediate breakage. The shim must be included in v1.1.0 release to ensure zero-downtime migration.

#### Modification 2: Deprecation timeline must be explicit

The shim must include a clear deprecation timeline:
- **v1.1.0** (current): Both `gembridge` and `gemini_web2api` work; shim emits `DeprecationWarning`
- **v1.2.0**: Shim still works but warning upgrades to `FutureWarning`
- **v2.0.0**: All `gemini_web2api` compatibility layers removed; package becomes `gembridge` only

#### Modification 3: Config path migration must be bidirectional with auto-move

The audit mentions updating config paths but does not specify migration logic. The implementation must:
1. Write to `~/.config/gembridge/` first
2. If not found, read from `~/.config/gemini-web2api/`
3. On successful read from old location, **copy** (not move, for safety) to new location
4. Log migration event for user awareness

#### Modification 4: PyPI package strategy needs dual publication

For the first release:
- Publish `gembridge` as the new package on PyPI
- Maintain `gemini-web2api` as a **metapackage** that depends on `gembridge` and emits a deprecation notice on install
- This gives `pip install gemini-web2api` users a graceful transition path

#### Modification 5: Model names are sacrosanct

The audit correctly identifies that model names (`gemini-3.5-flash`, `gemini-3.6-flash`, `gemini-3.7-flash`, `gemini-3.8-flash`) are Google's identifiers and must NEVER be renamed. The migration plan must include explicit validation that all model resolution, payload construction, and mode/think mappings remain byte-for-byte identical before and after migration. This is verified in validation step F.6.

### Stability Verdict

**Option C with the above modifications is the optimal strategy.** It achieves:
- **Zero breakage** for existing users during transition (via shim)
- **Clear migration path** (via deprecation timeline)
- **Preserved functionality** (all model behaviors unchanged)
- **Clean architecture** (primary package is `gembridge`, legacy is clearly marked)
- **Safe rollback** (single git revert restores full functionality)

The estimated implementation effort is **2-3 developer-days** for the code changes, plus **1 day** for validation and testing.

---

## Appendix: Environment Variable Mapping

| Old Variable | New Variable | Fallback Behavior |
|-------------|-------------|-------------------|
| `GEMINI_WEB2API_CONFIG` | `GEM_BRIDGE_CONFIG` | `GEM_BRIDGE_CONFIG` checked first; if absent, falls back to `GEMINI_WEB2API_CONFIG` |
| (none) | `GEM_BRIDGE_VERSION` | New: shows GemBridge version (optional, future use) |

## Appendix: API Endpoint Compatibility

All API endpoints are **unchanged**. The rename is purely identity/infrastructure:

| Endpoint | Status |
|----------|--------|
| `/v1/chat/completions` | Unchanged |
| `/v1/chat/completions` (stream) | Unchanged |
| `/v1/models` | Unchanged |
| `/v1/responses` | Unchanged |
| `/v1beta/models` | Unchanged |
| `/v1beta/models/{model}:generateContent` | Unchanged |
| `/v1beta/models/{model}:streamGenerateContent` | Unchanged |

**No client code changes required** for API consumers. Only server-side identity and infrastructure change.

---

*End of Migration Plan — GemBridge v1.1.0*
