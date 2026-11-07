// 인기 검색어/별칭 (v4.7+)
// 브라우저 자동완성에 사용하는 정적 후보 목록입니다.
// AniList 검색은 이 목록에 의존하지 않으며, 사용자 탐색 편의만 높입니다.

export const POPULAR_SEARCHES = [
  '귀멸의 칼날',
  '진격의 거인',
  '주술회전',
  '원피스',
  '나루토',
  '블리치',
  '드래곤볼',
  '스파이 패밀리',
  '체인소 맨',
  '약속의 네버랜드',
  '하이큐',
  '블루 록',
  '봇치 더 록',
  '슬램덩크',
  '너의 이름은',
  '센과 치히로의 행방불명',
  '귀멸의 칼날: 무한열차편',
  '스즈메의 문단속',
  '날씨의 아이'
];

export function searchAliasSuggestions(query = '') {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return POPULAR_SEARCHES.slice(0, 8);
  return POPULAR_SEARCHES.filter((item) => item.toLowerCase().includes(q)).slice(0, 8);
}
""", "path">
E:\다운로드\anime-hub\data\search-aliases.js