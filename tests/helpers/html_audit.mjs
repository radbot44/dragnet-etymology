/**
 * Zero-dependency HTML, WCAG 2.1 contrast, internal-link, landmark, and
 * VM-backed filter script auditor for DRAgNEt static Astro output (Agent 10).
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

function hexToRgb(hex) {
  const clean = String(hex || '').trim().replace(/^#/, '');
  if (clean.length === 3) {
    return [
      parseInt(clean[0] + clean[0], 16),
      parseInt(clean[1] + clean[1], 16),
      parseInt(clean[2] + clean[2], 16),
    ];
  }
  if (clean.length === 6) {
    return [
      parseInt(clean.slice(0, 2), 16),
      parseInt(clean.slice(2, 4), 16),
      parseInt(clean.slice(4, 6), 16),
    ];
  }
  throw new Error(`Unsupported hex color: ${hex}`);
}

function relativeLuminance([r, g, b]) {
  const chan = [r, g, b].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * chan[0] + 0.7152 * chan[1] + 0.0722 * chan[2];
}

export function wcagContrastRatio(fgHex, bgHex) {
  const l1 = relativeLuminance(hexToRgb(fgHex));
  const l2 = relativeLuminance(hexToRgb(bgHex));
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return Number(((lighter + 0.05) / (darker + 0.05)).toFixed(2));
}

export function extractCssTokensAndBadges(cssText) {
  const rootMatch = cssText.match(/:root\s*\{([\s\S]*?)\}/);
  const vars = {};
  if (rootMatch) {
    for (const m of rootMatch[1].matchAll(/(--[A-Za-z0-9-]+)\s*:\s*([^;]+);/g)) {
      vars[m[1].trim()] = m[2].trim();
    }
  }

  const resolveColor = (val) => {
    if (!val) return null;
    const trimmed = val.trim();
    if (trimmed.startsWith('#')) return trimmed;
    const varMatch = trimmed.match(/^var\((--[A-Za-z0-9-]+)\)$/);
    if (varMatch && vars[varMatch[1]] && vars[varMatch[1]].startsWith('#')) {
      return vars[varMatch[1]];
    }
    return null;
  };

  const badges = [];
  for (const m of cssText.matchAll(/(\.badge-[A-Za-z0-9_-]+)\s*\{([^}]*)\}/g)) {
    const selector = m[1];
    const body = m[2];
    const bgM = body.match(/background(?:-color)?\s*:\s*([^;]+);/);
    const fgM = body.match(/(?:^|[\s;])color\s*:\s*([^;]+);/);
    const bg = resolveColor(bgM ? bgM[1] : null);
    const fg = resolveColor(fgM ? fgM[1] : null);
    if (bg && fg) {
      badges.push({ selector, fg, bg, ratio: wcagContrastRatio(fg, bg) });
    }
  }

  return { vars, badges };
}

export function auditPageLandmarksAndHonesty(htmlText, { checkPctConfidence = true } = {}) {
  const issues = [];
  if (!/<a[^>]+href=["']#main-content["']/i.test(htmlText)) {
    issues.push('Missing skip-to-main-content link (#main-content)');
  }
  if (!/<main[^>]+id=["']main-content["']/i.test(htmlText)) {
    issues.push('Missing <main id="main-content"> landmark');
  }
  if (!/<h1[\s>]/i.test(htmlText)) {
    issues.push('Missing <h1> heading');
  }
  if (/\b(?:SLPL|JW|jaro[_ -]?winkler|skeleton_similarity)\s*=\s*\d\.\d{3,4}\b/i.test(htmlText)) {
    issues.push('Rendered HTML exposes raw 4-decimal harness score');
  }
  if (/(?:-?\b\d+\.\d+\s*(?:yrs?|years?)\b)/i.test(htmlText)) {
    issues.push('Rendered HTML uses decimal years instead of calendar years/months/days');
  }
  if (checkPctConfidence && /\b\d{1,3}(?:\.\d+)?%\s*(?:confidence|certainty|probability|likelihood)\b/i.test(htmlText)) {
    issues.push('Rendered HTML uses prohibited numerical percentage confidence');
  }

  for (const ctrl of htmlText.matchAll(/<(input|select)\b([^>]*)>/gi)) {
    const attrs = ctrl[2];
    const typeM = attrs.match(/\btype=["']([^"']+)["']/i);
    if (typeM && typeM[1].toLowerCase() === 'hidden') continue;
    const hasAria = /\baria-label(?:ledby)?=["'][^"']+["']/i.test(attrs);
    const idM = attrs.match(/\bid=["']([^"']+)["']/i);
    const hasForLabel =
      idM && new RegExp(`<label[^>]+for=["']${idM[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["']`, 'i').test(htmlText);
    const wrappedCheck = ctrl[0];
    const idx = ctrl.index ?? 0;
    const before = htmlText.slice(Math.max(0, idx - 160), idx);
    const insideLabel = /<label\b[^>]*>(?:(?!(?:<\/label>))[\s\S])*$/i.test(before);
    if (!hasAria && !hasForLabel && !insideLabel) {
      issues.push(`Unlabeled form control: ${wrappedCheck.slice(0, 80)}`);
    }
  }

  return { ok: issues.length === 0, issues };
}

export function findBrokenInternalLinks(htmlText, distDir) {
  const broken = [];
  for (const m of htmlText.matchAll(/\b(?:href|src)=["'](\/[^"'#?]+)(?:[?#][^"']*)?["']/gi)) {
    const rawPath = decodeURIComponent(m[1]);
    if (rawPath.startsWith('//')) continue;
    const trimmed = rawPath.replace(/^\/+/, '');
    const candidates = [
      path.join(distDir, trimmed),
      path.join(distDir, trimmed, 'index.html'),
      path.join(distDir, `${trimmed}.html`),
    ];
    if (!candidates.some((p) => fs.existsSync(p))) {
      broken.push(rawPath);
    }
  }
  return Array.from(new Set(broken));
}

function decodeHtmlEntities(str) {
  return String(str || '')
    .replaceAll('&amp;', '&')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>');
}

function parseAttributes(attrText) {
  const out = {};
  for (const m of attrText.matchAll(/([A-Za-z0-9_:-]+)(?:=["']([^"']*)["'])?/g)) {
    out[m[1]] = m[2] !== undefined ? decodeHtmlEntities(m[2]) : '';
  }
  return out;
}

/**
 * Parse rendered HTML from dist/claims/index.html (or dist/citations/index.html)
 * to extract all id="..." elements, data-* filterable rows/cards, and inline <script>
 * blocks for zero-dependency VM filter testing.
 */
