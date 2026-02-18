"""Build mode detection for nao CLI.

MODE is 'prod' for published packages, 'dev' for local development.
"""

import os
from typing import Literal

MODE: Literal["dev", "prod"]

try:
    from nao_core._build_info import BUILD_MODE  # type: ignore[import-not-found]

    MODE = BUILD_MODE
except ImportError:
    # _build_info.py doesn't exist (e.g., editable install without running build)
    env_mode = os.environ.get("MODE")

    if env_mode == "prod":
        MODE = "prod"
    else:
        MODE = "dev"
