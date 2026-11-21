// VECONI Visual 1C — gera a "ponte escura" das telas Vender, Clientes, Produtos e Financeiro.
//
// O CSS legado dessas telas usa cores fixas (#fff, #15233b...). Em vez de reescrever cada arquivo,
// este gerador lê as regras com o próprio parser do navegador (CSSOM normaliza cores e expande
// atalhos), escolhe só as declarações de cor e as remapeia para os tokens do tema (--vf-*), por
// família de cor: superfícies neutras, tons turquesa, vermelhos, âmbar, azuis, textos e bordas.
// A saída fica entre marcadores no css/veconi-fluxo.css, sempre com escopo de tema escuro + rota.
// Nada muda no tema claro. Rodar de novo quando o CSS legado dessas telas mudar:
//   node scripts/build-veconi-dark-bridge.cjs
const fs = require('node:fs'), path = require('node:path');
let puppeteer; try { puppeteer = require('puppeteer'); } catch { puppeteer = require('puppeteer-core'); }

const TARGET = 'css/veconi-fluxo.css', START = '/* @veconi-dark-bridge:start */', END = '/* @veconi-dark-bridge:end */';
const GROUPS = {
  all: ['style.css', 'visual.css', 'mobile.css', 'mobile-fixes.css', 'mobile-components.css', 'design-system/tokens.css', 'design-system/veconi-theme.css', 'design-system/desktop.css', 'spaces.css', 'space-branding.css', 'product-images.css', 'barcode.css', 'receipt-messages.css'],
  vender: ['desktop-sales.css', 'checkout-mobile.css', 'sale-recovery.css', 'sale-monetary-analysis.css', 'sale-exchanges.css', 'exchange-credit-checkout.css', 'sale-completion.css', 'prior-sales.css', 'product-selection.css', 'coupons.css', 'flexible-service.css', 'terminal-payments.css'],
  clientes: ['clientes-page.css', 'clientes-mobile.css', 'crm.css', 'mensagens-mobile.css'],
  produtos: ['produtos-desktop.css', 'produtos-mobile.css', 'product-variations.css', 'product-spreadsheet.css', 'import.css'],
  financeiro: ['finance.css', 'financial.css', 'financial-credit-v2.css', 'financial-refinement.css', 'financial-home-v2.css', 'financial-accounts-carousel.css'],
};
// html.vf-dark-1c: tema escuro + uma das quatro telas aberta (definida em js/veconi-fluxo.js).
// Uma classe curta mantém o arquivo pequeno; os arquivos por tela só têm classes daquela tela.
const scopeOf = () => 'html.vf-dark-1c';
// Cabeçalho, menu e navegação já seguem o tema (1A/1B); não entram na ponte.
const SKIP = /\.topbar|\.sidebar|\.bottom-nav|mobile-navigation|desktop-sidebar|mobile-sidebar|#menu\b|\.local-badge|\.avatar|\.fixture-|\.vf-|\.overlay\b|\.boot-|\.auth-|\.login|\.brand\b|\.vac-|veconi-accounts-carousel/; // carrossel de contas: cartões com a cor da instituição nos dois temas

async function collect(files) {
  const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  try {
    const page = await browser.newPage();
    return await page.evaluate(sources => {
      const PROPS = ['background-color', 'background-image', 'color', 'fill', 'stroke', 'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color', 'outline-color', 'box-shadow', 'caret-color', '-webkit-text-fill-color'];
      const out = [];
      const walk = (rules, media, file) => {
        for (const rule of rules) {
          if (rule instanceof CSSMediaRule) walk(rule.cssRules, [...media, '@media ' + rule.conditionText], file);
          else if (rule instanceof CSSSupportsRule) walk(rule.cssRules, [...media, '@supports ' + rule.conditionText], file);
          else if (rule instanceof CSSStyleRule) {
            const decls = PROPS.map(p => [p, rule.style.getPropertyValue(p), rule.style.getPropertyPriority(p)]).filter(([, v]) => v);
            // background: var(--x, #fff) deixa os longhands pendentes; o atalho inteiro vem como texto.
            if (!rule.style.getPropertyValue('background-color') && rule.style.getPropertyValue('background').includes('var(') && (rule.style.getPropertyValue('background'))) decls.push(['background', rule.style.getPropertyValue('background'), rule.style.getPropertyPriority('background')]);
            if (decls.length) out.push({ file, media, selector: rule.selectorText, decls });
          }
        }
      };
      for (const [file, text] of sources) { const sheet = new CSSStyleSheet(); try { sheet.replaceSync(text.replace(/@import[^;]+;/g, '')); walk(sheet.cssRules, [], file); } catch (error) { out.push({ file, error: String(error) }); } }
      return out;
    }, files);
  } finally { await browser.close(); }
}

