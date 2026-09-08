import { VERSION, decodeResponse, buildView, chinaTime } from './domain.v2.mjs';
const API = 'https://api.code410.com/api/traffic/bus';
const $ = id => document.getElementById(id);
const node = (tag, cls, value) => { const n = document.createElement(tag); if (cls) n.className = cls; if (value !== undefined) n.textContent = value; return n; };
const state = { query: { city: '台州', site: '群辉' }, sides: [], busy: false, paused: false, onlyMinhui: true,
  online: navigator.onLine, generation: 0, controllers: [], timer: null, nextAt: 0 };
const freshSides = () => ['A', 'B'].map(side => ({ side, status: 'idle', rows: [], notices: [], receivedAt: null, error: '' }));
state.sides = freshSides();
function ageLabel(at) {
  if (!Number.isFinite(at)) return '尚未获取';
  const seconds = Math.max(0, Math.floor((Date.now() - at) / 1000));
  return seconds < 60 ? `${seconds}秒前获取` : `${Math.floor(seconds / 60)}分钟前获取`;
}
function render() {
  const view = buildView(state.sides, { onlyMinhui: state.onlyMinhui, online: state.online });
  const hero = $('winner'); hero.replaceChildren();
  const label = node('div', 'eyebrow', state.onlyMinhui ? '民辉方向 · 到上车站的预估' : '全部方向 · 到上车站的预估');
  hero.append(label);
  if (view.best) {
    const best = view.best; hero.dataset.state = 'valid';
    hero.append(node('h2', 'hero-eta', best.eta), node('div', 'winner-line', best.line),
      node('p', '', `开往 ${best.destination} · ${best.stops === null ? '站数未提供' : `还有 ${best.stops} 站`}`),
      node('p', '', view.complete ? '当前有效预估中最早到站；不是到达目的地的用时。' : '仅比较已成功获取的方向，结果可能不完整。'));
  } else {
    const uncertain = view.shown.length > 0;
    hero.dataset.state = !state.online ? 'offline' : uncertain ? 'uncertain' : state.busy ? 'loading' : 'empty';
    const heading = !state.online ? '网络已断开' : uncertain ? '到站时间待确认' : state.busy ? '正在查询' : '暂无有效到站预估';
    const detail = uncertain ? '记录中的时间异常、缺失或已经过期，暂不推荐最快一班；下方保留站数供核对。'
      : '不代表没有公交，可能尚未发车、站名不匹配或数据源暂未提供。';
    hero.append(node('h2', '', heading), node('p', '', state.busy && !uncertain ? '正在分别获取两个方向。' : detail));
  }
  const failed = state.sides.filter(s => s.status === 'error');
  $('status').dataset.tone = failed.length || view.uncertain || !state.online ? 'warn' : 'normal';
  $('status').textContent = state.busy ? '正在刷新，旧记录不会被标成刚更新…'
    : !state.online ? '当前离线，保留记录仅供参考，已停止推荐。'
    : `${failed.length ? `${failed.length} 个方向请求失败 · ` : ''}共 ${view.total} 条记录 · 当前显示 ${view.shown.length} 条${view.uncertain ? ` · ${view.uncertain} 条不参与推荐` : ''}。`;
  $('count').textContent = `${view.candidates.length} 条有效预估`;
  const cards = view.shown.map(row => {
    const card = node('article', 'bus'); card.dataset.quality = row.eligible ? 'valid' : 'unverified';
    const top = node('div', 'row-head');
    top.append(node('div', 'line-name', row.line), node('div', 'eta', row.eligible ? row.eta : row.stops === null ? '时间未知' : `${row.stops} 站`));
    card.append(top, node('p', 'destination', `开往 ${row.destination} · 接口方向 ${row.side}`));
    if (row.eligible) {
      card.append(node('p', 'quality', `${row.stops === null ? '未提供剩余站数' : `还有 ${row.stops} 站`}${row.arrivalMs !== null ? ` · 预计 ${chinaTime(row.arrivalMs).slice(0, 5)}` : ''}`));
    } else card.append(node('p', 'quality', row.stale ? '旧记录 · 已停止推荐，请等待重新获取' : `时间待确认 · ${row.issues[0] || '无有效预估'}`));
    card.append(node('div', 'source', `${ageLabel(row.receivedAt)} · ${row.stationVerified ? '上车站已匹配' : '上车站未确认'}`));
    return card;
  });
  $('list').replaceChildren(...(cards.length ? cards : [node('div', 'empty', state.busy ? '等待数据源返回…' : '暂无匹配的车辆记录。可切换全部方向核对。')]));
  const diag = state.sides.map(s => node('p', '', `方向 ${s.side}：${s.status === 'ok' ? `${s.rows.length} 条记录` : s.status === 'error' ? `失败：${s.error}` : '尚未获取'}${s.receivedAt !== null ? `；上次成功获取 ${chinaTime(s.receivedAt)}` : ''}${s.notices.length ? `；${s.notices.join('；')}` : ''}`));
  $('diagnostics').replaceChildren(...diag);
  $('minhui').setAttribute('aria-pressed', String(state.onlyMinhui));
  $('all').setAttribute('aria-pressed', String(!state.onlyMinhui));
  $('refresh').disabled = state.busy; $('refresh').textContent = state.busy ? '查询中…' : '立即刷新';
  $('pause').textContent = state.paused ? '恢复' : '暂停'; $('pause').setAttribute('aria-pressed', String(state.paused));
  const times = state.sides.map(s => s.receivedAt).filter(Number.isFinite);
  $('age').textContent = times.length ? ageLabel(Math.min(...times)) : '尚未获取数据';
  $('next').textContent = !state.online ? '联网后自动重试' : state.paused ? '自动刷新已暂停' : state.busy ? '分别查询两个方向' : state.nextAt ? `${Math.max(0, Math.ceil((state.nextAt - Date.now()) / 1000))}秒后刷新` : '自动刷新已开启';
  document.body.dataset.version = VERSION;
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
async function refresh() {
  if (document.hidden || !state.online) { render(); return; }
  cancel(); const generation = state.generation, query = { ...state.query };
  state.busy = true; render();
  await Promise.all(state.sides.map(async (previous, index) => {
    const controller = new AbortController(); state.controllers.push(controller);
    try {
      const data = await fetchSide(query, previous.side, controller);
      if (generation !== state.generation) return;
      // A successful empty response clears old rows, rather than recycling phantom buses.
      state.sides[index] = { side: previous.side, status: 'ok', error: '', ...data };
    } catch (error) {
      if (generation !== state.generation) return;
      state.sides[index] = { ...previous, status: 'error', error: errorMessage(error) };
    }
    if (generation === state.generation) render();
  }));
  if (generation !== state.generation) return;
  state.busy = false; state.controllers = []; schedule(); render();
}
$('query-form').addEventListener('submit', event => {
  event.preventDefault();
  const query = { city: $('city').value.trim(), site: $('site').value.trim() };
  if (!query.city || !query.site) return;
  const changed = query.city !== state.query.city || query.site !== state.query.site;
  cancel(); state.query = query;
  if (changed) state.sides = freshSides();
  $('heading').textContent = `${query.site} → 民辉`; document.title = `${query.site} → 民辉 · 公交到站`;
  refresh();
});
$('refresh').addEventListener('click', refresh);
$('pause').addEventListener('click', () => { state.paused = !state.paused; if (state.paused) { clearTimeout(state.timer); state.nextAt = 0; render(); } else refresh(); });
$('minhui').addEventListener('click', () => { state.onlyMinhui = true; render(); });
$('all').addEventListener('click', () => { state.onlyMinhui = false; render(); });
document.addEventListener('visibilitychange', () => { if (document.hidden) cancel(); else { render(); if (!state.paused) refresh(); } });
window.addEventListener('offline', () => { state.online = false; cancel(); render(); });
window.addEventListener('online', () => { state.online = true; render(); if (!state.paused) refresh(); });
window.addEventListener('pagehide', cancel);
window.addEventListener('pageshow', event => { if (event.persisted) { state.online = navigator.onLine; render(); if (!state.paused) refresh(); } });
// Never decrement the bus ETA locally. Only the data source can supply a new estimate.
setInterval(() => { if (!document.hidden) render(); }, 1000);
$('latest').addEventListener('click', event => { event.preventDefault(); const url = new URL('./v2.html', location.href); url.searchParams.set('reload', String(Date.now())); location.assign(url); });

// Update only this app's existing parent worker; no global cache deletion or unregister.
if ('serviceWorker' in navigator && ['https:', 'http:'].includes(location.protocol)) {
  navigator.serviceWorker.getRegistration(new URL('../', location.href).href).then(async registration => {
    if (registration && registration.active?.scriptURL === new URL('../service-worker.js', location.href).href) await registration.update();
  }).catch(() => {});
}
render(); refresh();
