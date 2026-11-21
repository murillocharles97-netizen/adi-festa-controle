/* VECONI Fluxo V1 — tema claro/escuro e elementos visuais compartilhados.
 *
 * Só apresentação: não lê nem grava dados do negócio, não chama Firebase.
 * Carregado no <head> (sem defer) para aplicar o tema antes da primeira pintura.
 * Preferência: localStorage "veconi-theme" = "light" | "dark"; sem escolha, segue o sistema.
 */
(function () {
  'use strict';
  const KEY = 'veconi-theme';
  const root = document.documentElement;
  const media = window.matchMedia ? matchMedia('(prefers-color-scheme: dark)') : { matches: false, addEventListener() {} };
  const META = { light: '#f3f6f7', dark: '#061519' };

  const stored = () => { try { const v = localStorage.getItem(KEY); return v === 'dark' || v === 'light' ? v : null; } catch { return null; } };
  let sessionTheme = null;
  const preference = () => sessionTheme || stored();
  const current = () => preference() || (media.matches ? 'dark' : 'light');

  function syncToggles(theme) {
    document.querySelectorAll('[data-theme-toggle]').forEach(button => {
      const dark = theme === 'dark';
      button.setAttribute('aria-pressed', String(dark));
      button.setAttribute('aria-label', dark ? 'Usar tema claro' : 'Usar tema escuro');
      button.title = dark ? 'Tema escuro ativo. Mudar para claro' : 'Tema claro ativo. Mudar para escuro';
    });
  }
  function apply() {
    const theme = current();
    root.dataset.theme = theme;
    root.dataset.themeSource = preference() ? 'user' : 'system';
    const meta = document.querySelector('meta[name="theme-color"]');
    // O cabeçalho mobile é escuro nos dois temas; a barra do sistema acompanha só no desktop.
    if (meta && !(window.matchMedia && matchMedia('(max-width: 767px)').matches)) meta.content = META[theme];
    syncToggles(theme);
    syncArea();
    return theme;
  }
  function set(theme) {
    if (theme !== 'dark' && theme !== 'light') return apply();
    try { localStorage.setItem(KEY, theme); sessionTheme = null; } catch { sessionTheme = theme; }
    root.classList.add('vf-theme-switching');
    const result = apply();
    clearTimeout(set.timer);
    set.timer = setTimeout(() => root.classList.remove('vf-theme-switching'), 420);
    window.dispatchEvent?.(new CustomEvent('veconi-theme-changed', { detail: { theme: result } }));
    return result;
  }
  const toggle = () => set(current() === 'dark' ? 'light' : 'dark');
  // 1C: telas migradas ao design system. Marcadores curtos no <html> escopam o CSS:
  // vf-area-1c (tela migrada, qualquer tema), vf-dark-1c (+ tema escuro) e data-vf-route.
  const DARK_AREAS = new Set(['vender', 'clientes', 'produtos', 'financeiro']);
  function syncArea() {
    const route = document.getElementById('app')?.dataset.route || '', inArea = DARK_AREAS.has(route);
    root.classList.toggle('vf-area-1c', inArea);
    root.classList.toggle('vf-dark-1c', inArea && root.dataset.theme === 'dark');
    if (inArea) root.dataset.vfRoute = route; else delete root.dataset.vfRoute;
  }
  media.addEventListener?.('change', () => { if (!preference()) apply(); });
  window.addEventListener?.('storage', event => { if (event.key === KEY) apply(); });
  apply();

  function bindToggles(scope = document) {
    scope.querySelectorAll('[data-theme-toggle]').forEach(button => {
      if (button.dataset.themeBound) return;
      button.dataset.themeBound = 'true';
      button.addEventListener('click', toggle);
    });
    syncToggles(current());
  }
  function watchRoute() {
    const app = document.getElementById('app');
    if (app && window.MutationObserver) new MutationObserver(syncArea).observe(app, { attributes: true, attributeFilter: ['data-route'] });
    syncArea();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => { bindToggles(); watchRoute(); });
  else { bindToggles(); watchRoute(); }

  /* ---------- Assinatura 1B: geometria em camadas ----------
   * Cubos isométricos de alturas diferentes, faces foscas em tons próximos ao fundo,
   * linhas de camada finas (influência da impressão 3D) e um V extrudado em turquesa fosco.
   * Tudo gerado aqui como SVG estático; cores vêm dos tokens do tema (CSS). A textura de
   * cubos do fundo é CSS (--vf-texture), para cobrir o cabeçalho inteiro sem custo. */
  // A entrada orquestrada acontece uma vez por sessão; depois, re-renderizações (troca de
  // período, sincronização) não repetem a animação.
  let entering = false;
  function settleEntrance() {
    if (entering || root.classList.contains('vf-entered')) return;
    entering = true;
    setTimeout(() => root.classList.add('vf-entered'), 1800);
  }
  const R3 = Math.sqrt(3) / 2;
  const fx = n => Math.round(n * 10) / 10;
  const pts = list => list.map(([x, y]) => `${fx(x)},${fx(y)}`).join(' ');
  const iso = (ox, oy, s) => (x, y, z) => [ox + (x - y) * R3 * s, oy + (x + y) * .5 * s - z * s];
  const area = list => list.reduce((sum, [x, y], i) => { const [u, v] = list[(i + 1) % list.length]; return sum + x * v - u * y; }, 0) / 2;

  // Bloco: faces esquerda/direita/topo + linhas de camada nas faces laterais.
  function block(P, [x, y, w, d, h, kind = ''], index, layer) {
    const top = [P(x, y, h), P(x + w, y, h), P(x + w, y + d, h), P(x, y + d, h)];
    const right = [P(x + w, y, h), P(x + w, y + d, h), P(x + w, y + d, 0), P(x + w, y, 0)];
    const left = [P(x, y + d, h), P(x + w, y + d, h), P(x + w, y + d, 0), P(x, y + d, 0)];
    let lines = '';
    for (let z = layer; layer && z < h - layer * .5; z += layer) {
      const a = P(x, y + d, z), b = P(x + w, y + d, z), c = P(x + w, y, z);
      lines += `M${fx(a[0])} ${fx(a[1])}L${fx(b[0])} ${fx(b[1])}L${fx(c[0])} ${fx(c[1])}`;
    }
    return `<g class="vf-geo-block ${kind}" style="--i:${index}"><polygon class="vf-face-l" points="${pts(left)}"/><polygon class="vf-face-r" points="${pts(right)}"/><polygon class="vf-face-t" points="${pts(top)}"/>${lines ? `<path class="vf-layer" d="${lines}"/>` : ''}</g>`;
  }

  // V da marca como objeto: perfil (u, z) num plano de frente para quem olha (diagonal
  // x = −y, que a isometria projeta sem inclinação), extrudado para trás. A espessura
  // aparece só nas faces de cima, como uma peça impressa em camadas.
  const V_OUTLINE = [[0, 1], [.31, 1], [.5, .42], [.69, 1], [1, 1], [.6, 0], [.4, 0]];
  function sculptureV(P, [x, y, z, W, H, D], id, layer) {
    const F = (u, v, back) => P(x + (u * W - back * D) * Math.SQRT1_2, y - (u * W + back * D) * Math.SQRT1_2, z + v * H);
    const front = V_OUTLINE.map(([u, v]) => F(u, v, 0));
    const ccw = area(V_OUTLINE) > 0, frontSign = Math.sign(area(front));
    const sides = [];
    V_OUTLINE.forEach(([u1, v1], i) => {
      const [u2, v2] = V_OUTLINE[(i + 1) % V_OUTLINE.length];
      const quad = [F(u2, v2, 0), F(u1, v1, 0), F(u1, v1, 1), F(u2, v2, 1)];
      if (Math.sign(area(quad)) !== frontSign) return;
      const du = u2 - u1, dv = v2 - v1, len = Math.hypot(du, dv) || 1;
      const nz = (ccw ? -du : du) / len;
      sides.push({ quad, nz, depth: (v1 + v2) / 2 });
    });
    sides.sort((a, b) => b.depth - a.depth);
    let lines = '';
    for (let v = layer; layer && v < 1; v += layer) { const a = F(-.1, v, 0), b = F(1.1, v, 0); lines += `M${fx(a[0])} ${fx(a[1])}L${fx(b[0])} ${fx(b[1])}`; }
    return `<g class="vf-geo-v"><clipPath id="${id}-v"><polygon points="${pts(front)}"/></clipPath>`
      + sides.map(s => `<polygon class="${s.nz > .3 ? 'vf-v-top' : 'vf-v-side'}" points="${pts(s.quad)}"/>`).join('')
      + `<polygon class="vf-v-front" points="${pts(front)}"/>`
      + `<g clip-path="url(#${id}-v)"><path class="vf-v-layer" d="${lines}"/><polygon class="vf-v-light" points="${pts(front)}"/></g></g>`;
  }

  // Composição: poucos volumes. Pilares altos atrás (recortados no topo), o V num pedestal
  // ao centro, degraus baixos à frente (recortados na base). [x, y, w, d, h, tipo]
  const BLOCKS = [
    [-1, -2, 1, 1, 1.6], [0, -2, 1, 1, 1], [1, -3, 1, 1, 1.8, 'is-tall'], [2, -2, 1, 1, 1.3], [3, -2, 1, 1, .8],
    [-2, -1, 1, 1, .8], [-2, 0, 1, 1, .45, 'is-accent'], [3, -1, 1, 1, .55], [4, 0, 1, 1, .35],
    [3, 1, 1, 1, .5], [3, 3, 1, 1, .3], [-1, 3, 1, 1, .25],
  ];
  const SCENES = {
    hero: { box: [0, 0, 360, 170], origin: [230, 118], scale: 20, layer: .16, vLayer: .055, blocks: BLOCKS },
    mobile: { box: [0, 0, 130, 84], origin: [70, 54], scale: 11, layer: .25, vLayer: 0, blocks: BLOCKS.filter(b => b[0] > -2) },
  };
  // Pedestal quadrado; o V fica um pouco à frente do centro dele.
  const PLINTH = [0, 0, 2.4, 2.4, .5], VSHAPE = [1.45 - 1.3 * Math.SQRT1_2, 1.45 + 1.3 * Math.SQRT1_2, 0, 2.6, 3, .6];
  let geoSeq = 0;
  function geoArt(variant = 'hero') {
    settleEntrance();
    const scene = SCENES[variant] || SCENES.hero, id = `vf-geo-${++geoSeq}`;
    const [bx, by, bw, bh] = scene.box, P = iso(scene.origin[0], scene.origin[1], scene.scale);
    const all = scene.blocks.map((b, i) => ({ b, i })).sort((p, q) => (p.b[0] + p.b[1]) - (q.b[0] + q.b[1]));
    const [px, py, pw, pd, ph] = PLINTH;
    // Atrás do pedestal: separado dele no lado de trás de algum eixo; o resto vem depois do V.
    const back = all.filter(({ b }) => b[0] + b[2] <= px || b[1] + b[3] <= py);
    const front = all.filter(item => !back.includes(item));
    const shadow = P(px + pw / 2 + .2, py + pd / 2 + .2, 0);
    const v = VSHAPE.slice(), layer = scene.layer;
    v[2] = ph; // o V repousa sobre o pedestal
    return `<svg class="vf-geo vf-geo--${variant}" viewBox="${bx} ${by} ${bw} ${bh}" preserveAspectRatio="xMaxYMin slice" aria-hidden="true" focusable="false">`
      + `<defs><radialGradient id="${id}-shade"><stop offset="0" class="vf-shade-in"/><stop offset="1" class="vf-shade-out"/></radialGradient></defs>`
      + `<g class="vf-geo-cluster">`
      + back.map(({ b, i }) => block(P, b, i, 0)).join('')
      + `<ellipse class="vf-geo-shadow" cx="${fx(shadow[0])}" cy="${fx(shadow[1])}" rx="${fx(scene.scale * 2.7)}" ry="${fx(scene.scale * 1.05)}" fill="url(#${id}-shade)"/>`
      + block(P, [px, py, pw, pd, ph, 'is-plinth'], 20, layer)
      + sculptureV(P, v, id, scene.vLayer)
      + front.map(({ b, i }) => block(P, b, i, 0)).join('')
      + '</g></svg>';
  }
  const flowArt = geoArt; // compatibilidade com quem ainda chama pelo nome da 1A

  function firstName() {
    const session = window.FirebaseSession || {};
    const raw = session.profile?.displayName || session.profile?.name || session.profile?.ownerName || session.user?.displayName || '';
    const name = String(raw).trim().split(/\s+/)[0] || '';
    return /^[\p{L}'-]{2,24}$/u.test(name) ? name : '';
  }
  function greeting(now = new Date()) {
    const hour = now.getHours();
    const base = hour < 5 ? 'Boa noite' : hour < 12 ? 'Bom dia' : hour < 18 ? 'Boa tarde' : 'Boa noite';
    const name = firstName();
    return name ? `${base}, ${name}` : base;
  }

  /* ---------- Curva monotônica: suaviza sem criar picos que os dados não têm ---------- */
  function monotonePath(points) {
    if (!points.length) return '';
    if (points.length === 1) return `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`;
    const n = points.length, dx = [], m = [], t = [];
    for (let i = 0; i < n - 1; i++) { dx[i] = points[i + 1].x - points[i].x; m[i] = (points[i + 1].y - points[i].y) / (dx[i] || 1); }
    t[0] = m[0]; t[n - 1] = m[n - 2];
    for (let i = 1; i < n - 1; i++) t[i] = m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2;
    for (let i = 0; i < n - 1; i++) {
      if (m[i] === 0) { t[i] = 0; t[i + 1] = 0; continue; }
      const a = t[i] / m[i], b = t[i + 1] / m[i], h = a * a + b * b;
      if (h > 9) { const s = 3 / Math.sqrt(h); t[i] = s * a * m[i]; t[i + 1] = s * b * m[i]; }
    }
    let d = `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`;
    for (let i = 0; i < n - 1; i++) {
      const p = points[i], q = points[i + 1], h = dx[i] / 3;
      d += ` C ${(p.x + h).toFixed(1)} ${(p.y + t[i] * h).toFixed(1)} ${(q.x - h).toFixed(1)} ${(q.y - t[i + 1] * h).toFixed(1)} ${q.x.toFixed(1)} ${q.y.toFixed(1)}`;
    }
    return d;
  }
  // Teto "redondo" para a grade (1, 2, 2,5, 5 × 10^n). Só escala visual.
  function niceMax(value) {
    if (!(value > 0)) return 1;
    const power = 10 ** Math.floor(Math.log10(value)), unit = value / power;
    return (unit <= 1 ? 1 : unit <= 2 ? 2 : unit <= 2.5 ? 2.5 : unit <= 5 ? 5 : 10) * power;
  }
  const compactMoney = value => {
    const abs = Math.abs(value), sign = value < 0 ? '−' : '';
    if (abs >= 1e6) return `${sign}R$ ${(abs / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mi`;
    if (abs >= 1e4) return `${sign}R$ ${(abs / 1e3).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mil`;
    return `${sign}R$ ${abs.toLocaleString('pt-BR', { maximumFractionDigits: 0 })}`;
  };

  /* Tooltip + guia vertical do gráfico; ponteiro e teclado. */
  function bindChart(scope) {
    const chart = scope?.querySelector?.('[data-vf-chart]');
    if (!chart || chart.dataset.vfBound) return;
    chart.dataset.vfBound = 'true';
    const tip = chart.querySelector('[data-chart-tooltip]'), guide = chart.querySelector('[data-chart-guide]');
    const points = [...chart.querySelectorAll('[data-chart-point]')];
    if (!tip || !points.length) return;
    const svg = chart.querySelector('svg');
    const show = index => {
      const point = points[index]; if (!point) return;
      points.forEach((p, i) => p.classList.toggle('is-active', i === index));
      const vb = svg.viewBox.baseVal, box = svg.getBoundingClientRect(), host = chart.getBoundingClientRect();
      const x = box.left - host.left + (Number(point.getAttribute('cx')) / vb.width) * box.width;
      const y = box.top - host.top + (Number(point.getAttribute('cy')) / vb.height) * box.height;
      tip.innerHTML = `<b>${point.dataset.value}</b><span>${point.dataset.label}</span>`;
      tip.hidden = false;
      const half = tip.offsetWidth / 2, left = Math.min(Math.max(x, half + 4), host.width - half - 4);
      tip.style.setProperty('--tip-x', `${left}px`); tip.style.setProperty('--tip-y', `${y}px`);
      if (guide) { guide.setAttribute('x1', point.getAttribute('cx')); guide.setAttribute('x2', point.getAttribute('cx')); guide.classList.add('is-visible'); }
    };
    const hide = () => { tip.hidden = true; points.forEach(p => p.classList.remove('is-active')); guide?.classList.remove('is-visible'); };
    chart.addEventListener('pointermove', event => {
      const box = svg.getBoundingClientRect(), vb = svg.viewBox.baseVal, x = (event.clientX - box.left) / box.width * vb.width;
      let best = 0, distance = Infinity;
      points.forEach((p, i) => { const d = Math.abs(Number(p.getAttribute('cx')) - x); if (d < distance) { distance = d; best = i; } });
      show(best);
    });
    chart.addEventListener('pointerleave', hide);
    points.forEach((point, index) => {
      point.addEventListener('focus', () => show(index));
      point.addEventListener('blur', hide);
      point.addEventListener('keydown', event => {
        const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
        if (!step) return;
        event.preventDefault();
        points[Math.min(points.length - 1, Math.max(0, index + step))].focus();
      });
    });
  }

  window.VeconiFluxo = {
    theme: { current, set, toggle, apply, bind: bindToggles, KEY },
    geoArt, flowArt, greeting, monotonePath, niceMax, compactMoney, bindChart,
  };
})();
