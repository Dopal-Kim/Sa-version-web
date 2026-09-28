// Vercel 서버리스 함수 버전 — weather_proxy.py의 /forecast 를 그대로 옮긴 것.
// 배포 후 프론트에서 호출 주소만 http://localhost:8001/forecast?... 에서
// https://<your-project>.vercel.app/api/forecast?... 로 바꾸면 됩니다.
//
// authKey는 이제 서버 쪽 환경변수(KMA_AUTH_KEY)로 관리합니다.
// (Vercel 대시보드 → Settings → Environment Variables 에 등록)
// 기존처럼 브라우저에서 key를 직접 넘기고 싶다면 주석 처리된 대안부를 사용하세요.

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");

  if (req.method === "OPTIONS") {
    res.status(200).end();
    return;
  }

  const { base_date, base_time, nx, ny, key } = req.query;

  // 환경변수 우선, 없으면 쿼리로 넘어온 key 사용(개발/테스트용)
  const authKey = process.env.KMA_AUTH_KEY || key;

  if (!base_date || !base_time || !nx || !ny || !authKey) {
    res.status(400).json({ error: "missing required params (base_date, base_time, nx, ny, key)" });
    return;
  }

  const url =
    "https://apihub.kma.go.kr/api/typ02/openApi/VilageFcstInfoService_2.0/getVilageFcst" +
    `?pageNo=1&numOfRows=200&dataType=JSON&base_date=${base_date}&base_time=${base_time}` +
    `&nx=${nx}&ny=${ny}&authKey=${authKey}`;

  try {
    const upstream = await fetch(url);
    const body = await upstream.text();
    res
      .status(upstream.status)
      .setHeader("Content-Type", upstream.headers.get("content-type") || "application/json")
      .send(body);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
}