export function parseInteractiveIndexHtml(htmlText, rowClassPattern = /\b(?:clm-row|claim-row|claim-card|cit-row)\b/) {
  const elementsById = {};
  for (const m of htmlText.matchAll(/<([a-z0-9]+)\b([^>]*\bid=["']([^"']+)["'][^>]*)>/gi)) {
    const tag = m[1].toLowerCase();
    const attrs = parseAttributes(m[2]);
    const id = m[3];
    const dataset = {};
    for (const [k, v] of Object.entries(attrs)) {
      if (k.startsWith('data-')) {
        const camel = k.slice(5).replace(/-([a-z])/g, (_, ch) => ch.toUpperCase());
        dataset[camel] = v;
      }
    }
    elementsById[id] = {
      tag,
      value: attrs.value ?? '',
      checked: 'checked' in attrs,
      hidden: 'hidden' in attrs,
      disabled: 'disabled' in attrs,
      options: [],
      dataset,
      parentElement: { hidden: false },
    };
  }

  const rows = [];
  for (const m of htmlText.matchAll(/<(?:tr|article|li|div)\b([^>]*\bclass=["']([^"']+)["'][^>]*)>/gi)) {
    const classStr = m[2];
    if (!rowClassPattern.test(classStr)) continue;
    const attrs = parseAttributes(m[1]);
    const dataset = {};
    for (const [k, v] of Object.entries(attrs)) {
      if (k.startsWith('data-')) {
        const camel = k.slice(5).replace(/-([a-z])/g, (_, ch) => ch.toUpperCase());
        dataset[camel] = v;
      }
    }
    if (Object.keys(dataset).length > 0) {
      rows.push({ className: classStr, dataset });
    }
  }

  const scripts = Array.from(htmlText.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi))
    .map((m) => m[1])
    .filter((s) => s.includes('URLSearchParams') || s.includes('replaceState'));

  return { elementsById, rows, inlineScript: scripts[0] || null };
}

/**
 * Minimal zero-dependency DOM + History + Location harness using node:vm
 * to execute inline Astro filter scripts (/citations/ and /claims/).
 */
