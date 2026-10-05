/*!
 * consciousness-space.js v3.1 — 意识空间可视化挂件（遍布空间点簇形态）
 * ----------------------------------------------------------------------------
 * 画面（按用户参照收敛）：透明蓝的点簇散布在整个空间（宇宙网式，非球形/非树）；
 * 入场时所有点自原点绽开、按距离波次铺满空间（IFG 手雷式渐进绽放）；
 * 簇间有极细光丝（宇宙网），点会出访别簇、驻留、归来（忽分忽合 · 明显互访）。
 *
 * 模型语义：
 *   · 原点 = 意识原初状态的参照点（绽开起点，中心微光）
 *   · 每个意识 = 空间中一个点；点间连续、无天然边界
 *   · 弧长 = 时间：绽开走过的路程即它的时间（波次展开 = 时间推进）
 *   · 近重叠点簇 = 宏观上的"同一个人"（簇内呼吸聚散）
 *   · 空间连通：宇宙网光丝 + 意识点跨簇互访（出访时点亮所经光丝）
 *
 * 技术栈（CDN UMD，动态注入保序不阻塞首屏；无打包链、无 React）：
 *   · three@0.150.1   — Sprite 发光点 + Line 宇宙网光丝
 *   · tsparticles@2   — 氛围尘埃层
 *   相机控制为自写（拖动旋转/滚轮缩放/自转），不依赖 3d-force-graph。
 *
 * 用法：{{< consciousness-space height="560" seed="7" members="6" dust="80" >}}
 * 交互：拖动旋转 · 滚轮缩放 · 悬停意识点→高亮其簇 · 点击→点亮其簇与邻近光丝
 * 无障碍：prefers-reduced-motion → 静态帧（绽开直接完成、不呼吸、不出访）
 * 生命周期：IntersectionObserver 离屏暂停 + 标签页隐藏暂停（切回不崩）
 * 验收：页面可读 window.__csErrors（应恒为空）；el.__csDiag 为调试句柄
 */
