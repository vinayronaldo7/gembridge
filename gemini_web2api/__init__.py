import sys
import warnings
import gembridge

warnings.warn(
    "Package 'gemini_web2api' is deprecated. Use 'gembridge' instead. "
    "Will be removed in v2.0.",
    DeprecationWarning,
    stacklevel=2,
)

import gembridge.config
import gembridge.models
import gembridge.server
import gembridge.gemini
import gembridge.tools
import gembridge.multimodal

sys.modules["gemini_web2api"] = gembridge
sys.modules["gemini_web2api.config"] = gembridge.config
sys.modules["gemini_web2api.models"] = gembridge.models
sys.modules["gemini_web2api.server"] = gembridge.server
sys.modules["gemini_web2api.gemini"] = gembridge.gemini
sys.modules["gemini_web2api.tools"] = gembridge.tools
sys.modules["gemini_web2api.multimodal"] = gembridge.multimodal

from gembridge.config import CONFIG, DEFAULT_CONFIG, load_config, find_config
from gembridge.models import MODELS, resolve_model
from gembridge.server import GeminiHandler, ThreadedServer
from gembridge.tools import google_contents_to_prompt, messages_to_prompt
from gembridge.multimodal import detect_image_mime, fetch_image_bytes, upload_image

__version__ = gembridge.__version__
