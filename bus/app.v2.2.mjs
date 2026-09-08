import { decodeResponse, buildView, buildCommutePlan, chinaTime } from './domain.v2.1.mjs';
const APP_VERSION = '2.2.0';
const API = 'https://api.code410.com/api/traffic/bus';
const PREFS_KEY = 'bus-commute-prefs-v2';
const LEGACY_PREFS_KEY = 'bus-commute-prefs-v1';
const FIRED_KEY = 'bus-appointment-last-fired-v1';
const $ = id => document.getElementById(id);
const node = (tag, cls, value) => { const n = document.createElement(tag); if (cls) n.className = cls; if (value !== undefined) n.textContent = value; return n; };
const clampInt = (v, lo, hi, fallback) => { const n = Number.parseInt(v, 10); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback; };

function loadPrefs() {
  try {
    const raw = localStorage.getItem(PREFS_KEY) || localStorage.getItem(LEGACY_PREFS_KEY) || '{}';
    const saved = JSON.parse(raw);
    return {
      walkMinutes: clampInt(saved.walkMinutes, 0, 30, 4),
      bufferMinutes: clampInt(saved.bufferMinutes, 0, 10, 1),
      alertMinutes: clampInt(saved.alertMinutes, 1, 30, 6),
      notifyEnabled: Boolean(saved.notifyEnabled),
      appointmentAt: Number.isFinite(Number(saved.appointmentAt)) ? Number(saved.appointmentAt) : null,
      appointmentLead: clampInt(saved.appointmentLead, 0, 60, 5)
    };
  } catch {
    return { walkMinutes: 4, bufferMinutes: 1, alertMinutes: 6, notifyEnabled: false, appointmentAt: null, appointmentLead: 5 };
  }
}
function savePrefs() {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify({
      walkMinutes: state.walkMinutes,
      bufferMinutes: state.bufferMinutes,
      alertMinutes: state.alertMinutes,
      notifyEnabled: state.notifyEnabled,
      appointmentAt: state.appointmentAt,
      appointmentLead: state.appointmentLead
    }));
  } catch {}
}
function readLastFired() {
  try { return Number(localStorage.getItem(FIRED_KEY) || 0); } catch { return 0; }
}
function markFired(value) {
  try { localStorage.setItem(FIRED_KEY, String(value || 0)); } catch {}
}

const prefs = loadPrefs();
const state = {
  query: { city: '台州', site: '群辉' }, sides: [], busy: false, paused: false, onlyMinhui: true,
  online: navigator.onLine, generation: 0, controllers: [], timer: null, nextAt: 0,
  walkMinutes: prefs.walkMinutes, bufferMinutes: prefs.bufferMinutes, alertMinutes: prefs.alertMinutes,
  notifyEnabled: prefs.notifyEnabled, notified: new Set(), previousVehicles: new Map(), trends: new Map(),
  appointmentAt: prefs.appointmentAt, appointmentLead: prefs.appointmentLead, appointmentFiredAt: readLastFired(),
  soundArmed: false, alarmActive: false, alarmInterval: null, alarmStopTimer: null,
  appointmentCalendarExported: false
};
const freshSides = () => ['A', 'B'].map(side => ({ side, status: 'idle', rows: [], notices: [], receivedAt: null, error: '' }));
state.sides = freshSides();

