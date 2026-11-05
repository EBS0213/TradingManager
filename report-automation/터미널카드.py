"""TM26 terminal card layout: deterministic HTML, no sending side effects."""

import html,json,re,tempfile
from pathlib import Path
E=html.escape
W,H=1080,1350

CSS='''
@font-face{font-family:Noto;src:local('Noto Sans CJK KR'),local('Apple SD Gothic Neo')}
*{box-sizing:border-box;margin:0;padding:0}body{width:1080px;color:#eee;background:#080808;font-family:Noto,"Apple SD Gothic Neo",sans-serif;word-break:keep-all}
.card{width:1080px;height:1350px;background:#080808;position:relative;overflow:hidden;padding:0 24px}
.brand{height:83px;display:flex;align-items:center;gap:22px;border-bottom:1px solid #303030}.logo{font-size:42px;font-weight:900;letter-spacing:-2px}.logo b{color:#eda12c}.brand .sub{font-size:19px;letter-spacing:1.7px;color:#b8b8b8}.preview{margin-left:auto;border:1px solid #674817;color:#efb44d;background:#20180d;padding:7px 12px;font-size:19px}
.nav{height:54px;display:flex;align-items:stretch;border-bottom:1px solid #282828;color:#a8a8a8;font-size:21px;gap:0}.nav span{display:flex;align-items:center;padding:0 25px}.nav .on{color:#ffb54a;background:#21190f;border-bottom:2px solid #ed9c2d}
.hero{height:115px;display:flex;align-items:center;justify-content:space-between;gap:14px}.eyebrow{font-size:19px;color:#eda12c;letter-spacing:1.5px;margin-bottom:4px}.hero h1{font-size:43px;line-height:1.25;font-weight:800}.date{font-size:22px;color:#b8b8b8;text-align:right;line-height:1.6}.date strong{display:block;font-weight:400;font-size:18px;color:#eda12c}
.ticker{display:flex;border:1px solid #303030;margin-bottom:18px}.tick{flex:1;padding:12px 18px;background:#111;border-right:1px solid #303030;display:grid;grid-template-columns:1fr auto;gap:4px 10px}.tick:last-child{border-right:0}.tick label{font-size:19px;color:#b9b9b9}.tick b{font-size:25px;text-align:right;font-variant-numeric:tabular-nums}.tick small{grid-column:2;text-align:right;font-size:20px}.up{color:#35d7a2}.down{color:#f47786}
.panel{border:1px solid #303030;background:#0b0b0b}.panel-head{height:46px;display:flex;align-items:center;justify-content:space-between;padding:0 20px;background:#121212;border-bottom:1px solid #303030;color:#eda12c;font-size:22px;font-weight:700}.panel-head small{font-size:17px;color:#aaa;font-weight:400;letter-spacing:1px}
.flow{padding:24px 28px;font-size:32px;line-height:1.68;color:#e1e1e1;overflow:hidden}.block{padding-bottom:17px}.block:last-child{padding-bottom:0}.block h2{font-size:1.05em;line-height:1.4;color:#efb34f;margin:4px 0 15px;font-weight:700;border-left:4px solid #eda12c;padding-left:15px}.block p{margin:0}.block b{font-weight:800;color:#fafafa}.block .bullet{padding-left:22px;position:relative}.block .bullet:before{content:'·';position:absolute;left:0;color:#eda12c}
.footer{position:absolute;bottom:0;left:24px;right:24px;height:58px;border-top:1px solid #333;display:flex;align-items:center;gap:22px;color:#aaa;font-size:18px;background:#080808}.footer .site{margin-left:auto}.footer b{color:#eda12c;font-weight:500}.footer .page{font-size:19px;color:#ddd}
.setupHero{height:130px}.setupHero h1{font-size:49px}.setupHero .date{font-size:19px}.change{font-size:35px;font-variant-numeric:tabular-nums}.metrics{display:grid;grid-template-columns:repeat(4,1fr);border:1px solid #303030;margin-bottom:16px;background:#111}.metric{padding:14px 18px;border-right:1px solid #303030}.metric:last-child{border-right:0}.metric label{font-size:20px;color:#aaa;display:block;margin-bottom:7px}.metric strong{color:#40bfd1;font-size:31px;font-variant-numeric:tabular-nums}.metric small{font-size:17px;color:#aaa;display:block;margin-top:4px}
.chartWrap{padding:18px 15px 7px}.chartWrap svg{width:100%;height:450px;display:block}.legend{padding:0 20px 14px;display:flex;gap:22px;font-size:18px;color:#aaa}.legend b{font-weight:500}.quality{margin-top:16px}.quality-grid{padding:12px 20px 15px;display:grid;grid-template-columns:1fr 1fr;gap:9px 24px;font-size:17px}.quality-row{display:flex;justify-content:space-between;gap:10px}.quality-row strong{font-weight:500;color:#40bfd1}.quality-note{padding:0 20px 15px;font-size:17px;color:#aaa;line-height:1.6}.empty{height:540px;display:flex;align-items:center;justify-content:center;color:#aaa}
'''

