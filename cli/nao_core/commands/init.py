import os
import shutil
from dataclasses import dataclass
from pathlib import Path
from typing import Annotated

from cyclopts import Parameter

from nao_core.config import NaoConfig, NaoConfigError
from nao_core.config.exceptions import InitError
from nao_core.tracking import track_command
from nao_core.ui import UI, ask_confirm, ask_text


class EmptyProjectNameError(InitError):
    """Raised when project name is empty."""

    def __init__(self):
        super().__init__("Project name cannot be empty.")


class ProjectExistsError(InitError):
    """Raised when project folder already exists."""

    def __init__(self, project_name: str):
        self.project_name = project_name
        super().__init__(f"Folder '{project_name}' already exists.")


@dataclass
class CreatedFile:
    path: Path
    content: str | None


_PROMPTS_README = """# System prompts

Customize the system prompt nao uses on each bot surface by adding a markdown
file here. These files are versioned with the rest of your context, so prompt
changes stay reviewable in pull requests just like `RULES.md`.

## Files

One file per surface:

- `system.md` — applies to every surface (nao web Bot, Slack, Teams, …).
- `slack.md` — Slack Bot only.
- `teams.md` — Microsoft Teams Bot only.
- `telegram.md` — Telegram Bot only.
- `whatsapp.md` — WhatsApp Bot only.
- `automation.md` — scheduled automations only.

A surface-specific file (e.g. `slack.md`) takes precedence over `system.md`.
Delete a file to fall back to nao's built-in prompt for that surface.

## Replace vs. extend: `{{ nao_prompt }}`

By default a prompt file **fully replaces** nao's built-in prompt for that
surface. If instead you want to **keep** the default and only add to it, include
the `{{ nao_prompt }}` placeholder somewhere in the file: it is replaced at
runtime with nao's default prompt for the corresponding surface (in `slack.md`
it expands to the default Slack prompt, in `system.md` to the web prompt, …).

Example `slack.md` that extends the default instead of overriding it:

```md
{{ nao_prompt }}

## House rules
- Always answer with amounts in EUR.
- Keep responses to 5 bullet points or fewer.
```

Without `{{ nao_prompt }}`, the file content becomes the entire prompt.
"""

_SLACK_PROMPT_EXAMPLE = """<!--
  Slack Bot system prompt. The placeholder below is replaced at runtime with
  nao's built-in Slack prompt so you can extend the default instead of replacing
  it entirely. Add your own instructions around it, remove it to fully override,
  or delete this file to use nao's default Slack prompt unchanged. See README.md.
-->

{{ nao_prompt }}
"""


def setup_project_name(
    force: bool = False,
    name: str | None = None,
    no_tty: bool = False,
) -> tuple[str, Path, NaoConfig | None, bool]:
    """Setup the project name.

    Returns a 4-tuple ``(project_name, project_path, existing_config, created_folder)``
    where ``created_folder`` is ``True`` when the project folder was freshly created
    by this call (and is therefore safe to remove if `nao init` aborts later on).

    In non-interactive (no_tty) mode:
    - If a `nao_config.yaml` exists in the current directory, the existing config is reused
      (no confirmation prompt) and the project is initialized in place.
    - Otherwise the project name is taken from `name` if provided, falling back to the
      current directory name, and the project is initialized in the current directory.
    """
    current_dir = Path.cwd()
    config_file = current_dir / "nao_config.yaml"

    if config_file.exists():
        try:
            existing_config = NaoConfig.try_load(current_dir, raise_on_error=True)
        except NaoConfigError as e:
            raise InitError(
                f"Found invalid nao_config.yaml.\n{e}\n\nFix the configuration file and rerun `nao init`."
            ) from e

        if not existing_config:
            raise InitError("Failed to load existing nao_config.yaml.")

        UI.title("Found existing nao_config.yaml")
        UI.print(f"[dim]Project: {existing_config.project_name}[/dim]\n")

        if force or no_tty or ask_confirm("Update this project configuration?", default=True):
            return existing_config.project_name, current_dir, existing_config, False

        raise InitError("Initialization cancelled.")

    if no_tty:
        project_name = name or current_dir.name
    elif name:
        project_name = name
    else:
        project_name = ask_text("Enter your project name:", required_field=True)

    if not project_name:
        raise EmptyProjectNameError()

    if no_tty and not name:
        # Initialize in the current directory when no explicit name is given
        return project_name, current_dir, None, False

    project_path = Path(project_name)
    folder_existed_before = project_path.exists()

    if folder_existed_before and not force:
        raise ProjectExistsError(project_name)

    project_path.mkdir(parents=True, exist_ok=True)

    return project_name, project_path, None, not folder_existed_before


