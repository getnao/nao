#!/usr/bin/env python3
"""Build script for nao-core package.

This script:
1. Optionally bumps the version
2. Builds the frontend with Vite
3. Compiles the backend with Bun into a standalone binary
4. Bundles everything into a Python wheel
"""

import json
import os
import platform
import re
import shutil
import subprocess
import sys
from datetime import datetime, timezone
from enum import Enum
from pathlib import Path
from typing import Annotated

from cyclopts import App, Parameter

# Windows defaults to cp1252 which cannot encode emoji used in log messages
if sys.platform == "win32":
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8")


def _add_to_path(directory: Path) -> None:
    os.environ["PATH"] = str(directory) + os.pathsep + os.environ.get("PATH", "")


def _ensure_tools_in_path() -> None:
    """On Windows, tools like nvm-managed Node.js and Git may not be in PATH.

    nvm injects node via .bash_profile which is never sourced by PowerShell/cmd.
    Git is commonly installed at 'C:/Program Files/Git/cmd' but not added to PATH.
    """
    if not shutil.which("git"):
        git_cmd = Path("C:/Program Files/Git/cmd")
        if git_cmd.exists():
            _add_to_path(git_cmd)
            print(f"✓ Added Git to PATH: {git_cmd}")

    if not shutil.which("npm"):
        nvm_node_dir = Path.home() / ".nvm" / "versions" / "node"
        if nvm_node_dir.exists():
            versions = sorted(nvm_node_dir.iterdir(), key=lambda p: p.name, reverse=True)
            if versions:
                bin_dir = versions[0] / "bin"
                if bin_dir.exists():
                    _add_to_path(bin_dir)
                    print(f"✓ Added nvm Node.js to PATH: {bin_dir}")


_ensure_tools_in_path()

app = App(help="Build and package nao-core CLI.")


class BumpType(Enum):
    patch = "patch"
    minor = "minor"
    major = "major"


def run(cmd: list[str], cwd: Path | None = None, env: dict | None = None) -> None:
    """Run a command and exit on failure."""
    result = subprocess.run(cmd, cwd=cwd, env=env, shell=sys.platform == "win32")
    if result.returncode != 0:
        print(f"❌ Command failed: {' '.join(cmd)}")
        sys.exit(1)


def _find_platform_deps(project_root: Path) -> list[str]:
    """Scan node_modules for all platform-specific optional dependencies.

    Packages like rollup, lightningcss, tailwindcss/oxide, and esbuild ship
    platform-specific native binaries as optional dependencies. When the
    lockfile was generated on a different OS, these are absent.

    Returns ALL platform deps (not just missing ones) because npm's tree
    reconciliation removes previously-installed unlocked packages on each run.
    """
    platform_markers = {
        "darwin-arm64": ["darwin-arm64"],
        "darwin-x64": ["darwin-x64"],
        "linux-x64-gnu": ["linux-x64-gnu", "linux-x64"],
        "linux-arm64-gnu": ["linux-arm64-gnu", "linux-arm64"],
        "win32-x64-msvc": ["win32-x64-msvc", "win32-x64"],
    }
    suffix = get_native_platform_suffix()
    markers = platform_markers.get(suffix or "", [])
    if not markers:
        return []

    nm = project_root / "node_modules"
    if not nm.exists():
        return []

    deps: list[str] = []
    scoped_dirs = [d for d in nm.iterdir() if d.is_dir() and d.name.startswith("@")]
    packages = [d.name for d in nm.iterdir() if d.is_dir() and not d.name.startswith(("@", "."))]
    packages += [f"{s.name}/{p.name}" for s in scoped_dirs for p in s.iterdir() if p.is_dir()]

    for pkg_name in packages:
        pkg_json = nm / pkg_name / "package.json"
        if not pkg_json.exists():
            continue
        try:
            meta = json.loads(pkg_json.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            continue
        for dep in meta.get("optionalDependencies", {}):
            if any(m in dep for m in markers):
                deps.append(dep)

    return sorted(set(deps))


def _ensure_platform_deps(project_root: Path) -> None:
    """Install platform-specific npm optional dependencies if missing.

    package-lock.json is typically generated on one OS, so native packages for
    other platforms are absent. Packages are installed in a single `npm install`
    call. Failures are non-fatal because some packages (e.g. boxlite) don't
    publish binaries for every platform.
    """
    all_deps = _find_platform_deps(project_root)
    nm = project_root / "node_modules"
    missing = [dep for dep in all_deps if not (nm / dep).exists()]
    if not missing:
        return

    print("\n📦 Installing platform-specific dependencies...")
    for dep in missing:
        print(f"   + {dep}")

    result = subprocess.run(
        ["npm", "install", "--no-save", *missing],
        cwd=project_root,
        shell=sys.platform == "win32",
    )
    if result.returncode != 0:
        still_missing = [dep for dep in missing if not (nm / dep).exists()]
        if still_missing:
            print(f"   ⚠️  Could not install: {', '.join(still_missing)} (may not exist for this platform)")
        else:
            print("   ✓ All needed packages were installed despite npm warnings")


def get_git_commit(project_root: Path) -> str:
    """Get the current git commit hash."""
    try:
        result = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=project_root,
            capture_output=True,
            text=True,
        )
        if result.returncode == 0:
            return result.stdout.strip()
    except Exception:
        pass
    return "unknown"


