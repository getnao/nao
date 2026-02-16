from cyclopts import App
from dotenv import load_dotenv

from nao_core import __version__
from nao_core.commands import chat, debug, init, sync, test, upgrade
from nao_core.version import check_for_updates

load_dotenv()

app = App(version=__version__)

app.command(chat)
app.command(debug)
app.command(init)
app.command(sync)
app.command(test)
app.command(upgrade)


def main():
    check_for_updates()
    app()


if __name__ == "__main__":
    main()