def create_empty_structure(project_path: Path) -> tuple[list[str], list[CreatedFile]]:
    """Create project folder structure to guide users.

    To add new folders, simply append them to the FOLDERS list below.
    Each folder will be created automatically (can be empty).
    """
    FOLDERS = [
        "databases",
        "queries",
        "docs",
        "semantics",
        "repos",
        "agent/tools",
        "agent/mcps",
        "agent/skills",
        "agent/prompts",
        "tests",
    ]

    FILES = [
        CreatedFile(path=Path("RULES.md"), content=None),
        CreatedFile(path=Path("agent/prompts/README.md"), content=_PROMPTS_README),
        CreatedFile(path=Path("agent/prompts/slack.md"), content=_SLACK_PROMPT_EXAMPLE),
        CreatedFile(path=Path(".naoignore"), content="templates/\n*.j2\ntests/\n"),
        CreatedFile(
            path=Path("tests/test_example.yml"),
            content=("name: test_example\nprompt: What is the result of 1+1?\nsql: |\n  SELECT 2 AS answer_integer\n"),
        ),
    ]

    created_folders = []
    for folder in FOLDERS:
        folder_path = project_path / folder
        folder_path.mkdir(parents=True, exist_ok=True)
        created_folders.append(folder)

    created_files = []
    for file in FILES:
        file_path = project_path / file.path
        if file.content:
            file_path.write_text(file.content)
        else:
            file_path.touch()
        created_files.append(file)

    return created_folders, created_files


def _cleanup_partial_project(project_path: Path) -> None:
    """Remove a freshly-created project folder after an aborted init.

    Failures are swallowed so the original error is not masked, but a warning
    is surfaced so the user knows whether they need to remove the folder by hand.
    """
    try:
        shutil.rmtree(project_path)
        UI.info(f"Removed incomplete project folder [dim]{project_path}[/dim].")
    except Exception as cleanup_error:
        UI.warn(f"Could not remove incomplete project folder [dim]{project_path}[/dim]: {cleanup_error}")


def _install_with_progress(extras: list[str]) -> bool:
    """Run the extras install with a Rich spinner. Returns True on success."""
    from rich.console import Console
    from rich.status import Status

    from nao_core.deps import install_extras

    console = Console()

    with Status("[bold cyan]Installing dependencies…[/bold cyan]", console=console, spinner="dots"):
        success = install_extras(extras)

    if success:
        UI.success("Dependencies installed successfully.")
        return True

    extras_str = ",".join(extras)
    UI.error("Automatic installation failed.")
    UI.print(f"Install manually with: [bold cyan]pip install 'nao-core[{extras_str}]'[/bold cyan]")
    return False


def _build_no_tty_config(project_name: str, existing_config: NaoConfig | None) -> NaoConfig:
    """Return a config to save in non-interactive mode.

    Keeps any existing config as-is so an agent can pre-write `nao_config.yaml`
    and have `nao init` only scaffold folders. Otherwise creates a minimal
    config with just the project name.
    """
    if existing_config:
        return existing_config
    return NaoConfig(project_name=project_name)