def get_git_commit_short(project_root: Path) -> str:
    """Get the short git commit hash."""
    try:
        result = subprocess.run(
            ["git", "rev-parse", "--short", "HEAD"],
            cwd=project_root,
            capture_output=True,
            text=True,
        )
        if result.returncode == 0:
            return result.stdout.strip()
    except Exception:
        pass
    return "unknown"


def parse_version(version: str) -> tuple[int, int, int]:
    """Parse a semver version string into (major, minor, patch)."""
    match = re.match(r"(\d+)\.(\d+)\.(\d+)", version)
    if not match:
        raise ValueError(f"Invalid version format: {version}")
    return int(match.group(1)), int(match.group(2)), int(match.group(3))


def bump_version(version: str, bump_type: BumpType) -> str:
    """Bump a semver version string."""
    major, minor, patch = parse_version(version)

    if bump_type == BumpType.major:
        return f"{major + 1}.0.0"
    elif bump_type == BumpType.minor:
        return f"{major}.{minor + 1}.0"
    else:  # patch
        return f"{major}.{minor}.{patch + 1}"


def get_current_version(cli_dir: Path) -> str:
    """Get the current version from pyproject.toml."""
    pyproject = cli_dir / "pyproject.toml"
    content = pyproject.read_text()
    match = re.search(r'^version\s*=\s*"([^"]+)"', content, re.MULTILINE)
    if not match:
        raise ValueError("Could not find version in pyproject.toml")
    return match.group(1)


def update_version(cli_dir: Path, new_version: str) -> None:
    """Update version in pyproject.toml and __init__.py."""
    # Update pyproject.toml
    pyproject = cli_dir / "pyproject.toml"
    content = pyproject.read_text()
    content = re.sub(
        r'^version\s*=\s*"[^"]+"',
        f'version = "{new_version}"',
        content,
        flags=re.MULTILINE,
    )
    pyproject.write_text(content)

    # Update __init__.py
    init_file = cli_dir / "nao_core" / "__init__.py"
    content = init_file.read_text()
    content = re.sub(
        r'^__version__\s*=\s*"[^"]+"',
        f'__version__ = "{new_version}"',
        content,
        flags=re.MULTILINE,
    )
    init_file.write_text(content)

    print(f"✓ Version bumped to {new_version}")


def get_native_platform_suffix() -> str | None:
    """Return the NAPI-RS platform suffix for the current OS/arch, or None."""
    os_name = sys.platform
    arch = platform.machine()

    if os_name == "darwin":
        if arch == "arm64":
            return "darwin-arm64"
        if arch == "x86_64":
            return "darwin-x64"
    elif os_name == "linux":
        if arch == "x86_64":
            return "linux-x64-gnu"
        if arch in ("aarch64", "arm64"):
            return "linux-arm64-gnu"
    elif os_name == "win32":
        if arch in ("AMD64", "x86_64"):
            return "win32-x64-msvc"
    return None


