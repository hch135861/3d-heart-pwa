import test from 'node:test';
import assert from 'node:assert/strict';
import { parseArrival, normalizeRow, buildView, buildCommutePlan } from '../bus/domain.v2.1.mjs';

const now = Date.UTC(2026, 8, 8, 0, 30, 0);
test('1970 dates are rejected', () => {
  assert.equal(parseArrival('1970-01-01 07:59', now).kind, 'invalid');
  assert.equal(parseArrival(0, now).kind, 'invalid');
});
test('23 stops plus zero minutes cannot become eligible', () => {
  const row = normalizeRow({line:'111路',destination:'公交民辉站',remaining_stations:'23站',estimated_time:'0分钟',expected_arrival:'1970-01-01 07:59'}, {
    now, side:'B', sourceKey:'台州-群辉', stationVerified:true
  });
  assert.equal(row.seconds, null);
  assert.match(row.issues.join('|'), /到站日期无效|零分钟/);
});
function row(seconds, line='111路', stops=3) {
  return {
    line, destination:'公交民辉站', stops, seconds, eta:`约${Math.ceil(seconds/60)}分钟`, toMinhui:true,
    issues:[], quality:{label:'高',score:5,note:'ok'}, timeSource:'等待时长+到站时刻', vehicleId:line,
    arrivalMs:null, side:'B', sourceKey:'台州-群辉', receivedAt:now, stationVerified:true, key:line
  };
}
function view(rows) {
  return buildView([
    {side:'A',status:'ok',rows:[],receivedAt:now},
    {side:'B',status:'ok',rows,receivedAt:now}
  ], {now, onlyMinhui:true, online:true});
}
test('commute plan says go when ETA roughly equals walking plus buffer', () => {
  const plan = buildCommutePlan(view([row(360)]), 4, 1);
  assert.equal(plan.kind, 'go');
  assert.equal(plan.target.line, '111路');
});
test('commute plan recommends next bus when first is not catchable', () => {
  const plan = buildCommutePlan(view([row(120,'111路',1), row(600,'971路',6)]), 4, 1);
  assert.equal(plan.kind, 'next');
  assert.equal(plan.target.line, '971路');
});
test('commute plan can tell user to wait', () => {
  const plan = buildCommutePlan(view([row(900)]), 4, 1);
  assert.equal(plan.kind, 'wait');
  assert.ok(plan.waitMinutes >= 1);
});
test('stale rows never drive commute advice', () => {
  const v = buildView([
    {side:'A',status:'ok',rows:[],receivedAt:now},
    {side:'B',status:'error',rows:[row(300)],receivedAt:now,error:'x'}
  ], {now, onlyMinhui:true, online:true});
  assert.equal(buildCommutePlan(v,4,1).kind,'unknown');
});