export function createFilterDomHarness({
  initialUrl = 'https://dragnet.tch.one/claims/',
  elementsById = {},
  rows = [],
}) {
  let currentHref = initialUrl;
  const windowListeners = new Map();
  const docListeners = new Map();

  const makeControl = (spec) => {
    const listeners = new Map();
    return {
      id: spec.id,
      tagName: String(spec.tag || 'DIV').toUpperCase(),
      type: spec.type || '',
      value: spec.value ?? '',
      options: spec.options || [],
      checked: Boolean(spec.checked),
      hidden: Boolean(spec.hidden),
      disabled: Boolean(spec.disabled),
      textContent: spec.textContent ?? '',
      innerHTML: spec.innerHTML ?? '',
      dataset: { ...(spec.dataset || {}) },
      style: {},
      classList: {
        _set: new Set(String(spec.className || '').split(/\s+/).filter(Boolean)),
        add(...tokens) {
          tokens.forEach((t) => this._set.add(t));
        },
        remove(...tokens) {
          tokens.forEach((t) => this._set.delete(t));
        },
        toggle(token, force) {
          if (force === true) this._set.add(token);
          else if (force === false) this._set.delete(token);
          else if (this._set.has(token)) this._set.delete(token);
          else this._set.add(token);
        },
        contains(token) {
          return this._set.has(token);
        },
      },
      attributes: new Map(),
      setAttribute(name, val) {
        this.attributes.set(name, String(val));
        if (name === 'hidden') this.hidden = true;
      },
      removeAttribute(name) {
        this.attributes.delete(name);
        if (name === 'hidden') this.hidden = false;
      },
      getAttribute(name) {
        return this.attributes.get(name) ?? null;
      },
      parentElement: spec.parentElement || { hidden: false, style: {} },
      addEventListener(type, fn) {
        if (!listeners.has(type)) listeners.set(type, []);
        listeners.get(type).push(fn);
      },
      dispatch(type, eventExtra = {}) {
        const evt = { type, target: this, currentTarget: this, preventDefault() {}, ...eventExtra };
        for (const fn of listeners.get(type) || []) fn(evt);
      },
      focus() {},
      scrollIntoView() {},
    };
  };

  const idMap = new Map();
  for (const [id, spec] of Object.entries(elementsById)) {
    idMap.set(id, makeControl({ id, ...spec }));
  }

  const rowObjects = rows.map((r, idx) =>
    makeControl({
      id: r.id || `row-${idx}`,
      className: r.className || '',
      dataset: r.dataset,
      textContent: r.textContent || Object.values(r.dataset || {}).join(' '),
    })
  );

  const locationObj = {
    get href() {
      return currentHref;
    },
    get pathname() {
      return new URL(currentHref).pathname;
    },
    get search() {
      return new URL(currentHref).search;
    },
    get hash() {
      return new URL(currentHref).hash;
    },
  };

  const historyObj = {
    state: null,
    replaceState(state, _title, url) {
      this.state = state;
      currentHref = url instanceof URL ? url.href : new URL(String(url), currentHref).href;
    },
    pushState(state, _title, url) {
      this.state = state;
      currentHref = url instanceof URL ? url.href : new URL(String(url), currentHref).href;
    },
  };

  const documentObj = {
    getElementById(id) {
      return idMap.get(id) || null;
    },
    querySelector(selector) {
      if (selector.startsWith('#')) return idMap.get(selector.slice(1)) || null;
      return null;
    },
    querySelectorAll(selector) {
      if (selector.startsWith('#')) {
        const el = idMap.get(selector.slice(1));
        return el ? [el] : [];
      }
      return rowObjects;
    },
    addEventListener(type, fn) {
      if (!docListeners.has(type)) docListeners.set(type, []);
      docListeners.get(type).push(fn);
    },
  };

  const windowObj = {
    location: locationObj,
    history: historyObj,
    document: documentObj,
    addEventListener(type, fn) {
      if (!windowListeners.has(type)) windowListeners.set(type, []);
      windowListeners.get(type).push(fn);
    },
  };

  const context = vm.createContext({
    URL,
    URLSearchParams,
    Intl,
    Math,
    Number,
    String,
    Boolean,
    Object,
    Array,
    Set,
    Map,
    RegExp,
    JSON,
    parseInt,
    parseFloat,
    isNaN,
    console,
    setTimeout: (fn) => fn(),
    clearTimeout: () => {},
    requestAnimationFrame: (fn) => fn(),
    location: locationObj,
    history: historyObj,
    window: windowObj,
    document: documentObj,
  });

  return {
    runInlineScript(scriptSource) {
      vm.runInContext(scriptSource, context);
      for (const fn of docListeners.get('DOMContentLoaded') || []) fn({});
    },
    getControl(id) {
      return idMap.get(id);
    },
    getAllControls() {
      return Array.from(idMap.values());
    },
    getRows() {
      return rowObjects;
    },
    getVisibleRows() {
      return rowObjects.filter((r) => !r.hidden && r.style?.display !== 'none');
    },
    getHref() {
      return currentHref;
    },
    simulatePopState(newUrl) {
      currentHref = newUrl;
      for (const fn of windowListeners.get('popstate') || []) fn({});
    },
  };
}
