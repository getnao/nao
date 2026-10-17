"""Tests for the SQL result caps enforced by DatabaseConfig.execute_sql."""

from __future__ import annotations

import os
from unittest.mock import patch

import pandas as pd
import pytest

from nao_core.config.databases.base import DatabaseConfig
from nao_core.config.exceptions import ResultTooLargeError


class _FetchallCursor:
    """Cursor shape nao's execute_sql takes the fetchall streaming branch for."""

    def __init__(self, rows: list[tuple], columns: list[str]) -> None:
        self.description = [(name,) for name in columns]
        self._rows = rows
        self._offset = 0

    def fetchmany(self, size: int) -> list[tuple]:  # noqa: D401
        chunk = self._rows[self._offset : self._offset + size]
        self._offset += size
        return chunk

    def fetchall(self) -> list[tuple]:  # noqa: D401
        chunk = self._rows[self._offset :]
        self._offset = len(self._rows)
        return chunk


class _FetchallOnlyCursor:
    """Cursor shape for drivers that expose only fetchall (no fetchmany streaming).

    nao falls back to a single ``fetchall`` and the oversized result is caught by the post-fetch
    DataFrame cap. This cursor exercises that path.
    """

    def __init__(self, rows: list[tuple], columns: list[str]) -> None:
        self.description = [(name,) for name in columns]
        self._rows = rows
        self.fetchmany_called = False

    def fetchall(self) -> list[tuple]:  # noqa: D401
        return list(self._rows)


class _DataFrameCursor:
    """Cursor shape nao's execute_sql takes the fetchdf branch for."""

    def __init__(self, df: pd.DataFrame) -> None:
        self._df = df

    def fetchdf(self) -> pd.DataFrame:  # noqa: D401
        return self._df


class _StubBackend:
    def __init__(self, cursor: object) -> None:
        self._cursor = cursor
        self.disconnected = False

    def raw_sql(self, _sql: str) -> object:
        return self._cursor

    def disconnect(self) -> None:
        self.disconnected = True


def _run(cursor: object) -> pd.DataFrame:
    """Call execute_sql with a stub backend, bypassing config construction.

    ``execute_sql`` never dereferences ``self`` because ``conn`` is passed explicitly, so a plain
    class-attribute call is enough to exercise the function.
    """
    backend = _StubBackend(cursor)
    return DatabaseConfig.execute_sql(DatabaseConfig, "SELECT 1", backend)  # type: ignore[arg-type]


def test_fetchall_path_returns_rows_under_the_cap():
    cursor = _FetchallCursor(rows=[(i, f"v{i}") for i in range(5)], columns=["id", "name"])
    df = _run(cursor)
    assert list(df.columns) == ["id", "name"]
    assert len(df) == 5


def test_fetchall_path_aborts_before_materializing_everything_when_row_cap_is_hit():
    rows = [(i,) for i in range(50)]
    cursor = _FetchallCursor(rows=rows, columns=["id"])
    with patch.dict(os.environ, {"NAO_SQL_MAX_RESULT_ROWS": "10"}):
        with pytest.raises(ResultTooLargeError) as excinfo:
            _run(cursor)
    assert "more than 10 rows" in str(excinfo.value)
    assert "NAO_SQL_MAX_RESULT_ROWS" in str(excinfo.value)


def test_fetchall_path_aborts_when_byte_cap_is_hit():
    rows = [("x" * 1024,) for _ in range(100)]
    cursor = _FetchallCursor(rows=rows, columns=["payload"])
    with patch.dict(os.environ, {"NAO_SQL_MAX_RESULT_BYTES": "2048"}):
        with pytest.raises(ResultTooLargeError) as excinfo:
            _run(cursor)
    assert "bytes" in str(excinfo.value)


def test_dataframe_path_rejects_oversized_result_after_the_driver_materialized_it():
    df = pd.DataFrame({"id": range(100)})
    cursor = _DataFrameCursor(df)
    with patch.dict(os.environ, {"NAO_SQL_MAX_RESULT_ROWS": "10"}):
        with pytest.raises(ResultTooLargeError) as excinfo:
            _run(cursor)
    assert "100 rows exceed the cap of 10" in str(excinfo.value)


def test_dataframe_path_passes_results_within_the_cap_through_unchanged():
    df = pd.DataFrame({"id": [1, 2, 3]})
    cursor = _DataFrameCursor(df)
    result = _run(cursor)
    pd.testing.assert_frame_equal(result, df)


