// Synthetic regression fixtures, not live vehicle data. Run: node --test tests/bus-domain.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDuration, parseArrival, parseStops, normalizeRow, decodeResponse, buildView, chinaTime, FRESH_MS } from '../bus/domain.v2.mjs';
const NOW = Date.parse('2026-09-08T08:08:27+08:00');
const q = { city: '台州', site: '群辉' };
const fixture = (extra = {}) => ({ line: '111路🚌', destination: '公交民辉站', estimated_time: '5分⏱', remaining_stations: '2站', expected_arrival: '2026-09-08 08:13:27', ...extra });
const row = (extra = {}) => normalizeRow(fixture(extra), { now: NOW, side: 'B', sourceKey: '台州-群辉', stationVerified: true });
const side = (rows = [], status = 'ok', receivedAt = NOW) => ({ side: 'B', rows, status, receivedAt });
const snapshot = (r, options = {}) => buildView([side([r]), { ...side(), side: 'A' }], { now: NOW, ...options });

test('screenshot regression: epoch date plus 23 stops and zero minutes is never a winner', () => {
  const r = row({ expected_arrival: '1970-01-01 07:59', estimated_time: '0分⏱', remaining_stations: '23站' });
  assert.equal(r.seconds, null); assert.equal(r.eta, '时间待确认'); assert.equal(r.arrivalMs, null);
  assert.equal(r.stops, 23); assert.equal(snapshot(r).best, null);
});
test('positive duration with an invalid source date is also quarantined', () => {
  const r = row({ expected_arrival: '1970-01-01 07:59', estimated_time: '13分' });
  assert.equal(r.seconds, null); assert.equal(snapshot(r).best, null);
});
test('null, empty, zero, malformed and old absolute dates do not become Unix epoch', () => {
  for (const v of [null, '', undefined, 0, '0', -1, true, false, {}, [], '1970-01-01 07:59', '2025-09-08 08:13', '08:13', '2026-02-30 08:13', '2026-13-01 08:13', '2026-09-08 25:13', '2026-09-08 08:13+99:00']) {
    assert.equal(parseArrival(v, NOW).ms, null, String(v));
  }
});
test('second and millisecond Unix timestamps represent the same near-future instant', () => {
  const ms = NOW + 300000;
  for (const v of [ms, String(ms), ms / 1000, String(ms / 1000)]) assert.equal(parseArrival(v, NOW).ms, ms);
});
test('timezone-free provider dates use China time regardless of device timezone', () => {
  for (const s of ['2026-09-08 08:13:27', '2026/09/08 08:13:27', '2026-09-08T08:13:27+08:00', '2026-09-08T00:13:27Z']) {
    assert.equal(parseArrival(s, NOW).ms, NOW + 300000);
  }
  assert.equal(chinaTime(NOW), '08:08:27');
});
test('far-past and far-future timestamps are not clamped into arriving-now', () => {
  for (const delta of [-3600000, 86400000]) assert.equal(parseArrival(NOW + delta, NOW).kind, 'invalid');
});
test('durations have strict units, ranges and combined hours/minutes/seconds', () => {
  for (const [value, seconds] of [['41分⏱',2460], ['约 1.5分钟',90], ['30秒',30], ['1小时20分钟',4800], ['2–4分',240], ['1分30秒',90], ['0分 ⏱',0], ['即将到站',0]]) {
    assert.equal(parseDuration(value).seconds, seconds, value);
  }
});
test('numeric strings, dates and statuses are not parsed as random minute digits', () => {
  for (const v of [0, 5, '5', '1970-01-01 07:59', '08:12', '未发车', '-5分', '4-2分', '999小时', false, {}, '线路111', '1公里']) assert.equal(parseDuration(v).seconds, null, String(v));
});
test('remaining stops are not coerced from arbitrary text or negative values', () => {
  assert.equal(parseStops('23站'), 23); assert.equal(parseStops(0), 0);
  for (const v of ['23站后发车8分钟', '-2站', '3分钟', '', '500站']) assert.equal(parseStops(v), null);
});
test('zero minutes only qualifies with a near-stop signal', () => {
  for (const stops of ['23站', '14站', '2站', '未知']) assert.equal(row({ estimated_time:'0分', expected_arrival:null, remaining_stations:stops }).seconds, null);
  assert.equal(row({ estimated_time:'0分', expected_arrival:null, remaining_stations:'1站' }).eta, '不足1分钟');
});
test('contradictory future clock and duration invalidates the whole time estimate', () => {
  assert.equal(row({ estimated_time:'1分', expected_arrival:'2026-09-08 08:50' }).seconds, null);
});
test('a documented duration without an absolute date remains an estimate', () => {
  const r = row({ expected_arrival:null }); assert.equal(r.seconds,300); assert.equal(r.arrivalMs,null); assert.ok(snapshot(r).best);
});
test('an absolute date can supply an estimate only if duration is absent, not malformed', () => {
  assert.equal(row({ estimated_time:null }).seconds, 300);
  assert.equal(row({ estimated_time:'数字坏了8' }).seconds, null);
});
test('terminal filter is exact, not a search across route start/direction fields', () => {
  assert.equal(row().toMinhui, true);
  for (const dest of ['民辉出发到葭沚', '不是民辉站', '民辉东', '另一终点']) assert.equal(row({ destination:dest, direction:'民辉' }).toMinhui, false);
});
test('responses must match the requested station exactly', () => {
  const res = decodeResponse({ code:200, data:{ '台州-群辉':[fixture()], '台州-群辉东':[fixture()], '温州-群辉':[fixture()] } }, q, 'B', NOW);
  assert.equal(res.rows.filter(r=>r.seconds !== null).length,1);
});
test('string success code accepted; malformed codes and structures rejected', () => {
  assert.equal(decodeResponse({ code:'200',data:{'台州-群辉':[fixture()]} },q,'A',NOW).rows.length,1);
  assert.throws(()=>decodeResponse({ code:500,msg:'上游错误'},q,'A',NOW));
  assert.throws(()=>decodeResponse({ code:200,data:null},q,'A',NOW));
});
test('text no-data response is an empty success rather than a retry of phantom rows', () => {
  const res = decodeResponse({ code:200,data:'暂无车辆定位' },q,'A',NOW);
  assert.deepEqual(res.rows,[]); assert.equal(res.notices[0],'暂无车辆定位');
});
test('unlabelled array records cannot prove the correct boarding station', () => {
  const r = decodeResponse({code:200,data:[fixture()]},q,'A',NOW).rows[0];
  assert.equal(r.stationVerified,false); assert.equal(snapshot(r).best,null);
});
test('exact duplicates are removed without merging different buses', () => {
  const a = fixture({licence_plate:'TEST-A'}), b = fixture({licence_plate:'TEST-B'});
  assert.equal(decodeResponse({code:200,data:{'台州-群辉':[a,a,b]}},q,'A',NOW).rows.length,2);
});
test('only fresh valid records participate in winner selection', () => {
  const valid = row(), invalid = row({estimated_time:'0分',remaining_stations:'23站'});
  const v = buildView([side([invalid,valid]),{...side(),side:'A'}],{now:NOW});
  assert.equal(v.best, v.shown[0]); assert.equal(v.best.seconds,300); assert.equal(v.uncertain,1);
});
test('failed direction retains records but cannot win even during filter changes', () => {
  for (const onlyMinhui of [false,true,false]) {
    const v = buildView([side([row()],'error')],{now:NOW,onlyMinhui});
    assert.equal(v.best,null); assert.equal(v.shown.length,1); assert.equal(v.complete,false);
  }
});
test('successful empty side does not preserve previous rows', () => {
  assert.equal(buildView([side([])],{now:NOW}).total,0);
});
test('age expiry occurs without another network request', () => {
  assert.equal(snapshot(row(),{now:NOW+FRESH_MS}).best,null);
  assert.ok(snapshot(row(),{now:NOW+FRESH_MS-1}).best);
});
test('offline immediately removes recommendations and marks records old', () => {
  const v = snapshot(row(),{online:false}); assert.equal(v.best,null); assert.equal(v.shown[0].stale,true);
});
test('partial failure is not presented as a complete two-direction comparison', () => {
  const v = buildView([side([row()]), {...side([],'error'),side:'A'}],{now:NOW});
  assert.ok(v.best); assert.equal(v.complete,false);
});
test('all-direction mode does not quietly keep recommending only Minhui', () => {
  const other = row({destination:'其他终点',estimated_time:'1分',expected_arrival:null,remaining_stations:'1站'});
  const sides=[side([row(),other])];
  assert.equal(buildView(sides,{now:NOW,onlyMinhui:true}).best.destination,'公交民辉站');
  assert.equal(buildView(sides,{now:NOW,onlyMinhui:false}).best.destination,'其他终点');
});
test('new query cannot authorize a response containing only the old station', () => {
  const res=decodeResponse({code:200,data:{'台州-群辉':[fixture()]}},{city:'台州',site:'民辉'},'A',NOW);
  assert.equal(snapshot(res.rows[0]).best,null);
});
test('large bare epoch numbers in duration fields cannot become billion-minute ETAs', () => {
  assert.equal(row({estimated_time:String(NOW),expected_arrival:null}).seconds,null);
});