let audioContext = null;
function ageLabel(at) {
  if (!Number.isFinite(at)) return '尚未获取';
  const seconds = Math.max(0, Math.floor((Date.now() - at) / 1000));
  return seconds < 60 ? `${seconds}秒前获取` : `${Math.floor(seconds / 60)}分钟前获取`;
}
function notificationSupport() {
  return 'Notification' in window && 'serviceWorker' in navigator;
}
function notificationStateText() {
  if (!notificationSupport()) return '到站提醒不可用';
  if (Notification.permission === 'denied') return '到站提醒已被关闭';
  return state.notifyEnabled && Notification.permission === 'granted' ? '到站提醒：开' : '开启到站提醒';
}
function formatDateTimeLocal(ms) {
  if (!Number.isFinite(ms)) return '';
  const d = new Date(ms);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function appointmentLabel(ms) {
  if (!Number.isFinite(ms)) return '未预约';
  const d = new Date(ms);
  return new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d);
}
function durationLabel(ms) {
  const sec = Math.max(0, Math.ceil(ms / 1000));
  if (sec < 60) return `${sec}秒`;
  const min = Math.ceil(sec / 60);
  if (min < 60) return `${min}分钟`;
  const h = Math.floor(min / 60), m = min % 60;
  return m ? `${h}小时${m}分钟` : `${h}小时`;
}
function localAppointmentStatus() {
  if (!Number.isFinite(state.appointmentAt)) return { tone: 'normal', text: '还没有预约。' };
  const now = Date.now();
  const due = state.appointmentAt - state.appointmentLead * 60000;
  if (state.appointmentFiredAt === state.appointmentAt) {
    return { tone: 'good', text: `已触发：${appointmentLabel(state.appointmentAt)} 的预约提醒。${state.appointmentCalendarExported ? ' 已导出系统日历。' : ''}` };
  }
  if (now > state.appointmentAt + 120000) {
    return { tone: 'warn', text: `预约 ${appointmentLabel(state.appointmentAt)} 已经过期。页面关闭时本地计时无法保证触发，建议同时加入 iPhone 日历。` };
  }
  if (now >= due) {
    return { tone: 'good', text: `预约提醒已到时间：${appointmentLabel(state.appointmentAt)}。${state.soundArmed ? '铃声已就绪。' : '本次打开尚未启用本地铃声。'}` };
  }
  return { tone: 'normal', text: `已预约 ${appointmentLabel(state.appointmentAt)}，提前 ${state.appointmentLead} 分钟提醒；距离提醒还有 ${durationLabel(due - now)}。${state.soundArmed ? ' 本次打开铃声已启用。' : ' 如需页面内响铃，请点一次“启用铃声并试播”。'}` };
}
function renderAppointment() {
  const status = localAppointmentStatus();
  $('appointment-status').dataset.tone = status.tone;
  $('appointment-status').textContent = status.text;
  $('sound-enable').textContent = state.soundArmed ? '铃声已启用 · 再次试播' : '启用铃声并试播';
  $('calendar-export').disabled = !Number.isFinite(state.appointmentAt);
  $('appointment-clear').disabled = !Number.isFinite(state.appointmentAt);
}

function rowTrend(row) {
  if (!row.vehicleId || row.seconds === null) return '';
  return state.trends.get(row.vehicleId) || '';
}
function snapshotVehicles() {
  const map = new Map();
  for (const side of state.sides) {
    if (side.status !== 'ok') continue;
    for (const row of side.rows || []) if (row.vehicleId && row.seconds !== null) {
      map.set(row.vehicleId, { seconds: row.seconds, receivedAt: row.receivedAt, line: row.line });
    }
  }
  return map;
}
function calculateTrends(previous) {
  const trends = new Map();
  const now = Date.now();
  for (const side of state.sides) {
    if (side.status !== 'ok') continue;
    for (const row of side.rows || []) {
      if (!row.vehicleId || row.seconds === null) continue;
      const old = previous.get(row.vehicleId);
      if (!old || now - old.receivedAt > 120000) continue;
      const diff = row.seconds - old.seconds;
      if (Math.abs(diff) < 45) trends.set(row.vehicleId, '预估基本稳定');
      else if (diff < 0) trends.set(row.vehicleId, `比上次提前约 ${Math.max(1, Math.round(Math.abs(diff) / 60))} 分钟`);
      else trends.set(row.vehicleId, `比上次延后约 ${Math.max(1, Math.round(diff / 60))} 分钟`);
    }
  }
  state.trends = trends;
}
function confidenceText(row) { return `可信度 ${row.quality.label} · ${row.quality.note}`; }
function formatArrival(row) { return row.arrivalMs !== null ? ` · 预计 ${chinaTime(row.arrivalMs).slice(0, 5)}` : ''; }

