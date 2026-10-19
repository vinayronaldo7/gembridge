"""Model definitions and mapping from Gemini frontend JS source."""

# MODE_CATEGORY enum from 028-6eb337387583.js:
#   1=FAST, 2=THINKING, 3=PRO, 4=AUTO, 5=FAST_DYNAMIC_THINKING, 6=FLASH_LITE

MODELS = {
    # ── Gemini 4 Frontier ───────────────────────────────────────────────────
    "gemini-4-argon": {
        "mode": 3, "think": 4,
        "desc": "Gemini 4 Argon: Frontier multimodal code generation & fallback reasoning",
    },

    # ── Gemini 3.x Flagship & Pro ────────────────────────────────────────────
    "gemini-3.1-pro": {
        "mode": 3, "think": 4,
        "desc": "Pro model (requires cookie for real routing)",
    },
    "gemini-3.1-pro-enhanced": {
        "mode": 3, "think": 4, "extra": {31: 2, 80: 3},
        "desc": "Pro with enhanced output (experimental)",
    },
    "gemini-3.1-ultra": {
        "mode": 3, "think": 4,
        "desc": "Ultra flagship: multimodal reasoning and complex verification",
    },
    "gemini-3.5-pro": {
        "mode": 3, "think": 4,
        "desc": "Next-gen pro model with extended context window",
    },

    # ── Gemini 3.x High-Throughput & Low-Latency ────────────────────────────
    "gemini-3.8-flash": {
        "mode": 1, "think": 4,
        "desc": "Latest all-around model (Gemini 3.8 Flash)",
    },
    "gemini-3.7-flash": {
        "mode": 1, "think": 4,
        "desc": "Latest all-around model (Gemini 3.7 Flash)",
    },
    "gemini-3.6-flash": {
        "mode": 1, "think": 4,
        "desc": "All-around model (Gemini 3.6 Flash)",
    },
    "gemini-3.5-flash": {
        "mode": 1, "think": 4,
        "desc": "Alias for gemini-3.6-flash (backend upgraded)",
    },
    "gemini-3.5-flash-thinking": {
        "mode": 2, "think": 0,
        "desc": "Deep thinking mode, longest output (~20k chars)",
    },
    "gemini-3.5-flash-thinking-lite": {
        "mode": 5, "think": 0,
        "desc": "Dynamic thinking with adaptive depth",
    },

    # ── Utility Models ──────────────────────────────────────────────────────
    "gemini-auto": {
        "mode": 4, "think": 4,
        "desc": "Auto model selection",
    },
    "gemini-flash-lite": {
        "mode": 6, "think": 4,
        "desc": "Lightweight fast model",
    },

    # ── Backward-Compat Legacy Models ───────────────────────────────────────
    "gemini-2.0-flash": {
        "mode": 1, "think": 4,
        "desc": "Gemini 2.0 Flash (legacy)",
    },
    "gemini-2.0-pro-exp-02-05": {
        "mode": 3, "think": 4,
        "desc": "Gemini 2.0 Pro experimental (legacy)",
    },
    "gemini-1.5-pro": {
        "mode": 3, "think": 4,
        "desc": "Gemini 1.5 Pro (legacy)",
    },
    "gemini-1.5-flash": {
        "mode": 1, "think": 4,
        "desc": "Gemini 1.5 Flash (legacy)",
    },
}

# Convenience aliases: short names -> canonical model IDs
MODEL_ALIASES = {
    "gemini-argon": "gemini-4-argon",
    "argon": "gemini-4-argon",
    "gemini-pro": "gemini-3.1-pro",
    "gemini-flash": "gemini-3.8-flash",
    "gemini-ultra": "gemini-3.1-ultra",
}


def resolve_model(model_name: str, default: str = "gemini-3.6-flash"):
    """Resolve model name to (name, mode_id, think_mode, error, extra_fields).

    Unknown model names fall back to default rather than erroring,
    since upstream clients may request arbitrary model identifiers.
    Aliases (e.g. 'gemini-pro') are resolved to canonical IDs first.
    """
    think_override = None
    if "@think=" in model_name:
        model_name, think_str = model_name.rsplit("@think=", 1)
        try:
            think_override = int(think_str)
        except ValueError:
            return None, None, None, f"Invalid think level: {think_str}", None

    # Resolve alias to canonical name
    model_name = MODEL_ALIASES.get(model_name, model_name)

    cfg = MODELS.get(model_name)
    if not cfg:
        from .gemini import log
        log(f"Unknown model '{model_name}', falling back to '{default}'")
        model_name = default
        cfg = MODELS[default]
    mode_id = cfg["mode"]
    think_mode = think_override if think_override is not None else cfg["think"]
    extra = cfg.get("extra")
    return model_name, mode_id, think_mode, None, extra


def get_openai_model_list():
    """Return list of models in OpenAI-compatible schema for GET /v1/models."""
    models = []
    for model_id, cfg in MODELS.items():
        models.append({
            "id": model_id,
            "object": "model",
            "created": 1700000000,
            "owned_by": "google",
            "description": cfg["desc"],
        })
    # Also include aliases as models pointing to their targets
    for alias, target in MODEL_ALIASES.items():
        target_cfg = MODELS.get(target, {})
        models.append({
            "id": alias,
            "object": "model",
            "created": 1700000000,
            "owned_by": "google",
            "description": f"Alias for {target}: {target_cfg.get('desc', '')}",
        })
    return models
