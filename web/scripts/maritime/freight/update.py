# Compatibility entry point for the installed local collector.
import runpy
from pathlib import Path
runpy.run_path(str(Path(__file__).resolve().parents[4]/'workers/freight/update.py'),run_name='__main__')
