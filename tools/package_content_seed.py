"""Package approved report PDFs and conference-call publication JSON, never accounts."""
import argparse,gzip,hashlib,json,re
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
def package(source):
    target=ROOT/'seed/content';target.mkdir(parents=True,exist_ok=True)
    entries=[];seen=set()
    def save(kind,key,value):
        raw=gzip.compress(json.dumps(value,ensure_ascii=False,separators=(',',':')).encode(),mtime=0)
        name=kind+'-'+hashlib.sha256(key.encode()).hexdigest()[:24]+'.json.gz'
        (target/name).write_bytes(raw)
        entries.append({'kind':kind,'key':key,'file':name,'sha256':hashlib.sha256(raw).hexdigest()})
    for path in sorted((source/'report').glob('*.pdf')):
        raw=path.read_bytes();digest=hashlib.sha256(raw).hexdigest()
        if not raw.startswith(b'%PDF-') or digest in seen:continue
        seen.add(digest)
        import base64
        match=re.match(r'(.+?)_([A-Z][A-Z0-9.\-]*|[0-9]{6})_(.+)',path.stem)
        title=f'{match[1]} ({match[2]}) · {match[3]}' if match else path.stem
        save('report',digest,{'title':title,'filename':path.name,'mime':'application/pdf','bytes':len(raw),'sha':digest,'data':base64.b64encode(raw).decode()})
    calls={}
    for path in sorted(source.rglob('콜게시_*.json')):
        for item in json.loads(path.read_text()).get('items',[]):
            if item.get('pipeline',{}).get('id')!='foolcalls-codex-v1':continue
            # Only publication fields, no transport keys or local paths.
            allowed=('code','name','market','quarter','date','sector','headline','summary','call','industry','outlook','numbers','sources','documents','pipeline','transcriptSource','madeAt')
            value={k:item[k] for k in allowed if k in item}
            calls[(item['code'],item['quarter'])]=value
    for key,item in calls.items():save('call','|'.join(key),item)
    manifest={'version':1,'origin':'local-publication-archive','completeCloudExport':False,'entries':entries}
    (target/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
    print({kind:sum(x['kind']==kind for x in entries) for kind in ['report','call']})
if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('source',type=Path);package(parser.parse_args().source)
