from cyclopts import App

from nao_core.commands.metabase import metabase

import_app = App(name="import")
import_app.command(metabase)
