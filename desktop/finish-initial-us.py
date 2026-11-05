"""Complete the first screen after the in-progress daily download finishes."""
import json,pathlib,subprocess,time
ROOT=pathlib.Path(__file__).resolve().parent.parent
status=ROOT/'data/us-collection-status.json'
while True:
 info=json.loads(status.read_text())
 if not info.get('running'):break
 time.sleep(30)
if info.get('stopped'):raise SystemExit('Provider paused collection; daily scheduled task will retry')
raise SystemExit(subprocess.run(['/usr/bin/python3',str(ROOT/'desktop/run-task.py'),'us-cached']).returncode)
