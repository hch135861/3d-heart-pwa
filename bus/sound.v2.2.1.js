(() => {
  'use strict';
  const VERSION = '2.2.1';
  const $ = id => document.getElementById(id);
  const audio = new Audio();
  audio.preload = 'auto';
  audio.volume = 1;
  audio.muted = false;
  audio.playsInline = true;
  audio.setAttribute('playsinline', '');
  audio.setAttribute('webkit-playsinline', '');

  let wavUrl = '';
  let unlocked = false;
  let repeatTimer = null;
  let stopTimer = null;
  let alarmRunning = false;

  function setStatus(text, tone = 'normal') {
    const el = $('sound-status');
    if (!el) return;
    el.textContent = text;
    el.dataset.tone = tone;
  }

  function makeWavUrl() {
    if (wavUrl) return wavUrl;
    const sampleRate = 11025;
    const duration = 1.35;
    const length = Math.floor(sampleRate * duration);
    const dataSize = length * 2;
    const buffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(buffer);
    const text = (offset, value) => { for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i)); };
    text(0, 'RIFF'); view.setUint32(4, 36 + dataSize, true); text(8, 'WAVE'); text(12, 'fmt ');
    view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true); view.setUint16(34, 16, true); text(36, 'data'); view.setUint32(40, dataSize, true);
    const notes = [[0.04, 0.29, 784], [0.45, 0.72, 988], [0.88, 1.27, 1175]];
    for (let i = 0; i < length; i++) {
      const t = i / sampleRate;
      let value = 0;
      for (const [start, end, freq] of notes) {
        if (t < start || t > end) continue;
        const x = (t - start) / (end - start);
        const envelope = Math.max(0, Math.min(1, x / 0.12, (1 - x) / 0.18));
        value += envelope * (0.56 * Math.sin(2 * Math.PI * freq * t) + 0.16 * Math.sin(4 * Math.PI * freq * t));
      }
      value = Math.max(-0.92, Math.min(0.92, value));
      view.setInt16(44 + i * 2, Math.round(value * 32767), true);
    }
    wavUrl = URL.createObjectURL(new Blob([buffer], { type: 'audio/wav' }));
    audio.src = wavUrl;
    return wavUrl;
  }

  function mediaError(error) {
    const name = error?.name || '';
    if (name === 'NotAllowedError') return '浏览器阻止了播放。请直接再点一次“启用铃声并试播”。';
    if (name === 'NotSupportedError') return '当前浏览器无法播放页面生成的 WAV 提示音。';
    return `播放失败${error?.message ? `：${error.message}` : ''}`;
  }

  async function playOnce({ test = false } = {}) {
    makeWavUrl();
    try {
      audio.pause();
      try { audio.currentTime = 0; } catch {}
      audio.muted = false;
      audio.volume = 1;
      const promise = audio.play();
      if (promise && typeof promise.then === 'function') await promise;
      unlocked = true;
      document.body.dataset.mediaSound = 'ready';
      if (test) setStatus('✓ 浏览器已开始播放三声测试音。如果仍听不到，请调高“媒体音量”后再试。', 'good');
      return true;
    } catch (error) {
      unlocked = false;
      document.body.dataset.mediaSound = 'blocked';
      setStatus(mediaError(error), 'warn');
      throw error;
    }
  }

  function stopMediaAlarm() {
    alarmRunning = false;
    clearInterval(repeatTimer); clearTimeout(stopTimer);
    repeatTimer = null; stopTimer = null;
    audio.pause();
    try { audio.currentTime = 0; } catch {}
  }

  function startMediaAlarm() {
    if (!unlocked || document.hidden || alarmRunning) return;
    alarmRunning = true;
    playOnce().catch(() => {});
    repeatTimer = setInterval(() => { if (!document.hidden) playOnce().catch(() => {}); }, 1900);
    stopTimer = setTimeout(stopMediaAlarm, 30000);
  }

  function watchOverlay() {
    const overlay = $('alarm-overlay');
    if (!overlay) return;
    const sync = () => overlay.hidden ? stopMediaAlarm() : startMediaAlarm();
    new MutationObserver(sync).observe(overlay, { attributes: true, attributeFilter: ['hidden'] });
    sync();
  }

  async function unlockAndTest(event) {
    if (event) event.stopImmediatePropagation();
    setStatus('正在启动媒体播放…', 'normal');
    try { await playOnce({ test: true }); }
    catch {}
  }

  $('sound-enable')?.addEventListener('click', unlockAndTest, true);
  $('alarm-stop')?.addEventListener('click', stopMediaAlarm, true);
  document.addEventListener('visibilitychange', () => { if (document.hidden) stopMediaAlarm(); });
  window.addEventListener('pagehide', stopMediaAlarm);
  window.addEventListener('beforeunload', () => { if (wavUrl) URL.revokeObjectURL(wavUrl); });

  try {
    const proto = window.ServiceWorkerRegistration?.prototype;
    const original = proto?.showNotification;
    if (proto && typeof original === 'function' && !original.__busSoundWrapped) {
      const wrapped = function(title, options = {}) {
        if (!document.hidden && unlocked && options?.tag === 'bus-arrival') playOnce().catch(() => {});
        return original.call(this, title, options);
      };
      Object.defineProperty(wrapped, '__busSoundWrapped', { value: true });
      proto.showNotification = wrapped;
    }
  } catch {}

  window.BusMediaSound = { version: VERSION, playOnce, stop: stopMediaAlarm, get unlocked() { return unlocked; } };
  setStatus('声音状态：尚未试播。请先点“启用铃声并试播”。', 'normal');
  watchOverlay();
})();
