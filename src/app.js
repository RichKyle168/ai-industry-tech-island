(function () {
  'use strict';
  const D = window.ISLAND_DATA;
  const $ = (s, el) => (el || document).querySelector(s);
  const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pad2 = (n) => String(n).padStart(2, '0');
  const lerp = (a, b, t) => a + (b - a) * t;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const isMobile = () => window.innerWidth <= 760;
  const TYPE = { demo: '示範場域', leap: '躍昇計畫' };

  /* ───────── 資料索引 ───────── */
  const X = window.ISLAND_EXTRA || { islands: {}, buildings: {}, hub: {}, decor: [], taiwan: [] };
  D.islands.forEach((i) => { const e = X.islands[i.id]; if (e) Object.assign(i, { no: e.no, xy: e.xy, loc: e.loc, crew: e.crew }); });
  D.buildings.forEach((b) => Object.assign(b, X.buildings[b.id] || {}));
  Object.assign(D.hub, { xy: X.hub.xy, loc: X.hub.loc, crew: X.hub.crew });
  const CITY = { med: '台北', elec: '內湖', bio: '竹北', retail: '林口', semi: '新竹', tool: '台中', mob: '后里', svc: '花蓮', mach: '南投', metal: '鹿港', chem: '麥寮', food: '嘉義', tex: '台南', fast: '岡山', hub: '中央山脈' };
  const B = {}, I = {}, L = {};
  D.islands.forEach((i) => { I[i.id] = i; i.buildings = []; i.lineSet = new Set(); });
  D.buildings.forEach((b) => { B[b.id] = b; b.lines = []; I[b.island].buildings.push(b); });
  D.lines.forEach((l) => {
    L[l.id] = l;
    l.members.forEach((m) => { B[m].lines.push(l.id); I[B[m].island].lineSet.add(l.id); });
    l.islands = D.islands.filter((i) => l.members.some((m) => B[m].island === i.id)).map((i) => i.id);
  });
  const ISLES = D.islands.slice().sort((a, b) => a.no - b.no);
  const nDemo = D.buildings.filter((b) => b.type === 'demo').length;
  const nLeap = D.buildings.length - nDemo;
  $('#brandSub').textContent = `${ISLES.length} 座產業島・${D.buildings.length} 個 AI 場域・${D.lines.length} 條協作線`;

  /* ───────── WebGL ───────── */
  let gl3d = !!window.THREE;
  if (gl3d) {
    try { const c = document.createElement('canvas'); gl3d = !!(c.getContext('webgl2') || c.getContext('webgl')); } catch (e) { gl3d = false; }
  }
  if (!gl3d) { bootUIOnly(); return; }

  const THREE = window.THREE;
  const V3 = THREE.Vector3;
  const canvas = $('#scene');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  const lowPower = isMobile() || (navigator.hardwareConcurrency || 8) <= 4;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, lowPower ? 1.75 : 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0xcfeaf7, 300, 900);
  const camera = new THREE.PerspectiveCamera(32, 1, 1, 3000);

  /* ───────── 幾何工具 ───────── */
  function hash1(n) { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); }
  function rng(seed) { let s = (seed >>> 0) || 1; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); }
  function strHash(str) { let h = 2166136261; for (const ch of str) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
  const UP = new V3(0, 1, 0);
  const tmpC = new THREE.Color();

  function colorize(geo, fn) {
    let g = geo.index ? geo.toNonIndexed() : geo;
    g.deleteAttribute && g.getAttribute('uv') && g.deleteAttribute('uv');
    g.computeVertexNormals();
    const pos = g.attributes.position, nor = g.attributes.normal;
    const col = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i += 3) {
      fn(tmpC, nor.getY(i), (pos.getY(i) + pos.getY(i + 1) + pos.getY(i + 2)) / 3, i / 3, nor.getX(i), nor.getZ(i));
      for (let k = 0; k < 3; k++) { col[(i + k) * 3] = tmpC.r; col[(i + k) * 3 + 1] = tmpC.g; col[(i + k) * 3 + 2] = tmpC.b; }
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    return g;
  }
  function solid(geo, color, jitter) {
    const base = new THREE.Color(color); const j = jitter == null ? 0.035 : jitter;
    return colorize(geo, (c, ny, y, f) => { c.copy(base).multiplyScalar(1 + (hash1(f * 3.7 + base.r * 10) - 0.5) * 2 * j); });
  }
  function topSide(geo, top, side, jitter) {
    const t = new THREE.Color(top), s = new THREE.Color(side); const j = jitter == null ? 0.04 : jitter;
    return colorize(geo, (c, ny, y, f) => { c.copy(ny > 0.6 ? t : s).multiplyScalar(1 + (hash1(f * 1.3 + t.g * 7) - 0.5) * 2 * j); });
  }
  function place(geo, x, y, z, ry, sx, sy, sz, rx, rz) {
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rx || 0, ry || 0, rz || 0, 'YXZ'));
    geo.applyMatrix4(new THREE.Matrix4().compose(new V3(x, y, z), q, new V3(sx || 1, sy == null ? (sx || 1) : sy, sz == null ? (sx || 1) : sz)));
    return geo;
  }
  function fromTris(tris) {
    const p = new Float32Array(tris.length * 9); let o = 0;
    tris.forEach((t) => t.forEach((v) => { p[o++] = v[0]; p[o++] = v[1]; p[o++] = v[2]; }));
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(p, 3)); g.computeVertexNormals(); return g;
  }
  function prism(poly, depth) {
    const tris = [], n = poly.length, z0 = -depth / 2, z1 = depth / 2;
    for (let i = 1; i < n - 1; i++) tris.push([[poly[0][0], poly[0][1], z1], [poly[i][0], poly[i][1], z1], [poly[i + 1][0], poly[i + 1][1], z1]]);
    for (let i = 1; i < n - 1; i++) tris.push([[poly[0][0], poly[0][1], z0], [poly[i + 1][0], poly[i + 1][1], z0], [poly[i][0], poly[i][1], z0]]);
    for (let i = 0; i < n; i++) {
      const a = poly[i], b = poly[(i + 1) % n];
      tris.push([[a[0], a[1], z0], [b[0], b[1], z0], [b[0], b[1], z1]]);
      tris.push([[a[0], a[1], z0], [b[0], b[1], z1], [a[0], a[1], z1]]);
    }
    return fromTris(tris);
  }
  function merge(geos) {
    let n = 0; geos.forEach((g) => { n += g.attributes.position.count; });
    const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), col = new Float32Array(n * 3);
    let o = 0;
    geos.forEach((g) => {
      pos.set(g.attributes.position.array, o * 3); nor.set(g.attributes.normal.array, o * 3);
      if (g.attributes.color) col.set(g.attributes.color.array, o * 3); else col.fill(1, o * 3, (o + g.attributes.position.count) * 3);
      o += g.attributes.position.count;
    });
    const m = new THREE.BufferGeometry();
    m.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    m.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    m.setAttribute('color', new THREE.BufferAttribute(col, 3));
    m.computeBoundingSphere();
    return m;
  }
  const Box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
  const Cyl = (rt, rb, h, s) => new THREE.CylinderGeometry(rt, rb, h, s || 8, 1);
  const Sph = (r, w, h) => new THREE.SphereGeometry(r, w || 8, h || 6);
  const Cone = (r, h, s) => new THREE.ConeGeometry(r, h, s || 6, 1);

  /* ───────── 群島配置 ───────── */
  const CELL = 13.5, HW = Math.sqrt(3) * CELL, R = 11, RIN = R * Math.sqrt(3) / 2, G = 1.7;
  const cellsAll = D.islands.map((i) => i.xy).concat([D.hub.xy]);
  const cellPos = (c) => new V3(c[0], 0, c[1]);
  const TW = X.taiwan || [];
  const BOUNDS = (() => {
    const ps = cellsAll.map(cellPos);
    const xs = ps.map((p) => p.x).concat(TW.map((q) => q[0] - R)), zs = ps.map((p) => p.z).concat(TW.map((q) => q[1]));
    return { minX: Math.min(...xs) - R, maxX: Math.max(...xs) + R, minZ: Math.min(...zs) - R, maxZ: Math.max(...zs) + R };
  })();
  BOUNDS.w = BOUNDS.maxX - BOUNDS.minX; BOUNDS.d = BOUNDS.maxZ - BOUNDS.minZ;
  BOUNDS.cx = (BOUNDS.minX + BOUNDS.maxX) / 2; BOUNDS.cz = (BOUNDS.minZ + BOUNDS.maxZ) / 2;

  const dirAt = (deg, d) => [Math.cos(deg * Math.PI / 180) * d, Math.sin(deg * Math.PI / 180) * d];
  const SLOTS_B = [].concat(
    [-90, -30, -150, 30, 150, 90].map((a) => dirAt(a, 4.1)),
    [-60, -120, 0, 180, 60, 120].map((a) => dirAt(a, 7.0)),
    [-90, -30, -150, 30, 150].map((a) => dirAt(a, 8.1))
  );
  const PODIUM = [0, 6.9];
  const PATH_IN = 8.35, PATH_OUT = 9.3, PATH_MID = 8.85;

  const C = {
    sand: '#F2E0B6', sandSide: '#DDC28E', earth: '#A8805A', grass: '#8CC665', path: '#EDE6D6',
    wallDemo: '#FFF3E2', roofDemo: '#EE7F33', wallLeap: '#EEF3FA', roofLeap: '#2F6FD0', glass: '#7DB3E8',
    metal: '#AEB8C6', dark: '#3A4656', white: '#F8FAFC', red: '#E2483D', trunk: '#8A6243', wood: '#C99A62',
  };
  function grassFor(col) { return new THREE.Color(C.grass).lerp(new THREE.Color(col), 0.32).offsetHSL(0, 0.02, 0.04); }
  function cliffFor(col) { return new THREE.Color(C.earth).lerp(new THREE.Color(col), 0.22); }

  /* ───────── 材質 ───────── */
  const matIsland = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.92, metalness: 0 });
  const matWin = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.35, metalness: 0, emissive: new THREE.Color('#FFCF7A'), emissiveIntensity: 0 });
  const matGlow = new THREE.MeshBasicMaterial({ color: '#BFF3FF' });

  /* ───────── 建築 ───────── */
  function buildDemo(seed) {
    const r = rng(seed); const body = [], win = [];
    const w = 2.7, d = 2.0, h = 1.15 + r() * 0.35;
    body.push(place(solid(Box(w + 0.3, 0.12, d + 0.3), C.path), 0, 0.06, 0));
    body.push(place(solid(Box(w, h, d), C.wallDemo), 0, h / 2 + 0.1, 0));
    const tw = w / 3;
    for (let i = 0; i < 3; i++) {
      const g = colorize(prism([[-tw / 2, 0], [tw / 2, 0], [-tw / 2, 0.62]], d), (c, ny, y, f, nx) => {
        c.set(nx < -0.5 ? C.glass : C.roofDemo).multiplyScalar(1 + (hash1(f + i) - 0.5) * 0.06);
      });
      body.push(place(g, -w / 2 + tw / 2 + i * tw, h + 0.1, 0));
    }
    const chx = w / 2 - 0.35, chz = -d / 2 + 0.4;
    body.push(place(solid(Cyl(0.18, 0.22, 1.5, 7), '#B9C1CC'), chx, h + 0.85, chz));
    body.push(place(solid(Cyl(0.19, 0.19, 0.2, 7), C.red), chx, h + 1.35, chz));
    body.push(place(solid(Box(0.6, 0.78, 0.06), '#6A5240'), -0.55, 0.49, d / 2 + 0.03));
    // 小旗：示範場域
    body.push(place(solid(Cyl(0.035, 0.035, 1.1, 4), C.dark), -w / 2 + 0.15, h + 0.65, d / 2 - 0.15));
    body.push(place(solid(Box(0.55, 0.32, 0.03), '#FF8A3D', 0), -w / 2 + 0.45, h + 1.03, d / 2 - 0.15));
    win.push(place(solid(Box(0.5, 0.36, 0.06), C.glass, 0.02), 0.35, 0.75, d / 2 + 0.03));
    win.push(place(solid(Box(0.5, 0.36, 0.06), C.glass, 0.02), 0.95, 0.75, d / 2 + 0.03));
    return { body, win, top: h + 1.4 };
  }
  function buildLeap(seed) {
    const r = rng(seed); const body = [], win = [];
    const w = 1.9, d = 1.9, floors = 3 + Math.floor(r() * 2), fh = 0.78, h = floors * fh + 0.3;
    body.push(place(solid(Box(w + 0.4, 0.12, d + 0.4), C.path), 0, 0.06, 0));
    body.push(place(solid(Box(w, h, d), C.wallLeap), 0, h / 2 + 0.1, 0));
    for (let k = 0; k < floors; k++) win.push(place(solid(Box(w + 0.04, 0.3, d + 0.04), C.glass, 0.02), 0, 0.55 + k * fh + 0.1, 0));
    body.push(place(solid(Box(w + 0.22, 0.24, d + 0.22), C.roofLeap), 0, h + 0.22, 0));
    body.push(place(solid(Box(0.7, 0.34, 0.6), '#C5CDD8'), 0.3, h + 0.5, -0.2));
    body.push(place(solid(Cyl(0.04, 0.04, 1.0, 4), C.dark), -0.55, h + 0.84, 0.45));
    body.push(place(solid(Sph(0.11, 6, 4), C.red, 0), -0.55, h + 1.36, 0.45));
    body.push(place(solid(Box(0.55, 0.7, 0.06), '#4F6B8F'), 0, 0.45, d / 2 + 0.02));
    return { body, win, top: h + 1.5 };
  }
  function tree(r, x, z, tint) {
    const out = []; const s = 0.75 + r() * 0.55; const kind = r();
    const green = new THREE.Color(kind < 0.5 ? '#4E9A4A' : '#6DB35A').lerp(new THREE.Color(tint), 0.12).offsetHSL((r() - 0.5) * 0.03, 0, (r() - 0.5) * 0.06);
    out.push(place(solid(Cyl(0.12, 0.16, 0.6, 5), C.trunk), x, G + 0.3 * s, z, 0, s));
    if (kind < 0.55) {
      out.push(place(solid(Cone(0.85, 1.7, 6), green), x, G + (0.6 + 0.85) * s, z, r() * 6, s));
      out.push(place(solid(Cone(0.62, 1.2, 6), green.clone().offsetHSL(0, 0, 0.05)), x, G + (1.35 + 0.6) * s, z, r() * 6, s));
    } else {
      out.push(place(solid(new THREE.IcosahedronGeometry(0.85, 0), green), x, G + 1.25 * s, z, r() * 6, s));
    }
    return out;
  }

  /* ───────── 地標 ───────── */
  function landmark(id, col) {
    const b = [], w = [], y = G;
    const accent = new THREE.Color(col).offsetHSL(0, 0.1, -0.12).getStyle();
    const plaza = () => b.push(place(solid(Cyl(2.3, 2.4, 0.14, 6), C.path), 0, y + 0.07, 0));
    plaza();
    switch (id) {
      case 'elec': {
        b.push(place(solid(Box(1.7, 4.4, 1.7), '#2D3E5E'), 0, y + 2.3, 0));
        for (let k = 0; k < 5; k++) w.push(place(solid(Box(1.74, 0.12, 1.74), '#5FD3FF', 0), 0, y + 0.8 + k * 0.8, 0));
        b.push(place(solid(Cyl(0.05, 0.05, 1.2, 4), C.dark), 0, y + 5.1, 0));
        b.push(place(solid(Cyl(0.6, 0.15, 0.3, 10), '#DDE6F0'), 0, y + 5.6, 0, 0, 1, 1, 1, 0.6));
        b.push(place(solid(Box(1.1, 0.8, 1.1), '#3E5378'), 1.3, y + 0.5, 0.6));
        break;
      }
      case 'med': {
        b.push(place(solid(Box(3.2, 2.4, 2.2), C.white), 0, y + 1.3, 0));
        b.push(place(solid(Box(3.4, 0.2, 2.4), '#D9E2EC'), 0, y + 2.6, 0));
        for (let k = 0; k < 2; k++) w.push(place(solid(Box(3.24, 0.32, 2.24), '#9CC9EA', 0.02), 0, y + 0.95 + k * 0.85, 0));
        b.push(place(solid(Box(1.1, 0.34, 0.12), C.red, 0), 0, y + 3.35, 0));
        b.push(place(solid(Box(0.34, 1.1, 0.12), C.red, 0), 0, y + 3.35, 0));
        b.push(place(solid(Cyl(0.05, 0.05, 0.6, 4), C.dark), 0, y + 2.95, 0));
        break;
      }
      case 'retail': {
        b.push(place(solid(Box(3.0, 1.8, 2.0), '#FFF6E5'), 0, y + 1.0, 0));
        for (let k = 0; k < 6; k++) b.push(place(solid(Box(0.5, 0.08, 1.0), k % 2 ? '#FFFFFF' : '#E85B4A', 0), -1.25 + k * 0.5, y + 1.68, 1.35, 0, 1, 1, 1, 0.42));
        b.push(place(solid(Box(2.2, 0.6, 0.12), '#F6C46B'), 0, y + 2.2, 1.0));
        w.push(place(solid(Box(1.0, 0.9, 0.06), C.glass, 0.02), 0.6, y + 0.75, 1.02));
        b.push(place(solid(Box(0.6, 1.0, 0.06), '#7A5A40'), -0.7, y + 0.6, 1.02));
        break;
      }
      case 'semi': {
        b.push(place(solid(Box(1.4, 0.5, 0.9), '#6E7A8C'), 0, y + 0.3, 0));
        b.push(place(colorize(Cyl(2.0, 2.0, 0.2, 28), (c, ny, yy, f, nx, nz) => {
          c.set(Math.abs(nz) > 0.6 || Math.abs(ny) > 0.6 ? '#C9D4E8' : '#8E9BB2').multiplyScalar(1 + (hash1(f) - 0.5) * 0.06);
        }), 0, y + 2.6, 0, 0, 1, 1, 1, Math.PI / 2));
        const tile = ['#9C8CE8', '#7FB3E8', '#8ED6C1', '#B7A8F0'];
        for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
          b.push(place(solid(Box(0.7, 0.7, 0.06), tile[(i + j + 4) % 4], 0.02), i * 0.8, y + 2.6 + j * 0.8, 0.13));
        }
        break;
      }
      case 'bio': {
        b.push(place(solid(Cyl(0.9, 1.0, 0.4, 8), '#DDE8E4'), 0, y + 0.2, 0));
        for (let k = 0; k < 11; k++) {
          const a = k * 0.62, yy = y + 0.7 + k * 0.38;
          const p1 = [Math.cos(a) * 0.85, Math.sin(a) * 0.85], p2 = [-p1[0], -p1[1]];
          b.push(place(solid(Sph(0.2, 6, 4), '#2FA58A', 0), p1[0], yy, p1[1]));
          b.push(place(solid(Sph(0.2, 6, 4), '#F07C6A', 0), p2[0], yy, p2[1]));
          if (k % 2 === 0) b.push(place(solid(Cyl(0.06, 0.06, 1.7, 4), '#F5F1E4'), 0, yy, 0, -a, 1, 1, 1, 0, Math.PI / 2));
        }
        break;
      }
      case 'tool': {
        b.push(place(solid(Box(1.0, 1.2, 1.0), '#5E6B7D'), 0, y + 0.6, 0));
        const gear = [];
        gear.push(solid(Cyl(1.55, 1.55, 0.45, 18), '#9AA7B8'));
        for (let k = 0; k < 12; k++) { const a = k / 12 * Math.PI * 2; gear.push(place(solid(Box(0.42, 0.45, 0.5), '#8D9AAC'), Math.cos(a) * 1.72, 0, Math.sin(a) * 1.72, -a)); }
        gear.push(solid(Cyl(0.5, 0.5, 0.6, 10), '#6B788A'));
        gear.forEach((g) => b.push(place(g, 0, y + 2.9, 0, 0, 1, 1, 1, Math.PI / 2)));
        break;
      }
      case 'svc': {
        b.push(place(solid(Box(2.6, 0.3, 1.2), '#C9A6C2'), 0, y + 0.15, 0));
        b.push(place(solid(Box(0.14, 3.0, 0.14), '#8E6C8A'), -0.6, y + 1.6, 0, 0, 1, 1, 1, 0, -0.32));
        b.push(place(solid(Box(0.14, 3.0, 0.14), '#8E6C8A'), 0.6, y + 1.6, 0, 0, 1, 1, 1, 0, 0.32));
        const wh = []; wh.push(solid(new THREE.TorusGeometry(1.75, 0.09, 5, 24), '#F2F2F7'));
        for (let k = 0; k < 8; k++) {
          const a = k / 8 * Math.PI * 2;
          wh.push(place(solid(Box(0.05, 1.75, 0.05), '#F2F2F7'), Math.cos(a) * 0.87, Math.sin(a) * 0.87, 0, 0, 1, 1, 1, 0, a - Math.PI / 2));
          wh.push(place(solid(Box(0.42, 0.36, 0.36), ['#F28C38', '#8B6FE0', '#22A699', '#E85B9A'][k % 4], 0.02), Math.cos(a) * 1.75, Math.sin(a) * 1.75 - 0.22, 0));
        }
        wh.forEach((g) => b.push(place(g, 0, y + 3.0, 0)));
        break;
      }
      case 'metal': {
        b.push(place(solid(Cyl(0.9, 1.05, 0.4, 10), '#B9C3CF'), 0, y + 0.2, 0));
        b.push(place(solid(Cyl(0.36, 0.36, 2.6, 10), '#D4A373'), 0, y + 1.7, 0));
        b.push(place(solid(new THREE.TorusGeometry(0.9, 0.36, 8, 16, Math.PI), '#D4A373'), 0.9, y + 3.0, 0));
        b.push(place(solid(Cyl(0.4, 0.33, 0.5, 10), '#C08A5A'), 1.8, y + 2.85, 0));
        b.push(place(solid(Cyl(0.12, 0.12, 0.5, 6), '#E9EEF4'), 0.9, y + 4.45, 0)); b.push(place(solid(Box(1.2, 0.2, 0.3), '#E9EEF4'), 0.9, y + 4.72, 0, 0.5));
        b.push(place(solid(Cyl(0.16, 0.22, 2.1, 8), '#8FD3F5', 0), 1.8, y + 1.5, 0));
        b.push(place(solid(Cyl(0.7, 0.7, 0.12, 12), '#A8DCF2', 0), 1.8, y + 0.2, 0));
        break;
      }
      case 'mach': {
        b.push(place(solid(Cyl(0.9, 1.0, 0.5, 10), '#56606E'), 0, y + 0.25, 0));
        b.push(place(solid(Cyl(0.5, 0.6, 0.6, 10), '#F2A33A'), 0, y + 0.8, 0));
        b.push(place(solid(Box(0.55, 2.4, 0.55), '#F2A33A'), 0.45, y + 2.0, 0, 0, 1, 1, 1, 0, -0.35));
        b.push(place(solid(Sph(0.42, 8, 6), '#56606E'), 0.88, y + 3.1, 0));
        b.push(place(solid(Box(0.45, 2.0, 0.45), '#F2A33A'), 0.04, y + 3.64, 0, 0, 1, 1, 1, 0, 1.0));
        b.push(place(solid(Box(0.6, 0.3, 0.5), '#56606E'), -0.9, y + 4.15, 0, 0, 1, 1, 1, 0, 0.5));
        b.push(place(solid(Box(0.1, 0.45, 0.12), '#2E3540'), -1.12, y + 3.92, 0.16));
        b.push(place(solid(Box(0.1, 0.45, 0.12), '#2E3540'), -1.12, y + 3.92, -0.16));
        break;
      }
      case 'food': {
        b.push(place(solid(Cyl(0.95, 0.95, 3.2, 10), '#E9E2CF'), -0.6, y + 1.6, -0.2));
        b.push(place(solid(Cone(1.05, 0.9, 10), '#9AA4B0'), -0.6, y + 3.65, -0.2));
        for (let k = 0; k < 3; k++) b.push(place(solid(Cyl(0.97, 0.97, 0.1, 10), '#B9B19A'), -0.6, y + 0.8 + k * 0.9, -0.2));
        b.push(place(solid(Box(1.6, 1.2, 1.4), '#C8553D'), 1.0, y + 0.6, 0.6));
        b.push(place(solid(prism([[-0.9, 0], [0.9, 0], [0, 0.8]], 1.5), '#7A3A2E'), 1.0, y + 1.2, 0.6));
        b.push(place(solid(Box(0.5, 0.7, 0.06), '#F3E7D0'), 1.0, y + 0.4, 1.32));
        break;
      }
      case 'chem': {
        for (const [x, z] of [[-0.9, -0.3], [0.9, 0.4]]) {
          b.push(place(solid(Sph(0.95, 10, 8), '#E7ECF2'), x, y + 1.7, z));
          for (let k = 0; k < 4; k++) { const a = k * Math.PI / 2 + 0.78; b.push(place(solid(Cyl(0.06, 0.06, 1.2, 4), '#7C8796'), x + Math.cos(a) * 0.6, y + 0.6, z + Math.sin(a) * 0.6)); }
        }
        b.push(place(solid(Cyl(0.45, 0.45, 4.0, 10), '#F0B98A'), 0.3, y + 2.0, -1.1));
        for (let k = 0; k < 4; k++) b.push(place(solid(Cyl(0.5, 0.5, 0.1, 10), '#C98A5C'), 0.3, y + 0.8 + k * 0.9, -1.1));
        b.push(place(solid(Cyl(0.1, 0.1, 2.0, 5), '#7C8796'), 0, y + 2.2, 0.05, 0.4, 1, 1, 1, 0, Math.PI / 2));
        break;
      }
      case 'tex': {
        b.push(place(solid(Cyl(1.35, 1.35, 0.3, 14), '#B98A5E'), 0, y + 0.15, 0));
        b.push(place(colorize(Cyl(1.0, 1.0, 2.4, 14), (c, ny, yy) => { c.set(Math.floor((yy + 10) * 3.2) % 2 ? '#E15F78' : '#EE8296'); }), 0, y + 1.5, 0));
        b.push(place(solid(Cyl(1.35, 1.35, 0.3, 14), '#B98A5E'), 0, y + 2.85, 0));
        b.push(place(solid(Cyl(0.06, 0.02, 3.4, 5), '#C9D2DC'), 1.4, y + 2.2, 0.4, 0, 1, 1, 1, 0, -0.5));
        b.push(place(solid(new THREE.TorusGeometry(0.5, 0.05, 4, 12, Math.PI * 1.2), '#E15F78'), 1.1, y + 2.6, 0.4, 0, 1, 1, 1, 0, 0.6));
        break;
      }
      case 'fast': {
        b.push(place(solid(Cyl(0.55, 0.55, 2.8, 10), '#B4BCC8'), 0, y + 1.4, 0));
        for (let k = 0; k < 7; k++) b.push(place(solid(new THREE.TorusGeometry(0.58, 0.07, 4, 12), '#9AA4B2'), 0, y + 0.3 + k * 0.36, 0, 0, 1, 1, 1, Math.PI / 2 + 0.12));
        b.push(place(solid(Cyl(1.25, 1.25, 0.75, 6), '#C9B08A'), 0, y + 3.15, 0));
        b.push(place(solid(Cyl(0.85, 0.85, 0.5, 6), '#B79C72'), 1.6, y + 0.25, 0.9, 0.3));
        break;
      }
      case 'mob': {
        const fr = '#1D97B8', tire = '#2B3440';
        b.push(place(solid(new THREE.TorusGeometry(0.95, 0.12, 5, 18), tire), -1.2, y + 1.0, 0));
        b.push(place(solid(new THREE.TorusGeometry(0.95, 0.12, 5, 18), tire), 1.2, y + 1.0, 0));
        b.push(place(solid(Cyl(0.08, 0.08, 1.5, 5), fr), 0, y + 1.65, 0, 0, 1, 1, 1, 0, Math.PI / 2));
        b.push(place(solid(Cyl(0.08, 0.08, 1.6, 5), fr), -0.6, y + 1.3, 0, 0, 1, 1, 1, 0, 0.75));
        b.push(place(solid(Cyl(0.08, 0.08, 1.3, 5), fr), 0.6, y + 1.32, 0, 0, 1, 1, 1, 0, -0.9));
        b.push(place(solid(Cyl(0.08, 0.08, 1.1, 5), fr), 1.0, y + 1.55, 0, 0, 1, 1, 1, 0, -0.35));
        b.push(place(solid(Box(0.55, 0.14, 0.3), '#3A3A3A'), -0.75, y + 2.05, 0));
        b.push(place(solid(Box(0.1, 0.1, 0.9), '#3A3A3A'), 0.85, y + 2.15, 0));
        b.push(place(solid(Box(1.6, 0.1, 0.8), '#7CC4D9'), 0, y + 0.06, 0));
        break;
      }
      default: break;
    }
    return { body: b, win: w };
  }

  /* ───────── 建島 ───────── */
  const world = new THREE.Group(); scene.add(world);
  const hitMeshes = [];
  const BP = {}; // building id → { pos, top }
  const IP = {}; // island id → { center, podium, labelPos }
  const hitGeoB = new THREE.BoxGeometry(3, 4, 2.6);
  const hitGeoI = new THREE.CylinderGeometry(R, R, 2, 6);
  const hitMat = new THREE.MeshBasicMaterial({ visible: false });

  function buildIsland(isl, isHub) {
    const c = cellPos(isl.xy), col = isl.color || '#9FD3A8';
    const body = [], win = [];
    const r = rng(strHash(isl.id));
    body.push(place(topSide(Cyl(R * 1.06, R * 1.13, 1.1, 6), C.sand, C.sandSide), 0, -0.35, 0));
    body.push(place(topSide(Cyl(R * 1.13, R * 0.72, 3.2, 6), '#9C8A6A', '#7F7360'), 0, -2.5, 0));
    const gtop = grassFor(col), gside = cliffFor(col);
    body.push(place(topSide(Cyl(R, R * 1.015, 1.5, 6), gtop, gside), 0, 0.2 + 0.75, 0));
    // 環島步道
    const ring = new THREE.RingGeometry(PATH_IN / 0.866, PATH_OUT / 0.866, 6, 1, Math.PI / 6); ring.rotateX(-Math.PI / 2);
    body.push(place(solid(ring, '#EBDFC4', 0.015), 0, G + 0.03, 0));
    // 講台
    body.push(place(solid(Cyl(0.95, 1.05, 0.4, 6), C.wood), PODIUM[0], G + 0.2, PODIUM[1]));
    body.push(place(solid(Cyl(0.98, 0.98, 0.08, 6), new THREE.Color(col).offsetHSL(0, 0.05, -0.08)), PODIUM[0], G + 0.42, PODIUM[1]));
    const used = [];
    if (!isHub) {
      const lm = landmark(isl.id, col);
      body.push(...lm.body); win.push(...lm.win);
      isl.buildings.forEach((bd, k) => {
        const s = SLOTS_B[k]; used.push(k);
        const seed = strHash(bd.id);
        const ry = (hash1(seed % 1000) - 0.5) * 0.5;
        const m = bd.type === 'demo' ? buildDemo(seed) : buildLeap(seed);
        m.body.forEach((g) => body.push(place(g, s[0], G, s[1], ry)));
        m.win.forEach((g) => win.push(place(g, s[0], G, s[1], ry)));
        const wp = new V3(c.x + s[0], G, c.z + s[1]);
        BP[bd.id] = { pos: wp, top: wp.clone().setY(G + m.top) };
        const hm = new THREE.Mesh(hitGeoB, hitMat); hm.position.set(wp.x, G + 2, wp.z); hm.userData = { kind: 'b', id: bd.id }; world.add(hm); hitMeshes.push(hm);
      });
      SLOTS_B.forEach((s, k) => {
        if (used.includes(k)) return;
        const sc = k >= 12 ? 7.3 / 8.1 : 1;
        const n = 1 + Math.floor(r() * 2);
        for (let t = 0; t < n; t++) body.push(...tree(r, s[0] * sc + (r() - 0.5) * 1.0, s[1] * sc + (r() - 0.5) * 1.0, col));
      });
    } else {
      buildHub(body, win, col);
    }
    // 步道內側小樹（中樞島）
    for (let t = 0; t < (isHub ? 9 : 0); t++) {
      const a = r() * Math.PI * 2, d = 7.4 + r() * 0.4;
      const x = Math.cos(a) * d, z = Math.sin(a) * d;
      if (Math.hypot(x - PODIUM[0], z - PODIUM[1]) < 2.4) continue;
      if (!isHub && SLOTS_B.some((s, k) => used.includes(k) && Math.hypot(s[0] - x, s[1] - z) < 2.2)) continue;
      if (isHub && [[-5.2, 3.2], [5.2, 3.2], [0, -6.6]].some(([px, pz]) => Math.hypot(px - x, pz - z) < 2.4)) continue;
      body.push(...tree(r, x, z, col));
    }
    const mesh = new THREE.Mesh(merge(body), matIsland); mesh.castShadow = true; mesh.receiveShadow = true; mesh.position.copy(c); world.add(mesh);
    if (win.length) { const wm = new THREE.Mesh(merge(win), matWin); wm.castShadow = true; wm.position.copy(c); world.add(wm); }
    const hm = new THREE.Mesh(hitGeoI, hitMat); hm.position.set(c.x, G - 1, c.z); hm.userData = { kind: isHub ? 'hub' : 'i', id: isl.id }; world.add(hm); hitMeshes.push(hm);
    const gy = isHub ? G : G;
    IP[isl.id] = { center: c, podium: new V3(c.x + PODIUM[0], gy + 0.46, c.z + PODIUM[1]), label: new V3(c.x, isHub ? 17.5 : 9.2, c.z) };
  }

  const hubFx = {};
  function buildHub(body, win) {
    body.push(place(topSide(Cone(7.4, 5.2, 7), '#7DB66A', '#8E8270'), 0, G + 2.6, -0.6));
    body.push(place(solid(Cyl(1.3, 1.6, 0.6, 8), '#E9EEF4'), 0, G + 5.0, -0.6));
    body.push(place(colorize(Cyl(0.85, 1.25, 5.2, 10), (c, ny, yy) => { c.set(Math.floor(yy + 10) % 2 ? '#FFFFFF' : '#DCE6F2'); }), 0, G + 7.9, -0.6));
    win.push(place(solid(Cyl(0.95, 0.95, 1.1, 10), '#9FE6F5', 0), 0, G + 11.05, -0.6));
    body.push(place(solid(Cone(1.2, 1.0, 10), '#3B4A63'), 0, G + 12.1, -0.6));
    const pillarCols = D.hub.pillars.map((p) => p.color);
    [[-5.2, 3.2], [5.2, 3.2], [0, -6.6]].forEach(([x, z], k) => {
      body.push(place(solid(Box(1.6, 2.6 + k * 0.3, 1.6), C.white), x, G + 1.3 + k * 0.15, z));
      body.push(place(solid(Box(1.8, 0.35, 1.8), pillarCols[k]), x, G + 2.75 + k * 0.3, z));
      win.push(place(solid(Box(1.64, 0.3, 1.64), C.glass, 0.02), x, G + 1.6, z));
    });
    const orb = new THREE.Mesh(new THREE.IcosahedronGeometry(0.75, 2), new THREE.MeshBasicMaterial({ color: '#E8FDFF' }));
    hubFx.orbY = G + 13.4; hubFx.orb = orb;
    const rings = D.hub.pillars.map((p, k) => {
      const m = new THREE.Mesh(new THREE.TorusGeometry(1.5 + k * 0.32, 0.07, 6, 40), new THREE.MeshBasicMaterial({ color: p.color }));
      m.rotation.x = Math.PI / 2 + (k - 1) * 0.5; return m;
    });
    hubFx.rings = rings;
    const beam = new THREE.Mesh(new THREE.ConeGeometry(4.5, 26, 16, 1, true), new THREE.MeshBasicMaterial({ color: '#FFF6C8', transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }));
    beam.geometry.translate(0, -13, 0); beam.geometry.rotateZ(Math.PI / 2);
    hubFx.beam = beam;
  }

  ISLES.forEach((i) => buildIsland(i, false));
  const HUB = { id: 'hub', xy: D.hub.xy, color: '#9FD3A8', buildings: [] };
  buildIsland(HUB, true);
  (() => {
    const c = IP.hub.center; const g = new THREE.Group(); g.position.set(c.x, 0, c.z - 0.6);
    hubFx.orb.position.y = hubFx.orbY; g.add(hubFx.orb);
    hubFx.rings.forEach((m) => { m.position.y = hubFx.orbY; g.add(m); });
    hubFx.beam.position.y = G + 11.05; g.add(hubFx.beam);
    world.add(g); hubFx.group = g;
  })();

  /* ───────── 地理小島（山脈與岬角） ───────── */
  const DECOR = (X.decor || []).map((d) => {
    const r = rng(strHash(d.name)); const body = [];
    const c = new V3(d.xy[0], 0, d.xy[1]);
    body.push(place(topSide(Cyl(d.r * 1.05, d.r * 1.15, 1.1, 9), C.sand, C.sandSide), 0, -0.35, 0));
    body.push(place(topSide(Cyl(d.r * 0.9, d.r * 0.98, 1.0, 9), '#86BE62', '#9A7E5E'), 0, 0.7, 0));
    if (!d.lighthouse) {
      const rot = r() * 3;
      body.push(place(topSide(Cone(d.r * 0.85, d.h, 7), '#6FA35A', '#8C8272'), 0, 1.2 + d.h / 2, 0, rot));
      if (d.snow) body.push(place(solid(Cone(d.r * 0.85 * 0.36, d.h * 0.34, 7), '#F4F7FA', 0.02), 0, 1.2 + d.h - d.h * 0.17 + 0.05, 0, rot));
      else body.push(place(solid(Cone(d.r * 0.42, d.h * 0.42, 7), '#8C8C86'), d.r * 0.25, 1.2 + d.h * 0.42 / 2 + d.h * 0.25, -d.r * 0.2, r() * 3));
      for (let t = 0; t < 3; t++) { const a = t * 2.1 + r(); body.push(...tree(r, Math.cos(a) * d.r * 0.86, Math.sin(a) * d.r * 0.86, '#6FA35A').map((g) => place(g, 0, -G + 1.2, 0))); }
    } else {
      body.push(place(colorize(Cyl(0.55, 0.75, 3.4, 10), (cc, ny, yy) => { cc.set(Math.floor((yy + 10) * 1.6) % 2 ? '#FFFFFF' : '#E2483D'); }), 0, 1.2 + 1.7, 0));
      body.push(place(solid(Cone(0.7, 0.6, 10), '#3B4A63'), 0, 1.2 + 3.7, 0));
      for (let t = 0; t < 3; t++) { const a = r() * 6.28; body.push(...tree(r, Math.cos(a) * 2.6, Math.sin(a) * 2.6, '#6FA35A').map((g) => place(g, 0, -G + 1.2, 0))); }
    }
    const m = new THREE.Mesh(merge(body), matIsland); m.castShadow = true; m.receiveShadow = true; m.position.copy(c); world.add(m);
    return { name: d.name, pos: c, r: d.r, label: new V3(c.x, (d.lighthouse ? 6.5 : d.h + 2.8), c.z) };
  });

  /* ───────── 海 ───────── */
  const centers = cellsAll.map((c) => { const p = cellPos(c); return new THREE.Vector2(p.x, p.z); });
  const decorU = (DECOR.length ? DECOR : [{ pos: new V3(9999, 0, 9999), r: 1 }]).map((d) => new V3(d.pos.x, d.pos.z, d.r * 1.12));
  const polyA = TW.map((q) => new THREE.Vector2(q[0], q[1])), polyB = TW.map((q, i) => { const pq = TW[(i - 1 + TW.length) % TW.length]; return new THREE.Vector2(pq[0], pq[1]); });
  const waterU = {
    uTime: { value: 0 }, uDeep: { value: new THREE.Color('#2B8DB3') }, uShallow: { value: new THREE.Color('#5FD0D6') },
    uFoam: { value: new THREE.Color('#FFFFFF') }, uSky: { value: new THREE.Color('#CFEAF7') }, uSunDir: { value: new V3(0.4, 0.8, 0.3).normalize() },
    uSunColor: { value: new THREE.Color('#FFF4E0') }, uFogColor: { value: new THREE.Color('#CFEAF7') }, uFogNear: { value: 300 }, uFogFar: { value: 900 },
    uR: { value: R * 1.06 * Math.sqrt(3) / 2 }, uCenters: { value: centers }, uDecor: { value: decorU },
    uPA: { value: polyA }, uPB: { value: polyB }, uLagoon: { value: new THREE.Color('#7CD6C8') }, uSand: { value: new THREE.Color('#EADBB0') },
  };
  const water = new THREE.Mesh(
    (() => { const g = new THREE.PlaneGeometry(1600, 1600, 160, 160); g.rotateX(-Math.PI / 2); return g; })(),
    new THREE.ShaderMaterial({
      uniforms: waterU,
      vertexShader: `uniform float uTime; varying vec3 vW;
        void main(){ vec3 p=position; vec4 w0=modelMatrix*vec4(p,1.0);
          p.y += sin(w0.x*0.09+uTime*0.9)*0.12 + sin(w0.z*0.11-uTime*0.7)*0.1 + sin((w0.x+w0.z)*0.05+uTime*0.5)*0.12;
          vec4 w=modelMatrix*vec4(p,1.0); vW=w.xyz; gl_Position=projectionMatrix*viewMatrix*w; }`,
      fragmentShader: `uniform vec3 uDeep,uShallow,uFoam,uSky,uSunDir,uSunColor,uFogColor,uLagoon,uSand; uniform float uTime,uFogNear,uFogFar,uR; uniform vec2 uCenters[${centers.length}]; uniform vec3 uDecor[${decorU.length}]; uniform vec2 uPA[${Math.max(1, polyA.length)}]; uniform vec2 uPB[${Math.max(1, polyA.length)}]; varying vec3 vW;
        float sdPoly(vec2 p){ float d=1e9; float s=1.0;
          for(int i=0;i<${Math.max(1, polyA.length)};i++){ vec2 a=uPA[i], b=uPB[i]; vec2 e=b-a, w=p-a; vec2 q=w-e*clamp(dot(w,e)/dot(e,e),0.0,1.0); d=min(d,dot(q,q));
            bool c1=p.y>=a.y, c2=p.y<b.y, c3=e.x*w.y>e.y*w.x; if((c1&&c2&&c3)||(!c1&&!c2&&!c3)) s=-s; }
          return s*sqrt(d); }
        float hexd(vec2 p){ p=abs(p); return max(p.x, p.x*0.5+p.y*0.8660254); }
        float h21(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
        float nz(vec2 p){ vec2 i=floor(p),f=fract(p); f=f*f*(3.0-2.0*f); return mix(mix(h21(i),h21(i+vec2(1,0)),f.x),mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),f.x),f.y); }
        void main(){ vec2 xz=vW.xz; float d=1e5;
          for(int i=0;i<${centers.length};i++){ d=min(d,hexd(xz-uCenters[i])); }
          float shore=d-uR;
          for(int i=0;i<${decorU.length};i++){ shore=min(shore, length(xz-uDecor[i].xy)-uDecor[i].z); }
          float n=nz(xz*0.35+uTime*0.15);
          float sp=${polyA.length ? 'sdPoly(xz)' : '99.0'} + (n-0.5)*1.6;
          vec3 col=mix(uDeep,uLagoon,(1.0-smoothstep(-1.0,5.0,sp))*0.92);
          col=mix(col,uShallow,(1.0-smoothstep(0.0,8.0,shore))*0.75);
          float beach=(1.0-smoothstep(0.0,1.3,abs(sp+0.6)));
          col=mix(col,uSand,beach*0.9*smoothstep(1.5,4.0,shore));
          col=mix(col,uFoam,(1.0-smoothstep(0.0,0.45,abs(sp-0.9-0.3*sin(uTime*1.1+n*5.0))))*0.55*smoothstep(1.5,4.0,shore));
          float band=1.0-smoothstep(0.0,0.55,abs(shore-0.9-0.45*sin(uTime*1.3+n*4.0)));
          float edge=1.0-smoothstep(0.0,0.9,shore);
          col=mix(col,uFoam,clamp(band*0.5+edge*0.8,0.0,1.0)*0.85);
          float t1=nz(xz*0.55+vec2(uTime*0.3,-uTime*0.2)), t2=nz(xz*0.55-vec2(uTime*0.25,uTime*0.18));
          vec3 N=normalize(vec3((t1-0.5)*0.35,1.0,(t2-0.5)*0.35)); vec3 V=normalize(cameraPosition-vW);
          float spec=pow(max(dot(N,normalize(V+uSunDir)),0.0),80.0); float fres=pow(1.0-max(dot(N,V),0.0),3.0);
          col=mix(col,uSky,fres*0.3); col+=uSunColor*spec*0.55;
          float dist=length(cameraPosition-vW); col=mix(col,uFogColor,smoothstep(uFogNear,uFogFar,dist));
          gl_FragColor=vec4(col,1.0);
          #include <colorspace_fragment>
        }`,
    })
  );
  water.position.y = 0.02; scene.add(water);

  /* ───────── 天空 ───────── */
  const skyU = { uTop: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() }, uBottom: { value: new THREE.Color() }, uSunDir: { value: new V3() }, uSunColor: { value: new THREE.Color() }, uStars: { value: 0 } };
  const sky = new THREE.Mesh(new THREE.SphereGeometry(1400, 32, 16), new THREE.ShaderMaterial({
    uniforms: skyU, side: THREE.BackSide, depthWrite: false, fog: false,
    vertexShader: 'varying vec3 vD; void main(){ vD=normalize(position); gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
    fragmentShader: `uniform vec3 uTop,uHorizon,uBottom,uSunDir,uSunColor; uniform float uStars; varying vec3 vD;
      float h21(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
      void main(){ float h=vD.y; vec3 c=mix(uHorizon,uTop,smoothstep(0.0,0.55,h)); c=mix(c,uBottom,smoothstep(0.0,-0.25,h));
        float s=max(dot(vD,normalize(uSunDir)),0.0); c+=uSunColor*(pow(s,700.0)*1.2+pow(s,10.0)*0.18);
        vec2 g=floor(vec2(atan(vD.z,vD.x)*260.0, vD.y*260.0)); float st=step(0.9975,h21(g))*smoothstep(0.05,0.35,h)*uStars;
        c+=vec3(st);
        gl_FragColor=vec4(c,1.0);
        #include <colorspace_fragment>
      }`,
  }));
  sky.renderOrder = -1; scene.add(sky);

  /* ───────── 光 ───────── */
  const hemi = new THREE.HemisphereLight(0xddf0ff, 0xa7c79a, 1.0); scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffffff, 2.2);
  sun.castShadow = true;
  const sm = lowPower ? 1024 : 2048; sun.shadow.mapSize.set(sm, sm);
  const sc = sun.shadow.camera; sc.left = -95; sc.right = 95; sc.top = 95; sc.bottom = -95; sc.near = 10; sc.far = 400;
  sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.04;
  scene.add(sun); scene.add(sun.target);

  /* ───────── 雲與船 ───────── */
  const matCloud = new THREE.MeshStandardMaterial({ color: '#FFFFFF', flatShading: true, roughness: 1, transparent: true, opacity: 0.92 });
  const clouds = [];
  for (let k = 0; k < 9; k++) {
    const r = rng(900 + k); const parts = [];
    const n = 3 + Math.floor(r() * 3);
    for (let i = 0; i < n; i++) parts.push(place(new THREE.IcosahedronGeometry(2.4 + r() * 2.2, 0), (i - n / 2) * 3.2, r() * 1.4, (r() - 0.5) * 3, r() * 3, 1, 0.75, 1));
    const g = merge(parts.map((p) => { p.deleteAttribute('uv'); return p; }));
    const m = new THREE.Mesh(g, matCloud);
    const ang = k / 9 * Math.PI * 2;
    m.position.set(Math.cos(ang) * (210 + r() * 70), 30 + r() * 16, Math.sin(ang) * (220 + r() * 70));
    m.userData.speed = 0.6 + r() * 0.8; clouds.push(m); scene.add(m);
  }
  const boats = [];
  for (let k = 0; k < 4; k++) {
    const parts = [];
    parts.push(place(solid(prism([[-1.4, 0.5], [-1.0, 0], [1.0, 0], [1.6, 0.5]], 1.0), k % 2 ? '#E2483D' : '#2F6FD0'), 0, 0, 0));
    parts.push(place(solid(Box(2.6, 0.12, 0.9), '#F2E6D0'), 0, 0.52, 0));
    parts.push(place(solid(Cyl(0.05, 0.05, 2.4, 4), '#6B5A48'), 0.1, 1.7, 0));
    parts.push(place(solid(prism([[0, 0], [1.1, 0], [0, 1.9]], 0.05), '#FFFFFF'), 0.15, 0.75, 0));
    const m = new THREE.Mesh(merge(parts), matIsland); m.castShadow = true;
    m.userData = { a: k / 4 * Math.PI * 2, rx: BOUNDS.w / 2 + 26 + k * 4, rz: BOUNDS.d / 2 + 22 + k * 3, sp: 0.018 + k * 0.004 };
    boats.push(m); scene.add(m);
  }

  /* ───────── 小智（機器人） ───────── */
  const bot = (() => {
    const g = new THREE.Group();
    const white = new THREE.MeshStandardMaterial({ color: '#F7F9FC', roughness: 0.45, flatShading: false });
    const dark = new THREE.MeshStandardMaterial({ color: '#1E2A44', roughness: 0.3 });
    const orange = new THREE.MeshStandardMaterial({ color: '#FF8A3D', roughness: 0.5, emissive: '#FF8A3D', emissiveIntensity: 0.15 });
    const eyeM = new THREE.MeshBasicMaterial({ color: '#6FF2FF' });
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.62, 20, 14), white); body.scale.set(1, 1.08, 0.95); body.position.y = 0.72; g.add(body);
    const belly = new THREE.Mesh(new THREE.CircleGeometry(0.26, 18), new THREE.MeshBasicMaterial({ color: '#6FF2FF' })); belly.position.set(0, 0.68, 0.605); belly.scale.set(1, 0.75, 1); g.add(belly);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.55, 20, 14), white); head.position.y = 1.55; g.add(head);
    const visor = new THREE.Mesh(new THREE.SphereGeometry(0.565, 20, 12, Math.PI / 2 - 0.95, 1.9, Math.PI / 2 - 0.5, 1.0), dark);
    visor.position.y = 1.55; g.add(visor);
    [-0.17, 0.17].forEach((x) => { const e = new THREE.Mesh(new THREE.SphereGeometry(0.08, 10, 8), eyeM); e.position.set(x, 1.58, 0.565); e.scale.set(1, 1.35, 0.5); g.add(e); });
    const scarf = new THREE.Mesh(new THREE.TorusGeometry(0.43, 0.09, 8, 20), orange); scarf.rotation.x = Math.PI / 2; scarf.position.y = 1.1; g.add(scarf);
    const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.4, 6), dark); ant.position.y = 2.25; g.add(ant);
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8), orange); tip.position.y = 2.48; g.add(tip);
    const arm = (side) => {
      const p = new THREE.Group(); p.position.set(0.6 * side, 0.92, 0);
      const a = new THREE.Mesh(new THREE.CapsuleGeometry ? new THREE.CapsuleGeometry(0.1, 0.42, 4, 8) : new THREE.CylinderGeometry(0.1, 0.1, 0.6, 8), white);
      a.position.y = -0.3; p.add(a); p.rotation.z = side * 0.35; g.add(p); return p;
    };
    const armL = arm(-1), armR = arm(1);
    [-0.25, 0.25].forEach((x) => { const f = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), dark); f.position.set(x, 0.12, 0.05); f.scale.set(1, 0.6, 1.3); g.add(f); });
    const cube = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.55, 0.55), new THREE.MeshBasicMaterial({ color: '#FFFFFF' })); cube.position.y = 3.0; cube.visible = false; g.add(cube);
    g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    g.scale.setScalar(1.35);
    const hit = new THREE.Mesh(new THREE.BoxGeometry(1.6, 2.8, 1.6), hitMat); hit.position.y = 1.3; hit.userData = { kind: 'bot' }; g.add(hit); hitMeshes.push(hit);
    scene.add(g);
    return { g, armL, armR, cube, tip, mode: 'stand', at: 0, hop: null, nextAt: 3.5, ride: null };
  })();
  const STOPS = ISLES.map((i) => i.id).concat(['hub']);
  bot.g.position.copy(IP[STOPS[0]].podium);

  /* ───────── 島上人偶（NPC） ───────── */
  const SKIN = ['#F2C9A0', '#E8B98E', '#D9A77C', '#F5D3B3'];
  function hatGeos(h, col) {
    const out = [];
    if (h === 'hard') {
      out.push(place(solid(new THREE.SphereGeometry(0.235, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), col, 0.02), 0, 1.2, 0));
      out.push(place(solid(Cyl(0.28, 0.28, 0.035, 14), col, 0.02), 0, 1.2, 0.02));
      out.push(place(solid(Box(0.05, 0.06, 0.4), new THREE.Color(col).multiplyScalar(0.85), 0), 0, 1.4, 0));
    } else if (h === 'cap') {
      out.push(place(solid(new THREE.SphereGeometry(0.215, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), col, 0.02), 0, 1.22, 0));
      out.push(place(solid(Box(0.22, 0.03, 0.16), col, 0.02), 0, 1.23, 0.22));
    } else if (h === 'hood') {
      out.push(place(solid(Sph(0.245, 12, 8), col, 0.02), 0, 1.2, -0.075));
    } else if (h === 'net') {
      out.push(place(solid(new THREE.SphereGeometry(0.228, 12, 6, 0, Math.PI * 2, 0, Math.PI / 1.8), col, 0.03), 0, 1.19, -0.01));
    } else if (h === 'straw') {
      out.push(place(solid(Cone(0.44, 0.22, 12), col, 0.03), 0, 1.43, 0));
    } else if (h === 'chef') {
      out.push(place(solid(Cyl(0.16, 0.15, 0.26, 10), col, 0.02), 0, 1.44, 0));
      out.push(place(solid(Sph(0.2, 10, 7), col, 0.02), 0, 1.62, 0));
    } else if (h === 'nurse') {
      out.push(place(solid(Box(0.26, 0.1, 0.14), col, 0.02), 0, 1.4, 0.03));
      out.push(place(solid(Box(0.08, 0.025, 0.01), '#E2483D', 0), 0, 1.41, 0.105));
    }
    return out;
  }
  function npcBody(sp, seed) {
    const g = [];
    const skin = SKIN[seed % SKIN.length];
    g.push(place(solid(Box(0.44, 0.5, 0.27), sp.top), 0, 0.77, 0));
    g.push(place(solid(Box(0.46, 0.12, 0.29), sp.bottom), 0, 0.53, 0));
    if (sp.vest) {
      g.push(place(solid(Box(0.465, 0.4, 0.29), sp.vest, 0.02), 0, 0.8, 0));
      g.push(place(solid(Box(0.47, 0.05, 0.295), '#E9EEF2', 0), 0, 0.73, 0));
      g.push(place(solid(Box(0.47, 0.05, 0.295), '#E9EEF2', 0), 0, 0.88, 0));
    }
    [-1, 1].forEach((sd) => {
      g.push(place(solid(Box(0.12, 0.42, 0.14), sp.top), sd * 0.29, 0.79, 0, 0, 1, 1, 1, 0, sd * 0.12));
      g.push(place(solid(Sph(0.07, 6, 4), skin, 0), sd * 0.32, 0.55, 0));
    });
    g.push(place(solid(Cyl(0.07, 0.08, 0.08, 6), skin, 0), 0, 1.04, 0));
    g.push(place(solid(Sph(0.2, 12, 9), skin, 0.01), 0, 1.18, 0));
    g.push(place(solid(Box(0.04, 0.05, 0.02), '#2B2F38', 0), -0.07, 1.2, 0.19));
    g.push(place(solid(Box(0.04, 0.05, 0.02), '#2B2F38', 0), 0.07, 1.2, 0.19));
    if (sp.extra === 'mask') g.push(place(solid(Box(0.22, 0.1, 0.06), '#F4F7FA', 0), 0, 1.11, 0.17));
    if (sp.extra === 'goggles') g.push(place(solid(Box(0.3, 0.07, 0.06), '#2A6F8F', 0), 0, 1.22, 0.17));
    g.push(...hatGeos(sp.hat, sp.hatColor || '#FFD23F'));
    return merge(g);
  }
  const legGeo = new THREE.BoxGeometry(0.15, 0.48, 0.16); legGeo.translate(0, -0.24, 0);
  const legMat = new THREE.MeshStandardMaterial({ roughness: 0.85, flatShading: true });
  const allCrew = [];
  ISLES.forEach((i) => (i.crew || []).forEach((c, k) => allCrew.push({ isl: i.id, k, sp: c })));
  (D.hub.crew || []).forEach((c, k) => allCrew.push({ isl: 'hub', k, sp: c }));
  const legsL = new THREE.InstancedMesh(legGeo, legMat, Math.max(1, allCrew.length)), legsR = new THREE.InstancedMesh(legGeo, legMat, Math.max(1, allCrew.length));
  [legsL, legsR].forEach((m) => { m.castShadow = true; m.frustumCulled = false; m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); scene.add(m); });
  const npcs = allCrew.map((c, idx) => {
    const seed = strHash(c.isl + c.k);
    const group = new THREE.Group();
    const body = new THREE.Mesh(npcBody(c.sp, seed), matIsland); body.castShadow = true; group.add(body);
    const hit = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.8, 0.9), hitMat); hit.position.y = 0.85; hit.userData = { kind: 'npc', idx }; group.add(hit); hitMeshes.push(hit);
    group.scale.setScalar(1.55); scene.add(group);
    tmpC.set(c.sp.bottom || '#2B2F38'); legsL.setColorAt(idx, tmpC); legsR.setColorAt(idx, tmpC);
    return { ...c, idx, group, u: (c.k / 3 + hash1(seed % 997) * 0.2) % 1, dir: c.k % 2 ? -1 : 1, speed: 0.012 + hash1(seed % 331) * 0.006, phase: hash1(seed % 71) * 6, talking: false, center: IP[c.isl].center };
  });
  if (legsL.instanceColor) legsL.instanceColor.needsUpdate = true;
  if (legsR.instanceColor) legsR.instanceColor.needsUpdate = true;
  const HEXV = [30, 90, 150, 210, 270, 330].map((a) => [Math.cos(a * Math.PI / 180) * PATH_MID / 0.866, Math.sin(a * Math.PI / 180) * PATH_MID / 0.866]);
  function hexAt(u) {
    const t = ((u % 1) + 1) % 1 * 6, k = Math.floor(t), f = t - k;
    const a = HEXV[k], b = HEXV[(k + 1) % 6];
    return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, Math.atan2(b[0] - a[0], b[1] - a[1])];
  }
  const _m1 = new THREE.Matrix4(), _m2 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler();
  function stepNPCs(t, dt) {
    npcs.forEach((n) => {
      const g = n.group;
      let walking = !n.talking && !reduceMotion;
      if (walking) n.u += dt * n.speed * n.dir;
      const [x, z, ang] = hexAt(n.u);
      g.position.set(n.center.x + x, G + 0.05 + (walking ? Math.abs(Math.sin(t * 7 + n.phase)) * 0.06 : 0), n.center.z + z);
      if (n.talking) g.rotation.y = Math.atan2(camera.position.x - g.position.x, camera.position.z - g.position.z);
      else g.rotation.y = ang + (n.dir < 0 ? Math.PI : 0);
      const sw = walking ? Math.sin(t * 7 + n.phase) * 0.55 : 0;
      g.updateMatrix();
      [[legsL, -0.11, sw], [legsR, 0.11, -sw]].forEach(([m, ox, a]) => {
        _m2.compose(new V3(ox, 0.47, 0), _q.setFromEuler(_e.set(a, 0, 0)), new V3(1, 1, 1));
        _m1.multiplyMatrices(g.matrix, _m2); m.setMatrixAt(n.idx, _m1);
      });
    });
    legsL.instanceMatrix.needsUpdate = true; legsR.instanceMatrix.needsUpdate = true;
  }

  function hopTo(stopIdx, now) {
    const from = bot.g.position.clone(), to = IP[STOPS[stopIdx]].podium.clone();
    const dist = from.distanceTo(to);
    bot.hop = { from, to, t0: now, dur: reduceMotion ? 0.01 : 1.1 + dist * 0.012, h: 4 + dist * 0.09 };
    bot.at = stopIdx; bot.mode = 'hop';
  }

  /* ───────── 標記（搜尋/協作線） ───────── */
  const pinGeo = merge([place(solid(Cone(0.42, 1.0, 10), '#FFFFFF', 0), 0, 0.5, 0, 0, 1, 1, 1, Math.PI), place(solid(Sph(0.4, 12, 8), '#FFFFFF', 0), 0, 1.25, 0)]);
  const pins = new THREE.InstancedMesh(pinGeo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4, emissive: '#222222' }), 100);
  pins.count = 0; pins.frustumCulled = false; pins.instanceMatrix.setUsage(THREE.DynamicDrawUsage); scene.add(pins);
  let pinList = [];
  const ringGeo = new THREE.RingGeometry(1.7, 2.15, 32); ringGeo.rotateX(-Math.PI / 2);
  const rings = new THREE.InstancedMesh(ringGeo, new THREE.MeshBasicMaterial({ color: '#FFFFFF', transparent: true, opacity: 0.85, depthWrite: false }), 100);
  rings.count = 0; rings.frustumCulled = false; scene.add(rings);
  function setPins(list) {
    pinList = list; pins.count = list.length; rings.count = list.length;
    list.forEach((p, k) => { tmpC.set(p.color); pins.setColorAt(k, tmpC); rings.setColorAt(k, tmpC); });
    if (pins.instanceColor) pins.instanceColor.needsUpdate = true;
    if (rings.instanceColor) rings.instanceColor.needsUpdate = true;
  }
  const selPin = new THREE.Mesh(new THREE.OctahedronGeometry(0.7, 0), new THREE.MeshStandardMaterial({ color: '#FFB020', emissive: '#FF9900', emissiveIntensity: 0.35, flatShading: true }));
  selPin.scale.set(1, 1.5, 1); selPin.visible = false; selPin.castShadow = true; scene.add(selPin);

  /* ───────── 技術協作線 ───────── */
  const flowVS = 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }';
  const flowFS = `uniform vec3 uColor; uniform float uTime,uLen,uOpacity; varying vec2 vUv;
    void main(){ float f=fract(vUv.x*uLen/5.0-uTime*0.8); float p=smoothstep(0.0,0.12,f)*smoothstep(0.5,0.12,f);
      vec3 c=uColor*(0.82+0.5*p)+vec3(p*0.22); gl_FragColor=vec4(c,uOpacity);
      #include <colorspace_fragment>
    }`;
  const lineCache = {};
  function orderMembers(ids) {
    const rest = ids.slice(); const out = [];
    rest.sort((a, b) => BP[a].pos.z - BP[b].pos.z);
    out.push(rest.shift());
    while (rest.length) {
      const last = BP[out[out.length - 1]].pos; let bi = 0, bd = Infinity;
      rest.forEach((id, k) => { const d = last.distanceToSquared(BP[id].pos); if (d < bd) { bd = d; bi = k; } });
      out.push(rest.splice(bi, 1)[0]);
    }
    return out;
  }
  function lineCurve(l) {
    const ids = orderMembers(l.members); const pts = [];
    for (let i = 0; i < ids.length - 1; i++) {
      const a = BP[ids[i]].top, b = BP[ids[i + 1]].top; const d = a.distanceTo(b);
      const peak = Math.max(a.y, b.y) + 2.2 + d * 0.16; const cy = 2 * peak - (a.y + b.y) / 2;
      const steps = Math.max(6, Math.round(d / 2.2));
      for (let k = i === 0 ? 0 : 1; k <= steps; k++) {
        const u = k / steps, v = 1 - u;
        pts.push(new V3(v * v * a.x + 2 * v * u * (a.x + b.x) / 2 + u * u * b.x, v * v * a.y + 2 * v * u * cy + u * u * b.y, v * v * a.z + 2 * v * u * (a.z + b.z) / 2 + u * u * b.z));
      }
    }
    return new THREE.CatmullRomCurve3(pts, false, 'centripetal', 0.5);
  }
  function getLine(id, thin) {
    const key = id + (thin ? ':t' : '');
    if (lineCache[key]) return lineCache[key];
    const l = L[id]; const curve = lineCache[id + ':c'] || (lineCache[id + ':c'] = lineCurve(l));
    const len = curve.getLength();
    const mat = new THREE.ShaderMaterial({ uniforms: { uColor: { value: new THREE.Color(l.color) }, uTime: { value: 0 }, uLen: { value: len }, uOpacity: { value: thin ? 0.55 : 0.96 } }, vertexShader: flowVS, fragmentShader: flowFS, transparent: true, depthWrite: !thin });
    const mesh = new THREE.Mesh(new THREE.TubeGeometry(curve, Math.min(900, Math.round(len * 1.6)), thin ? 0.13 : 0.3, thin ? 4 : 7, false), mat);
    mesh.userData = { curve, len }; mesh.visible = false; scene.add(mesh);
    lineCache[key] = mesh; return mesh;
  }

  /* ───────── 實際位置圖釘 ───────── */
  const PLACES = X.places || {}, REAL = X.real || {};
  D.buildings.forEach((b) => { const r = REAL[b.id]; if (r) b.real = { key: r[0], addr: r[1], st: r[2] }; });
  const ST = {
    ok: { t: '與島嶼位置一致', s: '一致', c: '#2E9E6A' },
    near: { t: '在島嶼的隔壁縣市', s: '鄰近', c: '#D99A00' },
    far: { t: '與島嶼位置不同', s: '不同', c: '#E2483D' },
    unk: { t: '所在地待確認', s: '待確認', c: '#8A97A6' },
  };
  const ST_ORDER = ['far', 'near', 'ok', 'unk'];
  const PIN_H = 12;
  const PL = {};
  Object.keys(PLACES).forEach((k) => { const q = PLACES[k]; PL[k] = { key: k, name: q.name, pos: new V3(q.xy[0], 0, q.xy[1]), head: new V3(q.xy[0], PIN_H, q.xy[1]), label: new V3(q.xy[0], PIN_H + 1.6, q.xy[1]), ids: [] }; });
  D.buildings.forEach((b) => { if (b.real && b.real.key && PL[b.real.key]) PL[b.real.key].ids.push(b.id); });
  // 島名後面的地點：先列島嶼在地圖上的代表地點，再依家數列出島上廠商實際所在的其他縣市
  const PRIMARY = { med: 'tpe', elec: 'tpe', bio: 'hsz', retail: null, semi: 'hsz', tool: 'txg', mob: 'txg', svc: null, mach: 'nto', metal: 'chw', chem: 'yun', food: 'cyi', tex: 'tnn', fast: 'khh' };
  const placeShort = (k) => (k === 'tpe' ? '台北' : PL[k].name);
  function isleCounts(i) { const cnt = {}; i.buildings.forEach((b) => { const k = b.real && b.real.key; if (k && PL[k]) cnt[k] = (cnt[k] || 0) + 1; }); return cnt; }
  function isleWhere(i) {
    const cnt = isleCounts(i);
    const others = Object.keys(cnt).filter((k) => k !== PRIMARY[i.id]).sort((a, b) => cnt[b] - cnt[a] || PL[a].pos.z - PL[b].pos.z);
    return [CITY[i.id], ...others.map(placeShort)];
  }
  const realGroup = new THREE.Group(); realGroup.visible = false; scene.add(realGroup);
  const arcGroup = new THREE.Group(); scene.add(arcGroup);
  {
    const headMat = new THREE.MeshStandardMaterial({ color: '#E2483D', roughness: 0.35, emissive: '#6a120b', emissiveIntensity: 0.5 });
    const stemMat = new THREE.MeshStandardMaterial({ color: '#8E2B22', roughness: 0.6 });
    const baseMat = new THREE.MeshBasicMaterial({ color: '#E2483D', transparent: true, opacity: 0.5, depthWrite: false, side: THREE.DoubleSide });
    const groundY = (x, z) => (cellsAll.some((c) => { const q = cellPos(c); return Math.hypot(q.x - x, q.z - z) < R * 0.86; }) ? G + 0.08 : 0.15);
    Object.values(PL).forEach((p) => {
      if (!p.ids.length) return;
      const g = new THREE.Group(); g.position.copy(p.pos);
      const gy = groundY(p.pos.x, p.pos.z);
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, PIN_H - gy, 8), stemMat); stem.position.y = gy + (PIN_H - gy) / 2; g.add(stem);
      const head = new THREE.Mesh(new THREE.SphereGeometry(1.05, 18, 12), headMat); head.position.y = PIN_H; head.castShadow = true; g.add(head);
      const tip = new THREE.Mesh(new THREE.ConeGeometry(0.55, 1.2, 12), headMat); tip.rotation.x = Math.PI; tip.position.y = PIN_H - 1.05; g.add(tip);
      const base = new THREE.Mesh(new THREE.RingGeometry(0.5, 1.7, 28), baseMat); base.rotation.x = -Math.PI / 2; base.position.y = gy; g.add(base);
      const hit = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, PIN_H + 2, 8), hitMat); hit.position.y = (PIN_H + 2) / 2; hit.userData = { kind: 'place', id: p.key }; g.add(hit); hitMeshes.push(hit);
      realGroup.add(g); p.group = g;
    });
  }
  const arcMats = {}; Object.keys(ST).forEach((k) => { arcMats[k] = new THREE.MeshBasicMaterial({ color: ST[k].c, transparent: true, opacity: 0.92 }); });
  const arcDotGeo = new THREE.SphereGeometry(0.42, 10, 8), moverGeo = new THREE.SphereGeometry(0.62, 12, 10);
  function clearArcs() { arcGroup.children.slice().forEach((m) => { if (m.geometry !== arcDotGeo && m.geometry !== moverGeo) m.geometry.dispose(); arcGroup.remove(m); }); }
  function showArcs(ids) {
    clearArcs();
    ids.forEach((id) => {
      const b = B[id]; if (!b.real || !PL[b.real.key]) return;
      const a = BP[id].top.clone(), z = PL[b.real.key].head.clone().add(new V3(0, -1.1, 0));
      const d = a.distanceTo(z);
      const mid = a.clone().add(z).multiplyScalar(0.5); mid.y = Math.max(a.y, z.y) + 2.5 + d * 0.22;
      const curve = new THREE.QuadraticBezierCurve3(a, mid, z);
      arcGroup.add(new THREE.Mesh(new THREE.TubeGeometry(curve, Math.max(16, Math.round(d * 1.2)), 0.17, 6, false), arcMats[b.real.st]));
      const dot = new THREE.Mesh(arcDotGeo, arcMats[b.real.st]); dot.position.copy(a); arcGroup.add(dot);
      const mv = new THREE.Mesh(moverGeo, arcMats[b.real.st]); mv.userData = { curve, ph: (arcGroup.children.length * 0.137) % 1, sp: clamp(9 / Math.max(d, 1), 0.12, 0.6) }; arcGroup.add(mv);
    });
  }
  function stepArcs(t) {
    arcGroup.children.forEach((m) => { const u = m.userData; if (u && u.curve) m.position.copy(u.curve.getPoint((t * u.sp + u.ph) % 1)); });
    Object.values(PL).forEach((p) => { if (p.group) p.group.scale.setScalar(p.key === state.focusPlace && !state.real ? 1.25 + Math.sin(t * 4) * 0.08 : p.key === state.place ? 1.15 : 1); });
  }
  function updatePinVis() {
    realGroup.visible = true;
    Object.values(PL).forEach((p) => { if (p.group) p.group.visible = state.real || p.key === state.focusPlace; });
  }
  function setFocusPlace(key, coName) {
    const prev = state.focusPlace && PL[state.focusPlace];
    if (prev && prev.labelEl) { prev.labelEl.innerHTML = prev.labelHTML; prev.labelEl.classList.remove('focus'); prev.labelEl._w = 0; }
    state.focusPlace = key || null;
    const q = key && PL[key];
    if (q && q.labelEl && coName) { q.labelEl.innerHTML = `<span>${esc(coName)}・實際在${esc(q.name)}</span>`; q.labelEl.classList.add('focus'); q.labelEl._w = 0; }
    updatePinVis();
  }

  /* ───────── 時間 ───────── */
  const TIMES = [
    { key: 'day', label: '白天', top: '#5AAEEA', horizon: '#CFEAF7', bottom: '#A6D8EA', sun: [0.42, 0.82, 0.38], sunColor: '#FFF4E0', sunI: 2.3, hs: '#DDF0FF', hg: '#A7C79A', hi: 1.05, deep: '#2B8DB3', shallow: '#62D1D6', foam: '#FFFFFF', lagoon: '#83D9C9', sand: '#EEDDB2', win: 0, stars: 0, beam: 0 },
    { key: 'dusk', label: '黃昏', top: '#45609E', horizon: '#F6B583', bottom: '#E7A07E', sun: [-0.8, 0.26, 0.25], sunColor: '#FFBE86', sunI: 1.8, hs: '#FBD3B0', hg: '#7C6A70', hi: 0.85, deep: '#2D5F86', shallow: '#5BA7B3', foam: '#FFE9D8', lagoon: '#6FB4AE', sand: '#E8C49A', win: 0.7, stars: 0.12, beam: 0.08 },
    { key: 'night', label: '夜晚', top: '#0A1431', horizon: '#26365C', bottom: '#172645', sun: [0.35, 0.72, -0.4], sunColor: '#A9BEFF', sunI: 0.42, hs: '#4A5C99', hg: '#161B28', hi: 0.36, deep: '#0E2C47', shallow: '#1E5674', foam: '#9DB6D6', lagoon: '#1F5B6E', sand: '#5C6878', win: 1.6, stars: 1, beam: 0.22 },
    { key: 'dawn', label: '清晨', top: '#7DA6E0', horizon: '#FFD7C2', bottom: '#E9BBB0', sun: [0.8, 0.24, -0.35], sunColor: '#FFD8B5', sunI: 1.7, hs: '#FFE6DA', hg: '#8FA58C', hi: 0.9, deep: '#3B7EA7', shallow: '#7ACAD0', foam: '#FFF4EE', lagoon: '#8BD3C8', sand: '#F1D9BE', win: 0.3, stars: 0.08, beam: 0.05 },
  ];
  let timeIdx = 0;
  const env = {}; // 目前插值後狀態
  function snapEnv(p) {
    ['top', 'horizon', 'bottom', 'sunColor', 'hs', 'hg', 'deep', 'shallow', 'foam', 'lagoon', 'sand'].forEach((k) => { env[k] = new THREE.Color(p[k]); });
    env.sun = new V3(...p.sun).normalize(); ['sunI', 'hi', 'win', 'stars', 'beam'].forEach((k) => { env[k] = p[k]; });
  }
  snapEnv(TIMES[0]);
  let envTarget = TIMES[0];
  function stepEnv(dt) {
    const t = Math.min(1, dt * 1.6);
    ['top', 'horizon', 'bottom', 'sunColor', 'hs', 'hg', 'deep', 'shallow', 'foam', 'lagoon', 'sand'].forEach((k) => env[k].lerp(tmpC.set(envTarget[k]), t));
    env.sun.lerp(new V3(...envTarget.sun).normalize(), t).normalize();
    ['sunI', 'hi', 'win', 'stars', 'beam'].forEach((k) => { env[k] = lerp(env[k], envTarget[k], t); });
    skyU.uTop.value.copy(env.top); skyU.uHorizon.value.copy(env.horizon); skyU.uBottom.value.copy(env.bottom);
    skyU.uSunDir.value.copy(env.sun); skyU.uSunColor.value.copy(env.sunColor); skyU.uStars.value = env.stars;
    scene.fog.color.copy(env.horizon); renderer.setClearColor(env.horizon);
    hemi.color.copy(env.hs); hemi.groundColor.copy(env.hg); hemi.intensity = env.hi;
    sun.color.copy(env.sunColor); sun.intensity = env.sunI;
    waterU.uDeep.value.copy(env.deep); waterU.uShallow.value.copy(env.shallow); waterU.uFoam.value.copy(env.foam); waterU.uLagoon.value.copy(env.lagoon); waterU.uSand.value.copy(env.sand);
    waterU.uSky.value.copy(env.horizon); waterU.uFogColor.value.copy(env.horizon); waterU.uSunDir.value.copy(env.sun); waterU.uSunColor.value.copy(env.sunColor);
    matWin.emissiveIntensity = env.win;
    hubFx.beam.material.opacity = env.beam;
    matCloud.color.copy(env.hs).lerp(tmpC.set('#FFFFFF'), 0.55);
  }
  $('#btnTime').addEventListener('click', () => {
    timeIdx = (timeIdx + 1) % TIMES.length; envTarget = TIMES[timeIdx]; $('#timeLbl').textContent = TIMES[timeIdx].label;
    $('#btnTime').title = '切換時間（目前：' + TIMES[timeIdx].label + '）';
  });

  /* ───────── 相機 ───────── */
  const ctl = { target: new V3(BOUNDS.cx, 0, BOUNDS.cz), dist: 220, az: 0, pol: 0.82, anim: null };
  const occ = { dx: 0, dy: 0, Hv: 1, wvis: 1, hvis: 1 };
  let occTarget = { L: 0, R: 0, T: 0, B: 0 }, occCur = { L: 0, R: 0, T: 0, B: 0 };
  function measureOcc() {
    const w = window.innerWidth, h = window.innerHeight;
    let T = $('#topbar').getBoundingClientRect().bottom;
    if (isMobile() && document.body.classList.contains('search-open')) T = Math.max(T, $('#search').getBoundingClientRect().bottom);
    const o = { L: 0, R: 0, T: Math.min(T, h * 0.3), B: 0 };
    if (document.body.classList.contains('panel-open')) {
      if (isMobile()) o.B = Math.min(sheetPx(), h * 0.62);
      else o.R = (parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--panel-w')) || 420) + 32;
    }
    if (!isMobile()) o.B = Math.max(o.B, 56);
    occTarget = o;
  }
  function applyView(dt) {
    const k = dt == null ? 1 : Math.min(1, dt * 7);
    ['L', 'R', 'T', 'B'].forEach((s) => { occCur[s] = lerp(occCur[s], occTarget[s], k); });
    const w = window.innerWidth, h = window.innerHeight;
    const dx = (occCur.L - occCur.R) / 2, dy = (occCur.T - occCur.B) / 2;
    const Wv = w + 2 * Math.abs(dx), Hv = h + 2 * Math.abs(dy);
    camera.aspect = Wv / Hv;
    camera.setViewOffset(Wv, Hv, dx < 0 ? 2 * Math.abs(dx) : 0, dy < 0 ? 2 * Math.abs(dy) : 0, w, h);
    camera.updateProjectionMatrix();
    occ.Hv = Hv; occ.wvis = Math.max(100, w - occCur.L - occCur.R); occ.hvis = Math.max(100, h - occCur.T - occCur.B);
  }
  function fitDist(pol, extW, extD, ht) {
    const t = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const tx = t * occTarget_wvis() / occTarget_Hv(), ty = t * occTarget_hvis() / occTarget_Hv();
    const halfD = (extD / 2) * Math.cos(pol) + (ht || 6) * Math.sin(pol) * 0.5;
    return Math.max((extW / 2) / tx, halfD / ty) * 1.12;
  }
  function occTarget_wvis() { return Math.max(100, window.innerWidth - occTarget.L - occTarget.R); }
  function occTarget_hvis() { return Math.max(100, window.innerHeight - occTarget.T - occTarget.B); }
  function occTarget_Hv() { return window.innerHeight + Math.abs(occTarget.T - occTarget.B); }
  const fitCam = new THREE.PerspectiveCamera(32, 1, 1, 3000);
  function fitPoints(points, pol, az, margin) {
    const Wv = window.innerWidth + Math.abs(occTarget.L - occTarget.R), Hv = occTarget_Hv();
    const wvis = occTarget_wvis(), hvis = occTarget_hvis();
    fitCam.fov = camera.fov; fitCam.aspect = Wv / Hv; fitCam.updateProjectionMatrix();
    const target = new V3(); points.forEach((p) => target.add(p)); target.multiplyScalar(1 / points.length); target.y = 0;
    let dist = fitDist(pol, 60, 60, 6);
    const right = new V3(Math.cos(az), 0, -Math.sin(az)), fwd = new V3(-Math.sin(az), 0, -Math.cos(az));
    const t = Math.tan(THREE.MathUtils.degToRad(fitCam.fov / 2)); const v = new V3();
    for (let it = 0; it < 7; it++) {
      const sp = Math.sin(pol), cp = Math.cos(pol);
      fitCam.position.set(target.x + dist * sp * Math.sin(az), dist * cp, target.z + dist * sp * Math.cos(az)); fitCam.lookAt(target); fitCam.updateMatrixWorld();
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      points.forEach((p) => { v.copy(p).project(fitCam); const x = (v.x + 1) / 2 * Wv, y = (1 - v.y) / 2 * Hv; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); });
      const s = Math.max((x1 - x0) / wvis, (y1 - y0) / hvis) * (margin || 1.08);
      const wpp = 2 * dist * t / Hv;
      target.addScaledVector(right, ((x0 + x1) / 2 - Wv / 2) * wpp).addScaledVector(fwd, -((y0 + y1) / 2 - Hv / 2) * wpp / Math.max(0.4, cp));
      dist *= Math.pow(s, 0.92);
    }
    return { target, dist, pol, az };
  }
  function boxPoints(minX, maxX, minZ, maxZ, h) {
    const out = []; [minX, maxX].forEach((x) => [minZ, maxZ].forEach((z) => [0, h].forEach((y) => out.push(new V3(x, y, z))))); return out;
  }
  function hexPoints(c, rad, h) { const out = []; for (let k = 0; k < 6; k++) { const a = k * Math.PI / 3 + Math.PI / 2; [0, h].forEach((y) => out.push(new V3(c.x + Math.cos(a) * rad, y, c.z + Math.sin(a) * rad))); } return out; }
  function homeView() {
    const pts = []; cellsAll.forEach((c) => pts.push(...hexPoints(cellPos(c), R * 1.08, 9))); TW.forEach((q) => pts.push(new V3(q[0], 0, q[1])));
    return fitPoints(pts, 0.82, 0, 1.1);
  }
  function camUpdate() {
    const sp = Math.sin(ctl.pol), cp = Math.cos(ctl.pol);
    camera.position.set(ctl.target.x + ctl.dist * sp * Math.sin(ctl.az), ctl.target.y + ctl.dist * cp, ctl.target.z + ctl.dist * sp * Math.cos(ctl.az));
    camera.lookAt(ctl.target);
  }
  function maxDist() { return Math.max(260, homeView().dist * 1.35); }
  function clampCtl() {
    ctl.dist = clamp(ctl.dist, 16, maxDist()); ctl.pol = clamp(ctl.pol, 0.28, 1.22);
    ctl.target.x = clamp(ctl.target.x, BOUNDS.minX - 15, BOUNDS.maxX + 15); ctl.target.z = clamp(ctl.target.z, BOUNDS.minZ - 15, BOUNDS.maxZ + 15);
  }
  function flyTo(v, dur) {
    const angDiff = ((v.az != null ? v.az : ctl.az) - ctl.az + Math.PI * 3) % (Math.PI * 2) - Math.PI;
    ctl.anim = { t0: performance.now(), dur: reduceMotion ? 1 : (dur || 1000), from: { target: ctl.target.clone(), dist: ctl.dist, az: ctl.az, pol: ctl.pol },
      to: { target: v.target.clone(), dist: v.dist != null ? v.dist : ctl.dist, az: ctl.az + angDiff, pol: v.pol != null ? v.pol : ctl.pol } };
  }
  function stepAnim(now) {
    const a = ctl.anim; if (!a) return;
    const u = clamp((now - a.t0) / a.dur, 0, 1), e = easeInOut(u);
    ctl.target.lerpVectors(a.from.target, a.to.target, e);
    const zoomOut = Math.min(a.from.dist, a.to.dist) * 0.18 * Math.sin(Math.PI * e) * (a.from.target.distanceTo(a.to.target) > 30 ? 1 : 0);
    ctl.dist = lerp(a.from.dist, a.to.dist, e) + zoomOut; ctl.az = lerp(a.from.az, a.to.az, e); ctl.pol = lerp(a.from.pol, a.to.pol, e);
    if (u >= 1) ctl.anim = null;
  }

  /* 指標操作 */
  const ptrs = new Map(); let gesture = null, downInfo = null, lastHover = 0, touched = false;
  const groundHit = (cx, cy) => {
    const ndc = new THREE.Vector2((cx / window.innerWidth) * 2 - 1, -(cy / window.innerHeight) * 2 + 1);
    const rc = new THREE.Raycaster(); rc.setFromCamera(ndc, camera);
    const p = new V3(); return rc.ray.intersectPlane(new THREE.Plane(UP, 0), p) ? p : null;
  };
  function panBy(dx, dy) {
    const t = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)); const wpp = 2 * ctl.dist * t / occ.Hv;
    const right = new V3(Math.cos(ctl.az), 0, -Math.sin(ctl.az)), fwd = new V3(-Math.sin(ctl.az), 0, -Math.cos(ctl.az));
    ctl.target.addScaledVector(right, -dx * wpp).addScaledVector(fwd, dy * wpp / Math.max(0.4, Math.cos(ctl.pol)));
  }
  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY }); touched = true;
    ctl.anim = null; hideBubble();
    if (ptrs.size === 1) { downInfo = { x: e.clientX, y: e.clientY, t: performance.now(), moved: 0 }; gesture = (e.button === 2 || e.ctrlKey || e.shiftKey) ? 'rotate' : 'pan'; }
    else { gesture = 'pinch'; downInfo = null; startPinch(); }
  });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  let pinch = null;
  function pinchState() { const [a, b] = Array.from(ptrs.values()); return { d: Math.hypot(a.x - b.x, a.y - b.y), ang: Math.atan2(b.y - a.y, b.x - a.x), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 }; }
  function startPinch() { if (ptrs.size >= 2) pinch = pinchState(); }
  canvas.addEventListener('pointermove', (e) => {
    if (!ptrs.has(e.pointerId)) { hover(e); return; }
    const p = ptrs.get(e.pointerId); const dx = e.clientX - p.x, dy = e.clientY - p.y; p.x = e.clientX; p.y = e.clientY;
    if (downInfo) downInfo.moved += Math.abs(dx) + Math.abs(dy);
    if (gesture === 'pan' && ptrs.size === 1) panBy(dx, dy);
    else if (gesture === 'rotate' && ptrs.size === 1) { ctl.az -= dx * 0.006; ctl.pol -= dy * 0.004; }
    else if (gesture === 'pinch' && ptrs.size >= 2 && pinch) {
      const s = pinchState();
      ctl.dist *= pinch.d / Math.max(10, s.d); ctl.az -= (s.ang - pinch.ang); panBy(s.mx - pinch.mx, s.my - pinch.my); pinch = s;
    }
    clampCtl();
    if (downInfo && downInfo.moved > 6) $('#tip').style.display = 'none';
  });
  const endPtr = (e) => {
    if (!ptrs.has(e.pointerId)) return;
    ptrs.delete(e.pointerId);
    if (downInfo && ptrs.size === 0 && downInfo.moved < 8 && performance.now() - downInfo.t < 600) pick(e.clientX, e.clientY);
    if (ptrs.size < 2) pinch = null;
    if (ptrs.size === 1) { gesture = 'pan'; downInfo = null; } else if (ptrs.size === 0) { gesture = null; downInfo = null; }
  };
  canvas.addEventListener('pointerup', endPtr); canvas.addEventListener('pointercancel', endPtr);
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault(); ctl.anim = null;
    const before = ctl.dist; ctl.dist *= Math.exp(e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0013)); clampCtl();
    const gp = groundHit(e.clientX, e.clientY);
    if (gp && ctl.dist < before) ctl.target.lerp(gp.setY(0), (1 - ctl.dist / before) * 0.9);
    clampCtl();
  }, { passive: false });
  canvas.addEventListener('pointerleave', () => { $('#tip').style.display = 'none'; canvas.style.cursor = ''; });
  canvas.addEventListener('keydown', (e) => {
    const k = e.key; const step = 40;
    if (k === 'ArrowLeft') panBy(step, 0); else if (k === 'ArrowRight') panBy(-step, 0); else if (k === 'ArrowUp') panBy(0, step); else if (k === 'ArrowDown') panBy(0, -step);
    else if (k === '+' || k === '=') ctl.dist *= 0.85; else if (k === '-') ctl.dist *= 1.18; else return;
    e.preventDefault(); clampCtl();
  });
  $('#btnZin').addEventListener('click', () => flyTo({ target: ctl.target, dist: ctl.dist * 0.7 }, 450));
  $('#btnZout').addEventListener('click', () => flyTo({ target: ctl.target, dist: Math.min(maxDist(), ctl.dist * 1.4) }, 450));
  $('#btnRot').addEventListener('click', () => flyTo({ target: ctl.target, az: ctl.az + Math.PI / 4 }, 700));
  $('#btnReset').addEventListener('click', () => { flyTo(homeView(), 900); });

  const raycaster = new THREE.Raycaster();
  function rayHit(cx, cy) {
    const ndc = new THREE.Vector2((cx / window.innerWidth) * 2 - 1, -(cy / window.innerHeight) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    const hits = raycaster.intersectObjects(hitMeshes, false).filter((h) => h.object.userData.kind !== 'place' || state.real || h.object.userData.id === state.focusPlace);
    if (!hits.length) return null;
    const b = hits.find((h) => h.object.userData.kind === 'npc' || h.object.userData.kind === 'bot' || h.object.userData.kind === 'place') || hits.find((h) => h.object.userData.kind === 'b');
    if (b && b.distance - hits[0].distance < 6) return b.object.userData;
    return hits[0].object.userData;
  }
  function pick(cx, cy) {
    const u = rayHit(cx, cy);
    if (!u) return;
    if (u.kind === 'bot') { showBubble(); return; }
    if (u.kind === 'npc') { talkNPC(u.idx); return; }
    if (u.kind === 'place') { openPlace(u.id); return; }
    if (u.kind === 'b') { selectBuilding(u.id, { from: 'map' }); return; }
    if (u.kind === 'hub') { openHub(); return; }
    if (u.kind === 'i') { selectIsland(u.id); }
  }
  function hover(e) {
    if (isMobile() || e.pointerType === 'touch') return;
    const now = performance.now(); if (now - lastHover < 60) return; lastHover = now;
    const u = rayHit(e.clientX, e.clientY); const tip = $('#tip');
    if (!u) { tip.style.display = 'none'; canvas.style.cursor = ''; return; }
    canvas.style.cursor = 'pointer';
    let txt = '';
    if (u.kind === 'b') { const b = B[u.id]; txt = `<b>${esc(b.co)}</b><br>${TYPE[b.type]}・${esc(b.short)}`; }
    else if (u.kind === 'i') { const i = I[u.id]; txt = `<b>${pad2(i.no)} ${esc(i.name)}</b><br>${i.buildings.length} 個 AI 場域`; }
    else if (u.kind === 'hub') txt = '<b>AI 中樞島</b><br>三大計畫怎麼推動 AI';
    else if (u.kind === 'bot') txt = '<b>小智</b><br>點我開始導覽';
    else if (u.kind === 'npc') { const n = npcs[u.idx]; txt = `<b>${esc(n.sp.role)}</b><br>點我聊聊 AI 轉型`; }
    else if (u.kind === 'place') { const q = PL[u.id]; txt = `<b>${esc(q.name)}</b><br>${q.ids.length} 家廠商實際在這裡`; }
    tip.innerHTML = txt; tip.style.display = 'block'; tip.style.left = e.clientX + 'px'; tip.style.top = e.clientY + 'px';
  }

  /* ───────── 標籤 ───────── */
  const labelsEl = $('#labels');
  const islandLabels = [];
  ISLES.concat([{ id: 'hub', no: 0, name: 'AI 中樞島', color: '#22A699', buildings: [] }]).forEach((i) => {
    const el = document.createElement('button');
    el.className = 'ilabel' + (i.id === 'hub' ? ' hub' : '');
    el.style.setProperty('--c', i.color);
    el.innerHTML = i.id === 'hub' ? `<span class="no">AI</span><span class="nm">AI 中樞島</span><span class="city">${CITY.hub}</span>` : `<span class="no">${pad2(i.no)}</span><span class="nm">${esc(i.name)}</span><span class="city">${isleWhere(i).map(esc).join('・')}</span><span class="ct">${i.buildings.length}</span>`;
    el.setAttribute('aria-label', i.id === 'hub' ? 'AI 中樞島' : `${pad2(i.no)} ${i.name}，${i.buildings.length} 個 AI 場域`);
    el.addEventListener('click', () => (i.id === 'hub' ? openHub() : selectIsland(i.id)));
    labelsEl.appendChild(el);
    islandLabels.push({ el, pos: IP[i.id].label, id: i.id, w: 0, h: 0 });
  });
  DECOR.forEach((d) => {
    const el = document.createElement('span'); el.className = 'dlabel'; el.textContent = d.name; labelsEl.appendChild(el);
    islandLabels.push({ el, pos: d.label, id: 'decor:' + d.name, w: 0, h: 0, decor: true });
  });
  Object.values(PL).forEach((p) => {
    if (!p.ids.length) return;
    const el = document.createElement('button'); el.className = 'plabel hide';
    p.labelHTML = `<span>${esc(p.name)}</span><b>${p.ids.length}</b>`; el.innerHTML = p.labelHTML; p.labelEl = el;
    el.setAttribute('aria-label', `${p.name}：${p.ids.length} 家廠商的實際所在地`);
    el.addEventListener('click', () => openPlace(p.key));
    labelsEl.appendChild(el);
    islandLabels.push({ el, pos: p.label, id: 'place:' + p.key, w: 0, h: 0, place: true });
  });
  let bLabels = [];
  function setBuildingLabels(islandId) {
    bLabels.forEach((l) => l.el.remove()); bLabels = [];
    if (!islandId || islandId === 'hub') return;
    I[islandId].buildings.forEach((b) => {
      const el = document.createElement('button');
      el.className = 'blabel ' + b.type; el.textContent = shortCo(b.co);
      el.setAttribute('aria-label', `${b.co}（${TYPE[b.type]}）`);
      el.addEventListener('click', () => selectBuilding(b.id));
      labelsEl.appendChild(el);
      bLabels.push({ el, pos: BP[b.id].top.clone().add(new V3(0, 0.3, 0)), id: b.id, w: 0, h: 0 });
    });
  }
  function shortCo(co) { return co.split(/[、／]/)[0].replace(/(股份有限公司|有限公司|企業股份|工業股份)$/, ''); }
  const pv = new V3();
  function updateLabels() {
    const w = window.innerWidth, h = window.innerHeight;
    const placed = [];
    const all = bLabels.map((l) => ({ ...l, pri: state.building === l.id ? 0 : 1 })).concat(islandLabels.filter((l) => { if (l.place && !state.real && l.id.slice(6) !== state.focusPlace) { l.el.classList.add('hide'); return false; } return true; }).map((l) => ({ ...l, pri: l.place ? (state.focusPlace === l.id.slice(6) ? 0.05 : state.place === l.id.slice(6) ? 0.2 : 0.4) : l.decor ? 3 : (state.island === l.id ? 0.5 : 2) })));
    all.sort((a, b) => a.pri - b.pri);
    all.forEach((l) => {
      pv.copy(l.pos).project(camera);
      const vis = pv.z < 1 && pv.x > -1.2 && pv.x < 1.2 && pv.y > -1.2 && pv.y < 1.2;
      if (!vis) { l.el.classList.add('hide'); return; }
      if (!l.el._w) { l.el._w = l.el.offsetWidth; l.el._h = l.el.offsetHeight; }
      const bx = (pv.x + 1) / 2 * w - l.el._w / 2, by = (1 - pv.y) / 2 * h - l.el._h;
      const offs = [[0, 0], [0, -l.el._h - 4], [0, l.el._h + 4], [l.el._w * 0.55, 0], [-l.el._w * 0.55, 0]];
      let ok = null;
      for (const [ox, oy] of offs) {
        const r = { x: bx + ox, y: by + oy, x2: bx + ox + l.el._w, y2: by + oy + l.el._h };
        const blocked = r.y < occCur.T - 4 || (occCur.R > 1 && r.x2 > w - occCur.R) || (occCur.B > 1 && r.y2 > h - occCur.B) || r.x < 0 || r.x2 > w;
        const clash = placed.some((q) => r.x < q.x2 + 2 && r.x2 > q.x - 2 && r.y < q.y2 + 2 && r.y2 > q.y - 2);
        if (!blocked && !clash) { ok = r; break; }
        if (l.pri > 1.5 && ox === 0 && oy === 0 && blocked) break;
      }
      if (!ok) { l.el.classList.add('hide'); return; }
      placed.push(ok); l.el.classList.remove('hide');
      l.el.style.transform = `translate3d(${ok.x.toFixed(1)}px, ${ok.y.toFixed(1)}px, 0)`;
    });
  }
  window.addEventListener('resize', () => { [...islandLabels, ...bLabels].forEach((l) => { l.el._w = 0; }); });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { islandLabels.forEach((l) => { l.el._w = 0; }); });

  /* ───────── 小智對話框 ───────── */
  const bubble = $('#bubble'); let bubbleOn = false; let bubbleAnchor = null; let talkingNPC = null;
  const TIPS = [
    '打開「協作線」，可以看到同一種 AI 技術怎麼跨島擴散。',
    '橘色鋸齒屋頂是示範場域，藍色屋頂大樓是躍昇計畫。',
    '試試在搜尋框輸入「排程」或「知識庫」。',
    '按右上角的時間按鈕，可以看到夜晚的島。',
    `${D.lines[0].name}是最多島嶼共用的 AI 能力，共 ${D.lines[0].members.length} 個場域。`,
  ];
  function showBubble() {
    const tipTxt = TIPS[Math.floor(Math.random() * TIPS.length)];
    bubble.innerHTML = `<b>我是小智！</b><br>${esc(tipTxt)}<div class="b-acts"><button class="pri" data-a="tour">帶我逛一圈</button><button data-a="rand">隨機看一個場域</button><button data-a="x">關閉</button></div>`;
    bubble.style.display = 'block'; bubbleOn = true; bubbleAnchor = { obj: bot.g, dy: 4.2 };
  }
  function talkNPC(idx) {
    hideBubble();
    const n = npcs[idx]; n.talking = true; talkingNPC = n;
    const isl = n.isl === 'hub' ? { name: 'AI 中樞島' } : I[n.isl];
    const goB = n.sp.go && B[n.sp.go];
    bubble.innerHTML = `<b>${esc(n.sp.role)}</b><span class="b-isle">${esc(isl.name)}</span><p class="b-line">「${esc(n.sp.line)}」</p><div class="b-acts">${goB ? `<button class="pri" data-a="go" data-id="${goB.id}">看${esc(shortCo(goB.co))}怎麼做</button>` : (n.isl === 'hub' ? '<button class="pri" data-a="hub">認識中樞島</button>' : '')}<button data-a="x">再見</button></div>`;
    bubble.style.display = 'block'; bubbleOn = true; bubbleAnchor = { obj: n.group, dy: 3.1 };
  }
  function hideBubble() { bubble.style.display = 'none'; bubbleOn = false; if (talkingNPC) { talkingNPC.talking = false; talkingNPC = null; } }
  bubble.addEventListener('click', (e) => {
    const a = e.target.closest('button'); if (!a) return;
    hideBubble();
    if (a.dataset.a === 'tour') startTour(0);
    else if (a.dataset.a === 'go') selectBuilding(a.dataset.id);
    else if (a.dataset.a === 'hub') openHub();
    else if (a.dataset.a === 'rand') { const b = D.buildings[Math.floor(Math.random() * D.buildings.length)]; selectBuilding(b.id); }
  });
  function placeBubble() {
    if (!bubbleOn) return;
    if (!bubbleAnchor) return;
    pv.copy(bubbleAnchor.obj.position).add(new V3(0, bubbleAnchor.dy, 0)).project(camera);
    if (pv.z > 1) { bubble.style.display = 'none'; return; } bubble.style.display = 'block';
    const x = (pv.x + 1) / 2 * window.innerWidth, y = (1 - pv.y) / 2 * window.innerHeight;
    bubble.style.transform = `translate3d(${(x - 125).toFixed(0)}px, ${(y - bubble.offsetHeight - 10).toFixed(0)}px, 0)`;
  }

  /* ───────── 狀態與選取 ───────── */
  const state = { island: null, building: null, line: null, allLines: false, query: '', tour: null, real: false, place: null, focusPlace: null };
  function refreshPins() {
    const list = [];
    if (state.line) L[state.line].members.forEach((id) => list.push({ id, color: L[state.line].color }));
    else if (state.query) searchHits().forEach((b) => list.push({ id: b.id, color: b.type === 'demo' ? '#E8742A' : '#2F6FD0' }));
    setPins(list.filter((p) => p.id !== state.building));
    islandLabels.forEach((l) => {
      if (l.decor) return;
      let dim = false;
      if (state.line) dim = l.id !== 'hub' && !L[state.line].islands.includes(l.id);
      else if (state.query) { const hits = searchHits(); dim = l.id !== 'hub' && !hits.some((b) => b.island === l.id); }
      l.el.classList.toggle('dim', dim);
      l.el.classList.toggle('on', l.id === state.island);
    });
  }
  function focusIsland(id) {
    if (state.island === id) return;
    state.island = id; setBuildingLabels(id); refreshPins();
  }
  function selectIsland(id, opts) {
    opts = opts || {};
    state.building = null; selPin.visible = false;
    focusIsland(id);
    const c = IP[id].center;
    if (!opts.noFly) flyTo(islandView(id));
    state.place = null; setFocusPlace(null); if (state.real) showArcs(I[id].buildings.map((b) => b.id)); else clearArcs();
    openPanel('island', id, opts);
    setHash('i-' + id);
  }
  function islandView(id) { const v = fitPoints(hexPoints(IP[id].center, R * 1.25, 10), 0.86, 0, 1.3); v.dist = clamp(v.dist, 40, 160); return v; }
  function selectBuilding(id, opts) {
    opts = opts || {};
    const b = B[id]; state.building = id;
    focusIsland(b.island); refreshPins();
    selPin.visible = true;
    const r = b.real, key = r && r.key && PL[r.key] ? r.key : null;
    state.place = null; setFocusPlace(key, key ? shortCo(b.co) : null);
    if (key) showArcs([id]); else clearArcs();
    openPanel('building', id, opts); measureOcc();
    if (!opts.noFly) flyTo(key ? realView(id) : closeView(id));
    setHash('b-' + id);
  }
  function closeView(id) { const v = fitPoints(hexPoints(BP[id].pos, 12, 6), 0.88, ctl.az, 1.15); v.dist = clamp(v.dist, 34, 100); return v; }
  function realView(id) {
    const b = B[id]; const v = fitPoints(placePoints([b.real.key], [id]).concat(hexPoints(BP[id].pos, 7, 6)), 0.8, ctl.az, 1.2);
    v.dist = clamp(v.dist, 38, maxDist()); return v;
  }
  function selectLine(id) {
    state.line = id; state.query = ''; $('#q').value = ''; $('#search').classList.remove('has-q');
    Object.keys(lineCache).forEach((k) => { if (lineCache[k].isMesh) lineCache[k].visible = false; });
    if (state.allLines) D.lines.forEach((l) => { if (l.id !== id) getLine(l.id, true).visible = true; });
    if (id) { const m = getLine(id); m.visible = true; bot.ride = { mesh: m, u: 0, dir: 1 }; bot.mode = 'ride'; bot.cube.visible = true; bot.cube.material.color.set(L[id].color); }
    else stopRide();
    refreshPins();
    $('#btnLines').setAttribute('aria-pressed', String(!!id || state.allLines));
  }
  function stopRide() {
    if (bot.mode === 'ride') { bot.ride = null; bot.cube.visible = false; hopTo(bot.at, clock.elapsedTime); }
  }
  function setAllLines(on) {
    state.allLines = on;
    D.lines.forEach((l) => { const m = getLine(l.id, true); m.visible = on && l.id !== state.line; });
    $('#btnLines').setAttribute('aria-pressed', String(on || !!state.line));
  }
  function clearSelection() {
    state.building = null; selPin.visible = false; focusIsland(null); refreshPins();
    if (state.focusPlace) { setFocusPlace(null); if (!state.real) clearArcs(); }
  }

  /* ───────── 面板 ───────── */
  const panel = $('#panel'), pBody = $('#pBody');
  let navStack = [], current = null;
  function openPanel(kind, id, opts) {
    opts = opts || {};
    if (current && !(current.kind === kind && current.id === id) && !opts.replace) navStack.push(current);
    if (opts.resetHistory) navStack = [];
    current = { kind, id };
    stopSpeak();
    render();
    document.body.classList.add('panel-open');
    if (isMobile()) setSheet(kind === 'home' || kind === 'lines' ? 'mid' : 'half');
    pBody.scrollTop = 0;
    setTimeout(measureOcc, 30); setTimeout(measureOcc, 400);
  }
  function closePanel() {
    document.body.classList.remove('panel-open'); current = null; navStack = []; stopSpeak();
    clearArcs(); state.place = null; setFocusPlace(null);
    if (state.tour) endTour();
    clearSelection(); setHash('');
    setTimeout(measureOcc, 30); setTimeout(measureOcc, 400);
  }
  function render() {
    if (!current) return;
    const { kind, id } = current;
    $('#pBack').hidden = navStack.length === 0;
    $('#pSpeak').hidden = !('speechSynthesis' in window) || !(kind === 'building' || kind === 'island' || kind === 'hub');
    let html = '';
    if (kind === 'home') html = homeHTML();
    else if (kind === 'island') html = islandHTML(I[id]);
    else if (kind === 'building') html = buildingHTML(B[id]);
    else if (kind === 'line') html = lineHTML(L[id]);
    else if (kind === 'lines') html = linesHTML();
    else if (kind === 'hub') html = hubHTML();
    else if (kind === 'real') html = realHTML();
    else if (kind === 'place') html = placeHTML(id);
    pBody.innerHTML = html;
  }
  $('#pClose').addEventListener('click', closePanel);
  $('#pBack').addEventListener('click', () => {
    const prev = navStack.pop(); if (!prev) return;
    current = null;
    if (prev.kind === 'building') selectBuilding(prev.id, { replace: true });
    else if (prev.kind === 'island') selectIsland(prev.id, { replace: true });
    else if (prev.kind === 'line') openLine(prev.id, { replace: true });
    else if (prev.kind === 'place') openPlace(prev.id, { replace: true });
    else if (prev.kind === 'real') openReal({ replace: true });
    else { current = prev; render(); }
    $('#pBack').hidden = navStack.length === 0;
  });
  pBody.addEventListener('click', (e) => {
    const stp = e.target.closest('[data-step]');
    if (stp && current && current.kind === 'building') {
      const b = B[current.id]; const k = +stp.dataset.step; const x = b.steps[k];
      $$('.step', pBody).forEach((el) => { const on = el === stp; el.classList.toggle('on', on); el.setAttribute('aria-selected', String(on)); });
      $('#stepbox', pBody).innerHTML = stepBox({ n: x[0], ai: x[1] || [] }, k);
      return;
    }
    const t = e.target.closest('[data-go]'); if (!t) return;
    const [k, v] = t.dataset.go.split(':');
    if (k === 'b') selectBuilding(v);
    else if (k === 'i') selectIsland(v);
    else if (k === 'l') openLine(v);
    else if (k === 'lines') openLines();
    else if (k === 'hub') openHub();
    else if (k === 'tour') startTour(0);
    else if (k === 'list') openList();
    else if (k === 'about') openAbout();
    else if (k === 'all') { setAllLines(!state.allLines); render(); }
    else if (k === 'clearline') { selectLine(null); render(); }
    else if (k === 'p') openPlace(v);
    else if (k === 'real') openReal();
    else if (k === 'ri') realIsland(v);
    else if (k === 'rb') realBuilding(v);
    else if (k === 'bz') flyTo(closeView(v), 900);
  });

  const kpiHTML = (k) => `<div class="kpi"><b>${esc(k[0])}</b><span>${esc(k[1])}</span></div>`;
  const chipType = (b) => `<span class="chip ${b.type}"><span class="sw" style="background:${b.type === 'demo' ? 'var(--demo)' : 'var(--leap)'}"></span>${TYPE[b.type]}</span>`;
  const cardHTML = (b, showIsle) => `<button class="card ${b.type}" data-go="b:${b.id}"><span class="c-top">${chipType(b)}${showIsle ? `<span>${pad2(I[b.island].no)} ${esc(I[b.island].name)}</span>` : `<span>${esc(b.partner || b.domain || '')}</span>`}</span><b>${esc(b.co)}</b><span class="c-short">${esc(b.short)}</span></button>`;
  const lineChip = (l) => `<button class="linechip" style="--lc:${l.color}" data-go="l:${l.id}"><i></i>${esc(l.name)}</button>`;
  const ICON = {
    tour: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="4"/><path d="M12 12v3M8 21h8M12 15c-3 0-5 1.5-5 3h10c0-1.5-2-3-5-3z"/></svg>',
    lines: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="5" cy="17" r="2.5"/><circle cx="19" cy="17" r="2.5"/><circle cx="12" cy="6" r="2.5"/><path d="M6.5 15 10 8M17.5 15 14 8M7.5 17.5h9" stroke-dasharray="2 2.2"/></svg>',
    list: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 6h11M9 12h11M9 18h11M4 6h1M4 12h1M4 18h1"/></svg>',
    hub: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3v3M10 21l1-12h2l1 12M7 21h10"/><circle cx="12" cy="7" r="2"/></svg>',
    pin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 21s-6-5.6-6-11a6 6 0 0 1 12 0c0 5.4-6 11-6 11z"/><circle cx="12" cy="10" r="2.3"/></svg>',
  };

  const COUNTY = { med: '台北', elec: '台北', bio: '新竹', retail: '桃園・新北', semi: '新竹', tool: '台中', mob: '台中', svc: '花蓮', mach: '台中・南投', metal: '彰化', chem: '雲林', food: '嘉義', tex: '台南', fast: '高雄' };
  const stCount = (ids) => { const c = { ok: 0, near: 0, far: 0, unk: 0 }; ids.forEach((id) => { const r = B[id].real; c[r ? r.st : 'unk']++; }); return c; };
  const stBar = (c) => { const n = (c.ok + c.near + c.far + c.unk) || 1; return `<div class="stbar" role="img" aria-label="${ST_ORDER.map((k) => `${ST[k].s} ${c[k]}`).join('、')}">${ST_ORDER.map((k) => (c[k] ? `<i style="width:${(c[k] / n * 100).toFixed(1)}%;background:${ST[k].c}"></i>` : '')).join('')}</div>`; };
  const stChip = (st) => `<span class="stchip" style="--sc:${ST[st].c}"><i></i>${ST[st].t}</span>`;
  function realTop(b) {
    const r = b.real; if (!r) return '';
    const i = I[b.island]; const has = r.key && PL[r.key];
    return `<div class="realtop" style="--sc:${ST[r.st].c}"><div class="rt-a"><span class="pin-ic">${ICON.pin}</span><span>實際所在地<b>${esc(r.addr)}</b></span></div><div class="rt-b">${stChip(r.st)}<span>${esc(i.name)}在地圖上代表${esc(COUNTY[i.id])}${i.id === 'svc' ? '（象徵位置）' : ''}</span></div>${has ? `<div class="rt-btns"><button data-go="rb:${b.id}">${ICON.pin}看實際位置</button><button data-go="bz:${b.id}">放大看建築</button></div>` : ''}</div>`;
  }
  function realSec(b) {
    const r = b.real; if (!r) return '';
    const i = I[b.island];
    return `<div class="sec"><h3>實際所在地</h3><div class="realbox" style="--sc:${ST[r.st].c}">${stChip(r.st)}<p class="ra">${esc(r.addr)}</p><p class="rn">${esc(i.name)}在地圖上代表${esc(COUNTY[i.id] || '')}${i.id === 'svc' ? '（象徵位置）' : ''}。</p>${r.key && PL[r.key] ? `<button class="linklike" data-go="rb:${b.id}">在地圖上看實際位置 ›</button>` : ''}</div></div>`;
  }
  function realIsleSec(i) {
    const c = stCount(i.buildings.map((b) => b.id));
    const parts = [`${c.ok} 家在${esc(COUNTY[i.id])}一帶`];
    if (c.near) parts.push(`${c.near} 家在隔壁縣市`);
    if (c.far) parts.push(`<b style="color:${ST.far.c}">${c.far} 家在其他地區</b>`);
    if (c.unk) parts.push(`${c.unk} 家待確認`);
    const cnt = isleCounts(i); const dist = Object.keys(cnt).sort((a, b) => cnt[b] - cnt[a] || PL[a].pos.z - PL[b].pos.z).map((k) => `<button class="pchip" data-go="p:${k}">${esc(placeShort(k))} ${cnt[k]}</button>`).join('');
    return `<div class="sec"><h3>廠商的實際位置</h3><p>島上 ${i.buildings.length} 家廠商中，${parts.join('、')}。</p>${stBar(c)}<div class="pchips"><span>實際分布</span>${dist}</div><button class="linklike" data-go="ri:${i.id}" style="margin-top:8px">在地圖上看連線 ›</button></div>`;
  }
  function realHTML() {
    const all = stCount(D.buildings.map((b) => b.id));
    const places = Object.values(PL).filter((q) => q.ids.length).sort((a, b) => b.ids.length - a.ids.length);
    return `<div class="eyebrow">實際位置</div>
      <h2 class="p-title">廠商實際在哪裡？</h2>
      <p class="p-sub">島嶼按產業排列，紅色圖釘標出廠商真正所在的縣市</p>
      <p>同一個產業的廠商其實散布在全台各地。點圖釘看那裡有哪些廠商，彩色連線會連到它們在島上的建築。</p>
      <div class="tiles four">${ST_ORDER.map((k) => `<div class="tile"><b style="color:${ST[k].c}">${all[k]}</b><span>${ST[k].s}</span></div>`).join('')}</div>
      <div class="legend-st">${ST_ORDER.map((k) => `<span><i style="background:${ST[k].c}"></i>${ST[k].t}</span>`).join('')}</div>
      <div class="sec"><h3>各地圖釘</h3><div class="placelist">${places.map((q) => `<button class="prow" data-go="p:${q.key}"><span class="pin-ic">${ICON.pin}</span><b>${esc(q.name)}</b><span class="pn">${q.ids.length} 家</span>${stBar(stCount(q.ids))}</button>`).join('')}</div></div>
      <div class="sec"><h3>各島廠商的實際位置</h3><div class="placelist">${ISLES.map((i) => { const c = stCount(i.buildings.map((b) => b.id)); return `<button class="prow" data-go="ri:${i.id}"><span class="no" style="background:${i.color}">${pad2(i.no)}</span><b>${esc(i.name)}</b><span class="pn">${c.far ? `${c.far} 家在外地` : '大致在地'}</span>${stBar(c)}</button>`; }).join('')}</div></div>
      <p class="note">所在地依據：躍昇計畫用計畫書摘要上的通訊地址；示範場域用公開的公司登記或徵才資料。多半是總部地址，工廠可能在別處。「一致」指與島嶼代表的縣市相同；文創服務島放在花蓮是象徵位置，所以島上廠商都標為不同。</p>`;
  }
  function placeHTML(key) {
    const q = PL[key]; const c = stCount(q.ids);
    const groups = ST_ORDER.map((k) => [k, q.ids.filter((id) => B[id].real.st === k)]).filter((g) => g[1].length);
    return `<div class="eyebrow"><button data-go="real">實際位置</button><span>${q.ids.length} 家廠商</span></div>
      <h2 class="p-title"><span class="pin-ic big">${ICON.pin}</span>${esc(q.name)}</h2>
      <p class="p-sub">這些廠商的總部或工廠在${esc(q.name)}</p>
      ${stBar(c)}
      ${groups.map(([k, ids]) => `<div class="sec"><h3>${ST[k].t}・${ids.length}</h3><div class="cards">${ids.map((id) => { const b = B[id], i = I[b.island]; return `<button class="card rcard" data-go="b:${id}" style="--sc:${ST[k].c}"><span class="c-top"><span class="isle"><i style="background:${i.color}"></i>${pad2(i.no)} ${esc(i.name)}（${esc(COUNTY[i.id] || '')}）</span></span><b>${esc(b.co)}</b><span class="c-short">${esc(b.real.addr)}</span></button>`; }).join('')}</div></div>`).join('')}`;
  }
  function homeHTML() {
    return `<div class="eyebrow">歡迎上島</div>
      <h2 class="p-title">AI產業技術島</h2>
      <p class="p-sub">${D.meta.updated}整理</p>
      <p>把 ${nDemo} 個 AI 整合示範場域、${nLeap} 件 AI 應用躍昇計畫，變成 ${ISLES.length} 座可以自由探索的產業島。每座島是一個產業，島上的每棟小建築就是一個 AI 場域。</p>
      <div class="tiles">
        <div class="tile"><b>${ISLES.length}</b><span>座產業島</span></div>
        <div class="tile demo"><b>${nDemo}</b><span>示範場域</span></div>
        <div class="tile leap"><b>${nLeap}</b><span>躍昇計畫</span></div>
      </div>
      <div class="btns">
        <button class="btn pri" data-go="tour">${ICON.tour}<span>跟著小智逛一圈<small>從 01 ${esc(ISLES[0].name)}出發，一共 ${STOPS.length} 站</small></span></button>
        <button class="btn" data-go="lines">${ICON.lines}<span>打開技術協作線<small>看 ${D.lines.length} 種 AI 技術怎麼串起各島</small></span></button>
        <button class="btn" data-go="real">${ICON.pin}<span>看廠商的實際位置<small>用圖釘標出廠商真正在哪個縣市</small></span></button>
        <button class="btn" data-go="hub">${ICON.hub}<span>認識 AI 中樞島<small>試產線、創新、平台三大計畫</small></span></button>
        <button class="btn" data-go="list">${ICON.list}<span>用清單瀏覽全部場域<small>適合快速查找與比較</small></span></button>
      </div>
      <div class="sec"><h3>怎麼逛</h3>
        <ul><li>拖曳畫面移動；滾輪或雙指縮放；右鍵或雙指旋轉。</li><li>點島名牌或島嶼，看這座島有哪些 AI 場域。</li><li>橘色鋸齒屋頂是<b>示範場域</b>，藍色屋頂大樓是<b>躍昇計畫</b>。</li><li>島嶼依產業聚落的位置排成 Q 版台灣：半導體在新竹、水五金在鹿港、石化在麥寮、扣件在岡山。</li><li>點島上走動的人偶聽他們說話；點小機器人「小智」，它會帶你導覽。</li></ul>
      </div>
      <p class="note">內容整理自 AI 整合示範場域規劃簡報與 AI應用躍昇計畫審查資料，屬規劃階段資訊。<button class="linklike" data-go="about">看資料來源</button></p>`;
  }
  function islandHTML(i) {
    const demos = i.buildings.filter((b) => b.type === 'demo'), leaps = i.buildings.filter((b) => b.type === 'leap');
    const lines = D.lines.filter((l) => i.lineSet.has(l.id));
    const tourHead = state.tour ? `<div class="eyebrow">小智導覽・第 ${state.tour.idx + 1} 站／共 ${STOPS.length} 站</div>` : `<div class="eyebrow">第 ${pad2(i.no)} 座島</div>`;
    return `${tourHead}
      <h2 class="p-title" style="--accent:${i.color}">${esc(i.name)}</h2>
      <p class="p-sub">${esc(i.tagline)}</p>
      ${i.loc ? `<p class="locline"><span>產業聚落</span>${esc(i.loc)}</p>` : ''}
      <p>${esc(i.desc)}</p>
      ${i.stat ? `<div class="sec" style="--accent:${i.color}"><h3>產業小檔案・${esc(i.stat.label)}</h3>
        <div class="stat"><div><b>${esc(i.stat.export)}</b><span>2025 出口產值</span></div><div><b>${esc(i.stat.ratio)}</b><span>出口占比</span></div><div><b>${esc(i.stat.firms)}</b><span>總廠家數</span></div></div></div>` : ''}
      ${demos.length ? `<div class="sec" style="--accent:var(--demo)"><h3>示範場域・${demos.length}</h3><div class="cards">${demos.map((b) => cardHTML(b)).join('')}</div></div>` : ''}
      ${leaps.length ? `<div class="sec" style="--accent:var(--leap)"><h3>躍昇計畫・${leaps.length}</h3><div class="cards">${leaps.map((b) => cardHTML(b)).join('')}</div></div>` : ''}
      ${lines.length ? `<div class="sec"><h3>經過這座島的協作線</h3><div class="linechips">${lines.map(lineChip).join('')}</div></div>` : ''}
      ${realIsleSec(i)}
      ${crewHTML(i.crew, i.id)}`;
  }
  function crewHTML(crew, islId) {
    if (!crew || !crew.length) return '';
    return `<div class="sec"><h3>島上的人怎麼說</h3><p class="hint-s">在島上走動的人偶都可以點，他們會說出這個產業的 AI 轉型需求。</p><div class="quotes">${crew.map((c) => `<div class="quote"><span class="q-who"><i style="background:${c.top}"></i>${esc(c.role)}</span><p>「${esc(c.line)}」</p>${c.go && B[c.go] ? `<button class="linklike" data-go="b:${c.go}">看${esc(shortCo(B[c.go].co))}怎麼做 ›</button>` : ''}</div>`).join('')}</div></div>`;
  }
  function stepsHTML(b) {
    const st = (b.steps || []).map((x) => ({ n: x[0], ai: x[1] || [] }));
    if (!st.length) return '';
    const first = Math.max(0, st.findIndex((x) => x.ai.length));
    const nAI = st.filter((x) => x.ai.length).length;
    return `<div class="sec"><h3>實際導入之製程段</h3>
      <p class="hint-s">共 ${st.length} 段，其中 <b>${nAI}</b> 段導入 AI。點任一段，看看導入了哪些 AI 技術。</p>
      <div class="flow" role="tablist" aria-label="製程段">${st.map((x, k) => `<button class="step${x.ai.length ? ' ai' : ''}${k === first ? ' on' : ''}" role="tab" aria-selected="${k === first}" data-step="${k}"><i>${k + 1}</i><span>${esc(x.n)}</span>${x.ai.length ? `<em>AI×${x.ai.length}</em>` : ''}</button>`).join('<span class="arrow" aria-hidden="true">›</span>')}</div>
      <div class="stepbox" id="stepbox">${stepBox(st[first], first)}</div></div>`;
  }
  function stepBox(x, k) {
    if (!x) return '';
    return x.ai.length
      ? `<div class="sb-h"><span>第 ${k + 1} 段</span><b>${esc(x.n)}</b></div><div class="sb-cap">導入的 AI 技術</div><ul>${x.ai.map((a) => `<li>${esc(a)}</li>`).join('')}</ul>`
      : `<div class="sb-h"><span>第 ${k + 1} 段</span><b>${esc(x.n)}</b></div><p class="sb-none">這一段維持既有作業，本案沒有在此導入 AI；它的資料可提供給前後段的 AI 模組使用。</p>`;
  }
  function buildingHTML(b) {
    const i = I[b.island]; const sib = i.buildings; const k = sib.indexOf(b);
    const prev = sib[(k - 1 + sib.length) % sib.length], next = sib[(k + 1) % sib.length];
    const acc = b.type === 'demo' ? 'var(--demo)' : 'var(--leap)';
    return `<div style="--accent:${acc}">
      <div class="eyebrow"><button data-go="i:${i.id}">${pad2(i.no)} ${esc(i.name)}</button>${chipType(b)}<span>${b.type === 'demo' ? '合作法人：' + esc(b.partner) : esc(b.domain) + '領域'}</span></div>
      <h2 class="p-title">${esc(b.co)}</h2>
      <p class="p-sub">${esc(b.title)}</p>
      ${realTop(b)}
      <p class="lead">${esc(b.short)}</p>
      ${b.pos ? `<div class="sec"><h3>產業（業者）定位</h3><p>${esc(b.pos)}</p></div>` : ''}
      ${b.pain ? `<div class="sec"><h3>急需 AI 升級轉型的痛點</h3><p>${esc(b.pain)}</p></div>` : ''}
      ${stepsHTML(b)}
      ${(b.kpi && b.kpi.length) || (b.gain && b.gain.length) || (b.timeline && b.timeline.length) ? `<div class="sec"><h3>預期效益</h3>${b.kpi && b.kpi.length ? `<div class="kpis">${b.kpi.map(kpiHTML).join('')}</div>` : ''}${!(b.kpi && b.kpi.length) && b.gain && b.gain.length ? `<ul class="gains">${b.gain.map((g) => `<li>${esc(g)}</li>`).join('')}</ul><p class="hint-s" style="margin-top:6px !important">計畫未列量化指標，依計畫內容整理。</p>` : ''}${b.timeline && b.timeline.length ? `<div class="sb-cap" style="margin-top:12px">時程</div><div class="tl">${b.timeline.map((t) => `<div><b>${esc(t[0])}</b><span>${esc(t[1])}</span></div>`).join('')}</div>` : ''}</div>` : ''}
      ${b.lines.length ? `<div class="sec"><h3>技術協作線</h3><div class="linechips">${b.lines.map((id) => lineChip(L[id])).join('')}</div></div>` : ''}
      ${b.note ? `<p class="note">${esc(b.note)}</p>` : ''}
      ${b.src && b.src.length ? `<div class="srcs"><b>網路補充資料來源</b>${b.src.map((x) => `<a href="${esc(x[1])}" target="_blank" rel="noopener">${esc(x[0])}</a>`).join('')}</div>` : ''}
      ${sib.length > 1 ? `<div class="pn"><button data-go="b:${prev.id}">‹ 上一個<b>${esc(shortCo(prev.co))}</b></button><button data-go="b:${next.id}">下一個 ›<b>${esc(shortCo(next.co))}</b></button></div>` : ''}
    </div>`;
  }
  function lineHTML(l) {
    const groups = ISLES.filter((i) => l.islands.includes(i.id)).map((i) => ({ i, bs: l.members.map((m) => B[m]).filter((b) => b.island === i.id) }));
    return `<div style="--accent:${l.color}">
      <div class="eyebrow"><button data-go="lines">技術協作線</button></div>
      <h2 class="p-title">${esc(l.name)}</h2>
      <p class="p-sub"><span style="display:inline-block;width:36px;height:6px;border-radius:3px;background:${l.color};vertical-align:middle;margin-right:8px"></span>${l.members.length} 個場域・串起 ${l.islands.length} 座島</p>
      <p>${esc(l.desc)}</p>
      <p class="note">小智正沿著這條線，把技術模組送到每一個場域。</p>
      ${groups.map((g) => `<div class="grp-isle" style="--c:${g.i.color}"><i></i>${pad2(g.i.no)} ${esc(g.i.name)}</div><div class="cards">${g.bs.map((b) => cardHTML(b)).join('')}</div>`).join('')}
      <div class="btns"><button class="btn" data-go="clearline">收起這條協作線</button></div>
    </div>`;
  }
  function linesHTML() {
    const ls = D.lines.slice().sort((a, b) => b.members.length - a.members.length);
    return `<div class="eyebrow">技術協作線</div>
      <h2 class="p-title">同一種 AI，串起不同的島</h2>
      <p>同一種 AI 能力，常常在不同產業重複出現。選一條線，看看它經過哪些場域；這也代表一個場域的成果，可以擴散到哪些產業。</p>
      <div class="toggle-row"><span>同時顯示全部協作線</span><button class="switch" role="switch" aria-checked="${state.allLines}" data-go="all" aria-label="同時顯示全部協作線"></button></div>
      <div class="linelist">${ls.map((l) => `<button class="lineitem${state.line === l.id ? ' on' : ''}" style="--lc:${l.color}" data-go="l:${l.id}"><i></i><b>${esc(l.name)}</b><span>${l.members.length} 場域・${l.islands.length} 島</span></button>`).join('')}</div>`;
  }
  function hubHTML() {
    const h = D.hub;
    return `<div class="eyebrow">島的中心</div>
      <h2 class="p-title">AI 中樞島</h2>
      <p class="p-sub">${esc(h.tagline)}</p>
      <p class="locline"><span>位置</span>${esc(h.loc || '')}（台灣的中央山脈）</p>
      <p>${esc(h.intro)}</p>
      <div class="sec"><h3>三座塔，三股力量</h3><div class="pillars">${h.pillars.map((p) => `<div class="pillar" style="--pc:${p.color}"><b>${esc(p.name)}</b><em>${esc(p.role)}</em><p>${esc(p.text)}</p></div>`).join('')}</div></div>
      <div class="sec"><h3>AI 智慧分級（L）</h3><table class="lvl">${h.levels.map((r) => `<tr><td>${r[0]}</td><td>${esc(r[1])}</td><td>${esc(r[2])}</td></tr>`).join('')}</table>
        <p style="margin-top:10px;font-size:15px;color:var(--ink-soft)">導入範圍（S）：${h.scopes.map((s) => `<b>${s[0]}</b> ${esc(s[1])}`).join('、')}</p>
        <p style="font-size:15px">${esc(h.levelNote)}</p></div>
      <div class="sec"><h3>Demo Site 怎麼選</h3><ul>${h.criteria.map((c) => `<li>${esc(c)}</li>`).join('')}</ul></div>
      <div class="sec"><h3>AI應用躍昇計畫</h3>
        <div class="tiles"><div class="tile"><b>${h.leap.applied}</b><span>件申請</span></div><div class="tile leap"><b>${h.leap.passed}</b><span>件審查通過</span></div><div class="tile"><b>${h.leap.domains}</b><span>大領域</span></div></div>
        <p style="font-size:15px">總經費${esc(h.leap.total)}，政府補助${esc(h.leap.subsidy)}。${esc(h.leap.note)}</p></div>
      ${crewHTML(h.crew, 'hub')}`;
  }
  function openLine(id, opts) { selectLine(id); clearBuildingOnly(); openPanel('line', id, opts); setHash('l-' + id); fitLine(id); }
  function clearBuildingOnly() { state.building = null; selPin.visible = false; focusIsland(null); refreshPins(); if (state.focusPlace) { setFocusPlace(null); if (!state.real) clearArcs(); } }
  function fitLine(id) {
    const pts = []; L[id].members.forEach((m) => pts.push(...hexPoints(BP[m].pos, 5, 14)));
    const v = fitPoints(pts, 0.82, 0, 1.08); v.dist = clamp(v.dist, 50, maxDist()); flyTo(v);
  }
  function openLines() { openPanel('lines', null); if (!state.line && !state.allLines) setAllLines(true); }
  function setReal(on) {
    state.real = on;
    if (!on) { clearArcs(); state.place = null; if (state.building && state.focusPlace) showArcs([state.building]); }
    updatePinVis();
    $('#btnReal').setAttribute('aria-pressed', String(on));
    document.body.classList.toggle('real-on', on);
  }
  function placePoints(keys, ids) {
    const pts = [];
    keys.forEach((k) => { const q = PL[k]; pts.push(q.pos.clone(), q.head.clone().add(new V3(0, 2.5, 0))); });
    (ids || []).forEach((id) => pts.push(...hexPoints(BP[id].pos, 3, 7)));
    return pts;
  }
  function openReal(opts) {
    setReal(true); clearArcs(); state.place = null; clearSelection();
    openPanel('real', null, opts); setHash('real');
    flyTo(homeView(), 1100);
  }
  function openPlace(key, opts) {
    const q = PL[key]; if (!q) return;
    setReal(true); state.building = null; selPin.visible = false; focusIsland(null); refreshPins(); setFocusPlace(null);
    state.place = key; showArcs(q.ids);
    openPanel('place', key, opts); setHash('p-' + key);
    const v = fitPoints(placePoints([key], q.ids), 0.8, ctl.az, 1.15); v.dist = clamp(v.dist, 50, maxDist()); flyTo(v, 1100);
  }
  function realBuilding(id) {
    const b = B[id]; if (!b.real || !PL[b.real.key]) return;
    setFocusPlace(b.real.key, shortCo(b.co)); showArcs([id]);
    flyTo(realView(id), 1100);
  }
  function realIsland(id) {
    const ids = I[id].buildings.map((b) => b.id); setReal(true); showArcs(ids);
    const keys = [...new Set(ids.map((x) => B[x].real && B[x].real.key).filter((k) => k && PL[k]))];
    const v = fitPoints(placePoints(keys, ids).concat(hexPoints(IP[id].center, R, 6)), 0.8, ctl.az, 1.15); v.dist = clamp(v.dist, 50, maxDist()); flyTo(v, 1100);
  }
  $('#btnReal').addEventListener('click', () => {
    if (state.real) { const k = current && current.kind; setReal(false); if (k === 'real' || k === 'place') { openPanel('home', null, { resetHistory: true }); setHash(''); } }
    else openReal();
  });
  function openHub() {
    clearSelection(); focusIsland('hub');
    const c = IP.hub.center;
    const v = fitPoints(hexPoints(c, R * 1.25, 18), 0.8, 0, 1.35); v.dist = clamp(v.dist, 40, 170); flyTo(v);
    openPanel('hub', 'hub'); setHash('hub');
  }
  $('#btnLines').addEventListener('click', () => {
    if (current && current.kind === 'lines') { closePanel(); return; }
    openLines();
  });
  $('#homeBtn').addEventListener('click', () => { if (state.tour) endTour(); selectLine(null); setAllLines(false); clearSelection(); openPanel('home', null, { resetHistory: true }); navStack = []; render(); flyTo(homeView(), 900); });

  /* 手機抽屜 */
  let sheet = 'half';
  function sheetPx() { const h = window.innerHeight; return Math.round(sheet === 'full' ? h * 0.88 : sheet === 'mid' ? h * 0.4 : h * 0.5); }
  function setSheet(s) {
    sheet = s;
    panel.style.setProperty('--sheet-h', sheetPx() + 'px');
    setTimeout(measureOcc, 20); setTimeout(measureOcc, 350);
  }
  $('#grab').addEventListener('click', () => setSheet(sheet === 'full' ? 'half' : 'full'));
  (() => { let y0 = null; const g = $('#grab');
    g.addEventListener('touchstart', (e) => { y0 = e.touches[0].clientY; }, { passive: true });
    g.addEventListener('touchend', (e) => { if (y0 == null) return; const dy = e.changedTouches[0].clientY - y0; if (dy < -30) setSheet('full'); else if (dy > 60 && sheet === 'full') setSheet('half'); else if (dy > 60) closePanel(); y0 = null; });
  })();

  /* ───────── 朗讀 ───────── */
  let speaking = false;
  function stopSpeak() { if ('speechSynthesis' in window) window.speechSynthesis.cancel(); speaking = false; $('#speakLbl').textContent = '朗讀'; }
  $('#pSpeak').addEventListener('click', () => {
    if (!('speechSynthesis' in window)) return;
    if (speaking) { stopSpeak(); return; }
    const text = pBody.innerText.replace(/[‹›]/g, '').replace(/\n+/g, '。');
    try {
      const u = new SpeechSynthesisUtterance(text); u.lang = 'zh-TW'; u.rate = 0.92; u.pitch = 1;
      const v = window.speechSynthesis.getVoices().find((x) => /zh[-_]TW/i.test(x.lang)) || window.speechSynthesis.getVoices().find((x) => /^zh/i.test(x.lang));
      if (v) u.voice = v;
      u.onend = () => { speaking = false; $('#speakLbl').textContent = '朗讀'; };
      window.speechSynthesis.speak(u); speaking = true; $('#speakLbl').textContent = '停止';
    } catch (e) { speaking = false; }
  });

  /* ───────── 搜尋 ───────── */
  const norm = (s) => String(s).toLowerCase().replace(/\s+/g, '');
  D.buildings.forEach((b) => { b._hay = norm([b.co, b.title, b.short, b.pain, (b.ai || []).join(' '), b.partner, b.domain, I[b.island].name, b.lines.map((l) => L[l].name).join(' '), TYPE[b.type]].join(' ')); });
  let hitCache = { q: null, list: [] };
  function searchHits() {
    if (hitCache.q === state.query) return hitCache.list;
    const terms = state.query.split(/[\s,，、]+/).map(norm).filter(Boolean);
    const list = terms.length ? D.buildings.filter((b) => terms.every((t) => b._hay.includes(t))) : [];
    hitCache = { q: state.query, list }; return list;
  }
  const hl = (s, q) => { const t = esc(s); if (!q) return t; const qs = q.split(/[\s,，、]+/).filter(Boolean).map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')); return qs.length ? t.replace(new RegExp('(' + qs.join('|') + ')', 'gi'), '<mark>$1</mark>') : t; };
  const SUGGEST = ['瑕疵檢測', '排程', '知識庫', '數位孿生', '配方', '扣件', '醫療', '智慧眼鏡', '金屬中心', '資策會'];
  const qEl = $('#q'), sEl = $('#search'), rEl = $('#results');
  let kbIdx = -1;
  function renderResults() {
    const q = qEl.value.trim();
    if (!q) {
      rEl.innerHTML = `<div class="r-head">試試這些關鍵字</div><div class="chips-suggest">${SUGGEST.map((s) => `<button data-s="${esc(s)}">${esc(s)}</button>`).join('')}</div>`;
      return;
    }
    const nq = norm(q);
    const isl = ISLES.filter((i) => norm(i.name + i.tagline).includes(nq)).slice(0, 4);
    const lns = D.lines.filter((l) => norm(l.name + l.desc).includes(nq)).slice(0, 4);
    const bs = searchHits().slice(0, 30);
    let h = '';
    if (isl.length) h += `<div class="r-head">島嶼</div>` + isl.map((i) => `<button class="r-item" data-go="i:${i.id}"><span class="dot" style="background:${i.color}"></span><span><b>${pad2(i.no)} ${hl(i.name, q)}</b><span>${esc(i.tagline)}</span></span></button>`).join('');
    if (lns.length) h += `<div class="r-head">技術協作線</div>` + lns.map((l) => `<button class="r-item" data-go="l:${l.id}"><span class="dot" style="background:${l.color}"></span><span><b>${hl(l.name, q)}</b><span>${l.members.length} 個場域・${l.islands.length} 座島</span></span></button>`).join('');
    if (bs.length) h += `<div class="r-head">AI 場域・找到 ${searchHits().length} 個（已在地圖上標出）</div>` + bs.map((b) => `<button class="r-item" data-go="b:${b.id}"><span class="dot" style="background:${b.type === 'demo' ? 'var(--demo)' : 'var(--leap)'}"></span><span><b>${hl(b.co, q)}</b><span>${pad2(I[b.island].no)} ${esc(I[b.island].name)}・${hl(b.short, q)}</span></span></button>`).join('');
    if (!h) h = `<div class="r-empty">找不到「${esc(q)}」。可以換個說法，例如「檢測」「預測」「客服」，或直接點上面的島嶼逛逛。</div>`;
    rEl.innerHTML = h; kbIdx = -1;
  }
  let qTimer = null;
  qEl.addEventListener('input', () => {
    sEl.classList.toggle('has-q', !!qEl.value);
    clearTimeout(qTimer);
    qTimer = setTimeout(() => {
      state.query = qEl.value.trim();
      if (state.query && state.line) { state.line = null; Object.keys(lineCache).forEach((k) => { if (lineCache[k].isMesh && !k.endsWith(':t')) lineCache[k].visible = false; }); stopRide(); }
      refreshPins(); renderResults(); sEl.classList.add('open');
    }, 120);
  });
  qEl.addEventListener('focus', () => { renderResults(); sEl.classList.add('open'); hideBubble(); });
  qEl.addEventListener('keydown', (e) => {
    const items = $$('.r-item', rEl);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); if (!items.length) return; kbIdx = (kbIdx + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length; items.forEach((x, k) => x.classList.toggle('kb', k === kbIdx)); items[kbIdx].scrollIntoView({ block: 'nearest' }); }
    else if (e.key === 'Enter') { const it = items[kbIdx >= 0 ? kbIdx : 0]; if (it) it.click(); }
    else if (e.key === 'Escape') { sEl.classList.remove('open'); qEl.blur(); }
  });
  $('#qClear').addEventListener('click', () => { qEl.value = ''; state.query = ''; sEl.classList.remove('has-q'); refreshPins(); renderResults(); qEl.focus(); });
  rEl.addEventListener('click', (e) => {
    const s = e.target.closest('[data-s]');
    if (s) { qEl.value = s.dataset.s; qEl.dispatchEvent(new Event('input')); qEl.focus(); return; }
    const g = e.target.closest('[data-go]'); if (!g) return;
    const [k, v] = g.dataset.go.split(':');
    sEl.classList.remove('open'); qEl.blur(); if (isMobile()) setSearchOpen(false);
    if (k === 'b') selectBuilding(v); else if (k === 'i') selectIsland(v); else if (k === 'l') { qEl.value = ''; sEl.classList.remove('has-q'); state.query = ''; openLine(v); }
  });
  document.addEventListener('pointerdown', (e) => { if (!e.target.closest('#search') && !e.target.closest('#btnSearch')) { sEl.classList.remove('open'); if (isMobile() && !qEl.value) setSearchOpen(false); } });
  function setSearchOpen(on) { document.body.classList.toggle('search-open', on); $('#btnSearch').setAttribute('aria-pressed', String(on)); if (on) setTimeout(() => qEl.focus(), 30); measureOcc(); }
  $('#btnSearch').addEventListener('click', () => setSearchOpen(!document.body.classList.contains('search-open')));

  /* ───────── 導覽 ───────── */
  const tourbar = $('#tourbar'); let tourTimer = 0;
  function startTour(idx) {
    selectLine(null); setAllLines(false);
    state.tour = { idx: idx || 0, auto: state.tour ? state.tour.auto : false };
    tourbar.classList.add('on'); goTour();
  }
  function goTour() {
    const s = STOPS[state.tour.idx];
    hopTo(state.tour.idx, clock.elapsedTime); tourTimer = 0;
    $('#tPos').textContent = `${state.tour.idx + 1} / ${STOPS.length}`;
    $('#tAuto').setAttribute('aria-pressed', String(state.tour.auto));
    const keep = state.tour;
    if (s === 'hub') openHub(); else selectIsland(s, { replace: true });
    state.tour = keep; render();
    navStack = [];
    $('#pBack').hidden = true;
  }
  function endTour() { state.tour = null; tourbar.classList.remove('on'); render(); }
  $('#tPrev').addEventListener('click', () => { if (!state.tour) return; state.tour.idx = (state.tour.idx - 1 + STOPS.length) % STOPS.length; goTour(); });
  $('#tNext').addEventListener('click', () => { if (!state.tour) return; state.tour.idx = (state.tour.idx + 1) % STOPS.length; goTour(); });
  $('#tAuto').addEventListener('click', () => { if (!state.tour) return; state.tour.auto = !state.tour.auto; tourTimer = 0; $('#tAuto').setAttribute('aria-pressed', String(state.tour.auto)); });
  $('#tEnd').addEventListener('click', () => { endTour(); });

  /* ───────── 清單 / 關於 ───────── */
  setupListAndAbout();
  function openList() { $('#list').classList.add('on'); renderList(); }

  /* ───────── 網址錨點 ───────── */
  let hashLock = false;
  function setHash(h) { try { hashLock = true; window.history.replaceState(null, '', h ? '#' + h : location.pathname + location.search); } catch (e) { /* 沙盒中可能不允許 */ } hashLock = false; }
  function openFromHash() {
    const h = (location.hash || '').slice(1);
    if (!h) return false;
    if (h.startsWith('b-') && B[h.slice(2)]) { selectBuilding(h.slice(2)); return true; }
    if (h.startsWith('i-') && I[h.slice(2)]) { selectIsland(h.slice(2)); return true; }
    if (h.startsWith('l-') && L[h.slice(2)]) { openLine(h.slice(2)); return true; }
    if (h === 'hub') { openHub(); return true; }
    if (h === 'real') { openReal(); return true; }
    if (h.startsWith('p-') && PL[h.slice(2)]) { openPlace(h.slice(2)); return true; }
    if (h === 'tour') { startTour(0); return true; }
    if (h === 'list') { openList(); return false; }
    return false;
  }
  window.addEventListener('hashchange', () => { if (!hashLock) openFromHash(); });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if ($('#about').classList.contains('on')) { $('#about').classList.remove('on'); return; }
    if ($('#list').classList.contains('on')) { $('#list').classList.remove('on'); return; }
    if (bubbleOn) { hideBubble(); return; }
    if (document.body.classList.contains('panel-open') && document.activeElement !== qEl) closePanel();
  });

  /* ───────── 主迴圈 ───────── */
  const clock = new THREE.Clock();
  function resize() {
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    if (isMobile() && current) setSheet(sheet);
    measureOcc();
  }
  window.addEventListener('resize', resize);
  resize(); applyView();
  Object.assign(ctl, homeView()); clampCtl(); camUpdate();

  let first = true;
  function loop() {
    const dt = Math.min(0.05, clock.getDelta()); const t = clock.elapsedTime; const now = performance.now();
    stepEnv(dt); applyView(dt); stepAnim(now); camUpdate();
    sky.position.copy(camera.position);
    const camD = ctl.dist;
    scene.fog.near = camD + 120; scene.fog.far = camD + 700;
    waterU.uFogNear.value = scene.fog.near; waterU.uFogFar.value = scene.fog.far; waterU.uTime.value = t;
    sun.position.copy(ctl.target).addScaledVector(env.sun, 180); sun.target.position.copy(ctl.target);
    // 陰影範圍跟著視野
    const span = clamp(camD * 0.75, 40, 110); sc.left = -span; sc.right = span; sc.top = span; sc.bottom = -span; sc.updateProjectionMatrix();
    // 中樞島
    hubFx.rings.forEach((m, k) => { m.rotation.z = t * (0.4 + k * 0.18) * (k % 2 ? -1 : 1); });
    hubFx.orb.scale.setScalar(1 + Math.sin(t * 2.2) * 0.06);
    hubFx.beam.rotation.y = t * 0.6;
    clouds.forEach((m) => { m.position.x += dt * m.userData.speed; if (m.position.x > 320) m.position.x = -320; });
    boats.forEach((m) => { const u = m.userData; u.a += dt * u.sp; m.position.set(BOUNDS.cx + Math.cos(u.a) * u.rx, 0.1 + Math.sin(t * 1.6 + u.a * 5) * 0.08, BOUNDS.cz + Math.sin(u.a) * u.rz); m.rotation.y = -u.a; m.rotation.z = Math.sin(t * 1.3 + u.a) * 0.05; });
    // 標記
    const bobY = Math.sin(t * 2.4) * 0.35;
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sv = new V3(1, 1, 1), rs = 1 + 0.12 * Math.sin(t * 3);
    pinList.forEach((p, k) => {
      const tp = BP[p.id].top; q.setFromAxisAngle(UP, t * 1.5 + k);
      m4.compose(new V3(tp.x, tp.y + 0.6 + bobY, tp.z), q, sv); pins.setMatrixAt(k, m4);
      const bp = BP[p.id].pos; m4.compose(new V3(bp.x, G + 0.16, bp.z), new THREE.Quaternion(), new V3(rs, 1, rs)); rings.setMatrixAt(k, m4);
    });
    pins.instanceMatrix.needsUpdate = true; rings.instanceMatrix.needsUpdate = true;
    if (state.building) { const tp = BP[state.building].top; selPin.position.set(tp.x, tp.y + 1.3 + bobY, tp.z); selPin.rotation.y = t * 2; }
    Object.keys(lineCache).forEach((k) => { const m = lineCache[k]; if (m.isMesh && m.visible) m.material.uniforms.uTime.value = t; });
    stepBot(t, dt); stepNPCs(t, dt); stepArcs(t);
    if (state.tour && state.tour.auto) { tourTimer += dt; if (tourTimer > 11) { state.tour.idx = (state.tour.idx + 1) % STOPS.length; goTour(); } }
    renderer.render(scene, camera);
    updateLabels(); placeBubble();
    if (first) { first = false; $('#loading').classList.add('done'); }
    requestAnimationFrame(loop);
  }

  function stepBot(t, dt) {
    const g = bot.g;
    if (bot.mode === 'ride' && bot.ride) {
      const r = bot.ride; const curve = r.mesh.userData.curve; const len = r.mesh.userData.len;
      r.u += dt * (reduceMotion ? 0 : 7.5) / len * r.dir;
      if (r.u >= 1) { r.u = 1; r.dir = -1; } else if (r.u <= 0) { r.u = 0; r.dir = 1; }
      const p = curve.getPointAt(r.u), tg = curve.getTangentAt(r.u).multiplyScalar(r.dir);
      g.position.set(p.x, p.y + 0.2, p.z);
      g.rotation.set(0, Math.atan2(tg.x, tg.z), 0);
      bot.armL.rotation.z = -2.6; bot.armR.rotation.z = 2.6;
      bot.cube.rotation.y = t * 2; bot.cube.rotation.x = t;
      return;
    }
    bot.armL.rotation.z = -0.35;
    if (bot.mode === 'hop' && bot.hop) {
      const h = bot.hop; const u = clamp((t - h.t0) / h.dur, 0, 1);
      g.position.lerpVectors(h.from, h.to, u); g.position.y += Math.sin(Math.PI * u) * h.h;
      const dx = h.to.x - h.from.x, dz = h.to.z - h.from.z; if (Math.abs(dx) + Math.abs(dz) > 0.01) g.rotation.y = Math.atan2(dx, dz);
      const sq = u < 0.12 ? 1 - u * 2 : u > 0.9 ? 1 - (1 - u) * 2.5 : 1.04;
      g.scale.set(1.35 / Math.sqrt(sq), 1.35 * sq, 1.35 / Math.sqrt(sq));
      bot.armR.rotation.z = 0.35 + Math.sin(Math.PI * u) * 1.6; bot.armL.rotation.z = -0.35 - Math.sin(Math.PI * u) * 1.6;
      if (u >= 1) { bot.mode = 'stand'; bot.hop = null; g.scale.setScalar(1.35); bot.nextAt = t + 5.5; }
      return;
    }
    // 站在講台上揮手
    g.rotation.y = lerp(g.rotation.y, Math.atan2(camera.position.x - g.position.x, camera.position.z - g.position.z), Math.min(1, dt * 4));
    g.position.y = IP[STOPS[bot.at]].podium.y + Math.abs(Math.sin(t * 3)) * 0.06;
    bot.armR.rotation.z = 2.5 + Math.sin(t * 9) * 0.35;
    if (!state.tour && !bubbleOn && t > bot.nextAt && !reduceMotion) hopTo((bot.at + 1) % STOPS.length, t);
  }

  /* 啟動 */
  const opened = openFromHash();
  if (!opened) { openPanel('home', null, { resetHistory: true }); }
  setTimeout(() => { measureOcc(); if (!opened && !ctl.anim && !touched) Object.assign(ctl, homeView()); }, 60);
  requestAnimationFrame(loop);

  /* ───────── 清單與關於（可在無 3D 時使用） ───────── */
  function setupListAndAbout() {
    $('#btnList').addEventListener('click', () => { $('#list').classList.add('on'); renderList(); });
    $('#lClose').addEventListener('click', () => $('#list').classList.remove('on'));
    $('#btnAbout').addEventListener('click', openAbout);
    $('#abClose').addEventListener('click', () => $('#about').classList.remove('on'));
    $('#about').addEventListener('click', (e) => { if (e.target.id === 'about') $('#about').classList.remove('on'); });
    $$('#lGroup button').forEach((b) => b.addEventListener('click', () => { $$('#lGroup button').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); renderList(); }));
    $$('#lType button').forEach((b) => b.addEventListener('click', () => { $$('#lType button').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); renderList(); }));
    $('#lBody').addEventListener('click', (e) => {
      const g = e.target.closest('[data-go]'); if (!g) return;
      const [k, v] = g.dataset.go.split(':');
      $('#list').classList.remove('on');
      if (window.__sel) window.__sel(k, v);
    });
  }
  function openAbout() { $('#about').classList.add('on'); }
  function renderList() {
    const grp = $('#lGroup [aria-pressed="true"]').dataset.g, typ = $('#lType [aria-pressed="true"]').dataset.t;
    const ok = (b) => typ === 'all' || b.type === typ;
    let h = '';
    if (grp === 'island') {
      h = ISLES.map((i) => { const bs = i.buildings.filter(ok); if (!bs.length) return ''; return `<div class="l-sec"><h3 style="--c:${i.color}"><i>${pad2(i.no)}</i>${esc(i.name)}</h3><p>${esc(i.desc)}</p><div class="l-grid">${bs.map((b) => cardHTML(b)).join('')}</div></div>`; }).join('');
    } else {
      h = D.lines.slice().sort((a, b) => b.members.length - a.members.length).map((l) => { const bs = l.members.map((m) => B[m]).filter(ok); if (!bs.length) return ''; return `<div class="l-sec"><h3 style="--c:${l.color}"><i>${bs.length}</i>${esc(l.name)}</h3><p>${esc(l.desc)}</p><div class="l-grid">${bs.map((b) => cardHTML(b, true)).join('')}</div></div>`; }).join('');
    }
    $('#lBody').innerHTML = h;
  }
  window.__sel = (k, v) => { if (k === 'b') selectBuilding(v); else if (k === 'i') selectIsland(v); else if (k === 'l') openLine(v); else if (k === 'npc') { const j = npcs.findIndex((n) => n.isl === v); if (j >= 0) talkNPC(j); } };
  window.__npcAt = (isl, k = 0) => { const n = npcs.find((m) => m.isl === isl && m.k === k); if (!n) return null; const p = n.group.position.clone().add(new V3(0, 1.4, 0)).project(camera); return [(p.x + 1) / 2 * window.innerWidth, (1 - p.y) / 2 * window.innerHeight]; };

  function bootUIOnly() { /* 由外層處理 */ }
})();

