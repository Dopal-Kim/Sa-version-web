// 국내 완공 정비사업 역검증: 건물 정보만으로 앱과 같은 방식(민간 모드)으로 예측 → 실제 공기가 분포의 어디에 떨어지나(PIT)
// 입력: research/data/kr_cases.csv (use=validate 행). 실행: node research/scripts/kr_validate.mjs
// [가정] 기사에 없는 입력: 시스템 거푸집, 4.5m 초과 지하 1개층, 주차 150대 이상, 선굴착 파일 25m·2,000본, 콘크리트 경사지붕, 분양
import fs from 'node:fs'; import vm from 'node:vm';
const root = new URL('../../', import.meta.url);
const html = fs.readFileSync(new URL('index.html', root), 'utf8');
const blk = id => html.match(new RegExp('<script id="' + id + '"[^>]*>([\\s\\S]*?)</script>'))[1];
const ctx = vm.createContext({}); ctx.window = ctx;
for (const id of ['sa-lbs-core', 'sa-lh-core', 'sa-response-core']) vm.runInContext(blk(id), ctx);
const R = ctx.SA_RESPONSE_CORE, prior = JSON.parse(blk('sa-duration-prior'));

const SEOUL = ['강동', '서초', '강남', '송파', '성동', '동작', '영등포', '은평', '강서', '구로'];
const parseCsv = t => { const rows = []; let row = [], cur = '', q = false; for (const ch of t.replace(/\r/g, '')) { if (q) { if (ch === '"') q = false; else cur += ch; } else if (ch === '"') q = true; else if (ch === ',') { row.push(cur); cur = ''; } else if (ch === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; } else cur += ch; } if (cur || row.length) { row.push(cur); rows.push(row); } return rows; };
const [head, ...lines] = parseCsv(fs.readFileSync(new URL('research/data/kr_cases.csv', root), 'utf8')).filter(r => r.length > 1);
const cases = lines.map(r => Object.fromEntries(head.map((h, i) => [h, r[i]]))).filter(c => c.use === 'validate');
const M = 30.4;

const out = [];
for (const c of cases) {
  const p = { region: SEOUL.includes(c.region) ? '서울' : c.region, start: c.start, floors: +c.floors, basement: +c.basement, basementTall: 1,
    formwork: 'system', parking: 'ge150', retaining: 'anchor', retainingScale: 'general', pile: { method: 'bored', depth: 25, count: 2000 }, roof: 'concrete', housing: 'sale' };
  const C = Math.round(+c.planned_months * M), A = +c.actual_months * M;
  for (const mode of ['private', 'public']) {
    const ev = R.evaluate(p, { mode, N: 4000, prior, econ: { contractDays: C }, options: [] });
    const b = ev.rows[0], T = b.sorted;
    const pit = T.reduce((n, t) => n + (t <= A ? 1 : 0), 0) / T.length;
    out.push({ name: c.name, mode, lh: b.lhTotal, contract: C, actual: Math.round(A), p50: Math.round(b.p50), p80cal: Math.round(b.p80cal), pit: +pit.toFixed(3), hit80: A <= b.p80cal ? 1 : 0 });
  }
}
const show = m => {
  const r = out.filter(x => x.mode === m);
  console.log(`\n== ${m === 'private' ? '민간 모드(작업 분포만)' : '공공 모드(LH 외부 지연 보정)'}`);
  console.log('사업 | LH 기준 | 계약 | 실제 | P50 | 보정 P80 | PIT | P80 안');
  for (const x of r) console.log([x.name.slice(0, 18), x.lh, x.contract, x.actual, x.p50, x.p80cal, x.pit, x.hit80 ? '○' : '×'].join(' | '));
  const hit = r.reduce((a, x) => a + x.hit80, 0) / r.length, mp = r.reduce((a, x) => a + x.pit, 0) / r.length;
  console.log(`P80 안에 든 비율 ${hit.toFixed(2)} (${r.length}건), 평균 PIT ${mp.toFixed(2)}, 계약 < LH 기준인 사업 ${r.filter(x => x.contract < x.lh).length}건`);
  return { mode: m, n: r.length, p80_hit: hit, mean_pit: mp, rows: r };
};
const res = { cases: cases.length, assumptions: '시스템 거푸집, 4.5m 초과 지하 1개층, 주차 150대+, 어스앵커 흙막이, 선굴착 파일 25m·2,000본, 콘크리트 경사지붕', results: [show('private'), show('public')] };
fs.writeFileSync(new URL('research/results/kr_validation.json', root), JSON.stringify(res, null, 1));
