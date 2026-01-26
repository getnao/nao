"""Template engine for rendering Jinja2 templates with user overrides."""

from pathlib import Path
from typing import Any

from jinja2 import Environment, FileSystemLoader, select_autoescape

# Path to the default templates shipped with nao
DEFAULT_TEMPLATES_DIR = Path(__file__).parent / "defaults"


class TemplateEngine:
    """Jinja2 template engine with support for user overrides.

    Templates are looked up in the following order:
    1. User's project `templates/` directory (if exists)
    2. Default templates shipped with nao

    This allows users to customize output by creating a `templates/` folder
    in their nao project and adding templates with the same names as the defaults.

    Example:
        If the default template is `databases/preview.md.j2`, the user can
        override it by creating `<project_root>/templates/databases/preview.md.j2`.
    """

    def __init__(self, project_path: Path | None = None):
        """Initialize the template engine.

        Args:
            project_path: Path to the nao project root. If provided,
                          templates in `<project_path>/templates/` will
                          take precedence over defaults.
        """
        self.project_path = project_path
        self.user_templates_dir = project_path / "templates" if project_path else None

        # Build list of template directories (user templates first for override)
        loader_paths: list[Path] = []
        if self.user_templates_dir and self.user_templates_dir.exists():
            loader_paths.append(self.user_templates_dir)
        loader_paths.append(DEFAULT_TEMPLATES_DIR)

        self.env = Environment(
            loader=FileSystemLoader([str(p) for p in loader_paths]),
            autoescape=select_autoescape(default_for_string=False, default=False),
            trim_blocks=True,
            lstrip_blocks=True,
            keep_trailing_newline=True,
        )

        # Register custom filters
        self._register_filters()

    def _register_filters(self) -> None:
        """Register custom Jinja2 filters for templates."""
        import json

        def to_json(value: Any, indent: int | None = None) -> str:
            """Convert value to JSON string."""
            return json.dumps(value, indent=indent, default=str)

        def truncate_middle(text: str, max_length: int = 50) -> str:
            """Truncate text in the middle if it exceeds max_length."""
            if len(str(text)) <= max_length:
                return str(text)
            half = (max_length - 3) // 2
            text = str(text)
            return text[:half] + "..." + text[-half:]

        self.env.filters["to_json"] = to_json
        self.env.filters["truncate_middle"] = truncate_middle

    def render(self, template_name: str, **context: Any) -> str:
        """Render a template with the given context.

        Args:
            template_name: Name of the template file (e.g., 'databases/preview.md.j2')
            **context: Variables to pass to the template

        Returns:
            Rendered template string
        """
        template = self.env.get_template(template_name)
        return template.render(**context)

    def has_template(self, template_name: str) -> bool:
        """Check if a template exists.

        Args:
            template_name: Name of the template to check

        Returns:
            True if the template exists, False otherwise
        """
        try:
            self.env.get_template(template_name)
            return True
        except Exception:
            return False

    def is_user_override(self, template_name: str) -> bool:
        """Check if a template is a user override.

        Args:
            template_name: Name of the template to check

        Returns:
            True if the user has provided a custom template
        """
        if not self.user_templates_dir:
            return False
        user_template = self.user_templates_dir / template_name
        return user_template.exists()


# Global template engine instance (lazily initialized)
_engine: TemplateEngine | None = None


def get_template_engine(project_path: Path | None = None) -> TemplateEngine:
    """Get or create the template engine.

    Args:
        project_path: Path to the nao project root.

    Returns:
        The template engine instance
    """
    global _engine
    if _engine is None or (project_path and _engine.project_path != project_path):
        _engine = TemplateEngine(project_path)
    return _engine
