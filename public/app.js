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

  // Background (same settings as the reference)
  ColorBends($('bg'), {
    colors: ['#ff5c7a', '#8a5cff', '#00ffd1'],
    rotation: 90,
    speed: 0.2,
    scale: 1,
    frequency: 1,
    warpStrength: 1,
    mouseInfluence: 1,
    noise: 0.15,
    parallax: 0.5,
    iterations: 1,
    intensity: 1.5,
    bandWidth: 6,
    transparent: true,
  });

  // ---------- Pages (hash routing, no scrolling) ----------
  const ROUTES = {
    '': 'home',
    '/': 'home',
    '/past-work': 'past-work',
    '/projects': 'projects',
    '/contact': 'contact',
    '/reviews': 'reviews',
    '/privacy': 'privacy',
    '/terms': 'terms',
  };
  const TITLES = { home: '', 'past-work': 'Past Work', projects: 'Projects', contact: 'Contact', reviews: 'Reviews', privacy: 'Privacy Policy', terms: 'Terms of Service' };
  let db = { profile: { name: 'brzy', tagline: '', avatar: '' }, pastwork: [], projects: [], contacts: [], clients: [], reviews: [] };
  let firstRoute = true;

  function route() {
    const name = ROUTES[location.hash.replace(/^#/, '')] || 'home';
    document.querySelectorAll('.view').forEach((v) => {
      const on = v.dataset.view === name;
      v.classList.toggle('active', on);
      if (on) v.removeAttribute('inert');
      else v.setAttribute('inert', '');
    });
    document.querySelectorAll('[data-route]').forEach((a) => {
      const on = a.dataset.route === name;
      if (a.classList.contains('nav-link')) {
        a.classList.toggle('bg-white/10', on);
        a.classList.toggle('text-white', on);
        a.classList.toggle('text-white/60', !on);
      }
      if (on) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
    $('veil-home').style.opacity = name === 'home' ? '1' : '0';
    $('veil-page').style.opacity = name === 'home' ? '0' : '1';
    document.title = (TITLES[name] ? TITLES[name] + ' · ' : '') + db.profile.name + "'s Portfolio";
    if (!firstRoute) {
      const heading = document.querySelector('.view.active [tabindex="-1"]');
      if (heading) heading.focus({ preventScroll: true });
    }
    firstRoute = false;
  }

  // ---------- Rendering ----------
  const HARDCODED_PROFILE_AVATAR = 'https://images-ext-1.discordapp.net/external/Ne99TtnIwQl9SFAfocaSUDKrjQxsDpFFDsnximoFNxg/%3Fsize%3D4096/https/cdn.discordapp.com/avatars/1366813770344829131/a8d97ba191094a3c8beac465ad2597ee.png?format=webp&quality=lossless';

  function avatar(el, profile) {
    el.replaceChildren();
    if (HARDCODED_PROFILE_AVATAR) {
      const img = h('img', 'h-full w-full object-cover');
      img.src = HARDCODED_PROFILE_AVATAR;
      img.alt = profile.name + ' profile picture';
      el.append(img);
    } else {
      el.textContent = (profile.name || 'b').charAt(0).toLowerCase();
    }
  }

  function card(item, kind) {
    const link = safeUrl(item.link);
    const root = h(link ? 'a' : 'article', 'group flex flex-col overflow-hidden rounded-3xl border border-white/10 bg-white/[0.04] backdrop-blur transition-colors hover:bg-white/[0.07]');
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
    if (item.description) body.append(h('p', 'line-clamp-3 text-sm leading-relaxed text-white/55', item.description));
    if (kind === 'projects' && item.tags && item.tags.length) {
      const tags = h('ul', 'mt-auto flex flex-wrap gap-1.5 pt-2');
      item.tags.forEach((t) => tags.append(h('li', 'font-compact rounded-full border border-white/10 px-2.5 py-0.5 text-xs text-white/60', t)));
      body.append(tags);
    }
    root.append(media, body);
    return root;
  }

  function empty(text) {
    return h('p', 'col-span-full rounded-3xl border border-dashed border-white/10 p-8 text-center text-sm text-white/40', text);
  }

  // Pages instead of scrolling: 3 cards on wide screens, 2 on medium, 1 on phones.
  const pageSize = () => (window.innerWidth >= 1024 ? 3 : window.innerWidth >= 640 ? 2 : 1);
  const pageIndex = { pastwork: 0, projects: 0 };

  function renderList(kind, gridId, pagerId, emptyText) {
    const items = db[kind];
    const size = pageSize();
    const pages = Math.max(1, Math.ceil(items.length / size));
    pageIndex[kind] = Math.min(pageIndex[kind], pages - 1);
    const i = pageIndex[kind];
    $(gridId).replaceChildren(...(items.length ? items.slice(i * size, i * size + size).map((it) => card(it, kind)) : [empty(emptyText)]));

    const pager = $(pagerId);
    pager.replaceChildren();
    if (pages < 2) return;
    const btn = (label, dir, disabled) => {
      const b = h('button', 'rounded-full border border-white/15 bg-black/40 px-4 py-2 font-compact text-sm font-semibold backdrop-blur transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-black/40', label);
      b.type = 'button';
      b.disabled = disabled;
      b.onclick = () => {
        pageIndex[kind] += dir;
        renderList(kind, gridId, pagerId, emptyText);
      };
      return b;
    };
    const status = h('span', 'font-compact min-w-16 text-center text-sm text-white/50', `${i + 1} of ${pages}`);
    status.setAttribute('aria-live', 'polite');
    pager.append(btn('Previous', -1, i === 0), status, btn('Next', 1, i === pages - 1));
  }

  function renderContent() {
    const p = db.profile;
    $('notch-name').textContent = p.name;
    $('hero-name').textContent = p.name + "'s";
    $('hero-tagline').textContent = p.tagline;
    avatar($('notch-avatar'), p);
    avatar($('hero-avatar'), p);

    renderList('pastwork', 'pastwork-grid', 'pastwork-pager', 'Past work is coming soon.');
    renderList('projects', 'projects-grid', 'projects-pager', 'Projects are coming soon.');

    // Client logo marquee: two rows move in opposite directions.
    const showcase = $('clients-showcase');
    const clients = db.clients || [];
    showcase.classList.toggle('hidden', !clients.length);
    const makeLogo = (client) => {
      const link = h(client.invite ? 'a' : 'div', 'client-logo');
      if (client.invite) {
        link.href = safeUrl(client.invite);
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.setAttribute('aria-label', client.name);
      }
      if (client.icon) {
        const img = h('img');
        img.src = client.icon;
        img.alt = client.name || 'Client community';
        img.loading = 'lazy';
        link.append(img);
      } else {
        link.append(h('span', 'text-center text-xs font-semibold text-white/70', client.name || 'Community'));
      }
      return link;
    };
    const fillMarqueeRow = (id, items, reverse) => {
      const host = $(id);
      host.replaceChildren();
      if (!items.length) return;
      const track = h('div', 'client-track' + (reverse ? ' reverse' : ''));
      const group = h('div', 'flex shrink-0 items-center gap-[4.5rem]');
      items.forEach((client) => group.append(makeLogo(client)));
      const duplicate = group.cloneNode(true);
      track.append(group, duplicate);
      host.append(track);
    };
    const rowOne = clients.filter((_, i) => i % 2 === 0);
    const rowTwo = clients.filter((_, i) => i % 2 === 1);
    fillMarqueeRow('clients-row-one', rowOne.length ? rowOne : clients, false);
    fillMarqueeRow('clients-row-two', rowTwo.length ? rowTwo : clients, true);

    // Reviews are managed through the admin panel.
    const reviewsGrid = $('reviews-grid');
    const reviews = db.reviews || [];
    reviewsGrid.replaceChildren(
      ...(reviews.length ? reviews.map((review) => {
        const article = h('article', 'rounded-3xl border border-white/10 bg-white/[0.04] p-6 backdrop-blur');
        const stars = h('p', 'mb-4 tracking-[0.2em] text-sm text-white/80', '★'.repeat(Math.max(1, Math.min(5, Number(review.rating) || 5))) + '☆'.repeat(5 - Math.max(1, Math.min(5, Number(review.rating) || 5))));
        const quote = h('blockquote', 'text-base leading-relaxed text-white/75', '“' + review.quote + '”');
        const byline = h('div', 'mt-6 flex items-center gap-3 border-t border-white/10 pt-4');
        const avatarUrl = safeUrl(review.avatar);
        if (avatarUrl) {
          const img = h('img', 'h-10 w-10 shrink-0 rounded-full border border-white/10 bg-white/5 object-cover');
          img.src = avatarUrl;
          img.alt = review.name + ' profile picture';
          img.loading = 'lazy';
          byline.append(img);
        }
        const identity = h('div', 'min-w-0');
        identity.append(h('p', 'truncate font-semibold text-white', review.name), h('p', 'mt-1 truncate text-xs text-white/45', review.role || 'Client'));
        byline.append(identity);
        article.append(stars, quote, byline);
        return article;
      }) : [empty('Client reviews will appear here soon.')])
    );

    $('contact-list').replaceChildren(
      ...(db.contacts.length
        ? db.contacts.map((c) => {
            const li = h('li');
            const link = safeUrl(c.url);
            const el = h(link ? 'a' : 'span', 'flex items-center gap-2 rounded-2xl border border-white/15 bg-black/40 px-5 py-3 font-compact text-sm font-semibold backdrop-blur transition-colors ' + (link ? 'hover:bg-white/10' : ''));
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
    route();
  }

  // ---------- Admin panel (only fetched for authorized admins) ----------
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
    const [content, me] = await Promise.all([
      fetch('/api/content').then((r) => (r.ok ? r.json() : null)).catch(() => null),
      fetch('/api/me').then((r) => r.json()).catch(() => ({ user: null, isAdmin: false })),
    ]);
    if (content) db = content;
    renderContent();

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

  window.addEventListener('hashchange', route);
  window.addEventListener('content-changed', (e) => {
    db = e.detail;
    renderContent();
  });
  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(renderContent, 150);
  });
  if (new URLSearchParams(location.search).get('login') === 'failed') {
    history.replaceState(null, '', '/');
    alert('Discord login failed. Try again.');
  }
  route();
  init();
})();
