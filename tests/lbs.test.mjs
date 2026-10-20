// 위치기반 공정 코어(SA_LBS_CORE) — 위치 1개 = CPM, 층 흐름·작업조·위치 버퍼, 연속성, 몬테카를로 재현성·학습 분포·보정 P80
import { test } from 'node:test'; import assert from 'node:assert/strict';
import fs from 'node:fs'; import vm from 'node:vm';
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const ctx = vm.createContext({}); ctx.window = ctx; vm.runInContext(html.match(/<script id="sa-lbs-core">([\s\S]*?)<\/script>/)[1], ctx);
const L = ctx.SA_LBS_CORE, J = x => JSON.parse(JSON.stringify(x));   // vm 배열 → 이 쪽 배열
const floors = n => Array.from({ length: n }, (_, i) => ({ id: `F${i + 1}`, order: i + 1 }));

test('위치 1개 = 일반 PDM CPM: FS+lag, SS, FF, SF (손계산 12일)', () => {
  // 1: 0~5 / 2: FS+1 → 6~9 / 3: SS+2 → 2~6 / 4: FF → 9-2=7, SF → 2+10-2=10 ⇒ 10~12
  const m = { tasks: [{ id: 'a', dur: 5 }, { id: 'b', dur: 3 }, { id: 'c', dur: 4 }, { id: 'd', dur: 2 }],
    taskLinks: [{ from: 'a', to: 'b', type: 'FS', lag: 1 }, { from: 'a', to: 'c', type: 'SS', lag: 2 }, { from: 'b', to: 'd', type: 'FF' }, { from: 'c', to: 'd', type: 'SF', lag: 10 }] };
  const s = L.schedule(L.expand(m), Float64Array.from([5, 3, 4, 2]));
  assert.equal(s.T, 12);
  assert.deepEqual(Array.from(s.es), [0, 6, 2, 10]);
  assert.deepEqual(J(s.critical), [true, false, true, true]);   // a→c(SS)→d(SF) 가 임계, b 는 여유 3일
  assert.equal(s.tf[1], 3);
});

test('층 흐름: 골조 3층(층당 5일) → 같은 층 마감(층당 3일) — 마감은 골조와 자기 이전 층을 모두 기다림', () => {
  const m = { locations: floors(3), tasks: [{ id: 'frame', dur: 5 }, { id: 'fin', dur: 3 }], taskLinks: [{ from: 'frame', to: 'fin' }] };
  const net = L.expand(m), s = L.schedule(net, Float64Array.from(net.acts, a => a.dur));
  // 골조 0-5,5-10,10-15 / 마감 5-8, 10-13, 15-18
  assert.equal(s.T, 18);
  assert.deepEqual(J(net.acts.map(a => a.id)), ['frame@F1', 'frame@F2', 'frame@F3', 'fin@F1', 'fin@F2', 'fin@F3']);
  assert.deepEqual(Array.from(s.es), [0, 5, 10, 5, 10, 15]);
  assert.equal(L.gaps(net, s.es, s.ef).fin, 4);               // 마감조 대기: 8→10, 13→15
});

test('작업조 2개는 두 층을 동시에, 위치 버퍼 1은 한 층 뒤에서 따라감', () => {
  const two = { locations: floors(4), tasks: [{ id: 'a', dur: 4, crews: 2 }] };
  assert.equal(L.schedule(L.expand(two), Float64Array.from([4, 4, 4, 4])).T, 8);
  const buf = { locations: floors(3), tasks: [{ id: 'a', dur: 2 }, { id: 'b', dur: 2 }], taskLinks: [{ from: 'a', to: 'b', locBuffer: 1 }] };
  const net = L.expand(buf), s = L.schedule(net, Float64Array.from(net.acts, a => a.dur));
  assert.deepEqual(Array.from(s.es).slice(3), [4, 6, 8]);   // b@F1 은 a@F2(2~4) 뒤, b@F3 은 a@F3(4~6)·b@F2 뒤
});

test('연속성: 공백 있는 공종을 늦춰 시작해 공백 0, 마지막 위치 종료와 전체 공기는 그대로', () => {
  const base = { locations: floors(3), tasks: [{ id: 'frame', dur: 5 }, { id: 'fin', dur: 3 }], taskLinks: [{ from: 'frame', to: 'fin' }] };
  const cont = { ...base, tasks: [{ id: 'frame', dur: 5 }, { id: 'fin', dur: 3, continuity: true }] };
  const n1 = L.expand(base), n2 = L.expand(cont), d = Float64Array.from(n1.acts, a => a.dur);
  const s1 = L.schedule(n1, d), s2 = L.schedule(n2, d);
  assert.equal(s2.T, s1.T);
  assert.equal(L.gaps(n2, s2.es, s2.ef).fin, 0);
  assert.deepEqual(Array.from(s2.es).slice(3), [9, 12, 15]);
});

