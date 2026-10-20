// 공정 골격 템플릿(SA_TEMPLATE_CORE) — 층 번호 판독, 용도별 공종, 층 면적 비례 기간, 엑셀 누락·동바리 전 마감 검사
import { test } from 'node:test'; import assert from 'node:assert/strict';
import fs from 'node:fs'; import vm from 'node:vm';
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const ctx = vm.createContext({}); ctx.window = ctx; vm.runInContext(html.match(/<script id="sa-template-core">([\s\S]*?)<\/script>/)[1], ctx);
const T = ctx.SA_TEMPLATE_CORE, J = x => JSON.parse(JSON.stringify(x));
test('층 번호: 국문·영문·지하·지붕', () => {
  assert.deepEqual(J(['3층 조적', '지하2층 방수', 'B1 기초', 'Level 4 slab', 'Section C - Floor 2', 'Place Concrete 2nd Floor Slab', '5F 도장', 'Install Roof - Section A', '외부 마감'].map(T.floorOf)), [3, -2, -1, 4, 2, 2, 5, 999, null]);
});
test('용도별 공종 · 마감 8종 순서 · 층 면적 비례 기간', () => {
  assert.equal(T.groups('lowrise').some(g => /타워크레인/.test(g.label)), false);
  assert.equal(T.groups('highrise').filter(g => /타워크레인/.test(g.label)).length, 2);
  assert.deepEqual(J(T.FINISH), ['masonry', 'plaster', 'water', 'floorFin', 'window', 'mep', 'interior', 'paint']);
  const m = T.G.find(g => g.id === 'masonry');
  assert.equal(T.daysOf(m, 'lowrise', 500), 3); assert.equal(T.daysOf(m, 'lowrise', 1000), 6); assert.equal(T.daysOf(m, 'lowrise', 50), 1);   // 최소 0.3배 → 0.9 → 1
  assert.equal(T.pickUse(5), 'lowrise'); assert.equal(T.pickUse(15), 'highrise');
});
test('엑셀 검사: 누락 공종 · 마감이 동바리 해체 예상일보다 빠르면 작업당 1건 · 구역이 다르면 비교 안 함', () => {
  const d = s => Math.round(Date.UTC(2026, +s.slice(5, 7) - 1, +s.slice(8, 10)) / 864e5), t = (name, s, e) => ({ name, zone: '', trade: '', start: s, s0: d(s), e0: d(e || s) });
  const tasks = [t('3층 슬래브 콘크리트 타설', '2026-05-04'), t('4층 슬래브 콘크리트 타설', '2026-05-12'), t('3층 조적', '2026-05-15', '2026-05-22'), t('2층 도장', '2026-08-01'),
    t('Place Concrete 7th Floor Slab - Section C', '2026-05-04'), t('Finish Painting - Section A Floor 7', '2026-05-06')];
  const r = T.check(tasks, 'lowrise', () => 26.7);
  assert.equal(r.violations.length, 1); assert.equal(r.violations[0].task.name, '3층 조적'); assert.equal(r.violations[0].slabFloor, 4);   // 위층(천장) 슬래브가 더 늦음
  assert.ok(J(r.missing).some(g => g.id === 'prep')); assert.ok(r.found.paint >= 1);
});
