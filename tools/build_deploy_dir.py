#!/usr/bin/env python3
"""Git 자동 배포용 정적 사이트 폴더를 만듭니다.

GitHub Actions, Netlify, Cloudflare Pages 같은 정적 호스팅에서
`_site/`를 배포 산출물로 사용합니다.

사용:
    py tools/build_site.py
    # 또는
    py tools/build_deploy_dir.py
    py tools/build_deploy_dir.py --out C:/temp/anime-hub-site
"""
from __future__ import annotations

import argparse
import shutil
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from deploy_files import REQUIRED, ROOT, collect  # noqa: E402

DEFAULT_OUT = ROOT / "_site"


def main() -> int:
    parser = argparse.ArgumentParser(description="자동 배포용 정적 사이트 폴더 생성")
    parser.add_argument("--out", default=str(DEFAULT_OUT))
    args = parser.parse_args()

    output = Path(args.out).resolve()
    if output == ROOT or ROOT.is_relative_to(output):
        print(f"실패: 프로젝트 폴더를 배포 산출물로 덮어쓸 수 없습니다: {output}", file=sys.stderr)
        return 1

    files = collect()
    if output.exists():
        shutil.rmtree(output)
    for path in files:
        destination = output / path.relative_to(ROOT)
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(path, destination)

    names = {path.relative_to(ROOT).as_posix() for path in files}
    missing = [name for name in REQUIRED if name not in names]
    if missing:
        print(f"실패: 배포 폴더에 필요한 파일이 없습니다: {', '.join(missing)}", file=sys.stderr)
        return 1

    print(f"작성: {output} ({len(files)}개 파일)")
    print("포함 예시:", ", ".join(sorted(names)[:6]), "…")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
