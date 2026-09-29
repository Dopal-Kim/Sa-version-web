// Overpass 중계 함수 — 브라우저가 Overpass 를 직접 부르면 CORS·봇 필터·IP 슬롯 대기열에 걸리는 환경이 있어,
// 같은 도메인(/api/overpass)으로 받아 서버에서 대신 호출한다. 서버-서버 통신은 CORS 제약이 없다.
//
// 동작 원리(v9):
//  1) 각 인스턴스의 /api/status 를 먼저 읽어(4초 상한) "지금 슬롯이 있는지"를 확인한다. 공개 Overpass 는 IP 당
//     동시 실행 수를 제한하고 초과분은 대기열에 세우는데, 대기열에 선 요청은 timeout 까지 첫 바이트도 오지 않는다.
//     "Slot available after ..." 만 있고 "available now" 가 없으면 그 인스턴스는 건너뛴다 — 기다려봐야 같다.
//  2) 슬롯이 있는 인스턴스에만 질의를 보내고, 첫 성공 응답을 그대로 돌려준다.
//  3) 함수 상한은 60초(Vercel Hobby 기본, Fluid Compute 없이도 배포됨). 브라우저가 X-Budget-Ms 로 단계 예산을
//     알려주면 그 안에서만 기다린다.
export const config = { maxDuration: 60 };

// 운영자가 다른 세 계열을 섞는다: 메인 클러스터(overpass-api.de: z/lz4/main) · mail.ru · private.coffee/kumi(형제).
// 메인 클러스터는 브라우저 XHR 을 봇으로 거르지만 서버에서 User-Agent 를 붙여 부르면 정상 응답하며 용량이 가장 크다.
const MIRRORS = [
  "https://z.overpass-api.de",
  "https://lz4.overpass-api.de",
  "https://overpass-api.de",
  "https://maps.mail.ru/osm/tools/overpass",
  "https://overpass.private.coffee",
  "https://overpass.kumi.systems",
];
const UA = "SA-SmartSchedule/0.2 (site-context lookup; github.com/Dopal-Kim/Sa-version-web)";

async function slotStatus(base) {
  // 반환: { ok:true } 슬롯 있음 / { ok:false, why } 슬롯 없음 / { ok:null, why } 확인 불가(그래도 시도)
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 4000);
  try {
    const r = await fetch(base + "/api/status", { headers: { "User-Agent": UA }, signal: ctl.signal });
    clearTimeout(t);
    const txt = await r.text();
    if (!r.ok) return { ok: null, why: `status HTTP ${r.status}` };
    if (/slots? available now/i.test(txt)) return { ok: true };
    const m = txt.match(/Slot available after:.*?in (\d+) seconds/i);
    if (m) return { ok: false, why: `슬롯 없음(대기열, ${m[1]}초 후)` };
    if (/Slot available after/i.test(txt)) return { ok: false, why: "슬롯 없음(대기열)" };
    return { ok: null, why: "status 해석 불가" };
  } catch (e) {
    clearTimeout(t);
    return { ok: null, why: "status " + (e && e.name === "AbortError" ? "timeout" : String(e)) };
  }
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") return res.status(200).end();

  const q = (req.body && req.body.data) || (typeof req.body === "string" ? req.body : "");
  if (!q) return res.status(400).json({ error: "missing 'data' (Overpass QL)" });

  const hinted = Number(req.headers["x-budget-ms"]);
  const total = Math.min(isFinite(hinted) && hinted > 5000 ? hinted : 48000, 48000); // 함수 상한 60s 안 — 슬롯 확인(≤4s)과 응답 전송 시간을 남긴다(504 방지)
  const deadline = Date.now() + total;
  const notes = [];
  const short = (u) => u.replace(/^https:\/\//, "");

  // 1) 슬롯 확인은 병렬로 (4초 안에 끝남)
  const statuses = await Promise.all(MIRRORS.map(slotStatus));
  const order = [];
  MIRRORS.forEach((base, i) => {
    const st = statuses[i];
    if (st.ok === false) { notes.push(`${short(base)}: ${st.why} → 건너뜀`); return; }
    order.push({ base, unknown: st.ok === null, why: st.why });
  });
  // 슬롯이 확인된 곳을 먼저, 확인 불가는 뒤로
  order.sort((a, b) => (a.unknown ? 1 : 0) - (b.unknown ? 1 : 0));
  if (!order.length) return res.status(503).json({ error: "no Overpass slot available", last: notes.join(" ; ") });

  // 2) 순서대로 질의
  for (let i = 0; i < order.length; i++) {
    const { base } = order[i];
    const remaining = deadline - Date.now();
    if (remaining < 6000) { notes.push("예산 소진"); break; }
    const budget = Math.max(12000, Math.floor(remaining / (order.length - i)));
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), budget);
    const t0 = Date.now();
    try {
      const r = await fetch(base + "/api/interpreter", {
        method: "POST",
        body: "data=" + encodeURIComponent(q),
        headers: { "Content-Type": "application/x-www-form-urlencoded", "Accept": "application/json", "User-Agent": UA },
        signal: ctl.signal,
      });
      clearTimeout(t);
      const text = await r.text();
      const secs = Math.round((Date.now() - t0) / 1000);
      if (!r.ok) { notes.push(`${short(base)}: HTTP ${r.status} (${secs}s)`); continue; }
      // Overpass 는 오류도 200 으로 줄 때가 있다("remark": "runtime error: ... timed out")
      if (/"remark"\s*:\s*"[^"]*(timed out|error)/i.test(text.slice(0, 2000)) && !/"elements"\s*:\s*\[\s*\{/.test(text)) {
        notes.push(`${short(base)}: 서버 remark 오류 (${secs}s)`); continue;
      }
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.setHeader("X-Overpass-Source", short(base));
      res.setHeader("X-Overpass-Notes", encodeURIComponent(notes.join(" ; ")));
      return res.status(200).send(text);
    } catch (e) {
      clearTimeout(t);
      notes.push(`${short(base)}: ${e && e.name === "AbortError" ? "timeout" : String(e)} (${Math.round((Date.now() - t0) / 1000)}s)`);
    }
  }
  res.status(502).json({ error: "all Overpass mirrors failed", last: notes.join(" ; ") });
}
