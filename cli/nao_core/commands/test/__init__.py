from cyclopts import App

from .runner import test as run_tests
from .server import server

# Create a test app with subcommands
test = App(name="test", help="Run and explore nao tests.")

# Register the default run command
test.command(name="run")(run_tests)

# Register the server command
test.command(name="server")(server)

# Make `nao test` (without subcommand) run tests by default
test.default(run_tests)

__all__ = ["test"]
