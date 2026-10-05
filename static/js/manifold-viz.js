/*!
 * manifold-viz.js v1.0 — 高维意识流形 & 弧长分支模型（Consciousness Manifold & Arc-Length Branching）
 * ----------------------------------------------------------------------------
 * 自包含 Vanilla Web Component，零依赖（无 React / Three.js / p5 / CDN）。
 *
 * 数学概念 → 视觉映射：
 *   · 原点 O          —— 所有意识轨迹的公共根（世界坐标 (0,0,0)）
 *   · 时间 = 弧长      —— t = ∫‖γ′(τ)‖dτ：全局生长锋面 s(T)=v·T 匀速推进，
 *                         每条曲线绘制长度 = clamp(s − s₀, 0, len)，共享段同步生长
 *   · 分叉（多元宇宙） —— t₀ 处共享段结束，两条子曲线以微观张角 Δθ<0.01 rad
 *                         平滑分裂（Catmull-Rom 样条 + 持续弯曲偏置 → 宏观上分离）
 *
 * 用法（经 Hugo shortcode 或直接 HTML）：
 *   <consciousness-manifold height="520" seed="7"></consciousness-manifold>
 *   <script src="/js/manifold-viz.js" defer></script>
 *
 * 交互：拖动旋转（惯性）· 双击复位 · 悬停/轻点分支点查看 t₀ 与 Δθ
 * 无障碍：prefers-reduced-motion 时跳过生长动画与自动旋转；
 *          离屏（IntersectionObserver）与标签页隐藏时暂停渲染。
 * 性能：粒子预算 ≤ 260（流动 150 + 尘埃 110），DPR 钳制 ≤ 2，
 *        帧耗时超标时自动降档（关尘埃、减光晕）。
 */
