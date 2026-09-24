import json
import sys

from dotenv import load_dotenv

from nao_core.project import find_nao_project_root


def _load_project_dotenv() -> None:
    project_root = find_nao_project_root()
    if project_root is not None:
        load_dotenv(project_root / ".env")


_load_project_dotenv()

from cyclopts import App, CycloptsError  # noqa: E402

from nao_core import __version__  # noqa: E402
from nao_core.branding import banner, should_show_banner  # noqa: E402
from nao_core.commands import (  # noqa: E402
    chat,
    debug,
    deploy,
    docs,
    import_app,
    init,
    migrate,
    reset_password,
    skills,
    sync,
    test,
    upgrade,
)
from nao_core.ui import console  # noqa: E402
from nao_core.version import check_for_updates  # noqa: E402

app = App(version=__version__)

app.command(chat)
app.command(debug)
app.command(deploy)
app.command(docs)
app.command(import_app)
app.command(init)
app.command(migrate)
app.command(reset_password)
app.command(skills)
app.command(sync)
app.command(test)
app.command(upgrade)


def main():
    if len(sys.argv) == 1 and should_show_banner():
        banner(console, __version__)
    if "--json" not in sys.argv:
        check_for_updates()
        app()
        return
    try:
        app(sys.argv[1:], exit_on_error=False, print_error=False)
    except CycloptsError as error:
        print(json.dumps({"success": False, "error": str(error)}, ensure_ascii=False, separators=(",", ":")))
        raise SystemExit(1) from error


if __name__ == "__main__":
    main()
