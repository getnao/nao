from cyclopts import App

from .list import list_tests
from .runner import test as run_tests
from .server import server

# Create a test app with subcommands
test = App(name="test", help="Run and explore nao tests.")

# Register the default run command
test.command(name="run")(run_tests)

# Register the server command
test.command(name="server")(server)

# Register the list command
test.command(name="list")(list_tests)

# Make `nao test` (without subcommand) run tests by default
test.default(run_tests)

__all__ = ["test"]
