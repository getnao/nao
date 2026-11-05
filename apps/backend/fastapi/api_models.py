from typing import Annotated, Literal

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
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


class ColumnSecurityTableBase(StrictRequestModel):
    database_type: BoundedIdentity
    database: BoundedIdentity
    schema_name: BoundedIdentity = Field(alias="schema")
    table: BoundedIdentity
    restricted_columns: list[ConstraintColumn] = Field(min_length=1, max_length=256)

    @field_validator("restricted_columns")
    @classmethod
    def validate_unique_restricted_columns(cls, value: list[str]):
        if len(value) != len(set(value)):
            raise ValueError("restricted_columns must not contain duplicates")
        return value


class FullColumnAccessTable(ColumnSecurityTableBase):
    access: Literal["full"]


class RestrictedColumnAccessTable(ColumnSecurityTableBase):
    access: Literal["restricted"]
    denied_columns: list[ConstraintColumn] = Field(min_length=1, max_length=256)

    @field_validator("denied_columns")
    @classmethod
    def validate_denied_columns(cls, value: list[str]):
        if len(value) != len(set(value)):
            raise ValueError("denied_columns must not contain duplicates")
        return value

    @model_validator(mode="after")
    def validate_denied_columns_are_restricted(self):
        if any(column not in self.restricted_columns for column in self.denied_columns):
            raise ValueError("denied_columns must be a subset of restricted_columns")
        return self


class BlockedColumnAccessTable(ColumnSecurityTableBase):
    access: Literal["blocked"]
    reason: str = Field(min_length=1, max_length=ROW_SECURITY_MAX_REASON_LENGTH)


ColumnSecurityTable = Annotated[
    FullColumnAccessTable | RestrictedColumnAccessTable | BlockedColumnAccessTable,
    Field(discriminator="access"),
]


class UnenforcedColumnSecurity(StrictRequestModel):
    enforced: Literal[False]


class EnforcedColumnSecurity(StrictRequestModel):
    enforced: Literal[True]
    tables: list[ColumnSecurityTable] = Field(max_length=ROW_SECURITY_MAX_TABLES)


ColumnSecurity = Annotated[
    UnenforcedColumnSecurity | EnforcedColumnSecurity,
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


class ExecuteSQLRequest(StrictRequestModel):
    sql: str
    nao_project_folder: str
    table_access: TableAccess
    column_security: ColumnSecurity = UnenforcedColumnSecurity(enforced=False)
    row_security: RowSecurity
    database_id: str | None = None
    env_vars: dict[str, str] | None = None
    azure_access_token: str | None = None
    enforce_excluded_columns: bool = False

    @field_validator("table_access", mode="before")
    @classmethod
    def validate_table_access_discriminant(cls, value):
        if not isinstance(value, dict) or not isinstance(value.get("enforced"), bool):
            raise ValueError("table_access.enforced must be a boolean")
        return value

    @field_validator("column_security", mode="before")
    @classmethod
    def validate_column_security_discriminant(cls, value):
        if not isinstance(value, dict) or not isinstance(value.get("enforced"), bool):
            raise ValueError("column_security.enforced must be a boolean")
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
