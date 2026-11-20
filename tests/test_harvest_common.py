"""수확기 공통 모듈 단위 테스트 (python -m unittest)."""

from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "tools"))

from harvest_common import (  # noqa: E402
    atomic_write_json,
    clean_overview,
    merge_platform_catalog,
    normalize_plain,
    platform_id,
    read_platform_index,
)


class HarvestCommonTest(unittest.TestCase):
    def test_platform_id_is_stable_and_js_safe(self):
        first = platform_id("abc-123")
        self.assertEqual(first, platform_id("abc-123"))
        self.assertNotEqual(first, platform_id("abc-124"))
        self.assertGreater(first, 0)
        self.assertLessEqual(first, 2**53 - 1)

    def test_read_platform_index_parses_korean_titles(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "korean-title-index.js"
            source.write_text(
                '\n'.join([
                    'const KOREAN_TITLE_INDEX = {',
                    '  "귀멸의 칼날": {malId: 101922, anilistId: "101922"},',
                    '  "not korean": {malId: 1, anilistId: "2"},',
                    '};',
                ]),
                encoding="utf-8",
            )
            self.assertEqual(
                read_platform_index(source),
                [("귀멸의 칼날", 101922, 101922)],
            )

    def test_normalize_plain(self):
        self.assertEqual(normalize_plain("  귀멸의! 칼날  "), "귀멸의칼날")
        self.assertEqual(normalize_plain("Bocchi the Rock!"), "bocchitherock")

    def test_clean_overview_optional_html_strip(self):
        raw = "<br/>첫 줄   둘째 줄<br>셋째 줄"
        self.assertIn("<br>", clean_overview(raw))
        cleaned = clean_overview(raw, strip_html=True)
        self.assertNotIn("<br", cleaned)
        self.assertIn("첫 줄 둘째 줄", cleaned)

    def test_atomic_write_json(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / "nested" / "catalog.json"
            atomic_write_json(target, {"records": [{"a": 1}], "name": "한글"})
            self.assertEqual(json.loads(target.read_text(encoding="utf-8"))["name"], "한글")
            self.assertFalse(list(target.parent.glob(".*.tmp")))

    def test_merge_platform_catalog_keeps_other_platforms_and_prefers_better(self):
        platform = {
            "id": "coupangplay",
            "name": "쿠팡플레이",
            "priority": 7,
            "sourceUrl": "https://www.coupangplay.com/",
            "checkedAt": "2026-11-20",
        }
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "catalog.json"
            atomic_write_json(output, {
                "schemaVersion": 1,
                "region": "KR",
                "checkedAt": "2026-01-01",
                "platforms": [
                    {"id": "laftel", "name": "라프텔", "priority": 1},
                    {"id": "coupangplay", "name": "old", "priority": 7},
                ],
                "records": [
                    {
                        "platform": "laftel",
                        "platformId": 1,
                        "anilistId": 1,
                        "title": "라프텔 작품",
                    },
                    {
                        "platform": "coupangplay",
                        "platformId": 2,
                        "anilistId": 2,
                        "title": "예전 쿠팡 작품",
                        "year": None,
                        "kind": "MOVIE",
                    },
                ],
            })
            payload = merge_platform_catalog(output, platform, [
                {
                    "platform": "coupangplay",
                    "platformId": 2,
                    "anilistId": 3,
                    "title": "새 쿠팡 작품",
                    "year": 2025,
                    "kind": "TV",
                },
                {
                    "platform": "coupangplay",
                    "platformId": 3,
                    "anilistId": 4,
                    "title": "두 번째 쿠팡 작품",
                    "year": 2024,
                    "kind": "TV",
                },
            ], logger=lambda message: None)

            self.assertEqual(len(payload["records"]), 3)
            self.assertEqual(payload["checkedAt"], "2026-11-20")
            self.assertEqual([entry["id"] for entry in payload["platforms"]], ["laftel", "coupangplay"])
            coupang = [record for record in payload["records"] if record["platform"] == "coupangplay"]
            self.assertEqual(sorted(record["platformId"] for record in coupang), [2, 3])
            self.assertEqual(
                next(record for record in coupang if record["platformId"] == 2)["title"],
                "새 쿠팡 작품",
            )


if __name__ == "__main__":
    unittest.main()
