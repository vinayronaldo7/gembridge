import warnings

warnings.warn(
    "Module 'gemini_web2api' is deprecated. Use 'gembridge' instead. "
    "Will be removed in v2.0.",
    DeprecationWarning,
    stacklevel=2,
)

from gembridge.__main__ import main

main()
