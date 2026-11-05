"""기업분석 PDF의 종목코드와 보고서 기준일을 함께 읽습니다."""
import datetime as dt
import re
import unicodedata as u


def 보고서코드(path):
    # 2026-10-22 — 앞 세 조각만 읽어 John_Wiley_Sons_WLY의 WLY를
    # 놓쳤다. 회사명 길이와 무관하게 보고서 종류 바로 앞의 코드만 읽는다.
    이름 = u.normalize("NFC", path.stem)
    찾음 = re.search(r"(?:^|_)([A-Za-z0-9][A-Za-z0-9.\-]{0,19})_기업분석보고서(?:_|$)", 이름)
    return 찾음.group(1).upper() if 찾음 else ""


def 보고서날짜(path):
    이름 = u.normalize("NFC", path.stem)
    찾음 = re.search(r"(20\d{2})[.\-_](\d{2})[.\-_](\d{2})", 이름)
    if 찾음:
        try:
            return dt.date(*(int(x) for x in 찾음.groups()))
        except ValueError:
            pass
    return dt.date.fromtimestamp(path.stat().st_mtime)
