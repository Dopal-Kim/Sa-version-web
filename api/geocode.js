// 주소 → 좌표 중계. 브라우저에서 Nominatim 을 직접 부르면 IP 제한·느린 응답으로 멈추는 경우가 있어 서버에서 대신 부른다.
// Nominatim 이용약관상 식별 가능한 User-Agent 가 필수이며, 실패하면 Photon(komoot) 으로 넘어간다.
export const config = { maxDuration: 30 };
const UA = "SA-SmartSchedule/0.2 (site-context lookup; github.com/Dopal-Kim/Sa-version-web)";

async function withTimeout(url, ms, headers) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try { return await fetch(url, { headers, signal: ctl.signal }); }
  finally { clearTimeout(t); }
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  const q = (req.query && req.query.q || "").trim();
  if (!q) return res.status(400).json({ error: "missing q" });
  const notes = [];
  try {
    const r = await withTimeout("https://nominatim.openstreetmap.org/search?format=json&limit=1&q=" + encodeURIComponent(q), 10000,
      { "User-Agent": UA, "Accept": "application/json", "Accept-Language": "ko,en" });
    if (r.ok) { const arr = await r.json(); if (arr && arr.length) return res.status(200).json({ lat: +arr[0].lat, lng: +arr[0].lon, source: "nominatim" }); notes.push("nominatim: 결과 없음"); }
    else notes.push(`nominatim: HTTP ${r.status}`);
  } catch (e) { notes.push("nominatim: " + (e && e.name === "AbortError" ? "timeout" : String(e))); }
  try {
    const r = await withTimeout("https://photon.komoot.io/api/?limit=1&lang=en&q=" + encodeURIComponent(q), 10000, { "User-Agent": UA, "Accept": "application/json" });
    if (r.ok) { const j = await r.json(); const f = j && j.features && j.features[0];
      if (f && f.geometry && f.geometry.coordinates) return res.status(200).json({ lat: +f.geometry.coordinates[1], lng: +f.geometry.coordinates[0], source: "photon" });
      notes.push("photon: 결과 없음"); }
    else notes.push(`photon: HTTP ${r.status}`);
  } catch (e) { notes.push("photon: " + (e && e.name === "AbortError" ? "timeout" : String(e))); }
  res.status(502).json({ error: "geocode failed", last: notes.join(" ; ") });
}
