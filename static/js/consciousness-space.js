/*!
 * consciousness-space.js v1.0 — 意识空间可视化挂件
 * ----------------------------------------------------------------------------
 * 模型（站点无打包链，纯 UMD/CDN，容器节点挂载，Shadow DOM 样式隔离）：
 *   · 原点 = 意识原初状态的参照点（起点，不特殊化）
 *   · 每个意识 = 空间一点；点间连续、无天然边界
 *   · 每条意识从原点画一条弧，弧长 = 它走过的"时间"（TubeGeometry 按弧长逐段生长）
 *   · 弧分叉：共享一段后在分支点以微小张角平滑拐向（Catmull-Rom，切向连续无跳变）
 *   · 张角极小的一簇 = 宏观上的"同一个人"：叶端密集域 = 几乎重叠的发光点云，
 *     由 d3 力永续微扰 → 忽分忽合
 *   · 空间连通：远端簇之间加弧形跨桥（可相遇、可互相到达）
 *
 * 技术栈（全部 CDN UMD，动态注入保序不阻塞首屏）：
 *   · three@0.150.1                   — TubeGeometry 逐段生长 + 发光精灵
 *   · 3d-force-graph@1 (vasturiano)   — 主体：节点/连线/弧(linkCurvature)/
 *                                       沿弧流动粒子(linkDirectionalParticles)/
 *                                       拖动旋转 + 滚轮缩放/悬停拾取
 *   · tsparticles@2                   — 氛围尘埃层（铺密集域的底）
 *
 * 用法：{{< consciousness-space height="560" seed="7" members="5" dust="60" >}}
 * 交互：拖动旋转 · 滚轮缩放 · 悬停意识点→高亮其簇 · 点击弧/点→高亮与主干共享段
 * 无障碍：prefers-reduced-motion → 静态帧（不生长、不流动、不自转）
 * 生命周期：IntersectionObserver 离屏暂停 + 标签页隐藏暂停（切回不崩）
 * 验收：页面可读 window.__csErrors（应恒为空数组）
 */
