// TMAP 교통정보 중계 — 브라우저에 appKey 를 노출하지 않기 위해 서버가 대신 부른다.
// 요청: /api/traffic?lat=&lng=&radius=1..9  (radius 1=300m … 9=2700m, TMAP 정의)
// 응답: TMAP 의 GeoJSON 을 그대로 전달 (features[].geometry LineString, properties.congestion 0~4 등)
export const config = { maxDuration: 30 };

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") return res.status(200).end();
  const appKey = process.env.TMAP_APP_KEY;
  if (!appKey) return res.status(500).json({ error: "서버에 TMAP_APP_KEY 환경변수가 없습니다 — Vercel Settings → Environment Variables 에 등록 후 Redeploy" });
  const lat = Number(req.query.lat), lng = Number(req.query.lng);
  const radius = Math.min(9, Math.max(1, Number(req.query.radius) || 4));
  if (!isFinite(lat) || !isFinite(lng)) return res.status(400).json({ error: "lat/lng 가 필요합니다" });

  const url = "https://apis.openapi.sk.com/tmap/traffic?version=1" +
    `&centerLat=${lat}&centerLon=${lng}&radius=${radius}&trafficType=AROUND&zoomLevel=16&reqCoordType=WGS84GEO&resCoordType=WGS84GEO`;
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 20000);
  try {
    const r = await fetch(url, { headers: { appKey, Accept: "application/json" }, signal: ctl.signal });
    const body = await r.text();
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    // TMAP 오류(401 키 오류, 429 한도 초과 등)는 상태 코드와 본문을 그대로 전달해 화면이 사유를 보여주게 한다
    res.status(r.status).send(body);
  } catch (e) {
    res.status(502).json({ error: e && e.name === "AbortError" ? "TMAP 응답 없음(20초 초과)" : String(e) });
  } finally {
    clearTimeout(t);
  }
}
