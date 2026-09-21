import base64
import hashlib
import io
import json
import os
import tarfile
from pathlib import Path
from unittest.mock import patch

import pytest

from nao_core import native

PACKAGE_NAME = "@duckdb/node-bindings-darwin-arm64"


def write_manifest(bin_dir: Path, entries: list[dict]) -> Path:
    bin_dir.mkdir(parents=True, exist_ok=True)
    manifest = bin_dir / native.MANIFEST_NAME
    manifest.write_text(json.dumps(entries), encoding="utf-8")
    return manifest


def duckdb_entry(integrity: str = "sha512-abc") -> dict:
    return {
        "group": "duckdb",
        "label": "DuckDB engine",
        "name": PACKAGE_NAME,
        "version": "1.4.4-r.1",
        "integrity": integrity,
    }


def make_tarball(files: dict[str, bytes]) -> bytes:
    buffer = io.BytesIO()
    with tarfile.open(fileobj=buffer, mode="w:gz") as tar:
        for name, content in files.items():
            info = tarfile.TarInfo(name)
            info.size = len(content)
            tar.addfile(info, io.BytesIO(content))
    return buffer.getvalue()


def integrity_of(payload: bytes) -> str:
    return "sha512-" + base64.b64encode(hashlib.sha512(payload).digest()).decode()


@pytest.fixture
def cache_root(tmp_path, monkeypatch):
    root = tmp_path / "cache"
    monkeypatch.setattr(native, "CACHE_ROOT", root)
    return root


def test_load_manifest_returns_nothing_when_engines_are_bundled(tmp_path):
    assert native.load_manifest(tmp_path) == []


def test_load_manifest_reads_recorded_packages(tmp_path):
    write_manifest(tmp_path, [duckdb_entry()])

    packages = native.load_manifest(tmp_path)

    assert len(packages) == 1
    assert packages[0].name == PACKAGE_NAME
    assert packages[0].group == "duckdb"


def test_load_manifest_survives_a_corrupted_file(tmp_path):
    (tmp_path / native.MANIFEST_NAME).write_text("{ not json", encoding="utf-8")

    assert native.load_manifest(tmp_path) == []


def test_load_manifest_survives_invalid_structure(tmp_path):
    (tmp_path / native.MANIFEST_NAME).write_text('{"group": "duckdb"}', encoding="utf-8")

    assert native.load_manifest(tmp_path) == []


def test_load_manifest_survives_incomplete_entries(tmp_path):
    write_manifest(tmp_path, [{"group": "duckdb", "name": PACKAGE_NAME}])

    assert native.load_manifest(tmp_path) == []


def test_tarball_url_follows_the_npm_layout(cache_root):
    package = native.NativePackage(**duckdb_entry())

    assert package.tarball_url == (
        "https://registry.npmjs.org/@duckdb/node-bindings-darwin-arm64/-/node-bindings-darwin-arm64-1.4.4-r.1.tgz"
    )


def test_tarball_url_honours_a_custom_registry(monkeypatch, cache_root):
    monkeypatch.setenv("NAO_NATIVE_REGISTRY", "https://mirror.internal/npm/")
    package = native.NativePackage(**duckdb_entry())

    assert package.tarball_url.startswith("https://mirror.internal/npm/@duckdb/")


def test_cache_dir_is_keyed_by_group_and_version(cache_root):
    package = native.NativePackage(**duckdb_entry())

    assert package.cache_dir == cache_root / "duckdb-1.4.4-r.1" / PACKAGE_NAME


def test_node_path_lists_group_roots_even_before_they_exist(tmp_path, cache_root):
    write_manifest(tmp_path, [duckdb_entry()])

    assert native.node_path(tmp_path) == str(cache_root / "duckdb-1.4.4-r.1")


def test_node_path_keeps_an_existing_value(tmp_path, cache_root):
    write_manifest(tmp_path, [duckdb_entry()])

    result = native.node_path(tmp_path, "/somewhere/node_modules")

    assert result.split(os.pathsep) == [str(cache_root / "duckdb-1.4.4-r.1"), "/somewhere/node_modules"]


