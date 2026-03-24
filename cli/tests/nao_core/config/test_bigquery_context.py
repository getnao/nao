# ABOUTME: Unit tests for BigQueryDatabaseContext partition-aware preview and row_count.
# ABOUTME: Uses mocks to verify reactive partition-filter behaviour without live BigQuery credentials.

from unittest.mock import MagicMock, patch

import pandas as pd
import pytest

from nao_core.config.databases.bigquery import (
    BigQueryConfig,
    BigQueryDatabaseContext,
    TablePartitionMetadata,
    _fetch_schema_partition_metadata,
)

PARTITION_ERROR = "Cannot query over table without a filter that can be used for partition elimination"


def _make_context(
    partition_metadata: TablePartitionMetadata | None = None,
    custom_filter: str | None = None,
) -> tuple[BigQueryDatabaseContext, MagicMock]:
    """Return a context with a mock connection and its mock table."""
    mock_conn = MagicMock()
    mock_table = MagicMock()
    mock_schema = MagicMock()
    schema_items = [
        ("id", MagicMock(__str__=lambda s: "int64", nullable=False)),
        ("event_date", MagicMock(__str__=lambda s: "date", nullable=False)),
        ("event_type", MagicMock(__str__=lambda s: "string", nullable=True)),
    ]
    mock_schema.items.return_value = schema_items
    mock_schema.keys.return_value = [name for name, _ in schema_items]
    mock_table.schema.return_value = mock_schema
    mock_conn.table.return_value = mock_table

    ctx = BigQueryDatabaseContext(
        mock_conn,
        "my_dataset",
        "events",
        project_id="my-project",
        partition_metadata=partition_metadata,
        custom_partition_filter=custom_filter,
    )
    return ctx, mock_conn


def _date_meta(col_type: str = "DATE") -> TablePartitionMetadata:
    return TablePartitionMetadata(
        partition_column="event_date",
        partition_column_type=col_type,
        last_partition_id="20260115",
        total_rows=2,
    )


class TestPreviewTriesSuperFirst:
    def test_no_metadata_delegates_to_super(self):
        ctx, _ = _make_context(partition_metadata=None)
        df = pd.DataFrame({"id": [1], "event_date": ["2026-01-15"], "event_type": ["click"]})
        ctx.table.limit.return_value.execute.return_value = df

        rows = ctx.preview(limit=1)

        assert len(rows) == 1
        ctx.table.limit.assert_called_once_with(1)

    def test_partitioned_table_tries_super_first(self):
        ctx, mock_conn = _make_context(partition_metadata=_date_meta())
        df = pd.DataFrame({"id": [1], "event_date": ["2026-01-15"], "event_type": ["click"]})
        ctx.table.limit.return_value.execute.return_value = df

        rows = ctx.preview(limit=1)

        assert len(rows) == 1
        ctx.table.limit.assert_called_once_with(1)
        mock_conn.raw_sql.assert_not_called()


