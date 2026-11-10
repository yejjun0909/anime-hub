#!/usr/bin/env python3
"""배포용 정적 사이트 ZIP을 만듭니다.

사이트 실행에 필요한 파일만 담습니다.
- 포함: index.html, app.js, styles.css, sw.js, manifest, offline, robots, sitemap, _headers,
        assets/, data/(수확 원본 제외), supabase/schema.sql, 단일 파일 사본, 배포 문서
- 제외: tools/, tests/, .git/, .github/, 개발 문서, 수확 원본 JSON

Git 저장소를 연결하면 이 ZIP 대신 `tools/build_site.py`로 자동 배포할 수 있습니다.

사용:
    py tools/build_deploy_zip.py
    py tools/build_deploy_zip.py --out C:/Users/me/Desktop/anime-hub.zip
"""
from __future__ import annotations

import argparse
import sys
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from deploy_files import REQUIRED, ROOT, collect  # noqa: E402

DEFAULT_OUT = ROOT.parent / "anime-hub-deploy.zip"


def main() -> int:
    parser = argparse.ArgumentParser(description="배포용 ZIP 생성")
    parser.add_argument("--out", default=str(DEFAULT_OUT))
    args = parser.parse_args()

    output = Path(args.out)
    output.parent.mkdir(parents=True, exist_ok=True)
    files = collect()
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for path in files:
            archive.write(path, path.relative_to(ROOT).as_posix())

    names = {path.relative_to(ROOT).as_posix() for path in files}
    missing = [name for name in REQUIRED if name not in names]
    if missing:
        print(f"실패: ZIP에 필요한 파일이 없습니다: {', '.join(missing)}")
        return 1

    print(f"작성: {output} ({output.stat().st_size:,} bytes, {len(files)}개 파일)")
    print("포함 예시:", ", ".join(sorted(names)[:6]), "…")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