def common(title,eyebrow,date,body,index,total,setup=False,news=False):
    nav='뉴스북' if news else '셋업' if setup else '시장 브리핑'
    header=f'''<div class="brand"><div class="logo">TM<b>26</b></div><div class="sub">RESEARCH TERMINAL</div><span class="preview">AWAKE KOREA</span></div>
    <div class="nav"><span class="{'on' if not setup and not news else ''}">시장 브리핑</span><span class="{'on' if setup else ''}">셋업</span><span>리서치</span><span class="{'on' if news else ''}">뉴스북</span></div>
    <div class="hero {'setupHero' if setup else ''}"><div><div class="eyebrow">{E(eyebrow)}</div><h1>{E(title)}</h1></div><div class="date">{date}</div></div>'''
    return f'<!doctype html><html lang="ko"><head><meta charset="utf-8"><style>{CSS}</style></head><body><main class="card">{header}{body}<footer class="footer"><b>TM26 RESEARCH TERMINAL</b><span>{E(nav)}</span><span class="site">tradingmanagerkr.com</span><span class="page">{index:02} / {total:02}</span></footer></main></body></html>'

def plain(s):
    return html.unescape(re.sub('<[^>]+>','',s))

def brief_blocks(text):
    blocks=[];heading=None
    for line in text.splitlines():
        line=line.strip()
        if not line or line.startswith('#'):continue
        h=re.fullmatch(r'<b>(.*?)</b>',line)
        if h:heading=plain(h[1]);continue
        safe=E(line).replace('&lt;b&gt;','<b>').replace('&lt;/b&gt;','</b>')
        bullet=line.startswith(('· ','- ','• '))
        if bullet:safe=safe[2:]
        chunks=re.split(r'(?<=[.。])\s+',safe)
        parts=[];part=''
        for sentence in chunks:
            if len(plain(part))+len(plain(sentence))>270 and part:
                parts.append(part);part=''
            part+=((' ' if part else '')+sentence)
        if part:parts.append(part)
        for j,part in enumerate(parts):
            blocks.append('<section class="block">'+(f'<h2>{E(heading)}</h2>' if heading and j==0 else '')+f'<p class="{"bullet" if bullet and j==0 else ""}">{part}</p></section>')
        heading=None
    return blocks

def tickers(text,slot,facts=None):
    if slot=="mid":
        rows={r.get("name"):r for r in (facts or {}).get("kr",[])}
        observed=str((facts or {}).get("marketObservedAt") or "")
        if observed and not re.search(r" (?:11:5[5-9]|12:0[0-9]|12:10)$",observed): rows={}
        tiles=[]
        for name in ["코스피","코스닥"]:
            r=rows.get(name,{})
            value=r.get("price");rate=r.get("rate")
            v=f"{value:,.2f}" if isinstance(value,(int,float)) else "자료 없음"
            change=f"{rate:+.2f}%" if isinstance(rate,(int,float)) else "—"
            cls="down" if isinstance(rate,(int,float)) and rate<0 else "up"
            tiles.append(f'<div class="tick"><label>{E(name)} · 12:00 기준</label><b>{v}</b><small class="{cls}">{change}</small></div>')
        return '<div class="ticker">'+"".join(tiles)+"</div>"

    names=['코스피','코스닥','VIX'] if slot in ['mid','close'] else ['다우','S&P500','나스닥']
    ticks=[]
    for name in names:
        m=re.search(re.escape(name)+r'\s*([\d,.]+)\s*\(([+−-]?[\d.]+)%\)',text)
        if m:
            value,change=m.groups();cls='down' if change.startswith(('-','−')) else 'up'
            ticks.append(f'<div class="tick"><label>{E(name)}</label><b>{E(value)}</b><small class="{cls}">{E(change)}%</small></div>')
    return '<div class="ticker">'+''.join(ticks)+'</div>' if ticks else ''

def partition(heights,limit,n=5):
    total=len(heights);sums=[0]
    for h in heights:sums.append(sums[-1]+h)
    target=sums[-1]/n;dp={(0,0):(0,[])}
    for k in range(1,n+1):
        for end in range(k,total+1):
            opts=[]
            for start in range(k-1,end):
                if (k-1,start) not in dp:continue
                size=sums[end]-sums[start]
                if size<=limit:
                    score,cuts=dp[k-1,start];opts.append((score+(size-target)**2,cuts+[(start,end)]))
            if opts:dp[k,end]=min(opts,key=lambda x:x[0])
    return dp.get((n,total),(0,None))[1]

