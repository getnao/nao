"""Template engine module for nao providers.

This module provides a Jinja2-based templating system that allows users
to customize the output of sync providers (databases, repos, etc.).

Default templates are stored in this package and can be overridden by
placing templates with the same name in the project's `templates/` directory.

Additionally, this module supports rendering user Jinja templates in the
context folder, making the `nao` object available for accessing provider data.

Example user template (docs/report.md.j2):
    # {{ nao.config.project_name }}

    {{ nao.notion.page('https://notion.so/...').content }}
"""

from .context import NaoContext, NotionPage, NotionProvider, create_nao_context
from .engine import TemplateEngine, get_template_engine
from .render import (
    TemplateRenderResult,
    discover_templates,
    render_all_templates,
    render_template,
)

__all__ = [
    # Engine
    "TemplateEngine",
    "get_template_engine",
    # Context
    "NaoContext",
    "NotionPage",
    "NotionProvider",
    "create_nao_context",
    # Render
    "TemplateRenderResult",
    "discover_templates",
    "render_template",
    "render_all_templates",
]
