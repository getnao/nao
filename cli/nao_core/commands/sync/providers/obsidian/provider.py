from pathlib import Path, PurePosixPath

from rich.console import Console

from nao_core.config.base import NaoConfig
from nao_core.config.obsidian import ObsidianConfig
from nao_core.obsidian import OBSIDIAN_OUTPUT_DIR

from ..base import SyncProvider, SyncResult

console = Console()

IGNORED_DIR_NAMES = {".obsidian"}


def cleanup_stale_notes(synced_files: set[str], output_path: Path, verbose: bool = False) -> int:
    """Remove markdown files and empty directories that were not synced."""
    if not output_path.exists():
        return 0

    removed_count = 0
    for file_path in sorted(output_path.rglob("*.md"), reverse=True):
        relative = PurePosixPath(file_path.relative_to(output_path)).as_posix()
        if relative not in synced_files:
            file_path.unlink()
            removed_count += 1
            if verbose:
                console.print(f"  [dim red]removing stale note:[/dim red] {relative}")

    for dir_path in sorted((p for p in output_path.rglob("*") if p.is_dir()), reverse=True):
        if dir_path != output_path:
            try:
                dir_path.rmdir()
            except OSError:
                pass

    return removed_count


def iter_markdown_files(vault_path: Path):
    """Yield markdown files from the vault, skipping Obsidian metadata directories."""
    for path in vault_path.rglob("*.md"):
        if any(part in IGNORED_DIR_NAMES for part in path.parts):
            continue
        if not path.is_file():
            continue
        yield path


class ObsidianSyncProvider(SyncProvider):
    """Provider for syncing local Obsidian vault notes."""

    @property
    def name(self) -> str:
        return "Obsidian"

    @property
    def emoji(self) -> str:
        return "🗂️"

    @property
    def default_output_dir(self) -> str:
        return OBSIDIAN_OUTPUT_DIR

    def get_items(self, config: NaoConfig) -> list[ObsidianConfig]:
        return [config.obsidian] if config.obsidian else []

    def sync(
        self,
        items: list[ObsidianConfig],
        output_path: Path,
        project_path: Path | None = None,
        *,
        threads: int = 1,
    ) -> SyncResult:
        if not items:
            console.print("\n[dim]No Obsidian vault configured[/dim]")
            return SyncResult(provider_name=self.name, items_synced=0, summary="No Obsidian configuration configured")

        obsidian_config = items[0]
        vault_path = Path(obsidian_config.path).expanduser().resolve()
        if not vault_path.exists():
            raise FileNotFoundError(f"Obsidian vault path does not exist: {vault_path}")
        if not vault_path.is_dir():
            raise ValueError(f"Obsidian vault path is not a directory: {vault_path}")

        output_path.mkdir(parents=True, exist_ok=True)
        notes_synced = 0
        synced_files: set[str] = set()

        console.print(f"\n[bold cyan]{self.emoji}  Syncing {self.name}[/bold cyan]")
        console.print(f"[dim]Vault:[/dim] {vault_path}")
        console.print(f"[dim]Location:[/dim] {output_path.absolute()}\n")

        for note_path in iter_markdown_files(vault_path):
            relative_path = note_path.relative_to(vault_path)
            destination = output_path / relative_path
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_text(note_path.read_text(encoding="utf-8"), encoding="utf-8")

            notes_synced += 1
            synced_files.add(PurePosixPath(relative_path).as_posix())

        removed_count = cleanup_stale_notes(synced_files, output_path, verbose=True)

        summary = f"{notes_synced} markdown notes synced"
        if removed_count > 0:
            summary += f", {removed_count} stale removed"

        return SyncResult(
            provider_name=self.name,
            items_synced=notes_synced,
            details={"removed": removed_count},
            summary=summary,
        )