// ---------- classificação de cores ----------
const rgbaRe = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)/g;
function hsl(R, G, B) {
  const r = R / 255, g = G / 255, b = B / 255, max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min, rgb = { r: R, g: G, b: B };
  if (!d) return { h: 0, s: 0, l, ...rgb };
  const s = d / (1 - Math.abs(2 * l - 1)); let h;
  if (max === r) h = ((g - b) / d) % 6; else if (max === g) h = (b - r) / d + 2; else h = (r - g) / d + 4;
  return { h: (h * 60 + 360) % 360, s, l, ...rgb };
}
const family = ({ h, s }) => s < .22 ? 'neutral' : (h >= 135 && h < 200) ? 'teal' : (h >= 75 && h < 135) ? 'green' : (h >= 200 && h < 255) ? 'blue' : (h >= 20 && h < 62) ? 'amber' : (h < 20 || h >= 330) ? 'red' : (h >= 62 && h < 75) ? 'amber' : 'neutral';
const withAlpha = (token, a) => a >= .98 ? token : `color-mix(in srgb, ${token} ${Math.round(a * 100)}%, transparent)`;
function surface(c) {
  const f = family(c);
  if (c.l >= .8) {
    if (f === 'neutral' || f === 'blue' && c.s < .45) return c.l >= .975 ? 'var(--vf-surface)' : c.l >= .93 ? 'var(--vf-surface-2)' : 'var(--vf-surface-3)';
    return { teal: 'var(--vf-brand-soft)', green: 'var(--vf-pos-soft)', red: 'var(--vf-neg-soft)', amber: 'var(--vf-warn-soft)', blue: 'var(--vf-info-soft)', neutral: 'var(--vf-surface-2)' }[f];
  }
  if (c.l >= .62 && (f === 'neutral' || c.s < .3)) return 'var(--vf-line-strong)';
  return null; // cores saturadas médias/escuras (botões, selos): ficam como estão
}
function ink(c, onBright) {
  if (onBright) return null;
  const f = family(c);
  if (c.l < .32) {
    if (f === 'neutral' || f === 'blue' && c.s < .75) return 'var(--vf-ink)';
    return { teal: 'var(--vf-accent-text)', green: 'var(--vf-pos)', red: 'var(--vf-neg)', amber: 'var(--vf-warn)', blue: 'var(--vf-info)' }[f] || 'var(--vf-ink)';
  }
  if (c.l < .62) {
    if (f === 'neutral' || c.s < .3) return c.l < .45 ? 'var(--vf-text-2)' : 'var(--vf-text-3)';
    return { teal: 'var(--vf-accent-text)', green: 'var(--vf-pos)', red: 'var(--vf-neg)', amber: 'var(--vf-warn)', blue: 'var(--vf-info)' }[f] || null;
  }
  return null; // textos claros (branco sobre botão, etc.) ficam
}
const line = c => c.l >= .72 ? (family(c) === 'teal' || family(c) === 'green' ? 'color-mix(in srgb, var(--vf-brand) 34%, var(--vf-line))' : family(c) === 'red' ? 'color-mix(in srgb, var(--vf-neg) 40%, var(--vf-line))' : family(c) === 'amber' ? 'var(--vf-warn-line)' : 'var(--vf-line)') : null;
const parseOne = v => { rgbaRe.lastIndex = 0; const m = rgbaRe.exec(v); if (!m) return null; const a = m[4] === undefined ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : +m[4]; return { ...hsl(+m[1], +m[2], +m[3]), a }; };
const mapColors = (value, mapper) => value.replace(rgbaRe, (all, r, g, b, a) => { const alpha = a === undefined ? 1 : a.endsWith('%') ? parseFloat(a) / 100 : +a; if (alpha === 0) return all; const t = mapper({ ...hsl(+r, +g, +b), a: alpha }); return t ? withAlpha(t, alpha) : all; });

