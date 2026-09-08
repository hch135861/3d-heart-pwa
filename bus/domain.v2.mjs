/** Code410 boundary adapter. Unknown/invalid data never becomes a zero ETA. */
export const VERSION = '2.0.0';
export const FRESH_MS = 45000;
const MAX_SECONDS = 21600;
const OFFSET = 8 * 3600000;
const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const text = v => ['string', 'number'].includes(typeof v) ? String(v).normalize('NFKC').trim() : '';
const bare = v => text(v).replace(/[\p{Extended_Pictographic}\uFE0F\u200D]/gu, '').trim();
const empty = v => v == null || (typeof v === 'string' && (text(v) === '' || /^(?:--?|暂无|未知|null|undefined)$/i.test(text(v))));
export const cleanLabel = (v, fallback = '') => bare(v).slice(0, 100) || fallback;

export function parseStops(value) {
  const s = bare(value), m = s.match(/^(?:剩余|剩|还有)?\s*(\d{1,3})\s*(?:站)?$/);
  return m && Number(m[1]) <= 200 ? Number(m[1]) : null;
}

export function parseDuration(value) {
  if (empty(value)) return { kind: 'missing', seconds: null };
  const s = bare(value).replace(/^(?:预计还需|预计|大约|约)\s*/, '').replace(/\s+/g, '');
  // Bare numbers have no documented unit. Do not guess minutes or timestamps.
  if (/^(?:即将到站|即将进站|进站中|已到站|到站)$/.test(s)) return { kind: 'valid', seconds: 0 };
  let m = s.match(/^(\d+(?:\.\d+)?)(?:-|~|至|–)(\d+(?:\.\d+)?)(分钟|分|秒)$/);
  if (m) {
    const lo = Number(m[1]), hi = Number(m[2]), k = m[3] === '秒' ? 1 : 60;
    return lo <= hi && hi * k <= MAX_SECONDS
      ? { kind: 'valid', seconds: hi * k, label: `${lo}–${hi}${k === 60 ? '分钟' : '秒'}` }
      : { kind: 'invalid', seconds: null };
  }
  m = s.match(/^(?:(\d+(?:\.\d+)?)小时)?(?:(\d+(?:\.\d+)?)(?:分钟|分))?(?:(\d+(?:\.\d+)?)秒)?$/);
  if (!m || !m.slice(1).some(v => v !== undefined)) return { kind: 'invalid', seconds: null };
  const seconds = Number(m[1] || 0) * 3600 + Number(m[2] || 0) * 60 + Number(m[3] || 0);
  return seconds <= MAX_SECONDS ? { kind: 'valid', seconds } : { kind: 'invalid', seconds: null };
}

/** Explicit +08:00 calendar parsing; never hand arbitrary strings to Date. */
export function parseArrival(value, now = Date.now()) {
  if (empty(value)) return { kind: 'missing', ms: null };
  const s = text(value);
  let ms = NaN;
  if (/^\d{10}$/.test(s)) ms = Number(s) * 1000;
  else if (/^\d{13}$/.test(s)) ms = Number(s);
  else {
    const m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-]\d{2}:?\d{2})?$/i);
    if (m) {
      const [, y, mo, d, h, mi, se = '0', fraction = '0', zone] = m;
      const parts = [y, mo, d, h, mi, se].map(Number);
      const raw = Date.UTC(parts[0], parts[1] - 1, parts[2], parts[3], parts[4], parts[5], Number(fraction.padEnd(3, '0')));
      const check = new Date(raw);
      if (parts[0] < 2000 || check.getUTCFullYear() !== parts[0] || check.getUTCMonth() + 1 !== parts[1] ||
          check.getUTCDate() !== parts[2] || parts[3] > 23 || parts[4] > 59 || parts[5] > 59) return { kind: 'invalid', ms: null };
      let offset = OFFSET;
      if (zone && zone.toUpperCase() === 'Z') offset = 0;
      else if (zone) {
        const digits = zone.slice(1).replace(':', ''), hours = Number(digits.slice(0, 2)), minutes = Number(digits.slice(2));
        if (hours > 14 || minutes > 59 || (hours === 14 && minutes !== 0)) return { kind: 'invalid', ms: null };
        offset = (zone[0] === '-' ? -1 : 1) * (hours * 60 + minutes) * 60000;
      }
      ms = raw - offset;
    }
  }
  // Timeless HH:mm, epoch sentinels, old observations and far-future values are unverified.
  if (!Number.isFinite(ms) || ms < now - 120000 || ms > now + MAX_SECONDS * 1000) return { kind: 'invalid', ms: null };
  return { kind: 'valid', ms };
}

