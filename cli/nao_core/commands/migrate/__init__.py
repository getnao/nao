from cyclopts import App

from . import metabase

# from . import tableau

migrate = App(name="migrate")
migrate.command(metabase.metabase)
# migrate.command(tableau.tableau)
