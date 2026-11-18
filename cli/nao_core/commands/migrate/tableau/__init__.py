from cyclopts import App

from .configure import configure
from .migrate_tableau import tableau as run

tableau = App(name="tableau")
tableau.default(run)
tableau.command(configure)
