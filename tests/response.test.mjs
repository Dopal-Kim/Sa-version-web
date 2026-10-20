// 대응안 효용 평가(SA_RESPONSE_CORE) — 비용 손계산, 파레토·TOPSIS, 대응안 효과의 방향, 공공 보정과 일관성, 공통 난수
import { test } from 'node:test'; import assert from 'node:assert/strict';
import fs from 'node:fs'; import vm from 'node:vm';
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const blk = id => html.match(new RegExp('<script id="' + id + '"[^>]*>([\\s\\S]*?)</script>'))[1];
const ctx = vm.createContext({}); ctx.window = ctx;
for (const id of ['sa-lbs-core', 'sa-lh-core', 'sa-response-core']) vm.runInContext(blk(id), ctx);
const R = ctx.SA_RESPONSE_CORE, L = ctx.SA_LBS_CORE, H = ctx.SA_LH_CORE, prior = JSON.parse(blk('sa-duration-prior'));
const EX8 = { region: '서울', start: '2016-09-14', basement: 1, basementTall: 1, parking: 'lt150', floors: 20, formwork: 'system', retaining: 'self', retainingScale: 'general', pile: { method: 'bored', depth: 25, count: 2000 }, roof: 'concrete', housing: 'sale' };

test('비용 손계산: 지체상금 = 0.5/1000 × 계약금액 × 지연일(상한 30%), 간접비 = 8% ÷ 계약공기 × 공기', () => {
  const econ = { ...R.ECON_DEFAULT, contractAmount: 1000 };
  const s = R.costStats(Float64Array.from([800, 1000, 3000]), 1000, econ, 5);
  // 지연 0 / 0 / 2000일 → 0.0005×1000×2000 = 1000억 > 상한 300억 → 300
  assert.ok(Math.abs(s.expectedLD - 100) < 1e-9);
  const perDay = 1000 * 0.08 / 1000;
  assert.ok(Math.abs(s.expectedCost - (5 + (0 + 0 + 300) / 3 + perDay * (800 + 1000 + 3000) / 3)) < 1e-9);
  assert.ok(Math.abs(s.onTimeProb - 2 / 3) < 1e-9);
  assert.ok(Math.abs(s.cvar95 - (5 + 300 + perDay * 3000)) < 1e-9);   // 표본 3개 → 최악 1개
});

test('파레토: 모든 기준에서 밀리는 해만 빠짐 / TOPSIS: 이상해에 가까운 순', () => {
  const rows = [{ id: 'a', x: 1, y: 5 }, { id: 'b', x: 2, y: 2 }, { id: 'c', x: 3, y: 3 }, { id: 'd', x: 5, y: 1 }];
  assert.deepEqual(JSON.parse(JSON.stringify(R.pareto(rows, ['x', 'y']).map(r => r.id))), ['a', 'b', 'd']);
  const t = R.topsis(rows, [{ key: 'x', w: 0.5, better: 'min' }, { key: 'y', w: 0.5, better: 'min' }]);
  assert.equal(t[0].id, 'b');
  assert.ok(t.findIndex(x => x.id === 'c') > t.findIndex(x => x.id === 'b'));   // c 는 b 에 지배됨(극단해 a·d 가 꼴찌일 수는 있음)
});

test('마감 층별 선행 착수: LH 일괄 마감보다 결정 공기가 짧고, 습식 마감 1층은 골조 4층 완료 뒤 시작(3개층 버퍼)', () => {
  const tpl = H.template(EX8), flow = R.finishFlow(tpl);
  const det = t => { const net = L.expand(t.model); return L.schedule(net, Float64Array.from(net.acts, a => a.dur), L.makeCalendar(net, t.calendar)); };
  const a = det(tpl), b = det(flow), netB = L.expand(flow.model);
  assert.ok(b.T < a.T - 60, `일괄 ${a.T.toFixed(0)} vs 흐름 ${b.T.toFixed(0)}`);
  const id = x => netB.idx[x];
  assert.ok(b.es[id('wet@F1')] >= b.ef[id('superFrame@F4')] - 1e-9);
});

test('연장근무: 골조 기간은 줄지만 8→10시간(+25%)만큼은 아님(효율 −12.5%) — 안전 노출 1.5', () => {
  const tpl = H.template(EX8), c = { p: EX8, tpl, drivers: [], econ: R.ECON_DEFAULT };
  const o = R.OPTIONS.overtimeFrame.apply(c);
  const f = o.tpl.model.tasks.find(t => t.id === 'superFrame').durByLoc.F5 / tpl.model.tasks.find(t => t.id === 'superFrame').durByLoc.F5;
  assert.ok(f > 1 / 1.25 && f < 1, `배율 ${f}`);
  assert.equal(o.safety, 0.5);
});

test('평가: 공공 기준안 기한내 확률 ≈ LH 실적(24%), 민간은 더 높음, 같은 입력·시드 = 같은 결과, 유로폼 현장만 거푸집 대응안', () => {
  const pub = R.evaluate(EX8, { mode: 'public', N: 1500, prior, options: ['finishFlow', 'materialDual'] });
  const pri = R.evaluate(EX8, { mode: 'private', N: 1500, prior, options: ['finishFlow'] });
  const b = pub.rows[0];
  assert.equal(b.id, 'base');
  assert.ok(b.onTimeProb > 0.12 && b.onTimeProb < 0.36, `공공 기한내 ${b.onTimeProb}`);   // 1개월 미만 지연 24% 보다 엄격(0일 기준)이라 조금 낮을 수 있음
  assert.ok(pri.rows[0].onTimeProb > b.onTimeProb + 0.2);
  const again = R.evaluate(EX8, { mode: 'public', N: 1500, prior, options: ['finishFlow', 'materialDual'] });
  assert.deepEqual(JSON.parse(JSON.stringify(again.rows.map(r => r.p80cal))), JSON.parse(JSON.stringify(pub.rows.map(r => r.p80cal))));
  assert.ok(pub.rows.find(r => r.id === 'finishFlow').p80cal < b.p80cal);
  assert.ok(pub.rows.find(r => r.id === 'materialDual').expectedDelay < b.expectedDelay);
  assert.equal(R.evaluate(EX8, { mode: 'public', N: 200, prior, options: ['formworkSystem'] }).rows.length, 1);   // 이미 시스템 거푸집
  assert.equal(R.evaluate({ ...EX8, formwork: 'euro' }, { mode: 'public', N: 200, prior, options: ['formworkSystem'] }).rows.length, 2);
});
