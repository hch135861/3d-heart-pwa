(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const pad = n => String(n).padStart(2, '0');

  function setStatus(text, tone = 'normal') {
    const el = $('appointment-status');
    if (!el) return;
    el.textContent = text;
    el.dataset.tone = tone;
  }

  function currentAppointment() {
    const raw = $('appointment-time')?.value || '';
    const at = raw ? new Date(raw).getTime() : NaN;
    const leadRaw = Number.parseInt($('appointment-lead')?.value || '5', 10);
    const lead = Number.isFinite(leadRaw) ? Math.min(60, Math.max(0, leadRaw)) : 5;
    if (!Number.isFinite(at)) throw new Error('请先选择预约出发时间。');
    if (at <= Date.now()) throw new Error('这个时间已经过去了，请先选择未来时间。');
    return { at, lead };
  }

  function utc(ms) {
    const d = new Date(ms);
    return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
  }

  function esc(value) {
    return String(value).replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
  }

  function makeIcs({ at, lead }) {
    const end = at + 15 * 60000;
    const uid = `bus-${at}@hch135861.github.io`;
    const lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//群辉到民辉通勤助手//CN',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      'BEGIN:VEVENT',
      `UID:${uid}`,
      `DTSTAMP:${utc(Date.now())}`,
      `DTSTART:${utc(at)}`,
      `DTEND:${utc(end)}`,
      `SUMMARY:${esc('群辉 → 民辉 · 公交出发')}`,
      `DESCRIPTION:${esc('打开公交通勤助手确认实时到站。锁屏或页面关闭后，以系统日历提醒为准。')}`,
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      `TRIGGER:-PT${lead}M`,
      `DESCRIPTION:${esc('该准备出发去群辉站了')}`,
      'END:VALARM',
      'END:VEVENT',
      'END:VCALENDAR'
    ];
    return lines.join('\r\n') + '\r\n';
  }

  function rememberLocally({ at, lead }) {
    try {
      const key = 'bus-commute-prefs-v2';
      const old = JSON.parse(localStorage.getItem(key) || '{}');
      localStorage.setItem(key, JSON.stringify({ ...old, appointmentAt: at, appointmentLead: lead }));
      localStorage.setItem('bus-appointment-last-fired-v1', '0');
    } catch {}
  }

  function openCalendarImport(ics) {
    const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.type = 'text/calendar';
    a.target = '_blank';
    a.rel = 'noopener';
    a.setAttribute('aria-label', '打开 iPhone 日历导入');
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 120000);
  }

  function fallbackShare(ics, at) {
    try {
      const name = `群辉到民辉-${new Date(at).toISOString().slice(0, 16).replace(/[:T]/g, '-')}.ics`;
      const file = new File([ics], name, { type: 'text/calendar;charset=utf-8' });
      if (navigator.canShare?.({ files: [file] })) {
        return navigator.share({ files: [file], title: '公交预约' });
      }
    } catch {}
    return Promise.reject(new Error('当前浏览器无法直接打开日历导入。'));
  }

  async function oneTapCalendar(event) {
    event.preventDefault();
    event.stopImmediatePropagation();
    try {
      const data = currentAppointment();
      const ics = makeIcs(data);
      rememberLocally(data);
      setStatus('正在打开 iPhone 日历导入…系统会要求你最后确认一次“添加”。', 'good');
      try {
        openCalendarImport(ics);
      } catch {
        await fallbackShare(ics, data.at);
      }
    } catch (error) {
      setStatus(error?.message || '无法生成日历事件。', 'warn');
    }
  }

  const button = $('calendar-export');
  if (button) {
    const keepReady = () => {
      button.textContent = '一键加入日历';
      if (button.disabled) button.disabled = false;
    };
    keepReady();
    button.addEventListener('click', oneTapCalendar, true);
    new MutationObserver(keepReady).observe(button, { attributes: true, attributeFilter: ['disabled'] });
    setInterval(keepReady, 1500);
  }
})();
