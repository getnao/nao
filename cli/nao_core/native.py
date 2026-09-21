"""Download the native engines that are too large to ship inside the wheel.

The DuckDB engine and the sandbox micro-VM runtime each unpack to around 100 MB,
which would push our platform wheels past what PyPI accepts. The build records
where to fetch them in `bin/native-deps.json`; here they are downloaded on demand
and cached under `~/.nao/native`, laid out as a node_modules tree so the chat
server resolves them through NODE_PATH.
"""

from __future__ import annotations

import base64
import hashlib
import json
import os
import shutil
import tarfile
import tempfile
from dataclasses import dataclass
from pathlib import Path

from nao_core.ui import UI, console

MANIFEST_NAME = "native-deps.json"
CACHE_ROOT = Path.home() / ".nao" / "native"
DEFAULT_REGISTRY = "https://registry.npmjs.org"
DOWNLOAD_TIMEOUT_SECS = 300


@dataclass(frozen=True)
class NativePackage:
    """A platform-specific npm package fetched at runtime instead of bundled."""

    group: str
    label: str
    name: str
    version: str
    integrity: str

    @property
    def tarball_url(self) -> str:
        registry = os.environ.get("NAO_NATIVE_REGISTRY", DEFAULT_REGISTRY).rstrip("/")
        return f"{registry}/{self.name}/-/{self.name.split('/')[-1]}-{self.version}.tgz"

    @property
    def group_dir(self) -> Path:
        """The node_modules-style root NODE_PATH points at, keyed by version."""
        return CACHE_ROOT / f"{self.group}-{self.version}"

    @property
    def cache_dir(self) -> Path:
        return self.group_dir / self.name


def server_bin_dir() -> Path:
    """The bundled server directory, where the build leaves the manifest."""
    return Path(__file__).parent / "bin"


def node_path(bin_dir: Path, existing: str | None = None) -> str:
    """The NODE_PATH the chat server needs to resolve every downloadable engine.

    Directories are included whether or not they exist yet: the server loads these
    packages lazily, so an engine downloaded while it runs is still picked up.
    """
    roots = sorted({str(package.group_dir) for package in load_manifest(bin_dir)})
    if existing:
        roots.append(existing)
    return os.pathsep.join(roots)


def ensure_group(bin_dir: Path, group: str) -> bool:
    """Download a group's packages unless they are already cached.

    Returns False when something is still missing afterwards, so callers can carry
    on with the feature disabled rather than failing outright.
    """
    packages = _group_packages(bin_dir, group)
    if not packages:
        return True

    missing = [package for package in packages if not package.cache_dir.exists()]
    if not missing:
        return True

    label = missing[0].label
    UI.print(f"[dim]Downloading {label} (one-time)...[/dim]")

    for package in missing:
        try:
            _install(package)
        except Exception as error:
            UI.warn(f"Could not download {label}: {error}")
            return False

    _prune_other_versions(packages)
    UI.success(f"{label} ready")
    return True


def load_manifest(bin_dir: Path) -> list[NativePackage]:
    """Read the packages recorded by the build, or nothing when they are bundled."""
    manifest = bin_dir / MANIFEST_NAME
    if not manifest.exists():
        return []

    try:
        entries = json.loads(manifest.read_text(encoding="utf-8"))
        if not isinstance(entries, list):
            return []
        return [NativePackage(**entry) for entry in entries]
    except (json.JSONDecodeError, OSError, TypeError, ValueError):
        return []


def _group_packages(bin_dir: Path, group: str) -> list[NativePackage]:
    return [package for package in load_manifest(bin_dir) if package.group == group]


def _install(package: NativePackage) -> None:
    """Download, verify and unpack one package into its cache directory."""
    package.cache_dir.parent.mkdir(parents=True, exist_ok=True)
    staging = Path(tempfile.mkdtemp(dir=package.cache_dir.parent))
    archive = staging / "package.tgz"

    try:
        _download(package, archive)
        _verify(archive, package.integrity)
        _extract(archive, staging)
        # A concurrent nao may win the rename race; the cache is version-keyed, so
        # an already-present destination is the same install and counts as success.
        try:
            (staging / "package").rename(package.cache_dir)
        except OSError:
            if not package.cache_dir.exists():
                raise
    finally:
        shutil.rmtree(staging, ignore_errors=True)


def _download(package: NativePackage, destination: Path) -> None:
    import httpx
    from rich.progress import BarColumn, DownloadColumn, Progress, TextColumn

    columns = (TextColumn("  [dim]{task.description}[/dim]"), BarColumn(), DownloadColumn())
    with httpx.stream("GET", package.tarball_url, follow_redirects=True, timeout=DOWNLOAD_TIMEOUT_SECS) as response:
        response.raise_for_status()
        total = int(response.headers.get("content-length", 0)) or None

        with destination.open("wb") as file, Progress(*columns, console=console, transient=True) as progress:
            task = progress.add_task(package.name, total=total)
            for chunk in response.iter_bytes():
                file.write(chunk)
                progress.update(task, completed=response.num_bytes_downloaded)


def _verify(archive: Path, integrity: str) -> None:
    """Check the npm integrity hash, since we are about to unpack and dlopen this."""
    algorithm, _, expected = integrity.partition("-")
    if algorithm not in hashlib.algorithms_available:
        raise ValueError(f"unsupported integrity algorithm '{algorithm}'")

    digest = hashlib.new(algorithm)
    with archive.open("rb") as file:
        while chunk := file.read(1024 * 1024):
            digest.update(chunk)

    if base64.b64encode(digest.digest()).decode() != expected:
        raise ValueError("checksum mismatch, the download may be corrupted or tampered with")


def _extract(archive: Path, destination: Path) -> None:
    with tarfile.open(archive, "r:gz") as tar:
        members = [member for member in tar.getmembers() if _is_safe_member(member)]
        if hasattr(tarfile, "data_filter"):
            tar.extractall(destination, members=members, filter="data")
        else:
            tar.extractall(destination, members=members)


def _is_safe_member(member: tarfile.TarInfo) -> bool:
    """Reject anything that would escape the destination or is not a plain file."""
    path = Path(member.name)
    if path.is_absolute() or ".." in path.parts:
        return False
    return member.isfile() or member.isdir()


def _prune_other_versions(packages: list[NativePackage]) -> None:
    """Drop cached versions of the same group left behind by an earlier nao."""
    keep = {package.group_dir for package in packages}
    groups = {package.group for package in packages}

    for directory in CACHE_ROOT.iterdir():
        if directory in keep or not directory.is_dir():
            continue
        if any(directory.name.startswith(f"{group}-") for group in groups):
            shutil.rmtree(directory, ignore_errors=True)
