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
  const current = () => stored() || (media.matches ? 'dark' : 'light');

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
    root.dataset.themeSource = stored() ? 'user' : 'system';
    const meta = document.querySelector('meta[name="theme-color"]');
    // O cabeçalho mobile é escuro nos dois temas; a barra do sistema acompanha só no desktop.
    if (meta && !(window.matchMedia && matchMedia('(max-width: 767px)').matches)) meta.content = META[theme];
    syncToggles(theme);
    return theme;
  }
  function set(theme) {
    if (theme !== 'dark' && theme !== 'light') return apply();
    try { localStorage.setItem(KEY, theme); } catch { /* aparelho sem armazenamento: vale só nesta sessão */ }
    root.classList.add('vf-theme-switching');
    const result = apply();
    clearTimeout(set.timer);
    set.timer = setTimeout(() => root.classList.remove('vf-theme-switching'), 420);
    window.dispatchEvent?.(new CustomEvent('veconi-theme-changed', { detail: { theme: result } }));
    return result;
  }
  const toggle = () => set(current() === 'dark' ? 'light' : 'dark');
  media.addEventListener?.('change', () => { if (!stored()) apply(); });
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
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => bindToggles());
  else bindToggles();

  /* ---------- Assinatura: linhas curvas que convergem no V, com nós conectados ---------- */
  const FLOW_NODES = [[194, 50, 'is-soft'], [202, 88, 'is-soft'], [352, 70, ''], [360, 88, ''], [430, 128, 'is-core'], [560, 30, '']];
  // A entrada orquestrada acontece uma vez por sessão; depois, re-renderizações (troca de
  // período, sincronização) não repetem a animação dos cartões.
  let entering = false;
  function settleEntrance() {
    if (entering || root.classList.contains('vf-entered')) return;
    entering = true;
    setTimeout(() => root.classList.add('vf-entered'), 1800);
  }
  function flowArt(variant = 'hero') {
    settleEntrance();
    return `<svg class="vf-flow vf-flow--${variant}" viewBox="0 0 640 160" preserveAspectRatio="xMaxYMid slice" aria-hidden="true" focusable="false">`
      + '<path class="vf-flow-line is-faint" pathLength="1" d="M0 30 C 170 0 320 6 420 34 C 470 48 520 52 640 40"/>'
      + '<path class="vf-flow-line" pathLength="1" d="M0 92 C 140 40 260 40 352 70 C 392 84 414 108 430 128"/>'
      + '<path class="vf-flow-line is-second" pathLength="1" d="M0 120 C 150 96 270 70 360 88 C 396 96 416 114 430 128"/>'
      + '<path class="vf-flow-line is-rise" pathLength="1" d="M430 128 C 452 96 488 52 560 30 C 590 22 620 20 640 22"/>'
      + '<path class="vf-flow-link" d="M194 50 L202 88 M352 70 L360 88"/>'
      + '<path class="vf-flow-pulse" pathLength="1" d="M0 92 C 140 40 260 40 352 70 C 392 84 414 108 430 128 C 452 96 488 52 560 30 C 590 22 620 20 640 22"/>'
      + FLOW_NODES.map(([x, y, kind], i) => `<g class="vf-flow-node ${kind}" style="--vf-node:${i}"><circle class="vf-flow-halo" cx="${x}" cy="${y}" r="${kind === 'is-core' ? 15 : 9}"/><circle class="vf-flow-dot" cx="${x}" cy="${y}" r="${kind === 'is-core' ? 4.5 : 3}"/></g>`).join('')
      + '</svg>';
  }

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
    flowArt, greeting, monotonePath, niceMax, compactMoney, bindChart,
  };
})();
