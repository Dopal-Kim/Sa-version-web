// Overpass 중계 함수 — 브라우저가 Overpass 미러를 직접 부르면 CORS·망 차단·봇 필터로
// "Failed to fetch"가 나는 환경이 있어, 같은 도메인(/api/overpass)으로 받아 서버에서 대신 호출한다.
// 서버-서버 통신은 CORS 제약이 없고, 미러 3곳을 순서대로 시도해 첫 성공 응답을 그대로 돌려준다.
export const config = { maxDuration: 60 };

const MIRRORS = [
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
  "https://z.overpass-api.de/api/interpreter",
];

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") return res.status(200).end();

  // Vercel이 x-www-form-urlencoded 본문을 객체로 파싱해 준다 → req.body.data
  const q = (req.body && req.body.data) || (typeof req.body === "string" ? req.body : "");
  if (!q) return res.status(400).json({ error: "missing 'data' (Overpass QL)" });

  const deadline = Date.now() + 55000; // 함수 상한(60s) 안에서 끝내기 위한 총 예산
  let last = "no mirror tried";
  for (const url of MIRRORS) {
    const budget = Math.min(28000, deadline - Date.now());
    if (budget < 3000) break;
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), budget);
    try {
      const r = await fetch(url, {
        method: "POST",
        body: "data=" + encodeURIComponent(q),
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Accept": "application/json",
          "User-Agent": "SA-SmartSchedule/0.2 (site-context lookup; github.com/Dopal-Kim/Sa-version-web)",
        },
        signal: ctl.signal,
      });
      clearTimeout(t);
      const text = await r.text();
      if (!r.ok) { last = `${url} -> HTTP ${r.status}`; continue; }
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      return res.status(200).send(text);
    } catch (e) {
      clearTimeout(t);
      last = `${url} -> ${e && e.name === "AbortError" ? "timeout" : String(e)}`;
    }
  }
  res.status(502).json({ error: "all Overpass mirrors failed", last });
}