export function normalizeRow(raw, { now, side, sourceKey, stationVerified }) {
  const duration = parseDuration(raw.estimated_time);
  const arrival = parseArrival(raw.expected_arrival, now);
  const stops = parseStops(raw.remaining_stations);
  const issues = [];
  if (arrival.kind === 'invalid') issues.push('源接口到站日期无效或过期');
  if (duration.kind === 'invalid') issues.push('等待时间格式或单位不明确');
  let seconds = duration.kind === 'valid' ? duration.seconds
    : arrival.kind === 'valid' ? Math.max(0, (arrival.ms - now) / 1000) : null;
  if (seconds === 0 && (stops === null || stops > 1)) issues.push('零分钟缺少临近站点依据');
  if (duration.kind === 'valid' && arrival.kind === 'valid' &&
      Math.abs(duration.seconds - (arrival.ms - now) / 1000) > Math.max(180, duration.seconds * 0.35)) {
    issues.push('等待时长与到站时刻相互矛盾');
  }
  if (seconds === null) issues.push('接口未提供可用到站时间');
  if (!stationVerified) issues.push('返回站点与上车站未精确匹配');
  const line = cleanLabel(raw.line, '未标明线路'), destination = cleanLabel(raw.destination, '未标明终点');
  if (!cleanLabel(raw.line)) issues.push('接口未标明线路');
  if (!cleanLabel(raw.destination)) issues.push('接口未标明终点');
  if (issues.length) seconds = null;
  const terminal = destination.replace(/^开往\s*/, '').replace(/\s+/g, '').replace(/[（(]终点站?[）)]$/, '');
  const toMinhui = ['民辉', '民辉站', '公交民辉站'].includes(terminal);
  const eta = seconds === null ? '时间待确认' : seconds === 0 ? '不足1分钟'
    : duration.label || (seconds < 60 ? `约${Math.ceil(seconds)}秒` : `约${Math.ceil(seconds / 60)}分钟`);
  return { line, destination, stops, seconds, eta, toMinhui, issues,
    arrivalMs: issues.length ? null : arrival.ms, side, sourceKey,
    receivedAt: now, stationVerified,
    key: JSON.stringify([side, sourceKey, line, destination, text(raw.licence_plate), text(raw.estimated_time), text(raw.expected_arrival), stops]) };
}

export function decodeResponse(json, query, side, now = Date.now()) {
  if (!object(json) || Number(json.code) !== 200) throw new Error(cleanLabel(json?.msg, '接口返回异常'));
  const rows = [], notices = [], data = json.data;
  if (typeof data === 'string') return { rows, notices: [cleanLabel(data, '接口没有返回车辆记录')] };
  if (!object(data) && !Array.isArray(data)) throw new Error('接口数据结构不符合文档');
  const groups = Array.isArray(data) ? [['未标明站点', data]] : Object.entries(data);
  for (const [key, values] of groups) {
    if (typeof values === 'string') { notices.push(cleanLabel(values)); continue; }
    if (!Array.isArray(values)) { notices.push('已忽略无法识别的数据分组'); continue; }
    const city = query.city.replace(/市$/, '');
    const stationVerified = key === `${city}-${query.site}` || key === `${city}市-${query.site}`;
    for (const value of values) {
      if (!object(value)) { notices.push('已忽略格式异常的记录'); continue; }
      rows.push(normalizeRow(value, { now, side, sourceKey: key, stationVerified }));
    }
  }
  return { rows: [...new Map(rows.map(row => [row.key, row])).values()], notices: [...new Set(notices)] };
}

/** A failed direction keeps its old records, but they are never candidates. */
export function buildView(sides, { now = Date.now(), onlyMinhui = true, online = true } = {}) {
  const rows = sides.flatMap(s => (s.rows || []).map(row => {
    const age = now - row.receivedAt;
    const stale = !online || s.status !== 'ok' || age < -1000 || age >= FRESH_MS;
    return { ...row, stale, eligible: !stale && row.seconds !== null && row.stationVerified };
  }));
  const shown = rows.filter(r => !onlyMinhui || r.toMinhui).sort((a, b) =>
    Number(b.eligible) - Number(a.eligible) || (a.seconds ?? Infinity) - (b.seconds ?? Infinity) ||
    (a.stops ?? Infinity) - (b.stops ?? Infinity) || a.line.localeCompare(b.line, 'zh-CN'));
  const candidates = shown.filter(r => r.eligible);
  const complete = online && sides.length === 2 && sides.every(s =>
    s.status === 'ok' && Number.isFinite(s.receivedAt) && now >= s.receivedAt - 1000 && now - s.receivedAt < FRESH_MS);
  return { shown, candidates, best: candidates[0] || null, complete,
    total: rows.length, uncertain: shown.filter(r => !r.eligible).length };
}

export function chinaTime(ms) {
  if (!Number.isFinite(ms)) return '—';
  return new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(ms);
}