// Tema claro: textos médios que não chegam a 4,5:1 sobre branco sobem para o token da mesma família.
const relLum = c => { const f = v => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }; return .2126 * f(c.r) + .7152 * f(c.g) + .0722 * f(c.b); };
function lift(c) {
  const ratio = 1.05 / (relLum(c) + .05);
  if (ratio >= 4.5 || ratio < 1.6 || c.a < .6) return null;
  const f = family(c);
  return { neutral: 'var(--vf-text-3)', teal: 'var(--vf-accent-text)', green: 'var(--vf-pos)', red: 'var(--vf-neg)', amber: 'var(--vf-warn)', blue: 'var(--vf-info)' }[f] || 'var(--vf-text-3)';
}
function convertLight(rule) {
  if (/:disabled|\[disabled\]|aria-disabled|placeholder/.test(rule.selector)) return [];
  const bg = parseOne(rule.decls.find(([p]) => p === 'background-color')?.[1] || '');
  if (bg && bg.a > .5 && (bg.l < .7 || bg.s > .35 && bg.l < .9)) return []; // texto sobre fundo próprio (botão, selo)
  const out = [];
  for (const [prop, raw, priority] of rule.decls) {
    if (prop !== 'color') continue;
    const next = mapColors(normalize(raw), lift);
    if (next !== normalize(raw)) out.push(`${prop}: ${next}${priority ? ' !important' : ''}`);
  }
  return out;
}
function normalize(raw) {
  return raw.replace(/\bwhite\b/g, 'rgb(255, 255, 255)').replace(/\bblack\b/g, 'rgb(0, 0, 0)')
    .replace(/#([0-9a-f]{3,8})\b/gi, (all, h) => { if (![3, 4, 6, 8].includes(h.length)) return all; const x = h.length < 5 ? [...h].map(c => c + c).join('') : h; const n = [0, 2, 4, 6].map(i => parseInt(x.slice(i, i + 2), 16)); return x.length === 8 ? `rgba(${n[0]}, ${n[1]}, ${n[2]}, ${(n[3] / 255).toFixed(2)})` : `rgb(${n[0]}, ${n[1]}, ${n[2]})`; });
}
function convert(rule) {
  const bg = parseOne(rule.decls.find(([p]) => p === 'background-color')?.[1] || '');
  const bright = bg && bg.a > .5 && bg.l > .4 && bg.s > .35; // fundo de marca/semântico: o texto escuro dele fica
  const out = [];
  for (const [prop, raw, priority] of rule.decls) {
    // Cores nomeadas e fallbacks de var() também entram: var(--x, #15233b) → var(--x, var(--vf-ink)).
    const value = normalize(raw);
    let next = null;
    if (prop === 'background-color') next = mapColors(value, c => surface(c));
    else if (prop === 'background') { if (!value.includes('url(')) next = mapColors(value, c => value.includes('gradient') && c.l < .8 ? null : surface(c)); }
    else if (prop === 'background-image') { if (/gradient/.test(value)) next = mapColors(value, c => c.l >= .8 ? surface(c) : null); }
    else if (['color', 'fill', 'stroke', 'caret-color', '-webkit-text-fill-color'].includes(prop)) next = mapColors(value, c => c.a > .3 ? ink(c, bright) : null);
    else if (prop.startsWith('border') || prop === 'outline-color') next = mapColors(value, c => c.a > .15 ? line(c) : null);
    else if (prop === 'box-shadow') next = mapColors(value, c => c.l >= .85 ? (c.s < .3 ? 'var(--vf-surface)' : 'var(--vf-brand-soft)') : null);
    if (next === value) next = null;
    if (next && next !== raw) out.push(`${prop}: ${next}${priority ? ' !important' : ''}`);
  }
  return out;
}
function splitSelectors(text) {
  const parts = []; let depth = 0, cur = '';
  for (const ch of text) { if (ch === '(' || ch === '[') depth++; if (ch === ')' || ch === ']') depth--; if (ch === ',' && !depth) { parts.push(cur.trim()); cur = ''; } else cur += ch; }
  if (cur.trim()) parts.push(cur.trim()); return parts;
}
function scoped(selector, scope) {
  if (SKIP.test(selector)) return null;
  if (/^:root\b/.test(selector)) return selector.replace(/^:root/, scope);
  if (/^html\b/.test(selector)) return scope + selector.slice(4);
  return `${scope} ${selector}`;
}

async function main() {
  const files = [...new Set(Object.values(GROUPS).flat())].map(f => [f, fs.readFileSync(path.join('css', f), 'utf8')]);
  const rules = await collect(files);
  const errors = rules.filter(r => r.error); if (errors.length) throw Error(JSON.stringify(errors));
  if (process.env.BRIDGE_DEBUG) for (const r of rules.filter(r => r.selector?.includes(process.env.BRIDGE_DEBUG))) console.log(JSON.stringify(r), convert(r));
  const blocks = new Map(); let count = 0;
  const passes = [['html.vf-dark-1c', convert], ['html.vf-area-1c:not(.vf-dark-1c)', convertLight]];
  for (const [scope, fn] of passes) for (const [, list] of Object.entries(GROUPS)) {
    for (const rule of rules.filter(r => list.includes(r.file))) {
      const decls = fn(rule); if (!decls.length) continue;
      const selectors = splitSelectors(rule.selector).map(s => scoped(s, scope)).filter(Boolean); if (!selectors.length) continue;
      const key = rule.media.join(' && ');
      if (!blocks.has(key)) blocks.set(key, []);
      blocks.get(key).push(`${selectors.join(',')}{${decls.join(';')}}`); count++;
    }
  }
  let css = `${START}\n/* Gerado por scripts/build-veconi-dark-bridge.cjs — não editar à mão. ${count} regras. */\n`;
  for (const [media, list] of blocks) {
    if (!media) { css += list.join('\n') + '\n'; continue; }
    const wraps = media.split(' && ');
    css += wraps.map(w => `${w} {\n`).join('') + list.join('\n') + '\n' + wraps.map(() => '}').join('') + '\n';
  }
  css += END;
  let target = fs.readFileSync(TARGET, 'utf8');
  const a = target.indexOf(START), b = target.indexOf(END);
  target = a >= 0 && b > a ? target.slice(0, a) + css + target.slice(b + END.length) : target.trimEnd() + '\n\n/* 9.3 Ponte escura gerada (cores fixas do CSS legado → tokens) */\n' + css + '\n';
  fs.writeFileSync(TARGET, target);
  console.log(JSON.stringify({ rules: count, bytes: css.length }));
}
main().catch(e => { console.error(e); process.exitCode = 1; });