function renderCommute(targetView) {
  const plan = buildCommutePlan(targetView, state.walkMinutes, state.bufferMinutes);
  const box = $('commute'); box.replaceChildren();
  box.dataset.plan = plan.kind;
  box.append(node('div', 'eyebrow', '通勤建议'), node('h2', '', plan.title), node('p', '', plan.detail));
  if (plan.target) {
    const target = node('div', 'commute-target');
    target.append(node('strong', '', `${plan.target.line} · ${plan.target.eta}`),
      node('span', '', `开往 ${plan.target.destination}${plan.target.stops === null ? '' : ` · 还有 ${plan.target.stops} 站`}`));
    box.append(target);
  }
  const meta = node('div', 'commute-meta');
  meta.append(node('span', '', `步行 ${state.walkMinutes} 分钟`), node('span', '', `余量 ${state.bufferMinutes} 分钟`));
  box.append(meta);
}

function render() {
  const listView = buildView(state.sides, { onlyMinhui: state.onlyMinhui, online: state.online });
  const targetView = buildView(state.sides, { onlyMinhui: true, online: state.online });
  renderCommute(targetView);
  renderAppointment();

  const hero = $('winner'); hero.replaceChildren();
  hero.append(node('div', 'eyebrow', state.onlyMinhui ? '民辉方向 · 到上车站的预估' : '全部方向 · 到上车站的预估'));
  if (listView.best) {
    const best = listView.best; hero.dataset.state = 'valid';
    hero.append(node('h2', 'hero-eta', best.eta), node('div', 'winner-line', best.line),
      node('p', '', `开往 ${best.destination} · ${best.stops === null ? '站数未提供' : `还有 ${best.stops} 站`}`),
      node('p', 'confidence', `${confidenceText(best)}${rowTrend(best) ? ` · ${rowTrend(best)}` : ''}`),
      node('p', '', listView.complete ? '当前有效预估中最早到站；不是到达目的地的用时。' : '仅比较已成功获取的方向，结果可能不完整。'));
  } else {
    const uncertain = listView.shown.length > 0;
    hero.dataset.state = !state.online ? 'offline' : uncertain ? 'uncertain' : state.busy ? 'loading' : 'empty';
    const heading = !state.online ? '网络已断开' : uncertain ? '到站时间待确认' : state.busy ? '正在查询' : '暂无有效到站预估';
    const detail = uncertain ? '记录中的时间异常、缺失或已经过期，暂不推荐最快一班；下方保留站数供核对。'
      : '不代表没有公交，可能尚未发车、站名不匹配或数据源暂未提供。';
    hero.append(node('h2', '', heading), node('p', '', state.busy && !uncertain ? '正在分别获取两个方向。' : detail));
  }

  const failed = state.sides.filter(s => s.status === 'error');
  $('status').dataset.tone = failed.length || listView.uncertain || !state.online ? 'warn' : 'normal';
  $('status').textContent = state.busy ? '正在刷新，旧记录不会被标成刚更新…'
    : !state.online ? '当前离线：预约界面仍可使用，但实时公交已停止推荐。'
    : `${failed.length ? `${failed.length} 个方向请求失败 · ` : ''}共 ${listView.total} 条记录 · 当前显示 ${listView.shown.length} 条${listView.uncertain ? ` · ${listView.uncertain} 条不参与推荐` : ''}。`;
  $('count').textContent = `${listView.candidates.length} 条有效预估`;

  const cards = listView.shown.map(row => {
    const card = node('article', 'bus'); card.dataset.quality = row.eligible ? 'valid' : 'unverified';
    const top = node('div', 'row-head');
    top.append(node('div', 'line-name', row.line), node('div', 'eta', row.eligible ? row.eta : row.stops === null ? '时间未知' : `${row.stops} 站`));
    card.append(top, node('p', 'destination', `开往 ${row.destination} · 接口方向 ${row.side}`));
    if (row.eligible) {
      card.append(node('p', 'quality', `${row.stops === null ? '未提供剩余站数' : `还有 ${row.stops} 站`}${formatArrival(row)}`));
      card.append(node('p', 'confidence', `${confidenceText(row)}${rowTrend(row) ? ` · ${rowTrend(row)}` : ''}`));
    } else card.append(node('p', 'quality', row.stale ? '旧记录 · 已停止推荐，请等待重新获取' : `时间待确认 · ${row.issues[0] || '无有效预估'}`));
    card.append(node('div', 'source', `${ageLabel(row.receivedAt)} · ${row.stationVerified ? '上车站已匹配' : '上车站未确认'} · ${row.timeSource}`));
    return card;
  });
  $('list').replaceChildren(...(cards.length ? cards : [node('div', 'empty', state.busy ? '等待数据源返回…' : '暂无匹配的车辆记录。可切换全部方向核对。')]));

  const diag = state.sides.map(s => node('p', '', `方向 ${s.side}：${s.status === 'ok' ? `${s.rows.length} 条记录` : s.status === 'error' ? `失败：${s.error}` : '尚未获取'}${s.receivedAt !== null ? `；上次成功获取 ${chinaTime(s.receivedAt)}` : ''}${s.notices.length ? `；${s.notices.join('；')}` : ''}`));
  $('diagnostics').replaceChildren(...diag);
  $('minhui').setAttribute('aria-pressed', String(state.onlyMinhui));
  $('all').setAttribute('aria-pressed', String(!state.onlyMinhui));
  $('refresh').disabled = state.busy; $('refresh').textContent = state.busy ? '查询中…' : '立即刷新';
  $('pause').textContent = state.paused ? '恢复' : '暂停'; $('pause').setAttribute('aria-pressed', String(state.paused));
  $('notify').textContent = notificationStateText();
  $('notify').disabled = !notificationSupport() || Notification.permission === 'denied';
  $('walk').value = String(state.walkMinutes); $('buffer').value = String(state.bufferMinutes); $('alert').value = String(state.alertMinutes);

  const times = state.sides.map(s => s.receivedAt).filter(Number.isFinite);
  $('age').textContent = times.length ? ageLabel(Math.min(...times)) : '尚未获取数据';
  $('next').textContent = !state.online ? '离线 · 预约仍可用' : state.paused ? '自动刷新已暂停' : state.busy ? '分别查询两个方向' : state.nextAt ? `${Math.max(0, Math.ceil((state.nextAt - Date.now()) / 1000))}秒后刷新` : '自动刷新已开启';
  document.body.dataset.version = APP_VERSION;
  document.body.dataset.state = state.busy ? 'loading' : 'ready';
}

