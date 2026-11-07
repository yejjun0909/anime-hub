// 인기 검색어/별칭 (v4.7+)
export const POPULAR_SEARCHES = [
  "귀멸의 칼날",
  "진격의 거인",
  "주술회전",
  "원피스",
  "나루토",
  "블리치",
  "드래곤볼",
  "스파이 패밀리",
  "체인소 맨",
  "약속의 네버랜드",
  "하이큐",
  "블루 록",
  "봇치 더 록",
  "슬램덩크",
  "너의 이름은",
  "센과 치히로의 행방불명",
  "귀멸의 칼날: 무한열차편",
  "스즈메의 문단속",
  "날씨의 아이",
  "전생했더니 슬라임이었던 건",
  "리제로",
  "코노스바",
  "오버로드",
  "무직전생",
  "귀멸의 칼날: 상현집결",
  "주술회전: 회옥옥折",
  "블루 록 vs U-20",
  "하이큐!! TO THE TOP",
  "스파이 패밀리 Season 2",
  "체인소 맨: 레제편"
];

export const SEARCH_SYNONYMS = {
  "귀멸의 칼날": "Demon Slayer",
  "진격의 거인": "Attack on Titan",
  "주술회전": "Jujutsu Kaisen",
  "원피스": "One Piece",
  "나루토": "Naruto",
  "블리치": "Bleach",
  "드래곤볼": "Dragon Ball",
  "스파이 패밀리": "Spy x Family",
  "체인소 맨": "Chainsaw Man",
  "약속의 네버랜드": "The Promised Neverland",
  "하이큐": "Haikyuu",
  "블루 록": "Blue Lock",
  "봇치 더 록": "Bocchi the Rock",
  "슬램덩크": "Slam Dunk",
  "너의 이름은": "Your Name",
  "센과 치히로의 행방불명": "Spirited Away",
  "스즈메의 문단속": "Suzume",
  "전생했더니 슬라임이었던 건": "That Time I Got Reincarnated as a Slime",
  "리제로": "Re:Zero",
  "코노스바": "KonoSuba",
  "오버로드": "Overlord",
  "무직전생": "Mushoku Tensei"
};

export function expandSearchQuery(query) {
  const q = String(query || "").trim();
  if (!q) return [];
  const out = [q];
  if (SEARCH_SYNONYMS[q]) out.push(SEARCH_SYNONYMS[q]);
  for (const [ko, en] of Object.entries(SEARCH_SYNONYMS)) {
    if (en.toLowerCase() === q.toLowerCase()) { out.push(ko); break; }
  }
  return [...new Set(out)];
}

export function searchAliasSuggestions(query) {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return POPULAR_SEARCHES.slice(0, 8);
  return POPULAR_SEARCHES.filter((item) => item.toLowerCase().includes(q)).slice(0, 8);
}
