"""Private local chat entry point for GemmaCode, without any code execution tools."""
import json
import sys
from chat_worker import answer

def main():
    payload=json.load(sys.stdin);messages=payload.get('messages',[])
    if not messages or len(messages)>12 or any(m.get('role') not in ('user','assistant') or not isinstance(m.get('content'),str) for m in messages):raise ValueError('Invalid conversation')
    if sum(len(m['content']) for m in messages)>30000 or messages[-1]['role']!='user':raise ValueError('Invalid question')
    print(answer({'question':messages[-1]['content'],'context':{'history':messages[:-1]}}),flush=True)

if __name__=='__main__':main()