/* 無 3D 時的備援：只啟用清單與關於 */
(function () {
  if (window.THREE) {
    try { const c = document.createElement('canvas'); if (c.getContext('webgl2') || c.getContext('webgl')) return; } catch (e) { /* 落入備援 */ }
  }
  const D = window.ISLAND_DATA; const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  document.getElementById('loading').classList.add('done');
  $('#nowebgl').style.display = 'block'; setTimeout(() => { $('#nowebgl').style.display = 'none'; }, 5000);
  const I = {}; D.islands.forEach((i) => { I[i.id] = i; });
  function render() {
    const typ = document.querySelector('#lType [aria-pressed="true"]').dataset.t;
    $('#lBody').innerHTML = D.islands.map((i) => {
      const bs = D.buildings.filter((b) => b.island === i.id && (typ === 'all' || b.type === typ));
      return `<div class="l-sec"><h3 style="--c:${i.color}"><i>${String(i.no).padStart(2, '0')}</i>${esc(i.name)}</h3><p>${esc(i.desc)}</p><div class="l-grid">${bs.map((b) => `<div class="card ${b.type}"><span class="c-top">${b.type === 'demo' ? '示範場域・' + esc(b.partner) : '躍昇計畫・' + esc(b.domain)}</span><b>${esc(b.co)}</b><span class="c-short">${esc(b.short)}</span><span class="c-short" style="margin-top:6px">${esc((b.ai || []).join('；'))}</span></div>`).join('')}</div></div>`;
    }).join('');
  }
  document.querySelectorAll('#lType button').forEach((b) => b.addEventListener('click', () => { document.querySelectorAll('#lType button').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); render(); }));
  $('#lClose').style.display = 'none';
  $('#list').classList.add('on'); render();
  $('#btnAbout').addEventListener('click', () => $('#about').classList.add('on'));
  $('#abClose').addEventListener('click', () => $('#about').classList.remove('on'));
})();
