// 입력 가이드 예제 파일(guide/inputs) — 형식과 항목 이름이 앱과 맞는지, 예제1이 LH 별표8(795일)인지
import { test } from 'node:test'; import assert from 'node:assert/strict';
import fs from 'node:fs'; import vm from 'node:vm';
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const dir = new URL('../guide/inputs/', import.meta.url);
const ids = JSON.parse(html.match(/const INPUT_IDS = (\[[\s\S]*?\]);/)[1].replace(/'/g, '"'));
const files = fs.readdirSync(dir).filter(f => /^ex[1-4]_.*\.json$/.test(f));

test('예제 입력 파일 4개: schema sa-input/1, 모든 항목이 화면 입력칸에 있음', () => {
  assert.equal(files.length, 4);
  for (const f of files) {
    const j = JSON.parse(fs.readFileSync(new URL(f, dir), 'utf8'));
    assert.equal(j.schema, 'sa-input/1', f);
    assert.deepEqual(Object.keys(j.values).sort(), [...ids].sort(), f);
    for (const id of ids) assert.ok(html.includes(`id="${id}"`), id);
  }
});

test('예제1 = LH 지침 별표8 예시 → 795일', () => {
  const ctx = vm.createContext({}); ctx.window = ctx;
  vm.runInContext(html.match(/<script id="sa-lh-core">([\s\S]*?)<\/script>/)[1], ctx);
  const v = JSON.parse(fs.readFileSync(new URL(files.find(f => f.startsWith('ex1_')), dir), 'utf8')).values;
  const s = ctx.SA_LH_CORE.schedule({ region: v.p6Region, start: v.p6Start, basement: +v.p6Base, basementTall: +v.p6BaseTall, parking: v.p6Park, floors: +v.p6Floors,
    formwork: v.p6Form, retaining: v.p6Ret, retainingScale: v.p6RetScale, pile: { method: v.p6Pile, depth: +v.p6PileDepth, count: +v.p6PileCount }, roof: v.p6Roof, housing: v.p6Housing });
  assert.equal(s.total, 795); assert.equal(s.end, '2018-11-17');
});