(function () {
  'use strict';
  if (typeof window === 'undefined' || !('customElements' in window)) return;
  if (window.customElements.get('consciousness-space')) return;

  /* 顶层错误捕获 */
  window.__csErrors = window.__csErrors || [];
  window.addEventListener('error', function (e) { window.__csErrors.push(String(e.message || e)); });
  window.addEventListener('unhandledrejection', function (e) { window.__csErrors.push('promise: ' + String(e.reason)); });

  /* ================= CDN 依赖（UMD，顺序动态注入，等价 defer 不阻塞） =================
   * 3d-force-graph 钉 1.73.6：1.80.x 的 UMD 有打包 bug（"Zz.Timer is not a constructor"，
   * 2026-10 实测），浮动 @1 会踩中。 */
  var CDN = [
    'https://cdn.jsdelivr.net/npm/three@0.150.1/build/three.min.js',
    'https://cdn.jsdelivr.net/npm/3d-force-graph@1.73.6/dist/3d-force-graph.min.js',
    'https://cdn.jsdelivr.net/npm/tsparticles@2.12.0/tsparticles.bundle.min.js'
  ];
  function loadScript(src) {
    return new Promise(function (res, rej) {
      var s = document.createElement('script');
      s.src = src; s.async = false; // 保序、异步、不阻塞解析
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
  var SEG = 0.5;                     // 弧长采样步长
  var LEVELS = 3;                    // 分叉层数 → 2^3 = 8 个密集域（簇）
  var BASE_LEN = [20, 13.5, 9.5];    // 各层弧长
  var GROW_V = 7.5;                  // 生长速度（弧长单位/秒）＝时间流速
  var DTHETA = [0.005, 0.0095];      // 分叉初始张角（rad，极小）
  var PALETTE = [[176, 226, 255], [92, 164, 255], [138, 128, 255]];
  var CLUSTER_COLORS = [
    [182, 134, 255], [248, 178, 74], [210, 150, 255], [255, 205, 120],
    [150, 160, 255], [250, 190, 110], [170, 200, 255], [240, 170, 90]
  ];
  var CROSS_COLOR = [120, 140, 200]; // 跨桥（空间连通）
  function rgb(c) { return 'rgb(' + c[0] + ',' + c[1] + ',' + c[2] + ')'; }

  /* ================= 工具（确定性随机 + 3 维向量） ================= */
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
  function randUnit3(r) {
    var u = r(), v = r(), th = TAU * u, ph = Math.acos(2 * v - 1);
    return [Math.sin(ph) * Math.cos(th), Math.sin(ph) * Math.sin(th), Math.cos(ph)];
  }
  function cross3(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
  function mix3(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
  function rotAxis(v, k, ang) {
    var c = Math.cos(ang), s = Math.sin(ang);
    var q0 = k[1] * v[2] - k[2] * v[1], q1 = k[2] * v[0] - k[0] * v[2], q2 = k[0] * v[1] - k[1] * v[0];
    var d = (k[0] * v[0] + k[1] * v[1] + k[2] * v[2]) * (1 - c);
    return [v[0] * c + q0 * s + k[0] * d, v[1] * c + q1 * s + k[1] * d, v[2] * c + q2 * s + k[2] * d];
  }

  /* ================= 宇宙生成：主干弧树 + 簇 + 跨桥 ================= */
  function buildUniverse(seed, membersPer) {
    var rng = mulberry32((seed >>> 0) || 7);
    var branches = [], joints = [], clusters = [];

    function genBranch(origin, dir0, len, depth, s0, biasAxis, biasSign) {
      var ncp = Math.max(5, Math.round(len / 2.8)), step = len / ncp;
      var ctrl = [[origin[0], origin[1], origin[2]]];
      var d = normalize3(dir0);
      var av = normalize3(cross3(d, randUnit3(rng)));
      var wob = depth === 0 ? 0.085 : 0.13 + rng() * 0.12;
      var biasRate = biasAxis ? 0.022 + rng() * 0.02 : 0;
      var p = [origin[0], origin[1], origin[2]];
      for (var i = 0; i < ncp; i++) {
        av = normalize3(mix3(av, randUnit3(rng), 0.3));
        d = normalize3(rotAxis(d, av, wob * step * (0.55 + 0.9 * rng())));
        if (biasAxis) d = normalize3(rotAxis(d, biasAxis, biasSign * biasRate * step));
        var hl = vlen(p[0], 0, p[2]);
        if (hl > 2) d = normalize3(mix3(d, [p[0] / hl, 0, p[2] / hl], 0.02));
        p = [p[0] + d[0] * step, p[1] + d[1] * step, p[2] + d[2] * step];
        ctrl.push([p[0], p[1], p[2]]);
      }
      var pts = [], cum = [], cl = 0, px = 0, py = 0, pz = 0, has = false;
      function push(x, y, z) {
        if (has) cl += vlen(x - px, y - py, z - pz);
        pts.push([x, y, z]); cum.push(cl); px = x; py = y; pz = z; has = true;
      }
      function P(i) { i = i < 0 ? 0 : (i > ctrl.length - 1 ? ctrl.length - 1 : i); return ctrl[i]; }
      for (var s = 0; s < ctrl.length - 1; s++) {
        var a = P(s - 1), b = P(s), c = P(s + 1), e = P(s + 2);
        var dd0 = vlen(c[0] - b[0], c[1] - b[1], c[2] - b[2]);
        var n = Math.max(2, Math.ceil(dd0 / SEG));
        for (var j = (s === 0 ? 0 : 1); j <= n; j++) {
          var t = j / n, t2 = t * t, t3 = t2 * t;
          push(
            0.5 * (2 * b[0] + (-a[0] + c[0]) * t + (2 * a[0] - 5 * b[0] + 4 * c[0] - e[0]) * t2 + (-a[0] + 3 * b[0] - 3 * c[0] + e[0]) * t3),
            0.5 * (2 * b[1] + (-a[1] + c[1]) * t + (2 * a[1] - 5 * b[1] + 4 * c[1] - e[1]) * t2 + (-a[1] + 3 * b[1] - 3 * c[1] + e[1]) * t3),
            0.5 * (2 * b[2] + (-a[2] + c[2]) * t + (2 * a[2] - 5 * b[2] + 4 * c[2] - e[2]) * t2 + (-a[2] + 3 * b[2] - 3 * c[2] + e[2]) * t3)
          );
        }
      }
      return { pts: pts, len: cl, depth: depth, s0: s0, end: p.slice(), endDir: d, color: PALETTE[Math.min(depth, PALETTE.length - 1)] };
    }

    function rec(origin, dir, len, depth, s0, biasAxis, biasSign, parentJoint) {
      var b = genBranch(origin, dir, len, depth, s0, biasAxis, biasSign);
      branches.push(b);
      var dtheta = DTHETA[0] + rng() * (DTHETA[1] - DTHETA[0]);
      var axis = normalize3(cross3(b.endDir, randUnit3(rng)));
      var joint = {
        id: 'j' + joints.length, role: depth === LEVELS - 1 ? 'centroid' : 'joint',
        p: b.end.slice(), s0: s0 + b.len, dtheta: dtheta, depth: depth + 1,
        parent: parentJoint
      };
      joints.push(joint);
      if (depth < LEVELS - 1) {
        for (var sg = -1; sg <= 1; sg += 2) {
          rec(b.end, normalize3(rotAxis(b.endDir, axis, sg * dtheta / 2)),
            len * (0.64 + rng() * 0.1), depth + 1, s0 + b.len, axis, sg, joint);
        }
      } else {
        var ci = clusters.length;
        var col = CLUSTER_COLORS[ci % CLUSTER_COLORS.length];
        joint.cluster = 'c' + ci; joint.color = col;
        clusters.push({ id: 'c' + ci, centroid: joint, color: col, s0: s0 + b.len, members: [] });
      }
      return joint;
    }

    rec([0, 0, 0], normalize3([0.16, 1, 0.1]), BASE_LEN[0], 0, 0, null, 0, null);

    /* 居中 + 包围球 */
    var maxY = 0;
    branches.forEach(function (b) { b.pts.forEach(function (p) { if (p[1] > maxY) maxY = p[1]; }); });
    var cy = maxY * 0.52, R = 1;
    branches.forEach(function (b) {
      b.pts.forEach(function (p) { p[1] -= cy; var r2 = p[0] * p[0] + p[1] * p[1] + p[2] * p[2]; if (r2 > R * R) R = Math.sqrt(r2); });
      b.end[1] -= cy;
    });
    joints.forEach(function (j) { j.p[1] -= cy; });
    var maxLen = 0;
    branches.forEach(function (b) { maxLen = Math.max(maxLen, b.s0 + b.len); });

    /* 簇成员：叶端近重叠点云（初始球状散布，之后交给力布局"忽分忽合"） */
    clusters.forEach(function (cl0) {
      for (var i = 0, m = Math.max(2, membersPer | 0); i < m; i++) {
        var u = rng(), v = rng(), th = TAU * u, ph = Math.acos(2 * v - 1);
        var rr = 1.0 + rng() * 1.4;
        cl0.members.push({
          id: 'm' + cl0.id + '_' + i, role: 'mind', cluster: cl0.id,
          color: cl0.color, s0: cl0.s0,
          x: cl0.centroid.p[0] + rr * Math.sin(ph) * Math.cos(th),
          y: cl0.centroid.p[1] + rr * Math.sin(ph) * Math.sin(th),
          z: cl0.centroid.p[2] + rr * Math.cos(ph)
        });
      }
    });

    /* 跨桥：空间连通 */
    var crossLinks = [];
    for (var k = 0; k < 3; k++) {
      var a1 = clusters[(rng() * clusters.length) | 0], a2 = clusters[(rng() * clusters.length) | 0];
      if (a1 !== a2) crossLinks.push({ from: a1.centroid.id, to: a2.centroid.id });
    }

    return { branches: branches, joints: joints, clusters: clusters, crossLinks: crossLinks, maxLen: maxLen, R: R, originY: -cy };
  }

  /* ================= 发光纹理 ================= */
  function makeGlowFactory(T3) {
    var cache = {};
    return function (color) {
      var key = color.join(',');
      if (cache[key]) return cache[key];
      var c = document.createElement('canvas'); c.width = c.height = 64;
      var x = c.getContext('2d');
      var g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
      g.addColorStop(0, 'rgba(255,255,255,0.95)');
      g.addColorStop(0.2, 'rgba(' + color[0] + ',' + color[1] + ',' + color[2] + ',0.7)');
      g.addColorStop(0.5, 'rgba(' + color[0] + ',' + color[1] + ',' + color[2] + ',0.16)');
      g.addColorStop(1, 'rgba(' + color[0] + ',' + color[1] + ',' + color[2] + ',0)');
      x.fillStyle = g; x.fillRect(0, 0, 64, 64);
      cache[key] = new T3.CanvasTexture(c);
      return cache[key];
    };
  }

  /* ================= 引擎 ================= */
  function createEngine(host) {
    var seed = parseInt(host.getAttribute('seed'), 10) || 7;
    var membersPer = Math.min(9, Math.max(2, parseInt(host.getAttribute('members'), 10) || 5));
    var dustN = Math.min(140, Math.max(0, parseInt(host.getAttribute('dust'), 10) || 60));
    var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    var shadow = host.shadowRoot || host.attachShadow({ mode: 'open' });
    shadow.innerHTML =
      '<style>' +
      ':host{display:block;position:relative;width:100%;background:#04060c;border-radius:14px;overflow:hidden;contain:content;--cs-h:560px;height:var(--cs-h)}' +
      '.cs-fg{position:absolute;inset:0;z-index:1}' +
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
      '<div class="cs-badge">s(t) = ∫‖dγ‖ · 弧长即时间</div>' +
      '<div class="cs-hint">拖动旋转 · 滚轮缩放 · 悬停意识点 · 点击弧看共享主干</div>';

    var fgDiv = shadow.querySelector('.cs-fg');
    var dustDiv = shadow.querySelector('.cs-dust');
    var tip = shadow.querySelector('.cs-tip');
    var hint = shadow.querySelector('.cs-hint');
    var inner = null; // init() 返回的真实引擎（销毁用）

    function fail(msg) {
      var d = document.createElement('div');
      d.className = 'cs-err';
      d.textContent = '意识空间挂件加载失败：' + msg;
      shadow.appendChild(d);
    }

    window.__csDepsPromise.then(function () {
      try {
        if (!window.THREE || !window.ForceGraph3D) throw new Error('依赖未就绪（three / 3d-force-graph）');
        inner = init();
      } catch (err) { fail(err && err.message ? err.message : String(err)); }
    }, function (e) { fail(e && e.message ? e.message : String(e)); });

    function init() {
      var T3 = window.THREE, Graph3D = window.ForceGraph3D;
      var glowTex = makeGlowFactory(T3);
      var uni = buildUniverse(seed, membersPer);
      var alive = true, running = false, T = 0, lastTS = 0, rafId = 0;
      var growS = reduced ? uni.maxLen : 0;   // 生长锋面（弧长 = 时间）
      var takeover = false, tFull = -1, tTake = 0;
      var state = { linksVisible: reduced, flowOn: false, hiLinks: null, hiTimer: 0, hoverCluster: null };
      var registry = {};   // nodeId → {obj, sprite, mat, baseScale, baseOpacity, node, hi}
      var rngN = mulberry32((((seed >>> 0) || 7) ^ 0x5EED) >>> 0);

      /* ---------- 弧：TubeGeometry 逐段生长 ---------- */
      var carrierGroup = new T3.Group();
      var tubes = [];
      uni.branches.forEach(function (b) {
        var vs = [];
        for (var i = 0; i < b.pts.length; i += 2) vs.push(new T3.Vector3(b.pts[i][0], b.pts[i][1], b.pts[i][2]));
        var curve = new T3.CatmullRomCurve3(vs);
        var tub = Math.max(24, Math.ceil(b.len * 5));
        var geo = new T3.TubeGeometry(curve, tub, 0.13 - b.depth * 0.022, 6, false);
        var mat = new T3.MeshBasicMaterial({
          color: new T3.Color(rgb(b.color)), transparent: true, opacity: 0.85,
          blending: T3.AdditiveBlending, depthWrite: false
        });
        var mesh = new T3.Mesh(geo, mat);
        geo.setDrawRange(0, 0);
        if (reduced) mesh.visible = false; // 静态帧用连线系统，管线不画
        carrierGroup.add(mesh);
        tubes.push({ b: b, curve: curve, mesh: mesh, mat: mat, tub: tub, radial: 6 });
      });
      /* 锋面亮点 + 沿弧流动粒子（curve.getPointAt = 弧长参数化） */
      var tipSprites = [], flowSprites = [];
      tubes.forEach(function (tb) {
        var sp = new T3.Sprite(new T3.SpriteMaterial({ map: glowTex(tb.b.color), transparent: true, opacity: 0.9, blending: T3.AdditiveBlending, depthWrite: false }));
        sp.scale.set(1.6, 1.6, 1); sp.visible = false;
        carrierGroup.add(sp); tipSprites.push({ tb: tb, sp: sp });
      });
      var rngF = mulberry32((((seed >>> 0) || 7) ^ 0xA5A5) >>> 0);
      for (var fi = 0; fi < 110; fi++) {
        var tb0 = tubes[(rngF() * tubes.length) | 0];
        var fs = new T3.Sprite(new T3.SpriteMaterial({ map: glowTex(tb0.b.color), transparent: true, opacity: 0.5 + rngF() * 0.35, blending: T3.AdditiveBlending, depthWrite: false }));
        fs.scale.set(0.9, 0.9, 1); fs.visible = false;
        carrierGroup.add(fs);
        flowSprites.push({ tb: tb0, sp: fs, u: rngF(), v: (2.2 + rngF() * 2.2) / tb0.b.len });
      }

      /* ---------- 节点 / 连线数据 ---------- */
      var nodes = [], links = [];
      nodes.push({ id: '__carrier', role: 'carrier', fx: 0, fy: 0, fz: 0 });
      nodes.push({ id: '__origin', role: 'origin', fx: 0, fy: uni.originY, fz: 0, s0: 0, t0: 0, dtheta: 0, depth: 0 });
      uni.joints.forEach(function (j) {
        nodes.push({
          id: j.id, role: j.role, s0: j.s0, t0: j.s0, dtheta: j.dtheta, depth: j.depth,
          cluster: j.cluster || null,
          color: j.color || PALETTE[Math.min(j.depth, PALETTE.length - 1)],
          fx: j.p[0], fy: j.p[1], fz: j.p[2],
          parentId: j.parent ? j.parent.id : '__origin'
        });
      });
      uni.clusters.forEach(function (cl0) {
        cl0.members.forEach(function (m) {
          nodes.push({
            id: m.id, role: 'mind', cluster: m.cluster, color: m.color, s0: m.s0, t0: m.s0,
            x: m.x, y: m.y, z: m.z, parentId: cl0.centroid.id
          });
          links.push({ source: cl0.centroid.id, target: m.id, kind: 'cloud', color: rgb(m.color), curv: 0.38, dist: 2.0, part: 0, w: 0.22 });
        });
      });
      nodes.forEach(function (n) {
        if ((n.role === 'joint' || n.role === 'centroid') && n.parentId) {
          var depthCol = PALETTE[Math.min(Math.max(n.depth - 1, 0), PALETTE.length - 1)];
          links.push({
            source: n.parentId, target: n.id, kind: 'arc', color: rgb(depthCol),
            curv: 0.16 * (n.id.charCodeAt(n.id.length - 1) % 2 ? 1 : -1),
            dist: 5, part: 2, w: 0.6, pid: n.parentId + '>' + n.id
          });
        }
      });
      uni.crossLinks.forEach(function (cl1, i) {
        links.push({ source: cl1.from, target: cl1.to, kind: 'cross', color: rgb(CROSS_COLOR), curv: 0.5, dist: 20, part: 1, w: 0.32, pid: 'x' + i });
      });

      /* ---------- 节点 3D 对象（发光点云精灵） ---------- */
      function labelTex(txt) {
        var c = document.createElement('canvas'); c.width = c.height = 64;
        var x = c.getContext('2d');
        x.font = '600 40px ui-monospace, Consolas, monospace';
        x.fillStyle = 'rgba(200,222,255,0.95)';
        x.textAlign = 'center'; x.textBaseline = 'middle';
        x.fillText(txt, 32, 34);
        return new T3.CanvasTexture(c);
      }
      function nodeObj(n) {
        if (n.role === 'carrier') return carrierGroup;
        var col = n.color || PALETTE[0], sz, op;
        if (n.role === 'mind') { sz = 1.35 + rngN() * 0.5; op = 0.85; }
        else if (n.role === 'centroid') { sz = 1.05; op = 0.7; }
        else if (n.role === 'origin') { sz = 1.35; op = 0.9; }
        else { sz = 0.65; op = 0.55; }
        var mat = new T3.SpriteMaterial({
          map: glowTex(n.role === 'origin' ? [200, 230, 255] : col),
          transparent: true, opacity: op, blending: T3.AdditiveBlending, depthWrite: false
        });
        var sp = new T3.Sprite(mat);
        sp.scale.set(sz, sz, 1);
        var g = sp;
        if (n.role === 'origin') {
          g = new T3.Group(); g.add(sp);
          var lb = new T3.Sprite(new T3.SpriteMaterial({ map: labelTex('O'), transparent: true, opacity: 0.8, depthWrite: false }));
          lb.scale.set(1.6, 1.6, 1); lb.position.set(-2.0, -0.3, 0);
          g.add(lb);
        }
        registry[n.id] = { obj: g, sprite: sp, mat: mat, baseScale: sz, baseOpacity: op, node: n, hi: 1 };
        g.visible = false;
        return g;
      }

      /* ---------- 3d-force-graph 主体 ---------- */
      var graph = new Graph3D()(fgDiv)
        .width(host.clientWidth || 640)
        .height(host.clientHeight || 480)
        .backgroundColor('rgba(0,0,0,0)')
        .nodeThreeObject(function (n) { return registry[n.id] ? registry[n.id].obj : nodeObj(n); })
        .nodeThreeObjectExtend(false)
        .linkVisibility(function (l) { return state.linksVisible; })
        .linkCurvature(function (l) { return l.curv; })
        .linkColor(function (l) { return state.hiLinks && state.hiLinks.indexOf(l.pid) >= 0 ? '#eaf3ff' : l.color; })
        .linkWidth(function (l) { return state.hiLinks && state.hiLinks.indexOf(l.pid) >= 0 ? 1.4 : l.w; })
        .linkOpacity(0.75)
        .linkDirectionalParticles(function (l) { return state.flowOn ? l.part : 0; })
        .linkDirectionalParticleWidth(function (l) { return state.hiLinks && state.hiLinks.indexOf(l.pid) >= 0 ? 2.2 : 1.25; })
        .linkDirectionalParticleSpeed(0.0075)
        .linkDirectionalParticleResolution(4)
        .linkDirectionalParticleColor(function (l) { return l.color; })
        .showNavInfo(false)
        .d3VelocityDecay(0.35);

      graph.graphData({ nodes: nodes, links: links });
      host.__csGraph = graph;   // 调试/验收句柄（graph2ScreenCoords 等）
      host.__csNodes = nodes;
      host.__csDiag = {
        pick: null, state: state, get growS() { return growS; }, get takeover() { return takeover; }, get running() { return running; },
        // 验收调试：强制跳到生长完成 + 接管（供自动化测试在 rAF 受限环境下推进状态）
        forceGrown: function () { growS = uni.maxLen; doTakeover(); }
      };
      graph.d3Force('charge').strength(-7).distanceMax(90);
      var lf = graph.d3Force('link');
      lf.distance(function (l) { return l.dist; }).strength(function (l) { return l.kind === 'cloud' ? 0.32 : 0.02; });
      if (!reduced) {
        // 永续微扰 → 簇忽分忽合（1.73.x 已移除 d3AlphaTarget，用 alpha 下限 + 不冷却替代）
        graph.d3AlphaMin(0.035);
        graph.cooldownTime(null);
      }

      graph.cameraPosition({ x: 0, y: uni.R * 0.42, z: uni.R * 2.75 });
      var ctl = graph.controls();
      if (ctl) {
        if (!reduced) { ctl.autoRotate = true; ctl.autoRotateSpeed = 0.55; }
        ctl.enableDamping = true;
      }
      setTimeout(function () { try { graph.zoomToFit(1100, 90); } catch (e) { /* noop */ } }, 350);

      /* ---------- 悬停 / 点击：自带拾取层（graph2ScreenCoords 最近点匹配） ---------- */
      var pointer = { x: 0, y: 0 };
      function pickNode(px, py) {
        if (!graph.graph2ScreenCoords) return null;
        var best = null, bd = 22 * 22;
        for (var i = 0; i < nodes.length; i++) {
          var n = nodes[i];
          if (n.role === 'carrier' || !revealed(n)) continue;
          var x = n.fx != null ? n.fx : n.x, y = n.fy != null ? n.fy : n.y, z = n.fz != null ? n.fz : n.z;
          var sc = graph.graph2ScreenCoords(x, y, z);
          var dx = sc.x - px, dy = sc.y - py, d2 = dx * dx + dy * dy;
        if (d2 < bd) { bd = d2; best = n; }
      }
      return best;
    }
      host.__csDiag.pick = pickNode;
      fgDiv.addEventListener('pointermove', function (e) {
        var r = fgDiv.getBoundingClientRect();
        pointer.x = e.clientX - r.left; pointer.y = e.clientY - r.top;
        if (downPt && (Math.abs(e.clientX - downPt.x) + Math.abs(e.clientY - downPt.y) > 7)) dragged = true;
        onHover(pickNode(pointer.x, pointer.y));
      });
      fgDiv.addEventListener('pointerleave', function () { onHover(null); });
      var downPt = null, dragged = false;
      fgDiv.addEventListener('pointerdown', function (e) { downPt = { x: e.clientX, y: e.clientY }; dragged = false; }, { passive: true });
      fgDiv.addEventListener('click', function () {
        if (dragged) return; // 拖拽旋转不触发拾取
        var n = pickNode(pointer.x, pointer.y);
        if (n) highlightPath(n);
      });
      function revealed(n) { return n.role === 'carrier' || n.role === 'origin' || (n.s0 != null && growS >= n.s0 - 0.01); }
      function onHover(n) {
        state.hoverCluster = n && n.cluster ? n.cluster : null;
        if (n) { tip.innerHTML = tipHTML(n); tip.classList.add('on'); canvasCursor('pointer'); }
        else { tip.classList.remove('on'); canvasCursor('grab'); }
      }
      function canvasCursor(c) {
        var cv0 = fgDiv.querySelector('canvas');
        if (cv0) cv0.style.cursor = c;
      }
      function tipHTML(n) {
        if (n.role === 'origin') return '<b>原点 O</b><br>参照点 · 所有意识由此出发';
        if (n.role === 'mind') return '<b>意识点</b> · 簇 ' + n.cluster.slice(1) + '<br>与邻点几乎重叠（同一人）<br>弧长 t ≈ ' + n.t0.toFixed(1);
        if (n.role === 'centroid') return '<b>密集域中心</b> · 簇 ' + n.cluster.slice(1) + '<br>宏观上的"一个人"';
        return '<b>分支点 · t₀ = ' + n.t0.toFixed(1) + '</b><br>Δθ = ' + n.dtheta.toFixed(4) + ' rad（微分歧）<br>此前轨迹完全重合';
      }
      function placeTip() {
        if (!tip.classList.contains('on')) return;
        var w = host.clientWidth, h = host.clientHeight;
        tip.style.left = Math.min(Math.max(6, pointer.x + 14), w - 200) + 'px';
        tip.style.top = Math.min(Math.max(6, pointer.y - 10), h - 96) + 'px';
      }

      /* ---------- 点击：高亮与主干共享的段（溯源链） ---------- */
      var byId = {};
      nodes.forEach(function (n) { byId[n.id] = n; });
      function highlightPath(n) {
        var ids = [], cur = n, guard = 0;
        while (cur && cur.parentId && guard++ < 40) {
          ids.push(cur.parentId + '>' + cur.id);
          cur = byId[cur.parentId];
        }
        if (!ids.length) return;
        state.hiLinks = ids;
        graph.refresh();
        clearTimeout(state.hiTimer);
        state.hiTimer = setTimeout(function () { state.hiLinks = null; graph.refresh(); }, 2600);
      }

      /* ---------- 氛围尘埃（tsparticles，铺密集域的底） ---------- */
      if (window.tsParticles && dustN > 0 && !reduced) {
        window.tsParticles.load({
          element: dustDiv,
          options: {
            fullScreen: { enable: false },
            fpsLimit: 30,
            detectRetina: true,
            particles: {
              number: { value: dustN, density: { enable: true, area: 900 } },
              color: { value: ['#8ea6e8', '#a78bfa', '#7c8fd0'] },
              size: { value: { min: 0.6, max: 2 } },
              opacity: { value: { min: 0.05, max: 0.22 } },
              move: { enable: true, speed: 0.22, direction: 'none', random: true, outModes: { default: 'bounce' } },
              links: { enable: false }
            }
          }
        }).catch(function () { /* 氛围层失败不影响主体 */ });
      }

      /* ---------- 主循环：生长 → 接管 ---------- */
      var v3 = new T3.Vector3();
      function loop(ts) {
        if (!alive) return;
        rafId = 0;
        var dt = lastTS ? Math.min(0.05, (ts - lastTS) / 1000) : 0.016;
        lastTS = ts;
        if (running) {
          T += dt;
          if (!reduced && !takeover) {
            growS = Math.min(GROW_V * T, uni.maxLen);
            if (growS >= uni.maxLen && tFull < 0) tFull = T;
            if (tFull >= 0 && T > tFull + 0.7) doTakeover();
          }
          for (var i = 0; i < tubes.length; i++) {
            var tb = tubes[i], sl = Math.min(Math.max(growS - tb.b.s0, 0), tb.b.len);
            var seg = Math.floor(sl / tb.b.len * tb.tub);
            tb.mesh.geometry.setDrawRange(0, seg * tb.radial * 6);
            tb.mesh.visible = sl > 0 && !reduced && !(takeover && T - tTake > 1.1);
          }
          for (var ti = 0; ti < tipSprites.length; ti++) {
            var tp = tipSprites[ti], tbp = tp.tb;
            var slp = Math.min(Math.max(growS - tbp.b.s0, 0), tbp.b.len);
            var growing = slp > 0 && slp < tbp.b.len && !takeover;
            tp.sp.visible = growing && !reduced;
            if (growing) { tbp.curve.getPointAt(slp / tbp.b.len, v3); tp.sp.position.copy(v3); }
          }
          /* 节点显现 + 簇点云弹入 + 悬停簇高亮（平滑插值，无需 refresh） */
          for (var key in registry) {
            var r0 = registry[key], n0 = r0.node;
            var vis = n0.s0 == null || growS >= n0.s0 - 0.02;
            if (n0.role === 'mind') {
              var born = vis ? Math.min(1, Math.max(0.001, (growS - n0.s0) / 1.2)) : 0;
              var pop = 1 - Math.pow(1 - born, 3);
              var hiT = (!state.hoverCluster || state.hoverCluster === n0.cluster) ? 1 : 0.22;
              r0.hi += (hiT - r0.hi) * Math.min(1, dt * 9);
              var sc = r0.baseScale * (0.4 + 0.6 * pop) * (0.75 + 0.45 * r0.hi);
              r0.sprite.scale.set(sc, sc, 1);
              r0.mat.opacity = r0.baseOpacity * pop * (0.35 + 0.75 * r0.hi);
            }
            r0.obj.visible = vis;
          }
          /* 沿弧流动：生长期骑锋面，接管后交给库粒子 */
          if (!reduced && !takeover) {
            for (var fi2 = 0; fi2 < flowSprites.length; fi2++) {
              var f0 = flowSprites[fi2];
              f0.u += f0.v * dt;
              var sLoc = Math.min(f0.u * f0.tb.b.len, growS - f0.tb.b.s0);
              if (sLoc < 0.05) { f0.sp.visible = false; if (sLoc < 0) f0.u = 0.001; continue; }
              if (sLoc >= f0.tb.b.len) { f0.u = 0.001; continue; }
              f0.tb.curve.getPointAt(Math.min(1, sLoc / f0.tb.b.len), v3);
              f0.sp.position.copy(v3);
              f0.sp.visible = true;
            }
          } else {
            for (var fi3 = 0; fi3 < flowSprites.length; fi3++) flowSprites[fi3].sp.visible = false;
          }
          /* 接管后管线整体淡出 */
          if (takeover) {
            var fade = Math.max(0, 1 - (T - tTake) / 1.1);
            for (var i2 = 0; i2 < tubes.length; i2++) tubes[i2].mat.opacity = 0.85 * fade;
            if (fade <= 0) carrierGroup.visible = false;
          }
          placeTip();
        }
        rafId = requestAnimationFrame(loop);
      }
      function doTakeover() {
        takeover = true; tTake = T;
        state.linksVisible = true; state.flowOn = !reduced;
        graph.refresh();
      }
      rafId = requestAnimationFrame(loop);

      /* ---------- 交互附属 ---------- */
      fgDiv.addEventListener('pointerdown', function () {
        hint.classList.add('off');
        if (ctl) ctl.autoRotate = false;
      }, { passive: true });

      /* ---------- 生命周期 ---------- */
      var ro = new ResizeObserver(function () {
        graph.width(host.clientWidth || 640).height(host.clientHeight || 480);
      });
      ro.observe(host);

      var io = new IntersectionObserver(function (en) { setRunning(en[0].isIntersecting); }, { threshold: 0.05 });
      io.observe(host);

      function setRunning(v) {
        if (v === running || !alive) return;
        running = v;
        try { v ? graph.resumeAnimation() : graph.pauseAnimation(); } catch (e) { /* noop */ }
        if (v) lastTS = 0;
      }
      function onVis() { setRunning(!document.hidden); }
      document.addEventListener('visibilitychange', onVis);
      setRunning(true);

      return {
        destroy: function () {
          alive = false;
          if (rafId) cancelAnimationFrame(rafId);
          ro.disconnect(); io.disconnect();
          document.removeEventListener('visibilitychange', onVis);
          try { graph._destructor && graph._destructor(); } catch (e) { /* noop */ }
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
