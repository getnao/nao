from cyclopts import App

from . import tableau

migrate = App(name="migrate")
migrate.command(tableau.tableau)
