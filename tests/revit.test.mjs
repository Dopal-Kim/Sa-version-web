// Revit 교환(SA_REVIT_CORE) — sa-revit/1 읽기(층·지하 4.5m·파일·면적), 요소 → 활동 연결, 결과 JSON, TimeLiner CSV
import { test } from 'node:test'; import assert from 'node:assert/strict';
import fs from 'node:fs'; import vm from 'node:vm';
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const blk = id => html.match(new RegExp('<script id="' + id + '"[^>]*>([\\s\\S]*?)</script>'))[1];
const ctx = vm.createContext({}); ctx.window = ctx;
for (const id of ['sa-lbs-core', 'sa-lh-core', 'sa-response-core', 'sa-revit-core']) vm.runInContext(blk(id), ctx);
const X = ctx.SA_REVIT_CORE, R = ctx.SA_RESPONSE_CORE, prior = JSON.parse(blk('sa-duration-prior')), J = x => JSON.parse(JSON.stringify(x));
const sample = JSON.parse(fs.readFileSync(new URL('./fixtures/revit_export_sample.json', import.meta.url), 'utf8'));
const BASE = { region: '서울', start: '2026-03-02', parking: 'lt150', formwork: 'euro', retaining: 'self', retainingScale: 'general', roof: 'concrete', housing: 'sale' };

test('내보내기 읽기: 지상 15층(지붕 레벨 제외), 지하 1층·4.5m 초과 1개, 파일 420본, 연면적·거푸집 합계', () => {
  const x = X.parseExport(sample);
  assert.deepEqual(J(x.params), { floors: 15, basement: 1, basementTall: 1, pile: { method: 'bored', depth: 22, count: 420 } });
  assert.equal(x.floorArea, 12400); assert.equal(x.formworkArea, 10400);
  assert.equal(x.levelLoc['1F'], 'F1'); assert.equal(x.levelLoc['15F'], 'F15'); assert.equal(x.levelLoc.B1, 'site'); assert.equal(x.levelLoc.ROOF, undefined);
  assert.throws(() => X.parseExport({ schema: 'other' }), /sa-revit\/1/);
  assert.throws(() => X.parseExport({ schema: 'sa-revit/1', levels: [] }), /Building Story/);
});

test('요소 → 활동: 기초=기초공사, 지하 벽=지하골조, 지상 구조=그 층 골조, 문=마감, 지붕 레벨 요소는 연결 안 됨', () => {
  const x = X.parseExport(sample), p = { ...BASE, ...x.params };
  const ev = R.evaluate(p, { mode: 'public', N: 300, prior, options: ['finishFlow'] });
  const res = X.results(x, ev.rows[0], { N: 300, prior, riskDrivers: ev.rows[0].drivers });
  const by = Object.fromEntries(res.elements.map(e => [e.uid, e.activity]));
  assert.equal(by['e-found-1'], 'found@site'); assert.equal(by['e-b1-wall'], 'subFrame@site');
  assert.equal(by['e-1f-slab'], 'superFrame@F1'); assert.equal(by['e-8f-col'], 'superFrame@F8'); assert.equal(by['e-15f-wall'], 'superFrame@F15');
  assert.equal(by['e-5f-door'], 'wet@site');                   // 대응 없음(LH): 마감은 층 구분 없는 일괄
  assert.equal(res.unmapped, 1);
  const flow = X.results(x, ev.rows.find(r => r.id === 'finishFlow'), { N: 300, prior, riskDrivers: ev.rows[0].drivers });
  assert.equal(flow.elements.find(e => e.uid === 'e-5f-door').activity, 'wet@F5');   // 층별 선행 착수면 그 층 마감
  for (const a of res.activities) { assert.ok(a.p80Finish >= a.p50Finish); assert.ok(['High', 'Mid', 'Low'].includes(a.risk)); }
  const f15 = res.activities.find(a => a.id === 'superFrame@F15'), f1 = res.activities.find(a => a.id === 'superFrame@F1');
  assert.ok(f15.finish > f1.finish);
});

test('TimeLiner CSV: BOM·머리글·활동 수만큼 행, Sync ID = 활동 ID', () => {
  const x = X.parseExport(sample), p = { ...BASE, ...x.params };
  const ev = R.evaluate(p, { mode: 'private', N: 200, prior, options: [] });
  const res = X.results(x, ev.rows[0], { N: 200, prior });
  const csv = X.timelinerCsv(res), lines = csv.trim().split('\r\n');
  assert.ok(csv.startsWith('﻿"Task Name","Synchronization ID","Planned Start","Planned End"'));
  assert.equal(lines.length, res.activities.length + 1);
  assert.ok(lines.some(l => l.includes('"superFrame@F15"')));
});
