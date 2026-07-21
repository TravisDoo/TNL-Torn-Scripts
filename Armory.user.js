// ==UserScript==
// @name         Armory Notes
// @version      3.4
// @description  Shared Torn notes. Edit access is authenticated via your public Torn API key; everyone else is read-only.
// @updateURL    https://raw.githubusercontent.com/TravisDoo/TNL-Torn-Scripts/main/Armory.user.js
// @downloadURL  https://raw.githubusercontent.com/TravisDoo/TNL-Torn-Scripts/main/Armory.user.js
// @match        https://www.torn.com/item.php*
// @match        https://www.torn.com/factions.php?step=your*
// @match        https://www.torn.com/trade.php*
// @match        https://www.torn.com/*
// @grant        GM_registerMenuCommand
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_listValues
// @grant        GM_deleteValue
// @connect      bunch-uphold-antennae.ngrok-free.dev
// @run-at       document-idle
// @author       DoobyDoo, MonChoon
// ==/UserScript==

// TESTING A NOTE
(async function () {
  'use strict';

  const SERVER_BASE = 'https://bunch-uphold-antennae.ngrok-free.dev/armory';
  const TEAM_ID = 'tnl-faction';
  const API_KEY = 'The-Next-Level';

  const DEBUG = false;
  const log = (...a) => DEBUG && console.log('[TornNotes]', ...a);

  const isMobile =
    /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
    window.innerWidth <= 768 ||
    'ontouchstart' in window;

  const BTN_CTX = new WeakMap();
  let deletionMode = false;

  const THEMES = ['Torn Dark', 'Torn Green'];
  let tooltipTheme = GM_getValue('torn-notes-tooltip-theme', THEMES[0]);

  const IS_PDA =
    /GMforPDA/i.test((window.GM_info && window.GM_info.scriptHandler) || '') ||
    typeof window.PDA_httpGet === 'function';

  const registerMenu =
    typeof GM_registerMenuCommand === 'function'
      ? GM_registerMenuCommand
      : (typeof window.GM_registerMenuCommand === 'function'
          ? window.GM_registerMenuCommand.bind(window)
          : () => {});

  const API_KEY_STORE    = 'torn-notes-torn-api-key';
  const API_KEY_PROMPTED = 'torn-notes-api-key-prompted-v1';

  function getTornApiKey() {
    return (GM_getValue(API_KEY_STORE, '') || '').trim();
  }
  function setTornApiKey(k) {
    GM_setValue(API_KEY_STORE, (k || '').trim());
  }

  // Populated during bootstrap from the server's /access-check response.
  let TORN_API_KEY   = '';
  let TORN_USER_ID   = null;
  let TORN_USER_NAME = null;

  const API_KEY_PROMPT_MSG =
    'Armory Notes\n\n' +
    'Enter your PUBLIC Torn API key to enable editing (adding/updating notes).\n' +
    'Create one in Torn: Settings → API Keys → make a key with "Public Only" access.\n\n' +
    'Leave this blank to stay in read-only mode. You can set it later from the\n' +
    'Tampermonkey menu → "🔑 Set / update Torn API key".';

  // Prompt for the key the first time only. Read-only members can dismiss the
  // prompt once and won't be nagged again; they can opt in later via the menu.
  async function ensureApiKey() {
    const existing = getTornApiKey();
    if (existing) return existing;
    if (GM_getValue(API_KEY_PROMPTED, false)) return '';

    GM_setValue(API_KEY_PROMPTED, true);
    const entered = prompt(API_KEY_PROMPT_MSG, '');
    if (entered && entered.trim()) {
      setTornApiKey(entered.trim());
      return entered.trim();
    }
    return '';
  }

  // Menu action — set/update/clear the key, then reload so the script
  // re-bootstraps and re-runs the access check with the new key.
  function promptSetApiKey() {
    const entered = prompt(API_KEY_PROMPT_MSG, getTornApiKey());
    if (entered === null) return; // cancelled
    setTornApiKey(entered);
    alert(entered.trim()
      ? 'Torn API key saved. Reloading to apply…'
      : 'Torn API key cleared. Reloading to apply…');
    location.reload();
  }

  // Torn PDA and some mobile userscript managers do not reliably expose
  // GM_registerMenuCommand. Instead of using a floating button, add an Armory
  // Notes entry to Torn PDA's Settings -> Utilities section.
  function openArmoryAccessSettings() {
    const userId = TORN_USER_ID ? `#${TORN_USER_ID}` : 'unknown';
    const userName = TORN_USER_NAME || 'unknown';
    const keyState = getTornApiKey() ? 'set' : 'not set';

    const openKeyPrompt = confirm(
      'Armory Notes\n\n' +
      `User: ${userName} (${userId})\n` +
      `Role: ${USER_ROLE}\n` +
      `Write access: ${USER_CAN_WRITE ? 'yes' : 'no'}\n` +
      `Torn API key: ${keyState}\n\n` +
      'Press OK to set or update your PUBLIC Torn API key.\n' +
      'Press Cancel to close this message.'
    );

    if (openKeyPrompt) promptSetApiKey();
  }

  function makeSettingsKeyIcon(templateSvg) {
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', templateSvg?.getAttribute('width') || '24');
    svg.setAttribute('height', templateSvg?.getAttribute('height') || '24');
    svg.setAttribute('aria-hidden', 'true');

    if (templateSvg?.getAttribute('class')) {
      svg.setAttribute('class', templateSvg.getAttribute('class'));
    }

    const group = document.createElementNS(NS, 'g');
    group.setAttribute('fill', 'currentColor');

    const path = document.createElementNS(NS, 'path');
    path.setAttribute(
      'd',
      'M7 9a5 5 0 1 0 4.58 7H16v-2h2v-2h2v-2h4V6H11.58A5 5 0 0 0 7 9Zm0 3a2 2 0 1 1 0 4 2 2 0 0 1 0-4Z'
    );

    group.appendChild(path);
    svg.appendChild(group);
    return svg;
  }

  function injectSettingsUtilityButton() {
    if (!isMobile && !IS_PDA) return;

    const headers = Array.from(document.querySelectorAll('span')).filter(
      (el) => (el.textContent || '').trim().toLowerCase() === 'utilities'
    );

    for (const header of headers) {
      const section = header.parentElement;
      if (!section) continue;

      let buttonContainer = Array.from(section.children).find(
        (child) => child !== header && child.querySelector?.('button')
      );

      if (!buttonContainer) {
        const sample = section.querySelector('button');
        buttonContainer = sample?.parentElement || null;
      }

      if (!buttonContainer) continue;
      if (buttonContainer.querySelector('[data-tnl-armory-settings-button="1"]')) continue;

      const sampleButton = buttonContainer.querySelector('button');
      if (!sampleButton) continue;

      const button = sampleButton.cloneNode(true);
      button.dataset.tnlArmorySettingsButton = '1';
      button.type = 'button';
      button.disabled = false;
      button.removeAttribute('disabled');
      button.removeAttribute('aria-disabled');
      button.setAttribute('aria-label', 'Armory Notes API Key');
      button.title = 'View access or set your Armory Notes Torn API key';

      const spans = Array.from(button.querySelectorAll('span'));
      const title = spans.find((span) => {
        const value = (span.textContent || '').trim().toLowerCase();
        return value === 'mark all as read' || value === 'close all private chats';
      }) || spans.at(-1);

      if (title) title.textContent = 'Armory Notes API Key';

      const oldSvg = button.querySelector('svg');
      if (oldSvg) oldSvg.replaceWith(makeSettingsKeyIcon(oldSvg));

      button.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        openArmoryAccessSettings();
      });

      buttonContainer.appendChild(button);
      log('Added Armory Notes to Settings -> Utilities');
    }
  }

  let USER_ROLE = 'readonly';
  let USER_CAN_WRITE = false;

  async function fetchAccessRole() {
    return new Promise((resolve) => {
      GM_xmlhttpRequest({
        method: 'GET',
        url: `${SERVER_BASE}/api/access-check`,
        headers: {
            'Content-Type': 'application/json',
            'X-API-Key': API_KEY,
            'X-Torn-API-Key': TORN_API_KEY || '',
            'ngrok-skip-browser-warning': '1'
        },
        timeout: 8000,
        onload: (r) => {
          try {
            const d = JSON.parse(r.responseText);
            resolve(d);
          } catch {
            resolve({ role: 'readonly', canWrite: false });
          }
        },
        onerror: () => resolve({ role: 'readonly', canWrite: false }),
        ontimeout: () => resolve({ role: 'readonly', canWrite: false })
      });
    });
  }

  // ---------- Theme ----------

  function cycleTheme() {
    const idx = THEMES.indexOf(tooltipTheme);
    tooltipTheme = THEMES[(idx + 1) % THEMES.length];
    GM_setValue('torn-notes-tooltip-theme', tooltipTheme);
    applyTooltipTheme();
    alert(`Tooltip theme set to: ${tooltipTheme}`);
  }

  // ---------- Helpers ----------

  function normalizeName(s) {
    return (s || '').toLowerCase().replace(/\s+/g, ' ').trim();
  }

  function findIdentifiers(el) {
    const root = el.closest ? (el.closest('li') || el) : el;
    const ds = root?.dataset || {};
    let aid = ds.armoryid || ds.armoury || ds.armouryid || null;
    let iid = ds.itemid || null;

    if ((!aid || !iid) && root && root.querySelector) {
      const found = root.querySelector(
        '[data-armoryid],[data-armoury],[data-armouryid],[data-itemid]'
      );
      if (found) {
        const ds2 = found.dataset || {};
        aid = aid || ds2.armoryid || ds2.armoury || ds2.armouryid || null;
        iid = iid || ds2.itemid || null;
      }
    }

    if (!aid && root.getAttribute) {
      const reactId = root.getAttribute('data-reactid');
      if (reactId) {
        const m = reactId.match(/\$(\d+)(?:\.[^.]+)?$/);
        if (m) aid = m[1];
      }
    }

    if (!aid && root.querySelector) {
      const checkbox = root.querySelector('input[type="checkbox"][id*="-"]');
      const idAttr = checkbox && checkbox.id;
      if (idAttr) {
        const m2 = idAttr.match(/-(\d+)$/);
        if (m2) aid = m2[1];
      }
    }

    if ((!aid || !iid) && root.querySelector) {
      const link = root.querySelector('a[href*="armoryID="], a[href*="itemID="]');
      if (link) {
        const href = link.getAttribute('href') || '';
        const mA = href.match(/armoryID=(\d+)/);
        const mI = href.match(/itemID=(\d+)/);
        if (mA && !aid) aid = mA[1];
        if (mI && !iid) iid = mI[1];
      }
    }

    return { aid, iid };
  }

  function keyFromIds(name, ids) {
    if (ids?.aid) return `armoryid:${ids.aid}`;
    if (ids?.iid) return `itemid:${ids.iid}`;
    return `name:${normalizeName(name)}`;
  }

  async function purgeLocalOnce() {
    const FLAG = 'torn-notes-purged-local-v1';
    if (GM_getValue(FLAG)) return;
    try {
      const keys = await GM_listValues();
      for (const k of keys) {
        if (k.startsWith('shared|')) GM_deleteValue(k);
      }
    } catch (e) {
      log('purgeLocalOnce error', e);
    }
    GM_setValue(FLAG, 1);
  }

  function cleanupLegacyColourSquares(root = document) {
    try {
      root.querySelectorAll('.tnl-controls .colour-box').forEach((el) => el.remove());
    } catch (e) {
      log('cleanupLegacyColourSquares error', e);
    }
  }

  // ---------- UI ----------

  function makeNoteButton() {
    const btn = document.createElement('button');
    btn.textContent = '📝';
    btn.className = 'torn-note-btn';
    btn.title = 'Add/edit note, color, owner';
    return btn;
  }

  function makeOwnerBadge(o) {
    const el = document.createElement('span');
    el.textContent = o || '';
    el.className = 'torn-owner-badge';
    if (!o) el.style.display = 'none';
    return el;
  }

  function applyBadgeColour(badge, colour) {
    if (!badge) return;
    const val = (colour || '').trim();
    if (val) {
      badge.dataset.colour = val;
      badge.style.borderColor = val;
      badge.style.boxShadow = `0 0 0 2px ${val}`;
    } else {
      delete badge.dataset.colour;
      badge.style.borderColor = '';
      badge.style.boxShadow = '';
    }
  }

  // ---------- Tooltip ----------

  const tooltip = document.createElement('div');
  document.body.appendChild(tooltip);
  tooltip.style.cssText = `
    position:fixed;
    max-width:${isMobile ? '90vw' : '360px'};
    padding:${isMobile ? '12px 16px' : '8px 10px'};
    border-radius:8px;
    font-size:${isMobile ? '14px' : '12px'};
    line-height:1.4;
    z-index:999999;
    opacity:0;
    transform:translate3d(0,2px,0) scale(0.98);
    transition:opacity .18s ease, transform .18s ease;
    white-space:pre-wrap; word-break:break-word;
  `;

  function applyTooltipTheme() {
    if (tooltipTheme === 'Torn Green') {
      tooltip.style.background = 'rgba(12,18,12,0.95)';
      tooltip.style.color = '#d6ffd6';
      tooltip.style.boxShadow = '0 6px 18px rgba(46,204,113,0.18)';
    } else {
      tooltip.style.background = 'rgba(16,16,16,0.92)';
      tooltip.style.color = '#f0f0f0';
      tooltip.style.boxShadow = '0 8px 24px rgba(0,0,0,0.35)';
    }
  }
  applyTooltipTheme();

  let tooltipTimeout = null;
  let raf = null;

  function showTooltip(el, x, y) {
    const txt = el.getAttribute('data-note-tooltip');
    if (!txt) return;
    tooltip.textContent = txt;
    tooltip.style.opacity = '1';
    tooltip.style.transform = 'translate3d(0,0,0) scale(1)';
    positionTooltip(x, y);
    if (isMobile) tooltipTimeout = setTimeout(hideTooltip, 2500);
  }

  function hideTooltip() {
    tooltip.style.opacity = '0';
    tooltip.style.transform = 'translate3d(0,2px,0) scale(0.98)';
    clearTimeout(tooltipTimeout);
  }

  function positionTooltip(x, y) {
    const pad = 16;
    const vw = innerWidth, vh = innerHeight;
    const rect = tooltip.getBoundingClientRect();
    let left = x + pad, top = y + pad;
    if (left + rect.width > vw - pad) left = vw - rect.width - pad;
    if (top + rect.height > vh - pad) top = vh - rect.height - pad;
    tooltip.style.left = left + 'px';
    tooltip.style.top = top + 'px';
  }

  if (isMobile) {
    document.body.addEventListener('touchstart', (e) => {
      const t = e.target.closest('[data-note-tooltip]');
      if (t) {
        const touch = e.touches[0];
        showTooltip(t, touch.clientX, touch.clientY);
      } else {
        hideTooltip();
      }
    });
  } else {
    document.body.addEventListener('mousemove', (e) => {
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const t = e.target.closest('[data-note-tooltip]');
        if (!t) return hideTooltip();
        showTooltip(t, e.clientX, e.clientY);
      });
    });
  }

  // ---------- Server ----------

  async function req(method, path, body) {
    return new Promise((res, rej) => {
      GM_xmlhttpRequest({
        method,
        url: SERVER_BASE + path,
        headers: {
            'Content-Type': 'application/json',
            'X-API-Key': API_KEY,
            'X-Torn-API-Key': TORN_API_KEY || '',
            'ngrok-skip-browser-warning': '1'
        },
        data: body != null ? JSON.stringify(body) : undefined,
        timeout: 10000,
        onload: (r) => {
          try {
            const d = r.responseText ? JSON.parse(r.responseText) : {};
            if (r.status >= 200 && r.status < 300) res(d);
            else rej(d);
          } catch (e) {
            rej(e);
          }
        },
        onerror: () => rej(new Error('network')),
        ontimeout: () => rej(new Error('timeout'))
      });
    });
  }

  // ---------- Caching (SWR-style) ----------

  const CACHE_KEY = 'torn-notes-cache-v1';
  const CACHE_TTL_MS = 30 * 1000;

  let CACHE = {};
  try {
    const raw = GM_getValue(CACHE_KEY);
    if (raw && typeof raw === 'object') CACHE = raw;
  } catch (e) {
    log('cache load error', e);
  }

  let persistTimer = null;
  function persistCacheSoon() {
    clearTimeout(persistTimer);
    persistTimer = setTimeout(() => {
      try { GM_setValue(CACHE_KEY, CACHE); } catch (e) { log('cache save error', e); }
    }, 250);
  }

  const inflight = new Map();

  function getCached(key) {
    const e = CACHE[key];
    return e ? e.d : {};
  }

  function isFresh(key) {
    const e = CACHE[key];
    if (!e) return false;
    return Date.now() - e.t < CACHE_TTL_MS;
  }

  function setCached(key, data) {
    CACHE[key] = { d: data || {}, t: Date.now() };
    persistCacheSoon();
    return CACHE[key].d;
  }

  async function fetchRemote(key) {
    if (inflight.has(key)) return inflight.get(key);
    const p = (async () => {
      try {
        const d = await req('GET', `/api/torn-notes/${TEAM_ID}/${encodeURIComponent(key)}`);
        return setCached(key, d || {});
      } catch (e) {
        log('fetchRemote error for', key, e);
        return getCached(key);
      } finally {
        inflight.delete(key);
      }
    })();
    inflight.set(key, p);
    return p;
  }

  async function ensureFresh(key, opts = {}) {
    const { force = false } = opts;
    if (!force && isFresh(key)) return getCached(key);
    return await fetchRemote(key);
  }

  async function loadData(key, opts = {}) {
    const { force = false } = opts;
    if (!force) return getCached(key);
    return await ensureFresh(key, { force: true });
  }

  async function saveData(key, data) {
    const d = setCached(key, data || {});
    try { applyDataToUI(key, d); } catch (e) { log('applyDataToUI error for', key, e); }
    try {
      log('PUT to server for', key);
      await req('PUT', `/api/torn-notes/${TEAM_ID}/${encodeURIComponent(key)}`, data);
      log('PUT success for', key);
    } catch (e) {
      console.error('[TornNotes] PUT failed for', key, e);
      alert(`Torn Notes: failed to save note for key ${key}. See console for details.`);
    }
  }

  async function delData(key) {
    setCached(key, {});
    try { applyDataToUI(key, {}); } catch (e) { log('applyDataToUI (delete) error for', key, e); }
    try {
      await req('DELETE', `/api/torn-notes/${TEAM_ID}/${encodeURIComponent(key)}`);
    } catch (e) {
      log('DELETE failed for', key, e);
    }
  }

  async function handleClick(key, el, badge, label) {
    if (deletionMode) {
      // Deletion mode repurposes the note button: clicking it removes the
      // saved note instead of opening the edit prompts.
      if (confirm(`Delete the saved note for ${label}?`)) {
        log('Deletion mode: deleting', key);
        await delData(key);
      }
      return;
    }

    log('handleClick for key:', key, 'label:', label);

    const cur = await ensureFresh(key, { force: true });
    log('Current remote value for', key, cur);

    const note = prompt(`Note for ${label}:`, cur.note || '');
    if (note === null) return;
    const colour = prompt('Colour tag (CSS/hex):', cur.colour || '');
    if (colour === null) return;
    const owner = prompt('Owner (name):', cur.owner || '');
    if (owner === null) return;

    const d = {
      note: note.trim(),
      colour: colour.trim(),
      owner: owner.trim()
    };
    log('Saving', key, d);
    await saveData(key, d);
    log('Saved', key);
  }

  // ---------- UI index + refresh ----------

  const UI_INDEX = new Map();

  function registerUI(key, refs) {
    let set = UI_INDEX.get(key);
    if (!set) { set = new Set(); UI_INDEX.set(key, set); }
    set.add(refs);
  }

  function applyDataToUI(key, d) {
    const set = UI_INDEX.get(key);
    if (!set) return;
    for (const refs of Array.from(set)) {
      const { li, badge } = refs;
      if (!li.isConnected || !badge) { set.delete(refs); continue; }
      if (d.note) {
        li.setAttribute('data-note-tooltip', d.note);
      } else {
        li.removeAttribute('data-note-tooltip');
      }
      const colourVal = (d.colour || '').trim();
      applyBadgeColour(badge, colourVal);
      const hasOwner = !!d.owner;
      const txt = hasOwner ? d.owner : '';
      if (badge.textContent !== txt) badge.textContent = txt;
      const show = hasOwner || !!colourVal;
      const want = show ? 'inline-block' : 'none';
      if (badge.style.display !== want) badge.style.display = want;
    }
  }

  const STALE_KEYS = new Set();
  let refreshTimer = null;
  const CONCURRENCY = 8;

  function scheduleRefresh() {
    if (refreshTimer) return;
    refreshTimer = setTimeout(() => {
      refreshTimer = null;
      refreshPass().catch((e) => log('refreshPass error', e));
    }, 60);
  }

  async function limitParallel(n, arr, worker) {
    let i = 0;
    const workers = new Array(Math.min(n, arr.length)).fill(0).map(async () => {
      while (true) {
        const idx = i++;
        if (idx >= arr.length) break;
        const item = arr[idx];
        try { await worker(item, idx); } catch (e) { log('limitParallel worker error', e); }
      }
    });
    await Promise.all(workers);
  }

  async function refreshKeys(keys) {
    const uniq = Array.from(new Set(keys));
    if (!uniq.length) return;
    await limitParallel(CONCURRENCY, uniq, async (k) => {
      const d = await fetchRemote(k);
      applyDataToUI(k, d);
    });
  }

  async function refreshPass() {
    const keys = Array.from(STALE_KEYS);
    STALE_KEYS.clear();
    if (!keys.length) return;
    await refreshKeys(keys);
  }

  // ---------- DOM processing ----------

  function processOne(li, labelFn, opts = {}) {
    const { requireArmoryId = false } = opts;
    if (!li || li.classList.contains('tnl-enhanced')) return;
    if (li.matches?.('[data-action], [data-role="action"]')) return;
    if (li.closest?.('.actions, .actions-wrap, .item-action, .action-wrap')) return;

    const ids = findIdentifiers(li);

    if (location.pathname === '/trade.php' && !ids.aid && !ids.iid) {
      log('Skipping trade row without IDs', li);
      return;
    }

    if (requireArmoryId && !ids.aid && !ids.iid) return;

    const nameEl =
      li.querySelector('[class*="item-name"]') ||
      li.querySelector('.name') ||
      li.querySelector('[data-test*="item-name"]') ||
      li.querySelector('.t-overflow, .desc___VJSNQ span b') ||
      li.querySelector('b, strong, span');
    if (!nameEl) return;

    let name = '';
    if (nameEl.childNodes && nameEl.childNodes.length) {
      for (const node of nameEl.childNodes) {
        if (node.nodeType === 3) {
          const t = node.textContent.trim();
          if (t) { name = t; break; }
        }
      }
    }

    if (!name) {
      let raw = nameEl.textContent || '';
      const extras = nameEl.querySelectorAll('.tt-item-value, .bonus-tooltip, .networth-info-icon');
      extras.forEach(el => { raw = raw.replace(el.textContent || '', ''); });
      raw = raw.replace(/\$[\d,]+/g, '');
      name = raw.trim();
    }

    if (!name) return;

    const key = keyFromIds(name, ids);

    let controls = null;
    for (let i = 0; i < nameEl.children.length; i++) {
      const c = nameEl.children[i];
      if (c.classList && c.classList.contains('tnl-controls')) { controls = c; break; }
    }

    let btn = controls?.querySelector?.('.torn-note-btn') || null;
    let badge = controls?.querySelector?.('.torn-owner-badge') || null;

    if (!controls) controls = document.createElement('span');
    controls.className = 'tnl-controls';

    if (!badge) badge = makeOwnerBadge('');

    // Only create the edit button for users with write access.
    // We wait until the access check resolves (USER_CAN_WRITE is set during
    // bootstrap) so the button either appears or is omitted — never shown
    // then hidden — which avoids flicker for read-only users.
    if (!btn && USER_CAN_WRITE) btn = makeNoteButton();

    controls.textContent = '';
    if (USER_CAN_WRITE && btn) {
      controls.append(badge, btn);
    } else {
      controls.append(badge);
    }

    let textWrap = null;
    for (let i = 0; i < nameEl.children.length; i++) {
      const c = nameEl.children[i];
      if (c.classList && c.classList.contains('tnl-name-text')) { textWrap = c; break; }
    }
    if (!textWrap) {
      textWrap = document.createElement('span');
      textWrap.className = 'tnl-name-text';
      while (nameEl.firstChild) textWrap.appendChild(nameEl.firstChild);
      nameEl.appendChild(textWrap);
    }

    const tag = (nameEl.tagName || '').toUpperCase();
    const inlineLikely =
      tag === 'SPAN' || tag === 'B' || tag === 'STRONG' ||
      tag === 'I' || tag === 'EM' || tag === 'A' ||
      tag === 'SMALL' || tag === 'LABEL';

    nameEl.classList.add('tnl-name');
    nameEl.classList.add(inlineLikely ? 'tnl-inline' : 'tnl-block');
    nameEl.appendChild(controls);

    if (USER_CAN_WRITE && btn) {
      BTN_CTX.set(btn, { key, el: li, badge, label: labelFn(name) });
    }
    li.classList.add('tnl-enhanced');
    registerUI(key, { li, badge });

    applyDataToUI(key, getCached(key));
    if (!isFresh(key)) {
      STALE_KEYS.add(key);
      scheduleRefresh();
    }
  }

  function processInRoot(root, selector, labelFn, opts = {}) {
    if (!root || !root.querySelectorAll) return;
    if (root.matches && root.matches(selector)) processOne(root, labelFn, opts);
    const nodes = root.querySelectorAll(selector);
    for (let i = 0; i < nodes.length; i++) processOne(nodes[i], labelFn, opts);
  }

  function initAll(root = document) {
    cleanupLegacyColourSquares(root);

    processInRoot(
      root,
      'li[data-item]',
      (n) => `"${n}" (Inventory)`,
      { requireArmoryId: true }
    );

    processInRoot(
      root,
      'ul.item-list > li, ul[class*="items-list"] > li[class*="item"]',
      (n) => `"${n}" (Armory)`,
      { requireArmoryId: true }
    );

    processInRoot(
      root,
      'li.clearfix[data-group="child"], .item___jLJcf',
      (n) => `"${n}" (Trade add)`
    );

    if (location.pathname === '/trade.php') {
      processInRoot(
        root,
        '.trade-cont .user.left ul.desc > li, li.clearfix[data-reactid]',
        (n) => `"${n}" (Trade left)`,
        { requireArmoryId: true }
      );
    }
  }

  // ---------- Styles ----------

  const style = document.createElement('style');
  style.textContent = `
    .tnl-name{
      position:relative;
      overflow:visible;
      max-width:100%;
    }
    .tnl-name.tnl-inline{ display:inline-flex; }
    .tnl-name.tnl-block{ display:flex; }
    .tnl-name .tnl-name-text{
      display:block;
      overflow:hidden;
      text-overflow:ellipsis;
      white-space:nowrap;
      flex:1 1 auto;
      min-width:0;
    }
    .torn-note-btn{
      background:none; border:none; padding:0; margin:0 2px; cursor:pointer;
      font-size:12px !important; opacity:0.8; line-height:1;
      position:relative; z-index:1001; pointer-events:auto !important;
    }
    .torn-note-btn:hover{ opacity:1; }

    .tnl-controls{
      display:inline-flex;
      align-items:center;
      gap:4px;
      z-index:1000;
      pointer-events:auto;
      margin-left:6px;
      flex:0 0 auto;
    }
    .tnl-controls .colour-box{ display:none !important; }

    .tnl-controls .torn-owner-badge{
      display:inline-block; padding:0 5px; font-size:10px; line-height:1;
      border-radius:6px; background:rgba(255,255,255,0.1);
      white-space:nowrap; max-width:80px; overflow:hidden; text-overflow:ellipsis;
      vertical-align:middle;
      border:1px solid rgba(255,255,255,0.25);
      box-shadow:none;
      transition:box-shadow 0.2s ease, border-color 0.2s ease;
    }

/* Compatibility with RW Bonus Convenient Name */
.name-wrap > .name.tnl-name {
    display: inline-flex !important;
    align-items: center !important;
    width: auto !important;
    min-width: 0 !important;
    max-width: 100% !important;
    box-sizing: border-box !important;
    overflow: visible !important;
    white-space: nowrap !important;
    vertical-align: middle !important;
}

/* Weapon name and RW bonus share the remaining space */
.name-wrap > .name.tnl-name > .tnl-name-text {
    display: flex !important;
    align-items: center !important;
    flex: 1 1 auto !important;
    min-width: 0 !important;
    max-width: none !important;
    overflow: hidden !important;
    white-space: nowrap !important;
}

/* Allow the RW bonus badge to be clipped when space runs out */
.name-wrap > .name.tnl-name .custom-bonus-badge {
    flex: 0 1 auto !important;
    min-width: 0 !important;
    max-width: 130px !important;
    overflow: hidden !important;
    text-overflow: ellipsis !important;
    white-space: nowrap !important;
    pointer-events: none !important;
}

/* Never allow the owner and edit controls to shrink */
.name-wrap > .name.tnl-name > .tnl-controls {
    display: inline-flex !important;
    align-items: center !important;
    flex: 0 0 auto !important;
    margin-left: 6px !important;
    padding-left: 0 !important;
    position: relative !important;
    z-index: 10000 !important;
    pointer-events: auto !important;
}

/* Keep the edit button above all display-only elements */
.name-wrap > .name.tnl-name .torn-note-btn {
    display: inline-block !important;
    flex: 0 0 auto !important;
    position: relative !important;
    z-index: 10001 !important;
    pointer-events: auto !important;
}

/* Keep Armory Notes controls above Torn's neighboring columns */
.name-wrap {
    position: relative !important;
    z-index: 9998 !important;
    overflow: visible !important;
}

.name-wrap > .name.tnl-name {
    position: relative !important;
    z-index: 9999 !important;
    overflow: visible !important;
}

.name-wrap > .name.tnl-name > .tnl-controls {
    position: relative !important;
    z-index: 10000 !important;
    pointer-events: auto !important;
}

/* Give the paper icon a real clickable area */
.name-wrap > .name.tnl-name .torn-note-btn {
    display: inline-flex !important;
    align-items: center !important;
    justify-content: center !important;

    width: 18px !important;
    height: 18px !important;
    padding: 0 !important;
    margin: 0 2px !important;

    position: relative !important;
    z-index: 10001 !important;
    pointer-events: auto !important;
    cursor: pointer !important;
}
  `;
  document.head.appendChild(style);

  // ---------- Leadership: manage access lists ----------

  // A modal that lets Leadership view the Leadership/Council rosters and
  // add/remove members by Torn ID. Every change goes through the server, which
  // rewrites config.js, so edits apply for everyone on their next request.
  const councilStyle = document.createElement('style');
  councilStyle.textContent = `
    .tnl-council-overlay{
      position:fixed; inset:0; z-index:1000000;
      background:rgba(0,0,0,0.55);
      display:flex; align-items:center; justify-content:center; padding:16px;
    }
    .tnl-council-panel{
      background:#1b1b1b; color:#f0f0f0;
      border:1px solid rgba(255,255,255,0.15); border-radius:10px;
      width:100%; max-width:460px; max-height:85vh; overflow:auto;
      padding:16px 18px; box-shadow:0 12px 40px rgba(0,0,0,0.5);
      font-size:13px; line-height:1.4;
    }
    .tnl-council-title{ font-size:16px; font-weight:600; margin-bottom:2px; }
    .tnl-council-sub{ font-size:11px; opacity:0.7; margin-bottom:12px; }
    .tnl-council-section{ margin-bottom:14px; }
    .tnl-council-section-title{
      font-weight:600; margin-bottom:6px;
      border-bottom:1px solid rgba(255,255,255,0.12); padding-bottom:4px;
    }
    .tnl-council-list{ display:flex; flex-direction:column; gap:4px; margin-bottom:8px; }
    .tnl-council-empty{ opacity:0.5; font-style:italic; padding:2px 0; }
    .tnl-council-row{
      display:flex; align-items:center; justify-content:space-between;
      gap:8px; padding:3px 0;
    }
    .tnl-council-name{ overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .tnl-council-add{ display:flex; gap:6px; margin-top:4px; }
    .tnl-council-input{
      flex:1 1 auto; min-width:0; background:#111; color:#f0f0f0;
      border:1px solid rgba(255,255,255,0.2); border-radius:6px;
      padding:5px 8px; font-size:12px;
    }
    .tnl-council-btn{
      background:rgba(255,255,255,0.12); color:#f0f0f0; cursor:pointer;
      border:1px solid rgba(255,255,255,0.2); border-radius:6px;
      padding:5px 10px; font-size:12px; white-space:nowrap;
    }
    .tnl-council-btn:hover{ background:rgba(255,255,255,0.2); }
    .tnl-council-remove{ background:rgba(220,70,70,0.18); border-color:rgba(220,70,70,0.4); }
    .tnl-council-remove:hover{ background:rgba(220,70,70,0.32); }
    .tnl-council-footer{ display:flex; justify-content:flex-end; margin-top:8px; }
  `;
  document.head.appendChild(councilStyle);

  let councilModalEl = null;

  function onCouncilKeydown(e) {
    if (e.key === 'Escape') { e.stopPropagation(); closeCouncilModal(); }
  }

  function closeCouncilModal() {
    if (councilModalEl) { councilModalEl.remove(); councilModalEl = null; }
    document.removeEventListener('keydown', onCouncilKeydown, true);
  }

  async function openCouncilManager() {
    let lists;
    try {
      lists = await req('GET', '/api/council');
    } catch (e) {
      alert(
        'Could not load the access lists.\n' +
        'This requires Leadership access and a valid Torn API key.'
      );
      return;
    }
    renderCouncilModal(lists);
  }

  async function refreshCouncilModal() {
    try {
      const lists = await req('GET', '/api/council');
      renderCouncilModal(lists);
    } catch (e) {
      log('refreshCouncilModal error', e);
    }
  }

  // listName: 'council' | 'leadership' ; action: 'add' | 'remove'
  async function councilAction(listName, action, rawId) {
    const id = parseInt(String(rawId).replace(/\D/g, ''), 10);
    if (!id) { alert('Enter a valid numeric Torn ID.'); return; }
    try {
      await req('POST', `/api/${listName}/${action}`, { userId: id });
      await refreshCouncilModal();
    } catch (e) {
      const msg = (e && e.error) ? e.error : 'Request failed.';
      alert(`Could not ${action} ${id}: ${msg}`);
    }
  }

  function buildListSection(title, listName, members) {
    const wrap = document.createElement('div');
    wrap.className = 'tnl-council-section';

    const h = document.createElement('div');
    h.className = 'tnl-council-section-title';
    h.textContent = `${title} (${members.length})`;
    wrap.appendChild(h);

    const list = document.createElement('div');
    list.className = 'tnl-council-list';
    if (!members.length) {
      const empty = document.createElement('div');
      empty.className = 'tnl-council-empty';
      empty.textContent = '— none —';
      list.appendChild(empty);
    }
    for (const m of members) {
      const name = (m.name && m.name.trim()) ? m.name.trim() : '(pending)';
      const row = document.createElement('div');
      row.className = 'tnl-council-row';

      const label = document.createElement('span');
      label.className = 'tnl-council-name';
      label.textContent =
        `${name} — ${m.id}` + (m.id === TORN_USER_ID ? '  (you)' : '');
      row.appendChild(label);

      const rm = document.createElement('button');
      rm.className = 'tnl-council-btn tnl-council-remove';
      rm.textContent = 'Remove';
      rm.addEventListener('click', () => {
        if (confirm(`Remove ${name} (${m.id}) from ${title}?`)) {
          councilAction(listName, 'remove', m.id);
        }
      });
      row.appendChild(rm);

      list.appendChild(row);
    }
    wrap.appendChild(list);

    const addRow = document.createElement('div');
    addRow.className = 'tnl-council-add';
    const input = document.createElement('input');
    input.type = 'text';
    input.inputMode = 'numeric';
    input.placeholder = `Torn ID to add to ${title}`;
    input.className = 'tnl-council-input';
    const addBtn = document.createElement('button');
    addBtn.className = 'tnl-council-btn';
    addBtn.textContent = 'Add';
    const submit = () => {
      const v = input.value.trim();
      if (v) councilAction(listName, 'add', v);
    };
    addBtn.addEventListener('click', submit);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); submit(); }
    });
    addRow.appendChild(input);
    addRow.appendChild(addBtn);
    wrap.appendChild(addRow);

    return wrap;
  }

  function renderCouncilModal(lists) {
    closeCouncilModal();

    const overlay = document.createElement('div');
    overlay.className = 'tnl-council-overlay';
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeCouncilModal();
    });

    const panel = document.createElement('div');
    panel.className = 'tnl-council-panel';

    const title = document.createElement('div');
    title.className = 'tnl-council-title';
    title.textContent = 'Manage Access';
    panel.appendChild(title);

    const sub = document.createElement('div');
    sub.className = 'tnl-council-sub';
    sub.textContent =
      'Changes apply for everyone. Names fill in after a member next loads the script.';
    panel.appendChild(sub);

    panel.appendChild(buildListSection('Leadership', 'leadership', lists.leadership || []));
    panel.appendChild(buildListSection('Council', 'council', lists.council || []));

    const footer = document.createElement('div');
    footer.className = 'tnl-council-footer';
    const closeBtn = document.createElement('button');
    closeBtn.className = 'tnl-council-btn';
    closeBtn.textContent = 'Close';
    closeBtn.addEventListener('click', closeCouncilModal);
    footer.appendChild(closeBtn);
    panel.appendChild(footer);

    overlay.appendChild(panel);
    document.body.appendChild(overlay);
    councilModalEl = overlay;
    document.addEventListener('keydown', onCouncilKeydown, true);
  }

  // ---------- Events & menus ----------

  document.addEventListener(
    'click',
    (e) => {
      const btn = e.target.closest('.torn-note-btn');
      if (!btn) return;
      e.preventDefault();
      e.stopPropagation();
      if (!USER_CAN_WRITE) return; // belt-and-suspenders guard
      const ctx = BTN_CTX.get(btn);
      if (!ctx) return console.warn('[TornNotes] No context for button');
      handleClick(ctx.key, ctx.el, ctx.badge, ctx.label);
    },
    true
  );

  // Registered during bootstrap, once we know whether the user can write.
  function registerMenus() {
    registerMenu(`🎨 Theme: ${tooltipTheme}`, cycleTheme);

    registerMenu('🔑 Set / update Torn API key', promptSetApiKey);

    if (USER_ROLE === 'leadership') {
      registerMenu('👑 Manage Leadership / Council', openCouncilManager);
    }

    if (USER_CAN_WRITE) {
      registerMenu('🧨 Toggle Deletion Mode', () => {
        deletionMode = !deletionMode;
        alert(deletionMode
          ? 'Deletion mode ON — click a note button (📝) to DELETE that note instead of editing it.'
          : 'Deletion mode OFF — note buttons edit as normal.');
      });
    }

    registerMenu('🧹 Clear Notes Cache', () => {
      CACHE = {};
      try { GM_setValue(CACHE_KEY, {}); } catch (e) { log('clear cache error', e); }
      alert('Torn Notes cache cleared');
    });

    registerMenu('ℹ️ My Access Level', () => {
      const id = TORN_USER_ID ? `#${TORN_USER_ID}` : 'unknown';
      const name = TORN_USER_NAME || 'unknown';
      const keyState = getTornApiKey() ? 'set' : 'not set';
      alert(
        'Armory Notes\n' +
        `User: ${name} (${id})\n` +
        `Role: ${USER_ROLE}\n` +
        `Write access: ${USER_CAN_WRITE ? 'yes' : 'no'}\n` +
        `Torn API key: ${keyState}`
      );
    });
  }

  // ---------- Bootstrap ----------

  await purgeLocalOnce();

  // Step 1 — make sure we have the user's Torn API key (prompt once on first run)
  TORN_API_KEY = await ensureApiKey();
  log('Torn API key present:', !!TORN_API_KEY);

  // Step 2 — the server resolves our identity from the key and tells us our role.
  // If the key is missing/invalid the server falls back to read-only access.
  const access = await fetchAccessRole();
  USER_ROLE = access.role || 'readonly';
  USER_CAN_WRITE = !!access.canWrite;
  TORN_USER_ID = access.userId || null;
  TORN_USER_NAME = access.name || null;
  log('Access role:', USER_ROLE, 'canWrite:', USER_CAN_WRITE, 'id:', TORN_USER_ID);

  // Step 3 — register menus now that we know whether the user can write
  registerMenus();

  // Torn PDA/mobile fallback inside Settings -> Utilities.
  injectSettingsUtilityButton();

  // Step 4 — now that we know the role, paint the notes UI on supported pages.
  const supportsNotesUI =
    location.pathname === '/item.php' ||
    location.pathname === '/factions.php' ||
    location.pathname === '/trade.php';

  if (supportsNotesUI) initAll();

  let moScheduled = false;
  const pendingRoots = new Set();
  const mo = new MutationObserver((records) => {
    for (const r of records) {
      for (const n of r.addedNodes) {
        if (n && n.nodeType === 1) pendingRoots.add(n);
      }
    }
    if (moScheduled) return;
    moScheduled = true;
    setTimeout(() => {
      moScheduled = false;
      if (pendingRoots.size === 0) return;
      const roots = Array.from(pendingRoots);
      pendingRoots.clear();

      // Settings is rendered dynamically by Torn PDA. Re-check the document
      // whenever the panel or one of its tabs is mounted.
      injectSettingsUtilityButton();

      if (supportsNotesUI) {
        for (const root of roots) initAll(root);
      }
    }, 150);
  });
  mo.observe(document.body, { childList: true, subtree: true });
})();
