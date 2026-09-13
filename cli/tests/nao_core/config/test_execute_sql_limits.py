from unittest.mock import Mock

import pytest

from nao_core.config.databases.base import (
    QueryResultTooLargeError,
    dataframe_from_cursor,
)


class StreamingCursor:
    description = [("id",)]

    def __init__(self) -> None:
        self.fetchmany = Mock(side_effect=[[(1,), (2,)], [(3,)], []])
        self.fetchall = Mock(side_effect=AssertionError("fetchall must not be called"))


def test_dataframe_from_cursor_fetches_in_batches_without_fetchall():
    cursor = StreamingCursor()

    dataframe = dataframe_from_cursor(cursor, max_rows=3, max_bytes=1_000)

    assert dataframe is not None
    assert dataframe.to_dict(orient="records") == [{"id": 1}, {"id": 2}, {"id": 3}]
    cursor.fetchall.assert_not_called()
    assert cursor.fetchmany.call_count == 3


def test_dataframe_from_cursor_stops_when_the_row_budget_is_exceeded():
    cursor = StreamingCursor()

    with pytest.raises(QueryResultTooLargeError, match="row limit"):
        dataframe_from_cursor(cursor, max_rows=2, max_bytes=1_000)

    cursor.fetchall.assert_not_called()