class TestPreviewRetriesOnPartitionError:
    def test_date_partition_retries_with_date_filter(self):
        ctx, mock_conn = _make_context(partition_metadata=_date_meta("DATE"))
        ctx.table.limit.return_value.execute.side_effect = Exception(PARTITION_ERROR)
        mock_conn.raw_sql.return_value = [
            (1, "2026-01-15", "click"),
            (2, "2026-01-15", "view"),
        ]

        rows = ctx.preview(limit=10)

        assert len(rows) == 2
        sql = mock_conn.raw_sql.call_args[0][0]
        assert "my-project.my_dataset.events" in sql
        assert "WHERE `event_date` = DATE('2026-01-15')" in sql
        assert "LIMIT 10" in sql

    def test_timestamp_partition_uses_date_function(self):
        ctx, mock_conn = _make_context(partition_metadata=_date_meta("TIMESTAMP"))
        ctx.table.limit.return_value.execute.side_effect = Exception(PARTITION_ERROR)
        mock_conn.raw_sql.return_value = []

        ctx.preview(limit=5)

        sql = mock_conn.raw_sql.call_args[0][0]
        assert "WHERE DATE(`event_date`) = DATE('2026-01-15')" in sql

    def test_datetime_partition_uses_date_function(self):
        ctx, mock_conn = _make_context(partition_metadata=_date_meta("DATETIME"))
        ctx.table.limit.return_value.execute.side_effect = Exception(PARTITION_ERROR)
        mock_conn.raw_sql.return_value = []

        ctx.preview(limit=5)

        sql = mock_conn.raw_sql.call_args[0][0]
        assert "WHERE DATE(`event_date`) = DATE('2026-01-15')" in sql

    def test_integer_partition_uses_is_not_null(self):
        meta = TablePartitionMetadata(
            partition_column="month_key",
            partition_column_type="INTEGER",
            last_partition_id=None,
            total_rows=100,
        )
        ctx, mock_conn = _make_context(partition_metadata=meta)
        ctx.table.limit.return_value.execute.side_effect = Exception(PARTITION_ERROR)
        mock_conn.raw_sql.return_value = []

        ctx.preview()

        sql = mock_conn.raw_sql.call_args[0][0]
        assert "WHERE `month_key` IS NOT NULL" in sql

    def test_non_partition_error_is_reraised(self):
        ctx, _ = _make_context(partition_metadata=_date_meta())
        ctx.table.limit.return_value.execute.side_effect = Exception("Some unrelated database error")

        with pytest.raises(Exception, match="Some unrelated database error"):
            ctx.preview()

    def test_partition_error_with_no_metadata_and_no_columns_returns_empty(self):
        """When metadata is None and on-demand fetch finds no partition column, return []."""
        ctx, mock_conn = _make_context(partition_metadata=None)
        ctx.table.limit.return_value.execute.side_effect = Exception(PARTITION_ERROR)
        # On-demand fetch: PARTITIONS returns empty → filter is None → return []
        mock_conn.raw_sql.return_value = []

        rows = ctx.preview()

        assert rows == []

    def test_partition_error_with_no_metadata_uses_on_demand_filter(self):
        """When metadata is None, on-demand fetch provides the partition filter for preview."""
        ctx, mock_conn = _make_context(partition_metadata=None)
        ctx.table.limit.return_value.execute.side_effect = Exception(PARTITION_ERROR)
        mock_conn.raw_sql.side_effect = [
            # _fetch_safe_partition_filter: PARTITIONS query
            [(["20260312", "20260311"],)],
            # _fetch_safe_partition_filter: COLUMNS query
            [("server_received_at", "TIMESTAMP")],
            # _run_filtered_preview: the actual SELECT * query
            [(1, "2026-01-15", "click")],
        ]

        rows = ctx.preview(limit=10)

        assert len(rows) == 1
        preview_sql = mock_conn.raw_sql.call_args_list[2][0][0]
        assert "DATE(`server_received_at`) = DATE('2026-03-11')" in preview_sql

    def test_returns_rows_with_correct_column_mapping(self):
        ctx, mock_conn = _make_context(partition_metadata=_date_meta())
        ctx.table.limit.return_value.execute.side_effect = Exception(PARTITION_ERROR)
        mock_conn.raw_sql.return_value = [
            (1, "2026-01-15", "click"),
        ]

        rows = ctx.preview()

        assert rows == [{"id": 1, "event_date": "2026-01-15", "event_type": "click"}]


class TestPreviewWithCustomFilter:
    def test_custom_filter_skips_super(self):
        custom = "event_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 7 DAY)"
        ctx, mock_conn = _make_context(partition_metadata=_date_meta(), custom_filter=custom)
        mock_conn.raw_sql.return_value = []

        ctx.preview()

        ctx.table.limit.assert_not_called()
        sql = mock_conn.raw_sql.call_args[0][0]
        assert custom in sql

    def test_custom_filter_returns_mapped_rows(self):
        custom = "event_date = CURRENT_DATE()"
        ctx, mock_conn = _make_context(custom_filter=custom)
        mock_conn.raw_sql.return_value = [(1, "2026-01-15", "click")]

        rows = ctx.preview()

        assert rows == [{"id": 1, "event_date": "2026-01-15", "event_type": "click"}]

    def test_custom_filter_query_failure_returns_empty(self):
        ctx, mock_conn = _make_context(custom_filter="event_date = CURRENT_DATE()")
        mock_conn.raw_sql.side_effect = Exception("BigQuery error")

        rows = ctx.preview()

        assert rows == []


