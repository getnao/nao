"""`nao config` subcommand: read-only access to the project configuration."""

from cyclopts import App

from .path_cmd import path_cmd
from .show import show
from .validate import validate

config = App(name="config", help="Inspect and validate the project configuration.")

config.command(name="show")(show)
config.command(name="path")(path_cmd)
config.command(name="validate")(validate)


__all__ = ["config"]
