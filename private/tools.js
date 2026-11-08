// Tools. Served only to signed-in Discord users via /tools/tools.js.
// Every tool runs in the browser, so images are never uploaded anywhere.
(function () {
  'use strict';

  // ---------- helpers ----------
  const $ = (id) => document.getElementById(id);
  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  const BTN = 'rounded-full bg-white px-4 py-2 font-compact text-sm font-semibold text-black transition-transform hover:scale-[1.03] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:scale-100';
  const BTN2 = 'rounded-full border border-white/15 bg-white/5 px-4 py-2 font-compact text-sm font-semibold text-white transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40';
  const INPUT = 'w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-white/30';
  const LABEL = 'flex flex-col gap-1.5 text-xs text-white/55';
  const CHECKER = 'background-color:#2a2a2e;background-image:conic-gradient(#3a3a3f 25%,transparent 0 50%,#3a3a3f 0 75%,transparent 0);background-size:20px 20px';

  function button(label, cls, onClick) {
    const b = el('button', cls, label);
    b.type = 'button';
    if (onClick) b.addEventListener('click', onClick);
    return b;
  }
  function field(label, input) {
    const l = el('label', LABEL);
    l.append(label, input);
    return l;
  }
  function numberInput(value, min, max) {
    const i = el('input', INPUT);
    i.type = 'number';
    i.min = min;
    i.max = max;
    i.value = value;
    return i;
  }
  function loadImage(src) {
    return new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = () => rej(new Error('That file could not be read as an image.'));
      i.src = src;
    });
  }
  async function loadImageFile(file) {
    const url = URL.createObjectURL(file);
    try {
      return await loadImage(url);
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    }
  }
  const canvasBlob = (canvas, type = 'image/png', q) =>
    new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('Could not export the image.'))), type, q));
  function download(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  }
  async function copy(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      const t = el('textarea');
      t.value = text;
      t.style.cssText = 'position:fixed;opacity:0';
      document.body.append(t);
      t.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch {}
      t.remove();
      return ok;
    }
  }
  const baseName = (f) => (f && f.name ? f.name.replace(/\.[^.]+$/, '') : 'image').replace(/[^\w-]+/g, '-').slice(0, 40) || 'image';
  const hex2 = (n) => n.toString(16).padStart(2, '0');
  const toHex = (r, g, b) => '#' + hex2(r) + hex2(g) + hex2(b);
  function toHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h = 0, s = 0;
    const l = (max + min) / 2;
    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
      h *= 60;
    }
    return `hsl(${Math.round(h)}, ${Math.round(s * 100)}%, ${Math.round(l * 100)}%)`;
  }

  function dropzone(onFile, hint, accept = 'image/*') {
    const wrap = el('label', 'flex cursor-pointer flex-col items-center justify-center gap-2 rounded-3xl border border-dashed border-white/20 bg-white/[0.03] px-6 py-14 text-center transition-colors hover:bg-white/[0.06] focus-within:outline focus-within:outline-2 focus-within:outline-white');
    wrap.append(el('span', 'text-base font-semibold text-white', 'Drop an image here'), el('span', 'text-sm text-white/50', hint || 'or click to choose a file. You can also paste an image.'));
    const input = el('input', 'sr-only');
    input.type = 'file';
    input.accept = accept;
    input.addEventListener('change', () => input.files[0] && onFile(input.files[0]));
    wrap.append(input);
    wrap.addEventListener('dragover', (e) => { e.preventDefault(); wrap.classList.add('bg-white/10'); });
    wrap.addEventListener('dragleave', () => wrap.classList.remove('bg-white/10'));
    wrap.addEventListener('drop', (e) => {
      e.preventDefault();
      wrap.classList.remove('bg-white/10');
      const f = e.dataTransfer.files[0];
      if (f && f.type.startsWith('image/')) onFile(f);
    });
    return wrap;
  }

  // ---------- overlay + registry ----------
  let cleanups = [];
  let lastFocus = null;
  const ctx = {
    say(text, bad) {
      const s = $('tool-status');
      s.textContent = text || '';
      s.className = 'min-h-9 border-t border-white/10 px-5 py-2 text-sm sm:px-6 ' + (bad ? 'text-red-400' : 'text-white/55');
    },
    onPaste(fn) {
      const h = (e) => {
        const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith('image/'));
        if (item) fn(item.getAsFile());
      };
      document.addEventListener('paste', h);
      cleanups.push(() => document.removeEventListener('paste', h));
    },
    cleanup(fn) { cleanups.push(fn); },
  };

  function closeTool() {
    cleanups.forEach((f) => { try { f(); } catch {} });
    cleanups = [];
    $('tool-body').replaceChildren();
    $('tool-overlay').classList.add('hidden');
    document.body.style.overflow = '';
    ctx.say('');
    lastFocus?.focus?.({ preventScroll: true });
  }
  function openTool(tool) {
    lastFocus = document.activeElement;
    $('tool-title').textContent = tool.name;
    $('tool-desc').textContent = tool.blurb;
    ctx.say('');
    $('tool-body').replaceChildren();
    $('tool-overlay').classList.remove('hidden');
    document.body.style.overflow = 'hidden';
    $('tool-close').focus();
    tool.mount($('tool-body'), ctx);
  }
  $('tool-close').addEventListener('click', closeTool);
  $('tool-overlay').addEventListener('click', (e) => e.target === $('tool-overlay') && closeTool());
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !$('tool-overlay').classList.contains('hidden')) closeTool();
  });

  // ============================================================
  // 1. Background Remover
  // ============================================================
  let aiModule = null;
  async function loadAI() {
    if (aiModule) return aiModule;
    for (const v of ['1.5.5', '1.4.5']) {
      try {
        aiModule = await import(`https://cdn.jsdelivr.net/npm/@imgly/background-removal@${v}/+esm`);
        return aiModule;
      } catch { /* try the next version */ }
    }
    throw new Error('The AI model could not be loaded.');
  }

  function backgroundRemover(body, c) {
    const MAX = 4096;
    let file = null, src = null, out = null, mode = 'ai', bg = [255, 255, 255], busy = false;
    const root = el('div', 'flex flex-col gap-5');
    body.append(root);

    const stage = el('div', 'hidden flex-col gap-5');
    const drop = dropzone(handle, 'PNG, JPG or WebP. Everything happens in your browser. You can also paste an image.');
    root.append(drop, stage);
    c.onPaste(handle);

    const panels = el('div', 'grid gap-4 md:grid-cols-2');
    const before = el('canvas', 'max-h-[48vh] w-full cursor-crosshair rounded-2xl border border-white/10 object-contain');
    before.title = 'Click to choose the background color';
    const after = el('canvas', 'max-h-[48vh] w-full rounded-2xl border border-white/10 object-contain');
    after.style.cssText = CHECKER;
    const col = (t, n) => { const d = el('div', 'flex flex-col gap-2'); d.append(el('p', 'text-xs font-semibold text-white/50', t), n); return d; };
    panels.append(col('Original', before), col('Result', after));

    const controls = el('div', 'flex flex-wrap items-end gap-4');
    const modeSel = el('select', INPUT + ' w-auto');
    [['ai', 'Automatic (AI, best for photos)'], ['color', 'Solid color (instant, for plain backgrounds)']].forEach(([v, t]) => {
      const o = el('option', '', t); o.value = v; modeSel.append(o);
    });
    const tol = el('input'); tol.type = 'range'; tol.min = 1; tol.max = 60; tol.value = 18;
    const tolWrap = field('Tolerance', tol);
    const every = el('input'); every.type = 'checkbox';
    const everyWrap = el('label', 'flex items-center gap-2 pb-2 text-sm text-white/70'); everyWrap.append(every, 'Remove everywhere, not just the outside');
    const swatch = el('span', 'inline-block h-5 w-5 rounded-md border border-white/20 align-middle');
    const swatchWrap = el('div', 'flex items-center gap-2 pb-2 text-sm text-white/70'); swatchWrap.append(swatch, 'Background color (click the original to change)');
    const run = button('Remove background', BTN, () => process());
    const save = button('Download PNG', BTN2, () => out && canvasBlob(out).then((b) => download(b, baseName(file) + '-no-bg.png')));
    save.disabled = true;
    const again = button('New image', BTN2, () => { stage.classList.add('hidden'); stage.classList.remove('flex'); drop.classList.remove('hidden'); });
    controls.append(field('Method', modeSel), tolWrap, everyWrap, swatchWrap, run, save, again);
    stage.append(panels, controls);

    function syncMode() {
      mode = modeSel.value;
      [tolWrap, everyWrap, swatchWrap].forEach((n) => n.classList.toggle('hidden', mode === 'ai'));
    }
    modeSel.addEventListener('change', syncMode);
    syncMode();
    const setSwatch = () => { swatch.style.background = `rgb(${bg.join(',')})`; };

    before.addEventListener('click', (e) => {
      if (!src) return;
      const r = before.getBoundingClientRect();
      const x = Math.min(src.width - 1, Math.max(0, Math.floor(((e.clientX - r.left) / r.width) * src.width)));
      const y = Math.min(src.height - 1, Math.max(0, Math.floor(((e.clientY - r.top) / r.height) * src.height)));
      const d = src.getContext('2d').getImageData(x, y, 1, 1).data;
      bg = [d[0], d[1], d[2]];
      setSwatch();
      if (mode === 'color') process();
    });

    async function handle(f) {
      try {
        const img = await loadImageFile(f);
        const k = Math.min(1, MAX / Math.max(img.naturalWidth, img.naturalHeight));
        src = el('canvas');
        src.width = Math.max(1, Math.round(img.naturalWidth * k));
        src.height = Math.max(1, Math.round(img.naturalHeight * k));
        src.getContext('2d', { willReadFrequently: true }).drawImage(img, 0, 0, src.width, src.height);
        file = f;
        before.width = src.width; before.height = src.height;
        before.getContext('2d').drawImage(src, 0, 0);
        after.width = src.width; after.height = src.height;
        after.getContext('2d').clearRect(0, 0, after.width, after.height);
        out = null;
        save.disabled = true;
        // Guess the background from the four corners.
        const cx = src.getContext('2d'), w = src.width, h = src.height;
        const pts = [[0, 0], [w - 1, 0], [0, h - 1], [w - 1, h - 1]].map(([x, y]) => cx.getImageData(x, y, 1, 1).data);
        bg = [0, 1, 2].map((i) => Math.round(pts.reduce((a, p) => a + p[i], 0) / 4));
        setSwatch();
        drop.classList.add('hidden');
        stage.classList.remove('hidden'); stage.classList.add('flex');
        c.say('Pick a method, then press Remove background.');
      } catch (e) { c.say(e.message, true); }
    }

    function showResult(canvas) {
      out = canvas;
      after.width = canvas.width; after.height = canvas.height;
      const x = after.getContext('2d');
      x.clearRect(0, 0, after.width, after.height);
      x.drawImage(canvas, 0, 0);
      save.disabled = false;
    }

    function removeColor() {
      const w = src.width, h = src.height;
      const cv = el('canvas'); cv.width = w; cv.height = h;
      const x = cv.getContext('2d', { willReadFrequently: true });
      x.drawImage(src, 0, 0);
      const id = x.getImageData(0, 0, w, h), d = id.data;
      const limit = Math.pow((Number(tol.value) / 100) * 441.67, 2);
      const match = (i) => {
        const dr = d[i] - bg[0], dg = d[i + 1] - bg[1], db = d[i + 2] - bg[2];
        return d[i + 3] < 8 || dr * dr + dg * dg + db * db <= limit;
      };
      const gone = new Uint8Array(w * h);
      if (every.checked) {
        for (let p = 0; p < w * h; p++) if (match(p * 4)) gone[p] = 1;
      } else {
        const stack = new Int32Array(w * h);
        let top = 0;
        const push = (p) => { if (!gone[p] && match(p * 4)) { gone[p] = 1; stack[top++] = p; } };
        for (let xx = 0; xx < w; xx++) { push(xx); push((h - 1) * w + xx); }
        for (let yy = 0; yy < h; yy++) { push(yy * w); push(yy * w + w - 1); }
        while (top) {
          const p = stack[--top], px = p % w;
          if (px > 0) push(p - 1);
          if (px < w - 1) push(p + 1);
          if (p >= w) push(p - w);
          if (p < w * (h - 1)) push(p + w);
        }
      }
      // Soften the cut edge with a 3x3 blur of the mask.
      const a = new Float32Array(w * h);
      for (let p = 0; p < w * h; p++) a[p] = gone[p] ? 0 : 1;
      const soft = new Float32Array(w * h);
      for (let yy = 0; yy < h; yy++) {
        for (let xx = 0; xx < w; xx++) {
          let sum = 0, n = 0;
          for (let dy = -1; dy <= 1; dy++) {
            const y2 = yy + dy;
            if (y2 < 0 || y2 >= h) continue;
            for (let dx = -1; dx <= 1; dx++) {
              const x2 = xx + dx;
              if (x2 < 0 || x2 >= w) continue;
              sum += a[y2 * w + x2]; n++;
            }
          }
          soft[yy * w + xx] = sum / n;
        }
      }
      for (let p = 0; p < w * h; p++) d[p * 4 + 3] = Math.round(d[p * 4 + 3] * soft[p]);
      x.putImageData(id, 0, 0);
      return cv;
    }

    async function process() {
      if (!src || busy) return;
      busy = true; run.disabled = true;
      try {
        if (mode === 'ai') {
          c.say('Loading the AI model. The first run downloads it and can take a minute.');
          try {
            const { removeBackground } = await loadAI();
            const blob = await removeBackground(file, {
              output: { format: 'image/png' },
              progress: (key, cur, total) => c.say(`Working: ${key.includes('fetch') ? 'downloading model' : 'removing background'} ${total ? Math.round((cur / total) * 100) + '%' : ''}`),
            });
            const img = await loadImage(URL.createObjectURL(blob));
            const cv = el('canvas'); cv.width = img.naturalWidth; cv.height = img.naturalHeight;
            cv.getContext('2d').drawImage(img, 0, 0);
            showResult(cv);
            c.say('Done. Download the PNG with a transparent background.');
          } catch {
            modeSel.value = 'color'; syncMode();
            showResult(removeColor());
            c.say('The AI model could not load here, so the solid color method was used instead. Click the original to pick the background color and adjust the tolerance.', true);
          }
        } else {
          showResult(removeColor());
          c.say('Done. If edges are left behind, raise the tolerance. If parts of the subject vanish, lower it.');
        }
      } finally { busy = false; run.disabled = false; }
    }
  }

  // ============================================================
  // 2. Font Finder
  // ============================================================
  const FONTS = {
    Sans: ['Inter', 'Poppins', 'Montserrat', 'Roboto', 'Open Sans', 'Lato', 'Nunito', 'Work Sans', 'DM Sans', 'Outfit', 'Manrope', 'Plus Jakarta Sans', 'Space Grotesk', 'Sora', 'Rubik', 'Raleway', 'Karla'],
    Serif: ['Playfair Display', 'Merriweather', 'Lora', 'DM Serif Display', 'Cormorant Garamond', 'Libre Baskerville', 'Crimson Text', 'Bitter', 'Source Serif 4'],
    Mono: ['JetBrains Mono', 'Fira Code', 'IBM Plex Mono', 'Space Mono', 'Roboto Mono', 'DM Mono'],
    Display: ['Bebas Neue', 'Anton', 'Oswald', 'Abril Fatface', 'Righteous', 'Lobster', 'Monoton', 'Bungee', 'Orbitron', 'Press Start 2P', 'Archivo Black', 'Fredoka'],
    Handwriting: ['Pacifico', 'Caveat', 'Dancing Script', 'Satisfy', 'Shadows Into Light', 'Permanent Marker', 'Kalam', 'Great Vibes', 'Sacramento'],
  };
  let fontsLinked = false;
  function linkFonts() {
    if (fontsLinked) return;
    fontsLinked = true;
    const all = Object.values(FONTS).flat();
    const link = el('link');
    link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?' + all.map((f) => 'family=' + f.replace(/ /g, '+')).join('&') + '&display=swap';
    document.head.append(link);
  }

  function fontFinder(body, c) {
    linkFonts();
    let cat = 'All';
    const root = el('div', 'flex flex-col gap-5');
    body.append(root);

    const text = el('input', INPUT); text.value = 'The quick brown fox jumps over the lazy dog';
    const search = el('input', INPUT); search.placeholder = 'Search fonts'; search.type = 'search';
    const size = el('input'); size.type = 'range'; size.min = 18; size.max = 72; size.value = 36;
    const bar = el('div', 'grid gap-3 md:grid-cols-[2fr_1fr_12rem]');
    bar.append(field('Your text', text), field('Search', search), field('Size', size));

    const chips = el('div', 'flex flex-wrap gap-2');
    const grid = el('ul', 'grid gap-3 md:grid-cols-2');
    const note = el('p', 'rounded-2xl border border-white/10 bg-white/[0.03] p-4 text-sm leading-relaxed text-white/55');
    note.append('Browse and compare fonts with your own text, then copy the name or CSS. This tool cannot identify a font from a picture. For that, try ');
    const a = el('a', 'font-semibold text-white underline underline-offset-2', 'WhatTheFont'); a.href = 'https://www.myfonts.com/pages/whatthefont'; a.target = '_blank'; a.rel = 'noopener noreferrer';
    note.append(a, '.');

    ['All', ...Object.keys(FONTS)].forEach((name) => {
      const b = button(name, '', () => { cat = name; paint(); });
      b.dataset.cat = name;
      chips.append(b);
    });

    function paint() {
      chips.querySelectorAll('button').forEach((b) => {
        const on = b.dataset.cat === cat;
        b.className = 'rounded-full px-4 py-1.5 text-sm font-semibold transition-colors ' + (on ? 'bg-white text-black' : 'border border-white/15 text-white/70 hover:bg-white/10');
        b.setAttribute('aria-pressed', on);
      });
      const q = search.value.trim().toLowerCase();
      const list = Object.entries(FONTS).flatMap(([k, arr]) => (cat === 'All' || cat === k ? arr.map((f) => [f, k]) : [])).filter(([f]) => f.toLowerCase().includes(q));
      grid.replaceChildren(...(list.length ? list.map(([f, k]) => card(f, k)) : [el('li', 'col-span-full rounded-2xl border border-dashed border-white/10 p-8 text-center text-sm text-white/40', 'No fonts match your search.')]));
    }
    function card(f, k) {
      const li = el('li', 'flex flex-col gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4');
      const head = el('div', 'flex items-center justify-between gap-3');
      head.append(el('span', 'text-sm font-semibold text-white', f), el('span', 'text-xs text-white/40', k));
      const sample = el('p', 'break-words leading-tight text-white', text.value || f);
      sample.style.fontFamily = `"${f}", sans-serif`;
      sample.style.fontSize = size.value + 'px';
      sample.dataset.sample = '1';
      const row = el('div', 'flex flex-wrap gap-2');
      const bName = button('Copy name', BTN2 + ' !px-3 !py-1 !text-xs', async () => { c.say((await copy(f)) ? `Copied "${f}".` : 'Could not copy.', false); });
      const bCss = button('Copy CSS', BTN2 + ' !px-3 !py-1 !text-xs', async () => { c.say((await copy(`font-family: "${f}", sans-serif;`)) ? `Copied the CSS for ${f}.` : 'Could not copy.', false); });
      const get = el('a', BTN2 + ' !px-3 !py-1 !text-xs', 'Get font');
      get.href = 'https://fonts.google.com/specimen/' + f.replace(/ /g, '+'); get.target = '_blank'; get.rel = 'noopener noreferrer';
      row.append(bName, bCss, get);
      li.append(head, sample, row);
      return li;
    }
    text.addEventListener('input', () => grid.querySelectorAll('[data-sample]').forEach((p) => { p.textContent = text.value || 'Aa'; }));
    size.addEventListener('input', () => grid.querySelectorAll('[data-sample]').forEach((p) => { p.style.fontSize = size.value + 'px'; }));
    search.addEventListener('input', paint);
    root.append(bar, chips, grid, note);
    paint();
    c.say(`${Object.values(FONTS).flat().length} fonts. Previews load from Google Fonts.`);
  }

  // ============================================================
  // 3. Color Picker
  // ============================================================
  function colorPicker(body, c) {
    let cv = null, cx = null, current = null;
    const picked = [];
    const root = el('div', 'flex flex-col gap-5');
    body.append(root);
    const drop = dropzone(handle, 'Drop an image, click to choose one, or paste. Then click any pixel to pick its color.');
    const stage = el('div', 'hidden gap-5 lg:grid-cols-[1fr_20rem]');
    root.append(drop, stage);
    c.onPaste(handle);

    const wrap = el('div', 'flex flex-col gap-3');
    const canvas = el('canvas', 'max-h-[60vh] max-w-full cursor-crosshair self-start rounded-2xl border border-white/10');
    canvas.setAttribute('aria-label', 'Image. Click to pick a color.');
    const lens = el('canvas', 'pointer-events-none fixed z-[80] hidden rounded-full border-2 border-white shadow-2xl');
    lens.width = 120; lens.height = 120; lens.style.width = '120px'; lens.style.height = '120px';
    wrap.append(canvas, button('Choose another image', BTN2 + ' self-start', () => { stage.classList.add('hidden'); stage.classList.remove('grid'); drop.classList.remove('hidden'); }));
    document.body.append(lens);
    c.cleanup(() => lens.remove());

    const side = el('div', 'flex flex-col gap-4');
    const big = el('div', 'h-24 rounded-2xl border border-white/10');
    const vals = el('div', 'flex flex-col gap-2');
    const pal = el('div', 'flex flex-wrap gap-2');
    const hist = el('div', 'flex flex-wrap gap-2');
    side.append(big, vals, el('p', 'text-xs font-semibold text-white/50', 'Dominant colors'), pal, el('p', 'text-xs font-semibold text-white/50', 'Picked colors'), hist);
    stage.append(wrap, side);

    function pxAt(e) {
      const r = canvas.getBoundingClientRect();
      const x = Math.min(cv.width - 1, Math.max(0, Math.floor(((e.clientX - r.left) / r.width) * cv.width)));
      const y = Math.min(cv.height - 1, Math.max(0, Math.floor(((e.clientY - r.top) / r.height) * cv.height)));
      return [x, y];
    }
    canvas.addEventListener('mousemove', (e) => {
      if (!cv) return;
      const [x, y] = pxAt(e);
      const lx = lens.getContext('2d');
      lx.imageSmoothingEnabled = false;
      lx.clearRect(0, 0, 120, 120);
      lx.drawImage(cv, x - 7, y - 7, 15, 15, 0, 0, 120, 120);
      lx.strokeStyle = '#fff'; lx.lineWidth = 2; lx.strokeRect(56, 56, 8, 8);
      lx.strokeStyle = '#000'; lx.lineWidth = 1; lx.strokeRect(55, 55, 10, 10);
      lens.style.left = e.clientX + 18 + 'px';
      lens.style.top = e.clientY + 18 + 'px';
      lens.classList.remove('hidden');
    });
    canvas.addEventListener('mouseleave', () => lens.classList.add('hidden'));
    canvas.addEventListener('click', (e) => {
      const [x, y] = pxAt(e);
      const d = cx.getImageData(x, y, 1, 1).data;
      choose(d[0], d[1], d[2], true);
    });

    function swatchBtn(r, g, b) {
      const hx = toHex(r, g, b);
      const s = el('button', 'h-9 w-9 rounded-xl border border-white/20 transition-transform hover:scale-110');
      s.type = 'button'; s.style.background = hx; s.title = hx; s.setAttribute('aria-label', 'Use ' + hx);
      s.addEventListener('click', () => choose(r, g, b, false));
      return s;
    }
    function choose(r, g, b, remember) {
      current = [r, g, b];
      big.style.background = toHex(r, g, b);
      const rows = [['HEX', toHex(r, g, b).toUpperCase()], ['RGB', `rgb(${r}, ${g}, ${b})`], ['HSL', toHsl(r, g, b)]];
      vals.replaceChildren(...rows.map(([k, v]) => {
        const row = el('div', 'flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2');
        row.append(el('span', 'text-xs text-white/45', k), el('span', 'font-mono text-sm text-white', v));
        row.append(button('Copy', BTN2 + ' !px-3 !py-1 !text-xs', async () => c.say((await copy(v)) ? `Copied ${v}.` : 'Could not copy.')));
        return row;
      }));
      if (remember) {
        const hx = toHex(r, g, b);
        if (!picked.includes(hx)) picked.unshift(hx);
        picked.length = Math.min(picked.length, 14);
        hist.replaceChildren(...picked.map((h) => swatchBtn(parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16))));
      }
    }
    function dominant() {
      const w = Math.min(120, cv.width), h = Math.max(1, Math.round((cv.height / cv.width) * w));
      const t = el('canvas'); t.width = w; t.height = h;
      const tx = t.getContext('2d', { willReadFrequently: true });
      tx.drawImage(cv, 0, 0, w, h);
      const d = tx.getImageData(0, 0, w, h).data, bins = new Map();
      for (let i = 0; i < d.length; i += 4) {
        if (d[i + 3] < 128) continue;
        const k = ((d[i] >> 4) << 8) | ((d[i + 1] >> 4) << 4) | (d[i + 2] >> 4);
        const b = bins.get(k) || [0, 0, 0, 0];
        b[0] += d[i]; b[1] += d[i + 1]; b[2] += d[i + 2]; b[3]++;
        bins.set(k, b);
      }
      const list = [...bins.values()].sort((a, b) => b[3] - a[3]).map((b) => [Math.round(b[0] / b[3]), Math.round(b[1] / b[3]), Math.round(b[2] / b[3])]);
      const out = [];
      for (const col of list) {
        if (out.every((o) => Math.hypot(o[0] - col[0], o[1] - col[1], o[2] - col[2]) > 48)) out.push(col);
        if (out.length === 8) break;
      }
      return out;
    }
    async function handle(f) {
      try {
        const img = await loadImageFile(f);
        const k = Math.min(1, 3000 / Math.max(img.naturalWidth, img.naturalHeight));
        cv = el('canvas');
        cv.width = Math.max(1, Math.round(img.naturalWidth * k)); cv.height = Math.max(1, Math.round(img.naturalHeight * k));
        cx = cv.getContext('2d', { willReadFrequently: true });
        cx.drawImage(img, 0, 0, cv.width, cv.height);
        canvas.width = cv.width; canvas.height = cv.height;
        canvas.getContext('2d').drawImage(cv, 0, 0);
        pal.replaceChildren(...dominant().map(([r, g, b]) => swatchBtn(r, g, b)));
        picked.length = 0; hist.replaceChildren();
        const first = dominant()[0] || [0, 0, 0];
        choose(first[0], first[1], first[2], false);
        drop.classList.add('hidden');
        stage.classList.remove('hidden'); stage.classList.add('grid');
        c.say('Click the image to pick a color. Hover to magnify.');
      } catch (e) { c.say(e.message, true); }
    }
  }

  // ============================================================
  // 4. Split Images
  // ============================================================
  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let k = n;
      for (let i = 0; i < 8; i++) k = k & 1 ? 0xedb88320 ^ (k >>> 1) : k >>> 1;
      t[n] = k >>> 0;
    }
    return t;
  })();
  function crc32(buf) {
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }
  // Minimal ZIP writer (no compression; images are already compressed).
  function makeZip(files) {
    const enc = new TextEncoder();
    const parts = [], central = [];
    let offset = 0;
    const d = new Date();
    const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
    const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    for (const f of files) {
      const name = enc.encode(f.name), crc = crc32(f.data), size = f.data.length;
      const lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, 0, true);
      lh.setUint16(10, time, true); lh.setUint16(12, date, true); lh.setUint32(14, crc, true);
      lh.setUint32(18, size, true); lh.setUint32(22, size, true); lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
      parts.push(lh.buffer, name, f.data);
      const ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true); ch.setUint16(10, 0, true);
      ch.setUint16(12, time, true); ch.setUint16(14, date, true); ch.setUint32(16, crc, true);
      ch.setUint32(20, size, true); ch.setUint32(24, size, true); ch.setUint16(28, name.length, true);
      ch.setUint32(42, offset, true);
      central.push(ch.buffer, name);
      offset += 30 + name.length + size;
    }
    const centralSize = central.reduce((a, p) => a + (p.byteLength ?? p.length), 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
    end.setUint32(12, centralSize, true); end.setUint32(16, offset, true);
    return new Blob([...parts, ...central, end.buffer], { type: 'application/zip' });
  }

  function splitImages(body, c) {
    let img = null, file = null;
    const root = el('div', 'flex flex-col gap-5');
    body.append(root);
    const drop = dropzone(handle, 'Drop an image to cut it into a grid. Great for carousels and banners.');
    const stage = el('div', 'hidden flex-col gap-5');
    root.append(drop, stage);
    c.onPaste(handle);

    const rows = numberInput(1, 1, 12), cols = numberInput(3, 1, 12);
    const fmt = el('select', INPUT + ' w-auto');
    [['image/png', 'PNG'], ['image/jpeg', 'JPG']].forEach(([v, t]) => { const o = el('option', '', t); o.value = v; fmt.append(o); });
    const presets = el('div', 'flex flex-wrap gap-2');
    [['1 × 2', 1, 2], ['1 × 3', 1, 3], ['2 × 2', 2, 2], ['3 × 3', 3, 3], ['3 × 1', 3, 1]].forEach(([t, r, k]) => presets.append(button(t, BTN2 + ' !px-3 !py-1 !text-xs', () => { rows.value = r; cols.value = k; update(); })));
    const zipBtn = button('Download all (.zip)', BTN, () => zip());
    const controls = el('div', 'flex flex-wrap items-end gap-4');
    controls.append(field('Rows', rows), field('Columns', cols), field('Format', fmt), presets, zipBtn, button('New image', BTN2, () => { stage.classList.add('hidden'); stage.classList.remove('flex'); drop.classList.remove('hidden'); }));
    const prev = el('canvas', 'max-h-[42vh] max-w-full self-start rounded-2xl border border-white/10');
    const tiles = el('div', 'grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4');
    stage.append(controls, prev, tiles);

    const clamp = (v) => Math.min(12, Math.max(1, Math.floor(Number(v)) || 1));
    function bounds() {
      const R = clamp(rows.value), C = clamp(cols.value);
      return { R, C };
    }
    function tileCanvas(r, k) {
      const { R, C } = bounds();
      const x0 = Math.round((k * img.naturalWidth) / C), x1 = Math.round(((k + 1) * img.naturalWidth) / C);
      const y0 = Math.round((r * img.naturalHeight) / R), y1 = Math.round(((r + 1) * img.naturalHeight) / R);
      const t = el('canvas'); t.width = Math.max(1, x1 - x0); t.height = Math.max(1, y1 - y0);
      const x = t.getContext('2d');
      if (fmt.value === 'image/jpeg') { x.fillStyle = '#fff'; x.fillRect(0, 0, t.width, t.height); }
      x.drawImage(img, x0, y0, t.width, t.height, 0, 0, t.width, t.height);
      return t;
    }
    const ext = () => (fmt.value === 'image/jpeg' ? 'jpg' : 'png');
    function update() {
      if (!img) return;
      const { R, C } = bounds();
      prev.width = img.naturalWidth; prev.height = img.naturalHeight;
      const x = prev.getContext('2d');
      x.drawImage(img, 0, 0);
      x.strokeStyle = '#fff'; x.lineWidth = Math.max(2, img.naturalWidth / 400);
      x.shadowColor = '#000'; x.shadowBlur = 4;
      for (let k = 1; k < C; k++) { x.beginPath(); x.moveTo((k * img.naturalWidth) / C, 0); x.lineTo((k * img.naturalWidth) / C, img.naturalHeight); x.stroke(); }
      for (let r = 1; r < R; r++) { x.beginPath(); x.moveTo(0, (r * img.naturalHeight) / R); x.lineTo(img.naturalWidth, (r * img.naturalHeight) / R); x.stroke(); }
      tiles.replaceChildren();
      let n = 0;
      for (let r = 0; r < R; r++) for (let k = 0; k < C; k++) {
        n++;
        const t = tileCanvas(r, k);
        const card = el('div', 'flex flex-col gap-2 rounded-2xl border border-white/10 bg-white/[0.03] p-2');
        const thumb = el('canvas', 'mx-auto max-h-44 w-auto max-w-full rounded-lg'); thumb.width = t.width; thumb.height = t.height; thumb.getContext('2d').drawImage(t, 0, 0);
        const label = `${baseName(file)}-${n}.${ext()}`;
        card.append(thumb, button(`Download ${n}`, BTN2 + ' !px-3 !py-1 !text-xs', async () => download(await canvasBlob(t, fmt.value, 0.92), label)));
        tiles.append(card);
      }
      c.say(`${R * C} pieces of about ${Math.round(img.naturalWidth / C)} × ${Math.round(img.naturalHeight / R)} px.`);
    }
    async function zip() {
      zipBtn.disabled = true;
      try {
        const { R, C } = bounds();
        const files = [];
        let n = 0;
        for (let r = 0; r < R; r++) for (let k = 0; k < C; k++) {
          n++;
          const blob = await canvasBlob(tileCanvas(r, k), fmt.value, 0.92);
          files.push({ name: `${baseName(file)}-${n}.${ext()}`, data: new Uint8Array(await blob.arrayBuffer()) });
        }
        download(makeZip(files), baseName(file) + '-split.zip');
        c.say('Downloaded the zip.');
      } catch (e) { c.say(e.message, true); } finally { zipBtn.disabled = false; }
    }
    [rows, cols, fmt].forEach((n) => n.addEventListener('input', update));
    async function handle(f) {
      try {
        img = await loadImageFile(f);
        file = f;
        drop.classList.add('hidden');
        stage.classList.remove('hidden'); stage.classList.add('flex');
        update();
      } catch (e) { c.say(e.message, true); }
    }
    window.__splitZip = makeZip; // used by the automated test only
  }

  // ============================================================
  // 5. Icons (Iconify)
  // ============================================================
  function icons(body, c) {
    let timer = 0, selected = null, color = '#ffffff', token = 0;
    const root = el('div', 'grid gap-5 lg:grid-cols-[1fr_20rem]');
    body.append(root);
    const left = el('div', 'flex min-w-0 flex-col gap-4');
    const q = el('input', INPUT); q.type = 'search'; q.placeholder = 'Search 200,000+ icons, e.g. home, arrow, heart'; q.value = 'star';
    const quick = el('div', 'flex flex-wrap gap-2');
    ['home', 'arrow', 'user', 'heart', 'settings', 'search', 'discord', 'game', 'shield', 'music'].forEach((w) => quick.append(button(w, BTN2 + ' !px-3 !py-1 !text-xs', () => { q.value = w; run(); })));
    const grid = el('div', 'grid grid-cols-4 gap-2 sm:grid-cols-6 lg:grid-cols-8');
    left.append(q, quick, grid);

    const side = el('div', 'flex flex-col gap-4 self-start rounded-3xl border border-white/10 bg-white/[0.03] p-4 lg:sticky lg:top-0');
    const big = el('div', 'grid h-40 place-items-center rounded-2xl border border-white/10'); big.style.cssText = CHECKER;
    const bigImg = el('img', 'h-24 w-24'); bigImg.alt = '';
    big.append(bigImg);
    const nameEl = el('p', 'break-all font-mono text-sm text-white', 'Select an icon');
    const colorIn = el('input'); colorIn.type = 'color'; colorIn.value = color;
    const sizeIn = numberInput(64, 8, 512);
    const opts = el('div', 'grid grid-cols-2 gap-3'); opts.append(field('Color', colorIn), field('PNG size (px)', sizeIn));
    const acts = el('div', 'flex flex-wrap gap-2');
    const bSvg = button('Copy SVG', BTN, () => act('copy'));
    const bDl = button('Download SVG', BTN2, () => act('svg'));
    const bPng = button('Download PNG', BTN2, () => act('png'));
    const bName = button('Copy name', BTN2, async () => selected && c.say((await copy(selected)) ? 'Copied ' + selected : 'Could not copy.'));
    acts.append(bSvg, bDl, bPng, bName);
    [bSvg, bDl, bPng, bName].forEach((b) => (b.disabled = true));
    side.append(big, nameEl, opts, acts, el('p', 'text-xs leading-relaxed text-white/40', 'Icons come from open icon sets via Iconify. Check each set\'s license before using an icon commercially.'));
    root.append(left, side);

    const url = (id, extra = '') => { const [p, n] = id.split(':'); return `https://api.iconify.design/${p}/${n}.svg${extra}`; };
    function select(id) {
      selected = id;
      nameEl.textContent = id;
      bigImg.src = url(id, '?color=' + encodeURIComponent(color));
      [bSvg, bDl, bPng, bName].forEach((b) => (b.disabled = false));
    }
    colorIn.addEventListener('input', () => { color = colorIn.value; if (selected) select(selected); grid.querySelectorAll('img').forEach((i) => { i.src = i.dataset.src.replace(/color=[^&]*/, 'color=' + encodeURIComponent(color)); }); });
    async function svgText() {
      const r = await fetch(url(selected, '?color=' + encodeURIComponent(color)));
      if (!r.ok) throw new Error('Could not load that icon.');
      return r.text();
    }
    async function act(kind) {
      try {
        const svg = await svgText();
        const file = selected.replace(':', '-');
        if (kind === 'copy') c.say((await copy(svg)) ? 'Copied the SVG code.' : 'Could not copy.');
        else if (kind === 'svg') download(new Blob([svg], { type: 'image/svg+xml' }), file + '.svg');
        else {
          const size = Math.min(512, Math.max(8, Number(sizeIn.value) || 64));
          const blobUrl = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
          const im = await loadImage(blobUrl);
          const cv = el('canvas'); cv.width = size; cv.height = size;
          cv.getContext('2d').drawImage(im, 0, 0, size, size);
          URL.revokeObjectURL(blobUrl);
          download(await canvasBlob(cv), `${file}-${size}.png`);
        }
      } catch (e) { c.say(e.message, true); }
    }
    async function run() {
      const term = q.value.trim();
      const mine = ++token;
      if (!term) { grid.replaceChildren(); return; }
      c.say('Searching…');
      try {
        const r = await fetch('https://api.iconify.design/search?limit=96&query=' + encodeURIComponent(term));
        if (!r.ok) throw new Error();
        const data = await r.json();
        if (mine !== token) return;
        const list = data.icons || [];
        grid.replaceChildren(...list.map((id) => {
          const b = el('button', 'grid aspect-square place-items-center rounded-xl border border-white/10 bg-white/[0.03] transition-colors hover:bg-white/10');
          b.type = 'button'; b.title = id; b.setAttribute('aria-label', id);
          const im = el('img', 'h-7 w-7'); im.alt = ''; im.loading = 'lazy';
          im.dataset.src = url(id, '?color=' + encodeURIComponent(color) + '&height=28');
          im.src = im.dataset.src;
          b.append(im);
          b.addEventListener('click', () => select(id));
          return b;
        }));
        c.say(list.length ? `${list.length} icons${data.total > list.length ? ' shown of ' + data.total.toLocaleString() : ''}. Click one to copy or download it.` : 'No icons found. Try a simpler word.');
        if (list[0] && !selected) select(list[0]);
      } catch {
        if (mine === token) c.say('Could not reach the icon search. Check your connection and try again.', true);
      }
    }
    q.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(run, 350); });
    c.cleanup(() => clearTimeout(timer));
    run();
  }

  // ============================================================
  // Simple Bio Link Builder
  // ============================================================
  function bioLinkBuilder(body, c) {
    const STORAGE_KEY = 'brzyx-biolink-draft-v1';
    const defaults = {
      username: 'yourname',
      name: 'Your Name',
      bio: 'A little introduction about yourself.',
      accent: '#a78bfa',
      links: [
        { title: 'My Website', url: 'https://example.com' },
        { title: 'Instagram', url: 'https://instagram.com/' }
      ]
    };
    let state = { ...defaults, links: defaults.links.map((x) => ({ ...x })) };
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if (saved && typeof saved === 'object') {
        state = {
          username: String(saved.username || defaults.username).slice(0, 24),
          name: String(saved.name || defaults.name).slice(0, 40),
          bio: String(saved.bio || '').slice(0, 140),
          accent: /^#[0-9a-f]{6}$/i.test(saved.accent) ? saved.accent : defaults.accent,
          links: Array.isArray(saved.links) ? saved.links.slice(0, 8).map((x) => ({
            title: String(x.title || '').slice(0, 28),
            url: String(x.url || '').slice(0, 240)
          })) : defaults.links.map((x) => ({ ...x }))
        };
      }
    } catch {}

    const root = el('div', 'grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(320px,.85fr)]');
    body.append(root);
    const editor = el('div', 'flex min-w-0 flex-col gap-4');
    const previewWrap = el('div', 'flex min-w-0 flex-col gap-3');
    root.append(editor, previewWrap);

    const intro = el('div', 'rounded-2xl border border-white/10 bg-white/[.03] p-4');
    const kicker = el('div', 'text-[10px] font-bold uppercase tracking-[.24em] text-violet-300');
    kicker.textContent = 'BIO LINK STUDIO';
    const heading = el('div', 'mt-1 text-lg font-semibold text-white');
    heading.textContent = 'Create your page';
    const desc = el('p', 'mt-1 text-sm leading-relaxed text-white/50');
    desc.textContent = 'Set up the basics of your personal link page. Your draft is saved on this device.';
    intro.append(kicker, heading, desc);
    editor.append(intro);

    function makeField(labelText, value, max, onInput, placeholder) {
      const input = el('input', INPUT);
      input.value = value;
      input.maxLength = max;
      input.placeholder = placeholder || '';
      input.addEventListener('input', () => { onInput(input.value); drawPreview(); });
      return field(labelText, input);
    }
    const identity = el('div', 'grid gap-3 sm:grid-cols-2');
    const nameField = makeField('Display name', state.name, 40, (v) => { state.name = v; });
    const usernameField = makeField('Username', state.username, 24, (v) => { state.username = v.toLowerCase().replace(/[^a-z0-9_]/g, ''); });
    identity.append(nameField, usernameField);
    editor.append(identity);

    const bio = el('textarea', INPUT + ' min-h-24 resize-y');
    bio.value = state.bio; bio.maxLength = 140; bio.placeholder = 'Write a short bio…';
    bio.addEventListener('input', () => { state.bio = bio.value; drawPreview(); });
    editor.append(field('Short bio', bio));

    const color = el('input');
    color.type = 'color'; color.value = state.accent;
    color.addEventListener('input', () => { state.accent = color.value; drawPreview(); });
    editor.append(field('Accent color', color));

    const linksHead = el('div', 'flex items-center justify-between gap-3');
    const linksTitle = el('div', 'text-sm font-semibold text-white');
    linksTitle.textContent = 'Your links';
    const add = button('+ Add link', BTN2, () => {
      if (state.links.length >= 8) { c.say('You can add up to 8 links in this starter version.', true); return; }
      state.links.push({ title: '', url: '' });
      drawEditorLinks(); drawPreview();
    });
    linksHead.append(linksTitle, add);
    editor.append(linksHead);
    const linksList = el('div', 'flex flex-col gap-3');
    editor.append(linksList);

    function drawEditorLinks() {
      linksList.replaceChildren();
      state.links.forEach((link, index) => {
        const card = el('div', 'grid gap-2 rounded-2xl border border-white/10 bg-white/[.025] p-3 sm:grid-cols-[minmax(0,.8fr)_minmax(0,1.2fr)_auto]');
        const titleInput = el('input', INPUT);
        titleInput.placeholder = 'Link title'; titleInput.maxLength = 28; titleInput.value = link.title;
        titleInput.addEventListener('input', () => { state.links[index].title = titleInput.value; drawPreview(); });
        const urlInput = el('input', INPUT);
        urlInput.placeholder = 'https://example.com'; urlInput.maxLength = 240; urlInput.inputMode = 'url'; urlInput.value = link.url;
        urlInput.addEventListener('input', () => { state.links[index].url = urlInput.value; drawPreview(); });
        const remove = button('Remove', BTN2, () => {
          state.links.splice(index, 1); drawEditorLinks(); drawPreview();
        });
        remove.className += ' self-start';
        card.append(titleInput, urlInput, remove);
        linksList.append(card);
      });
      add.disabled = state.links.length >= 8;
    }
    drawEditorLinks();

    const actions = el('div', 'flex flex-wrap gap-2');
    const save = button('Save draft', BTN, () => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        c.say('Bio link draft saved on this device.');
      } catch { c.say('Could not save this draft in your browser.', true); }
    });
    const reset = button('Reset draft', BTN2, () => {
      state = { ...defaults, links: defaults.links.map((x) => ({ ...x })) };
      editor.querySelectorAll('input').forEach((n) => { if (n.type !== 'color') n.value = ''; });
      // Rebuild the small editor controls so all inputs reflect the defaults.
      c.say('Draft reset. Refresh the preview to see the starter layout.');
      location.reload();
    });
    actions.append(save, reset);
    editor.append(actions);

    const previewHead = el('div', 'flex items-center justify-between gap-3');
    const previewTitle = el('div', 'text-sm font-semibold text-white');
    previewTitle.textContent = 'Live preview';
    const previewNote = el('div', 'text-[11px] text-white/40');
    previewNote.textContent = 'Preview only';
    previewHead.append(previewTitle, previewNote);
    previewWrap.append(previewHead);

    const stage = el('div', 'relative flex min-h-[540px] items-center justify-center overflow-hidden rounded-3xl border border-white/10 bg-[#09090d] p-5');
    const glow = el('div', 'pointer-events-none absolute -left-20 -top-20 h-64 w-64 rounded-full blur-[90px]');
    const profile = el('div', 'relative z-10 w-full max-w-[360px] rounded-[28px] border border-white/10 bg-[#111116]/90 p-6 shadow-2xl backdrop-blur-xl');
    const avatar = el('div', 'mx-auto grid h-20 w-20 place-items-center rounded-full border border-white/15 bg-white/10 text-2xl font-bold text-white');
    const displayName = el('div', 'mt-4 text-center text-xl font-bold tracking-tight text-white');
    const handle = el('div', 'mt-1 text-center text-xs text-white/40');
    const bioText = el('p', 'mx-auto mt-3 max-w-[290px] text-center text-sm leading-relaxed text-white/60');
    const previewLinks = el('div', 'mt-6 flex flex-col gap-2');
    const footer = el('div', 'mt-6 text-center text-[10px] font-semibold uppercase tracking-[.2em] text-white/25');
    footer.textContent = 'MADE WITH BRZYX';
    profile.append(avatar, displayName, handle, bioText, previewLinks, footer);
    stage.append(glow, profile);
    previewWrap.append(stage);

    function validHref(raw) {
      try {
        const u = new URL(raw);
        return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : '';
      } catch { return ''; }
    }
    function drawPreview() {
      glow.style.background = state.accent;
      glow.style.opacity = '.22';
      avatar.style.borderColor = state.accent + '88';
      avatar.style.background = state.accent + '22';
      avatar.textContent = (state.name.trim()[0] || '?').toUpperCase();
      displayName.textContent = state.name.trim() || 'Your Name';
      handle.textContent = '@' + (state.username || 'yourname');
      bioText.textContent = state.bio || 'Your short bio will appear here.';
      previewLinks.replaceChildren();
      const links = state.links.filter((x) => x.title.trim() && validHref(x.url));
      if (!links.length) {
        const empty = el('div', 'rounded-xl border border-dashed border-white/15 px-3 py-4 text-center text-xs text-white/35');
        empty.textContent = 'Your links will appear here';
        previewLinks.append(empty);
      }
      links.forEach((link) => {
        const a = el('a', 'flex min-h-12 items-center justify-center rounded-xl border border-white/10 bg-white/[.045] px-4 py-3 text-sm font-semibold text-white transition hover:bg-white/10');
        a.href = validHref(link.url);
        a.target = '_blank'; a.rel = 'noopener noreferrer';
        a.textContent = link.title;
        a.style.borderColor = state.accent + '55';
        previewLinks.append(a);
      });
    }
    drawPreview();
    c.say('Build your basic bio link page. Add a few links and save your draft; profile assets and publishing can come next.');
  }

  // ============================================================
  // 6. Roblox Clothing Showcaser
  // ============================================================
  // Pixel rectangles [x, y, w, h] on Roblox's classic 585 x 559 clothing template.
  // Source: Roblox Developer Forum "Shirts and Pants UV mapping".
  const UV = {
    torso: { front: [231, 74, 128, 128], back: [427, 74, 128, 128], left: [361, 74, 64, 128], right: [165, 74, 64, 128], top: [231, 8, 128, 64], bottom: [231, 204, 128, 64] },
    // Limbs on the character's right (screen left) and left (screen right).
    rlimb: { front: [217, 355, 64, 128], back: [85, 355, 64, 128], left: [19, 355, 64, 128], right: [151, 355, 64, 128], top: [217, 289, 64, 64], bottom: [217, 485, 64, 64] },
    llimb: { front: [308, 355, 64, 128], back: [440, 355, 64, 128], left: [374, 355, 64, 128], right: [506, 355, 64, 128], top: [308, 289, 64, 64], bottom: [308, 485, 64, 64] },
  };
  const TEMPLATE_W = 585, TEMPLATE_H = 559;

  // Face corners (top-left, top-right, bottom-left) in a box with half sizes h, plus the outward normal.
  // Scene convention: the character faces +z (toward the viewer); the character's right side is -x (screen left).
  function faceDefs(hx, hy, hz) {
    return {
      front: { n: [0, 0, 1], c: [[-hx, hy, hz], [hx, hy, hz], [-hx, -hy, hz]] },
      back: { n: [0, 0, -1], c: [[hx, hy, -hz], [-hx, hy, -hz], [hx, -hy, -hz]] },
      right: { n: [-1, 0, 0], c: [[-hx, hy, -hz], [-hx, hy, hz], [-hx, -hy, -hz]] },
      left: { n: [1, 0, 0], c: [[hx, hy, hz], [hx, hy, -hz], [hx, -hy, hz]] },
      top: { n: [0, 1, 0], c: [[-hx, hy, -hz], [hx, hy, -hz], [-hx, hy, hz]] },
      bottom: { n: [0, -1, 0], c: [[-hx, -hy, hz], [hx, -hy, hz], [-hx, -hy, -hz]] },
    };
  }
  // Mannequin parts (studs). 'tex' picks which composed texture and UV set a part uses.
  const PARTS = [
    { id: 'legR', tex: 'legs', uv: 'rlimb', pos: [-0.5, -2, 0], half: [0.5, 1, 0.5] },
    { id: 'legL', tex: 'legs', uv: 'llimb', pos: [0.5, -2, 0], half: [0.5, 1, 0.5] },
    { id: 'torso', tex: 'torso', uv: 'torso', pos: [0, 0, 0], half: [1, 1, 0.5] },
    { id: 'armR', tex: 'arms', uv: 'rlimb', pos: [-1.5, 0, 0], half: [0.5, 1, 0.5] },
    { id: 'armL', tex: 'arms', uv: 'llimb', pos: [1.5, 0, 0], half: [0.5, 1, 0.5] },
    { id: 'head', tex: 'head', uv: null, pos: [0, 1.62, 0], half: [0.62, 0.62, 0.62] },
  ];
  const LIGHT = (() => { const l = [-0.35, 0.65, 0.68]; const m = Math.hypot(...l); return l.map((v) => v / m); })();

  function renderScene(g, W, H, opts) {
    // opts: bg, figures:[{angle, cx, cy, scale}], tex, shadow
    drawBackground(g, W, H, opts.bg);
    const pitch = (12 * Math.PI) / 180; // camera slightly above, so the tops of the shoulders and head show
    for (const fig of opts.figures) {
      // Soft floor shadow under the feet.
      g.save();
      g.translate(fig.cx, fig.cy + 2.95 * fig.scale);
      g.scale(1, 0.2);
      const sh = g.createRadialGradient(0, 0, 0, 0, 0, 1.8 * fig.scale);
      sh.addColorStop(0, opts.bg === 'studio' ? 'rgba(0,0,0,.3)' : 'rgba(0,0,0,.6)');
      sh.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = sh;
      g.fillRect(-2 * fig.scale, -2 * fig.scale, 4 * fig.scale, 4 * fig.scale);
      g.restore();
      drawFigure(g, fig, opts.tex, pitch);
    }
  }

  function drawBackground(g, W, H, kind) {
    if (kind === 'studio') {
      const gr = g.createLinearGradient(0, 0, 0, H);
      gr.addColorStop(0, '#f1f1f4'); gr.addColorStop(1, '#b9b9c4');
      g.fillStyle = gr; g.fillRect(0, 0, W, H);
    } else if (kind === 'aurora') {
      g.fillStyle = '#06060a'; g.fillRect(0, 0, W, H);
      [['#ff5c7a', 0.2, 0.3, 0.22], ['#8a5cff', 0.5, 0.75, 0.25], ['#00ffd1', 0.82, 0.3, 0.2]].forEach(([col, x, y, a]) => {
        const rg = g.createRadialGradient(W * x, H * y, 0, W * x, H * y, Math.max(W, H) * 0.55);
        rg.addColorStop(0, col + Math.round(a * 255).toString(16).padStart(2, '0')); rg.addColorStop(1, col + '00');
        g.fillStyle = rg; g.fillRect(0, 0, W, H);
      });
    } else {
      const gr = g.createLinearGradient(0, 0, W, H);
      gr.addColorStop(0, '#0a0a10'); gr.addColorStop(1, '#1c1236');
      g.fillStyle = gr; g.fillRect(0, 0, W, H);
      const rg = g.createRadialGradient(W / 2, H * 0.4, 0, W / 2, H * 0.4, Math.max(W, H) * 0.6);
      rg.addColorStop(0, 'rgba(138,92,255,.22)'); rg.addColorStop(1, 'rgba(138,92,255,0)');
      g.fillStyle = rg; g.fillRect(0, 0, W, H);
    }
  }

  function drawFigure(g, fig, tex, pitch) {
    const a = (fig.angle * Math.PI) / 180, ca = Math.cos(a), sa = Math.sin(a), cp = Math.cos(pitch), sp = Math.sin(pitch);
    const rot = (v) => {
      const x = v[0] * ca + v[2] * sa, z1 = -v[0] * sa + v[2] * ca;
      return [x, v[1] * cp - z1 * sp, v[1] * sp + z1 * cp];
    };
    const faces = [];
    for (const part of PARTS) {
      const defs = faceDefs(...part.half);
      for (const [key, def] of Object.entries(defs)) {
        const n = rot(def.n);
        if (n[2] <= 0.001) continue; // faces turned away from the viewer
        const pts = def.c.map((p) => rot([p[0] + part.pos[0], p[1] + part.pos[1], p[2] + part.pos[2]]));
        const center = rot(part.pos.map((v, i) => v + def.n[i] * part.half[i]));
        faces.push({ part, key, n, pts, depth: center[2] });
      }
    }
    faces.sort((p, q) => p.depth - q.depth);
    for (const f of faces) {
      const P = f.pts.map((p) => [fig.cx + p[0] * fig.scale, fig.cy - p[1] * fig.scale]);
      const source = tex[f.part.tex];
      let rect, img;
      if (f.part.id === 'head') {
        img = f.key === 'front' ? tex.face : tex.skinTile;
        rect = [0, 0, img.width, img.height];
      } else {
        img = source;
        const sx = img.width / TEMPLATE_W, sy = img.height / TEMPLATE_H, r = UV[f.part.uv][f.key];
        rect = [r[0] * sx, r[1] * sy, r[2] * sx, r[3] * sy];
      }
      const e1 = [(P[1][0] - P[0][0]) / rect[2], (P[1][1] - P[0][1]) / rect[2]];
      const e2 = [(P[2][0] - P[0][0]) / rect[3], (P[2][1] - P[0][1]) / rect[3]];
      g.save();
      g.beginPath();
      const P3 = [P[0][0] + (P[1][0] - P[0][0]) + (P[2][0] - P[0][0]), P[0][1] + (P[1][1] - P[0][1]) + (P[2][1] - P[0][1])];
      g.moveTo(P[0][0], P[0][1]); g.lineTo(P[1][0], P[1][1]); g.lineTo(P3[0], P3[1]); g.lineTo(P[2][0], P[2][1]); g.closePath();
      g.clip();
      g.setTransform(e1[0], e1[1], e2[0], e2[1], P[0][0], P[0][1]);
      g.imageSmoothingEnabled = true;
      g.drawImage(img, rect[0], rect[1], rect[2], rect[3], 0, 0, rect[2], rect[3]);
      g.restore();
      // Shade by light direction.
      const lit = Math.max(0, f.n[0] * LIGHT[0] + f.n[1] * LIGHT[1] + f.n[2] * LIGHT[2]);
      g.save();
      g.beginPath();
      g.moveTo(P[0][0], P[0][1]); g.lineTo(P[1][0], P[1][1]); g.lineTo(P3[0], P3[1]); g.lineTo(P[2][0], P[2][1]); g.closePath();
      g.fillStyle = `rgba(0,0,0,${((1 - (0.55 + 0.45 * lit)) * 0.9).toFixed(3)})`;
      g.fill();
      g.restore();
    }
  }

  let faviconPromise = null;
  function loadFavicon() {
    if (!faviconPromise) faviconPromise = loadImage('/favicon-image').catch(() => null);
    return faviconPromise;
  }
  function drawWatermark(g, W, H, favicon, scale, dark) {
    const size = Math.round(64 * scale), pad = Math.round(28 * scale);
    const x = W - pad - size, y = H - pad - size;
    g.save();
    g.beginPath(); g.roundRect(x, y, size, size, size * 0.28); g.clip();
    if (favicon) g.drawImage(favicon, x, y, size, size);
    else { g.fillStyle = '#8a5cff'; g.fillRect(x, y, size, size); g.fillStyle = '#fff'; g.font = `700 ${size * 0.55}px "SF Pro", -apple-system, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('B', x + size / 2, y + size / 2 + 2); }
    g.restore();
    g.save();
    g.beginPath(); g.roundRect(x, y, size, size, size * 0.28); g.strokeStyle = dark ? 'rgba(0,0,0,.25)' : 'rgba(255,255,255,.3)'; g.lineWidth = Math.max(1, 2 * scale); g.stroke();
    g.restore();
    g.font = `600 ${Math.round(22 * scale)}px "SF Compact", "SF Pro", -apple-system, sans-serif`;
    g.textAlign = 'right'; g.textBaseline = 'middle';
    g.fillStyle = dark ? 'rgba(0,0,0,.55)' : 'rgba(255,255,255,.7)';
    g.fillText(location.host, x - 16 * scale, y + size / 2);
  }

  function clothingShowcaser(body, c) {
    const state = { shirt: null, pants: null, skin: '#e9b98a', bg: 'midnight', title: 'My clothing', mode: '3d', angle: 25 };
    let favicon = null;
    loadFavicon().then((f) => { favicon = f; draw(); });

    const root = el('div', 'flex flex-col gap-5');
    body.append(root);

    const intro = el('div', 'flex flex-col gap-1');
    const eyebrow = el('div', 'text-[10px] font-bold uppercase tracking-[.28em] text-violet-300');
    eyebrow.textContent = 'DRIPZELS STYLE PREVIEW';
    const heading = el('div', 'text-lg font-semibold tracking-tight text-white');
    heading.textContent = 'Clothing studio';
    const sub = el('p', 'text-sm text-white/50');
    sub.textContent = 'Build your look, then switch between a 3D avatar and a flat 2D showcase.';
    intro.append(eyebrow, heading, sub);
    root.append(intro);

    const controls = el('div', 'grid gap-4 sm:grid-cols-2 lg:grid-cols-3');
    root.append(controls);

    function pick(label, key) {
      const i = el('input', 'text-xs text-white/60 file:mr-3 file:rounded-full file:border-0 file:bg-white file:px-3 file:py-1.5 file:font-semibold file:text-black');
      i.type = 'file'; i.accept = 'image/png,image/jpeg,image/webp';
      i.addEventListener('change', async () => {
        if (!i.files[0]) return;
        try {
          const img = await loadImageFile(i.files[0]);
          if (img.naturalWidth !== TEMPLATE_W || img.naturalHeight !== TEMPLATE_H) {
            c.say('This image is ' + img.naturalWidth + ' × ' + img.naturalHeight + '. Classic Roblox templates are 585 × 559.', true);
          }
          state[key] = img;
          draw();
          c.say(label + ' added to both previews.');
        } catch (e) { c.say(e.message, true); }
      });
      return field(label, i);
    }

    const title = el('input', INPUT); title.value = state.title; title.maxLength = 40;
    title.addEventListener('input', () => { state.title = title.value; draw(); });
    const skin = el('input'); skin.type = 'color'; skin.value = state.skin;
    skin.addEventListener('input', () => { state.skin = skin.value; draw(); });
    const bgSel = el('select', INPUT);
    [['midnight', 'Midnight'], ['aurora', 'Aurora'], ['studio', 'Studio light']].forEach(([v, t]) => {
      const o = el('option', '', t); o.value = v; bgSel.append(o);
    });
    bgSel.addEventListener('change', () => { state.bg = bgSel.value; draw(); });
    controls.append(pick('Shirt template', 'shirt'), pick('Pants template (optional)', 'pants'),
      field('Showcase title', title), field('Skin color', skin), field('Background', bgSel));

    const modeRow = el('div', 'flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[.035] p-3');
    const modeLabel = el('div', 'text-xs font-semibold uppercase tracking-wider text-white/60');
    modeLabel.textContent = 'Preview mode';
    const modeSelect = el('select', INPUT + ' min-w-32');
    [['3d', '3D Avatar'], ['2d', 'Flat 2D']].forEach(([v, t]) => {
      const o = el('option', '', t); o.value = v; modeSelect.append(o);
    });
    modeSelect.value = state.mode;
    modeSelect.addEventListener('change', () => { state.mode = modeSelect.value; draw(); });
    const rotateWrap = el('label', 'flex items-center gap-3 text-xs text-white/60');
    const rotateText = el('span', 'whitespace-nowrap'); rotateText.textContent = 'Rotate avatar';
    const rotate = el('input', 'w-32 accent-violet-400');
    rotate.type = 'range'; rotate.min = '-180'; rotate.max = '180'; rotate.value = String(state.angle);
    rotate.addEventListener('input', () => { state.angle = Number(rotate.value); draw(); });
    rotateWrap.append(rotateText, rotate);
    modeRow.append(modeLabel, modeSelect, rotateWrap);
    root.append(modeRow);

    const canvas = el('canvas', 'w-full rounded-3xl border border-white/10 shadow-2xl shadow-black/20');
    canvas.width = 1800; canvas.height = 850;
    canvas.setAttribute('aria-label', 'Roblox clothing preview with switchable 3D avatar and flat 2D views.');
    root.append(canvas);

    function drawFlatBackground(g, W, H) {
      if (state.bg === 'studio') {
        const gr = g.createLinearGradient(0, 0, 0, H);
        gr.addColorStop(0, '#f1f1f4'); gr.addColorStop(1, '#b9b9c4');
        g.fillStyle = gr; g.fillRect(0, 0, W, H);
      } else if (state.bg === 'aurora') {
        g.fillStyle = '#080810'; g.fillRect(0, 0, W, H);
        [['#ff5c7a', .2, .3], ['#8a5cff', .5, .75], ['#00ffd1', .82, .3]].forEach(([col, x, y]) => {
          const rg = g.createRadialGradient(W*x, H*y, 0, W*x, H*y, Math.max(W,H)*.55);
          rg.addColorStop(0, col + '55'); rg.addColorStop(1, col + '00');
          g.fillStyle = rg; g.fillRect(0,0,W,H);
        });
      } else {
        const gr = g.createLinearGradient(0, 0, W, H);
        gr.addColorStop(0, '#09090f'); gr.addColorStop(1, '#20113a');
        g.fillStyle = gr; g.fillRect(0, 0, W, H);
        const glow = g.createRadialGradient(W*.5,H*.4,0,W*.5,H*.4,W*.65);
        glow.addColorStop(0,'rgba(139,92,246,.18)'); glow.addColorStop(1,'rgba(139,92,246,0)');
        g.fillStyle = glow; g.fillRect(0,0,W,H);
      }
    }

    function drawFlatFigure(g, cx, top, view) {
      const front = view === 'FRONT', back = view === 'BACK', side = view === 'SIDE';
      const shirt = state.shirt, pants = state.pants, skinColor = state.skin;
      const sideKey = front ? 'front' : back ? 'back' : 'left';
      const limbKey = sideKey;
      const drawPart = (img, uvSet, face, x, y, w, h, fallback) => {
        g.fillStyle = fallback; g.fillRect(x, y, w, h);
        if (!img) return;
        const r = UV[uvSet][face];
        g.drawImage(img, r[0], r[1], r[2], r[3], x, y, w, h);
      };
      const headW = side ? 76 : 112, headH = 112;
      const torsoW = side ? 82 : 176, torsoH = 190;
      const armW = side ? 48 : 64, armH = 190;
      const legW = side ? 62 : 84, legH = 210;
      const headX = cx - headW/2, headY = top;
      const torsoX = cx - torsoW/2, torsoY = top + 126;
      const legY = torsoY + torsoH + 8;
      const leftArmX = side ? cx - torsoW/2 - armW : torsoX - armW - 10;
      const rightArmX = side ? cx + torsoW/2 : torsoX + torsoW + 10;
      const gap = side ? 0 : 8;

      g.fillStyle = skinColor; g.fillRect(headX, headY, headW, headH);
      if (front && !side) {
        g.fillStyle = '#171717';
        g.beginPath(); g.arc(cx-24, headY+47, 7, 0, Math.PI*2); g.arc(cx+24, headY+47, 7, 0, Math.PI*2); g.fill();
        g.strokeStyle = '#171717'; g.lineWidth = 5; g.beginPath(); g.arc(cx, headY+62, 22, .2*Math.PI, .8*Math.PI); g.stroke();
      }
      drawPart(shirt, 'torso', sideKey, torsoX, torsoY, torsoW, torsoH, skinColor);
      if (pants) {
        const r = UV.torso[sideKey];
        g.save(); g.beginPath(); g.rect(torsoX, torsoY + torsoH*.58, torsoW, torsoH*.42); g.clip();
        g.drawImage(pants, r[0], r[1], r[2], r[3], torsoX, torsoY, torsoW, torsoH);
        g.restore();
      }
      drawPart(shirt, 'rlimb', limbKey, leftArmX, torsoY, armW, armH, skinColor);
      drawPart(shirt, 'llimb', limbKey, rightArmX, torsoY, armW, armH, skinColor);
      const leftLegX = side ? cx-legW : cx-legW-gap/2;
      const rightLegX = side ? cx : cx+gap/2;
      drawPart(pants, 'rlimb', limbKey, leftLegX, legY, legW, legH, skinColor);
      drawPart(pants, 'llimb', limbKey, rightLegX, legY, legW, legH, skinColor);
      g.strokeStyle = 'rgba(255,255,255,.14)'; g.lineWidth = 2;
      g.strokeRect(headX, headY, headW, headH); g.strokeRect(torsoX, torsoY, torsoW, torsoH);
    }

    function makeTexture(source, fallback) {
      const texCanvas = el('canvas');
      texCanvas.width = TEMPLATE_W; texCanvas.height = TEMPLATE_H;
      const ctx = texCanvas.getContext('2d');
      ctx.fillStyle = fallback; ctx.fillRect(0, 0, TEMPLATE_W, TEMPLATE_H);
      if (source) ctx.drawImage(source, 0, 0, TEMPLATE_W, TEMPLATE_H);
      return texCanvas;
    }

    function makeFace() {
      const face = el('canvas'); face.width = 128; face.height = 128;
      const g = face.getContext('2d');
      g.fillStyle = state.skin; g.fillRect(0, 0, 128, 128);
      g.fillStyle = '#20202a';
      g.beginPath(); g.arc(42, 54, 6, 0, Math.PI*2); g.arc(86, 54, 6, 0, Math.PI*2); g.fill();
      g.strokeStyle = '#20202a'; g.lineWidth = 5;
      g.beginPath(); g.arc(64, 66, 23, .18*Math.PI, .82*Math.PI); g.stroke();
      return face;
    }

    function drawFlat(g, W, H) {
      drawFlatBackground(g, W, H);
      const dark = state.bg !== 'studio';
      g.fillStyle = dark ? '#fff' : '#111';
      g.font = '700 46px sans-serif'; g.textAlign = 'left'; g.textBaseline = 'top';
      if (state.title.trim()) g.fillText(state.title.trim(), 54, 42);
      const centers = [W*.19, W*.5, W*.81], labels = ['FRONT', 'SIDE', 'BACK'];
      labels.forEach((label, i) => {
        const x = centers[i];
        g.fillStyle = dark ? 'rgba(255,255,255,.55)' : 'rgba(0,0,0,.5)';
        g.font = '600 25px sans-serif'; g.textAlign = 'center'; g.fillText(label, x, 140);
        g.fillStyle = dark ? 'rgba(255,255,255,.05)' : 'rgba(0,0,0,.04)';
        g.beginPath(); g.roundRect(x-260, 180, 520, 610, 30); g.fill();
        drawFlatFigure(g, x, 220, label);
      });
      drawWatermark(g, W, H, favicon, .75, !dark);
    }

    function draw3D(g, W, H) {
      const shirtTexture = makeTexture(state.shirt, state.skin);
      const pantsTexture = makeTexture(state.pants, state.skin);
      const skinTexture = makeTexture(null, state.skin);
      const tex = {
        torso: shirtTexture, arms: shirtTexture, legs: pantsTexture,
        head: skinTexture, face: makeFace(), skinTile: skinTexture
      };
      renderScene(g, W, H, {
        bg: state.bg,
        tex,
        figures: [{ angle: state.angle, cx: W/2, cy: 405, scale: 105 }]
      });
      const dark = state.bg !== 'studio';
      g.fillStyle = dark ? '#fff' : '#111';
      g.font = '700 46px sans-serif'; g.textAlign = 'left'; g.textBaseline = 'top';
      if (state.title.trim()) g.fillText(state.title.trim(), 54, 42);
      g.fillStyle = dark ? 'rgba(255,255,255,.6)' : 'rgba(0,0,0,.55)';
      g.font = '600 22px sans-serif'; g.textAlign = 'center';
      g.fillText('3D AVATAR  ·  DRAG THE ROTATION SLIDER', W/2, H-54);
      drawWatermark(g, W, H, favicon, .75, !dark);
    }

    function draw() {
      const g = canvas.getContext('2d'), W = canvas.width, H = canvas.height;
      if (state.mode === '3d') draw3D(g, W, H);
      else drawFlat(g, W, H);
      rotateWrap.style.display = state.mode === '3d' ? 'flex' : 'none';
    }

    const actions = el('div', 'flex flex-wrap gap-3');
    const save = button('Download showcase', BTN, async () => {
      draw();
      download(await canvasBlob(canvas), state.mode === '3d' ? 'roblox-3d-clothing-showcase.png' : 'roblox-flat-2d-clothing-showcase.png');
      c.say('Downloaded the ' + state.mode.toUpperCase() + ' clothing showcase.');
    });
    const reset = button('Reset clothing', BTN2, () => {
      state.shirt = null; state.pants = null; draw(); c.say('Clothing cleared.');
    });
    actions.append(save, reset);
    root.append(actions);
    draw();
    c.say('Upload classic Roblox shirt and pants templates, then switch between the 3D avatar and flat 2D views.');
  }
  // ============================================================
  // Registry + grid
  // ============================================================
  const TOOLS = [
    { id: 'bg', name: 'Background Remover', blurb: 'Cut the background out of any image and download a transparent PNG.', mount: backgroundRemover,
      icon: '<path d="M4 7V5a1 1 0 0 1 1-1h2M17 4h2a1 1 0 0 1 1 1v2M20 17v2a1 1 0 0 1-1 1h-2M7 20H5a1 1 0 0 1-1-1v-2"/><circle cx="12" cy="10" r="3"/><path d="M6.5 19a6 6 0 0 1 11 0"/>' },
    { id: 'font', name: 'Font Finder', blurb: 'Preview fonts with your own text, then copy the name or CSS.', mount: fontFinder,
      icon: '<path d="M4 20 10 5h1l6 15M6.5 15h7M16 20l3-8h.5l2.5 8M17 18h4"/>' },
    { id: 'color', name: 'Color Picker', blurb: 'Pick any color from an image with a magnifier, and get its dominant palette.', mount: colorPicker,
      icon: '<path d="m14 7 3 3M5 19l9-9 3 3-9 9H5zM15.5 5.5l1.5-1.500a2 2 0 0 1 3 3L18.500 8.500"/>' },
    { id: 'split', name: 'Split Images', blurb: 'Cut one image into a grid of tiles and download them all as a zip.', mount: splitImages,
      icon: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M12 3v18M3 12h18"/>' },
    { id: 'icons', name: 'Icons', blurb: 'Search open icon sets, then copy the SVG or download an SVG or PNG.', mount: icons,
      icon: '<path d="m12 3 2.700 5.600 6.100.9-4.400 4.300 1 6.100L12 17l-5.400 2.900 1-6.100L3.200 9.500l6.100-.9z"/>' },
    { id: 'biolink', name: 'Bio Link Builder', blurb: 'Create a simple personal link page with a live preview and a saved local draft.', mount: bioLinkBuilder,
      icon: '<rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="9" cy="10" r="2"/><path d="M14 9h4M14 13h4M7 16h11"/>' },
    { id: 'roblox', name: 'Roblox Clothing Showcaser', blurb: 'Preview Roblox clothing on a rotatable 3D avatar or in a flat 2D front, side and back showcase.', mount: clothingShowcaser,
      icon: '<path d="M8 3 3 6l2 4 2-1v11h10V9l2 1 2-4-5-3a4 4 0 0 1-8 0z"/>' },
  ];

  const grid = $('tools-grid');
  TOOLS.forEach((t) => {
    const li = el('li');
    const b = el('button', 'group flex h-full w-full flex-col items-start gap-3 rounded-3xl border border-white/10 bg-black/40 p-5 text-left backdrop-blur transition-colors hover:bg-white/[0.07]');
    b.type = 'button';
    const ico = el('span', 'grid h-11 w-11 place-items-center rounded-2xl border border-white/15 bg-white/5 text-white');
    ico.innerHTML = `<svg class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${t.icon}</svg>`; // static markup from this file
    b.append(ico, el('span', 'text-lg font-semibold text-white', t.name), el('span', 'text-sm leading-relaxed text-white/55', t.blurb));
    b.addEventListener('click', () => openTool(t));
    li.append(b);
    grid.append(li);
  });
})();