def test_invalid_env_values_fall_back_to_defaults_rather_than_disabling_the_cap():
    cursor = _FetchallCursor(rows=[(i,) for i in range(3)], columns=["id"])
    with patch.dict(os.environ, {"NAO_SQL_MAX_RESULT_ROWS": "not-a-number"}):
        df = _run(cursor)
    assert len(df) == 3


def test_fetchall_only_cursor_is_rejected_by_the_post_fetch_cap():
    """Drivers without `fetchmany` fall back to a single `fetchall`; the materialized DataFrame
    still trips the cap, even though it is caught after the fact rather than during streaming."""
    cursor = _FetchallOnlyCursor(rows=[(i,) for i in range(100)], columns=["id"])
    with patch.dict(os.environ, {"NAO_SQL_MAX_RESULT_ROWS": "10"}):
        with pytest.raises(ResultTooLargeError) as excinfo:
            _run(cursor)
    assert "100 rows exceed the cap of 10" in str(excinfo.value)


def test_byte_cap_counts_nested_values_not_only_their_container_header():
    """A row containing a nested list of distinct values must count every element against the
    byte cap. `sys.getsizeof` alone would see the top-level list as ~1,800 bytes; the deep sizer
    walks its elements so a pathological nested payload is caught before it can OOM the worker.

    Each payload entry is a distinct string so the sizer's object-identity dedup — correct for
    real memory accounting — does not fold them into one count. Real SQL rows return distinct
    objects for distinct values anyway.
    """
    big_payload = [f"row-{i}:" + "x" * 1024 for i in range(200)]  # ~200 KiB of distinct strings
    cursor = _FetchallCursor(rows=[(1, big_payload)], columns=["id", "payload"])
    with patch.dict(os.environ, {"NAO_SQL_MAX_RESULT_BYTES": "10000"}):
        with pytest.raises(ResultTooLargeError) as excinfo:
            _run(cursor)
    assert "bytes" in str(excinfo.value)


def test_memoryview_cells_count_against_the_byte_cap():
    """`sys.getsizeof` reports only the view object (~192 bytes) and excludes the backing buffer,
    so a large BLOB wrapped in memoryview would otherwise bypass the cap. The sizer must count
    `nbytes`."""
    big = memoryview(b"x" * (256 * 1024))
    cursor = _FetchallCursor(rows=[(1, big)], columns=["id", "blob"])
    with patch.dict(os.environ, {"NAO_SQL_MAX_RESULT_BYTES": "100000"}):
        with pytest.raises(ResultTooLargeError) as excinfo:
            _run(cursor)
    assert "bytes" in str(excinfo.value)


def test_pathologically_nested_cell_still_counts_every_descendant_against_the_byte_cap():
    """A payload nested far beyond CPython's recursion limit (~1000) must still have every
    descendant counted, so it trips the byte cap instead of silently slipping through. The sizer
    uses an iterative traversal — no RecursionError and no silent depth cutoff."""
    deep: list = []
    current = deep
    # ~1500 levels of nested empty lists — well past CPython's default recursion limit.
    for _ in range(1500):
        child: list = []
        current.append(child)
        current = child
    cursor = _FetchallCursor(rows=[(deep,)], columns=["payload"])
    # 1500 list objects × ~56 bytes/each ≈ 84 KB, so a 20 KB cap must trip.
    with patch.dict(os.environ, {"NAO_SQL_MAX_RESULT_BYTES": "20000"}):
        with pytest.raises(ResultTooLargeError) as excinfo:
            _run(cursor)
    assert "bytes" in str(excinfo.value)


def test_fetchmany_batch_shrinks_to_the_row_budget_so_a_tight_cap_cannot_overshoot():
    """fetchmany should request at most `max_rows + 1` rows per batch, so a cap of 5 does not
    cause the driver to materialize a full 10,000-row batch before the check runs."""
    requested_sizes: list[int] = []

    class _RecordingCursor:
        description = [("id",)]

        def __init__(self) -> None:
            self._offset = 0
            self._rows = [(i,) for i in range(100)]

        def fetchmany(self, size: int) -> list[tuple]:
            requested_sizes.append(size)
            chunk = self._rows[self._offset : self._offset + size]
            self._offset += size
            return chunk

        def fetchall(self) -> list[tuple]:  # pragma: no cover
            return self._rows[self._offset :]

    with patch.dict(os.environ, {"NAO_SQL_MAX_RESULT_ROWS": "5"}):
        with pytest.raises(ResultTooLargeError):
            _run(_RecordingCursor())

    assert requested_sizes, "fetchmany was never called"
    assert all(size <= 6 for size in requested_sizes), (
        f"fetchmany asked for more than max_rows+1 rows per batch: {requested_sizes}"
    )