class TestPreviewGracefulDegradation:
    def test_retry_failure_returns_empty(self):
        ctx, mock_conn = _make_context(partition_metadata=_date_meta())
        ctx.table.limit.return_value.execute.side_effect = Exception(PARTITION_ERROR)
        mock_conn.raw_sql.side_effect = Exception("BigQuery error")

        rows = ctx.preview()

        assert rows == []

    def test_no_partition_column_returns_empty(self):
        meta = TablePartitionMetadata(
            partition_column=None,
            partition_column_type=None,
            last_partition_id=None,
            total_rows=None,
        )
        ctx, mock_conn = _make_context(partition_metadata=meta)
        ctx.table.limit.return_value.execute.side_effect = Exception(PARTITION_ERROR)

        rows = ctx.preview()

        assert rows == []
        mock_conn.raw_sql.assert_not_called()


class TestRowCount:
    def test_no_metadata_delegates_to_super(self):
        ctx, _ = _make_context(partition_metadata=None)
        ctx.table.count.return_value.execute.return_value = 42

        assert ctx.row_count() == 42
        ctx.table.count.assert_called_once()

    def test_partitioned_table_with_none_sum_returns_zero(self):
        """When INFORMATION_SCHEMA returns NULL for SUM, row_count() returns 0."""
        meta = TablePartitionMetadata(
            partition_column="event_date",
            partition_column_type="DATE",
            last_partition_id="20260310",
            total_rows=None,
        )
        ctx, mock_conn = _make_context(partition_metadata=meta)
        mock_conn.raw_sql.return_value = [(None,)]
        assert ctx.row_count() == 0

    def test_super_failure_non_partition_error_reraises(self):
        ctx, _ = _make_context(partition_metadata=None)
        ctx.table.count.return_value.execute.side_effect = Exception("Some unrelated error")

        with pytest.raises(Exception, match="Some unrelated error"):
            ctx.row_count()

    def test_partitioned_table_runs_fresh_sum_query(self):
        """For partitioned tables, row_count() must run a fresh SUM query, not use cached total_rows."""
        meta = TablePartitionMetadata(
            partition_column="event_date",
            partition_column_type="DATE",
            last_partition_id="20260310",
            total_rows=999,  # stale cached value — must NOT be returned
        )
        ctx, mock_conn = _make_context(partition_metadata=meta)
        mock_conn.raw_sql.return_value = [(123880,)]

        result = ctx.row_count()

        assert result == 123880
        sql = mock_conn.raw_sql.call_args[0][0]
        assert "SUM(total_rows)" in sql
        assert "INFORMATION_SCHEMA.PARTITIONS" in sql
        assert "my_dataset" in sql
        assert "events" in sql
        assert "__NULL__" not in sql
        ctx.table.count.assert_not_called()

    def test_partitioned_table_sum_query_returns_zero_on_streaming(self):
        """When PARTITIONS shows 0 (streaming), row_count() honestly returns 0."""
        meta = TablePartitionMetadata(
            partition_column="event_date",
            partition_column_type="DATE",
            last_partition_id=None,
            total_rows=0,
        )
        ctx, mock_conn = _make_context(partition_metadata=meta)
        mock_conn.raw_sql.return_value = [(0,)]

        result = ctx.row_count()

        assert result == 0
        ctx.table.count.assert_not_called()

    def test_partitioned_table_sum_query_failure_returns_zero(self):
        """If the INFORMATION_SCHEMA query fails, row_count() returns 0 gracefully."""
        meta = TablePartitionMetadata(
            partition_column="event_date",
            partition_column_type="DATE",
            last_partition_id="20260310",
            total_rows=None,
        )
        ctx, mock_conn = _make_context(partition_metadata=meta)
        mock_conn.raw_sql.side_effect = Exception("permission denied")

        result = ctx.row_count()

        assert result == 0
        ctx.table.count.assert_not_called()

    def test_non_partitioned_table_uses_super(self):
        """Non-partitioned tables still use ibis COUNT(*)."""
        ctx, _ = _make_context(partition_metadata=None)
        ctx.table.count.return_value.execute.return_value = 42

        assert ctx.row_count() == 42
        ctx.table.count.assert_called_once()

    def test_no_metadata_partition_error_falls_back_to_information_schema(self):
        """When metadata is None and ibis COUNT(*) throws a partition error, fall back to INFORMATION_SCHEMA."""
        ctx, mock_conn = _make_context(partition_metadata=None)
        ctx.table.count.return_value.execute.side_effect = Exception(PARTITION_ERROR)
        mock_conn.raw_sql.return_value = [(123880,)]

        result = ctx.row_count()

        assert result == 123880
        sql = mock_conn.raw_sql.call_args[0][0]
        assert "SUM(total_rows)" in sql
        assert "INFORMATION_SCHEMA.PARTITIONS" in sql

    def test_no_metadata_non_partition_error_reraises(self):
        """When metadata is None and ibis COUNT(*) throws an unrelated error, reraise it."""
        ctx, _ = _make_context(partition_metadata=None)
        ctx.table.count.return_value.execute.side_effect = Exception("network timeout")

        with pytest.raises(Exception, match="network timeout"):
            ctx.row_count()


