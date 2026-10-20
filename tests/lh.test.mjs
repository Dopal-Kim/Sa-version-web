// LH 공사기간 산정(SA_LH_CORE) — 원문 별표8 예시(서울 지하1층 4.5m초과·지상20층·800세대, 2016.9.14 착공 → 795일)를 구간별로 재현
import { test } from 'node:test'; import assert from 'node:assert/strict';
import fs from 'node:fs'; import vm from 'node:vm';
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const ctx = vm.createContext({}); ctx.window = ctx; vm.runInContext(html.match(/<script id="sa-lh-core">([\s\S]*?)<\/script>/)[1], ctx);
const H = ctx.SA_LH_CORE, J = x => JSON.parse(JSON.stringify(x));
const EX8 = { region: '서울', start: '2016-09-14', basement: 1, basementTall: 1, parking: 'lt150', floors: 20, formwork: 'system',
  retaining: 'self', retainingScale: 'general', pile: { method: 'bored', depth: 25, count: 2000 }, roof: 'concrete', housing: 'sale' };

test('별표 파싱: 77개 지역 × 4표, 서울 골조 월별 비작업일, 2급지 동절기 12.1~2.28, 미산출 지역 별칭', () => {
  assert.equal(Object.keys(H.RULES.nonwork.frame).length, 77);
  assert.deepEqual(J(H.RULES.nonwork.frame['서울']), [12, 10, 9, 9, 11, 9, 15, 17, 10, 10, 9, 11]);
  assert.deepEqual(J(H.RULES.nonwork.earth['서울']), [12, 10, 9, 10, 13, 11, 19, 16, 12, 11, 9, 12]);
  assert.deepEqual(J(H.RULES.winter['2']), ['12-01', '02-28']);
  assert.equal(H.station('하남'), '서울');
  assert.throws(() => H.station('평양'), /없습니다/);
});

test('별표8 작업일: 토목 24(터파기 18 + 흙막이 5.5→6), 기초 51(지반면 2 + 선굴착 38 + 지지력 11), 지하 78(71+7), 마감 125·30', () => {
  const w = J(H.workPlan(EX8));
  assert.equal(w.civil, 24); assert.equal(w.found, 51); assert.equal(w.basementFrame, 78);
  assert.equal(w.wet, 125); assert.equal(w.dry, 30); assert.equal(w.frameAdj, 15);
  assert.equal(w.floorDays.reduce((a, b) => a + b, 0), 18 + 7 * 19);   // 동절기 보정 전
});

test('별표8 공사기간 795일 — 구간별 일수·날짜·비작업일·동절기 층(15~20층)까지 원문 예시와 같음', () => {
  const s = J(H.schedule(EX8)), P = Object.fromEntries(s.phases.map(p => [p.key, p]));
  const expect = [  // [구간, 일수, 시작, 끝, 작업일, 비작업일] — 원문 별표8
    ['prep', 30, '2016-09-14', '2016-10-13'], ['civil', 37, '2016-10-14', '2016-11-19', 24, 13], ['found', 81, '2016-11-20', '2017-02-08', 51, 30],
    ['safety1', 1, '2017-02-09', '2017-02-09'], ['subFrame', 116, '2017-02-10', '2017-06-05', 78, 38], ['superFrame', 253, '2017-06-06', '2018-02-13', 157, 96],
    ['frameAdj', 15, '2018-02-14', '2018-02-28'], ['safety2', 3, '2018-03-01', '2018-03-03'], ['wet', 184, '2018-03-04', '2018-09-03', 125, 59],
    ['dry', 44, '2018-09-04', '2018-10-17', 30, 14], ['safety3', 1, '2018-10-18', '2018-10-18'], ['closeout', 30, '2018-10-19', '2018-11-17']];
  for (const [k, days, start, end, work, non] of expect) {
    assert.equal(P[k].days, days, `${k} 일수`); assert.equal(P[k].start, start, `${k} 시작`); assert.equal(P[k].end, end, `${k} 끝`);
    if (work != null) { assert.equal(P[k].work, work, `${k} 작업일`); assert.equal(P[k].nonwork, non, `${k} 비작업일`); }
  }
  assert.deepEqual(P.superFrame.winterFloors, [15, 16, 17, 18, 19, 20]);
  assert.equal(s.total, 795); assert.equal(s.end, '2018-11-17');
});

test('공법·지역·착공월이 공기를 바꿈: 유로폼 > 시스템, 동절기 착공은 골조 층당 +1일, 철원(1급지) > 부산(5급지)', () => {
  const base = { ...EX8 };
  assert.ok(H.schedule({ ...base, formwork: 'euro' }).total > H.schedule(base).total + 70);   // 층당 11일 vs 7일 × 19개층
  const summer = H.schedule({ ...base, start: '2016-06-01' }).phases.find(p => p.key === 'superFrame');   // 지상골조가 3~11월
  assert.equal(summer.winterFloors.length, 0);
  assert.equal(summer.work, 18 + 7 * 19);
  assert.ok(H.schedule({ ...base, region: '철원' }).total > H.schedule({ ...base, region: '부산' }).total);
  assert.throws(() => H.schedule({ ...base, floors: 2 }), /2층 이하/);
});