def bundle_native_packages(project_root: Path, output_dir: Path) -> None:
    """Copy NAPI-RS native addons into node_modules/ next to the binary.

    Both @boxlite-ai/boxlite and @pydantic/monty are externalized from the Bun
    standalone build because they load platform-specific .node files at runtime.
    """
    suffix = get_native_platform_suffix()
    if suffix is None:
        print(f"   ⚠️  Unsupported platform {sys.platform}/{platform.machine()} — skipping native addons")
        return

    nm_root = project_root / "node_modules"
    out_nm = output_dir / "node_modules"

    packages_to_copy: list[tuple[str, str]] = [
        ("@pydantic/monty", "@pydantic/monty"),
    ]

    # boxlite has no native win32 binaries (works on Windows only through WSL)
    if sys.platform != "win32":
        packages_to_copy = [
            ("@boxlite-ai/boxlite", "@boxlite-ai/boxlite"),
            (f"@boxlite-ai/boxlite-{suffix}", f"@boxlite-ai/boxlite-{suffix}"),
        ] + packages_to_copy
    else:
        print("   Skipping @boxlite-ai/boxlite (no native win32 binaries — use WSL for sandbox support)")

    # monty's platform package may be nested inside its own node_modules
    monty_platform_pkg = f"@pydantic/monty-{suffix}"
    monty_nested = nm_root / "@pydantic" / "monty" / "node_modules" / monty_platform_pkg
    monty_hoisted = nm_root / monty_platform_pkg

    if monty_nested.exists():
        # Keep the nested structure so require() resolves correctly
        packages_to_copy.append(
            (
                str(monty_nested.relative_to(nm_root)),
                f"@pydantic/monty/node_modules/{monty_platform_pkg}",
            )
        )
    elif monty_hoisted.exists():
        packages_to_copy.append((monty_platform_pkg, monty_platform_pkg))

    for src_rel, dst_rel in packages_to_copy:
        src = nm_root / src_rel
        dst = out_nm / dst_rel
        if not src.exists():
            print(f"   ⚠️  {src_rel} not found — skipping")
            continue
        if dst.exists():
            shutil.rmtree(dst)
        dst.parent.mkdir(parents=True, exist_ok=True)
        shutil.copytree(src, dst)
        print(f"   {dst_rel}")


