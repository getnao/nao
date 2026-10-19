import base64
import json
import math
import re
from datetime import date, datetime, time
from typing import Annotated, Literal

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    JsonValue,
    StringConstraints,
    field_validator,
    model_validator,
)


class StrictRequestModel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)


BoundedIdentity = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=1, max_length=255),
]
ConstraintColumn = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=1, max_length=255),
]
ROW_SECURITY_MAX_AGGREGATE_PREDICATE_LENGTH = 1_000_000
ROW_SECURITY_MAX_REASON_LENGTH = 10_000
ROW_SECURITY_MAX_TABLES = 10_000


class TableAccessTable(StrictRequestModel):
    database_type: str = Field(min_length=1)
    database: str = Field(min_length=1)
    schema_name: str = Field(alias="schema", min_length=1)
    table: str = Field(min_length=1)


class UnenforcedTableAccess(StrictRequestModel):
    enforced: Literal[False]


class EnforcedTableAccess(StrictRequestModel):
    enforced: Literal[True]
    tables: list[TableAccessTable] = Field(max_length=ROW_SECURITY_MAX_TABLES)


TableAccess = Annotated[
    UnenforcedTableAccess | EnforcedTableAccess,
    Field(discriminator="enforced"),
]


class RowSecurityTableBase(StrictRequestModel):
    database_type: BoundedIdentity
    database: BoundedIdentity
    schema_name: BoundedIdentity = Field(alias="schema")
    table: BoundedIdentity
    constraint_columns: list[ConstraintColumn] = Field(min_length=1, max_length=256)

    @field_validator("constraint_columns")
    @classmethod
    def validate_unique_constraint_columns(cls, value: list[str]):
        if len(value) != len(set(value)):
            raise ValueError("constraint_columns must not contain duplicates")
        return value


class NoRowAccessTable(RowSecurityTableBase):
    access: Literal["none"]


class FullRowAccessTable(RowSecurityTableBase):
    access: Literal["full"]


class PredicateRowAccessTable(RowSecurityTableBase):
    access: Literal["predicate"]
    predicate: str = Field(min_length=1, max_length=ROW_SECURITY_MAX_AGGREGATE_PREDICATE_LENGTH)


class BlockedRowAccessTable(RowSecurityTableBase):
    access: Literal["blocked"]
    reason: str = Field(min_length=1, max_length=ROW_SECURITY_MAX_REASON_LENGTH)


RowSecurityTable = Annotated[
    NoRowAccessTable | FullRowAccessTable | PredicateRowAccessTable | BlockedRowAccessTable,
    Field(discriminator="access"),
]


class UnenforcedRowSecurity(StrictRequestModel):
    enforced: Literal[False]


class EnforcedRowSecurity(StrictRequestModel):
    enforced: Literal[True]
    tables: list[RowSecurityTable] = Field(max_length=ROW_SECURITY_MAX_TABLES)


RowSecurity = Annotated[
    UnenforcedRowSecurity | EnforcedRowSecurity,
    Field(discriminator="enforced"),
]


class BigQueryArrayParameter(StrictRequestModel):
    name: Annotated[
        str,
        StringConstraints(
            strip_whitespace=True,
            min_length=1,
            max_length=128,
            pattern=r"^[A-Za-z_][A-Za-z0-9_]*$",
        ),
    ]
    type: Literal[
        "STRING",
        "INT64",
        "FLOAT64",
        "BOOL",
        "NUMERIC",
        "BIGNUMERIC",
        "DATE",
        "DATETIME",
        "TIME",
        "TIMESTAMP",
        "INTERVAL",
        "BYTES",
        "GEOGRAPHY",
        "JSON",
    ]
    values: list[JsonValue]

    @model_validator(mode="after")
    def validate_values_match_type(self):
        if any(not _is_bigquery_parameter_value(self.type, value) for value in self.values):
            raise ValueError(f"values must be compatible with BigQuery {self.type}")
        return self