test('LH 템플릿 → 위치기반 엔진(달력 모드): 결정 공기가 LH 정밀 계산과 1.5% 이내, 학습 분포 P80 > 결정값 > 대칭 ±15% 대비 꼬리', () => {
  const c2 = vm.createContext({}); c2.window = c2;
  const blk = id => html.match(new RegExp('<script id="' + id + '"[^>]*>([\\s\\S]*?)</script>'))[1];
  vm.runInContext(blk('sa-lbs-core'), c2); vm.runInContext(blk('sa-lh-core'), c2);
  const L = c2.SA_LBS_CORE, H2 = c2.SA_LH_CORE, prior = JSON.parse(blk('sa-duration-prior'));
  for (const [region, start] of [['서울', '2016-09-14'], ['서울', '2016-06-01'], ['철원', '2016-09-14'], ['부산', '2016-12-01']]) {
    const t = H2.template({ ...EX8, region, start }), net = L.expand(t.model);
    const T = L.schedule(net, Float64Array.from(net.acts, a => a.dur), L.makeCalendar(net, t.calendar)).T;
    assert.ok(Math.abs(T / t.lh.total - 1) < 0.015, `${region} ${start}: 엔진 ${T.toFixed(1)} vs LH ${t.lh.total}`);
  }
  const t = H2.template(EX8);
  const learned = L.simulate(t.model, { N: 500, seed: 9, calendar: t.calendar, prior });
  const sym = L.simulate(t.model, { N: 500, seed: 9, calendar: t.calendar, ratio: 'sym15' });
  assert.ok(learned.p80cal >= learned.p80 && learned.p80 > learned.deterministic * 1.05);
  assert.ok(learned.p80 - learned.p50 > 3 * (sym.p80 - sym.p50));   // 학습 분포의 오른쪽 꼬리가 대칭 ±15%보다 훨씬 김
});

test('기상 연도별 변동: 서울 실측 3년 → 연·월 비작업일(골조 연 합계가 LH 132일과 15% 이내), 편차 보정 평균 = LH 별표, 날씨만으로 공기가 해마다 달라짐', () => {
  const c3 = vm.createContext({}); c3.window = c3;
  const blk = id => html.match(new RegExp('<script id="' + id + '"[^>]*>([\\s\\S]*?)</script>'))[1];
  vm.runInContext(blk('sa-lbs-core'), c3); vm.runInContext(blk('sa-lh-core'), c3);
  const L = c3.SA_LBS_CORE, H3 = c3.SA_LH_CORE;
  const { daily } = JSON.parse(fs.readFileSync(new URL('./fixtures/weather_seoul_2016_2018.json', import.meta.url), 'utf8'));
  const ys = J(H3.weatherYears(daily));
  assert.deepEqual(ys.map(y => y.year), [2016, 2017, 2018]);
  for (const y of ys) { const tot = y.tables.frame.reduce((a, b) => a + b, 0); assert.ok(Math.abs(tot / 132 - 1) < 0.15, `${y.year} 골조 ${tot}일`); assert.ok(y.tables.frame[1] >= 8 && y.tables.frame[0] >= 9); }
  const an = J(H3.anomalyTables('서울', ys)), lh = H3.RULES.nonwork.frame['서울'];
  for (let m = 0; m < 12; m++) { const avg = an.reduce((a, y) => a + y.tables.frame[m], 0) / an.length; assert.ok(Math.abs(avg - lh[m]) <= 1, `${m + 1}월 평균 ${avg} vs LH ${lh[m]}`); }
  const t = H3.template(EX8);
  const fixed = L.simulate(t.model, { N: 300, seed: 4, calendar: t.calendar, ratio: 'none' });
  const vary = L.simulate(t.model, { N: 300, seed: 4, calendar: t.calendar, ratio: 'none', calendarVariants: an });
  assert.equal(new Set(Array.from(fixed.samples).map(Math.round)).size, 1);       // 날씨 고정 + 기간 고정 → 한 값
  assert.ok(new Set(Array.from(vary.samples).map(Math.round)).size >= 2);        // 해마다 다른 날씨 → 여러 값
});

test('관측소 좌표: LH 77개 지역 모두 기상청 공식 좌표, 별칭 지역은 기준 관측소 좌표', () => {
  assert.equal(Object.keys(H.STATIONS).length, 77);
  for (const n of Object.keys(H.RULES.nonwork.frame)) assert.ok(H.STATIONS[n], n);
  assert.deepEqual(J(H.stationCoord('서울')), { station: '서울', lat: 37.57142, lon: 126.9658, id: 108 });
  assert.equal(H.stationCoord('하남').station, '서울');
  for (const [lat, lon] of Object.values(H.STATIONS)) assert.ok(lat > 33 && lat < 39 && lon > 124 && lon < 131);
});
