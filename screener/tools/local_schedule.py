"""Persistent KST schedule; the US night belongs to the preceding evening."""
import datetime as dt
import json
import os
from pathlib import Path
KST=dt.timezone(dt.timedelta(hours=9))
US_TIMES=((22,30),(0,30),(2,30),(4,30),(6,30),(8,30))

def due_slot(market, now, kr_hours=(16,), days=(0,1,2,3,4)):
    now=now.astimezone(KST)
    if market=='US':
        # No catch-up outside the requested 22:30–09:00 window.
        if dt.time(9)<=now.time().replace(tzinfo=None)<dt.time(22,30):return None
        evening=now.date() if now.hour>=22 else now.date()-dt.timedelta(days=1)
        if evening.weekday() not in days:return None
        slots=[dt.datetime.combine(evening if h>=22 else evening+dt.timedelta(days=1),dt.time(h,m),KST) for h,m in US_TIMES]
    else:
        if now.weekday() not in days:return None
        slots=[dt.datetime.combine(now.date(),dt.time(h),KST) for h in kr_hours]
    past=[slot for slot in slots if slot<=now]
    return max(past).isoformat() if past else None

def load_state(path):
    try:return json.loads(Path(path).read_text())
    except (OSError,ValueError):return {}

def save_state(path,state):
    path=Path(path);path.parent.mkdir(parents=True,exist_ok=True)
    temporary=path.with_suffix('.tmp')
    temporary.write_text(json.dumps(state));os.replace(temporary,path)
