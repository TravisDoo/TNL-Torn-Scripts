// ==UserScript==
// @name         Armory Notes
// @version      3.6.3
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

  // ---------- Runtime detection + cross-platform HTTP ----------

const PDA_HTTP = {
  GET:
    typeof PDA_httpGet === 'function' ? PDA_httpGet :
    typeof window.PDA_httpGet === 'function'
      ? window.PDA_httpGet.bind(window)
      : null,

  POST:
    typeof PDA_httpPost === 'function' ? PDA_httpPost :
    typeof window.PDA_httpPost === 'function'
      ? window.PDA_httpPost.bind(window)
      : null,

  PUT:
    typeof PDA_httpPut === 'function' ? PDA_httpPut :
    typeof window.PDA_httpPut === 'function'
      ? window.PDA_httpPut.bind(window)
      : null,

  DELETE:
    typeof PDA_httpDelete === 'function' ? PDA_httpDelete :
    typeof window.PDA_httpDelete === 'function'
      ? window.PDA_httpDelete.bind(window)
      : null,

  PATCH:
    typeof PDA_httpPatch === 'function' ? PDA_httpPatch :
    typeof window.PDA_httpPatch === 'function'
      ? window.PDA_httpPatch.bind(window)
      : null
};

const SCRIPT_HANDLER =
  (typeof GM_info !== 'undefined' && GM_info && GM_info.scriptHandler) ||
  (window.GM_info && window.GM_info.scriptHandler) ||
  '';

const IS_PDA =
  /GMforPDA|Torn PDA/i.test(SCRIPT_HANDLER) ||
  !!PDA_HTTP.GET ||
  typeof window.flutter_inappwebview?.callHandler === 'function';

const GM_REQUEST =
  typeof GM_xmlhttpRequest === 'function'
    ? GM_xmlhttpRequest
    : typeof window.GM_xmlhttpRequest === 'function'
      ? window.GM_xmlhttpRequest.bind(window)
      : null;

function normalizeHttpResponse(response, transport) {
  let responseText = '';

  if (typeof response?.responseText === 'string') {
    responseText = response.responseText;
  } else if (response?.responseText != null) {
    try {
      responseText = JSON.stringify(response.responseText);
    } catch {
      responseText = String(response.responseText);
    }
  } else if (typeof response?.body === 'string') {
    responseText = response.body;
  } else if (response?.body != null) {
    try {
      responseText = JSON.stringify(response.body);
    } catch {
      responseText = String(response.body);
    }
  }

  return {
    status: Number(response?.status || response?.statusCode || 0),
    statusText: String(response?.statusText || ''),
    responseText,
    responseHeaders: String(response?.responseHeaders || ''),
    transport
  };
}

function withTimeout(promise, timeoutMs, label) {
  let timer = null;

  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error(`${label} timed out after ${timeoutMs} ms`);
      error.code = 'TIMEOUT';
      reject(error);
    }, timeoutMs);
  });

  return Promise.race([Promise.resolve(promise), timeoutPromise])
    .finally(() => clearTimeout(timer));
}

// Torn PDA's native PDA_http* functions bypass GM_xmlhttpRequest's CORS
// handling and (in some PDA builds) don't reliably support custom headers
// or timeouts the way this script needs. GM_xmlhttpRequest already works
// fine inside PDA, so the native path below is built but intentionally
// switched off. Flip this to true (and retest on PDA) if you want to try
// native transport again — leaving PDA_HTTP undetected has zero effect
// either way since this flag gates it regardless.
const USE_PDA_NATIVE_TRANSPORT = false;

