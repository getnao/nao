import json

from nao_core.config.databases import parse_database_config


def prepare_warehouse_config(
    project_name: str,
    provider: str,
    credentials: dict[str, object],
) -> tuple[dict[str, object], dict[str, str]]:
    config = parse_database_config(
        {
            **credentials,
            "type": provider,
            "name": project_name,
        }
    )

    database_config = {
        "type": provider,
        "name": project_name,
    }
    env_vars: dict[str, str] = {}
    values = config.model_dump(include=config.model_fields_set, mode="json")

    for field_name in sorted(config.model_fields_set - {"type", "name"}):
        value = values[field_name]
        if value is None:
            continue

        database_config[field_name] = replace_with_env_references(
            value,
            [provider, field_name],
            env_vars,
        )

    return database_config, env_vars


def replace_with_env_references(
    value: object,
    path: list[str],
    env_vars: dict[str, str],
) -> object:
    if isinstance(value, dict):
        return {
            str(key): replace_with_env_references(
                nested_value,
                [*path, str(key)],
                env_vars,
            )
            for key, nested_value in value.items()
        }

    if isinstance(value, list):
        return [
            replace_with_env_references(
                nested_value,
                [*path, str(index)],
                env_vars,
            )
            for index, nested_value in enumerate(value)
        ]

    if value is None:
        return None

    env_name = "NAO_ONBOARDING_" + "_".join(
        part.upper().replace("-", "_") for part in path
    )
    if env_name in env_vars:
        raise ValueError(f"Conflicting onboarding environment variable: {env_name}")
    env_vars[env_name] = json.dumps(value)

    return f"${{{{ env('{env_name}') }}}}"
