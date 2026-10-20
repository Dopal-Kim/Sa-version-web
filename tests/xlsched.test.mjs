// 엑셀 공정표 해석(SA_XLSCHED) — 목록형·간트형 판독, 그룹 행 → 공종, 선행 입력/날짜 추정, CSV 변환
import { test } from 'node:test'; import assert from 'node:assert/strict';
import fs from 'node:fs'; import vm from 'node:vm';
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const ctx = vm.createContext({}); ctx.globalThis = ctx; vm.runInContext(html.match(/<script id="sa-xlsched">([\s\S]*?)<\/script>/)[1], ctx);
const X = ctx.SA_XLSCHED, D = (y, m, d) => new Date(y, m - 1, d), J = x => JSON.parse(JSON.stringify(x));   // vm 결과를 이 realm 객체로
test('목록형: 제목 행 건너뛰기 · 그룹 행 → 공종 · 선행 입력/추정', () => {
  const rows = [['○○ 신축공사 공정표'], [], ['No', '공종', '구역', '작업명', '시작일', '종료일', '기간(일)', '선행작업'],
    [null, '가설공사'], [1, null, '전체', '울타리', D(2026, 10, 5), D(2026, 10, 7), 3, null], [2, null, '전체', '사무소', D(2026, 10, 8), D(2026, 10, 10), 3, '1'],
    [null, '토공사'], [3, null, 'B1', '터파기', D(2026, 10, 11), null, 10, null], [4, null, 'B1', '버림', '2026.10.21', '2026-10-23(금)', null, '3SS+2']];
  const r = J(X.interpret({ rows }));
  assert.equal(r.type, '목록형'); assert.equal(r.headerRow, 2); assert.equal(r.stat.tasks, 4);
  assert.deepEqual(r.tasks.map(t => [t.id, t.trade, t.start, t.end]), [['T1', '가설공사', '2026-10-05', '2026-10-07'], ['T2', '가설공사', '2026-10-08', '2026-10-10'], ['T3', '토공사', '2026-10-11', '2026-10-20'], ['T4', '토공사', '2026-10-21', '2026-10-23']]);
  assert.deepEqual(r.tasks[1].links.map(l => [l.id, l.how]), [['T1', '입력']]);
  assert.deepEqual(r.tasks[2].links.map(l => [l.id, l.how]), [['T2', '추정']]);            // 선행 비어 있음 → 직전 종료 작업
  assert.deepEqual(r.tasks[3].links.map(l => [l.id, l.type, l.lag]), [['T3', 'SS', 2]]);
  const csv = X.toCsv(r).replace(/^﻿/, '').split('\r\n');
  assert.equal(csv[0], 'task_id,task_name,predecessor_ids,duration_value,duration_unit,start_date,end_date,zone_ref,resource,delay_category,dur_min,dur_max,work_type');
  assert.equal(csv[4], 'T4,버림,T3SS+2d,3,day,2026-10-21,2026-10-23,B1,,,,,토공사');
  r.tasks[2].links[0].approved = false; assert.equal(X.toCsv(r).split('\r\n')[3].split(',')[2], '');   // 추정 해제 → 확정에서 빠짐
  assert.equal(X.workDays(r.tasks[2], true), 7);                                                            // 10/11(일)~10/20(화) 중 평일 7일
});
test('간트 막대형: 색칠 칸의 처음·끝 날짜', () => {
  const days = Array.from({ length: 10 }, (_, i) => D(2026, 10, 5 + i)), rows = [['공종', '작업명', ...days], ['토공', '터파기'], ['골조', '기초', null]], fills = [[], [], []];
  for (const c of [2, 3, 4]) fills[1][c] = 'rgb:FF4472C4'; rows[2][6] = '■'; rows[2][7] = '■';
  const r = J(X.interpret({ rows, fills }));
  assert.equal(r.type, '간트 막대형'); assert.deepEqual(r.tasks.map(t => [t.name, t.trade, t.start, t.end]), [['터파기', '토공', '2026-10-05', '2026-10-07'], ['기초', '골조', '2026-10-09', '2026-10-10']]);
  assert.equal(r.tasks[1].links[0].id, r.tasks[0].id);
});
test('머리글 없는 시트 → 이유 있는 오류', () => { assert.throws(() => X.interpret({ rows: [['a', 'b'], [1, 2]] }), /머리글 행을 찾지 못했습니다/); });
test('MS Project 출력: 날짜 있는 요약 행 → 묶음, 요약 행 선행 → 마지막·첫 작업, 0일 → 마일스톤', () => {
  const D2 = (m, d) => new Date(2026, m - 1, d);
  const rows = [['ID', 'Task Name', 'Duration', 'Start', 'Finish', 'Predecessors'],
    [1, 'Sitework', '10 days', D2(1, 5), D2(1, 16), null],
    [2, 'Excavate A', '5 days', D2(1, 5), D2(1, 9), null],
    [3, 'Excavate B', '5 days', D2(1, 12), D2(1, 16), '2'],
    [4, 'Structure', '10 days', D2(1, 19), D2(1, 30), '1'],          // 요약 행이 요약 행을 선행으로 가짐
    [5, 'Place Concrete A', '5 days', D2(1, 19), D2(1, 23), null],
    [6, 'Place Concrete B', '5 days', D2(1, 26), D2(1, 30), '5'],
    [7, 'Topping Out', '0 days', D2(1, 30), D2(1, 30), '6']];
  const r = J(X.interpret({ rows }));
  assert.equal(r.stat.summaries, 2); assert.equal(r.stat.milestones, 1);
  assert.deepEqual(r.tasks.map(t => [t.id, t.trade]), [['T2', 'Sitework'], ['T3', 'Sitework'], ['T5', 'Structure'], ['T6', 'Structure'], ['T7', 'Structure']]);
  assert.deepEqual(r.tasks.find(t => t.id === 'T5').links.map(l => l.id), ['T3']);      // Structure의 선행 Sitework → 첫 작업 T5 ← Sitework 마지막 작업 T3
  const csv = X.toCsv(r).replace(/^﻿/, '').split('\r\n'); assert.match(csv.find(l => l.startsWith('T7,')), /^T7,Topping Out,T6,0,day/);
});
