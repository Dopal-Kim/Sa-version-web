// 강도 기반 양생·동바리(SA_STRENGTH_CORE) — KCS 14 20 12 표 6조합, 표 범위 밖, 설계강도 도달 일수, IFC 재료명 우선
import { test } from 'node:test'; import assert from 'node:assert/strict';
import fs from 'node:fs'; import vm from 'node:vm';
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const ctx = vm.createContext({}); ctx.window = ctx; vm.runInContext(html.match(/<script id="sa-strength-core">([\s\S]*?)<\/script>/)[1], ctx);
const S = ctx.SA_STRENGTH_CORE, J = x => JSON.parse(JSON.stringify(x));
test('측면 거푸집 존치: 시멘트 3종 × 기온 2구간 = KCS 14 20 12 표', () => {
  const want = { 조강: [2, 3], 보통: [4, 6], 슬래그: [5, 8] };
  for (const [c, [hi, mid]] of Object.entries(want)) {
    assert.equal(S.sideDays(c, 25).days, hi); assert.equal(S.sideDays(c, 20).days, hi);    // 20℃ 이상
    assert.equal(S.sideDays(c, 15).days, mid); assert.equal(S.sideDays(c, 10).days, mid);  // 10℃ 이상 20℃ 미만
  }
});
test('10℃ 미만은 표 범위 밖 — 등가재령으로 늘리고 표시, 기온 미입력은 10~20℃ 가정', () => {
  const r = J(S.sideDays('보통', 7)); assert.equal(r.flag, '표 범위 밖'); assert.equal(r.days, 8.9);   // 6일 × (15+10)/(7+10)
  assert.match(r.basis, /5MPa 확인/);
  const c = J(S.sideDays('보통', -2)); assert.equal(c.days, 10); assert.match(c.basis, /보온양생으로 5℃ 유지 가정/);   // 한중: 양생온도 max(−2, 5) = 5℃ → 6 × 25/15
  assert.equal(S.sideDays('보통', null).days, 6); assert.equal(S.sideDays('보통', null).flag, '기온 미입력');
});
test('동바리: 다층은 설계강도, 단층은 max(2/3 fck, 14MPa) · 추울수록 늦어짐 · 조강이 빠름', () => {
  assert.equal(S.shoreDays('보통', 24, 20, true).days, 26.7);           // ACI 209: 4/(1−0.85) = 26.7일(20℃)
  assert.equal(S.shoreDays('보통', 24, 20, false).days, 6.2);           // 2/3 fck = 16MPa ≥ 14MPa
  assert.equal(S.shoreDays('보통', 18, 20, false).ratio, 14 / 18);       // 14MPa가 2/3 fck보다 큼
  const jan = S.shoreDays('보통', 24, -2, true).days, jul = S.shoreDays('보통', 24, 26, true).days;
  assert.ok(jan > 2 * jul, `1월 ${jan}일 vs 7월 ${jul}일`);
  assert.ok(S.shoreDays('조강', 24, 20, false).days < S.shoreDays('보통', 24, 20, false).days);   // 조강은 초기강도(2/3 fck)가 빠름; fck 자체는 정의상 둘 다 약 28일
});
test('IFC 재료명 → 강도·시멘트 (없으면 빈 값 → 기본값 사용)', () => {
  assert.deepEqual(J(S.fromMaterial('Concrete C30/37')), { fck: 30 });
  assert.deepEqual(J(S.fromMaterial('콘크리트 24MPa 조강')), { fck: 24, cement: '조강' });
  assert.deepEqual(J(S.fromMaterial('RC fck=27 slag')), { fck: 27, cement: '슬래그' });
  assert.deepEqual(J(S.fromMaterial('Concrete')), {});
  assert.equal(S.ruleOf('wall'), 'side'); assert.equal(S.ruleOf('slab'), 'soffit'); assert.equal(S.ruleOf('roof'), null);
});