def build_server(project_root: Path, output_dir: Path) -> None:
    """Build the frontend and backend into a standalone server."""
    backend_dir = project_root / "apps" / "backend"
    frontend_dir = project_root / "apps" / "frontend"

    print("📦 Building nao chat server...")
    print(f"   Project root: {project_root}")

    # Create output directory
    output_dir.mkdir(parents=True, exist_ok=True)

    # Clean up data files that shouldn't be bundled
    print("\n🧹 Cleaning up data files...")
    data_files_to_remove = [
        output_dir / "db.sqlite",
        output_dir / "chats",
    ]
    for data_path in data_files_to_remove:
        if data_path.exists():
            if data_path.is_dir():
                shutil.rmtree(data_path)
            else:
                data_path.unlink()
            print(f"   Removed: {data_path}")

    # Step 1: Ensure platform-specific npm optional deps are installed.
    # package-lock.json is generated on macOS/Linux, so Windows-only optional
    # packages (e.g. @rollup/rollup-win32-x64-msvc) are missing from the lockfile.
    _ensure_platform_deps(project_root)

    # Step 2: Build frontend
    print("\n🎨 Building frontend...")
    run(["npm", "run", "build"], cwd=frontend_dir)

    # Step 3: Copy frontend dist to backend public folder
    print("\n📁 Copying frontend assets to backend...")
    backend_public = backend_dir / "public"
    if backend_public.exists():
        shutil.rmtree(backend_public)
    shutil.copytree(frontend_dir / "dist", backend_public)

    # Step 4: Compile backend CLI with Bun
    print("\n⚡ Compiling backend CLI with Bun...")
    run(["npm", "run", "build:standalone"], cwd=backend_dir)

    # Step 5: Copy the compiled binary to output directory
    print("\n📦 Copying binary to output directory...")
    binary_name = "nao-chat-server.exe" if sys.platform == "win32" else "nao-chat-server"
    binary_src = backend_dir / binary_name
    binary_dst = output_dir / binary_name
    shutil.copy2(binary_src, binary_dst)
    print(f"   Binary: {binary_dst}")

    # Step 6: Copy frontend assets next to the binary
    print("\n📦 Bundling assets with binary...")
    output_public = output_dir / "public"
    if output_public.exists():
        shutil.rmtree(output_public)
    shutil.copytree(backend_public, output_public)

    # Step 7: Copy migrations next to the binary (both SQLite and PostgreSQL)
    print("\n📦 Bundling migrations with binary...")

    # Copy SQLite migrations
    sqlite_migrations_src = backend_dir / "migrations-sqlite"
    sqlite_migrations_dst = output_dir / "migrations-sqlite"
    if sqlite_migrations_dst.exists():
        shutil.rmtree(sqlite_migrations_dst)
    if sqlite_migrations_src.exists():
        shutil.copytree(sqlite_migrations_src, sqlite_migrations_dst)
        print(f"   SQLite migrations: {sqlite_migrations_dst}")
    else:
        print("   ⚠️  No SQLite migrations folder found")

    # Copy PostgreSQL migrations
    postgres_migrations_src = backend_dir / "migrations-postgres"
    postgres_migrations_dst = output_dir / "migrations-postgres"
    if postgres_migrations_dst.exists():
        shutil.rmtree(postgres_migrations_dst)
    if postgres_migrations_src.exists():
        shutil.copytree(postgres_migrations_src, postgres_migrations_dst)
        print(f"   PostgreSQL migrations: {postgres_migrations_dst}")
    else:
        print("   ⚠️  No PostgreSQL migrations folder found")

    # Step 8: Copy FastAPI server
    print("\n📦 Bundling FastAPI server...")
    fastapi_src = backend_dir / "fastapi"
    fastapi_dst = output_dir / "fastapi"
    if fastapi_dst.exists():
        shutil.rmtree(fastapi_dst)
    if fastapi_src.exists():
        shutil.copytree(fastapi_src, fastapi_dst)
        print(f"   FastAPI server: {fastapi_dst}")
    else:
        print("   ⚠️  No FastAPI folder found")

    # Step 9: Copy ripgrep binary
    print("\n📦 Bundling ripgrep binary...")
    rg_binary_name = "rg.exe" if sys.platform == "win32" else "rg"
    # Look in both monorepo root and backend node_modules
    rg_src_paths = [
        project_root / "node_modules" / "@vscode" / "ripgrep" / "bin" / rg_binary_name,
        backend_dir / "node_modules" / "@vscode" / "ripgrep" / "bin" / rg_binary_name,
    ]
    rg_src = None
    for path in rg_src_paths:
        if path.exists():
            rg_src = path
            break

    if rg_src:
        rg_dst = output_dir / rg_binary_name
        shutil.copy2(rg_src, rg_dst)
        # Ensure the binary is executable
        rg_dst.chmod(rg_dst.stat().st_mode | 0o755)
        print(f"   Ripgrep: {rg_dst}")
    else:
        print("   ⚠️  No ripgrep binary found (grep tool will not work in standalone mode)")
        print("   Run 'npm install @vscode/ripgrep' in the backend or root directory")

    # Step 10: Bundle native NAPI addons (boxlite, monty)
    print("\n📦 Bundling native addons...")
    bundle_native_packages(project_root, output_dir)

    # Cleanup temporary public folder in backend
    shutil.rmtree(backend_public)

    # Step 11: Write git commit info
    print("\n📦 Writing build info...")
    commit_hash = get_git_commit(project_root)
    commit_short = get_git_commit_short(project_root)
    build_info_path = output_dir / "build-info.json"
    build_info = {
        "commit": commit_hash,
        "commitShort": commit_short,
        "buildTime": datetime.now(timezone.utc).isoformat(),
    }
    build_info_path.write_text(json.dumps(build_info, indent=2))
    print(f"   Build info: {build_info_path} (commit: {commit_short})")

    print("\n✓ Server build complete!")
    print(f"   Binary: {binary_dst}")
    print(f"   Assets: {output_public}")
    print(f"   FastAPI: {fastapi_dst}")
    if rg_src:
        print(f"   Ripgrep: {output_dir / rg_binary_name}")


