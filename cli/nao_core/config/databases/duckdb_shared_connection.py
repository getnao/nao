"""Locked DuckDB connections that stay usable under concurrent queries.

Every connection to the same file within a process shares one DuckDB instance, and
`lock_configuration` applies to that whole instance: once a connection locks it, Ibis can
no longer apply its session settings on a new one. Concurrent callers therefore share one
locked root connection and each query through its own cursor. The root closes with its
last cursor so other processes (dbt, nao sync) can open the file between queries.
"""

from __future__ import annotations

import threading
from dataclasses import dataclass
from pathlib import Path

import ibis
from ibis.backends.duckdb import Backend

_registry_lock = threading.Lock()
_shared_roots: dict[str, _SharedRoot] = {}


def connect_shared(path: str) -> Backend:
    key = str(Path(path).resolve())
    with _registry_lock:
        root = _shared_roots.get(key) or _open_shared_root(key)
        cursor = root.backend.con.cursor()
        root.cursor_count += 1
    return _SharedCursorBackend.over(cursor, key)


def lock_down(backend: Backend) -> None:
    """Session defaults go global so cursors inherit them, then the instance is sealed."""
    backend.raw_sql("SET GLOBAL TimeZone = 'UTC'")
    backend.raw_sql("SET GLOBAL python_enable_replacements = false")
    backend.raw_sql("SET enable_external_access = false")
    backend.raw_sql("SET lock_configuration = true")


@dataclass
class _SharedRoot:
    backend: Backend
    cursor_count: int = 0


class _SharedCursorBackend(Backend):
    """Ibis backend over a cursor of an already locked root, which must not re-apply settings."""

    _shared_key: str

    @classmethod
    def over(cls, cursor, key: str) -> _SharedCursorBackend:
        backend = cls.from_connection(cursor)
        backend._shared_key = key
        return backend

    def _post_connect(self, extensions=None) -> None:
        self._record_batch_readers_consumed = {}

    def disconnect(self) -> None:
        try:
            super().disconnect()
        finally:
            _release_shared_root(self._shared_key)


def _open_shared_root(key: str) -> _SharedRoot:
    backend = ibis.duckdb.connect(database=key, read_only=True)
    try:
        lock_down(backend)
    except Exception:
        backend.disconnect()
        raise
    root = _SharedRoot(backend)
    _shared_roots[key] = root
    return root


def _release_shared_root(key: str) -> None:
    with _registry_lock:
        root = _shared_roots[key]
        root.cursor_count -= 1
        if root.cursor_count == 0:
            root.backend.disconnect()
            del _shared_roots[key]
