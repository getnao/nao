import sys

from dotenv import load_dotenv

load_dotenv()

from cyclopts import App  # noqa: E402

from nao_core import __version__  # noqa: E402
from nao_core.branding import banner, should_show_banner  # noqa: E402
from nao_core.commands import (  # noqa: E402
    chat,
    debug,
    deploy,
    docs,
    init,
    metabase,
    migrate,
    reset_password,
    skills,
    stories,
    sync,
    test,
    upgrade,
)
from nao_core.commands.migration_client import DashboardMigrationClientError  # noqa: E402
from nao_core.ui import UI, console  # noqa: E402
from nao_core.version import check_for_updates  # noqa: E402

app = App(version=__version__)

app.command(chat)
app.command(debug)
app.command(deploy)
app.command(docs)
app.command(init)
app.command(metabase)
app.command(migrate)
app.command(reset_password)
app.command(skills)
app.command(stories)
app.command(sync)
app.command(test)
app.command(upgrade)


def main():
    if len(sys.argv) == 1 and should_show_banner():
        banner(console, __version__)
    if "--json" not in sys.argv:
        check_for_updates()
    try:
        app()
    except DashboardMigrationClientError as error:
        UI.error(str(error))
        raise SystemExit(1) from None


if __name__ == "__main__":
    main()
