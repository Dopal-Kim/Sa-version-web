// 공사기간 구성(SA_PERIOD_CORE) — 공종 기상 분류, 과거 일자료 → 월별 비작업 확률, 기간 배율, 사진 공정표 산식
import { test } from 'node:test'; import assert from 'node:assert/strict';
import fs from 'node:fs'; import vm from 'node:vm';
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const ctx = vm.createContext({}); ctx.window = ctx; vm.runInContext(html.match(/<script id="sa-period-core">([\s\S]*?)<\/script>/)[1], ctx);
const P = ctx.SA_PERIOD_CORE, J = x => JSON.parse(JSON.stringify(x));
test('공종 기상 분류: 토공 / 구조물·외부 / 기상 무관, 명시값 우선, 규칙 밖은 외부로 추정', () => {
  const c = t => J(P.exposureOf(t));
  assert.equal(c({ name: '2차 굴착 (토사 직상차)' }).cls, 'earth');
  assert.equal(c({ name: 'CIP 천공' }).cls, 'earth');
  assert.equal(c({ name: '1F 벽체 철근 배근' }).cls, 'outdoor');
  assert.equal(c({ name: '1F 슬래브 콘크리트 양생' }).cls, 'none');          // 양생은 기상으로 늘리지 않음(2단계에서 강도 기반으로)
  assert.equal(c({ name: '외부 도장' }).cls, 'outdoor');                       // '외부'가 '도장'보다 우선
  assert.equal(c({ name: '세대 내부 미장' }).cls, 'none');
  assert.equal(c({ name: '터파기', weather_exposure: 'none' }).cls, 'none');  // 사람이 바꾼 값 우선
  assert.deepEqual(c({ name: '기타 작업' }), { cls: 'outdoor', guessed: true });
  // 실공정표(MS Project 영문) 작업명
  assert.equal(c({ name: 'Excavate SOB for Foundations - Section A' }).cls, 'earth');
  assert.equal(c({ name: 'Brick and Arriscraft Veneer - Section C' }).cls, 'outdoor');
  assert.equal(c({ name: 'Rock/Tape/Finish Walls - Crescent' }).cls, 'none');
  assert.equal(c({ name: 'Place Concrete 2nd Floor Slab - Section C' }).cls, 'outdoor');
  assert.equal(c({ name: 'RI HVAC in Ceilings - Section A' }).cls, 'none');
});
test('과거 일자료 → 월별 비작업 확률: 토공은 강우 5mm, 구조물은 10mm, 기온·풍속·적설은 공통, 결측은 작업 가능', () => {
  const daily = { time: ['2024-01-01', '2024-01-02', '2024-01-03', '2024-01-04', '2024-07-01', '2024-07-02'],
    precipitation_sum: [0, 7, 12, 0, 0, null], temperature_2m_max: [-1, 5, 5, 5, 34, 30], wind_gusts_10m_max: [3, 3, 3, 16, 3, 3], snowfall_sum: [0, 0, 0, 0, 0, 0] };
  const r = J(P.climate(daily));
  assert.equal(r.earth[0], 1);        // 1/1 한파, 1/2 7mm(토공만), 1/3 12mm, 1/4 돌풍 → 4/4
  assert.equal(r.outdoor[0], 0.75);   // 1/2 7mm는 구조물 기준(10mm) 미만
  assert.equal(r.outdoor[6], 0.5);    // 7/1 폭염 34℃, 7/2 결측 강우 → 작업 가능
  assert.equal(r.outdoor[2], null);   // 자료 없는 달
  assert.deepEqual(r.years, ['2024', '2024']);
});
test('기간 배율: 상세 = 1/(1−p̄), 기상 무관은 1, 가동률은 공종 무관 100/가동률', () => {
  assert.equal(P.factor('outdoor', 'detail', 76, 0.5), 2);
  assert.equal(P.factor('none', 'detail', 76, 0.5), 1);
  assert.equal(P.factor('outdoor', 'off', 76, 0.5), 1);
  assert.equal(P.factor('none', 'rate', 76, 0), 100 / 76);
  assert.ok(Math.abs(P.factor('outdoor', 'detail', 0, 0.99) - 10) < 1e-9);           // p̄ 상한 0.9
  assert.ok(Number.isNaN(P.meanP([0.1, null], [0, 1])));                // 확률 빈 달 → 계산 거부
  assert.equal(P.meanP([0.1, 0.3], [0, 1, 1, 1]), 0.25);               // 작업일 가중 평균
});
test('사진 공정표 산식 재현: 2차 굴착 39,075㎥ ÷ 600㎥/일 ÷ 가동률 76% = 86일', () => {
  assert.equal(Math.ceil(39075 / 600 * P.factor('earth', 'rate', 76, 0)), 86);
});