def test_node_path_is_empty_when_nothing_is_downloadable(tmp_path):
    assert native.node_path(tmp_path) == ""


def test_ensure_group_downloads_verifies_and_unpacks(tmp_path, cache_root):
    payload = make_tarball({"package/duckdb.node": b"native code"})
    write_manifest(tmp_path, [duckdb_entry(integrity_of(payload))])

    with patch.object(native, "_download", side_effect=lambda _package, path: path.write_bytes(payload)):
        assert native.ensure_group(tmp_path, "duckdb") is True

    assert (cache_root / "duckdb-1.4.4-r.1" / PACKAGE_NAME / "duckdb.node").read_bytes() == b"native code"


def test_ensure_group_rejects_a_tampered_download(tmp_path, cache_root):
    payload = make_tarball({"package/duckdb.node": b"native code"})
    write_manifest(tmp_path, [duckdb_entry("sha512-" + base64.b64encode(b"wrong").decode())])

    with patch.object(native, "_download", side_effect=lambda _package, path: path.write_bytes(payload)):
        assert native.ensure_group(tmp_path, "duckdb") is False

    assert not (cache_root / "duckdb-1.4.4-r.1" / PACKAGE_NAME).exists()


def test_ensure_group_reports_a_failed_download(tmp_path, cache_root):
    write_manifest(tmp_path, [duckdb_entry()])

    with patch.object(native, "_download", side_effect=OSError("no network")):
        assert native.ensure_group(tmp_path, "duckdb") is False


def test_ensure_group_skips_work_when_already_cached(tmp_path, cache_root):
    write_manifest(tmp_path, [duckdb_entry()])
    (cache_root / "duckdb-1.4.4-r.1" / PACKAGE_NAME).mkdir(parents=True)

    with patch.object(native, "_download") as download:
        assert native.ensure_group(tmp_path, "duckdb") is True

    download.assert_not_called()


def test_install_treats_concurrent_cache_hit_as_success(tmp_path, cache_root):
    payload = make_tarball({"package/duckdb.node": b"native code"})
    package = native.NativePackage(**duckdb_entry(integrity_of(payload)))
    winner = cache_root / "duckdb-1.4.4-r.1" / PACKAGE_NAME
    winner.mkdir(parents=True)
    (winner / "duckdb.node").write_bytes(b"from winner")

    original_rename = Path.rename

    def rename_after_winner(self, target):
        if self.name == "package":
            raise OSError(66, "Directory not empty")
        return original_rename(self, target)

    with (
        patch.object(native, "_download", side_effect=lambda _package, path: path.write_bytes(payload)),
        patch.object(Path, "rename", rename_after_winner),
    ):
        native._install(package)

    assert (winner / "duckdb.node").read_bytes() == b"from winner"


def test_ensure_group_ignores_groups_that_are_bundled(tmp_path, cache_root):
    write_manifest(tmp_path, [duckdb_entry()])

    with patch.object(native, "_download") as download:
        assert native.ensure_group(tmp_path, "sandbox") is True

    download.assert_not_called()


def test_ensure_group_drops_a_previous_version_from_the_cache(tmp_path, cache_root):
    payload = make_tarball({"package/duckdb.node": b"native code"})
    write_manifest(tmp_path, [duckdb_entry(integrity_of(payload))])
    stale = cache_root / "duckdb-1.0.0" / PACKAGE_NAME
    stale.mkdir(parents=True)
    unrelated = cache_root / "sandbox-0.3.0"
    unrelated.mkdir(parents=True)

    with patch.object(native, "_download", side_effect=lambda _package, path: path.write_bytes(payload)):
        native.ensure_group(tmp_path, "duckdb")

    assert not stale.parent.exists()
    assert unrelated.exists()


def test_extract_skips_members_that_escape_the_destination(tmp_path, cache_root):
    payload = make_tarball({"package/ok.txt": b"fine", "../escaped.txt": b"bad"})
    archive = tmp_path / "package.tgz"
    archive.write_bytes(payload)
    destination = tmp_path / "out"
    destination.mkdir()

    native._extract(archive, destination)

    assert (destination / "package" / "ok.txt").exists()
    assert not (tmp_path / "escaped.txt").exists()
