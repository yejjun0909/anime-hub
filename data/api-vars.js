// AniList GraphQL 요청 변수 정리 (v4.6)
//
// AniList는 averageScore_greater / episodes_greater 같은 비교 연산자에
// null이 명시되면 "Illegal operator and value combination" (400)으로 거부합니다.
// 값이 없는 필터는 아예 보내지 않아야 합니다.

/**
 * null/undefined 값만 제거합니다. 0, false, ''는 유효한 값이므로 유지합니다.
 * @param {Record<string, unknown>} variables
 * @returns {Record<string, unknown>}
 */
export function pruneNullVariables(variables = {}) {
  const result = {};
  for (const [key, value] of Object.entries(variables)) {
    if (value === null || value === undefined) continue;
    result[key] = value;
  }
  return result;
}
