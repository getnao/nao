"""Remove command group for removing resources from nao configuration."""

from cyclopts import App

from .notion import notion

remove = App(name="remove", help="Remove resources from nao configuration.")
remove.command(notion)

__all__ = ["remove"]
