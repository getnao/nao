"""Template engine module for nao providers.

This module provides a Jinja2-based templating system that allows users
to customize the output of sync providers (databases, repos, etc.).

Default templates are stored in this package and can be overridden by
placing templates with the same name in the project's `templates/` directory.
"""

from .engine import TemplateEngine, get_template_engine

__all__ = ["TemplateEngine", "get_template_engine"]
