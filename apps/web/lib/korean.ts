/**
 * 한국어 조사 처리.
 *
 * 조사는 앞 글자의 받침에 따라 갈린다. 고정으로 박아두면 "레이즈이 더 자주"나
 * "언더더건(UTG)가" 같은 문장이 나오고, 그 한 줄에서 도구 신뢰가 깎인다.
 * 초보자용 도구라면 더 그렇다.
 */

/** 마지막 글자에 받침이 있는가. 한글이 아니면 없는 것으로 본다. */
export function hasFinalConsonant(word: string): boolean {
  // 괄호 표기가 붙어 있으면 벗겨낸다 — "언더더건(UTG)"은 "건"으로 읽는다.
  const bare = word.replace(/\s*\([^)]*\)\s*$/, '').trim();
  if (bare.length === 0) return false;

  const last = bare.charCodeAt(bare.length - 1);
  if (Number.isNaN(last) || last < 0xac00 || last > 0xd7a3) return false;
  return (last - 0xac00) % 28 !== 0;
}

/** 이/가 */
export function subject(word: string): string {
  return `${word}${hasFinalConsonant(word) ? '이' : '가'}`;
}

/** 은/는 */
export function topic(word: string): string {
  return `${word}${hasFinalConsonant(word) ? '은' : '는'}`;
}

/** 을/를 */
export function object(word: string): string {
  return `${word}${hasFinalConsonant(word) ? '을' : '를'}`;
}

/** 으로/로 — 받침이 ㄹ이면 '로'를 쓴다. */
export function by(word: string): string {
  const bare = word.replace(/\s*\([^)]*\)\s*$/, '').trim();
  const last = bare.charCodeAt(bare.length - 1);
  if (Number.isNaN(last) || last < 0xac00 || last > 0xd7a3) return `${word}로`;
  const final = (last - 0xac00) % 28;
  // 8 = ㄹ. 받침이 없거나 ㄹ이면 '로'.
  return `${word}${final === 0 || final === 8 ? '로' : '으로'}`;
}
