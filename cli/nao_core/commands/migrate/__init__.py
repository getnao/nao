from cyclopts import App

from . import metabase, tableau

migrate = App(name="migrate")
migrate.command(metabase.metabase)
migrate.command(tableau.tableau)