test('잘못된 입력은 이유 있는 오류: 순환, 관계 형식, 없는 공종, 음수 기간', () => {
  assert.throws(() => L.expand({ tasks: [{ id: 'a', dur: 1 }, { id: 'b', dur: 1 }], taskLinks: [{ from: 'a', to: 'b' }, { from: 'b', to: 'a' }] }), /순환/);
  assert.throws(() => L.expand({ tasks: [{ id: 'a', dur: 1 }, { id: 'b', dur: 1 }], taskLinks: [{ from: 'a', to: 'b', type: 'XX' }] }), /FS·SS·FF·SF/);
  assert.throws(() => L.expand({ tasks: [{ id: 'a', dur: 1 }], taskLinks: [{ from: 'a', to: 'z' }] }), /없는 공종/);
  assert.throws(() => L.expand({ tasks: [{ id: 'a', dur: -1 }] }), /0 이상/);
});

test('몬테카를로: 같은 시드 = 같은 결과, 학습 분포는 프로젝트 하나에서 비율을 뽑음, 보정 P80 ≥ P80', () => {
  const m = { locations: floors(10), tasks: [{ id: 'frame', dur: 7 }, { id: 'fin', dur: 6 }], taskLinks: [{ from: 'frame', to: 'fin' }] };
  // 프로젝트 A: 모두 정시(1.0), 프로젝트 B: 모두 2배 → 반복마다 둘 중 하나 → 공기는 결정값 또는 그 2배
  const prior = { calibration_qstar: 0.9, projects: [
    { code: 'A', ratios_by_bin: [[], [], [1, 1, 1], [1, 1, 1], [], []] },
    { code: 'B', ratios_by_bin: [[], [], [2, 2, 2], [2, 2, 2], [], []] }] };
  const a = L.simulate(m, { N: 400, seed: 7, prior }), b = L.simulate(m, { N: 400, seed: 7, prior });
  assert.deepEqual(Array.from(a.samples), Array.from(b.samples));
  const det = a.deterministic, vals = new Set(Array.from(a.samples));
  assert.deepEqual([...vals].sort((x, y) => x - y), [det, det * 2]);
  assert.ok(a.p80cal >= a.p80 && a.qstar === 0.9);
  const none = L.simulate(m, { N: 50, seed: 1, ratio: 'none' });
  assert.equal(none.p50, det);
});

test('Risk Driver: 발생 확률대로 대상 공종에만 같은 배율 → 영향받는 공종 기간 상관', () => {
  const m = { tasks: [{ id: 'frame', dur: 10, trade: '골조' }, { id: 'fin', dur: 10, trade: '마감' }], taskLinks: [{ from: 'frame', to: 'fin' }] };
  const r = L.simulate(m, { N: 2000, seed: 3, ratio: 'none', riskDrivers: [{ id: 'remicon', prob: 0.3, impact: [1.5, 1.5, 1.5], trades: ['골조'] }] });
  assert.ok(Math.abs(r.driverHitRate[0] - 0.3) < 0.04);
  assert.deepEqual([...new Set(Array.from(r.samples))].sort((x, y) => x - y), [20, 25]);  // 골조 10 → 15 일 때만
});

test('CRPS: 표본이 실제값 한 점에 모이면 0, 퍼지면 양수', () => {
  assert.equal(L.crps(Float64Array.from([5, 5, 5]), 5), 0);
  assert.ok(L.crps(Float64Array.from([3, 5, 7]), 5) > 0);
});

test('실제 공정표 대조: DSLIB 네트워크(FS·SS·FF·SF + lag)의 결정 공기가 백테스트(Python) 계산과 같음', () => {
  const { nets } = JSON.parse(fs.readFileSync(new URL('./fixtures/dslib_nets.json', import.meta.url), 'utf8'));
  for (const x of nets) {
    const net = L.expand({ tasks: x.tasks, links: x.links });
    assert.equal(L.schedule(net, Float64Array.from(net.acts, a => a.dur)).T, x.det, x.code);
  }
});
