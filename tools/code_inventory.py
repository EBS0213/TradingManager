"""Inventory tracked source, API routes and module imports without reading private runtime data."""
import ast
from collections import Counter
import hashlib
import json
from pathlib import Path
import re
import subprocess

ROOT = Path(__file__).resolve().parents[1]
CODE = {'.py','.js','.mjs','.cjs','.ts','.tsx','.swift','.sh','.css','.html','.ps1','.cmd','.command'}

def inventory():
    paths = subprocess.check_output(['git','ls-files','--cached','--others','--exclude-standard','-z'],cwd=ROOT).decode().split('\0')
    files, errors, routes = [], [], []
    for name in sorted(set(filter(None,paths))):
        if name.startswith('docs/code-inventory'):
            continue
        file = ROOT/name
        if not file.is_file():continue
        data = file.read_bytes()
        row = {'path':name,'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest(),'kind':file.suffix or 'other'}
        if file.suffix in CODE:
            source = data.decode('utf-8-sig')
            row['lines'] = len(source.splitlines())
            imports = []
            if file.suffix == '.py':
                try:
                    tree = ast.parse(source,filename=name)
                    for node in ast.walk(tree):
                        if isinstance(node,ast.Import):imports.extend(item.name for item in node.names)
                        elif isinstance(node,ast.ImportFrom):imports.append('.'*node.level+(node.module or ''))
                except SyntaxError as error: errors.append({'path':name,'line':error.lineno,'message':error.msg})
            elif file.suffix in {'.js','.mjs','.ts','.tsx','.cjs'}:
                imports = re.findall(r'(?:from\s+|import\s*\(|require\s*\()[\"\']([^\"\']+)[\"\']',source)
            row['imports'] = sorted(set(imports))
            if name.startswith('web/app/api/') and file.stem=='route':
                routes.append({'route':'/'+str(file.parent.relative_to(ROOT/'web/app')),'file':name,'methods':re.findall(r'export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\b',source)})
        files.append(row)
    return {'counts':dict(Counter(row['path'].split('/')[0] for row in files)), 'sourceFiles':sum('lines' in r for r in files),
            'sourceLines':sum(r.get('lines',0) for r in files),'pythonParseErrors':errors,'routes':routes,'files':files}

if __name__=='__main__':
    result=inventory()
    output=ROOT/'docs/code-inventory.json'
    output.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({k:v for k,v in result.items() if k not in {'files','routes'}},ensure_ascii=False))
    print('API routes:',len(result['routes']))
    print(output)