function cancel() {
  state.generation++; state.controllers.forEach(c => c.abort()); state.controllers = [];
  clearTimeout(state.timer); state.timer = null; state.nextAt = 0; state.busy = false;
}
function schedule() {
  clearTimeout(state.timer); state.nextAt = 0;
  if (state.paused || document.hidden || !state.online) return;
  const failures = state.sides.filter(s => s.status === 'error').length;
  const delay = failures === 2 ? 40000 : 20000;
  state.nextAt = Date.now() + delay;
  state.timer = setTimeout(refresh, delay);
}
async function fetchSide(query, side, controller) {
  const url = new URL(API); url.searchParams.set('city', query.city); url.searchParams.set('site', query.site);
  if (side === 'B') url.searchParams.set('backward', '1');
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(url, { signal: controller.signal, cache: 'no-store', credentials: 'omit' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const json = await response.json();
    const receivedAt = Date.now();
    return { ...decodeResponse(json, query, side, receivedAt), receivedAt };
  } finally { clearTimeout(timer); }
}
function errorMessage(error) {
  if (error.name === 'AbortError') return '请求超时，请稍后重试';
  if (error instanceof TypeError) return '网络或接口不可达，也可能被跨域策略阻止';
  if (error instanceof SyntaxError) return '接口未返回可解析的 JSON';
  return String(error.message || '请求失败').slice(0, 120);
}

async function ensureAudioContext() {
  const AudioCtor = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtor) throw new Error('当前浏览器不支持页面提示音');
  if (!audioContext) audioContext = new AudioCtor();
  if (audioContext.state === 'suspended') await audioContext.resume();
  state.soundArmed = audioContext.state === 'running';
  return audioContext;
}
function tone(freq = 880, duration = 0.18, gainValue = 0.13, delay = 0) {
  if (!audioContext || audioContext.state !== 'running') return;
  const start = audioContext.currentTime + delay;
  const osc = audioContext.createOscillator();
  const gain = audioContext.createGain();
  osc.type = 'sine'; osc.frequency.setValueAtTime(freq, start);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(gainValue, start + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  osc.connect(gain); gain.connect(audioContext.destination);
  osc.start(start); osc.stop(start + duration + 0.03);
}
function playChime() {
  tone(784, 0.18, 0.11, 0); tone(988, 0.2, 0.12, 0.24); tone(1175, 0.26, 0.11, 0.5);
  try { navigator.vibrate?.([150, 80, 220]); } catch {}
}
function playAlarmBurst() {
  if (!state.soundArmed) return;
  tone(880, 0.28, 0.16, 0); tone(880, 0.28, 0.16, 0.38); tone(660, 0.42, 0.16, 0.78);
  try { navigator.vibrate?.([300, 150, 300, 150, 500]); } catch {}
}
function stopAlarm() {
  clearInterval(state.alarmInterval); state.alarmInterval = null;
  clearTimeout(state.alarmStopTimer); state.alarmStopTimer = null;
  state.alarmActive = false;
  $('alarm-overlay').hidden = true;
  try { navigator.vibrate?.(0); } catch {}
}
function startAlarm(title, text) {
  stopAlarm();
  state.alarmActive = true;
  $('alarm-title').textContent = title;
  $('alarm-text').textContent = text;
  $('alarm-overlay').hidden = false;
  playAlarmBurst();
  if (state.soundArmed) state.alarmInterval = setInterval(playAlarmBurst, 2300);
  state.alarmStopTimer = setTimeout(stopAlarm, 30000);
}
async function showSystemNotification(title, body, tag = 'bus-reminder') {
  if (!notificationSupport() || Notification.permission !== 'granted') return false;
  try {
    const registration = await navigator.serviceWorker.ready;
    await registration.showNotification(title, {
      body, tag, renotify: true, silent: false,
      icon: './bus-icon-192.png', badge: './bus-icon-192.png',
      data: { url: new URL('./v2.html', location.href).href }
    });
    return true;
  } catch {
    try { new Notification(title, { body, tag, silent: false }); return true; } catch { return false; }
  }
}
async function showArrivalReminder(title, body) {
  if (!state.notifyEnabled) return;
  if (state.soundArmed && !document.hidden) playChime();
  await showSystemNotification(title, body, 'bus-arrival');
}
function maybeNotify() {
  const targetView = buildView(state.sides, { onlyMinhui: true, online: state.online });
  const plan = buildCommutePlan(targetView, state.walkMinutes, state.bufferMinutes);
  const row = plan.target || (plan.kind === 'tight' ? plan.first : null);
  if (!row || row.seconds === null || row.seconds > state.alertMinutes * 60) return;
  const id = row.vehicleId || row.key;
  if (state.notified.has(id)) return;
  state.notified.add(id);
  const body = plan.kind === 'go' ? `${row.line} 约 ${row.eta} 到群辉，按你的步行时间现在出门比较合适。`
    : plan.kind === 'next' ? `首班可能赶不上，建议准备等 ${row.line}，约 ${row.eta} 到群辉。`
    : `${row.line} 约 ${row.eta} 到群辉，请打开页面再确认。`;
  showArrivalReminder('群辉 → 民辉 · 公交提醒', body);
}

function checkAppointment() {
  if (!Number.isFinite(state.appointmentAt)) return;
  const now = Date.now();
  const due = state.appointmentAt - state.appointmentLead * 60000;
  if (state.appointmentFiredAt === state.appointmentAt) return;
  if (now < due) return;
  if (now > state.appointmentAt + 120000) { renderAppointment(); return; }
  state.appointmentFiredAt = state.appointmentAt;
  markFired(state.appointmentAt);
  savePrefs();
  const title = '该准备出发了';
  const text = `${appointmentLabel(state.appointmentAt)} · 群辉 → 民辉`;
  if (!document.hidden) startAlarm(title, text);
  showSystemNotification('群辉 → 民辉 · 预约提醒', `${text}。打开通勤助手再确认实时公交。`, 'bus-appointment');
  renderAppointment();
}
function icsUtc(ms) {
  const d = new Date(ms), pad = n => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}
function escapeIcs(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
}
function makeCalendarFile() {
  if (!Number.isFinite(state.appointmentAt)) return null;
  const end = state.appointmentAt + 15 * 60000;
  const uid = `bus-${state.appointmentAt}@hch135861.github.io`;
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//群辉到民辉通勤助手//CN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'BEGIN:VEVENT', `UID:${uid}`, `DTSTAMP:${icsUtc(Date.now())}`, `DTSTART:${icsUtc(state.appointmentAt)}`, `DTEND:${icsUtc(end)}`,
    `SUMMARY:${escapeIcs('群辉 → 民辉 · 公交出发')}`,
    `DESCRIPTION:${escapeIcs('打开公交通勤助手确认实时到站。网页关闭后请以系统日历提醒为准。')}`,
    'BEGIN:VALARM', 'ACTION:DISPLAY', `TRIGGER:-PT${state.appointmentLead}M`, `DESCRIPTION:${escapeIcs('该准备出发去群辉站了')}`, 'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR'
  ];
  return new File([lines.join('\r\n') + '\r\n'], `群辉到民辉-${formatDateTimeLocal(state.appointmentAt).replace(/[:T]/g, '-')}.ics`, { type: 'text/calendar;charset=utf-8' });
}
async function exportCalendar() {
  const file = makeCalendarFile();
  if (!file) return;
  try {
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: '公交预约', text: '把预约加入 iPhone 日历，锁屏或页面关闭后也能由系统提醒。' });
    } else {
      const url = URL.createObjectURL(file);
      const a = document.createElement('a'); a.href = url; a.download = file.name; document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
    }
    state.appointmentCalendarExported = true;
    renderAppointment();
  } catch (error) {
    if (error?.name !== 'AbortError') {
      $('appointment-status').dataset.tone = 'warn';
      $('appointment-status').textContent = '系统日历文件未能打开，请再试一次。';
    }
  }
}

