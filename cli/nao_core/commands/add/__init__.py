"""Add command group for adding resources to nao configuration."""

from cyclopts import App

from .notion import notion

add = App(name="add", help="Add resources to nao configuration.")
add.command(notion)

__all__ = ["add"]