def save_page(pg,folder,index,doc):
    f=folder/f'{index:02}.html';f.write_text(doc,encoding='utf-8');pg.goto(f.as_uri(),wait_until='load');pg.evaluate('document.fonts.ready')
    check=pg.evaluate('''()=>{const f=document.querySelector('.footer').getBoundingClientRect();const last=document.querySelector('.quality')||document.querySelector('.flow');return {bottom:last.getBoundingClientRect().bottom,footer:f.top,scroll:document.documentElement.scrollWidth}}''')
    if check['bottom']>check['footer']-7 or check['scroll']>1080:raise RuntimeError(str(f)+' overflow '+str(check))
    image=folder/f'{index:02}.png';pg.locator('.card').screenshot(path=str(image))
    return str(image)

def 절카드(갈피, 날, 큰제목, 절들, 장수=5, *, slot=None, facts=None, output=None):
    """기존 글카드뉴스의 파싱 결과를 받아 원문을 보존해 조판한다."""
    from playwright.sync_api import sync_playwright
    news='뉴스북' in 갈피
    labels={'am':'AM · PRE-MARKET','mid':'MID · INTRADAY','close':'CLOSE · MARKET REVIEW','pm':'PM · GLOBAL MARKETS'}
    title={'am':'장전 브리핑','mid':'장중 브리핑','close':'장마감 브리핑','pm':'해외 브리핑'}.get(slot,큰제목)
    eyebrow='NEWSBOOK · DAILY DIGEST' if news else labels.get(slot,'RESEARCH · MARKET STRATEGY')
    blocks=[]
    for heading,chunks in 절들:
        for i,chunk in enumerate(chunks):
            chunk=chunk.replace('class="점"','class="bullet"').replace('class="주석"','class="note"')
            blocks.append('<section class="block">'+(f'<h2>{E(heading)}</h2>' if heading and i==0 else '')+chunk+'</section>')
    if not blocks:raise ValueError('카드 본문이 비어 있습니다.')
    folder=Path(output) if output else Path(tempfile.mkdtemp(prefix='tm26-terminal-',dir=Path(__file__).resolve().parent/'캐시'/'글카드뉴스'))
    folder.mkdir(parents=True,exist_ok=True)
    ticker=tickers('',slot,facts) if slot=='mid' else ''
    if slot in ['am','pm','close']:
        # 구조화된 당시 재료를 우선한다. 현재 지수를 재조회하지 않는다.
        rows=(facts or {}).get('kr',[]) if slot=='close' else (facts or {}).get('거시',{}).get('주가',[])
        names=['코스피','코스닥'] if slot=='close' else ['다우','S&P500','나스닥']
        text=' '.join(f"{r.get('name')} {r.get('price')} ({r.get('rate'):+g}%)" for r in rows if r.get('name') in names and isinstance(r.get('price'),(int,float)) and isinstance(r.get('rate'),(int,float)))
        ticker=tickers(text,slot)
    date=E(날)
    if slot=='mid':date=E(날[:10])+'<strong>12:00 KST 기준</strong>'
    if slot=='mid' and (facts or {}).get('marketObservedAt'): date+='<span style="font-size:14px">관측 '+E(str(facts['marketObservedAt']))+'</span>'
    panel='<div class="panel"><div class="panel-head">'+('주요 뉴스' if news else '시장 분석')+'<small>'+('NEWS INTELLIGENCE' if news else 'MARKET INTELLIGENCE')+'</small></div><div class="flow">%s</div></div>'
    def document(body,i,total,font):
        return common(title,eyebrow,date,ticker+(panel%body),i,total,news=news).replace('</style>',f'.flow{{font-size:{font}px}}.note{{color:#aaa;font-size:.9em}}</style>')
    with sync_playwright() as p:
        browser=p.chromium.launch();pg=browser.new_page(viewport={'width':W,'height':H})
        n=min(장수 or len(절들) or 1,len(blocks));cuts=None
        for font in range(32,22,-1):
            measure=folder/'_measure.html';measure.write_text(document(''.join(blocks),1,n,font));pg.goto(measure.as_uri(),wait_until='load');pg.evaluate('document.fonts.ready')
            heights=pg.locator('.block').evaluate_all('(els)=>els.map(e=>e.getBoundingClientRect().height)')
            limit=pg.evaluate("()=>document.querySelector('.footer').getBoundingClientRect().top-document.querySelector('.flow').getBoundingClientRect().top-65")
            cuts=partition(heights,limit,n)
            if cuts:break
        if not cuts:
            # 긴 원문은 자르지 않고 추가 장으로 보존한다.
            for n in range(n+1,len(blocks)+1):
                cuts=partition(heights,limit,n)
                if cuts:break
        if not cuts:raise ValueError('한 문단이 카드 높이를 넘습니다. 원문은 발송하지 않고 보존합니다.')
        pages=[Path(save_page(pg,folder,i,document(''.join(blocks[a:b]),i,len(cuts),font))) for i,(a,b) in enumerate(cuts,1)]
        browser.close()
    return pages
