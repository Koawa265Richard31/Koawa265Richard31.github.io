/*!
 * health-card.js v1.0 — 博客健康状态卡（小米手环 11 · Gadgetbridge 链路）
 * ----------------------------------------------------------------------------
 * 数据源：astrbot_health 插件 GET 接口（自签名 TLS，CORS 全开）。
 * 行为（按需求）：默认折叠藏在关于页；点击栏目头才展开；首次展开才拉数据；
 * 展开期间每 5 分钟自动刷新，收起即停。只用 GET，绝不触碰 POST /health/upload。
 *
 * 容错（规格要求）：stress/standing/sleep 可能为 null；sleep 可能返回 _error；
 * hr/spo2/battery 可能缺采样；数据延迟 >2h 提示「延迟」，>6h 提示「已断」；
 * 自签名证书：若 fetch 失败，给出引导用户先手动接受一次证书的链接。
 */
(function () {
  'use strict';
  if (typeof window === 'undefined' || !('customElements' in window)) return;
  if (window.customElements.get('health-card')) return;

  var BASE = 'https://117.72.203.70:63000';
  var REFRESH_MS = 5 * 60 * 1000;   // 每 5 分钟查询一次
  var GET_PATHS = ['/health/now', '/health/sleep_state', '/health/status', '/health/sleep', '/health/trend?days=7'];

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function fmtTime(unix) {
    if (!unix) return '';
    var d = new Date(unix * 1000);
    return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
  }
  function ageMin(unixSec) {
    if (!unixSec) return null;
    return (Date.now() / 1000 - unixSec) / 60;
  }
  /* "2026-10-18 16:23:07" 按 Asia/Shanghai 解析 */
  function parseCST(s) {
    if (!s) return null;
    var d = new Date(s.replace(' ', 'T') + '+08:00');
    return isNaN(d.getTime()) ? null : d.getTime() / 1000;
  }
  /* standing 目前实测是秒（32992 ≈ 9.2h）；小时级小数则直接显示 */
  function fmtStanding(v) {
    if (v == null) return null;
    if (v > 100) return (v / 3600).toFixed(1) + ' h';
    return v + ' h';
  }

  /* 指标 SVG 标记（统一 14px 线性风格，currentColor 随文字色） */
  var IC = {
    battery: '<rect x="2" y="8" width="17" height="9" rx="2"/><path d="M22 11v3"/><path d="M6 11.5v2M9.5 11.5v2M13 11.5v2"/>',
    heart: '<path d="M12 20.3 4.9 13a4.9 4.9 0 0 1 7-6.9l.1.2.1-.2a4.9 4.9 0 0 1 7 6.9z"/>',
    droplet: '<path d="M12 3s6 6.6 6 10.6a6 6 0 0 1-12 0C6 9.6 12 3 12 3z"/>',
    gauge: '<polyline points="21 12 17 12 14 20 10 4 7 12 3 12"/>',
    steps: '<path d="M3 20h5v-4h5v-4h5V8h3"/>',
    flame: '<path d="M12 3c.6 2.4-.3 4-1.5 5.6C9.2 10.3 8 11.6 8 13.6a4 4 0 0 0 8 .2c0-1.2-.5-2.2-1.2-3.2-.9 1-1.8 1.4-1.8 1.4.7-2.6 0-5.4-1-9z"/>',
    person: '<circle cx="12" cy="5.5" r="2.4"/><path d="M12 8.5v5.5m0 0-2.8 6.5m2.8-6.5 2.8 6.5M9.6 12.8h4.8"/>',
    moon: '<path d="M20.5 13.5A8.5 8.5 0 1 1 10.5 3.5a7 7 0 0 0 10 10z"/>',
    bed: '<path d="M3 18v-7m0 4h18v3m0-3v-1.5a2.5 2.5 0 0 0-2.5-2.5H12v4"/><circle cx="6.8" cy="12.8" r="1.7"/>',
    clock: '<circle cx="12" cy="12" r="8.5"/><polyline points="12 7.5 12 12 15 13.8"/>'
  };
  function ic(name) {
    return '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + IC[name] + '</svg>';
  }

  function createEngine(host) {
    var shadow = host.shadowRoot || host.attachShadow({ mode: 'open' });
    shadow.innerHTML =
      '<style>' +
      ':host{display:block;contain:content}' +
      '.hc{background:rgba(13,16,24,.55);border:1px solid rgba(160,190,255,.16);border-radius:14px;backdrop-filter:blur(20px) saturate(1.35);-webkit-backdrop-filter:blur(20px) saturate(1.35);box-shadow:0 10px 30px rgba(0,0,0,.32),inset 0 1px 0 rgba(255,255,255,.08);overflow:hidden}' +
      '.hc-head{display:flex;align-items:center;gap:.55rem;width:100%;padding:.85rem 1.1rem;background:none;border:none;color:#e3e9f4;font:600 .98rem/1.4 system-ui,-apple-system,"Segoe UI",sans-serif;cursor:pointer;text-align:left}' +
      '.hc-head:hover{background:rgba(255,255,255,.045)}' +
      '.hc-dot{width:9px;height:9px;border-radius:50%;background:#6b7686;flex:none;transition:background .3s}' +
      '.hc-dot.ok{background:#63d68f}.hc-dot.stale{background:#f0b95e}.hc-dot.down{background:#e5715f}' +
      '.hc-chev{margin-left:auto;transition:transform .25s;color:#a7b2c2;font-size:.85rem}' +
      '.hc.open .hc-chev{transform:rotate(90deg)}' +
      '.hc-body{display:none;padding:.2rem 1.1rem 1rem}' +
      '.hc.open .hc-body{display:block}' +
      '.hc-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:.55rem;margin:.4rem 0 .7rem}' +
      '.hc-cell{background:rgba(255,255,255,.04);border:1px solid rgba(160,190,255,.1);border-radius:10px;padding:.55rem .7rem}' +
      '.hc-k{font-size:.72rem;color:#a7b2c2;letter-spacing:.04em;display:flex;align-items:center;gap:.35rem}' +
      '.hc-k svg{width:13px;height:13px;flex:none;color:#8fa3c8}' +
      '.hc-state{font-size:.9rem;color:#e3e9f4;margin:.2rem 0 .55rem;display:flex;align-items:center;gap:.4rem}' +
      '.hc-state svg{width:14px;height:14px;flex:none;color:#8fa3c8}' +
      '.hc-v{font-size:1.15rem;font-weight:700;color:#e3e9f4;margin-top:.15rem}' +
      '.hc-v small{font-size:.72rem;font-weight:400;color:#a7b2c2;margin-left:.15rem}' +
      '.hc-v .dim{color:#8b96a6;font-weight:400}' +
      '.hc-bat{height:6px;border-radius:3px;background:rgba(255,255,255,.1);margin-top:.4rem;overflow:hidden}' +
      '.hc-bat i{display:block;height:100%;border-radius:3px;background:#63d68f;transition:width .5s ease}' +
      '.hc-meta{font-size:.78rem;color:#a7b2c2;line-height:1.7;display:flex;align-items:center;gap:.4rem;flex-wrap:wrap}' +
      '.hc-meta svg{width:14px;height:14px;flex:none;color:#8fa3c8}' +
      '.hc-chart{margin:.35rem 0 .65rem}' +
      '.hc-canvas{position:relative;height:130px;margin-top:.3rem}' +
      '.hc-meta b{color:#e3e9f4;font-weight:600}' +
      '.hc-warn{font-size:.8rem;color:#f0b95e;margin:.35rem 0 0}' +
      '.hc-err{font-size:.85rem;color:#f0b95e;line-height:1.7;margin:.5rem 0}' +
      '.hc-err a{color:#9cc3ff}' +
      '.hc-foot{font-size:.72rem;color:#6b7686;margin-top:.55rem}' +
      '.hc-foot a{color:#8fa8d8;text-decoration:none}' +
      '.hc-skel{color:#8b96a6;font-size:.85rem;padding:.4rem 0 .6rem}' +
      'a{color:#9cc3ff}' +
      '@media (prefers-reduced-motion:reduce){*{transition:none!important}}' +
      '</style>' +
      '<div class="hc">' +
      '<button class="hc-head" type="button" aria-expanded="false">' +
      '<span class="hc-dot" aria-hidden="true"></span>' +
      '<span class="hc-title">健康状态</span>' +
      '<span class="hc-chev" aria-hidden="true">▸</span>' +
      '</button>' +
      '<div class="hc-body"><div class="hc-skel">展开后加载…</div></div>' +
      '</div>';

    var root = shadow.querySelector('.hc');
    var head = shadow.querySelector('.hc-head');
    var body = shadow.querySelector('.hc-body');
    var dot = shadow.querySelector('.hc-dot');
    var open = false, loaded = false, timer = 0, alive = true, chartRef = null;

    function setOpen(v) {
      if (!alive || v === open) return;
      open = v;
      root.classList.toggle('open', v);
      head.setAttribute('aria-expanded', v ? 'true' : 'false');
      if (v) {
        if (!loaded) load();
        else load(); // 展开时立即刷新一次
        timer = setInterval(load, REFRESH_MS);   // 每 5 分钟查询一次
      } else if (timer) {
        clearInterval(timer); timer = 0;         // 收起即停
      }
    }
    head.addEventListener('click', function () { setOpen(!open); });

    function get(path) {
      return fetch(BASE + path, { cache: 'no-store' }).then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      }).then(function (j) {
        if (!j || j.ok !== true) throw new Error((j && j.error) || '响应异常');
        // /health/status 不带 data 外壳（字段直接在顶层），其余接口是 {ok, data}
        return j.data !== undefined && j.data !== null ? j.data : j;
      });
    }

    function load() {
      if (!alive) return;
      body.innerHTML = '<div class="hc-skel">加载中…</div>';
      Promise.allSettled(GET_PATHS.map(function (p) { return get(p); })).then(function (rs) {
        if (!alive) return;
        var now = rs[0].status === 'fulfilled' ? rs[0].value : null;
        var sleepState = rs[1].status === 'fulfilled' ? rs[1].value : null;
        var status = rs[2].status === 'fulfilled' ? rs[2].value : null;
        var sleep = rs[3].status === 'fulfilled' ? rs[3].value : null;
        var trend = rs[4].status === 'fulfilled' ? rs[4].value : null;
        render(now, sleepState, status, sleep, trend);
      });
    }

    function render(now, sleepState, status, sleep, trend) {
      if (!now && !status) {
        dot.className = 'hc-dot down';
        body.innerHTML =
          '<div class="hc-err">健康数据暂时取不到（多半是数据源的自签名证书还没被这个浏览器接受）。' +
          '<a href="' + BASE + '/health/now" target="_blank" rel="noopener">点这里打开一次数据源</a>并选择「继续访问」，' +
          '回来再展开本卡片即可。</div>' +
          footHtml();
        return;
      }
      var d = now || {};
      var today = d.today || {};
      var hrAge = d.hr && d.hr.at ? ageMin(d.hr.at) : null;
      var st = null;
      if (sleepState && sleepState.state) {
        // /health/sleep_state 的 data.state.state 才是状态字符串
        st = typeof sleepState.state === 'string' ? sleepState.state : (sleepState.state.state || null);
      }
      var stMap = { sleeping: '在睡', likely_sleeping: '大概率在睡', awake: '醒着', unknown: '未知' };
      var stTxt = st ? (stMap[st] || st) : '—';

      /* 链路新鲜度（规格：>2h 延迟，>6h 已断） */
      var upTs = status && status.state ? parseCST(status.state.last_upload_at) : null;
      var upAge = upTs ? ageMin(upTs) : null;
      var freshTxt, freshCls;
      if (upAge == null) { freshTxt = '未知'; freshCls = ''; }
      else if (upAge > 360) { freshTxt = Math.round(upAge / 60) + ' 小时前 · 数据已断'; freshCls = 'stale'; }
      else if (upAge > 120) { freshTxt = Math.round(upAge / 60) + ' 小时前 · 数据可能延迟'; freshCls = 'stale'; }
      else { freshTxt = Math.max(0, Math.round(upAge)) + ' 分钟前'; freshCls = 'ok'; }
      dot.className = 'hc-dot ' + (freshCls === 'stale' ? 'stale' : (upAge != null ? 'ok' : 'down'));
      head.querySelector('.hc-title').textContent = '健康状态 · ' + (freshCls === 'stale' ? '数据' + freshTxt.replace(/ ·.*/, '') : '在线');

      var hrStale = hrAge != null && hrAge > 120;
      var cells =
        cell('heart', '心率', d.hr && d.hr.v != null ? d.hr.v : dim(), d.hr && d.hr.v != null ? '<small>bpm</small>' : '', d.hr && d.hr.at ? '<div class="hc-k">' + fmtTime(d.hr.at) + (hrStale ? ' · 采样较旧' : '') + '</div>' : '') +
        cell('droplet', '血氧', d.spo2 && d.spo2.v != null ? d.spo2.v : dim(), d.spo2 && d.spo2.v != null ? '<small>%</small>' : '', d.spo2 && d.spo2.at ? '<div class="hc-k">' + fmtTime(d.spo2.at) + ((ageMin(d.spo2.at) || 0) > 120 ? ' · 采样较旧' : '') + '</div>' : '') +
        cell('gauge', '压力', d.stress && d.stress.v != null ? d.stress.v : dim(), d.stress && d.stress.v != null ? '<small>/100</small>' : '', d.stress && d.stress.at ? '<div class="hc-k">' + fmtTime(d.stress.at) + ((ageMin(d.stress.at) || 0) > 120 ? ' · 采样较旧' : '') + '</div>' : '') +
        cell('steps', '今日步数', today.steps != null ? today.steps : (d.steps_window != null ? d.steps_window + '<small>（6h）</small>' : dim())) +
        cell('flame', '今日卡路里', today.calories != null ? today.calories : dim(), today.calories != null ? '<small>kcal</small>' : '') +
        cell('heart', '静息心率', today.hr_resting != null ? today.hr_resting : dim(), today.hr_resting != null ? '<small>bpm</small>' : '') +
        cell('person', '站立', (function () { var sv = fmtStanding(today.standing); return sv == null ? dim() : sv; })());

      var sleepRow = '';
      if (sleep && sleep.sleep) {
        var sp = sleep.sleep;
        sleepRow = '<div class="hc-state">' + ic('bed') + '<span>昨夜睡眠：<b>' + esc(sp.total || '—') + '</b>' +
          (sp.deep ? '（深 ' + esc(sp.deep) + '）' : '') +
          (sp.wakeup ? ' · ' + fmtTime(sp.wakeup) + ' 醒' : '') + '</span></div>';
      } else {
        sleepRow = '<div class="hc-state">' + ic('bed') + '<span>睡眠：暂无数据</span></div>';
      }

      var warn = freshCls === 'stale' ? '<div class="hc-warn">上传链路' + freshTxt.replace(/^[^·]*· /, '') + '</div>' : '';

      /* 近 7 天步数图（/health/trend；Chart.js 组件渲染，加载失败退回内联 SVG） */
      var chartHtml = '', chartDays = null;
      var days = trend && trend.days ? trend.days.slice(0, 7).slice().reverse() : []; // 接口倒序 → 转时间正序
      if (days.length >= 2) {
        chartDays = days;
        chartHtml = '<div class="hc-chart"><div class="hc-k">' + ic('steps') + '<span>近 ' + days.length + ' 天步数</span></div><div class="hc-canvas"></div></div>';
      }

      body.innerHTML =
        '<div class="hc-grid">' + cells + '</div>' +
        chartHtml +
        '<div class="hc-state">' + ic('person') + '<span>当前状态：<b>' + esc(stTxt) + '</b></span></div>' +
        sleepRow +
        '<div class="hc-meta">' + ic('clock') + '<span>最后上传：<b>' + esc(status && status.state ? status.state.last_upload_at : '—') + '</b>（' + freshTxt + '）</span></div>' +
        warn + footHtml();

      if (chartDays) drawChart(chartDays);
    }

    /* Chart.js 懒加载（全站共享一个加载 Promise）；失败退回 SVG 柱状图 */
    function ensureChart() {
      if (window.Chart) return Promise.resolve(window.Chart);
      if (!window.__hcChartP) {
        window.__hcChartP = new Promise(function (res, rej) {
          var s = document.createElement('script');
          s.src = 'https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js';
          s.onload = function () { window.Chart ? res(window.Chart) : rej(new Error('Chart 未就绪')); };
          s.onerror = function () { rej(new Error('Chart.js 加载失败')); };
          document.head.appendChild(s);
          setTimeout(function () { if (!window.Chart) rej(new Error('Chart.js 超时')); }, 10000);
        });
      }
      return window.__hcChartP;
    }
    function svgBars(days) {
      var W = 280, H = 84, bw = W / days.length, maxV = 1;
      days.forEach(function (d0) { if ((d0.steps || 0) > maxV) maxV = d0.steps; });
      var bars = days.map(function (d0, i) {
        var h = Math.max(2, Math.round((d0.steps || 0) / maxV * (H - 20)));
        var x = (i * bw + 4).toFixed(1), w = (bw - 8).toFixed(1), y = H - 16 - h;
        return '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" rx="2.5" fill="rgba(140,180,255,.55)"><title>' + esc(d0.day) + ' · ' + (d0.steps || 0) + ' 步</title></rect>' +
          '<text x="' + (i * bw + bw / 2).toFixed(1) + '" y="' + (H - 5) + '" font-size="7.5" fill="#8b96a6" text-anchor="middle">' + esc(String(d0.day).slice(5)) + '</text>';
      }).join('');
      return '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" style="display:block;height:auto">' + bars + '</svg>';
    }
    function drawChart(days) {
      var wrap = shadow.querySelector('.hc-canvas');
      if (!wrap) return;
      if (chartRef) { try { chartRef.destroy(); } catch (e) { /* noop */ } chartRef = null; }
      ensureChart().then(function (C) {
        if (!alive) return;
        var freshWrap = shadow.querySelector('.hc-canvas');
        if (!freshWrap) return;
        freshWrap.innerHTML = '';
        var cv = document.createElement('canvas');
        freshWrap.appendChild(cv);
        chartRef = new C(cv, {
          type: 'bar',
          data: {
            labels: days.map(function (d0) { return String(d0.day).slice(5); }),
            datasets: [{
              data: days.map(function (d0) { return d0.steps || 0; }),
              backgroundColor: 'rgba(140,180,255,.55)',
              hoverBackgroundColor: 'rgba(165,205,255,.85)',
              borderRadius: 4, maxBarThickness: 34
            }]
          },
          options: {
            responsive: true, maintainAspectRatio: false,
            plugins: {
              legend: { display: false },
              tooltip: {
                backgroundColor: 'rgba(9,14,28,.95)', borderColor: 'rgba(130,165,255,.4)', borderWidth: 1,
                titleColor: '#cfe3ff', bodyColor: '#e3e9f4', padding: 8, displayColors: false,
                callbacks: { label: function (c) { return c.parsed.y + ' 步'; } }
              }
            },
            scales: {
              x: { grid: { display: false }, ticks: { color: '#8b96a6', font: { size: 10 } } },
              y: { beginAtZero: true, grid: { color: 'rgba(255,255,255,.07)' }, ticks: { color: '#8b96a6', font: { size: 10 }, maxTicksLimit: 4 } }
            }
          }
        });
      }).catch(function () {
        var freshWrap = shadow.querySelector('.hc-canvas');
        if (freshWrap && alive) freshWrap.innerHTML = svgBars(days);
      });
    }
    function dim() { return '<span class="dim">—</span>'; }
    function cell(icon, k, v, unit, extra) {
      return '<div class="hc-cell"><div class="hc-k">' + ic(icon) + '<span>' + k + '</span></div><div class="hc-v">' + v + (unit || '') + '</div>' + (extra || '') + '</div>';
    }
    function footHtml() {
      return '<div class="hc-foot">每 5 分钟自动刷新（展开期间）· <a href="' + BASE + '/health/now" target="_blank" rel="noopener noopener">数据源</a></div>';
    }

    return {
      destroy: function () {
        alive = false;
        if (timer) clearInterval(timer);
        if (chartRef) { try { chartRef.destroy(); } catch (e) { /* noop */ } chartRef = null; }
      }
    };
  }

  window.customElements.define('health-card', class extends HTMLElement {
    constructor() { super(); }
    connectedCallback() {
      if (this._e) return;
      this._e = createEngine(this);
    }
    disconnectedCallback() { if (this._e) { this._e.destroy(); this._e = null; } }
  });
})();