class TestMetadataBatchCaching:
    def test_fetch_schema_metadata_called_once_across_multiple_create_context_calls(self):
        config = BigQueryConfig(name="test", project_id="my-project", dataset_id="my_dataset")
        mock_conn = MagicMock()

        with patch(
            "nao_core.config.databases.bigquery._fetch_schema_partition_metadata",
            return_value={},
        ) as mock_fetch:
            config.create_context(mock_conn, "my_dataset", "table_a")
            config.create_context(mock_conn, "my_dataset", "table_b")
            config.create_context(mock_conn, "my_dataset", "table_c")

        mock_fetch.assert_called_once_with(mock_conn, "my-project", "my_dataset")

    def test_different_schemas_each_trigger_one_fetch(self):
        config = BigQueryConfig(name="test", project_id="my-project")
        mock_conn = MagicMock()

        with patch(
            "nao_core.config.databases.bigquery._fetch_schema_partition_metadata",
            return_value={},
        ) as mock_fetch:
            config.create_context(mock_conn, "schema_a", "table_1")
            config.create_context(mock_conn, "schema_a", "table_2")
            config.create_context(mock_conn, "schema_b", "table_1")

        assert mock_fetch.call_count == 2
        mock_fetch.assert_any_call(mock_conn, "my-project", "schema_a")
        mock_fetch.assert_any_call(mock_conn, "my-project", "schema_b")

    def test_custom_partition_filter_passed_to_context(self):
        config = BigQueryConfig(
            name="test",
            project_id="my-project",
            partition_filters={"events": "event_date = CURRENT_DATE()"},
        )
        mock_conn = MagicMock()

        with patch("nao_core.config.databases.bigquery._fetch_schema_partition_metadata", return_value={}):
            ctx = config.create_context(mock_conn, "ds", "events")

        assert ctx._custom_partition_filter == "event_date = CURRENT_DATE()"

    def test_no_custom_filter_when_table_not_in_partition_filters(self):
        config = BigQueryConfig(
            name="test",
            project_id="my-project",
            partition_filters={"other_table": "date = CURRENT_DATE()"},
        )
        mock_conn = MagicMock()

        with patch("nao_core.config.databases.bigquery._fetch_schema_partition_metadata", return_value={}):
            ctx = config.create_context(mock_conn, "ds", "events")

        assert ctx._custom_partition_filter is None


