(function () {
  const $ = (id) => document.getElementById(id);

  // Build elements with textContent only, so admin-entered text can never inject HTML.
  function h(tag, cls, text) {
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    if (text != null) el.textContent = text;
    return el;
  }
  const safeUrl = (u) => (/^(https?:\/\/|\/|mailto:|tel:)/i.test(u || '') ? u : '');

  // Hero background
  ColorBends($('hero-bg'), {
    colors: ['#ff5c7a', '#8a5cff', '#00ffd1'],
    rotation: 90,
    speed: 0.2,
    scale: 1,
    frequency: 1,
    warpStrength: 1,
    mouseInfluence: 1,
    noise: 0.15,
    parallax: 0.5,
    intensity: 1.5,
    bandWidth: 6,
  });

  function avatar(el, profile) {
    el.replaceChildren();
    if (profile.avatar) {
      const img = h('img', 'h-full w-full object-cover');
      img.src = profile.avatar;
      img.alt = profile.name + ' profile picture';
      el.append(img);
    } else {
      el.textContent = (profile.name || 'b').charAt(0).toLowerCase();
    }
  }

  function card(item, kind) {
    const link = safeUrl(item.link);
    const root = h(link ? 'a' : 'article', 'group flex flex-col overflow-hidden rounded-3xl border border-white/10 bg-white/[0.03] transition-colors hover:bg-white/[0.06]');
    if (link) {
      root.href = link;
      root.target = '_blank';
      root.rel = 'noopener noreferrer';
    }
    const media = h('div', 'aspect-[16/9] w-full overflow-hidden bg-white/5');
    if (item.image) {
      const img = h('img', 'h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]');
      img.src = item.image;
      img.alt = item.title;
      img.loading = 'lazy';
      media.append(img);
    }
    const body = h('div', 'flex flex-1 flex-col gap-2 p-5');
    body.append(h('h3', 'text-lg font-semibold', item.title));
    if (item.description) body.append(h('p', 'text-sm leading-relaxed text-white/55', item.description));
    if (kind === 'projects' && item.tags && item.tags.length) {
      const tags = h('ul', 'mt-auto flex flex-wrap gap-1.5 pt-2');
      item.tags.forEach((t) => tags.append(h('li', 'rounded-full border border-white/10 px-2.5 py-0.5 text-xs text-white/60', t)));
      body.append(tags);
    }
    root.append(media, body);
    return root;
  }

  function empty(text) {
    return h('p', 'col-span-full rounded-3xl border border-dashed border-white/10 p-8 text-center text-sm text-white/40', text);
  }

  function renderContent(db) {
    const p = db.profile;
    document.title = p.name + "'s Portfolio";
    $('notch-name').textContent = p.name;
    $('footer-name').textContent = p.name;
    $('hero-name').textContent = p.name + "'s";
    $('hero-tagline').textContent = p.tagline;
    avatar($('notch-avatar'), p);
    avatar($('hero-avatar'), p);

    const pw = $('pastwork-grid');
    pw.replaceChildren(...(db.pastwork.length ? db.pastwork.map((i) => card(i, 'pastwork')) : [empty('Past work is coming soon.')]));
    const pr = $('projects-grid');
    pr.replaceChildren(...(db.projects.length ? db.projects.map((i) => card(i, 'projects')) : [empty('Projects are coming soon.')]));

    const clients = $('clients');
    clients.classList.toggle('hidden', !db.clients.length);
    $('clients-list').replaceChildren(
      ...db.clients.map((c) => {
        const link = safeUrl(c.invite);
        const li = h('li');
        const a = h('a', 'flex items-center gap-4 rounded-3xl border border-white/10 bg-white/[0.03] p-4 transition-colors hover:bg-white/[0.06]');
        if (link) {
          a.href = link;
          a.target = '_blank';
          a.rel = 'noopener noreferrer';
        }
        const icon = h('div', 'grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded-full bg-white/10 text-lg font-bold');
        if (c.icon) {
          const img = h('img', 'h-full w-full object-cover');
          img.src = c.icon;
          img.alt = '';
          img.loading = 'lazy';
          icon.append(img);
        } else icon.textContent = (c.name || '?').charAt(0);
        const text = h('div', 'min-w-0');
        text.append(h('p', 'truncate font-semibold', c.name), h('p', 'text-sm text-white/50', Number(c.members).toLocaleString() + ' members'));
        a.append(icon, text);
        li.append(a);
        return li;
      })
    );

    $('contact-list').replaceChildren(
      ...(db.contacts.length
        ? db.contacts.map((c) => {
            const li = h('li');
            const link = safeUrl(c.url);
            const el = h(link ? 'a' : 'span', 'flex items-center gap-2 rounded-2xl border border-white/15 bg-white/[0.03] px-5 py-3 text-sm font-semibold transition-colors ' + (link ? 'hover:bg-white/10' : ''));
            if (link) {
              el.href = link;
              if (/^https?:/i.test(link)) {
                el.target = '_blank';
                el.rel = 'noopener noreferrer';
              }
            }
            el.append(h('span', '', c.label));
            if (c.value) el.append(h('span', 'font-normal text-white/50', c.value));
            li.append(el);
            return li;
          })
        : [h('li', 'text-sm text-white/40', 'Contact details are coming soon.')])
    );
  }

  // Session state
  let panelLoaded = false;
  async function loadPanel() {
    if (panelLoaded) return;
    const html = await fetch('/admin/panel.html').then((r) => (r.ok ? r.text() : Promise.reject()));
    $('admin-mount').innerHTML = html; // trusted: only served to the authorized admin
    await new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = '/admin/panel.js';
      s.onload = res;
      s.onerror = rej;
      document.body.append(s);
    });
    panelLoaded = true;
  }

  async function init() {
    const [db, me] = await Promise.all([
      fetch('/api/content').then((r) => r.json()),
      fetch('/api/me').then((r) => r.json()),
    ]);
    renderContent(db);

    if (me.user) {
      $('login-btn').classList.add('hidden');
      $('signout-btn').classList.remove('hidden');
    }
    if (me.isAdmin) {
      $('admin-btn').classList.remove('hidden');
      $('admin-btn').onclick = async () => {
        try {
          await loadPanel();
          window.openAdminPanel();
        } catch {
          alert('Could not open the admin panel. Sign in again and retry.');
        }
      };
    }
    $('signout-btn').onclick = async () => {
      await fetch('/auth/logout', { method: 'POST' });
      location.reload();
    };
  }

  window.addEventListener('content-changed', (e) => renderContent(e.detail));
  if (new URLSearchParams(location.search).get('login') === 'failed') {
    history.replaceState(null, '', '/');
    alert('Discord login failed. Try again.');
  }
  init();
})();