async function refresh() {
  if (document.hidden || !state.online) { render(); return; }
  const previous = snapshotVehicles();
  cancel(); const generation = state.generation, query = { ...state.query };
  state.busy = true; render();
  await Promise.all(state.sides.map(async (previousSide, index) => {
    const controller = new AbortController(); state.controllers.push(controller);
    try {
      const data = await fetchSide(query, previousSide.side, controller);
      if (generation !== state.generation) return;
      state.sides[index] = { side: previousSide.side, status: 'ok', error: '', ...data };
    } catch (error) {
      if (generation !== state.generation) return;
      state.sides[index] = { ...previousSide, status: 'error', error: errorMessage(error) };
    }
    if (generation === state.generation) render();
  }));
  if (generation !== state.generation) return;
  state.busy = false; state.controllers = [];
  calculateTrends(previous); state.previousVehicles = snapshotVehicles();
  maybeNotify(); checkAppointment(); schedule(); render();
}

$('query-form').addEventListener('submit', event => {
  event.preventDefault();
  const query = { city: $('city').value.trim(), site: $('site').value.trim() };
  if (!query.city || !query.site) return;
  const changed = query.city !== state.query.city || query.site !== state.query.site;
  cancel(); state.query = query;
  if (changed) { state.sides = freshSides(); state.notified.clear(); state.trends.clear(); }
  $('heading').textContent = `${query.site} → 民辉`; document.title = `${query.site} → 民辉 · 通勤助手`;
  refresh();
});
$('commute-form').addEventListener('change', () => {
  state.walkMinutes = clampInt($('walk').value, 0, 30, 4);
  state.bufferMinutes = clampInt($('buffer').value, 0, 10, 1);
  state.alertMinutes = clampInt($('alert').value, 1, 30, 6);
  savePrefs(); render(); maybeNotify();
});
$('notify').addEventListener('click', async () => {
  if (!notificationSupport()) return;
  if (Notification.permission === 'default') { try { await Notification.requestPermission(); } catch {} }
  if (Notification.permission === 'granted') {
    state.notifyEnabled = !state.notifyEnabled;
    if (state.notifyEnabled) state.notified.clear();
    savePrefs(); render(); maybeNotify();
  } else render();
});
$('sound-enable').addEventListener('click', async () => {
  try { await ensureAudioContext(); playChime(); renderAppointment(); }
  catch (error) { $('appointment-status').dataset.tone = 'warn'; $('appointment-status').textContent = error.message || '无法启用页面提示音。'; }
});
$('appointment-save').addEventListener('click', async () => {
  const raw = $('appointment-time').value;
  const at = raw ? new Date(raw).getTime() : NaN;
  const lead = clampInt($('appointment-lead').value, 0, 60, 5);
  if (!Number.isFinite(at) || at <= Date.now()) {
    $('appointment-status').dataset.tone = 'warn';
    $('appointment-status').textContent = '请选择一个未来时间。';
    return;
  }
  state.appointmentAt = at; state.appointmentLead = lead; state.appointmentFiredAt = 0; state.appointmentCalendarExported = false;
  markFired(0); savePrefs();
  if (notificationSupport() && Notification.permission === 'default') { try { await Notification.requestPermission(); } catch {} }
  renderAppointment(); checkAppointment();
});
$('appointment-clear').addEventListener('click', () => {
  stopAlarm(); state.appointmentAt = null; state.appointmentFiredAt = 0; state.appointmentCalendarExported = false;
  markFired(0); savePrefs(); $('appointment-time').value = ''; renderAppointment();
});
$('calendar-export').addEventListener('click', exportCalendar);
$('alarm-stop').addEventListener('click', stopAlarm);
$('refresh').addEventListener('click', refresh);
$('pause').addEventListener('click', () => {
  state.paused = !state.paused;
  if (state.paused) { clearTimeout(state.timer); state.nextAt = 0; render(); } else refresh();
});
$('minhui').addEventListener('click', () => { state.onlyMinhui = true; render(); });
$('all').addEventListener('click', () => { state.onlyMinhui = false; render(); });
document.addEventListener('visibilitychange', () => {
  if (document.hidden) cancel();
  else { state.online = navigator.onLine; checkAppointment(); render(); if (!state.paused && state.online) refresh(); }
});
window.addEventListener('offline', () => { state.online = false; cancel(); render(); });
window.addEventListener('online', () => { state.online = true; render(); if (!state.paused) refresh(); });
window.addEventListener('pagehide', cancel);
window.addEventListener('pageshow', event => {
  if (event.persisted) { state.online = navigator.onLine; checkAppointment(); render(); if (!state.paused && state.online) refresh(); }
});
setInterval(() => { if (!document.hidden) { checkAppointment(); renderAppointment(); render(); } }, 1000);

if (Number.isFinite(state.appointmentAt)) {
  $('appointment-time').value = formatDateTimeLocal(state.appointmentAt);
  $('appointment-lead').value = String(state.appointmentLead);
}
if ('serviceWorker' in navigator && ['https:', 'http:'].includes(location.protocol)) {
  navigator.serviceWorker.register('./bus-sw.v2.2.js', { scope: './' }).then(reg => reg.update()).catch(() => {});
}
render(); checkAppointment(); if (state.online) refresh();