class TestPartitionContextMethods:
    def test_is_partitioned_true_when_metadata_has_column(self):
        meta = TablePartitionMetadata(
            partition_column="event_date",
            partition_column_type="DATE",
            last_partition_id="20260310",
            total_rows=100,
        )
        ctx, _ = _make_context(partition_metadata=meta)
        assert ctx.is_partitioned() is True

    def test_is_partitioned_false_when_no_metadata(self):
        ctx, _ = _make_context(partition_metadata=None)
        assert ctx.is_partitioned() is False

    def test_is_partitioned_false_when_metadata_has_no_column(self):
        meta = TablePartitionMetadata(
            partition_column=None,
            partition_column_type=None,
            last_partition_id=None,
            total_rows=None,
        )
        ctx, _ = _make_context(partition_metadata=meta)
        assert ctx.is_partitioned() is False

    def test_active_partition_filter_returns_custom_when_set(self):
        custom = "event_date >= DATE_SUB(CURRENT_DATE(), INTERVAL 7 DAY)"
        ctx, _ = _make_context(partition_metadata=_date_meta(), custom_filter=custom)
        assert ctx.active_partition_filter() == custom

    def test_active_partition_filter_builds_from_metadata(self):
        ctx, _ = _make_context(partition_metadata=_date_meta("DATE"))
        assert ctx.active_partition_filter() == "`event_date` = DATE('2026-01-15')"

    def test_active_partition_filter_none_when_no_metadata_and_no_columns(self):
        ctx, mock_conn = _make_context(partition_metadata=None)
        # On-demand fetch finds no partition info
        mock_conn.raw_sql.return_value = []
        assert ctx.active_partition_filter() is None

    def test_partition_columns_uses_metadata_without_extra_queries(self):
        """partition_columns() must use metadata when available — no raw_sql calls."""
        meta = TablePartitionMetadata(
            partition_column="event_date",
            partition_column_type="DATE",
            last_partition_id="20260310",
            total_rows=100,
        )
        ctx, mock_conn = _make_context(partition_metadata=meta)

        cols = ctx.partition_columns()

        assert "event_date" in cols
        mock_conn.raw_sql.assert_not_called()

    def test_requires_partition_filter_true_when_metadata_says_so(self):
        meta = TablePartitionMetadata(
            partition_column="event_date",
            partition_column_type="DATE",
            last_partition_id="20260310",
            total_rows=100,
            require_partition_filter=True,
        )
        ctx, _ = _make_context(partition_metadata=meta)
        assert ctx.requires_partition_filter() is True

    def test_requires_partition_filter_false_by_default(self):
        ctx, _ = _make_context(partition_metadata=None)
        assert ctx.requires_partition_filter() is False


class TestProactivePreview:
    def test_require_filter_skips_super_entirely(self):
        """When require_partition_filter=True, must NOT call super().preview() at all."""
        meta = TablePartitionMetadata(
            partition_column="event_date",
            partition_column_type="DATE",
            last_partition_id="20260310",
            total_rows=1000,
            require_partition_filter=True,
        )
        ctx, mock_conn = _make_context(partition_metadata=meta)
        mock_conn.raw_sql.return_value = [(1, "2026-03-10", "click")]

        rows = ctx.preview(limit=5)

        ctx.table.limit.assert_not_called()
        assert len(rows) == 1
        sql = mock_conn.raw_sql.call_args[0][0]
        assert "WHERE `event_date` = DATE('2026-03-10')" in sql
        assert "LIMIT 5" in sql

    def test_require_filter_false_still_tries_super_first(self):
        """When require_partition_filter=False, keeps reactive behaviour."""
        meta = TablePartitionMetadata(
            partition_column="event_date",
            partition_column_type="DATE",
            last_partition_id="20260310",
            total_rows=1000,
            require_partition_filter=False,
        )
        ctx, mock_conn = _make_context(partition_metadata=meta)
        df = pd.DataFrame({"id": [1], "event_date": ["2026-03-10"], "event_type": ["click"]})
        ctx.table.limit.return_value.execute.return_value = df

        rows = ctx.preview(limit=1)

        assert len(rows) == 1
        ctx.table.limit.assert_called_once_with(1)
        mock_conn.raw_sql.assert_not_called()

    def test_require_filter_no_metadata_returns_empty(self):
        """If no metadata and partition error, return empty list gracefully."""
        ctx, mock_conn = _make_context(partition_metadata=None)
        ctx.table.limit.return_value.execute.side_effect = Exception(PARTITION_ERROR)

        rows = ctx.preview()

        assert rows == []


