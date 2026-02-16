import shutil
import subprocess
import sys

from nao_core import __version__
from nao_core.ui import UI, ask_confirm
from nao_core.version import clear_version_cache, get_latest_version, parse_version


def upgrade() -> None:
    """Upgrade nao-core to the latest version."""

    # Clear cache to ensure we get fresh version info from PyPI
    clear_version_cache()

    UI.info("\n⬆️  Checking for updates...\n")

    # Get current version
    current_version = __version__
    UI.print(f"Current version: {current_version}")

    # Check latest version
    latest_version = get_latest_version()

    if latest_version is None:
        UI.error("Failed to check for updates. Please try again later.")
        return

    UI.print(f"Latest version: {latest_version}")

    # Check if already up to date
    if parse_version(current_version) >= parse_version(latest_version):
        UI.success("\n✓ You are already on the latest version!")
        return

    if not ask_confirm(f"\nUpgrade from {current_version} to {latest_version}?", default=True):
        UI.print("Upgrade cancelled.")
        return

    # Perform upgrade
    UI.print(f"\n🔄 Upgrading nao-core {current_version} → {latest_version}...\n")

    # Use uv if available, otherwise fallback to pip
    if shutil.which("uv"):
        cmd = ["uv", "pip", "install", "--upgrade", "nao-core"]
    else:
        cmd = [sys.executable, "-m", "pip", "install", "--upgrade", "nao-core"]

    try:
        subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            check=True,
        )

        UI.success(f"Upgrade complete! Now on version {latest_version}")
        UI.print("\nPlease restart your terminal or run 'source ~/.zshrc' to use the new version.")

    except subprocess.CalledProcessError as e:
        UI.error(f"Upgrade failed: {e}")
        UI.print(f"Error output: {e.stderr}")
        UI.print("\nYou can manually upgrade by running:")
        UI.print("  pip install --upgrade nao-core")
