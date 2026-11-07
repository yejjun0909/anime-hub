// 한국어 조사 자동 선택 유틸리티 (v4.7+)
export function hasBatchim(word) {
  const last = String(word || "").charCodeAt(String(word || "").length - 1);
  if (last < 0xac00 || last > 0xd7a3) return false;
  return (last - 0xac00) % 28 !== 0;
}
export function attachJosa(word, pair) {
  const w = String(word || "");
  if (!w) return w;
  const last = w.charCodeAt(w.length - 1);
  if (last < 0xac00 || last > 0xd7a3) return w + String(pair || "").split("/")[1];
  const parts = String(pair || "").split("/");
  return w + (hasBatchim(w) ? parts[0] : parts[1]);
}
export function josa(word, type) {
  const pairs = { subject: "이/가", topic: "은/는", object: "을/를", with: "과/와" };
  return attachJosa(word, pairs[type] || "이/가");
}
