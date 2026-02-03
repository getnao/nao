import dotenv
from cyclopts import App

from nao_core.commands import chat, debug, init, sync, test

dotenv.load_dotenv()

app = App()

app.command(chat)
app.command(debug)
app.command(init)
app.command(sync)
app.command(test)

if __name__ == "__main__":
    app()
