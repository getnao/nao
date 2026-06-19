import os
import subprocess
import sys

from nao_core.commands.chat import get_server_binary_path
from nao_core.tracking import track_command


@track_command("reset-password")
def reset_password(email: str):
    """Reset a local nao user's password.

    Generates a temporary password for the given email by updating the local
    nao database directly. The user is prompted to choose a new password on
    their next login. Works offline — no running chat server required.

    Parameters
    ----------
    email : str
        Email address of the account whose password should be reset.
    """
    binary_path = get_server_binary_path()
    bin_dir = binary_path.parent

    result = subprocess.run(
        [str(binary_path), "reset-password", "--email", email],
        cwd=str(bin_dir),
        env=os.environ.copy(),
    )

    if result.returncode != 0:
        sys.exit(result.returncode)