class ExecuteSQLRequest(StrictRequestModel):
    sql: str
    nao_project_folder: str
    table_access: TableAccess
    row_security: RowSecurity
    database_id: str | None = None
    env_vars: dict[str, str] | None = None
    azure_access_token: str | None = None
    enforce_excluded_columns: bool = False
    query_parameters: list[BigQueryArrayParameter] = Field(
        default_factory=list,
        max_length=10_000,
    )

    @field_validator("query_parameters")
    @classmethod
    def validate_unique_query_parameter_names(cls, value):
        names = [parameter.name for parameter in value]
        if len(names) != len(set(names)):
            raise ValueError("query parameter names must be unique")
        return value

    @field_validator("table_access", mode="before")
    @classmethod
    def validate_table_access_discriminant(cls, value):
        if not isinstance(value, dict) or not isinstance(value.get("enforced"), bool):
            raise ValueError("table_access.enforced must be a boolean")
        return value

    @field_validator("row_security", mode="before")
    @classmethod
    def validate_row_security_discriminant(cls, value):
        if not isinstance(value, dict) or not isinstance(value.get("enforced"), bool):
            raise ValueError("row_security.enforced must be a boolean")
        return value


class ExecuteSQLResponse(BaseModel):
    data: list[dict]
    row_count: int
    columns: list[str]
    dialect: str | None = None


class ValidateSQLResponse(BaseModel):
    valid: Literal[True]
    dialect: str


class ValidateRowPredicateRequest(StrictRequestModel):
    predicate: str = Field(min_length=1, max_length=10_000)
    constraint_columns: list[ConstraintColumn] = Field(min_length=1, max_length=256)
    database_type: BoundedIdentity

    @field_validator("constraint_columns")
    @classmethod
    def validate_unique_constraint_columns(cls, value: list[str]):
        if len(value) != len(set(value)):
            raise ValueError("constraint_columns must not contain duplicates")
        return value


class ValidateRowPredicateResponse(BaseModel):
    valid: Literal[True]
    normalized_predicate: str


class HealthResponse(BaseModel):
    status: str
    context_source: str
    context_initialized: bool
    refresh_schedule: str | None


def _is_bigquery_parameter_value(parameter_type: str, value: JsonValue) -> bool:
    try:
        if parameter_type == "STRING":
            return isinstance(value, str)
        if parameter_type == "INT64":
            if isinstance(value, bool) or not isinstance(value, (int, str)):
                return False
            if isinstance(value, str) and re.fullmatch(r"-?\d+", value) is None:
                return False
            return -(2**63) <= int(value) < 2**63
        if parameter_type == "FLOAT64":
            return not isinstance(value, bool) and isinstance(value, (int, float)) and math.isfinite(value)
        if parameter_type in {"NUMERIC", "BIGNUMERIC"}:
            return isinstance(value, str) and re.fullmatch(
                r"[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?",
                value,
            ) is not None
        if parameter_type == "BOOL":
            return isinstance(value, bool)
        if parameter_type == "DATE":
            if not isinstance(value, str):
                return False
            date.fromisoformat(value)
            return True
        if parameter_type == "DATETIME":
            if not isinstance(value, str):
                return False
            return datetime.fromisoformat(value).tzinfo is None
        if parameter_type == "TIME":
            if not isinstance(value, str):
                return False
            return time.fromisoformat(value).tzinfo is None
        if parameter_type == "TIMESTAMP":
            if not isinstance(value, str):
                return False
            datetime.fromisoformat(value.replace("Z", "+00:00"))
            return True
        if parameter_type == "INTERVAL":
            return isinstance(value, str) and re.fullmatch(
                r"-?\d+-\d+ -?\d+ -?\d+:\d+:\d+(?:\.\d*)?",
                value,
            ) is not None
        if parameter_type == "BYTES":
            return isinstance(value, str) and base64.b64decode(value, validate=True) is not None
        if parameter_type == "GEOGRAPHY":
            return isinstance(value, str) and bool(value.strip())
        if parameter_type == "JSON":
            if isinstance(value, str):
                json.loads(value)
            else:
                json.dumps(value, allow_nan=False)
            return value is not None
    except (AttributeError, OverflowError, TypeError, ValueError):
        return False
    return False