class TestBuildPartitionFilter:
    def _ctx_and_meta(
        self, col_type: str, last_partition_id: str | None
    ) -> tuple[BigQueryDatabaseContext, TablePartitionMetadata]:
        meta = TablePartitionMetadata(
            partition_column="event_date",
            partition_column_type=col_type,
            last_partition_id=last_partition_id,
            total_rows=None,
        )
        ctx, _ = _make_context(partition_metadata=meta)
        return ctx, meta

    def test_date_with_last_partition_id(self):
        ctx, meta = self._ctx_and_meta("DATE", "20260310")
        assert ctx._build_partition_filter(meta) == "`event_date` = DATE('2026-03-10')"

    def test_timestamp_with_last_partition_id(self):
        ctx, meta = self._ctx_and_meta("TIMESTAMP", "20260310")
        assert ctx._build_partition_filter(meta) == "DATE(`event_date`) = DATE('2026-03-10')"

    def test_date_without_last_partition_id_uses_current_date(self):
        ctx, meta = self._ctx_and_meta("DATE", None)
        assert ctx._build_partition_filter(meta) == "`event_date` = CURRENT_DATE()"

    def test_timestamp_without_last_partition_id_uses_current_date(self):
        ctx, meta = self._ctx_and_meta("TIMESTAMP", None)
        assert ctx._build_partition_filter(meta) == "DATE(`event_date`) = CURRENT_DATE()"

    def test_datetime_without_last_partition_id_uses_current_date(self):
        ctx, meta = self._ctx_and_meta("DATETIME", None)
        assert ctx._build_partition_filter(meta) == "DATE(`event_date`) = CURRENT_DATE()"

    def test_integer_without_last_partition_id_keeps_is_not_null(self):
        ctx, meta = self._ctx_and_meta("INTEGER", None)
        assert ctx._build_partition_filter(meta) == "`event_date` IS NOT NULL"

    def test_no_partition_column_returns_none(self):
        meta = TablePartitionMetadata(
            partition_column=None,
            partition_column_type=None,
            last_partition_id=None,
            total_rows=None,
        )
        ctx, _ = _make_context(partition_metadata=meta)
        assert ctx._build_partition_filter(meta) is None

    def test_integer_with_last_partition_id(self):
        meta = TablePartitionMetadata(
            partition_column="month_key",
            partition_column_type="INTEGER",
            last_partition_id="2000",
            total_rows=None,
        )
        ctx, _ = _make_context(partition_metadata=meta)
        assert ctx._build_partition_filter(meta) == "`month_key` = 2000"

    def test_date_with_monthly_partition_id(self):
        ctx, meta = self._ctx_and_meta("DATE", "202603")
        assert ctx._build_partition_filter(meta) == "DATE_TRUNC(`event_date`, MONTH) = DATE('2026-03-01')"

    def test_date_with_yearly_partition_id(self):
        ctx, meta = self._ctx_and_meta("DATE", "2026")
        assert ctx._build_partition_filter(meta) == "EXTRACT(YEAR FROM `event_date`) = 2026"

    def test_date_with_hourly_partition_id(self):
        ctx, meta = self._ctx_and_meta("DATE", "2026031014")
        assert ctx._build_partition_filter(meta) == "`event_date` = DATE('2026-03-10')"

    def test_timestamp_with_monthly_partition_id(self):
        ctx, meta = self._ctx_and_meta("TIMESTAMP", "202603")
        assert ctx._build_partition_filter(meta) == "DATE_TRUNC(DATE(`event_date`), MONTH) = DATE('2026-03-01')"

    def test_timestamp_with_yearly_partition_id(self):
        ctx, meta = self._ctx_and_meta("TIMESTAMP", "2026")
        assert ctx._build_partition_filter(meta) == "EXTRACT(YEAR FROM `event_date`) = 2026"


