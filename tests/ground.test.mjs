// 지반·공법(SA_GROUND_CORE) — 사진 공정표 산식 재현, 지하층 없음, 지하수위·지층에 따른 추천과 근거 변화, 단계 굴착
import { test } from 'node:test'; import assert from 'node:assert/strict';
import fs from 'node:fs'; import vm from 'node:vm';
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const ctx = vm.createContext({}); ctx.window = ctx;
vm.runInContext(html.match(/<script id="sa-ground-core">([\s\S]*?)<\/script>/)[1], ctx); vm.runInContext(html.match(/<script id="sa-period-core">([\s\S]*?)<\/script>/)[1], ctx);
const G = ctx.SA_GROUND_CORE, P = ctx.SA_PERIOD_CORE, J = x => JSON.parse(JSON.stringify(x));
const LAY = [{ type: 'fill', bottom: 2, N: 6 }, { type: 'sand', bottom: 7, N: 18 }, { type: 'wsoil', bottom: 11, N: 40 }, { type: 'wrock', bottom: 15, N: 50 }, { type: 'srock', bottom: 30, N: 50 }];
test('① 사진 공정표 재현: 수량 ÷ (1일 작업량 × 대수) × 가동률 76% 보정 → 사진 표기 ±1일', () => {
  const k = P.factor('earth', 'rate', 76, 0), cal = (q, key, rate, units) => G.days(q, key, rate ? { [key]: [rate, '', units] } : {}) * k;
  const cases = [[5686, 'cip', null, null, 33], [8014, 'actpile', null, null, 47], [7880, 'asg', null, null, 51], [39075, 'digSoil', null, null, 86], [27743, 'digDeep', null, null, 61], [35558, 'digDeep', null, null, 78], [27743, 'digRock', null, null, 73]];
  for (const [q, key, r, u, photo] of cases) { const d = cal(q, key, r, u); assert.ok(Math.abs(d - photo) <= 1, `${key} ${q}: ${d.toFixed(1)}일 vs 사진 ${photo}일`); }
});
test('② 지하층 없으면 흙막이·단계 굴착 없음, 얕은 지하는 경사 굴착', () => {
  const r0 = J(G.recommend({ depth: 0, layers: LAY })); assert.equal(r0.wall, null); assert.equal(G.stages({ depth: 0 }, r0).length, 0);
  const r1 = J(G.recommend({ depth: 1.2, layers: LAY })); assert.equal(r1.wall, 'open'); assert.equal(r1.support, null);
  assert.equal(G.stages({ depth: 1.2, area: 100 }, { ...r1, layers: LAY }).length, 1);
});
test('③ 지하수위·지층·인접 조건이 바뀌면 추천과 근거 문구가 바뀜', () => {
  const base = { depth: 8, area: 1000, perimeter: 130, layers: [{ type: 'fill', bottom: 2, N: 6 }, { type: 'wsoil', bottom: 12, N: 30 }], gwl: null };
  const a = J(G.recommend(base)), b = J(G.recommend({ ...base, gwl: 3 })), c = J(G.recommend({ ...base, gwl: 3, layers: LAY })), d = J(G.recommend({ ...base, adjacentClose: true })), e = J(G.recommend({ ...base, depth: 22 }));
  assert.equal(a.wall, 'hpile'); assert.match(a.why.wall, /H-Pile|지하수위 미입력/);
  assert.equal(b.wall, 'cip'); assert.equal(b.cutoff, true); assert.match(b.why.wall, /지하수위 GL−3m/);
  assert.equal(c.wall, 'scw'); assert.match(c.why.wall, /연약·사질층/);
  assert.equal(d.wall, 'cip'); assert.match(d.why.wall, /인접 건물 근접/);
  assert.equal(e.wall, 'dwall');
  assert.equal(a.support, 'strut'); assert.equal(J(G.recommend({ ...base, anchorAllowed: true })).support, 'anchor'); assert.equal(J(G.recommend({ ...base, depth: 3.5 })).support, 'none');
});
test('기초 형식: 지지층(N≥50 또는 풍화암 이상) 깊이 기준', () => {
  assert.equal(G.recommend({ depth: 12, layers: LAY }).found, 'direct');      // 풍화암 상단 GL−11m ≤ 굴착 바닥 + 1
  assert.equal(G.recommend({ depth: 5, layers: LAY }).found, 'phc');
  assert.equal(G.recommend({ depth: 5, layers: LAY, stories: 25 }).found, 'bored');
  assert.equal(G.recommend({ depth: 5, layers: [{ type: 'clay', bottom: 20, N: 8 }, { type: 'srock', bottom: 40, N: 50 }] }).found, 'rockpile');
  assert.equal(G.recommend({ depth: 5, layers: [{ type: 'clay', bottom: 20, N: 8 }] }).found, 'bored');
});
test('단계 굴착: 지지 간격 3m(가정)로 나누고 지층별 물량·장비', () => {
  const ch = { ...G.recommend({ depth: 9, layers: LAY }), layers: LAY }, st = J(G.stages({ depth: 9, area: 100 }, ch));
  assert.equal(st.length, 3); assert.deepEqual(st.map(s => Math.round(s.vol)), [300, 300, 300]);
  assert.deepEqual(st[0].parts.map(p => [p.type, p.h, p.key]), [['fill', 2, 'digSoil'], ['sand', 1, 'digSoil']]);
  assert.equal(st[2].parts[0].key, 'digDeep');   // GL−6~9m: 8m 넘는 단계는 크람쉘
});
