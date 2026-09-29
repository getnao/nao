#!/usr/bin/env python3
# /// script
# requires-python = ">=3.11"
# dependencies = ["packaging", "pypi-cleanup", "requests"]
# ///
"""Free up space on PyPI by deleting old nao-core releases.

Retention policy (a release is kept if any rule matches):
  - it is the latest stable release
  - it is the highest stable patch of its major.minor line
  - it is a stable release uploaded less than --keep-days ago
  - it is a pre-release (rc/dev/alpha/beta) uploaded less than --prerelease-keep-days ago

Everything else is deleted. Deleted versions can never be re-uploaded to PyPI.

Dry run by default. Deletion goes through the PyPI web login (no API exists for it), so
--do-it prompts for your PyPI password and 2FA code. The password can also be provided
via the PYPI_CLEANUP_PASSWORD environment variable.

Usage:
  uv run scripts/pypi-cleanup.py
  uv run scripts/pypi-cleanup.py --keep-days 60 --prerelease-keep-days 7
  uv run scripts/pypi-cleanup.py --username <pypi-user> --do-it
"""

from __future__ import annotations

import argparse
import sys
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

import requests
from packaging.version import InvalidVersion, Version

PYPI_JSON_URL = "https://pypi.org/pypi/{package}/json"


@dataclass(frozen=True)
class Release:
    name: str
    version: Version
    uploaded_at: datetime
    size_bytes: int


@dataclass(frozen=True)
class RetentionPolicy:
    keep_days: int
    prerelease_keep_days: int


def main() -> int:
    args = parse_args()
    policy = RetentionPolicy(keep_days=args.keep_days, prerelease_keep_days=args.prerelease_keep_days)

    releases = fetch_releases(args.package)
    to_delete = select_releases_to_delete(releases, policy)
    print_plan(args.package, releases, to_delete)

    if not to_delete:
        return 0
    if not args.do_it:
        print("Dry run. Re-run with --do-it to delete the releases listed above.")
        return 0
    return run_pypi_cleanup(args.package, args.username, to_delete)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--package", default="nao-core", help="PyPI package name (default: nao-core)")
    parser.add_argument("--username", "-u", help="PyPI username (falls back to ~/.pypirc)")
    parser.add_argument("--keep-days", type=int, default=90, help="keep stable releases newer than this (default: 90)")
    parser.add_argument(
        "--prerelease-keep-days", type=int, default=14, help="keep pre-releases newer than this (default: 14)"
    )
    parser.add_argument("--do-it", action="store_true", help="actually delete (default is dry run)")
    return parser.parse_args()


def fetch_releases(package: str) -> list[Release]:
    response = requests.get(PYPI_JSON_URL.format(package=package), timeout=30)
    response.raise_for_status()
    releases = []
    for name, files in response.json()["releases"].items():
        release = build_release(name, files)
        if release is not None:
            releases.append(release)
    return sorted(releases, key=lambda release: release.version)


def build_release(name: str, files: list[dict]) -> Release | None:
    if not files:
        return None
    try:
        version = Version(name)
    except InvalidVersion:
        print(f"Skipping unparseable version {name!r}", file=sys.stderr)
        return None
    uploaded_at = max(datetime.fromisoformat(file["upload_time_iso_8601"]) for file in files)
    size_bytes = sum(file["size"] for file in files)
    return Release(name=name, version=version, uploaded_at=uploaded_at, size_bytes=size_bytes)


def select_releases_to_delete(releases: list[Release], policy: RetentionPolicy) -> list[Release]:
    protected = protected_release_names(releases)
    now = datetime.now(UTC)
    return [release for release in releases if release.name not in protected and is_expired(release, policy, now)]


def protected_release_names(releases: list[Release]) -> set[str]:
    stable = [release for release in releases if not release.version.is_prerelease]
    if not stable:
        return set()
    latest_per_minor: dict[tuple[int, int], Release] = {}
    for release in stable:
        latest_per_minor[(release.version.major, release.version.minor)] = release
    protected = {release.name for release in latest_per_minor.values()}
    protected.add(max(stable, key=lambda release: release.version).name)
    return protected


def is_expired(release: Release, policy: RetentionPolicy, now: datetime) -> bool:
    keep_days = policy.prerelease_keep_days if release.version.is_prerelease else policy.keep_days
    return release.uploaded_at < now - timedelta(days=keep_days)


def print_plan(package: str, releases: list[Release], to_delete: list[Release]) -> None:
    total = sum(release.size_bytes for release in releases)
    freed = sum(release.size_bytes for release in to_delete)
    print(f"{package}: {len(releases)} releases, {format_size(total)} on PyPI\n")
    if not to_delete:
        print("Nothing to delete under the current retention policy.")
        return
    print(f"Releases to delete ({len(to_delete)}):")
    for release in to_delete:
        print(f"  {release.uploaded_at:%Y-%m-%d}  {release.name:<14} {format_size(release.size_bytes):>10}")
    print(f"\nWould free {format_size(freed)}, leaving {format_size(total - freed)}.\n")


def run_pypi_cleanup(package: str, username: str | None, to_delete: list[Release]) -> int:
    import pypi_cleanup

    argv = ["pypi-cleanup", "--package", package, "--yes", "--do-it"]
    if username:
        argv += ["--username", username]
    for release in to_delete:
        argv += ["--version-regex", exact_version_pattern(release.name)]
    sys.argv = argv
    return pypi_cleanup.main() or 0


def exact_version_pattern(name: str) -> str:
    return "^" + name.replace(".", r"\.") + "$"


def format_size(size_bytes: int) -> str:
    size = float(size_bytes)
    for unit in ("B", "KB", "MB", "GB"):
        if size < 1000:
            return f"{size:.1f} {unit}"
        size /= 1000
    return f"{size:.1f} TB"


if __name__ == "__main__":
    raise SystemExit(main())
