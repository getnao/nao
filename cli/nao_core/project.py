from pathlib import Path


def find_nao_project_root(start: Path | None = None) -> Path | None:
    current_path = (start or Path.cwd()).resolve()
    return next(
        (candidate for candidate in (current_path, *current_path.parents) if (candidate / "nao_config.yaml").is_file()),
        None,
    )
