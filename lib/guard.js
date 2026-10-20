// API 중계 공통 가드 — 우리 페이지(같은 호스트 또는 ALLOWED_ORIGINS)에서 온 요청만 받고, 메서드·호출 빈도를 제한한다.
// 서버 키(TMAP)와 공개 서비스(Nominatim·Overpass) 호출 한도를 남의 사이트가 끌어다 쓰지 못하게 하기 위함.
// ALLOWED_ORIGINS: 쉼표 구분 추가 허용 호스트(예: "sa-demo.vercel.app,localhost:3000"). 같은 호스트는 항상 허용.
// ponytail: 호출 빈도는 함수 인스턴스 메모리 기준(콜드 스타트마다 초기화, 인스턴스별) — 실제 악용이 보이면 Vercel KV/Upstash로 옮긴다.
const hits = new Map();
const hostOf = v => { try { return new URL(v).host.toLowerCase(); } catch { return ''; } };
export function guard(req, res, { methods = ['GET'], perMin = 30 } = {}) {
  if (!methods.includes(req.method)) { res.setHeader('Allow', methods.join(', ')); res.status(405).json({ error: 'method not allowed' }); return false; }
  const self = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim().toLowerCase();
  const extra = String(process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '')).filter(Boolean);
  const from = hostOf(req.headers.origin || req.headers.referer || '');   // 같은 출처 GET은 Origin이 없어 Referer로 판정
  if (!from || !(from === self || extra.includes(from))) { res.status(403).json({ error: 'forbidden origin' }); return false; }
  const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '?').split(',')[0].trim(), now = Date.now();
  if (hits.size > 5000) hits.clear();
  const w = (hits.get(ip) || []).filter(t => now - t < 60000); w.push(now); hits.set(ip, w);
  if (w.length > perMin) { res.setHeader('Retry-After', '60'); res.status(429).json({ error: '요청이 너무 잦습니다 — 1분 뒤 다시 시도하세요.' }); return false; }
  return true;
}