@track_command("init")
def init(
    *,
    force: Annotated[bool, Parameter(name=["-f", "--force"])] = False,
    yes: Annotated[bool, Parameter(name=["-y", "--yes", "--no-tty"])] = False,
    name: Annotated[str | None, Parameter(name=["-n", "--name"])] = None,
):
    """Initialize a new nao project.

    Creates a project folder with a nao_config.yaml configuration file.

    Parameters
    ----------
    force : bool
        Force re-initialization even if the folder already exists.
    yes : bool
        Run non-interactively (no TTY). Skips all prompts and uses sensible defaults.
        Useful for AI agents and automation scripts. When combined with a pre-written
        `nao_config.yaml`, only scaffolds the folder structure.
    name : str
        Project name. When set without an existing `nao_config.yaml`, this is used
        as the project name (and folder). In non-interactive mode without an existing
        config and without `--name`, the current directory name is used and the
        project is initialized in place.
    """
    UI.info("\n🚀 nao project initialization\n")

    project_path: Path | None = None
    cleanup_on_abort = False

    try:
        project_name, project_path, existing_config, created_folder = setup_project_name(
            force=force, name=name, no_tty=yes
        )
        cleanup_on_abort = created_folder

        if yes:
            config = _build_no_tty_config(project_name, existing_config)
        else:
            config = NaoConfig.promptConfig(project_name, existing=existing_config)

        config.save(project_path)

        created_folders, created_files = create_empty_structure(project_path)

        cleanup_on_abort = False

        UI.print()
        if existing_config:
            UI.success(f"Updated project [cyan]{project_name}[/cyan]")
        else:
            UI.success(f"Created project [cyan]{project_name}[/cyan]")
        UI.success(f"Saved [dim]{project_path / 'nao_config.yaml'}[/dim]")
        UI.print()

        # Install missing optional dependencies inline
        from nao_core.deps import get_missing_extras

        missing = get_missing_extras(config)
        deps_ready = not missing
        if missing:
            extras_label = ", ".join(missing)
            UI.title("Installing provider dependencies")
            UI.print(f"[dim]Extras: {extras_label}[/dim]\n")

            should_install = yes or ask_confirm("Install the required provider dependencies now?", default=True)
            if should_install:
                UI.print()
                deps_ready = _install_with_progress(missing)
            else:
                extras_str = ",".join(missing)
                UI.print()
                UI.warn("Skipped dependency installation.")
                UI.print(
                    f"You can install them later with: [bold cyan]pip install 'nao-core[{extras_str}]'[/bold cyan]"
                )

        UI.print()
        UI.print("[bold green]Done![/bold green] Your nao project is ready. 🎉")

        is_subfolder = project_path.resolve() != Path.cwd().resolve()

        has_connections = config.databases or config.llm
        if has_connections and deps_ready:
            os.chdir(project_path)
            from nao_core.commands.debug import debug

            debug()

        UI.print()

        cd_instruction = ""
        if is_subfolder:
            cd_instruction = f"\n[bold]First, navigate to your project:[/bold]\n[cyan]cd {project_path}[/cyan]\n\n"

        help_content = f"""{cd_instruction}[bold]Available Commands:[/bold]

[cyan]nao debug[/cyan]   - Test connectivity to your configured databases and LLM
              Verifies that all connections are working properly

[cyan]nao sync[/cyan]    - Sync database schemas to local markdown files
              Creates documentation for your tables and columns

[cyan]nao chat[/cyan]    - Start the nao chat interface
              Launch the web UI to chat with your data
"""
        UI.panel(help_content, title="🚀 Get Started")
        UI.print()

    except InitError as e:
        if cleanup_on_abort and project_path is not None:
            _cleanup_partial_project(project_path)
        UI.error(str(e))
        raise SystemExit(1) from e
    except KeyboardInterrupt:
        if cleanup_on_abort and project_path is not None:
            _cleanup_partial_project(project_path)
        raise
    except Exception:
        if cleanup_on_abort and project_path is not None:
            _cleanup_partial_project(project_path)
        raise
