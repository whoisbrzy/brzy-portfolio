// Loaded only for authorized admins via /admin/panel.js
(function () {
  const TABS = {
    pastwork: {
      label: 'Past Work',
      fields: [
        ['title', 'Title', 'text', true],
        ['description', 'Description', 'textarea'],
        ['image', 'Image URL', 'text'],
        ['link', 'Link', 'text'],
      ],
      line: (i) => [i.title, i.description],
    },
    projects: {
      label: 'Projects',
      fields: [
        ['title', 'Title', 'text', true],
        ['description', 'Description', 'textarea'],
        ['image', 'Image URL', 'text'],
        ['link', 'Link', 'text'],
        ['tags', 'Tags (comma separated)', 'text'],
      ],
      line: (i) => [i.title, (i.tags || []).join(', ')],
    },
    contacts: {
      label: 'Contacts',
      fields: [
        ['label', 'Label (e.g. Discord)', 'text', true],
        ['value', 'Shown text', 'text'],
        ['url', 'Link (https://, mailto:)', 'text'],
      ],
      line: (i) => [i.label, i.value],
    },
    clients: {
      label: 'Clients',
      fields: [['invite', 'Discord invite link or code', 'text', true]],
      line: (i) => [i.name, `${Number(i.members).toLocaleString()} members`],
    },
    reviews: {
      label: 'Reviews',
      fields: [
        ['name', 'Client name', 'text', true],
        ['avatar', 'Profile picture URL (optional)', 'text'],
        ['role', 'Role / community', 'text'],
        ['rating', 'Rating (1–5)', 'text', true],
        ['quote', 'Review', 'textarea', true],
      ],
      line: (i) => [i.name, `${i.rating} / 5 · ${i.role || "Review"}`],
    },
    website: { label: 'Website Controls', controls: true },
  };

  const tabsEl = document.getElementById('admin-tabs');
  const formEl = document.getElementById('admin-form');
  const listEl = document.getElementById('admin-list');
  const msgEl = document.getElementById('admin-msg');
  let current = 'pastwork';
  let editing = null;

  const input =
    'w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder-white/30 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white';

  function say(text, bad) {
    msgEl.textContent = text || '';
    msgEl.className = 'min-h-6 px-6 pb-4 text-sm ' + (bad ? 'text-red-400' : 'text-white/60');
  }

  async function api(method, path, body) {
    const r = await fetch(path, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || 'Something went wrong. Try again.');
    return data;
  }

  function renderTabs() {
    tabsEl.replaceChildren(
      ...Object.entries(TABS).map(([key, t]) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.role = 'tab';
        b.setAttribute('aria-selected', String(key === current));
        b.textContent = t.label;
        b.className =
          'rounded-full px-4 py-1.5 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-white ' +
          (key === current ? 'bg-white text-black' : 'text-white/60 hover:bg-white/10 hover:text-white');
        b.onclick = () => {
          current = key;
          editing = null;
          say('');
          render();
        };
        return b;
      })
    );
  }


  function controlButton(label, action, danger = false) {
    const b = document.createElement('button');
    b.type = 'button'; b.textContent = label;
    b.className = 'rounded-full border px-4 py-2 text-sm font-semibold ' + (danger ? 'border-red-500/30 text-red-300 hover:bg-red-500/10' : 'border-white/15 text-white/75 hover:bg-white/10');
    b.onclick = action; return b;
  }

  let siteSettings = {};
  function addControlField(label, name, value, textarea = false) {
    const wrap = document.createElement('label');
    wrap.className = 'flex flex-col gap-2 text-xs text-white/60';
    wrap.append(label);
    const el = document.createElement(textarea ? 'textarea' : 'input');
    if (textarea) el.rows = 3; else el.type = 'text';
    el.name = name; el.value = value || '';
    el.className = input; wrap.append(el); formEl.append(wrap); return el;
  }

  function renderControls() {
    const heading = document.createElement('h3');
    heading.className = 'text-sm font-semibold text-white'; heading.textContent = 'Maintenance mode'; formEl.append(heading);
    const help = document.createElement('p');
    help.className = 'text-xs leading-relaxed text-white/45';
    help.textContent = 'Temporarily replace the public website with a maintenance screen. Admins can still access the dashboard.';
    formEl.append(help);
    const maintenanceMessage = addControlField('Visitor message', 'maintenanceMessage', siteSettings.maintenanceMessage || 'We are performing scheduled maintenance. Please check back soon.', true);
    formEl.append(controlButton(siteSettings.maintenance ? 'Disable maintenance mode' : 'Enable maintenance mode', async () => {
      try {
        await api('POST', '/api/admin/settings', { action: 'maintenance', enabled: !siteSettings.maintenance, message: maintenanceMessage.value });
        say(siteSettings.maintenance ? 'Maintenance mode disabled.' : 'Maintenance mode enabled.');
        await load();
      } catch (e) { say(e.message, true); }
    }, !siteSettings.maintenance));
    const divider = document.createElement('div'); divider.className = 'my-4 border-t border-white/10'; formEl.append(divider);
    const announcement = document.createElement('h3'); announcement.className = 'text-sm font-semibold text-white'; announcement.textContent = 'Global announcement'; formEl.append(announcement);
    const message = addControlField('Message for all visitors', 'globalMessage', '', true);
    message.maxLength = 240;
    const style = document.createElement('select'); style.className = input;
    [['info','Information'],['success','Success'],['warning','Warning']].forEach(([v,l]) => { const o=document.createElement('option'); o.value=v; o.textContent=l; style.append(o); });
    const styleLabel = document.createElement('label'); styleLabel.className='flex flex-col gap-2 text-xs text-white/60'; styleLabel.append('Message style',style); formEl.append(styleLabel);
    formEl.append(controlButton('Publish global message', async () => {
      try { await api('POST','/api/admin/settings',{action:'global-message',message:message.value,type:style.value}); say('Global message published.'); await load(); }
      catch(e) { say(e.message,true); }
    }));
    const divider2 = document.createElement('div'); divider2.className='my-4 border-t border-white/10'; formEl.append(divider2);
    const refreshTitle = document.createElement('h3'); refreshTitle.className='text-sm font-semibold text-white'; refreshTitle.textContent='Global refresh'; formEl.append(refreshTitle);
    const refreshHelp = document.createElement('p'); refreshHelp.className='text-xs leading-relaxed text-white/45'; refreshHelp.textContent='Reloads every visitor’s open portfolio tab within about 10 seconds.'; formEl.append(refreshHelp);
    formEl.append(controlButton('Refresh site globally', async () => {
      if (!confirm('Reload the portfolio for all visitors?')) return;
      try { await api('POST','/api/admin/settings',{action:'refresh'}); say('Global refresh signal sent.'); await load(); }
      catch(e) { say(e.message,true); }
    }, true));
  }

  function renderForm() {
    const t = TABS[current];
    formEl.replaceChildren();
    if (t.controls) { renderControls(); return; }
    for (const [name, label, type, required] of t.fields) {
      const wrap = document.createElement('label');
      wrap.className = 'flex flex-col gap-1 text-xs text-white/60';
      wrap.append(label);
      const el = document.createElement(type === 'textarea' ? 'textarea' : 'input');
      if (type !== 'textarea') el.type = 'text';
      else el.rows = 3;
      el.name = name;
      el.required = !!required;
      el.className = input;
      if (editing) el.value = Array.isArray(editing[name]) ? editing[name].join(', ') : editing[name] ?? '';
      wrap.append(el);
      formEl.append(wrap);
    }
    const row = document.createElement('div');
    row.className = 'flex gap-2 pt-1';
    const save = document.createElement('button');
    save.type = 'submit';
    save.className =
      'rounded-full bg-white px-5 py-2 text-sm font-semibold text-black hover:bg-white/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white';
    save.textContent = current === 'clients' ? 'Add client' : editing ? 'Save changes' : 'Add ' + t.label.toLowerCase().replace(/s$/, '');
    row.append(save);
    if (editing) {
      const cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.textContent = 'Cancel';
      cancel.className = 'rounded-full border border-white/10 px-5 py-2 text-sm text-white/70 hover:bg-white/10';
      cancel.onclick = () => {
        editing = null;
        renderForm();
      };
      row.append(cancel);
    }
    formEl.append(row);
  }

  function renderList(items) {
    const t = TABS[current];
    if (current === 'website') {
      listEl.replaceChildren();
      const rows = [
        ['Maintenance mode', siteSettings.maintenance ? 'Enabled — visitors see the maintenance screen' : 'Disabled — website is public'],
        ['Global message', siteSettings.globalMessage?.text || 'No active announcement'],
        ['Last global refresh', siteSettings.refreshAt ? new Date(siteSettings.refreshAt).toLocaleString() : 'No refresh sent yet'],
      ];
      rows.forEach(([label,value]) => {
        const li=document.createElement('li'); li.className='rounded-2xl border border-white/10 bg-white/[0.03] p-4';
        const a=document.createElement('p'); a.className='text-xs uppercase tracking-wider text-white/40'; a.textContent=label;
        const b=document.createElement('p'); b.className='mt-2 break-words text-sm text-white/80'; b.textContent=value; li.append(a,b); listEl.append(li);
      });
      if (siteSettings.globalMessage) listEl.append(controlButton('Clear global message', async () => {
        try { await api('POST','/api/admin/settings',{action:'clear-message'}); say('Global message cleared.'); await load(); }
        catch(e) { say(e.message,true); }
      }, true));
      return;
    }
    if (!items.length) {
      const li = document.createElement('li');
      li.className = 'rounded-2xl border border-dashed border-white/10 p-4 text-sm text-white/40';
      li.textContent = current === 'clients' ? 'No clients yet. Paste a Discord invite to add one.' : 'Nothing here yet. Use the form to add the first one.';
      listEl.replaceChildren(li);
      return;
    }
    listEl.replaceChildren(
      ...items.map((item) => {
        const li = document.createElement('li');
        li.className = 'flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-3';
        if (current === 'clients' || (current === 'reviews' && item.avatar)) {
          const img = document.createElement('img');
          img.className = 'h-10 w-10 rounded-full bg-white/10 object-cover';
          img.alt = '';
          if (current === 'clients' && item.icon) img.src = item.icon;
          if (current === 'reviews' && item.avatar) img.src = item.avatar;
          li.append(img);
        }
        const text = document.createElement('div');
        text.className = 'min-w-0 flex-1';
        const [a, b] = t.line(item);
        const p1 = document.createElement('p');
        p1.className = 'truncate text-sm font-medium text-white';
        p1.textContent = a || '(untitled)';
        const p2 = document.createElement('p');
        p2.className = 'truncate text-xs text-white/50';
        p2.textContent = b || '';
        text.append(p1, p2);
        li.append(text);

        const mk = (label, fn, danger) => {
          const b = document.createElement('button');
          b.type = 'button';
          b.textContent = label;
          b.className =
            'rounded-full border px-3 py-1 text-xs focus-visible:outline focus-visible:outline-2 focus-visible:outline-white ' +
            (danger ? 'border-red-500/30 text-red-300 hover:bg-red-500/10' : 'border-white/10 text-white/70 hover:bg-white/10');
          b.onclick = fn;
          return b;
        };
        if (current === 'clients') {
          li.append(
            mk('Refresh', async () => {
              try {
                await api('POST', `/api/admin/clients/${item.id}/refresh`);
                say('Updated ' + item.name + '.');
                load();
              } catch (e) {
                say(e.message, true);
              }
            })
          );
        } else {
          li.append(
            mk('Edit', () => {
              editing = item;
              renderForm();
            })
          );
        }
        li.append(
          mk(
            'Delete',
            async () => {
              if (!confirm('Delete "' + (a || 'this item') + '"? This cannot be undone.')) return;
              try {
                await api('DELETE', `/api/admin/${current}/${item.id}`);
                say('Deleted.');
                load();
              } catch (e) {
                say(e.message, true);
              }
            },
            true
          )
        );
        return li;
      })
    );
  }

  async function load() {
    try {
    const response = await fetch('/api/content', { cache: 'no-store' });
    if (!response.ok) throw new Error('Could not load portfolio content.');
    const data = await response.json();
    siteSettings = data.settings || {};
    renderList(data[current] || []);
    if (current === 'website') renderForm();
    window.dispatchEvent(new CustomEvent('content-changed', { detail: data }));
    } catch (e) { say(e.message, true); }
  }

  function render() {
    renderTabs();
    renderForm();
    load();
  }

  formEl.addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(formEl));
    try {
      if (editing) {
        await api('PUT', `/api/admin/${current}/${editing.id}`, body);
        say('Saved.');
        editing = null;
      } else {
        await api('POST', `/api/admin/${current}`, body);
        say(current === 'clients' ? 'Client added.' : 'Added.');
      }
      renderForm();
      load();
    } catch (err) {
      say(err.message, true);
    }
  });

  document.getElementById('admin-close').onclick = () => { location.hash = '/'; };

  window.openAdminPanel = () => {
    if (location.hash !== '#/admin') location.hash = '/admin';
    render();
  };
})();
