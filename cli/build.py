#!/usr/bin/env python3
"""Build script for nao-core package.

This script:
1. Optionally bumps the version
2. Builds the frontend with Vite
3. Compiles the backend with Bun into a standalone binary
4. Bundles everything into a Python wheel
"""

import json
import re
import shutil
import subprocess
import sys
from datetime import datetime, timezone
from enum import Enum
from pathlib import Path
from typing import Annotated

from cyclopts import App, Parameter

app = App(help="Build and package nao-core CLI.")


class BumpType(Enum):
    patch = "patch"
    minor = "minor"
    major = "major"


def run(cmd: list[str], cwd: Path | None = None, env: dict | None = None) -> None:
    """Run a command and exit on failure."""
    result = subprocess.run(cmd, cwd=cwd, env=env)
    if result.returncode != 0:
        print(f"❌ Command failed: {' '.join(cmd)}")
        sys.exit(1)


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

    # Step 1: Build frontend
    print("\n🎨 Building frontend...")
    run(["npm", "run", "build"], cwd=frontend_dir)

    # Step 2: Copy frontend dist to backend public folder
    print("\n📁 Copying frontend assets to backend...")
    backend_public = backend_dir / "public"
    if backend_public.exists():
        shutil.rmtree(backend_public)
    shutil.copytree(frontend_dir / "dist", backend_public)

    # Step 3: Compile backend CLI with Bun
    print("\n⚡ Compiling backend CLI with Bun...")
    run(["npm", "run", "build:standalone"], cwd=backend_dir)

    # Step 4: Copy the compiled binary to output directory
    print("\n📦 Copying binary to output directory...")
    binary_src = backend_dir / "nao-chat-server"
    binary_dst = output_dir / "nao-chat-server"
    shutil.copy2(binary_src, binary_dst)
    print(f"   Binary: {binary_dst}")

    # Step 5: Copy frontend assets next to the binary
    print("\n📦 Bundling assets with binary...")
    output_public = output_dir / "public"
    if output_public.exists():
        shutil.rmtree(output_public)
    shutil.copytree(backend_public, output_public)

    # Step 6: Copy migrations next to the binary (both SQLite and PostgreSQL)
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

    # Step 7: Copy FastAPI server
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

    # Step 8: Copy ripgrep binary
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

    # Cleanup temporary public folder in backend
    shutil.rmtree(backend_public)

    # Step 9: Write git commit info
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
    print(f"   Binary: {output_dir / 'nao-chat-server'}")
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
    binary_path = output_dir / "nao-chat-server"
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