class TestFetchSchemaPartitionMetadata:
    def _mock_conn(self, column_rows, partition_rows, required_filter_table_names):
        """Helper: build a mock conn whose raw_sql returns appropriate rows per call."""
        mock_conn = MagicMock()
        results = [
            column_rows,
            partition_rows,
            [(name,) for name in required_filter_table_names],
        ]
        mock_conn.raw_sql.side_effect = results
        return mock_conn

    def test_require_partition_filter_set_true_for_matching_table(self):
        conn = self._mock_conn(
            column_rows=[("events_v1", "event_date", "DATE")],
            partition_rows=[("events_v1", ["20260310"], 5000)],
            required_filter_table_names=["events_v1"],
        )

        result = _fetch_schema_partition_metadata(conn, "my-project", "my_schema")

        assert result["events_v1"].require_partition_filter is True

    def test_require_partition_filter_false_when_not_in_results(self):
        conn = self._mock_conn(
            column_rows=[("events_v1", "event_date", "DATE")],
            partition_rows=[("events_v1", ["20260310"], 5000)],
            required_filter_table_names=[],
        )

        result = _fetch_schema_partition_metadata(conn, "my-project", "my_schema")

        assert result["events_v1"].require_partition_filter is False

    def test_require_partition_filter_uses_table_options_query(self):
        """The query for require_partition_filter must target TABLE_OPTIONS."""
        conn = self._mock_conn(
            column_rows=[("events_v1", "event_date", "DATE")],
            partition_rows=[("events_v1", ["20260310"], 5000)],
            required_filter_table_names=["events_v1"],
        )

        _fetch_schema_partition_metadata(conn, "my-project", "my_schema")

        third_call_sql = conn.raw_sql.call_args_list[2][0][0]
        assert "INFORMATION_SCHEMA.TABLE_OPTIONS" in third_call_sql
        assert "option_name" in third_call_sql
        assert "require_partition_filter" in third_call_sql
        assert "INFORMATION_SCHEMA.TABLES" not in third_call_sql

    def test_require_partition_filter_query_failure_does_not_crash(self):
        mock_conn = MagicMock()
        mock_conn.raw_sql.side_effect = [
            [],
            [],
            Exception("permission denied"),
        ]

        result = _fetch_schema_partition_metadata(mock_conn, "my-project", "my_schema")

        assert result == {}

    def test_uses_second_newest_partition_when_available(self):
        """last_partition_id should be the 2nd newest (closed), not the newest (may still be open)."""
        conn = self._mock_conn(
            column_rows=[("events_v1", "event_date", "DATE")],
            partition_rows=[("events_v1", ["20260312", "20260311"], 5000)],
            required_filter_table_names=[],
        )

        result = _fetch_schema_partition_metadata(conn, "my-project", "my_schema")

        assert result["events_v1"].last_partition_id == "20260311"

    def test_uses_only_partition_when_just_one_exists(self):
        """When only one partition exists (newest = only), use it."""
        conn = self._mock_conn(
            column_rows=[("events_v1", "event_date", "DATE")],
            partition_rows=[("events_v1", ["20260310"], 5000)],
            required_filter_table_names=[],
        )

        result = _fetch_schema_partition_metadata(conn, "my-project", "my_schema")

        assert result["events_v1"].last_partition_id == "20260310"


class TestActivePartitionFilter:
    def test_returns_none_when_no_metadata_and_on_demand_finds_nothing(self):
        """When metadata is None and on-demand fetch finds no partition, returns None."""
        ctx, mock_conn = _make_context(partition_metadata=None)
        # Both on-demand queries return empty
        mock_conn.raw_sql.return_value = []

        assert ctx.active_partition_filter() is None

    def test_returns_filter_from_metadata_when_available(self):
        meta = TablePartitionMetadata(
            partition_column="event_date",
            partition_column_type="DATE",
            last_partition_id="20260310",
            total_rows=100,
        )
        ctx, _ = _make_context(partition_metadata=meta)
        assert ctx.active_partition_filter() == "`event_date` = DATE('2026-03-10')"

    def test_no_metadata_on_demand_fetch_returns_filter(self):
        """When metadata is None, on-demand fetch builds a filter from INFORMATION_SCHEMA."""
        ctx, mock_conn = _make_context(partition_metadata=None)
        mock_conn.raw_sql.side_effect = [
            [(["20260312", "20260311"],)],
            [("server_received_at", "TIMESTAMP")],
        ]

        result = ctx.active_partition_filter()

        assert result == "DATE(`server_received_at`) = DATE('2026-03-11')"


class TestTablePartitionMetadata:
    def test_require_partition_filter_defaults_to_false(self):
        meta = TablePartitionMetadata(
            partition_column="event_date",
            partition_column_type="DATE",
            last_partition_id="20260310",
            total_rows=100,
        )
        assert meta.require_partition_filter is False

    def test_require_partition_filter_can_be_set_true(self):
        meta = TablePartitionMetadata(
            partition_column="event_date",
            partition_column_type="DATE",
            last_partition_id="20260310",
            total_rows=100,
            require_partition_filter=True,
        )
        assert meta.require_partition_filter is True
