#!/usr/bin/env python3
"""애니허브 단일 HTML 생성기.

`index.html` + `styles.css` + `app.js` + `data/*.js`를 하나의
`anime-hub-single.html`로 묶습니다. 일반 사이트는 `index.html`을 그대로
사용하고, 이 파일은 배포/보관용 오프라인 사본입니다.

사용:
    py tools/build_single.py
    py tools/build_single.py --check   # 생성 파일이 최신인지 검사
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_OUT = ROOT / "anime-hub-single.html"

# app.js가 import하는 모듈을 의존 순서대로 나열합니다.
MODULES = [
    "data/korean-catalog.js",
    "data/korean-match.js",
    "data/api-vars.js",
    "data/schedule-merge.js",
    "data/schedule-cache.js",
    "data/schedule-status.js",
    "data/recommend-score.js",
    "data/recommend-eval.js",
    "data/sync-merge.js",
    "data/sync-queue.js",
    "data/user-korean.js",
    "data/search-aliases.js",
    "data/korean-josa.js",
    "data/machine-translate.js",
    "data/gemini-translate.js",
    "data/korean-titles-db.js",
    "data/korean-common-titles.js",
    "data/korean-title-index.js",
    "data/korean-query.js",
    "data/fuzzy-search.js",
    "data/namu-search.js",
    "data/korean-wiki.js",
    "data/korean-source.js",
]


def extract_imports(src: str) -> set[str]:
    names: set[str] = set()
    for match in re.finditer(r"^import\s*\{\s*([^}]+)\s*\}\s*from", src, flags=re.MULTILINE):
        for part in match.group(1).split(","):
            part = part.strip()
            if not part:
                continue
            names.add(part.split(" as ")[0].strip())
    return names


def extract_exports(src: str) -> list[str]:
    names: set[str] = set()
    for match in re.finditer(
        r"\bexport\s+(?:async\s+)?(?:function|const|let|var|class)\s+([A-Za-z_][A-Za-z0-9_]*)",
        src,
    ):
        names.add(match.group(1))
    for match in re.finditer(r"\bexport\s*\{\s*([^}]+)\s*\}", src):
        for part in match.group(1).split(","):
            part = part.strip()
            if not part:
                continue
            names.add(part.split(" as ")[-1].strip())
    names -= extract_imports(src)
    return sorted(names)


def strip_module(src: str) -> str:
    src = re.sub(r"^import\s+.*?from\s+['\"].*?['\"];?\s*$", "", src, flags=re.MULTILINE)
    src = re.sub(r"\bexport\s+(function|const|let|var|class|async\s+function)\b", r"\1", src)
    src = re.sub(r"^export\s*\{[^}]*\};?\s*$", "", src, flags=re.MULTILINE)
    src = re.sub(r"^export\s+default\s+.*$", "", src, flags=re.MULTILINE)
    return src


def build() -> str:
    app = (ROOT / "app.js").read_text(encoding="utf-8")
    # app.js가 import하는 모듈이 MODULES에 빠지면 단일 파일에서 ReferenceError가 납니다.
    imported = {
        path[2:]
        for path in re.findall(r"^import\s+.*?from\s+['\"](\./[^'\"]+)['\"]", app, flags=re.MULTILINE)
    }
    missing = [path for path in sorted(imported) if path not in MODULES]
    if missing:
        raise SystemExit(
            "실패: tools/build_single.py MODULES에 없는 app.js import가 있습니다: "
            + ", ".join(missing)
        )
    js_parts: list[str] = []
    for module in MODULES:
        code = (ROOT / module).read_text(encoding="utf-8")
        exports = extract_exports(code)
        code = strip_module(code)
        namespace = module.replace("/", "_").replace(".", "_").replace("-", "_")
        namespace_var = f"__ns_{namespace}"
        js_parts.append(f"// ===== {module} =====")
        js_parts.append(
            f"const {namespace_var} = (function() {{\n{code}\nreturn {{ {', '.join(exports)} }};\n}})();"
        )
        if exports:
            js_parts.append(f"const {{ {', '.join(exports)} }} = {namespace_var};")

    db_path = ROOT / "data" / "korean-titles-db.json"
    if db_path.exists():
        db_json = db_path.read_text(encoding="utf-8")
        js_parts.append("// ===== korean-titles-db (inlined) =====")
        js_parts.append(f"setKoreanTitlesDb({db_json});")

    app = (ROOT / "app.js").read_text(encoding="utf-8")
    app = re.sub(r"^import\s+.*?from\s+['\"].*?['\"];?\s*$", "", app, flags=re.MULTILINE)
    app = re.sub(r"\bexport\s+(function|const|let|var|class|async\s+function)\b", r"\1", app)
    app = app.replace(
        "if('serviceWorker' in navigator){window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js').catch(err=>console.warn('Service worker registration failed',err)));}",
        "",
    )
    js_parts.append("// ===== app.js =====")
    js_parts.append(app)

    inlined_js = "\n".join(js_parts)
    css = (ROOT / "styles.css").read_text(encoding="utf-8")
    html = (ROOT / "index.html").read_text(encoding="utf-8")
    html = html.replace('<link rel="stylesheet" href="styles.css" />', f"<style>\n{css}\n</style>")
    html = html.replace(
        '<script type="module" src="app.js"></script>',
        f'<script type="module">\n{inlined_js}\n</script>',
    )
    html = html.replace('<link rel="manifest" href="manifest.webmanifest" />', '')
    html = html.replace(
        "<title>애니허브 — 애니메이션 통합 정보</title>",
        "<title>애니허브 — 애니메이션 통합 정보 (단일 파일)</title>",
    )
    # 파일 끝 개행을 보장해 diff를 안정적으로 유지합니다.
    return html if html.endswith("\n") else f"{html}\n"


def main() -> int:
    parser = argparse.ArgumentParser(description="애니허브 단일 HTML 생성/검사")
    parser.add_argument("--out", default=str(DEFAULT_OUT), help="출력 파일 경로")
    parser.add_argument("--check", action="store_true", help="생성 파일이 최신인지 검사")
    args = parser.parse_args()

    output = Path(args.out)
    generated = build()

    if args.check:
        if not output.exists():
            print(f"실패: {output} 파일이 없습니다. py tools/build_single.py를 실행하세요.", file=sys.stderr)
            return 1
        current = output.read_text(encoding="utf-8")
        if current != generated:
            print(
                f"실패: {output.name}이 최신이 아닙니다. py tools/build_single.py를 실행하세요.",
                file=sys.stderr,
            )
            return 1
        print(f"OK: {output.name} 최신 ({output.stat().st_size:,} bytes)")
        return 0

    output.write_text(generated, encoding="utf-8", newline="\n")
    print(f"작성: {output} ({output.stat().st_size:,} bytes)")
    print(f"DB 포함: {(ROOT / 'data' / 'korean-titles-db.json').exists()}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
