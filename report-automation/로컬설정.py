"""보고서 모듈도 데스크톱 설치와 같은 로컬 주소를 사용합니다."""
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'desktop'))
from local_config import base_url


def 사이트주소():
    return base_url()


if __name__ == '__main__':
    print(사이트주소())
