"""Unit tests for DatabaseContext."""

from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock

import pandas as pd
import pytest
from pydantic import ValidationError

from nao_core.commands.sync.providers.databases.context import DatabaseContext
from nao_core.commands.sync.providers.databases.provider import _should_refresh
from nao_core.config.databases.base import ProfilingConfig, ProfilingRefreshPolicy


class TestDatabaseContext:
    def _make_context(self, exclude_columns: list[str] | None = None):
        mock_conn = MagicMock()
        mock_table = MagicMock()
        mock_schema = MagicMock()
        schema_items = [
            ("id", MagicMock(__str__=lambda s: "int64", nullable=False)),
            ("name", MagicMock(__str__=lambda s: "string", nullable=True)),
        ]
        mock_schema.items.return_value = schema_items
        mock_schema.__len__ = lambda s: len(schema_items)
        mock_table.schema.return_value = mock_schema
        mock_conn.table.return_value = mock_table
        ctx = DatabaseContext(mock_conn, "my_schema", "my_table", exclude_columns=exclude_columns)
        return ctx, mock_table

    def test_columns_returns_metadata(self):
        ctx, _ = self._make_context()
        columns = ctx.columns()

        assert len(columns) == 2
        assert columns[0]["name"] == "id"
        assert columns[0]["type"] == "int64"
        assert columns[1]["name"] == "name"
        assert columns[1]["type"] == "string"

    def test_preview_returns_rows(self):
        ctx, mock_table = self._make_context()
        df = pd.DataFrame({"id": [1, 2], "name": ["Alice", "Bob"]})
        mock_table.limit.return_value.execute.return_value = df

        rows = ctx.preview(limit=2)

        assert len(rows) == 2
        assert rows[0]["name"] == "Alice"
        mock_table.limit.assert_called_once_with(2)

    def test_preview_caps_oversized_values_and_keeps_other_columns(self):
        ctx, mock_table = self._make_context()
        ctx.set_preview_max_value_length(300)
        huge = "x" * 100_000
        df = pd.DataFrame({"id": [1], "name": ["Alice"], "area_geojson": [huge]})
        mock_table.limit.return_value.execute.return_value = df

        row = ctx.preview(limit=1)[0]

        assert row["id"] == 1
        assert row["name"] == "Alice"
        assert len(row["area_geojson"]) <= 300
        assert "…[truncated, 100000 chars]…" in row["area_geojson"]
        assert row["area_geojson"].startswith("xxx")
        assert row["area_geojson"].endswith("xxx")

    def test_preview_leaves_values_under_cap_untouched(self):
        ctx, mock_table = self._make_context()
        ctx.set_preview_max_value_length(300)
        value = "y" * 300
        df = pd.DataFrame({"id": [1], "name": [value]})
        mock_table.limit.return_value.execute.return_value = df

        row = ctx.preview(limit=1)[0]

        assert row["name"] == value

    def test_preview_caps_oversized_json_values(self):
        ctx, mock_table = self._make_context()
        ctx.set_preview_max_value_length(100)
        geometry = {"type": "Polygon", "coordinates": [[i, i] for i in range(500)]}
        df = pd.DataFrame({"id": [1], "name": ["Alice"]})
        df["geometry"] = [geometry]
        mock_table.limit.return_value.execute.return_value = df

        row = ctx.preview(limit=1)[0]

        assert isinstance(row["geometry"], str)
        assert len(row["geometry"]) <= 100
        assert row["geometry"].startswith('{"type": "Polygon"')

    def test_prepare_preview_row_filters_and_caps_for_backend_overrides(self):
        ctx, _ = self._make_context(exclude_columns=["*.secret"])
        ctx.set_preview_max_value_length(50)

        row = ctx._prepare_preview_row({"id": 1, "secret": "hidden", "blob": "z" * 500})

        assert "secret" not in row
        assert row["id"] == 1
        assert len(row["blob"]) <= 50
        assert "…[truncated, 500 chars]…" in row["blob"]

    def test_preview_cap_disabled_with_zero(self):
        ctx, mock_table = self._make_context()
        ctx.set_preview_max_value_length(0)
        huge = "x" * 100_000
        df = pd.DataFrame({"id": [1], "name": [huge]})
        mock_table.limit.return_value.execute.return_value = df

        row = ctx.preview(limit=1)[0]

        assert row["name"] == huge

    def test_row_count(self):
        ctx, mock_table = self._make_context()
        mock_table.count.return_value.execute.return_value = 42

        assert ctx.row_count() == 42

    def test_column_count(self):
        ctx, _ = self._make_context()
        assert ctx.column_count() == 2

    def test_description_returns_none_by_default(self):
        ctx, _ = self._make_context()
        assert ctx.description() is None

    def test_table_is_lazily_loaded(self):
        mock_conn = MagicMock()
        ctx = DatabaseContext(mock_conn, "schema", "table")

        mock_conn.table.assert_not_called()
        _ = ctx.table
        mock_conn.table.assert_called_once_with("table", database="schema")

    def test_table_is_cached(self):
        mock_conn = MagicMock()
        ctx = DatabaseContext(mock_conn, "schema", "table")

        _ = ctx.table
        _ = ctx.table
        mock_conn.table.assert_called_once()

    def test_should_not_refresh_when_recent(self, tmp_path):
        profiling_file = tmp_path / "profiling.md"
        recent_time = datetime.now(timezone.utc) - timedelta(hours=1)
        profiling_file.write_text(f"**Computed at:** `{recent_time.isoformat()}`\n")

        config = ProfilingConfig(refresh_policy=ProfilingRefreshPolicy.INTERVAL, interval_days=1)

        assert _should_refresh(profiling_file, config) is False

    def test_should_refresh_when_stale(self, tmp_path):
        profiling_file = tmp_path / "profiling.md"
        old_time = datetime.now(timezone.utc) - timedelta(days=2)
        profiling_file.write_text(f"**Computed at:** `{old_time.isoformat()}`\n")

        config = ProfilingConfig(refresh_policy=ProfilingRefreshPolicy.INTERVAL, interval_days=1)

        assert _should_refresh(profiling_file, config) is True

    def test_should_refresh_when_file_missing(self, tmp_path):
        profiling_file = tmp_path / "profiling.md"

        config = ProfilingConfig(refresh_policy=ProfilingRefreshPolicy.ONCE, interval_days=1)

        assert _should_refresh(profiling_file, config) is True

    def test_should_not_refresh_once_when_file_exists(self, tmp_path):
        profiling_file = tmp_path / "profiling.md"
        profiling_file.write_text("**Computed at:** `2026-01-01T00:00:00+00:00`\n")

        config = ProfilingConfig(refresh_policy=ProfilingRefreshPolicy.ONCE, interval_days=1)

        assert _should_refresh(profiling_file, config) is False

    def test_should_refresh_once_when_previous_render_failed(self, tmp_path):
        profiling_file = tmp_path / "profiling.md"
        profiling_file.write_text("# orders\n\nprofiling not generated: query timed out\n")

        config = ProfilingConfig(refresh_policy=ProfilingRefreshPolicy.ONCE, interval_days=1)

        assert _should_refresh(profiling_file, config) is True

    def test_should_not_refresh_once_when_file_is_not_decodable(self, tmp_path):
        profiling_file = tmp_path / "profiling.md"
        profiling_file.write_bytes(b"\xff\xfe\xfa invalid")

        config = ProfilingConfig(refresh_policy=ProfilingRefreshPolicy.ONCE, interval_days=1)

        assert _should_refresh(profiling_file, config) is False

    def test_interval_days_valid_with_interval_policy(self):
        config = ProfilingConfig(
            refresh_policy=ProfilingRefreshPolicy.INTERVAL,
            interval_days=3,
        )
        assert config.interval_days == 3

    def test_interval_days_must_be_positive(self):
        with pytest.raises(ValidationError):
            ProfilingConfig(
                refresh_policy=ProfilingRefreshPolicy.INTERVAL,
                interval_days=0,  # interdit par ge=1
            )

    def test_columns_filters_out_excluded_columns(self):
        ctx, _ = self._make_context(exclude_columns=["*.name"])
        columns = ctx.columns()

        assert [c["name"] for c in columns] == ["id"]

    def test_all_columns_returns_unfiltered_columns(self):
        ctx, _ = self._make_context(exclude_columns=["*.name"])

        columns = ctx.all_columns()

        assert columns is not None
        assert [column["name"] for column in columns] == ["id", "name"]

    def test_all_columns_returns_none_when_column_read_fails(self):
        ctx, mock_table = self._make_context()
        mock_table.schema.side_effect = RuntimeError("metadata unavailable")

        assert ctx.all_columns() is None

    def test_all_columns_returns_empty_when_column_read_succeeds_without_columns(self):
        ctx, mock_table = self._make_context()
        mock_table.schema.return_value.items.return_value = []

        assert ctx.all_columns() == []

    def test_columns_returns_all_when_pattern_does_not_match(self):
        ctx, _ = self._make_context(exclude_columns=["*.something_else"])
        columns = ctx.columns()

        assert [c["name"] for c in columns] == ["id", "name"]

    def test_columns_supports_schema_table_column_pattern(self):
        ctx, _ = self._make_context(exclude_columns=["my_schema.my_table.id"])
        columns = ctx.columns()

        assert [c["name"] for c in columns] == ["name"]

    def test_columns_supports_wildcard_table_segment(self):
        ctx, _ = self._make_context(exclude_columns=["*.*.id"])
        columns = ctx.columns()

        assert [c["name"] for c in columns] == ["name"]

    def test_preview_filters_out_excluded_columns(self):
        ctx, mock_table = self._make_context(exclude_columns=["*._peerdb_*", "*.name"])
        df = pd.DataFrame(
            {
                "id": [1, 2],
                "name": ["Alice", "Bob"],
                "_peerdb_version": [1, 1],
            }
        )
        mock_table.limit.return_value.execute.return_value = df

        rows = ctx.preview(limit=2)

        assert len(rows) == 2
        assert rows[0] == {"id": 1}
        assert rows[1] == {"id": 2}

    def test_set_exclude_columns_overrides_constructor_value(self):
        ctx, _ = self._make_context()
        ctx.set_exclude_columns(["*.name"])

        columns = ctx.columns()

        assert [c["name"] for c in columns] == ["id"]

    def test_set_exclude_columns_with_none_clears_filter(self):
        ctx, _ = self._make_context(exclude_columns=["*.name"])
        ctx.set_exclude_columns(None)

        columns = ctx.columns()

        assert [c["name"] for c in columns] == ["id", "name"]

    def test_column_count_uses_filtered_columns(self):
        ctx, _ = self._make_context(exclude_columns=["*.name"])
        assert ctx.column_count() == 1


class TestNormalizeType:
    def test_strips_not_null_suffix(self):
        assert DatabaseContext._normalize_type("int64 NOT NULL") == "int64"

    def test_int64_is_reported_as_is(self):
        assert DatabaseContext._normalize_type("int64") == "int64"

    def test_parameterized_string_collapses_to_string(self):
        assert DatabaseContext._normalize_type("String(255)") == "string"

    def test_other_types_pass_through(self):
        assert DatabaseContext._normalize_type("Int64") == "Int64"
        assert DatabaseContext._normalize_type("timestamp('UTC')") == "timestamp('UTC')"
