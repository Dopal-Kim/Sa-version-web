// 기상청 API허브 단기예보 중계 — weather_proxy.py 의 /forecast 와 같은 쿼리 형식.
// 브라우저가 기상청을 직접 부르면 CORS 로 막히므로 서버가 대신 호출한다.
// 인증키: Vercel 환경변수 KMA_AUTH_KEY 가 있으면 그것을, 없으면 쿼리의 key 를 쓴다.
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") return res.status(200).end();

  const { base_date, base_time, nx, ny, key } = req.query;
  const authKey = process.env.KMA_AUTH_KEY || key;
  if (!base_date || !base_time || !nx || !ny) return res.status(400).json({ error: "missing base_date/base_time/nx/ny" });
  if (!authKey) return res.status(400).json({ error: "인증키가 없습니다 — 화면의 인증키 칸에 입력하거나 Vercel 환경변수 KMA_AUTH_KEY 를 설정하세요." });

  const url =
    "https://apihub.kma.go.kr/api/typ02/openApi/VilageFcstInfoService_2.0/getVilageFcst" +
    `?pageNo=1&numOfRows=200&dataType=JSON&base_date=${base_date}&base_time=${base_time}` +
    `&nx=${nx}&ny=${ny}&authKey=${encodeURIComponent(authKey)}`;
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 15000);
    const upstream = await fetch(url, { signal: ctl.signal }).finally(() => clearTimeout(t));
    const body = await upstream.text();
    // 기상청은 403(활용신청 미승인 등)도 본문에 사유를 담아 주므로 상태 코드와 본문을 그대로 전달한다.
    res.setHeader("Content-Type", upstream.headers.get("content-type") || "application/json; charset=utf-8");
    res.status(upstream.status).send(body);
  } catch (e) {
    res.status(502).json({ error: e && e.name === "AbortError" ? "기상청 응답 없음(15초 초과)" : String(e) });
  }
}
