"""Render user Jinja templates in the context folder.

This module discovers and renders `.j2` files in the nao context folder,
making the `nao` object available for accessing provider data.

Template files are rendered to the same location without the `.j2` extension.
For example: `docs/report.md.j2` → `docs/report.md`
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING

from jinja2 import Environment, FileSystemLoader, TemplateError

from .context import create_nao_context

if TYPE_CHECKING:
    from rich.console import Console

    from nao_core.config.base import NaoConfig


@dataclass
class TemplateRenderResult:
    """Result of rendering user templates."""

    templates_rendered: int
    templates_failed: int
    rendered_files: list[str]
    errors: list[str]

    def get_summary(self) -> str:
        """Get a human-readable summary of the render result."""
        if self.templates_rendered == 0 and self.templates_failed == 0:
            return "No templates found"

        parts = []
        if self.templates_rendered > 0:
            parts.append(f"{self.templates_rendered} rendered")
        if self.templates_failed > 0:
            parts.append(f"{self.templates_failed} failed")
        return ", ".join(parts)


def discover_templates(
    project_path: Path,
    exclude_dirs: set[str] | None = None,
) -> list[Path]:
    """Discover all `.j2` template files in the project.

    Args:
        project_path: Path to the nao project root.
        exclude_dirs: Directory names to exclude (default: templates, .git, node_modules, etc.)

    Returns:
        List of paths to `.j2` files relative to project_path.
    """
    if exclude_dirs is None:
        exclude_dirs = {
            "templates",  # Don't process accessor template overrides
            ".git",
            ".venv",
            "venv",
            "node_modules",
            "__pycache__",
            ".nao",
        }

    templates: list[Path] = []

    for path in project_path.rglob("*.j2"):
        # Skip excluded directories
        if any(excluded in path.parts for excluded in exclude_dirs):
            continue

        # Store relative path
        templates.append(path.relative_to(project_path))

    return sorted(templates)


def render_template(
    template_path: Path,
    project_path: Path,
    config: NaoConfig,
) -> Path:
    """Render a single template file.

    Args:
        template_path: Path to the template file (relative to project_path).
        project_path: Path to the nao project root.
        config: The nao configuration.

    Returns:
        Path to the rendered output file.

    Raises:
        TemplateError: If template rendering fails.
    """
    # Create Jinja environment with project as the loader path
    env = Environment(
        loader=FileSystemLoader(str(project_path)),
        autoescape=False,
        trim_blocks=True,
        lstrip_blocks=True,
        keep_trailing_newline=True,
    )

    # Register custom filters
    import json

    env.filters["to_json"] = lambda v, indent=None: json.dumps(v, indent=indent, default=str)

    # Create the nao context
    nao = create_nao_context(config)

    # Load and render the template
    template = env.get_template(str(template_path))
    rendered = template.render(nao=nao)

    # Determine output path (remove .j2 extension)
    output_path = project_path / str(template_path)[:-3]  # Remove .j2

    # Ensure parent directory exists
    output_path.parent.mkdir(parents=True, exist_ok=True)

    # Write rendered content
    output_path.write_text(rendered)

    return output_path


def render_all_templates(
    project_path: Path,
    config: NaoConfig,
    console: "Console | None" = None,
) -> TemplateRenderResult:
    """Discover and render all user templates in the project.

    Args:
        project_path: Path to the nao project root.
        config: The nao configuration.
        console: Optional Rich console for output.

    Returns:
        TemplateRenderResult with statistics about what was rendered.
    """
    from rich.console import Console

    if console is None:
        console = Console()

    templates = discover_templates(project_path)

    if not templates:
        return TemplateRenderResult(
            templates_rendered=0,
            templates_failed=0,
            rendered_files=[],
            errors=[],
        )

    rendered_files: list[str] = []
    errors: list[str] = []

    for template_path in templates:
        try:
            output_path = render_template(template_path, project_path, config)
            rendered_files.append(str(output_path.relative_to(project_path)))
            console.print(f"  [dim]→[/dim] {template_path} [dim]→[/dim] {output_path.name}")
        except TemplateError as e:
            error_msg = f"{template_path}: {e}"
            errors.append(error_msg)
            console.print(f"  [red]✗[/red] {template_path}: {e}")
        except Exception as e:
            error_msg = f"{template_path}: {type(e).__name__}: {e}"
            errors.append(error_msg)
            console.print(f"  [red]✗[/red] {template_path}: {e}")

    return TemplateRenderResult(
        templates_rendered=len(rendered_files),
        templates_failed=len(errors),
        rendered_files=rendered_files,
        errors=errors,
    )


__all__ = [
    "TemplateRenderResult",
    "discover_templates",
    "render_template",
    "render_all_templates",
]
