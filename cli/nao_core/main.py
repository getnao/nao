from dotenv import load_dotenv

load_dotenv()

from cyclopts import App  # noqa: E402

from nao_core import __version__  # noqa: E402
from nao_core.commands import add, chat, debug, deploy, docs, init, remove, sync, test, upgrade  # noqa: E402
from nao_core.version import check_for_updates  # noqa: E402

app = App(version=__version__)

app.command(add)
app.command(chat)
app.command(debug)
app.command(deploy)
app.command(docs)
app.command(init)
app.command(remove)
app.command(sync)
app.command(test)
app.command(upgrade)


def main():
    check_for_updates()
    app()


if __name__ == "__main__":
    main()
