import re
from typing import Any

import pandas as pd

_CURRENCY_PREFIX = re.compile(r"^[\$€£¥₹]")
_US_NUMBER = re.compile(r"^-?[\d,]+(\.\d+)?$")
_PLAIN_NUMBER = re.compile(r"^-?\d+(\.\d+)?$")
_EU_NUMBER = re.compile(r"^-?[\d.]+,\d+$")
_EU_THOUSANDS = re.compile(r"^-?\d{1,3}(\.\d{3})+$")


def normalize_formatted_number(value: Any) -> Any:
    """Parse locale-formatted number strings so they compare equal to raw numerics."""
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return value
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return value
    if not isinstance(value, str):
        return value

    text = value.strip()
    if not text:
        return value

    cleaned = _CURRENCY_PREFIX.sub("", text).strip()
    cleaned = re.sub(r"[\s\u00a0\u202f]", "", cleaned)

    parsed = _parse_numeric_string(cleaned)
    return parsed if parsed is not None else value


def normalize_dataframe_numbers(df: pd.DataFrame) -> pd.DataFrame:
    """Normalize formatted number strings in every column."""
    result = df.copy()
    for col in result.columns:
        result[col] = result[col].map(normalize_formatted_number)
    return result


def _parse_numeric_string(value: str) -> float | None:
    if not value or value in ("-", "+"):
        return None

    negative = value.startswith("-")
    unsigned = value[1:] if negative else value
    if unsigned.startswith("+"):
        unsigned = unsigned[1:]

    parsed: float | None = None
    if _US_NUMBER.fullmatch(unsigned):
        parsed = float(unsigned.replace(",", ""))
    elif _PLAIN_NUMBER.fullmatch(unsigned):
        parsed = float(unsigned)
    elif _EU_NUMBER.fullmatch(unsigned):
        parsed = float(unsigned.replace(".", "").replace(",", "."))
    elif _EU_THOUSANDS.fullmatch(unsigned):
        parsed = float(unsigned.replace(".", ""))

    if parsed is None:
        return None
    return -parsed if negative else parsed