(function () {
  'use strict';
  if (typeof window === 'undefined' || !('customElements' in window)) return;
  if (window.customElements.get('consciousness-space')) return;

  /* 顶层错误捕获 */
  window.__csErrors = window.__csErrors || [];
  window.addEventListener('error', function (e) { window.__csErrors.push(String(e.message || e)); });
  window.addEventListener('unhandledrejection', function (e) { window.__csErrors.push('promise: ' + String(e.reason)); });

  /* ================= CDN 依赖（UMD，顺序动态注入，等价 defer 不阻塞） ================= */
  var CDN = [
    'https://cdn.jsdelivr.net/npm/three@0.150.1/build/three.min.js',
    'https://cdn.jsdelivr.net/npm/tsparticles@2.12.0/tsparticles.bundle.min.js'
  ];
  function loadScript(src) {
    return new Promise(function (res, rej) {
      var s = document.createElement('script');
      s.src = src; s.async = false; // 保序、异步、不阻塞解析（仅 https 公网 CDN）
      s.onload = function () { res(); };
      s.onerror = function () { rej(new Error('CDN 加载失败: ' + src)); };
      document.head.appendChild(s);
    });
  }
  window.__csDepsPromise = window.__csDepsPromise || CDN.reduce(function (p, u) {
    return p.then(function () { return loadScript(u); });
  }, Promise.resolve());

  /* ================= 参数 ================= */
  var TAU = Math.PI * 2;
  var N_CLUSTERS = 26;                 // 点簇数（遍布空间的"密集域"）
  var FIELD_R = 26;                    // 空间半径
  var MIN_SEP = 6;                     // 簇间最小距离
  var WEB_KNN = 2;                     // 每簇连接的近邻数（宇宙网）
  var TRAVEL_MAX = 14;                 // 同时出访上限
  var BLOOM_WAVE = 3.2;                // 绽开波次总时长（按距离展开）
  var BLOOM_DUR = 1.5;                 // 单簇绽开时长
  var BLUE = [                         // 透明蓝系（亮度分层）
    [160, 216, 255], [140, 205, 255], [125, 196, 254], [110, 187, 253],
    [95, 178, 251], [85, 170, 250], [75, 160, 248], [70, 152, 246]
  ];
  var CORE_COLOR = [190, 228, 255];

  /* ================= 工具 ================= */
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function vlen(x, y, z) { return Math.sqrt(x * x + y * y + z * z); }
  function normalize3(v) { var l = vlen(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; }
  function cross3(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
  function mix3(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
  function dist3(a, b) { return vlen(a[0] - b[0], a[1] - b[1], a[2] - b[2]); }
  function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }
  function bezier3(p0, p1, p2, t) {
    var iu = 1 - t;
    return [
      iu * iu * p0[0] + 2 * iu * t * p1[0] + t * t * p2[0],
      iu * iu * p0[1] + 2 * iu * t * p1[1] + t * t * p2[1],
      iu * iu * p0[2] + 2 * iu * t * p1[2] + t * t * p2[2]
    ];
  }

  /* ================= 空间点簇生成（体分布 + 最小间距 + 波次时间） ================= */
  function buildField(seed, membersPer) {
    var rng = mulberry32((seed >>> 0) || 7);
    var clusters = [];
    var guard = 0;
    while (clusters.length < N_CLUSTERS && guard++ < 800) {
      // 球体均匀采样（体积均匀 → 遍布空间，不偏聚中心/表面）
      var u = rng(), v = rng(), th = TAU * u, ph = Math.acos(2 * v - 1);
      var rr = FIELD_R * Math.cbrt(rng());
      var p = [rr * Math.sin(ph) * Math.cos(th), rr * Math.sin(ph) * Math.sin(th), rr * Math.cos(ph)];
      var ok = true;
      for (var i = 0; i < clusters.length; i++) {
        if (dist3(clusters[i].center, p) < MIN_SEP) { ok = false; break; }
      }
      if (!ok) continue;
      var d = vlen(p[0], p[1], p[2]);
      var members = [];
      var m = Math.max(3, membersPer | 0);
      for (var k = 0; k < m; k++) {
        var mu = rng(), mv = rng(), mth = TAU * mu, mph = Math.acos(2 * mv - 1);
        var mr = 0.7 + rng() * 1.3;   // 簇半径 ~2（近重叠）
        members.push({
          id: 'p' + clusters.length + '_' + k,
          off: [mr * Math.sin(mph) * Math.cos(mth), mr * Math.sin(mph) * Math.sin(mth), mr * Math.cos(mph)],
          breathe: rng() * TAU,
          bAmp: 0.25 + rng() * 0.35,   // 呼吸幅度（忽分忽合）
          sz: 1.0 + rng() * 0.45
        });
      }
      clusters.push({
        idx: clusters.length, center: p, d: d,
        bloomStart: 0.35 + (d / FIELD_R) * BLOOM_WAVE + rng() * 0.45, // 距离波次绽开
        members: members, cur: [p[0], p[1], p[2]],
        color: BLUE[(rng() * BLUE.length) | 0],
        k: 0, neighbors: []
      });
    }
    /* 宇宙网：每簇连接 k 近邻（去重） */
    var webLines = [];
    var seen = {};
    clusters.forEach(function (c) {
      var sorted = clusters.slice().sort(function (a, b) { return dist3(a.center, c.center) - dist3(b.center, c.center); });
      for (var j = 1; j <= WEB_KNN && j < sorted.length; j++) {
        var nb = sorted[j];
        var key = c.idx < nb.idx ? c.idx + '-' + nb.idx : nb.idx + '-' + c.idx;
        if (seen[key]) continue;
        seen[key] = 1;
        webLines.push({ a: c, b: nb });
        c.neighbors.push(nb.idx); nb.neighbors.push(c.idx);
      }
    });
    var maxStart = 0;
    clusters.forEach(function (c2) { maxStart = Math.max(maxStart, c2.bloomStart); });
    return { clusters: clusters, webLines: webLines, totalBloom: maxStart + BLOOM_DUR, R: FIELD_R };
  }

  /* ================= 发光纹理（锐利内核） ================= */
  function makeGlowFactory(T3) {
    var cache = {};
    return function (color) {
      var key = color.join(',');
      if (cache[key]) return cache[key];
      var c = document.createElement('canvas'); c.width = c.height = 64;
      var x = c.getContext('2d');
      var g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
      g.addColorStop(0, 'rgba(255,255,255,0.98)');
      g.addColorStop(0.14, 'rgba(' + color[0] + ',' + color[1] + ',' + color[2] + ',0.8)');
      g.addColorStop(0.34, 'rgba(' + color[0] + ',' + color[1] + ',' + color[2] + ',0.22)');
      g.addColorStop(1, 'rgba(' + color[0] + ',' + color[1] + ',' + color[2] + ',0)');
      x.fillStyle = g; x.fillRect(0, 0, 64, 64);
      cache[key] = new T3.CanvasTexture(c);
      return cache[key];
    };
  }
  /* ================= 引擎 ================= */
  function createEngine(host) {
    var seed = parseInt(host.getAttribute('seed'), 10) || 7;
    var membersPer = Math.min(10, Math.max(3, parseInt(host.getAttribute('members'), 10) || 6));
    var dustN = Math.min(160, Math.max(0, parseInt(host.getAttribute('dust'), 10) || 80));
    var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    var shadow = host.shadowRoot || host.attachShadow({ mode: 'open' });
    shadow.innerHTML =
      '<style>' +
      ':host{display:block;position:relative;width:100%;background:#04060c;border-radius:14px;overflow:hidden;contain:content;--cs-h:560px;height:var(--cs-h)}' +
      '.cs-fg{position:absolute;inset:0;z-index:1}' +
      '.cs-fg canvas{display:block;outline:none;cursor:grab}' +
      '.cs-dust{position:absolute;inset:0;z-index:2;pointer-events:none}' +
      '.cs-tip{position:absolute;z-index:5;pointer-events:none;opacity:0;transition:opacity .16s;background:rgba(9,14,28,.92);border:1px solid rgba(130,165,255,.38);border-radius:9px;padding:7px 10px;font:12px/1.65 system-ui,sans-serif;color:#cfe3ff;box-shadow:0 4px 18px rgba(0,0,0,.45);white-space:nowrap}' +
      '.cs-tip.on{opacity:1}' +
      '.cs-tip b{color:#9cc3ff;font-weight:600}' +
      '.cs-badge{position:absolute;right:11px;bottom:8px;z-index:4;font:11px/1.1 ui-monospace,Consolas,monospace;color:rgba(150,180,230,.5);pointer-events:none;user-select:none}' +
      '.cs-hint{position:absolute;left:12px;bottom:8px;z-index:4;font:11px/1.4 system-ui,sans-serif;color:rgba(150,180,230,.55);pointer-events:none;user-select:none;transition:opacity .8s}' +
      '.cs-hint.off{opacity:0}' +
      '.cs-err{position:absolute;inset:0;z-index:6;display:flex;align-items:center;justify-content:center;color:#8fa8d8;font:13px system-ui;padding:1rem;text-align:center}' +
      '</style>' +
      '<div class="cs-fg"></div>' +
      '<div class="cs-dust"></div>' +
      '<div class="cs-tip"></div>' +
      '<div class="cs-badge">弧长即时间 · t = ∫‖dγ‖</div>' +
      '<div class="cs-hint">拖动旋转 · 滚轮缩放 · 悬停意识点 · 点击点亮其簇</div>';

    var fgDiv = shadow.querySelector('.cs-fg');
    var dustDiv = shadow.querySelector('.cs-dust');
    var tip = shadow.querySelector('.cs-tip');
    var hint = shadow.querySelector('.cs-hint');
    var inner = null;

    function fail(msg) {
      var d = document.createElement('div');
      d.className = 'cs-err';
      d.textContent = '意识空间挂件加载失败：' + msg;
      shadow.appendChild(d);
    }

    window.__csDepsPromise.then(function () {
      try {
        if (!window.THREE) throw new Error('依赖未就绪（three）');
        inner = init();
      } catch (err) { fail(err && err.message ? err.message : String(err)); }
    }, function (e) { fail(e && e.message ? e.message : String(e)); });

    function init() {
      var T3 = window.THREE;
      var glowTex = makeGlowFactory(T3);
      var uni = buildField(seed, membersPer);
      var rngN = mulberry32((((seed >>> 0) || 7) ^ 0x5EED) >>> 0);

      var alive = true, running = false, rafId = 0;
      var T = 0, lastTS = 0;
      var state = { hoverCluster: -1, hiCluster: -1, hiTimer: 0 };

      /* ---------- 渲染器与相机 ---------- */
      var renderer = new T3.WebGLRenderer({ antialias: true, alpha: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      fgDiv.appendChild(renderer.domElement);
      var scene = new T3.Scene();
      var camera = new T3.PerspectiveCamera(55, 1, 0.1, 600);
      var R = uni.R;
      // 相机推近场内：点云铺满整个画布，边缘不留空（用户要求"遍布整个画布"）
      var yaw = 0.7, pitch = -0.3, dist = R * 1.7;
      var yawT = yaw, pitchT = pitch, distT = dist, autoRotate = !reduced;

      /* ---------- 宇宙网光丝（极细，几乎隐形）---------- */
      uni.webLines.forEach(function (wl) {
        var a = wl.a.center, b = wl.b.center;
        var mid = mix3(a, b, 0.5);
        var bow = 1.12 + (a[1] * b[2] - a[2] * b[1] > 0 ? 0.06 : -0.06); // 轻微外弓
        mid = [mid[0] * bow, mid[1] * bow, mid[2] * bow];
        var curve = new T3.QuadraticBezierCurve3(new T3.Vector3(a[0], a[1], a[2]), new T3.Vector3(mid[0], mid[1], mid[2]), new T3.Vector3(b[0], b[1], b[2]));
        var geo = new T3.BufferGeometry().setFromPoints(curve.getPoints(20));
        var mat = new T3.LineBasicMaterial({
          color: new T3.Color('rgb(' + CORE_COLOR.join(',') + ')'),
          transparent: true, opacity: 0.09, blending: T3.AdditiveBlending, depthWrite: false
        });
        var line = new T3.Line(geo, mat);
        wl.mat = mat; wl.baseOpacity = 0.09;
        scene.add(line);
      });

      /* ---------- 意识点精灵 ---------- */
      var registry = {};   // id → reg
      uni.clusters.forEach(function (cl) {
        cl.members.forEach(function (m) {
          var sm = new T3.SpriteMaterial({
            map: glowTex(cl.color), transparent: true, opacity: 0.8,
            blending: T3.AdditiveBlending, depthWrite: false
          });
          var sp = new T3.Sprite(sm);
          sp.scale.set(m.sz, m.sz, 1);
          sp.visible = false;
          scene.add(sp);
          var reg = {
            sprite: sp, mat: sm, baseScale: m.sz, member: m, cluster: cl.idx,
            hi: 1, tv: { mode: 'home' }, pos: [0, 0, 0], born: 0
          };
          registry[m.id] = reg;
          m.__reg = reg;
        });
      });

      /* ---------- 出访光丝池（点经过时光丝被点亮）---------- */
      var trailPool = [];
      for (var tp0 = 0; tp0 < TRAVEL_MAX; tp0++) {
        var tm = new T3.LineBasicMaterial({
          color: new T3.Color('rgb(160,215,255)'), transparent: true, opacity: 0,
          blending: T3.AdditiveBlending, depthWrite: false
        });
        var tl = new T3.Line(new T3.BufferGeometry().setFromPoints([new T3.Vector3(), new T3.Vector3(0.01, 0, 0), new T3.Vector3(0.02, 0, 0)]), tm);
        tl.visible = false;
        scene.add(tl);
        trailPool.push({ line: tl, mat: tm });
      }

      /* ---------- 相机控制（自写：拖动/滚轮/自转）---------- */
      var pointer = { x: 0, y: 0 }, downPt = null, dragged = false;
      var canvasEl = renderer.domElement;
      canvasEl.addEventListener('pointerdown', function (e) {
        downPt = { x: e.clientX, y: e.clientY, lx: e.clientX, ly: e.clientY };
        dragged = false; autoRotate = false; hint.classList.add('off');
        canvasEl.setPointerCapture && canvasEl.setPointerCapture(e.pointerId);
        canvasEl.style.cursor = 'grabbing';
      });
      canvasEl.addEventListener('pointermove', function (e) {
        var rect = canvasEl.getBoundingClientRect();
        pointer.x = e.clientX - rect.left; pointer.y = e.clientY - rect.top;
        if (downPt) {
          if (Math.abs(e.clientX - downPt.x) + Math.abs(e.clientY - downPt.y) > 7) dragged = true;
          yawT -= (e.clientX - downPt.lx) * 0.0052;
          pitchT -= (e.clientY - downPt.ly) * 0.0052;
          downPt.lx = e.clientX; downPt.ly = e.clientY;
          if (pitchT > 1.35) pitchT = 1.35;
          if (pitchT < -1.35) pitchT = -1.35;
        } else {
          updateHover();
        }
      });
      function endDrag() { downPt = null; canvasEl.style.cursor = 'grab'; }
      canvasEl.addEventListener('pointerup', function () {
        endDrag();
        if (!dragged) clickPick();
      });
      canvasEl.addEventListener('pointercancel', endDrag);
      canvasEl.addEventListener('pointerleave', function () { endDrag(); state.hoverCluster = -1; tip.classList.remove('on'); });
      canvasEl.addEventListener('wheel', function (e) {
        e.preventDefault();
        distT *= (1 + (e.deltaY > 0 ? 0.08 : -0.08));
        if (distT < R * 1.35) distT = R * 1.35;
        if (distT > R * 4.5) distT = R * 4.5;
      }, { passive: false });

      /* ---------- 屏幕空间拾取 ---------- */
      var v3 = new T3.Vector3();
      function project(p) {
        v3.set(p[0], p[1], p[2]).project(camera);
        if (v3.z > 1 || v3.z < 0) return null; // 相机背后的点不参与拾取
        return { x: (v3.x * 0.5 + 0.5) * (host.clientWidth || 1), y: (-v3.y * 0.5 + 0.5) * (host.clientHeight || 1) };
      }
      function pick() {
        var best = null, bd = 20 * 20;
        for (var id in registry) {
          var r0 = registry[id];
          if (r0.born <= 0.05) continue;
          var sc = project(r0.pos);
          if (!sc) continue;
          var dx = sc.x - pointer.x, dy = sc.y - pointer.y, d2 = dx * dx + dy * dy;
          if (d2 < bd) { bd = d2; best = r0; }
        }
        return best;
      }
      function updateHover() {
        var hit = pick();
        var ci = hit ? hit.cluster : -1;
        if (ci !== state.hoverCluster) {
          state.hoverCluster = ci;
          if (hit) {
            var cl = uni.clusters[ci];
            tip.innerHTML = '<b>意识点</b> · 簇 ' + (ci + 1) + '（' + cl.members.length + ' 点）' +
              '<br>与邻点几乎重叠（同一人）<br>绽开路程 t ≈ ' + cl.bloomStart.toFixed(1);
            tip.classList.add('on');
          } else tip.classList.remove('on');
        }
      }
      function clickPick() {
        var hit = pick();
        if (!hit) return;
        state.hiCluster = hit.cluster;
        clearTimeout(state.hiTimer);
        state.hiTimer = setTimeout(function () { state.hiCluster = -1; }, 2600);
      }

      /* ---------- 氛围尘埃（蓝系）---------- */
      if (window.tsParticles && dustN > 0 && !reduced) {
        window.tsParticles.load({
          element: dustDiv,
          options: {
            fullScreen: { enable: false }, fpsLimit: 30, detectRetina: true,
            particles: {
              number: { value: dustN, density: { enable: true, area: 900 } },
              color: { value: ['#7fb4ff', '#5a9bf0', '#a8ccff'] },
              size: { value: { min: 0.6, max: 2 } },
              opacity: { value: { min: 0.05, max: 0.22 } },
              move: { enable: true, speed: 0.22, direction: 'none', random: true, outModes: { default: 'bounce' } },
              links: { enable: false }
            }
          }
        }).catch(function () { /* 氛围层失败不影响主体 */ });
      }

      /* ---------- 出访（忽分忽合 · 点亮所经光丝）---------- */
      var travelCount = 0;
      var trailBusy = {};
      function grabTrail(id) {
        if (trailBusy[id]) return trailBusy[id];
        for (var i = 0; i < trailPool.length; i++) {
          if (!trailPool[i].owner) {
            trailPool[i].owner = id;
            trailBusy[id] = trailPool[i];
            return trailPool[i];
          }
        }
        return null;
      }
      function releaseTrail(id) {
        var t = trailBusy[id];
        if (t) { t.owner = null; t.line.visible = false; t.mat.opacity = 0; delete trailBusy[id]; }
      }
      function startTravel(reg, regId) {
        var home = uni.clusters[reg.cluster];
        var tries = 0, dest;
        do { dest = uni.clusters[(rngN() * uni.clusters.length) | 0]; }
        while (dest === home && ++tries < 6);
        if (dest === home) return;
        var trail = grabTrail(regId);
        reg.tv = {
          mode: 'go', t: 0,
          p0: [reg.pos[0], reg.pos[1], reg.pos[2]],
          mid: null, dur: 0,
          dest: dest, trail: trail,
          p2fn: function () { return dest.cur; }
        };
        travelCount++;
      }
      function stepTravel(reg, dt, regId) {
        var tv = reg.tv;
        if (tv.mode === 'go' || tv.mode === 'back') {
          if (!tv.mid) {
            var p2 = tv.p2fn();
            var push = 1.1 + rngN() * 0.25;
            var mid = mix3(tv.p0, p2, 0.5);
            tv.mid = [mid[0] * push, mid[1] * push, mid[2] * push];
            tv.dur = dist3(tv.p0, p2) / 7 + 0.3;
            if (tv.trail) {
              tv.trail.line.geometry.setFromPoints([
                new T3.Vector3(tv.p0[0], tv.p0[1], tv.p0[2]),
                new T3.Vector3(tv.mid[0], tv.mid[1], tv.mid[2]),
                new T3.Vector3(p2[0], p2[1], p2[2])
              ]);
              tv.trail.line.visible = true;
            }
          }
          tv.t += dt / tv.dur;
          var p2b = tv.p2fn();
          var pos = bezier3(tv.p0, tv.mid, p2b, Math.min(1, tv.t));
          reg.pos[0] = pos[0]; reg.pos[1] = pos[1]; reg.pos[2] = pos[2];
          if (tv.trail) tv.trail.mat.opacity = 0.5 * Math.sin(Math.PI * Math.min(1, Math.max(0, tv.t)));
          if (tv.t >= 1) {
            if (tv.mode === 'go') { tv.mode = 'visit'; tv.t = 0; tv.dur = 1.2 + rngN() * 2.4; tv.mid = null; }
            else {
              tv.mode = 'home'; tv.mid = null;
              releaseTrail(regId); travelCount--;
            }
          }
        } else if (tv.mode === 'visit') {
          tv.t += dt;
          var dd = tv.p2fn();
          reg.pos[0] += (dd[0] - reg.pos[0]) * Math.min(1, dt * 3);
          reg.pos[1] += (dd[1] - reg.pos[1]) * Math.min(1, dt * 3);
          reg.pos[2] += (dd[2] - reg.pos[2]) * Math.min(1, dt * 3);
          if (tv.t > tv.dur) {
            tv.mode = 'back'; tv.t = 0;
            tv.p0 = [reg.pos[0], reg.pos[1], reg.pos[2]];
            tv.mid = null;
            var home2 = uni.clusters[reg.cluster];
            tv.p2fn = function () { return home2.cur; };
          }
        }
      }

      /* ---------- 主循环 ---------- */
      function loop(ts) {
        if (!alive) return;
        rafId = 0;
        var dt = lastTS ? Math.min(0.05, (ts - lastTS) / 1000) : 0.016;
        lastTS = ts;
        if (running) {
          T += dt;
          if (autoRotate) yawT += 0.045 * dt;
          yaw += (yawT - yaw) * Math.min(1, dt * 8);
          pitch += (pitchT - pitch) * Math.min(1, dt * 8);
          dist += (distT - dist) * Math.min(1, dt * 6);
          camera.position.set(
            Math.cos(pitch) * Math.sin(yaw) * dist,
            Math.sin(pitch) * dist,
            Math.cos(pitch) * Math.cos(yaw) * dist
          );
          camera.lookAt(0, 0, 0);

          for (var ci = 0; ci < uni.clusters.length; ci++) {
            var cl = uni.clusters[ci];
            var kk = reduced ? 1 : (T - cl.bloomStart) / BLOOM_DUR;
            cl.k = kk <= 0 ? 0 : (kk >= 1 ? 1 : easeOutCubic(kk));
            var blooming = cl.k > 0 && cl.k < 1;
            var hiC = state.hiCluster === ci;

            for (var mi = 0; mi < cl.members.length; mi++) {
              var m0 = cl.members[mi], reg = m0.__reg;
              reg.born = cl.k;
              if (cl.k <= 0.02) { reg.sprite.visible = false; continue; }
              var tv = reg.tv;
              if (tv.mode === 'home') {
                if (reduced) {
                  reg.pos[0] = cl.center[0] + m0.off[0];
                  reg.pos[1] = cl.center[1] + m0.off[1];
                  reg.pos[2] = cl.center[2] + m0.off[2];
                } else if (blooming) {
                  // 绽开：原点 → 目标位（外弓贝塞尔 + 微旋），弧长即它的时间
                  var tgt = [cl.center[0] + m0.off[0], cl.center[1] + m0.off[1], cl.center[2] + m0.off[2]];
                  var mp = mix3([0, 0, 0], tgt, 0.55);
                  var lift = 1.18 + 0.1 * Math.sin(m0.breathe);
                  var midB = [mp[0] * lift, mp[1] * lift, mp[2] * lift];
                  var pb = bezier3([0, 0, 0], midB, tgt, cl.k);
                  reg.pos[0] = pb[0]; reg.pos[1] = pb[1]; reg.pos[2] = pb[2];
                } else {
                  // 簇内呼吸（忽分忽合）
                  var bs = Math.sin(T * 0.45 + m0.breathe) * m0.bAmp;
                  reg.pos[0] = cl.center[0] + m0.off[0] * (1 + bs) + 0.18 * Math.sin(T * 0.33 + m0.breathe * 1.7);
                  reg.pos[1] = cl.center[1] + m0.off[1] * (1 + bs * 0.8);
                  reg.pos[2] = cl.center[2] + m0.off[2] * (1 + bs) + 0.18 * Math.cos(T * 0.29 + m0.breathe);
                  // 出访决策
                  if (travelCount < TRAVEL_MAX && rngN() < dt * 0.028) startTravel(reg, m0.id);
                }
              } else {
                stepTravel(reg, dt, m0.id);
              }
              // 高亮插值（悬停簇 / 点击簇）
              var hiT = 1;
              if (state.hoverCluster >= 0) hiT = state.hoverCluster === ci ? 1.3 : 0.3;
              if (state.hiCluster >= 0) hiT = state.hiCluster === ci ? 1.45 : Math.min(hiT, 0.35);
              reg.hi += (hiT - reg.hi) * Math.min(1, dt * 9);
              var sc2 = reg.baseScale * (0.45 + 0.55 * cl.k) * (0.8 + 0.4 * Math.min(reg.hi, 1.5));
              reg.sprite.scale.set(sc2, sc2, 1);
              reg.mat.opacity = 0.8 * cl.k * (0.4 + 0.6 * Math.min(reg.hi, 1.5));
              reg.sprite.position.set(reg.pos[0], reg.pos[1], reg.pos[2]);
              reg.sprite.visible = true;
            }
          }

          /* 宇宙网：靠近原点的丝先亮；点击簇时其邻丝点亮 */
          uni.webLines.forEach(function (wl) {
            var hi = (state.hiCluster >= 0 && (wl.a.idx === state.hiCluster || wl.b.idx === state.hiCluster));
            var target = hi ? 0.5 : wl.baseOpacity;
            wl.mat.opacity += (target - wl.mat.opacity) * Math.min(1, dt * 7);
          });

          renderer.render(scene, camera);
          placeTip();
        }
        rafId = requestAnimationFrame(loop);
      }
      function placeTip() {
        if (!tip.classList.contains('on')) return;
        var w = host.clientWidth, h = host.clientHeight;
        tip.style.left = Math.min(Math.max(6, pointer.x + 14), w - 216) + 'px';
        tip.style.top = Math.min(Math.max(6, pointer.y - 10), h - 86) + 'px';
      }

      /* ---------- 尺寸 / 生命周期 ---------- */
      function resize() {
        var w = host.clientWidth, h = host.clientHeight;
        if (!w || !h) return;
        renderer.setSize(w, h);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
      }
      var ro = new ResizeObserver(resize);
      ro.observe(host);
      resize();

      var io = new IntersectionObserver(function (en) { setRunning(en[0].isIntersecting); }, { threshold: 0.05 });
      io.observe(host);
      function setRunning(v) {
        if (v === running || !alive) return;
        running = v;
        if (v) { lastTS = 0; schedule(); }
      }
      function onVis() { setRunning(!document.hidden); }
      document.addEventListener('visibilitychange', onVis);
      setRunning(true);

      function schedule() { if (!rafId && alive && running) rafId = requestAnimationFrame(loop); }
      schedule();

      host.__csDiag = {
        clusters: uni.clusters.length,
        webLines: uni.webLines.length,
        get T() { return T; },
        get running() { return running; },
        get bloomDone() { return T >= uni.totalBloom; },
        get travelers() { return travelCount; },
        get errors() { return (window.__csErrors || []).slice(0, 3); }
      };

      return {
        destroy: function () {
          alive = false;
          if (rafId) cancelAnimationFrame(rafId);
          ro.disconnect(); io.disconnect();
          document.removeEventListener('visibilitychange', onVis);
          try { renderer.dispose(); } catch (e) { /* noop */ }
        }
      };
    }

    return {
      destroy: function () { if (inner) { inner.destroy(); inner = null; } }
    };
  }

  /* ================= 注册 ================= */
  var CE = class extends HTMLElement {
    constructor() { super(); }
    connectedCallback() {
      if (this._ce) return;
      var h = parseFloat(this.getAttribute('height')) || 560;
      if (h < 480) h = 480; if (h > 640) h = 640;
      this.style.setProperty('--cs-h', h + 'px');
      this._ce = createEngine(this);
    }
    disconnectedCallback() { if (this._ce) { this._ce.destroy(); this._ce = null; } }
  };
  window.customElements.define('consciousness-space', CE);
})();
