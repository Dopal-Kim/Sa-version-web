// 시뮬레이션 엔진 회귀 테스트 (node --test)
// ① 골든 마스터: 성능 최적화 전(v30) 엔진과 같은 표본·같은 대안에서 결과가 비트 단위로 같은지
// ② 공통난수(CRN): 같은 표본 번호는 항상 같은 결과
// ③ 대안 구성: 조치 유형별 전략 묶음(사건마다 만든 정책이 후보를 폭증시키지 않음)
import { test } from 'node:test'; import assert from 'node:assert/strict';
import fs from 'node:fs'; import crypto from 'node:crypto'; import vm from 'node:vm';
const here = new URL('.', import.meta.url).pathname, html = fs.readFileSync(here + '../index.html', 'utf8');
const block = id => { const m = html.match(new RegExp(`<script id="${id}">([\\s\\S]*?)</script>`)); assert.ok(m, id); return m[1]; };
const ctx = vm.createContext({ console }); ctx.globalThis = ctx;
vm.runInContext(block('sa-adaptive13-engine'), ctx); vm.runInContext(block('sa-v12-logic'), ctx);
const E = ctx.SA_ADAPTIVE13_ENGINE, L = ctx.SA_V12_LOGIC;
const h = x => crypto.createHash('sha1').update(JSON.stringify(x)).digest('hex').slice(0, 16);
const load = f => JSON.parse(fs.readFileSync(here + 'fixtures/' + f, 'utf8'));
// v30(최적화 전) 엔진으로 기록한 값 — 대안은 [대응 없음, 정책별 단독, 전체 조합]
const GOLDEN = {
  'ifc36_bare.json':  { K: 10, ref: 'ae1e29edf8554af4', compact: '0c89aeadbf4d6ac3', detailed: '18ee80e841505e21', noRef: '4b52943565e13f9c' },
  'ifc36_risk.json':  { K: 10, ref: 'ae1e29edf8554af4', compact: 'e70cd6522d63bc88', detailed: '19782d626f399d0d', noRef: '3af90006ed007b7b' },
  'syn150_risk.json': { K: 10, ref: '9060e9af3700fb43', compact: '5d5ec035562aa736', detailed: '9e41bfdd48aa1912', noRef: 'e9bf7482876da0e6' },
  'syn400_risk.json': { K: 2,  ref: 'badb63fb0c748488', compact: '880711d006745a7a', detailed: 'bc31eff1bb05ed9b', noRef: '2b94cf2f9a383507' },
};
const legacyCandidates = s => { const ps = s.policies.filter(p => p.enabled !== false), out = [{ policyIds: [] }, ...ps.map(p => ({ policyIds: [p.id] }))]; if (s.settings.bundle && ps.length > 1) out.push({ policyIds: ps.map(p => p.id) }); return out; };
for (const [f, g] of Object.entries(GOLDEN)) test('골든 마스터 ' + f, () => {
  const s = L.clone(load(f).snapshot), cs = legacyCandidates(s), ref = E.baseline(s);
  assert.equal(h(ref), g.ref, 'baseline'); const compact = [];
  for (let i = 0; i < g.K; i++) { const w = E.makeWorld(s, i); for (const c of cs) { const { rows, trace, history, materialLedger, reference, inventory, ...small } = E.simulate(s, w, c.policyIds, { detailed: false, reference: ref }); compact.push({ ...small, taskTimes: rows.map(x => [x.id, x.start, x.finish]) }); } }
  assert.equal(h(compact), g.compact, 'compact');
  assert.equal(h(cs.map(c => { const { reference, ...r } = E.simulate(s, E.makeWorld(s, 7), c.policyIds, { detailed: true, reference: ref }); return r; })), g.detailed, 'detailed');
  const { reference, ...r } = E.simulate(s, E.makeWorld(s, 3), cs[cs.length - 1].policyIds, { detailed: true }); assert.equal(h([r, reference]), g.noRef, 'no-reference');
});
test('공통난수: 같은 표본 번호 → 같은 결과', () => { const s = L.clone(load('ifc36_risk.json').snapshot), ref = E.baseline(s), a = E.simulate(s, E.makeWorld(s, 5), [], { detailed: false, reference: ref }), b = E.simulate(s, E.makeWorld(s, 5), [], { detailed: false, reference: ref }); assert.equal(a.completion, b.completion); });
test('대안 구성: 조치 유형별 전략 묶음', () => {
  const s = L.clone(load('ifc36_risk.json').snapshot), cs = L.candidates(s);
  assert.equal(s.policies.length, 15); assert.equal(cs.length, 5);
  assert.equal(cs.map(c => c.id).join(','), ['none', 'family:prioritize_zone', 'family:backup_resource', 'family:expedite_release', 'bundle'].join(','));
  for (const c of cs.slice(1, 4)) assert.ok(c.policyIds.every(id => s.policies.find(p => p.id === id).action === c.id.slice(7)));
});
