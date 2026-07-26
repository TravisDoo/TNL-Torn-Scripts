// ==UserScript==
// @name         TNL Merc Request
// @namespace    https://www.torn.com/
// @version      1.1.1
// @updateURL    https://raw.githubusercontent.com/TravisDoo/TNL-Torn-Scripts/main/TNL-Merc-Request.js
// @downloadURL  https://raw.githubusercontent.com/TravisDoo/TNL-Torn-Scripts/main/TNL-Merc-Request.js
// @description  Request a Regular or Stricken Hosp
// @author       Dooby [2605556]
// @license      Personal Use
// @match        https://www.torn.com/*
// @run-at       document-end
// @grant        GM_xmlhttpRequest
// @grant        GM_registerMenuCommand
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_addStyle
// @connect      api.torn.com
// @connect      i.ibb.co
// @connect      merc.the-next-level.net
// ==/UserScript==

(() => {
    'use strict';

    const CFG = { endpoint: 'https://merc.the-next-level.net/merc-request', mobileBreak: 768, maxNotes: 500 };
    const LOGO = 'https://i.ibb.co/Lzh9FqpW/TNL.png';

    const KEYS = { apiKey: 'tnl_merc_api_key', tornId: 'tnl_merc_torn_id', tornName: 'tnl_merc_torn_name' };
    const IDS = { launcher: 'tnl-merc-launcher', request: 'tnl-merc-request-modal', api: 'tnl-merc-api-modal', result: 'tnl-merc-result-modal' };

    const gmxhr = typeof GM_xmlhttpRequest === 'function'
        ? GM_xmlhttpRequest
        : (typeof GM !== 'undefined' && typeof GM.xmlHttpRequest === 'function' ? GM.xmlHttpRequest.bind(GM) : null);

    // Unified storage wrapper (GM_* with localStorage fallback).
    const store = {
        get: async (k, d = '') => { try { return GM_getValue(k, d); } catch { try { return localStorage.getItem(k) ?? d; } catch { return d; } } },
        set: async (k, v) => { try { GM_setValue(k, v); } catch { try { localStorage.setItem(k, v); } catch {} } },
        del: async (k) => { try { GM_deleteValue(k); } catch { try { localStorage.removeItem(k); } catch {} } },
    };

    function request(opts) {
        return new Promise((resolve, reject) => {
            if (!gmxhr) return reject(new Error('GM_xmlhttpRequest is unavailable.'));
            gmxhr({
                timeout: 20000, ...opts, onload: resolve,
                onerror: () => reject(new Error('Network request failed.')),
                ontimeout: () => reject(new Error('Network request timed out.')),
                onabort: () => reject(new Error('Network request was aborted.')),
            });
        });
    }

    const parseJson = (v) => { try { return JSON.parse(v); } catch { return null; } };
    const esc = (v) => String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[c]));
    const profileUrl = (id) => `https://www.torn.com/profiles.php?XID=${id}`;
    const attackUrl = (id) => `https://www.torn.com/page.php?sid=attack&user2ID=${id}`;
    const currentProfileId = () => (location.href.match(/[?&#]XID=(\d+)/i) || [])[1] || '';
    const parseTarget = (v) => { v = String(v || '').trim(); return /^\d+$/.test(v) ? v : (v.match(/[?&#]XID=(\d+)/i) || [])[1] || ''; };
    const isMobile = () => innerWidth <= CFG.mobileBreak;
    const closeEl = (id) => document.getElementById(id)?.remove();
    const bindBackdrop = (bd, cb) => bd.addEventListener('click', (e) => { if (e.target === bd) cb(); });

    const header = (closeId) => `
        <div class="tnl-h">
            <img class="tnl-h-logo" src="${LOGO}" alt="TNL">
            <div class="tnl-h-copy"><strong>TNL</strong><span>Merc Request</span></div>
            <button id="${closeId}" class="tnl-close" type="button" aria-label="Close">&times;</button>
        </div>`;

    // Generic modal shell: builds the backdrop/card, wires close buttons + backdrop click.
    function modal(id, bodyHtml, footerHtml, closeIds = []) {
        closeEl(id);
        const bd = document.createElement('div');
        bd.id = id;
        bd.className = 'tnl-backdrop';
        bd.innerHTML = `<div class="tnl-card">${header(`${id}-close-x`)}<div class="tnl-body">${bodyHtml}</div>${footerHtml || ''}</div>`;
        document.body.appendChild(bd);
        const close = () => bd.remove();
        [`${id}-close-x`, ...closeIds].forEach((cid) => bd.querySelector(`#${cid}`)?.addEventListener('click', close));
        bindBackdrop(bd, close);
        return { bd, close };
    }

    function injectStyles() {
        const css = `
:root{--tnl-bg:#0d1017;--tnl-panel:#191f2b;--tnl-panel2:#222a38;--tnl-border:rgba(255,255,255,.13);--tnl-text:#f5f7fb;--tnl-muted:#aab2c2;--tnl-pink:#ed31bd;--tnl-blue:#22b7ff}
#tnl-merc-launcher{box-sizing:border-box!important;display:inline-flex!important;align-items:center!important;justify-content:center!important;gap:5px!important;margin:7px auto!important;padding:3px 9px!important;border:1px solid rgba(255,255,255,.2)!important;border-radius:6px!important;background:linear-gradient(135deg,rgba(237,49,189,.22),rgba(34,183,255,.22)),#151923!important;color:#fff!important;font:700 12px/1.2 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif!important;white-space:nowrap!important;cursor:pointer!important;box-shadow:0 2px 7px rgba(0,0,0,.32)!important;transition:transform .15s,filter .15s!important;z-index:20!important}
#tnl-merc-launcher:hover{transform:translateY(-1px)!important;filter:brightness(1.12)!important}
#tnl-merc-launcher img{width:20px!important;height:20px!important;border-radius:4px!important;object-fit:cover!important;pointer-events:none!important}
#tnl-merc-launcher span{pointer-events:none!important}
.tnl-backdrop{position:fixed;inset:0;z-index:999999;display:flex;align-items:center;justify-content:center;padding:14px;box-sizing:border-box;background:rgba(0,0,0,.78);backdrop-filter:blur(4px)}
.tnl-card{width:min(520px,100%);max-height:92vh;display:flex;flex-direction:column;overflow:hidden;border:1px solid var(--tnl-border);border-radius:13px;background:var(--tnl-bg);color:var(--tnl-text);box-shadow:0 18px 55px rgba(0,0,0,.62);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
.tnl-h{display:flex;align-items:center;gap:11px;min-height:54px;padding:10px 12px;border-bottom:1px solid var(--tnl-border);background:linear-gradient(110deg,rgba(237,49,189,.18),rgba(34,183,255,.18)),#151a26}
.tnl-h-logo{width:40px;height:40px;border-radius:8px;object-fit:cover;box-shadow:0 0 0 1px rgba(255,255,255,.2)}
.tnl-h-copy{display:flex;flex-direction:column;min-width:0}
.tnl-h-copy strong{font-size:19px;line-height:1.1}
.tnl-h-copy span{margin-top:2px;color:var(--tnl-muted);font-size:12px}
.tnl-close{width:34px;height:34px;margin-left:auto;border:1px solid var(--tnl-border);border-radius:9px;background:rgba(255,255,255,.05);color:var(--tnl-text);font-size:22px;line-height:1;cursor:pointer}
.tnl-body{overflow-y:auto;padding:16px}
.tnl-section{margin-bottom:16px}
.tnl-section:last-child{margin-bottom:0}
.tnl-label{display:block;margin:0 0 8px;font-size:11px;font-weight:800;letter-spacing:.55px;text-transform:uppercase}
.tnl-muted{color:var(--tnl-muted);font-size:12px;line-height:1.45}
.tnl-type-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px}
.tnl-type{padding:12px;border:1px solid var(--tnl-border);border-radius:10px;background:var(--tnl-panel);color:var(--tnl-text);text-align:left;cursor:pointer}
.tnl-type.is-selected{border-color:var(--tnl-blue);background:linear-gradient(135deg,rgba(237,49,189,.16),rgba(34,183,255,.16)),var(--tnl-panel);box-shadow:inset 0 0 0 1px rgba(34,183,255,.22)}
.tnl-type strong{display:block;margin-bottom:4px;font-size:15px}
.tnl-type span{color:var(--tnl-muted);font-size:12px;line-height:1.35}
.tnl-chips{display:flex;flex-wrap:wrap;gap:7px}
.tnl-chip{padding:7px 10px;border:1px solid var(--tnl-border);border-radius:999px;background:var(--tnl-panel);color:var(--tnl-text);font-size:12px;cursor:pointer}
.tnl-chip.is-selected{border-color:var(--tnl-blue);background:rgba(34,183,255,.15)}
.tnl-input,.tnl-textarea{box-sizing:border-box;width:100%;border:1px solid var(--tnl-border);border-radius:9px;background:var(--tnl-panel);color:var(--tnl-text);outline:none;font:13px/1.4 inherit}
.tnl-input{height:40px;padding:0 11px}
.tnl-textarea{min-height:82px;padding:10px 11px;resize:vertical}
.tnl-input:focus,.tnl-textarea:focus{border-color:var(--tnl-blue);box-shadow:0 0 0 2px rgba(34,183,255,.13)}
.tnl-summary{padding:10px 11px;border:1px solid var(--tnl-border);border-radius:9px;background:var(--tnl-panel);font-size:13px;line-height:1.5}
.tnl-summary a,.tnl-result a{color:#67c9ff}
.tnl-error{display:none;margin-top:7px;color:#ff7c8d;font-size:12px}
.tnl-error.is-visible{display:block}
.tnl-footer{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:11px 13px;border-top:1px solid var(--tnl-border);background:#10141d}
.tnl-footer-left,.tnl-footer-right{display:flex;gap:8px}
.tnl-btn{min-height:38px;padding:0 13px;border:1px solid transparent;border-radius:9px;color:#fff;font-size:12px;font-weight:800;cursor:pointer}
.tnl-btn:disabled{cursor:wait;opacity:.62}
.tnl-btn-primary{background:linear-gradient(135deg,var(--tnl-pink),var(--tnl-blue))}
.tnl-btn-secondary{border-color:var(--tnl-border);background:var(--tnl-panel2)}
.tnl-result-title{margin-bottom:8px;font-size:18px;font-weight:800}
.tnl-result-title.is-error{color:#ff7c8d}
.tnl-result{color:var(--tnl-muted);font-size:13px;line-height:1.55}
@media (max-width:768px){
#tnl-merc-launcher{margin:5px 4px!important;padding:2px 7px!important;font-size:11px!important}
#tnl-merc-launcher img{width:18px!important;height:18px!important}
.tnl-backdrop{align-items:flex-start;padding:8px;overflow-y:auto}
.tnl-card{margin-top:8px;max-height:calc(100vh - 16px)}
.tnl-type-grid{grid-template-columns:1fr 1fr}
.tnl-body{padding:13px}
.tnl-footer{flex-wrap:wrap}
.tnl-footer-left,.tnl-footer-right{width:100%}
.tnl-footer-right{justify-content:flex-end}
}
@media (max-width:430px){
.tnl-type-grid{grid-template-columns:1fr}
.tnl-btn{padding:0 10px}
}`;
        if (typeof GM_addStyle === 'function') { GM_addStyle(css); return; }
        const style = document.createElement('style');
        style.textContent = css;
        document.head.appendChild(style);
    }

    function showResult({ title, message, isError = false }) {
        const body = `
            <div class="tnl-result-title${isError ? ' is-error' : ''}">${esc(title)}</div>
            <div class="tnl-result">${message}</div>`;
        const footer = `<div class="tnl-footer"><div></div><div class="tnl-footer-right"><button id="tnl-result-close" class="tnl-btn tnl-btn-primary" type="button">Close</button></div></div>`;
        modal(IDS.result, body, footer, ['tnl-result-close']);
    }

    async function verifyApiKey(apiKey) {
        const res = await request({
            method: 'GET',
            url: `https://api.torn.com/v2/user/basic?key=${encodeURIComponent(apiKey)}&comment=TNL_Merc_Request`,
            headers: { Accept: 'application/json' },
        });
        const data = parseJson(res.responseText);
        if (res.status < 200 || res.status >= 300) throw new Error(`Torn returned HTTP ${res.status}.`);
        if (!data || typeof data !== 'object') throw new Error('Torn returned an invalid response.');
        if (data.error) throw new Error(data.error.error || 'The Torn API key is invalid.');
        const profile = data.profile || data;
        const id = String(profile.id || profile.player_id || '');
        const name = String(profile.name || profile.player_name || '');
        if (!id || !name) throw new Error('Torn did not return your identity.');
        return { apiKey, id, name };
    }

    async function promptApiKey() {
        return new Promise((resolve) => {
            const body = `
                <div class="tnl-section">
                    <label class="tnl-label" for="tnl-api-key">Torn Public API Key</label>
                    <input id="tnl-api-key" class="tnl-input" type="password" autocomplete="off" spellcheck="false" placeholder="Paste a public Torn API key">
                    <div class="tnl-muted" style="margin-top:8px">The key is stored only in Tampermonkey and is sent to Tuby when you submit a request so your Torn identity can be verified.</div>
                    <div id="tnl-api-error" class="tnl-error"></div>
                </div>`;
            const footer = `
                <div class="tnl-footer"><div></div><div class="tnl-footer-right">
                    <button id="tnl-api-cancel" class="tnl-btn tnl-btn-secondary" type="button">Cancel</button>
                    <button id="tnl-api-save" class="tnl-btn tnl-btn-primary" type="button">Verify &amp; Save</button>
                </div></div>`;

            const { bd, close } = modal(IDS.api, body, footer, ['tnl-api-cancel']);
            const input = bd.querySelector('#tnl-api-key');
            const errorBox = bd.querySelector('#tnl-api-error');
            const saveBtn = bd.querySelector('#tnl-api-save');
            const finish = (value) => { close(); resolve(value); };

            bd.querySelector('#tnl-api-cancel').addEventListener('click', () => finish(null));
            bd.querySelector(`#${IDS.api}-close-x`).addEventListener('click', () => finish(null));

            saveBtn.addEventListener('click', async () => {
                const apiKey = input.value.trim();
                if (!apiKey) {
                    errorBox.textContent = 'Enter a Torn API key.';
                    errorBox.classList.add('is-visible');
                    return;
                }
                saveBtn.disabled = true;
                saveBtn.textContent = 'Verifying…';
                errorBox.classList.remove('is-visible');
                try {
                    const identity = await verifyApiKey(apiKey);
                    await Promise.all([store.set(KEYS.apiKey, identity.apiKey), store.set(KEYS.tornId, identity.id), store.set(KEYS.tornName, identity.name)]);
                    finish(identity);
                } catch (err) {
                    errorBox.textContent = err.message || 'Unable to verify the API key.';
                    errorBox.classList.add('is-visible');
                    saveBtn.disabled = false;
                    saveBtn.textContent = 'Verify & Save';
                }
            });

            setTimeout(() => input.focus(), 30);
        });
    }

    async function getIdentity() {
        const [apiKey, id, name] = await Promise.all([store.get(KEYS.apiKey), store.get(KEYS.tornId), store.get(KEYS.tornName)]);
        if (apiKey && id && name) return { apiKey: String(apiKey), id: String(id), name: String(name) };
        return promptApiKey();
    }

    const clearIdentity = () => Promise.all([store.del(KEYS.apiKey), store.del(KEYS.tornId), store.del(KEYS.tornName)]);

    async function openRequestModal() {
        if (document.getElementById(IDS.request)) return;
        const identity = await getIdentity();
        if (!identity) return;

        const profileId = currentProfileId();
        const defaultMode = (profileId && profileId !== identity.id) ? 'profile' : 'me';

        const body = `
            <div class="tnl-section">
                <div class="tnl-label">Hospitalization Type</div>
                <div class="tnl-type-grid">
                    <button class="tnl-type is-selected" type="button" data-hit-type="regular"><strong>Regular ($3M)</strong><span>Standard ($3M) hospitalization request.</span></button>
                    <button class="tnl-type" type="button" data-hit-type="stricken"><strong>Stricken ($4M)</strong><span>Request 8+ hour stricken Hosp.</span></button>
                </div>
            </div>
            <div class="tnl-section">
                <div class="tnl-label">Target</div>
                <div class="tnl-chips">
                    <button class="tnl-chip${defaultMode === 'me' ? ' is-selected' : ''}" type="button" data-target-mode="me">Me</button>
                    ${profileId && profileId !== identity.id ? `<button class="tnl-chip${defaultMode === 'profile' ? ' is-selected' : ''}" type="button" data-target-mode="profile">Current Profile</button>` : ''}
                    <button class="tnl-chip" type="button" data-target-mode="other">Someone Else</button>
                </div>
                <div id="tnl-target-known" class="tnl-summary" style="margin-top:10px"></div>
                <div id="tnl-target-other-wrap" style="display:none;margin-top:10px">
                    <input id="tnl-target-other" class="tnl-input" type="text" placeholder="Torn player ID or profile URL">
                </div>
                <div id="tnl-target-error" class="tnl-error"></div>
            </div>
            <div class="tnl-section">
                <label class="tnl-label" for="tnl-notes">Notes for Mercs <span style="text-transform:none;letter-spacing:0;color:var(--tnl-muted)">(optional)</span></label>
                <textarea id="tnl-notes" class="tnl-textarea" maxlength="${CFG.maxNotes}" placeholder="Add any special instructions…"></textarea>
                <div class="tnl-chips" style="margin-top:8px">
                    <button class="tnl-chip" type="button" data-note="Hit ASAP, no contact needed">Hit ASAP</button>
                    <button class="tnl-chip" type="button" data-note="Contact me before hitting">Contact Me First</button>
                </div>
            </div>
            <div class="tnl-section">
                <div class="tnl-label">Request Summary</div>
                <div id="tnl-request-summary" class="tnl-summary"></div>
            </div>`;
        const footer = `
            <div class="tnl-footer">
                <div class="tnl-footer-left"><button id="tnl-change-key" class="tnl-btn tnl-btn-secondary" type="button">Change API Key</button></div>
                <div class="tnl-footer-right">
                    <button id="tnl-request-cancel" class="tnl-btn tnl-btn-secondary" type="button">Cancel</button>
                    <button id="tnl-request-send" class="tnl-btn tnl-btn-primary" type="button">Send Request</button>
                </div>
            </div>`;

        const { bd, close } = modal(IDS.request, body, footer, ['tnl-request-cancel']);

        let hitType = 'regular';
        let targetMode = defaultMode;

        const targetKnown = bd.querySelector('#tnl-target-known');
        const targetOtherWrap = bd.querySelector('#tnl-target-other-wrap');
        const targetOtherInput = bd.querySelector('#tnl-target-other');
        const targetError = bd.querySelector('#tnl-target-error');
        const notesInput = bd.querySelector('#tnl-notes');
        const summary = bd.querySelector('#tnl-request-summary');
        const sendBtn = bd.querySelector('#tnl-request-send');

        const resolvedTarget = () => targetMode === 'me' ? identity.id : targetMode === 'profile' ? profileId : parseTarget(targetOtherInput.value);
        const targetLabel = () => {
            if (targetMode === 'me') return `${identity.name} [${identity.id}]`;
            if (targetMode === 'profile') return `Current profile [${profileId}]`;
            const id = resolvedTarget();
            return id ? `Torn player [${id}]` : 'Not selected';
        };

        function updateTargetDisplay() {
            const isOther = targetMode === 'other';
            targetKnown.style.display = isOther ? 'none' : 'block';
            targetOtherWrap.style.display = isOther ? 'block' : 'none';
            if (!isOther) {
                const id = resolvedTarget();
                targetKnown.innerHTML = `<strong>${esc(targetLabel())}</strong><br><a href="${profileUrl(id)}" target="_blank" rel="noopener">Profile</a>&nbsp;•&nbsp;<a href="${attackUrl(id)}" target="_blank" rel="noopener">Attack</a>`;
                targetError.classList.remove('is-visible');
            }
        }

        const updateSummary = () => {
            summary.innerHTML = `<strong>${esc(hitType === 'regular' ? 'Regular' : 'Stricken')}</strong><br>Target: <strong>${esc(targetLabel())}</strong><br>Requested by: <strong>${esc(identity.name)} [${esc(identity.id)}]</strong>`;
        };

        function setTargetMode(mode) {
            targetMode = mode;
            bd.querySelectorAll('[data-target-mode]').forEach((b) => b.classList.toggle('is-selected', b.dataset.targetMode === mode));
            updateTargetDisplay();
            updateSummary();
            if (mode === 'other') setTimeout(() => targetOtherInput.focus(), 30);
        }

        bd.querySelectorAll('[data-hit-type]').forEach((btn) => btn.addEventListener('click', () => {
            hitType = btn.dataset.hitType;
            bd.querySelectorAll('[data-hit-type]').forEach((b) => b.classList.toggle('is-selected', b === btn));
            updateSummary();
        }));
        bd.querySelectorAll('[data-target-mode]').forEach((btn) => btn.addEventListener('click', () => setTargetMode(btn.dataset.targetMode)));
        targetOtherInput.addEventListener('input', () => { targetError.classList.remove('is-visible'); updateSummary(); });
        bd.querySelectorAll('[data-note]').forEach((btn) => btn.addEventListener('click', () => {
            const current = notesInput.value.trim();
            notesInput.value = current ? `${current}\n${btn.dataset.note}` : btn.dataset.note;
        }));

        bd.querySelector('#tnl-change-key').addEventListener('click', async () => {
            await clearIdentity();
            close();
            if (await promptApiKey()) openRequestModal();
        });

        bd.querySelector('#tnl-request-cancel').addEventListener('click', close);

        sendBtn.addEventListener('click', async () => {
            targetError.classList.remove('is-visible');
            const targetId = resolvedTarget();
            const notes = notesInput.value.trim();

            if (!targetId) {
                targetError.textContent = 'Enter a valid Torn player ID or profile URL.';
                targetError.classList.add('is-visible');
                return;
            }
            if (notes.length > CFG.maxNotes) {
                showResult({ title: 'Notes Too Long', message: `Notes cannot exceed ${CFG.maxNotes} characters.`, isError: true });
                return;
            }

            sendBtn.disabled = true;
            sendBtn.textContent = 'Sending…';

            try {
                const res = await request({
                    method: 'POST',
                    url: CFG.endpoint,
                    headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-Torn-Key': identity.apiKey },
                    data: JSON.stringify({ target_id: Number(targetId), hit_type: hitType, hits: 1, notes }),
                });
                const data = parseJson(res.responseText);

                if (res.status >= 200 && res.status < 300 && data?.ok) {
                    const targetName = data.request?.target_name || 'Torn Player';
                    const resolvedId = data.request?.target_id || targetId;
                    const typeName = hitType === 'regular' ? 'Regular' : 'Stricken';
                    close();
                    showResult({
                        title: 'Merc Request Sent',
                        message: `The TNL merc role was pinged for a <strong>${esc(typeName)}</strong> request on <a href="${profileUrl(resolvedId)}" target="_blank" rel="noopener">${esc(targetName)} [${esc(resolvedId)}]</a>.<br>`,
                    });
                    return;
                }

                const errorMessage = data?.error || data?.detail || res.responseText || `Server returned HTTP ${res.status}.`;
                if (res.status === 401) await clearIdentity();
                throw new Error(errorMessage);
            } catch (err) {
                showResult({ title: 'Request Failed', message: esc(err.message || 'The request could not be sent.'), isError: true });
            } finally {
                if (document.body.contains(sendBtn)) {
                    sendBtn.disabled = false;
                    sendBtn.textContent = 'Send Request';
                }
            }
        });

        setTargetMode(defaultMode);
        updateSummary();
    }

    function launcherContainer() {
        if (isMobile()) {
            return document.querySelector('.header-buttons-wrapper')
                || document.querySelector('.header-menu.left[class*="leftMenu___"].dropdown-menu')
                || document.querySelector('[class*="header-buttons"]');
        }
        return document.querySelector('[class*="user-information___"] [class*="toggle-content___"] > [class*="content___"]')
            || document.querySelector('[class*="user-information___"]');
    }

    function injectLauncher() {
        const container = launcherContainer();
        if (!container) return;

        const mobile = isMobile();
        let btn = document.getElementById(IDS.launcher);

        if (!btn) {
            btn = document.createElement('button');
            btn.id = IDS.launcher;
            btn.type = 'button';
            btn.title = 'Open TNL Merc Request';
            btn.dataset.layout = mobile ? 'mobile' : 'desktop';
            btn.innerHTML = `<img src="${LOGO}" alt="TNL"><span>${mobile ? 'Merc' : 'Merc Request'}</span>`;
            btn.addEventListener('click', openRequestModal);
        } else {
            const layout = mobile ? 'mobile' : 'desktop';
            if (btn.dataset.layout !== layout) {
                btn.dataset.layout = layout;
                const label = btn.querySelector('span');
                if (label) label.textContent = mobile ? 'Merc' : 'Merc Request';
            }
        }

        if (btn.parentElement !== container) container.appendChild(btn);
    }

    function registerMenuCommands() {
        if (typeof GM_registerMenuCommand !== 'function') return;
        GM_registerMenuCommand('Open TNL Merc Request', openRequestModal);
        GM_registerMenuCommand('Change Torn API Key', async () => { await clearIdentity(); await promptApiKey(); });
    }

    function boot() {
        injectStyles();
        injectLauncher();
        registerMenuCommands();

        let injectionTimer = null;
        const scheduleLauncherInjection = (delay = 100) => {
            if (injectionTimer !== null) return;
            injectionTimer = setTimeout(() => { injectionTimer = null; injectLauncher(); }, delay);
        };

        // Torn updates the page dynamically; only reinject if the launcher gets removed.
        new MutationObserver(() => {
            const btn = document.getElementById(IDS.launcher);
            if (!btn || !btn.isConnected) scheduleLauncherInjection();
        }).observe(document.body, { childList: true, subtree: true });

        let resizeTimer;
        window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(injectLauncher, 200); }, { passive: true });

        // Torn is an SPA; recheck the launcher after client-side navigation.
        const scheduleAfterNav = () => scheduleLauncherInjection(150);
        window.addEventListener('popstate', scheduleAfterNav, { passive: true });
        window.addEventListener('hashchange', scheduleAfterNav, { passive: true });
        for (const method of ['pushState', 'replaceState']) {
            const original = history[method];
            history[method] = function (...args) {
                const result = original.apply(this, args);
                scheduleAfterNav();
                return result;
            };
        }
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
    else boot();
})();
