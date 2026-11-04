#!/usr/bin/env python3
"""사용 중단 예정 래퍼.

한국어 제목 수집은 `tools/build_korean_titles_db.py`로 통합되었습니다.
이 파일은 기존 명령을 사용하던 환경을 위해 남겨 두었습니다.

사용:
    py tools/build_korean_titles_db.py --limit 500
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from build_korean_titles_db import main  # noqa: E402

if __name__ == "__main__":
    print("알림: harvest_korean_titles.py는 build_korean_titles_db.py로 통합되었습니다.", file=sys.stderr)
    raise SystemExit(main())
