"""Claude 2차 완성본을 내용 재분석 없이 윤문하고 게시하는 경로."""
import collections
import json
from pathlib import Path
import re
import shutil
import sys
from html.parser import HTMLParser


class Text(HTMLParser):
    def __init__(self):
        super().__init__(); self.skip = 0; self.parts = []; self.links = []
    def handle_starttag(self, tag, attrs):
        if tag in ('head','style','script'): self.skip += 1
        if tag == 'a': self.links.extend(v for k,v in attrs if k=='href')
    def handle_endtag(self, tag):
        if tag in ('head','style','script'): self.skip = max(0,self.skip-1)
    def handle_data(self, data):
        if not self.skip: self.parts.append(data)


def protected(text):
    p=Text();p.feed(text)
    words=' '.join(p.parts)
    numbers=collections.Counter(re.findall(r'[-+−]?\d[\d,.]*(?:%|억원|만원|원|배|GW|TWh)?',words))
    notes=collections.Counter(re.findall(r'data-uncertainty=[\"\x27]([^\"\x27]+)',text))
    return numbers, collections.Counter(p.links), notes


def compact_packet(path, files):
    text=path.read_text()
    marker='## 최종 검수 요약'
    summary=text.rsplit(marker,1)[-1] if marker in text else text[-4000:]
    summaries={}
    for f in files:
        if '요약' in f.name:
            parser=Text();parser.feed(f.read_text())
            plain=' '.join(parser.parts)
            summaries[str(f)]={'text':plain[:10000], 'truncated':len(plain)>10000}
    return {'handoff_header':text[:1200], 'final_summary':summary[:4000],
            'summary_missing':marker not in text, 'summary_truncated':len(summary)>4000,
            'publication_text':summaries,
            'scope':'변경 요약과 지정 변경 문단·주석 중심. 전체 분석과 반복 원문 조회 금지.'}


def run(w, path):
    """구 호출자 호환: 추가 모델 검토 없이 완성본 게시로 연결한다."""
    return w.process(path)