def build_package(cli_dir: Path) -> None:
    """Build the Python package with uv."""
    # Clean dist folder first
    dist_dir = cli_dir / "dist"
    if dist_dir.exists():
        shutil.rmtree(dist_dir)
        print("🧹 Cleaned dist folder")

    print("\n📦 Building Python package...")
    run(["uv", "build"], cwd=cli_dir)

    version = get_current_version(cli_dir)
    print(f"\n✅ Build complete! (v{version})")
    print(f"   Packages are in: {cli_dir / 'dist'}")
    print("\n   To publish to PyPI:")
    print("   uv publish dist/*")


@app.default
def build(
    *,
    force: Annotated[bool, Parameter(["--force", "-f"], help="Force rebuild the server binary")] = False,
    skip_server: Annotated[
        bool,
        Parameter(["--skip-server", "-s"], help="Skip server build, only build Python package"),
    ] = False,
    bump: Annotated[
        BumpType | None,
        Parameter(help="Bump version before building (patch, minor, major)"),
    ] = None,
) -> None:
    """Build the nao-core package.

    Builds the frontend, compiles the backend with Bun, and creates a Python wheel.
    """
    cli_dir = Path(__file__).parent
    project_root = cli_dir.parent
    output_dir = cli_dir / "nao_core" / "bin"
    binary_name = "nao-chat-server.exe" if sys.platform == "win32" else "nao-chat-server"
    binary_path = output_dir / binary_name
    public_dir = output_dir / "public"
    sqlite_migrations_dir = output_dir / "migrations-sqlite"
    postgres_migrations_dir = output_dir / "migrations-postgres"
    fastapi_dir = output_dir / "fastapi"
    rg_binary_name = "rg.exe" if sys.platform == "win32" else "rg"
    rg_path = output_dir / rg_binary_name

    # Bump version if requested
    if bump:
        current = get_current_version(cli_dir)
        new_version = bump_version(current, bump)
        print(f"\n🔖 Bumping version: {current} → {new_version}")
        update_version(cli_dir, new_version)

    build_info_path = output_dir / "build-info.json"

    # Check if we need to build the server
    needs_build = (
        force
        or not binary_path.exists()
        or not public_dir.exists()
        or not sqlite_migrations_dir.exists()
        or not postgres_migrations_dir.exists()
        or not fastapi_dir.exists()
        or not rg_path.exists()
        or not build_info_path.exists()
    )

    if skip_server:
        if not binary_path.exists() or not public_dir.exists() or not fastapi_dir.exists():
            print("❌ Server binary or assets not found. Run without --skip-server first.")
            sys.exit(1)
        print("✓ Skipping server build (--skip-server)")
    elif needs_build:
        build_server(project_root, output_dir)
    else:
        print("✓ Server binary already exists, skipping build (use --force to rebuild)")

    # Verify the binary exists
    if not binary_path.exists():
        print(f"❌ Binary not found: {binary_path}")
        sys.exit(1)

    if not public_dir.exists():
        print(f"❌ Public directory not found: {public_dir}")
        sys.exit(1)

    print("\n✓ Server assets ready")
    print(f"   Binary: {binary_path}")
    print(f"   Public: {public_dir}")
    if sqlite_migrations_dir.exists():
        print(f"   SQLite migrations: {sqlite_migrations_dir}")
    if postgres_migrations_dir.exists():
        print(f"   PostgreSQL migrations: {postgres_migrations_dir}")
    if fastapi_dir.exists():
        print(f"   FastAPI server: {fastapi_dir}")
    if rg_path.exists():
        print(f"   Ripgrep: {rg_path}")
    if build_info_path.exists():
        build_info = json.loads(build_info_path.read_text())
        print(f"   Build commit: {build_info.get('commitShort', 'unknown')}")

    # Build the Python package
    build_package(cli_dir)


if __name__ == "__main__":
    app()
