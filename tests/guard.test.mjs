// API 중계 가드 — 출처·메서드·호출 빈도·입력 길이 (네트워크 없이 가짜 req/res로 검사)
import { test } from 'node:test'; import assert from 'node:assert/strict';
import { guard } from '../lib/guard.js';
import geocode from '../api/geocode.js'; import overpass from '../api/overpass.js'; import traffic from '../api/traffic.js';
let ipN = 0;
const req = (o = {}) => ({ method: 'GET', query: {}, body: undefined, ...o, headers: { host: 'sa.example.app', 'x-forwarded-for': '10.0.0.' + (++ipN), ...(o.headers || {}) } });
const res = () => { const r = { code: 200, headers: {}, body: null, setHeader(k, v) { r.headers[k] = v; }, status(c) { r.code = c; return r; }, json(b) { r.body = b; return r; }, send(b) { r.body = b; return r; }, end() { return r; } }; return r; };
const run = (o, opt) => { const r = res(); return [guard(req(o), r, opt), r]; };
test('같은 호스트 Referer/Origin → 통과', () => {
  assert.equal(run({ headers: { referer: 'https://sa.example.app/index.html' } })[0], true);
  assert.equal(run({ method: 'POST', headers: { origin: 'https://sa.example.app' } }, { methods: ['POST'] })[0], true);
});
test('다른 사이트·출처 없음·null 출처 → 403', () => {
  for (const h of [{ origin: 'https://evil.example' }, {}, { origin: 'null' }, { referer: 'https://sa.example.app.evil.example/' }]) { const [ok, r] = run({ headers: h }); assert.equal(ok, false); assert.equal(r.code, 403); }
});
test('ALLOWED_ORIGINS 추가 허용', () => {
  process.env.ALLOWED_ORIGINS = 'https://demo.example/, localhost:3000';
  try { assert.equal(run({ headers: { origin: 'https://demo.example' } })[0], true); assert.equal(run({ headers: { referer: 'http://localhost:3000/x' } })[0], true); }
  finally { delete process.env.ALLOWED_ORIGINS; }
});
test('메서드 제한 → 405', () => { const [ok, r] = run({ method: 'POST', headers: { referer: 'https://sa.example.app/' } }); assert.equal(ok, false); assert.equal(r.code, 405); });
test('같은 IP 분당 한도 초과 → 429', () => {
  const o = { headers: { referer: 'https://sa.example.app/', 'x-forwarded-for': '192.0.2.77' } };
  for (let i = 0; i < 5; i++) assert.equal(guard(req(o), res(), { perMin: 5 }), true);
  const r = res(); assert.equal(guard(req(o), r, { perMin: 5 }), false); assert.equal(r.code, 429);
});
test('입력 길이 제한', async () => {
  const ref = { referer: 'https://sa.example.app/' };
  let r = res(); await geocode(req({ headers: ref, query: { q: 'x'.repeat(201) } }), r); assert.equal(r.code, 400);
  r = res(); await overpass(req({ method: 'POST', headers: { origin: 'https://sa.example.app' }, body: { data: 'x'.repeat(10001) } }), r); assert.equal(r.code, 413);
  r = res(); await overpass(req({ headers: ref }), r); assert.equal(r.code, 405);
  r = res(); await traffic(req({ headers: { origin: 'https://evil.example' }, query: { lat: '37', lng: '127' } }), r); assert.equal(r.code, 403);
});