async function httpRequest({
  method = 'GET',
  url,
  headers = {},
  data,
  timeout = 10000
}) {
  const verb = String(method || 'GET').toUpperCase();

  const pdaFn = PDA_HTTP[verb];

  if (USE_PDA_NATIVE_TRANSPORT && IS_PDA && typeof pdaFn === 'function') {
    const transport = `Torn PDA native (${verb})`;

    try {
      const request =
        verb === 'GET' || verb === 'DELETE'
          ? pdaFn(url, headers)
          : pdaFn(url, headers, data ?? '');

      const response = await withTimeout(request, timeout, transport);
      return normalizeHttpResponse(response, transport);
    } catch (error) {
      error.transport = transport;
      throw error;
    }
  }

  if (typeof GM_REQUEST === 'function') {
    const transport = 'GM_xmlhttpRequest';

    return await new Promise((resolve, reject) => {
      GM_REQUEST({
        method: verb,
        url,
        headers,
        data,
        timeout,

        onload: (response) => {
          resolve(normalizeHttpResponse(response, transport));
        },

        onerror: (event) => {
          const error = new Error(
            event?.error ||
            event?.message ||
            'GM_xmlhttpRequest network error'
          );
          error.transport = transport;
          reject(error);
        },

        ontimeout: () => {
          const error = new Error(
            `GM_xmlhttpRequest timed out after ${timeout} ms`
          );
          error.code = 'TIMEOUT';
          error.transport = transport;
          reject(error);
        },

        onabort: () => {
          const error = new Error('GM_xmlhttpRequest was aborted');
          error.code = 'ABORTED';
          error.transport = transport;
          reject(error);
        }
      });
    });
  }

  const transport = 'browser fetch';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      method: verb,
      headers,
      body:
        verb === 'GET' || verb === 'HEAD'
          ? undefined
          : data,
      credentials: 'omit',
      signal: controller.signal
    });

    return {
      status: response.status,
      statusText: response.statusText,
      responseText: await response.text(),
      responseHeaders: '',
      transport
    };
  } catch (error) {
    if (error?.name === 'AbortError') {
      error = new Error(`fetch timed out after ${timeout} ms`);
      error.code = 'TIMEOUT';
    }

    error.transport = transport;
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

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

  function promptSetApiKey() {
    const entered = prompt(API_KEY_PROMPT_MSG, getTornApiKey());
    if (entered === null) return; // cancelled
    setTornApiKey(entered);
    alert(entered.trim()
      ? 'Torn API key saved. Reloading to apply…'
      : 'Torn API key cleared. Reloading to apply…');
    location.reload();
  }

  function openArmoryAccessSettings() {
    const userId = TORN_USER_ID ? `#${TORN_USER_ID}` : 'unknown';
    const userName = TORN_USER_NAME || 'unknown';
    const keyState = getTornApiKey() ? 'set' : 'not set';

    const serverState = ACCESS_SOURCE === 'error' ? 'unreachable' : 'reachable';

    const openKeyPrompt = confirm(
      'Armory Notes\n\n' +
      `User: ${userName} (${userId})\n` +
      `Role: ${USER_ROLE}\n` +
      `Write access: ${USER_CAN_WRITE ? 'yes' : 'no'}\n` +
      `Torn API key: ${keyState}\n` +
      `Server: ${serverState}\n\n` +
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
      try {
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
      } catch (e) {
        log('injectSettingsUtilityButton: skipped one header due to error', e);
      }
    }
  }

  let USER_ROLE = 'readonly';
  let USER_CAN_WRITE = false;

  let ACCESS_SOURCE = 'live';

  const ACCESS_CACHE_KEY = 'torn-notes-access-cache-v1';
  const ACCESS_CACHE_TTL_MS = 5 * 60 * 1000;

  async function fetchAccessRoleLive() {
  try {
    const response = await httpRequest({
      method: 'GET',
      url: `${SERVER_BASE}/api/access-check`,
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': API_KEY,
        'X-Torn-API-Key': TORN_API_KEY || '',
        'ngrok-skip-browser-warning': '1'
      },
      timeout: 10000
    });

    const data = response.responseText
      ? JSON.parse(response.responseText)
      : {};

    if (response.status >= 200 && response.status < 300) {
      return {
        ok: true,
        ...data
      };
    }

    console.error(
      '[TornNotes] Access check HTTP error',
      response.status,
      data
    );

    return { ok: false };
  } catch (error) {
    console.error(
      '[TornNotes] Access check network error',
      error?.transport || '',
      error
    );

    return { ok: false };
  }
}

  function readAccessCache() {
    try {
      const c = GM_getValue(ACCESS_CACHE_KEY, null);
      return (c && c.d) ? c : null;
    } catch (e) {
      log('access cache read error', e);
      return null;
    }
  }

  function writeAccessCache(d) {
    try { GM_setValue(ACCESS_CACHE_KEY, { d, t: Date.now() }); } catch (e) { log('access cache write error', e); }
  }

  async function getAccessRole() {
    const cached = readAccessCache();

    if (cached && (Date.now() - cached.t) < ACCESS_CACHE_TTL_MS) {
      ACCESS_SOURCE = 'cache';
      return cached.d;
    }

    const result = await fetchAccessRoleLive();

    if (result.ok) {
      ACCESS_SOURCE = 'live';
      const d = {
        role: result.role || 'readonly',
        canWrite: !!result.canWrite,
        userId: result.userId || null,
        name: result.name || null
      };
      writeAccessCache(d);
      return d;
    }

    ACCESS_SOURCE = 'error';
    if (cached) {
      console.warn('[TornNotes] Server unreachable — reusing last known access level from', new Date(cached.t).toLocaleString());
      return cached.d;
    }

    console.warn('[TornNotes] Server unreachable and no cached access level — defaulting to read-only.');
    return { role: 'readonly', canWrite: false, userId: null, name: null };
  }

  async function forceRefreshAccess() {
    try { GM_deleteValue(ACCESS_CACHE_KEY); } catch (e) { log('access cache clear error', e); }
    const before = { role: USER_ROLE, canWrite: USER_CAN_WRITE };
    const fresh = await getAccessRole();
    if (fresh.role !== before.role || !!fresh.canWrite !== before.canWrite) {
      alert('Armory Notes: access level changed. Reloading…');
      location.reload();
    } else {
      alert(`Armory Notes: access level unchanged (${fresh.role}).`);
    }
  }

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
  let response;

  try {
    response = await httpRequest({
      method,
      url: SERVER_BASE + path,
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': API_KEY,
        'X-Torn-API-Key': TORN_API_KEY || '',
        'ngrok-skip-browser-warning': '1'
      },
      data: body != null ? JSON.stringify(body) : undefined,
      timeout: 12000
    });
  } catch (error) {
    console.error(
      '[TornNotes] HTTP transport failed',
      {
        method,
        path,
        transport: error?.transport || 'unknown',
        message: error?.message || String(error)
      }
    );

    throw error;
  }

  let data;

  try {
    data = response.responseText
      ? JSON.parse(response.responseText)
      : {};
  } catch {
    const error = new Error(
      `Server returned non-JSON data (HTTP ${response.status || 0})`
    );

    error.status = response.status;
    error.transport = response.transport;
    error.rawResponse = response.responseText;
    throw error;
  }

  if (response.status >= 200 && response.status < 300) {
    return data;
  }

  const message =
    data?.error ||
    data?.message ||
    `Request failed with HTTP ${response.status || 0}`;

  const error = new Error(message);
  error.status = response.status;
  error.transport = response.transport;
  error.serverResponse = data;

  throw error;
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
      return true;
    } catch (e) {
      console.error('[TornNotes] PUT failed for', key, e);
      alert(`Torn Notes: failed to save note for key ${key}. See console for details.`);
      return false;
    }
  }

  async function delData(key) {
    const prev = getCached(key);
    setCached(key, {});
    try { applyDataToUI(key, {}); } catch (e) { log('applyDataToUI (delete) error for', key, e); }
    try {
      await req('DELETE', `/api/torn-notes/${TEAM_ID}/${encodeURIComponent(key)}`);
      return true;
    } catch (e) {
      log('DELETE failed for', key, e);
      setCached(key, prev);
      try { applyDataToUI(key, prev); } catch (e2) { log('applyDataToUI (restore) error for', key, e2); }
      alert(`Torn Notes: failed to delete note for key ${key}. See console for details.`);
      return false;
    }
  }

  async function handleClick(key, el, badge, label) {
    if (deletionMode) {
      if (confirm(`Delete the saved note for ${label}?`)) {
        log('Deletion mode: deleting', key);
        await delData(key);
      }
      return;
    }

    log('handleClick for key:', key, 'label:', label);

    const cur = await ensureFresh(key, { force: true });
    log('Current remote value for', key, cur);

    openNoteModal(label, cur, {
      onSave: async (d) => {
          log('Saving', key, d);

          const saved = await saveData(key, d);

          log('Save result for', key, saved);
          return saved;
      },
      onDelete: async () => {
          log('Deleting via modal', key);
          return await delData(key);
      }
    });
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
      const { li, badge, tooltipEl } = refs;
      if (!li.isConnected || !badge) { set.delete(refs); continue; }
      // The tooltip attribute lives on the name element (tooltipEl), not the
      // whole row (li). The row also contains Torn's own icons — like the
      // red/grey perk-slot circles — which have their own native tooltips;
      // putting data-note-tooltip on the full li makes our hover handler
      // (which uses closest()) win over those every time the mouse moves
      // anywhere in the row.
      const anchor = tooltipEl || li;
      if (d.note) {
        anchor.setAttribute('data-note-tooltip', d.note);
      } else {
        anchor.removeAttribute('data-note-tooltip');
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
    registerUI(key, { li, badge, tooltipEl: nameEl });

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
    .torn-note-btn:disabled{ opacity:0.4; cursor:default; }

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
    position: relative !important;
    z-index: 9999 !important;
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

/* Never allow the owner and edit controls to shrink, and keep them above
   Torn's neighboring columns / display-only elements */
.name-wrap {
    position: relative !important;
    z-index: 9998 !important;
    overflow: visible !important;
}

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

/* Give the paper icon a real clickable area, and keep it above the rest */
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

  // ---------- Note editor modal ----------

  // Replaces the old note/colour/owner prompt() chain with a single styled
  // form. Prompt chains are especially rough on mobile (three separate
  // native dialogs in a row) and don't match the Council manager's UI.
  const noteModalStyle = document.createElement('style');
  noteModalStyle.textContent = `
    .tnl-note-overlay{
      position:fixed; inset:0; z-index:1000000;
      background:rgba(0,0,0,0.55);
      display:flex; align-items:center; justify-content:center; padding:16px;
    }
    .tnl-note-panel{
      background:#1b1b1b; color:#f0f0f0;
      border:1px solid rgba(255,255,255,0.15); border-radius:10px;
      width:100%; max-width:420px; max-height:85vh; overflow:auto;
      padding:16px 18px; box-shadow:0 12px 40px rgba(0,0,0,0.5);
      font-size:13px; line-height:1.4;
    }
    .tnl-note-title{
      font-size:15px; font-weight:600; margin-bottom:12px;
      overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
    }
    .tnl-note-field{ margin-bottom:12px; }
    .tnl-note-label{ display:block; font-size:11px; opacity:0.7; margin-bottom:4px; }
    .tnl-note-input, .tnl-note-textarea{
      width:100%; box-sizing:border-box; background:#111; color:#f0f0f0;
      border:1px solid rgba(255,255,255,0.2); border-radius:6px;
      padding:7px 9px; font-size:13px; font-family:inherit;
    }
    .tnl-note-textarea{ resize:vertical; min-height:60px; }
    .tnl-note-colour-row{ display:flex; align-items:center; gap:8px; }
    .tnl-note-colour-row .tnl-note-input{ flex:1 1 auto; min-width:0; }
    .tnl-note-colour-row input[type="color"]{
      width:34px; height:30px; flex:0 0 auto; padding:0;
      border:1px solid rgba(255,255,255,0.2); border-radius:6px;
      background:#111; cursor:pointer;
    }
    .tnl-note-footer{ display:flex; align-items:center; justify-content:flex-end; gap:8px; margin-top:4px; }
    .tnl-note-status{ font-size:11px; opacity:0.7; margin-right:auto; }
    .tnl-note-btn{
      background:rgba(255,255,255,0.12); color:#f0f0f0; cursor:pointer;
      border:1px solid rgba(255,255,255,0.2); border-radius:6px;
      padding:6px 14px; font-size:12px;
    }
    .tnl-note-btn:hover{ background:rgba(255,255,255,0.2); }
    .tnl-note-btn:disabled{ opacity:0.5; cursor:default; }
    .tnl-note-btn-primary{ background:rgba(90,160,255,0.28); border-color:rgba(90,160,255,0.5); }
    .tnl-note-btn-primary:hover{ background:rgba(90,160,255,0.4); }
    .tnl-note-btn-danger{ background:rgba(220,70,70,0.18); border-color:rgba(220,70,70,0.4); }
    .tnl-note-btn-danger:hover{ background:rgba(220,70,70,0.32); }
  `;
  document.head.appendChild(noteModalStyle);

  let noteModalEl = null;

  function onNoteModalKeydown(e) {
    if (e.key === 'Escape') { e.stopPropagation(); closeNoteModal(); }
  }

  function closeNoteModal() {
    if (noteModalEl) { noteModalEl.remove(); noteModalEl = null; }
    document.removeEventListener('keydown', onNoteModalKeydown, true);
  }

  function openNoteModal(label, cur, { onSave, onDelete }) {
    closeNoteModal();

    const overlay = document.createElement('div');
    overlay.className = 'tnl-note-overlay';

    const panel = document.createElement('div');
    panel.className = 'tnl-note-panel';

    const title = document.createElement('div');
    title.className = 'tnl-note-title';
    title.textContent = `Edit note — ${label}`;
    panel.appendChild(title);

    const noteField = document.createElement('div');
    noteField.className = 'tnl-note-field';
    const noteLabel = document.createElement('label');
    noteLabel.className = 'tnl-note-label';
    noteLabel.textContent = 'Note';
    const noteInput = document.createElement('textarea');
    noteInput.className = 'tnl-note-textarea';
    noteInput.value = cur.note || '';
    noteField.append(noteLabel, noteInput);
    panel.appendChild(noteField);

    const colourField = document.createElement('div');
    colourField.className = 'tnl-note-field';
    const colourLabel = document.createElement('label');
    colourLabel.className = 'tnl-note-label';
    colourLabel.textContent = 'Colour tag';
    const colourRow = document.createElement('div');
    colourRow.className = 'tnl-note-colour-row';
    const colourPicker = document.createElement('input');
    colourPicker.type = 'color';
    const colourText = document.createElement('input');
    colourText.type = 'text';
    colourText.className = 'tnl-note-input';
    colourText.placeholder = 'CSS/hex, e.g. #ff8800 (blank = none)';
    colourText.value = cur.colour || '';
    const validHex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
    colourPicker.value = validHex.test(cur.colour || '') ? cur.colour : '#ffffff';
    colourPicker.addEventListener('input', () => { colourText.value = colourPicker.value; });
    colourRow.append(colourPicker, colourText);
    colourField.append(colourLabel, colourRow);
    panel.appendChild(colourField);

    const ownerField = document.createElement('div');
    ownerField.className = 'tnl-note-field';
    const ownerLabel = document.createElement('label');
    ownerLabel.className = 'tnl-note-label';
    ownerLabel.textContent = 'Owner';
    const ownerInput = document.createElement('input');
    ownerInput.type = 'text';
    ownerInput.className = 'tnl-note-input';
    ownerInput.value = cur.owner || '';
    ownerField.append(ownerLabel, ownerInput);
    panel.appendChild(ownerField);

    const footer = document.createElement('div');
    footer.className = 'tnl-note-footer';

    const status = document.createElement('span');
    status.className = 'tnl-note-status';

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'tnl-note-btn tnl-note-btn-danger';
    deleteBtn.textContent = 'Delete';

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'tnl-note-btn';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', closeNoteModal);

    const saveBtn = document.createElement('button');
    saveBtn.className = 'tnl-note-btn tnl-note-btn-primary';
    saveBtn.textContent = 'Save';

    let busy = false;
    function setBusy(isBusy, label) {
      busy = isBusy;
      saveBtn.disabled = isBusy;
      deleteBtn.disabled = isBusy;
      cancelBtn.disabled = isBusy;
      status.textContent = isBusy ? label : '';
    }

    deleteBtn.addEventListener('click', async () => {
      if (busy) return;
      if (!confirm(`Delete the saved note for ${label}?`)) return;
      setBusy(true, 'Deleting…');
      await onDelete();
      closeNoteModal();
    });

    saveBtn.addEventListener('click', async () => {
      if (busy) return;
      setBusy(true, 'Saving…');
      const d = {
        note: noteInput.value.trim(),
        colour: colourText.value.trim(),
        owner: ownerInput.value.trim()
      };
      const ok = await onSave(d);
      if (ok === false) {
        setBusy(false, '');
        return;
      }
      closeNoteModal();
    });

    footer.append(status, deleteBtn, cancelBtn, saveBtn);
    panel.appendChild(footer);

    overlay.appendChild(panel);
    overlay.addEventListener('click', (e) => { if (e.target === overlay && !busy) closeNoteModal(); });
    document.body.appendChild(overlay);
    noteModalEl = overlay;
    document.addEventListener('keydown', onNoteModalKeydown, true);
    noteInput.focus();
  }

  // ---------- Leadership: manage access lists ----------

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
      // req() now throws a real Error (message / serverResponse), not the
      // raw parsed JSON body, so the specific server reason is on
      // e.serverResponse.error or e.message — not e.error.
      const msg = e?.serverResponse?.error || e?.message || 'Request failed.';
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

    registerMenu('🔄 Refresh Access Level', () => {
      forceRefreshAccess().catch((e) => log('forceRefreshAccess error', e));
    });

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
      const serverState = {
        live: 'reachable (just checked)',
        cache: 'reachable (using recent cached result)',
        error: 'UNREACHABLE — showing last known/default access'
      }[ACCESS_SOURCE] || ACCESS_SOURCE;
      alert(
        'Armory Notes\n' +
        `User: ${name} (${id})\n` +
        `Role: ${USER_ROLE}\n` +
        `Write access: ${USER_CAN_WRITE ? 'yes' : 'no'}\n` +
        `Torn API key: ${keyState}\n` +
        `Server: ${serverState}`
      );
    });
  }

  // ---------- Bootstrap ----------

  await purgeLocalOnce();

  TORN_API_KEY = await ensureApiKey();
  log('Torn API key present:', !!TORN_API_KEY);

  const access = await getAccessRole();
  USER_ROLE = access.role || 'readonly';
  USER_CAN_WRITE = !!access.canWrite;
  TORN_USER_ID = access.userId || null;
  TORN_USER_NAME = access.name || null;
  log('Access role:', USER_ROLE, 'canWrite:', USER_CAN_WRITE, 'id:', TORN_USER_ID);

  registerMenus();

  injectSettingsUtilityButton();

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

      injectSettingsUtilityButton();

      if (supportsNotesUI) {
        for (const root of roots) initAll(root);
      }
    }, 150);
  });
  mo.observe(document.body, { childList: true, subtree: true });
})();