(function () {
  'use strict';
  if (typeof window === 'undefined' || !('customElements' in window)) return;
  if (window.customElements.get('consciousness-manifold')) return;

  /* ================= 参数 ================= */
  var TAU = Math.PI * 2;
  var SEG = 0.45;                       // 弧长采样步长（世界单位）
  var DEPTH_MAX = 5;                    // 分叉层数（0..5 → 最多 63 条曲线）
  var GROW_V = 8.5;                     // 生长速度（弧长单位/秒）——即“时间流速”
  var N_FLOW = 150, N_DUST = 110;       // 粒子预算（合计 260 ≤ 1000）
  var DTHETA = [0.004, 0.0095];         // 初始分歧角（rad，恒 < 0.01：微观分歧）
  // 深度调色：共享主干淡青 → 蓝 → 靛 → 紫 → 琥珀（末端）
  var PALETTE = [
    [176, 226, 255],
    [92, 164, 255],
    [138, 128, 255],
    [182, 134, 255],
    [248, 178, 74],
    [255, 210, 128]
  ];
  var BG_INNER = 'rgba(13,20,38,0.55)', BG_OUTER = '#03050b';

  /* ================= 确定性随机 ================= */
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* ================= 3 维向量（仅生成期使用，小数组即可） ================= */
  function vlen(x, y, z) { return Math.sqrt(x * x + y * y + z * z); }
  function normalize3(v) {
    var l = vlen(v[0], v[1], v[2]) || 1;
    return [v[0] / l, v[1] / l, v[2] / l];
  }
  function randUnit3(r) {
    // Marsaglia 球面均匀采样
    var u = r(), v = r(), th = TAU * u, ph = Math.acos(2 * v - 1);
    return [Math.sin(ph) * Math.cos(th), Math.sin(ph) * Math.sin(th), Math.cos(ph)];
  }
  function cross3(a, b) {
    return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  }
  function mix3(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
  function dist3(a, b) { return vlen(a[0] - b[0], a[1] - b[1], a[2] - b[2]); }
  function rotAxis(v, k, ang) {
    // Rodrigues 旋转：v′ = v·cosθ + (k×v)·sinθ + k(k·v)(1−cosθ)，k 单位向量
    var c = Math.cos(ang), s = Math.sin(ang);
    var kxv0 = k[1] * v[2] - k[2] * v[1], kxv1 = k[2] * v[0] - k[0] * v[2], kxv2 = k[0] * v[1] - k[1] * v[0];
    var d = (k[0] * v[0] + k[1] * v[1] + k[2] * v[2]) * (1 - c);
    return [
      v[0] * c + kxv0 * s + k[0] * d,
      v[1] * c + kxv1 * s + k[1] * d,
      v[2] * c + kxv2 * s + k[2] * d
    ];
  }

  /* ================= 几何：弧长分支树 ================= */
  function buildTree(seed) {
    var rng = mulberry32((seed >>> 0) || 7);
    var branches = [], nodes = [];

    function genBranch(origin, dir0, len, depth, s0, biasAxis, biasSign) {
      var ncp = Math.max(5, Math.round(len / 2.8));     // 控制点数
      var step = len / ncp;
      var ctrl = [[origin[0], origin[1], origin[2]]];
      var d = normalize3(dir0);
      // 角速度轴做平滑随机游走 → 有机的蜿蜒（而非抖动）
      var av = normalize3(cross3(d, randUnit3(rng)));
      var wob = depth === 0 ? 0.085 : 0.13 + rng() * 0.12;   // rad/单位长度
      var biasRate = biasAxis ? 0.022 + rng() * 0.022 : 0;    // 分裂后的持续弯开
      var p = [origin[0], origin[1], origin[2]];
      for (var i = 0; i < ncp; i++) {
        av = normalize3(mix3(av, randUnit3(rng), 0.30));
        d = normalize3(rotAxis(d, av, wob * step * (0.55 + 0.9 * rng())));
        if (biasAxis) d = normalize3(rotAxis(d, biasAxis, biasSign * biasRate * step));
        // 水平外扩偏置：让树冠舒展、避免抱团
        var hl = vlen(p[0], 0, p[2]);
        if (hl > 2) d = normalize3(mix3(d, [p[0] / hl, 0, p[2] / hl], 0.02));
        p = [p[0] + d[0] * step, p[1] + d[1] * step, p[2] + d[2] * step];
        ctrl.push([p[0], p[1], p[2]]);
      }

      /* Catmull-Rom 均匀样条重采样到等距弧长点列 */
      var pts = [], cum = [], cl = 0, px = 0, py = 0, pz = 0, has = false;
      function pushPt(x, y, z) {
        if (has) cl += vlen(x - px, y - py, z - pz);
        pts.push(x, y, z); cum.push(cl);
        px = x; py = y; pz = z; has = true;
      }
      function P(i) { i = i < 0 ? 0 : (i > ctrl.length - 1 ? ctrl.length - 1 : i); return ctrl[i]; }
      for (var s = 0; s < ctrl.length - 1; s++) {
        var a = P(s - 1), b = P(s), c = P(s + 1), e = P(s + 2);
        var n = Math.max(2, Math.ceil(dist3(b, c) / SEG));
        for (var j = (s === 0 ? 0 : 1); j <= n; j++) {
          var t = j / n, t2 = t * t, t3 = t2 * t;
          pushPt(
            0.5 * (2 * b[0] + (-a[0] + c[0]) * t + (2 * a[0] - 5 * b[0] + 4 * c[0] - e[0]) * t2 + (-a[0] + 3 * b[0] - 3 * c[0] + e[0]) * t3),
            0.5 * (2 * b[1] + (-a[1] + c[1]) * t + (2 * a[1] - 5 * b[1] + 4 * c[1] - e[1]) * t2 + (-a[1] + 3 * b[1] - 3 * c[1] + e[1]) * t3),
            0.5 * (2 * b[2] + (-a[2] + c[2]) * t + (2 * a[2] - 5 * b[2] + 4 * c[2] - e[2]) * t2 + (-a[2] + 3 * b[2] - 3 * c[2] + e[2]) * t3)
          );
        }
      }
      return {
        pts: new Float32Array(pts), cum: new Float32Array(cum),
        n: pts.length / 3, len: cl, depth: depth, s0: s0,
        end: [p[0], p[1], p[2]], endDir: d,
        color: PALETTE[Math.min(depth, PALETTE.length - 1)],
        children: [], tipPhase: rng() * TAU,
        // 渲染缓存（每帧覆写）
        scr: new Float32Array(pts.length / 3 * 2)
      };
    }

    function rec(origin, dir, len, depth, s0, biasAxis, biasSign) {
      var b = genBranch(origin, dir, len, depth, s0, biasAxis, biasSign);
      b.idx = branches.length;
      branches.push(b);
      var earlyStop = depth >= 2 && depth < DEPTH_MAX && rng() < 0.12;
      if (depth < DEPTH_MAX && !earlyStop) {
        // 分支点 t₀：共享段在此结束，子曲线以微观张角 Δθ 分裂
        var dtheta = DTHETA[0] + rng() * (DTHETA[1] - DTHETA[0]);
        var axis = normalize3(cross3(b.endDir, randUnit3(rng)));
        nodes.push({
          p: [b.end[0], b.end[1], b.end[2]], t0: b.s0 + b.len,
          dtheta: dtheta, depth: depth + 1, axis: axis,
          phase: rng() * TAU, sx: -9999, sy: -9999, age: 0
        });
        var baseLen = len * 0.64;
        for (var sg = -1; sg <= 1; sg += 2) {
          var child = rec(b.end, normalize3(rotAxis(b.endDir, axis, sg * dtheta / 2)),
            baseLen * (0.86 + rng() * 0.28), depth + 1, b.s0 + b.len, axis, sg);
          b.children.push(child.idx);
        }
      }
      return b;
    }

    rec([0, 0, 0], normalize3([0.16, 1, 0.1]), 21, 0, 0, null, 0);

    /* 居中与包围球（原点移到下方，保留“生长”构图） */
    var maxY = 0, R = 1;
    for (var bi = 0; bi < branches.length; bi++) {
      var bb = branches[bi], P3 = bb.pts;
      for (var q = 0; q < P3.length; q += 3) {
        var y = P3[q + 1]; if (y > maxY) maxY = y;
      }
    }
    var cy = maxY * 0.52;
    for (var bi2 = 0; bi2 < branches.length; bi2++) {
      var bb2 = branches[bi2], P32 = bb2.pts;
      for (var q2 = 0; q2 < P32.length; q2 += 3) {
        P32[q2 + 1] -= cy;
        var r2 = P32[q2] * P32[q2] + P32[q2 + 1] * P32[q2 + 1] + P32[q2 + 2] * P32[q2 + 2];
        if (r2 > R * R) R = Math.sqrt(r2);
      }
      bb2.end[1] -= cy;
    }
    for (var nshift = 0; nshift < nodes.length; nshift++) nodes[nshift].p[1] -= cy; // 节点同步居中
    var maxLen = 0;
    for (var bi3 = 0; bi3 < branches.length; bi3++) maxLen = Math.max(maxLen, branches[bi3].s0 + branches[bi3].len);

    /* 粒子路径：根 → 随机终端（沿树下行，可停在任一末梢） */
    function randomPath() {
      var path = [0], cur = branches[0];
      while (cur.children.length) {
        var nx = cur.children[(rng() * cur.children.length) | 0];
        path.push(nx); cur = branches[nx];
      }
      return path;
    }
    function pathTotal(path) {
      var last = branches[path[path.length - 1]];
      return last.s0 + last.len;
    }
    var flows = [];
    for (var fi = 0; fi < N_FLOW; fi++) {
      var pa = randomPath();
      flows.push({ path: pa, total: pathTotal(pa), u: rng() * pathTotal(pa) * 0.85, v: 1.4 + rng() * 2.2, sz: 7 + rng() * 7, tw: rng() * TAU });
    }
    var dust = [];
    for (var di = 0; di < N_DUST; di++) {
      var u1 = rng(), v1 = rng(), th = TAU * u1, ph = Math.acos(2 * v1 - 1);
      var rr = R * (0.25 + 0.8 * Math.cbrt(rng()));
      dust.push({
        x: rr * Math.sin(ph) * Math.cos(th), y: rr * Math.sin(ph) * Math.sin(th) * 0.85, z: rr * Math.cos(ph),
        sz: 2.5 + rng() * 3.5, a: 0.05 + rng() * 0.11, tw: rng() * TAU, vs: (rng() - 0.5) * 0.06
      });
    }

    return { branches: branches, nodes: nodes, maxLen: maxLen, R: R, originY: -cy, flows: flows, dust: dust, pathTotal: pathTotal, randomPath: randomPath };
  }

  /* 沿弧长取点：二分查找 cum 表后线性插值 */
  function sampleAt(b, local, out) {
    var cum = b.cum, pts = b.pts, n = b.n;
    if (local <= 0) { out[0] = pts[0]; out[1] = pts[1]; out[2] = pts[2]; return; }
    if (local >= b.len) { out[0] = pts[(n - 1) * 3]; out[1] = pts[(n - 1) * 3 + 1]; out[2] = pts[(n - 1) * 3 + 2]; return; }
    var lo = 0, hi = n - 1;
    while (hi - lo > 1) { var mid = (lo + hi) >> 1; if (cum[mid] <= local) lo = mid; else hi = mid; }
    var span = cum[hi] - cum[lo] || 1, t = (local - cum[lo]) / span;
    var i0 = lo * 3;
    out[0] = pts[i0] + (pts[i0 + 3] - pts[i0]) * t;
    out[1] = pts[i0 + 1] + (pts[i0 + 4] - pts[i0 + 1]) * t;
    out[2] = pts[i0 + 2] + (pts[i0 + 5] - pts[i0 + 2]) * t;
  }

  /* ================= 预渲染发光精灵（避免每帧 shadowBlur） ================= */
  function makeSprite(r, g, b) {
    var c = document.createElement('canvas'); c.width = c.height = 64;
    var x = c.getContext('2d');
    var gr = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,0.9)');
    gr.addColorStop(0.18, 'rgba(' + (r | 0) + ',' + (g | 0) + ',' + (b | 0) + ',0.65)');
    gr.addColorStop(0.45, 'rgba(' + (r | 0) + ',' + (g | 0) + ',' + (b | 0) + ',0.16)');
    gr.addColorStop(1, 'rgba(' + (r | 0) + ',' + (g | 0) + ',' + (b | 0) + ',0)');
    x.fillStyle = gr; x.fillRect(0, 0, 64, 64);
    return c;
  }

  /* ================= 引擎 ================= */
  function createEngine(host) {
    var seed = parseInt(host.getAttribute('seed'), 10) || 7;
    var tree = buildTree(seed);

    var shadow = host.shadowRoot || host.attachShadow({ mode: 'open' });
    shadow.innerHTML =
      '<style>' +
      ':host{display:block;position:relative;width:100%;background:#04060c;border-radius:14px;overflow:hidden;contain:content;--mv-h:480px;height:var(--mv-h)}' +
      'canvas{display:block;width:100%;height:100%;cursor:grab;touch-action:none}' +
      '.mv-tip{position:absolute;pointer-events:none;opacity:0;transition:opacity .18s;background:rgba(9,14,28,.92);border:1px solid rgba(130,165,255,.38);border-radius:9px;padding:7px 10px;font:12px/1.65 system-ui,-apple-system,"Segoe UI",sans-serif;color:#cfe3ff;box-shadow:0 4px 18px rgba(0,0,0,.45);max-width:250px;white-space:nowrap;z-index:3}' +
      '.mv-tip b{color:#9cc3ff;font-weight:600}' +
      '.mv-tip.on{opacity:1}' +
      '.mv-badge{position:absolute;right:11px;bottom:8px;font:11px/1.1 ui-monospace,SFMono-Regular,Consolas,monospace;color:rgba(150,180,230,.5);pointer-events:none;user-select:none;z-index:2}' +
      '.mv-hint{position:absolute;left:12px;bottom:8px;font:11px/1.4 system-ui,sans-serif;color:rgba(150,180,230,.55);pointer-events:none;user-select:none;transition:opacity .8s;z-index:2}' +
      '.mv-hint.off{opacity:0}' +
      '</style>' +
      '<canvas aria-hidden="true"></canvas>' +
      '<div class="mv-tip"></div>' +
      '<div class="mv-badge">t&thinsp;=&thinsp;&int;&#8214;&gamma;&prime;(&tau;)&#8214;d&tau;</div>' +
      '<div class="mv-hint">拖动旋转 · 双击复位 · 悬停分支点</div>';

    var canvas = shadow.querySelector('canvas');
    var tip = shadow.querySelector('.mv-tip');
    var hint = shadow.querySelector('.mv-hint');
    var ctx = canvas.getContext('2d', { alpha: false });

    var sprites = PALETTE.map(function (c) { return makeSprite(c[0], c[1], c[2]); });
    var dustSprite = makeSprite(140, 165, 215);
    var whiteSprite = makeSprite(235, 242, 255);
    var rrng = mulberry32(((seed >>> 0) || 7) ^ 0x9E3779B9); // 运行期事件用（粒子重生等，保持可复现）

    /* 视图与状态 */
    var rmMedia = window.matchMedia('(prefers-reduced-motion: reduce)');
    var reduced = rmMedia.matches;
    var INIT_YAW = 0.55, INIT_PITCH = -0.38;
    var yaw = INIT_YAW, pitch = INIT_PITCH, vyaw = 0;
    var dragging = false, resetView = false, moved = 0, downT = 0, lastX = 0, lastY = 0;
    var hoverNode = -1, pinTimer = 0;
    var T = 0, lastTS = 0, rafId = 0, running = false, alive = true;
    var W = 0, H = 0, dpr = 1, cx = 0, cyS = 0, SS = 1, D = 1, vignette = null;
    var slowFrames = 0, lowFx = false, frameT = 0, frameN = 0;
    var pos = [0, 0, 0];
    var destroyed = false;

    var cy0 = Math.cos(yaw), sy0 = Math.sin(yaw), cx0 = Math.cos(pitch), sx0 = Math.sin(pitch);

    function applyHeight() {
      var h = parseFloat(host.getAttribute('height')) || 480;
      if (h < 200) h = 200; if (h > 1400) h = 1400;
      host.style.setProperty('--mv-h', h + 'px');
    }
    applyHeight();

    function resize() {
      var w = host.clientWidth, h = host.clientHeight;
      if (!w || !h) return;
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = w; H = h;
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
      cx = w / 2; cyS = h * 0.5;
      D = tree.R * 3.1;
      SS = 0.42 * Math.min(w, h) / tree.R;
      vignette = ctx.createRadialGradient(cx, h * 0.42, 0, cx, h * 0.5, Math.max(w, h) * 0.72);
      vignette.addColorStop(0, BG_INNER);
      vignette.addColorStop(1, BG_OUTER);
    }

    /* ---------- 投影 ---------- */
    function projectBegin() {
      cy0 = Math.cos(yaw); sy0 = Math.sin(yaw); cx0 = Math.cos(pitch); sx0 = Math.sin(pitch);
    }
    function project(x, y, z, o) {
      var x1 = x * cy0 + z * sy0, z1 = -x * sy0 + z * cy0;
      var y2 = y * cx0 - z1 * sx0, z2 = y * sx0 + z1 * cx0;
      var sc = SS * D / (D + z2);
      o[0] = cx + x1 * sc; o[1] = cyS - y2 * sc; o[2] = z2;
      o[3] = sc / SS; // 归一化深度因子（≈1，近大远小）
    }

    var scr2 = [0, 0, 0, 0];

    /* ---------- 主循环 ---------- */
    function frame(ts) {
      if (!alive) return;
      rafId = 0;
      var dt = lastTS ? Math.min(0.05, (ts - lastTS) / 1000) : 0.016;
      lastTS = ts;
      if (!running) { lastTS = 0; schedule(); return; }

      // 帧率自适应：连续重载则降档
      if (frameN > 90 && frameT / frameN > 22) lowFx = true;

      T += dt;
      if (!dragging) {
        if (resetView) {
          yaw += (INIT_YAW - yaw) * 0.14; pitch += (INIT_PITCH - pitch) * 0.14;
          if (Math.abs(INIT_YAW - yaw) < 0.01 && Math.abs(INIT_PITCH - pitch) < 0.01) resetView = false;
        } else if (!reduced) {
          yaw += 0.042 * dt;
        }
        yaw += vyaw * dt; vyaw *= Math.pow(0.06, dt); // 惯性衰减
      }
      if (pinTimer > 0) { pinTimer -= dt; if (pinTimer <= 0 && hoverNode >= 0) { hoverNode = -1; tip.classList.remove('on'); } }

      render(dt);
      schedule();
    }
    function schedule() { if (!rafId && alive) rafId = requestAnimationFrame(frame); }

    function render(dt) {
      if (!W) return;
      var s = reduced ? tree.maxLen : Math.min(T * GROW_V, tree.maxLen);
      var done = s >= tree.maxLen - 0.001;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = vignette || '#04060c';
      ctx.fillRect(0, 0, W, H);
      ctx.globalCompositeOperation = 'lighter';
      ctx.lineJoin = 'round'; ctx.lineCap = 'round';

      projectBegin();
      frameT += dt * 1000; frameN++;

      /* 尘埃背景（低帧率档位下关闭） */
      if (!lowFx) {
        var now = T;
        for (var di = 0; di < tree.dust.length; di++) {
          var du = tree.dust[di];
          project(du.x, du.y + Math.sin(du.tw + now * 0.22) * 1.2, du.z, scr2);
          if (scr2[3] <= 0 || scr2[3] > 4) continue;
          var ds = du.sz * (0.7 + 0.6 * scr2[3]);
          ctx.globalAlpha = du.a * (0.7 + 0.3 * Math.sin(du.tw + now * 1.7));
          ctx.drawImage(dustSprite, scr2[0] - ds / 2, scr2[1] - ds / 2, ds, ds);
        }
        ctx.globalAlpha = 1;
      }

      /* 曲线：光晕层 + 芯线层（加法混合天然无序绘制） */
      ctx.globalAlpha = 1;
      var branches = tree.branches;
      for (var bi = 0; bi < branches.length; bi++) {
        var b = branches[bi];
        var sl = s - b.s0;
        if (sl <= 0) continue;
        if (sl > b.len) sl = b.len;
        // 二分定位生长锋面所在的点索引
        var cum = b.cum, n = b.n, lo = 0, hi = n - 1;
        while (hi - lo > 1) { var mid = (lo + hi) >> 1; if (cum[mid] <= sl) lo = mid; else hi = mid; }
        var frac = (sl - cum[lo]) / ((cum[hi] - cum[lo]) || 1);
        var count = lo + 2; if (count > n) count = n;

        // 投影已生长段并累计深度
        var pts = b.pts, scr = b.scr, zSum = 0, i3, i2;
        for (var q = 0; q < count; q++) {
          i3 = q * 3; i2 = q * 2;
          var x = pts[i3], y = pts[i3 + 1], z = pts[i3 + 2];
          var x1 = x * cy0 + z * sy0, z1 = -x * sy0 + z * cy0;
          var y2 = y * cx0 - z1 * sx0, z2 = y * sx0 + z1 * cx0;
          var sc = SS * D / (D + z2);
          scr[i2] = cx + x1 * sc; scr[i2 + 1] = cyS - y2 * sc; zSum += z2;
        }
        // 锋面末点精确插值
        if (count < n && frac > 0) {
          i3 = lo * 3;
          var ex = pts[i3] + (pts[i3 + 3] - pts[i3]) * frac;
          var ey = pts[i3 + 1] + (pts[i3 + 4] - pts[i3 + 1]) * frac;
          var ez = pts[i3 + 2] + (pts[i3 + 5] - pts[i3 + 2]) * frac;
          project(ex, ey, ez, scr2);
          scr[count * 2 - 2] = scr2[0]; scr[count * 2 - 1] = scr2[1];
        }

        var zAvg = zSum / count;
        var tNear = (tree.R - zAvg) / (2 * tree.R); tNear = tNear < 0 ? 0 : (tNear > 1 ? 1 : tNear);
        var col = b.color, str = 'rgba(' + col[0] + ',' + col[1] + ',' + col[2] + ',';
        var alpha = 0.28 + 0.62 * tNear;

        // 光晕层
        ctx.beginPath();
        ctx.moveTo(scr[0], scr[1]);
        for (var q2 = 1; q2 < count; q2++) ctx.lineTo(scr[q2 * 2], scr[q2 * 2 + 1]);
        ctx.strokeStyle = str + (lowFx ? 0.04 : 0.07) * alpha + ')';
        ctx.lineWidth = (b.depth === 0 ? 9 : 6) * (0.8 + 0.5 * tNear);
        ctx.stroke();
        // 芯线层
        ctx.strokeStyle = str + (0.5 + 0.42 * tNear) + ')';
        ctx.lineWidth = 1.1 + 1.1 * tNear;
        ctx.stroke();
        if (b.depth === 0) { // 主干（公共段）加一层高亮
          ctx.strokeStyle = 'rgba(220,240,255,' + 0.06 * alpha + ')';
          ctx.lineWidth = 13;
          ctx.stroke();
        }

        // 生长锋面亮点
        if (!done && sl < b.len) {
          var hx = scr[count * 2 - 2], hy = scr[count * 2 - 1];
          var pulse = 0.75 + 0.25 * Math.sin(T * 6 + b.tipPhase);
          var hs = (13 + 5 * pulse) * (0.8 + 0.4 * tNear);
          ctx.globalAlpha = 0.85;
          ctx.drawImage(sprites[Math.min(b.depth, sprites.length - 1)], hx - hs / 2, hy - hs / 2, hs, hs);
          ctx.globalAlpha = 0.9;
          ctx.drawImage(whiteSprite, hx - 2.2, hy - 2.2, 4.4, 4.4);
        }
      }

      /* 分支节点：脉冲环 + 命中检测坐标 */
      var nodes = tree.nodes;
      for (var ni = 0; ni < nodes.length; ni++) {
        var nd = nodes[ni];
        if (s < nd.t0 - 0.01) { nd.sx = -9999; nd.age = 0; continue; }
        nd.age = Math.min(1, (s - nd.t0) / 1.6 + 0.15);
        project(nd.p[0], nd.p[1], nd.p[2], scr2);
        nd.sx = scr2[0]; nd.sy = scr2[1];
        var pu = 0.5 + 0.5 * Math.sin(T * 2 + nd.phase);
        var ringR = (4 + 3 * pu) * (0.85 + 0.35 * scr2[3]) * nd.age;
        var ncol = PALETTE[Math.min(nd.depth, PALETTE.length - 1)];
        ctx.globalAlpha = (0.3 + 0.4 * pu) * nd.age;
        ctx.strokeStyle = 'rgba(' + ncol[0] + ',' + ncol[1] + ',' + ncol[2] + ',0.9)';
        ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.arc(nd.sx, nd.sy, ringR, 0, TAU); ctx.stroke();
        ctx.globalAlpha = 0.9 * nd.age;
        ctx.drawImage(sprites[Math.min(nd.depth, sprites.length - 1)], nd.sx - 4.5, nd.sy - 4.5, 9, 9);
        if (hoverNode === ni) { // 悬停高亮环
          ctx.globalAlpha = 0.8;
          ctx.strokeStyle = 'rgba(255,255,255,0.85)';
          ctx.lineWidth = 1;
          ctx.beginPath(); ctx.arc(nd.sx, nd.sy, ringR + 5, 0, TAU); ctx.stroke();
        }
      }

      /* 流动粒子：沿轨迹的“意识状态”，生长期骑在锋面上 */
      var flows = tree.flows;
      for (var fi = 0; fi < flows.length; fi++) {
        var f = flows[fi];
        f.u += f.v * dt;
        if (f.u > s) {
          if (f.total <= s) { // 该路径已全长成 → 正常循环
            if (f.u > f.total) { var np = tree.randomPath(); f.path = np; f.total = tree.pathTotal(np); f.u = rrng() * 2; }
          } else f.u = s;    // 骑锋面
        }
        var ue = f.u < f.total ? f.u : f.total - 0.001;
        // 定位 ue 所在分支
        var pa = f.path, fb = null;
        for (var pi = 0; pi < pa.length; pi++) {
          var cand = tree.branches[pa[pi]];
          if (ue >= cand.s0 && ue <= cand.s0 + cand.len) { fb = cand; break; }
          if (cand.s0 > ue) break;
        }
        if (!fb) fb = tree.branches[pa[0]];
        sampleAt(fb, ue - fb.s0, pos);
        project(pos[0], pos[1], pos[2], scr2);
        var twk = 0.6 + 0.4 * Math.sin(f.tw + T * 3.1);
        var fsz = f.sz * (0.85 + 0.3 * twk) * scr2[3];
        ctx.globalAlpha = (0.3 + 0.55 * twk) * (0.5 + 0.5 * (tree.R - scr2[2]) / (2 * tree.R));
        ctx.drawImage(sprites[Math.min(fb.depth, sprites.length - 1)], scr2[0] - fsz / 2, scr2[1] - fsz / 2, fsz, fsz);
      }

      /* 原点 O 标记 */
      project(0, tree.originY, 0, scr2);
      ctx.globalAlpha = 0.55;
      ctx.strokeStyle = 'rgba(190,215,255,0.8)';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(scr2[0], scr2[1], 3.4, 0, TAU); ctx.stroke();
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = 'rgba(190,215,255,0.62)';
      ctx.font = '600 12px ui-monospace, Consolas, monospace';
      ctx.fillText('O', scr2[0] - 16, scr2[1] + 4);
      ctx.globalCompositeOperation = 'lighter';

      ctx.globalAlpha = 1;

      /* 悬停 tooltip 跟随 */
      if (hoverNode >= 0 && hoverNode < nodes.length) {
        var hn = nodes[hoverNode];
        if (hn.sx < -999) { tip.classList.remove('on'); }
        else {
          tip.style.left = Math.min(Math.max(8, hn.sx + 14), W - 210) + 'px';
          tip.style.top = Math.max(8, hn.sy - 14) + 'px';
        }
      }
    }

    /* ---------- 交互 ---------- */
    function nodeAt(x, y) {
      var best = -1, bd = 18 * 18;
      var rect = canvas.getBoundingClientRect();
      var mx = x - rect.left, my = y - rect.top;
      var nodes = tree.nodes;
      for (var i = 0; i < nodes.length; i++) {
        var dx = nodes[i].sx - mx, dy = nodes[i].sy - my;
        var d2 = dx * dx + dy * dy;
        if (d2 < bd) { bd = d2; best = i; }
      }
      return best;
    }
    function showTip(i) {
      var n = tree.nodes[i];
      tip.innerHTML =
        '<b>分支点 · t<sub>0</sub> = ' + n.t0.toFixed(1) + '</b><br>' +
        'Δθ = ' + n.dtheta.toFixed(4) + ' rad（微观分歧 &lt; 0.01）<br>' +
        '深度 ' + n.depth + ' · 此前轨迹完全重合';
      tip.classList.add('on');
    }
    function onDown(e) {
      canvas.setPointerCapture && canvas.setPointerCapture(e.pointerId);
      dragging = true; moved = 0; downT = performance.now();
      lastX = e.clientX; lastY = e.clientY; vyaw = 0; resetView = false;
      canvas.style.cursor = 'grabbing';
      hint.classList.add('off');
      hideTip();
    }
    function onMove(e) {
      if (dragging) {
        var dx = e.clientX - lastX, dy = e.clientY - lastY;
        moved += Math.abs(dx) + Math.abs(dy);
        lastX = e.clientX; lastY = e.clientY;
        var k = 0.0052;
        yaw += dx * k;
        pitch += dy * k;
        if (pitch > 1.35) pitch = 1.35;
        if (pitch < -1.35) pitch = -1.35;
        vyaw = dx * k * 60 * 0.5;
      } else if (e.pointerType === 'mouse') {
        var i = nodeAt(e.clientX, e.clientY);
        if (i !== hoverNode) {
          hoverNode = i;
          if (i >= 0) { showTip(i); canvas.style.cursor = 'pointer'; }
          else { hideTip(); canvas.style.cursor = 'grab'; }
        }
      }
    }
    function onUp(e) {
      if (!dragging) return;
      dragging = false;
      canvas.style.cursor = 'grab';
      if (moved < 7 && performance.now() - downT < 350) { // 轻点 = 查看节点
        var i = nodeAt(e.clientX, e.clientY);
        if (i >= 0) { hoverNode = i; showTip(i); pinTimer = 2.6; }
      }
    }
    function hideTip() { tip.classList.remove('on'); if (pinTimer <= 0) hoverNode = -1; }
    function onCancel() { dragging = false; canvas.style.cursor = 'grab'; }
    function onLeave() { if (!dragging) { hideTip(); canvas.style.cursor = 'grab'; } }
    function onDbl() { if (!reduced) resetView = true; }

    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onCancel);
    canvas.addEventListener('pointerleave', onLeave);
    canvas.addEventListener('dblclick', onDbl);

    /* ---------- 可见性 / 尺寸 / 降级动画 ---------- */
    var io = new IntersectionObserver(function (en) {
      running = en[0].isIntersecting;
      if (running) { lastTS = 0; schedule(); }
    }, { threshold: 0.05 });
    io.observe(host);

    var ro = new ResizeObserver(resize);
    ro.observe(host);
    resize();

    function onVis() { if (document.hidden) running = false; else { running = true; lastTS = 0; schedule(); } }
    document.addEventListener('visibilitychange', onVis);

    function onRm(e) { reduced = e.matches; }
    rmMedia.addEventListener ? rmMedia.addEventListener('change', onRm) : rmMedia.addListener(onRm);

    schedule();

    /* ---------- 生命周期 ---------- */
    return {
      rebuild: function () {
        var ns = parseInt(host.getAttribute('seed'), 10) || 7;
        if (ns === seed) return;
        seed = ns; tree = buildTree(seed);
        T = 0; resize();
      },
      setHeight: applyHeight,
      destroy: function () {
        alive = false; destroyed = true;
        if (rafId) cancelAnimationFrame(rafId);
        io.disconnect(); ro.disconnect();
        document.removeEventListener('visibilitychange', onVis);
        canvas.removeEventListener('pointerdown', onDown);
        canvas.removeEventListener('pointermove', onMove);
        canvas.removeEventListener('pointerup', onUp);
        canvas.removeEventListener('pointercancel', onCancel);
        canvas.removeEventListener('pointerleave', onLeave);
        canvas.removeEventListener('dblclick', onDbl);
      }
    };
  }

  /* ================= 注册自定义元素 ================= */
  var CM = class extends HTMLElement {
    constructor() { super(); }
    connectedCallback() {
      if (this._engine) return;
      try { this._engine = createEngine(this); }
      catch (err) {
        var s = this.shadowRoot || this.attachShadow({ mode: 'open' });
        s.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;min-height:200px;color:#8fa8d8;font:13px system-ui;background:#04060c;border-radius:14px">意识流形动画加载失败（canvas 不可用）</div>';
      }
    }
    disconnectedCallback() { if (this._engine) { this._engine.destroy(); this._engine = null; } }
    static get observedAttributes() { return ['seed', 'height']; }
    attributeChangedCallback(n, o, v) {
      if (o == null || !this._engine) return;
      if (n === 'seed') this._engine.rebuild();
      else if (n === 'height') this._engine.setHeight();
    }
    regenerate(seed) { this.setAttribute('seed', seed); }
  };
  window.customElements.define('consciousness-manifold', CM);
})();
