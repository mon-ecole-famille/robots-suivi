'use strict';
/* Suivi des robots : coffre chiffré par code, données privées lues chez GitHub, robots et IA recalculés à la seconde. */
(() => {
  const OWNER = 'mon-ecole-famille', REPO = 'robots-trader';
  const API = `https://api.github.com/repos/${OWNER}/${REPO}/contents/`;
  const TFJS = 'https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.22.0/dist/tf.min.js';
  const LOCK_AFTER = 5 * 60e3, MAX_TRIES = 5;
  const $ = s => document.querySelector(s), R = Math.round;
  const esc = s => String(s).replace(/[&<>"']/g, c => '&#' + c.charCodeAt(0) + ';');
  const num = (x, d = 1) => (+x).toFixed(d).replace('.', ',');
  const pc = (x, d = 1) => isFinite(x) ? (x >= 0 ? '+' : '') + num(x * 100, d) + ' %' : '—';
  const eur = x => R(x).toLocaleString('fr-FR') + ' €';
  const usd = x => (+x).toLocaleString('fr-FR', { maximumFractionDigits: x < 10 ? 4 : 2 }) + ' $';
  const posTxt = p => p > 0 ? 'Achat' : p < 0 ? 'Vente' : 'Neutre';
  const cls = x => x >= 0 ? 'pos' : 'neg';
  const cssv = v => getComputedStyle(document.body).getPropertyValue(v).trim();
  const colOf = c => c === 'ink' ? getComputedStyle(document.body).color : /^#[0-9a-f]{3,8}$/i.test(c) ? c : '#888';
  const hm = t => new Date(t).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  const hms = t => new Date(t).toLocaleTimeString('fr-FR');
  const when = t => new Date(t).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const ago = t => { const m = R((Date.now() - t) / 6e4); return m < 1 ? 'à l\'instant' : m < 60 ? `il y a ${m} min` : m < 2880 ? `il y a ${R(m / 60)} h` : `le ${when(t)}`; };
  const isTrap = n => /Piège/.test(n);

  const INFO = [
    ['Tendance', 'Suit la tendance : il achète quand la moyenne des prix récents passe au-dessus de la moyenne plus longue, et vend dans le cas inverse.'],
    ['Retour à la moyenne', 'Parie que les excès se corrigent : il achète quand le cours est anormalement bas par rapport à sa moyenne, et vend quand il est anormalement haut.'],
    ['Cassure', 'Guette les sorties de zone : il achète quand le cours dépasse son plus haut récent, et vend quand il casse son plus bas.'],
    ['Momentum', 'Suit l\'élan : il achète si le cours a assez monté sur la période, et vend s\'il a assez baissé.'],
    ['RSI', 'Mesure la surchauffe : il achète quand le marché est survendu (RSI bas), et vend quand il est suracheté (RSI haut).'],
    ['IA neuronale', 'Réseau de neurones TensorFlow.js qui estime la probabilité que le cours monte dans les 4 prochaines bougies, à partir du prix, des volumes, du flux acheteurs, du BTC, de l\'heure et des taux de financement. Réentraîné chaque jour.'],
    ['Conseil (vote)', 'Fait voter les 6 robots précédents et ne suit que les décisions assez majoritaires.'],
    ['Piège 95 %', 'Robot témoin : il vise un taux de réussite énorme avec de tout petits gains et de grosses pertes, pour montrer que 95 % de réussite ne veut rien dire.'],
    ['Flux acheteurs', 'Observe qui pousse le marché : il achète quand les acheteurs pressés dominent nettement avec un volume inhabituel, et vend quand ce sont les vendeurs.']
  ];
  $('#guideBots').innerHTML = INFO.map(([n, t]) => `<li><b>${n}</b> : ${t}</li>`).join('');

  /* ---------- Stockage et chiffrement ---------- */
  const ls = { get: k => { try { return localStorage.getItem(k); } catch (e) { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} }, del: k => { try { localStorage.removeItem(k); } catch (e) {} } };
  const enc = new TextEncoder(), dec = new TextDecoder();
  const b64 = u => { const a = new Uint8Array(u); let s = ''; for (let i = 0; i < a.length; i += 8192) s += String.fromCharCode.apply(null, a.subarray(i, i + 8192)); return btoa(s); };
  const ub64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  async function derive(pin, salt) {
    const base = await crypto.subtle.importKey('raw', enc.encode(pin), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 310000, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }
  async function seal(obj) { const iv = crypto.getRandomValues(new Uint8Array(12)); const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, KEY, enc.encode(JSON.stringify(obj))); return JSON.stringify({ iv: b64(iv), ct: b64(ct) }); }
  async function unseal(s) { const o = JSON.parse(s); const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: ub64(o.iv) }, KEY, ub64(o.ct)); return JSON.parse(dec.decode(pt)); }
  function wipe() { for (const k of ['rs-vault', 'rs-salt', 'rs-cache', 'rs-tries', 'robots-token', 'robots-data']) ls.del(k); }

  let KEY = null, TOKEN = null, DATA = null, SYM = 'BTCUSDT', online = navigator.onLine, E = null, TF = null, hiddenAt = 0;
  const timers = [];

  /* ---------- Écrans ---------- */
  const show = v => { for (const id of ['vLock', 'vLogin', 'vApp']) $('#' + id).hidden = id !== v; };
  function showLogin(migrating) {
    show('vLogin'); $('#keyPart').hidden = !!migrating; $('#tokRow').hidden = !!migrating; $('#migr').hidden = !migrating;
    $('#lErr').textContent = ''; $('#pin1').value = $('#pin2').value = '';
  }
  function showLock(msg) { show('vLock'); $('#pinU').value = ''; $('#uErr').textContent = msg || ''; setTimeout(() => $('#pinU').focus(), 50); }

  async function fetchJSON(path, raw) {
    let r;
    try { r = await fetch(API + path + (path.includes('?') ? '&' : '?') + 't=' + Date.now(), { headers: { Authorization: (TOKEN.startsWith('ghp_') ? 'token ' : 'Bearer ') + TOKEN, Accept: 'application/vnd.github.raw+json' } }); }
    catch (x) { throw new Error('reseau'); }
    if (r.status === 401) throw new Error('cle');
    if (r.status === 403 || r.status === 404) throw new Error('acces');
    if (!r.ok) throw new Error('reseau');
    return raw ? r.text() : r.json();
  }
  const ERR = { cle: 'GitHub ne reconnaît pas cette clé : recopie-la entière (elle commence par ghp_).', acces: 'Cette clé n\'a pas accès à tes dépôts privés : recrée-la avec « Créer ma clé ».', reseau: 'Pas de connexion : réessaie quand tu as du réseau.' };

  $('#aKey').onclick = () => { $('#aKey').href = 'https://github.com/settings/tokens/new?scopes=repo&description=' + encodeURIComponent('Suivi robots ' + new Date().toLocaleString('fr-FR').replace(/[/:]/g, '-')); };
  $('#bPaste').onclick = async () => { try { $('#tok').value = (await navigator.clipboard.readText()).trim(); $('#lErr').textContent = ''; } catch (e) { $('#lErr').textContent = 'Collage automatique refusé : appui long dans la case, puis « Coller ».'; } };

  $('#fLogin').onsubmit = async e => {
    e.preventDefault();
    const migrating = !$('#tokRow').hidden ? false : true;
    const tok = migrating ? (ls.get('robots-token') || '') : $('#tok').value.replace(/[\s"'`]/g, '');
    const p1 = $('#pin1').value, p2 = $('#pin2').value;
    if (!tok) { $('#lErr').textContent = 'Colle d\'abord ta clé.'; return; }
    if (!/^\d{6}$/.test(p1)) { $('#lErr').textContent = 'Le code doit faire exactement 6 chiffres.'; return; }
    if (/^(\d)\1{5}$/.test(p1) || '0123456789'.includes(p1) || '9876543210'.includes(p1)) { $('#lErr').textContent = 'Code trop facile à deviner : évite 000000 ou 123456.'; return; }
    if (p1 !== p2) { $('#lErr').textContent = 'Les deux codes ne sont pas identiques.'; return; }
    $('#lErr').textContent = 'Vérification de la clé…';
    TOKEN = tok;
    try { DATA = await fetchJSON('public.json?ref=data'); }
    catch (x) { TOKEN = null; $('#lErr').textContent = ERR[x.message] || ERR.reseau; return; }
    $('#lErr').textContent = 'Chiffrement…';
    const salt = crypto.getRandomValues(new Uint8Array(16));
    KEY = await derive(p1, salt);
    ls.set('rs-salt', b64(salt)); ls.set('rs-vault', await seal({ tok })); ls.set('rs-tries', '0');
    await saveCache(); ls.del('robots-token'); ls.del('robots-data');
    $('#tok').value = $('#pin1').value = $('#pin2').value = '';
    enterApp();
  };

  $('#fLock').onsubmit = async e => {
    e.preventDefault();
    const pin = $('#pinU').value; $('#pinU').value = '';
    if (!/^\d{6}$/.test(pin)) { $('#uErr').textContent = 'Le code fait 6 chiffres.'; return; }
    $('#uErr').textContent = 'Déverrouillage…';
    try {
      KEY = await derive(pin, ub64(ls.get('rs-salt')));
      TOKEN = (await unseal(ls.get('rs-vault'))).tok;
    } catch (x) {
      KEY = null; TOKEN = null;
      const n = (+ls.get('rs-tries') || 0) + 1; ls.set('rs-tries', String(n));
      if (n >= MAX_TRIES) { wipe(); showLogin(false); $('#lErr').textContent = '5 codes faux : tout a été effacé par sécurité. Reconnecte-toi.'; return; }
      $('#uErr').textContent = `Code faux. Encore ${MAX_TRIES - n} essai${MAX_TRIES - n > 1 ? 's' : ''} avant effacement.`; return;
    }
    ls.set('rs-tries', '0');
    try { DATA = await unseal(ls.get('rs-cache')); } catch (x) { DATA = null; }
    enterApp();
  };
  $('#bForget').onclick = () => { wipe(); showLogin(false); };
  $('#bLock').onclick = () => lock();
  $('#bOut').onclick = () => { lock(true); wipe(); showLogin(false); $('#lErr').textContent = 'Déconnecté. Tout a été effacé de ce téléphone.'; };
  $('#bRef').onclick = () => refresh();

  async function saveCache() { if (KEY && DATA) ls.set('rs-cache', await seal(DATA)); }

  function lock(silent) {
    KEY = null; TOKEN = null; DATA = null;
    while (timers.length) clearInterval(timers.pop());
    stopLive(); $('#room').innerHTML = ''; $('#aiRoom').innerHTML = ''; $('#tb').innerHTML = ''; $('#log').innerHTML = '';
    if (!silent) showLock();
  }

  /* ---------- Données du serveur ---------- */
  async function refresh() {
    if (!TOKEN) return;
    try { DATA = await fetchJSON('public.json?ref=data'); setNet(true); await saveCache(); }
    catch (x) { if (x.message === 'cle') { lock(true); wipe(); showLogin(false); $('#lErr').textContent = 'Ta clé n\'est plus valide (expirée ou supprimée). Crées-en une nouvelle.'; return; } setNet(false); }
    buildView(); startLive();
  }
  function setNet(ok) {
    online = ok && navigator.onLine;
    $('#net').classList.toggle('off', !online); $('#net').lastElementChild.textContent = online ? 'En ligne' : 'Hors ligne';
    $('#offBan').hidden = online;
    if (!online) $('#offBan').textContent = DATA ? `Hors ligne : résultats enregistrés du ${when(DATA.updated)}.` : 'Hors ligne et aucun résultat enregistré pour l\'instant.';
  }
  const S = () => DATA && DATA.syms && DATA.syms[SYM];
  const MK = () => { const s = S() || {}; return { sym: s.sym || SYM, itv: s.itv || '1h', lev: s.lev || 1 }; };
  const MIN = { '15m': 15, '1h': 60, '4h': 240, '1d': 1440 };
  const dur = n => { const m = n * (MIN[MK().itv] || 60); return m >= 120 || m % 60 === 0 ? `${num(m / 60, m % 60 ? 1 : 0)} h` : `${m} min`; };

  /* ---------- Construction de l'écran ---------- */
  let viewKey = '';
  function buildView() {
    setNet(online);
    if (!DATA || !DATA.syms || !Object.keys(DATA.syms).length) { $('#sum').textContent = 'Aucun résultat pour l\'instant : le serveur publie à chaque heure.'; return; }
    const syms = Object.keys(DATA.syms); if (!syms.includes(SYM)) SYM = syms[0];
    $('#tabs').innerHTML = syms.map(s => `<button data-s="${esc(s)}" class="${s === SYM ? 'on' : ''}">${esc(DATA.syms[s].label || s.replace('USDT', ''))}</button>`).join('');
    const s = S(), key = SYM + DATA.updated;
    $('#sum').textContent = `${s.lev > 1 ? `Arène risquée : bougies de ${dur(1)}, levier ×${s.lev} (gains et pertes multipliés par ${s.lev}, un robot à zéro est éliminé). ` : `Bougies de ${dur(1)}, sans levier. `}Départ le ${when(s.since)} · ${DATA.runs} passage${DATA.runs > 1 ? 's' : ''} du serveur · ${s.gen} générations d'apprentissage · dernier passage ${ago(DATA.updated)}. Garder la crypto sans rien faire aurait donné ${pc(s.bh)}.${s.nextReview ? ` Prochaine revue des réglages : ${when(s.nextReview)}.` : ''}`;
    if (key !== viewKey) {
      viewKey = key;
      $('#room').innerHTML = s.bots.map((b, k) => `<article class="desk">
<div class="hd"><b><span class="dot" style="background:${colOf(b.col)}"></span>${esc(b.name)}</b><span class="badge" id="pos-${k}">—</span></div>
<div class="cap" id="cap-${k}">—</div>
<div class="row"><span>Depuis le départ</span><span id="chg-${k}">—</span></div>
<div class="row"><span>Trade en cours</span><span id="open-${k}">—</span></div>
<div class="row"><span>Si la bougie fermait maintenant</span><span id="int-${k}" class="chg">—</span></div>
<div class="row"><span>Score réel / test</span><span>${ovf(b)}</span></div>
<div class="why" id="why-${k}"></div>
<details><summary>Comment je décide</summary><p class="note">${esc((INFO[k] || ['', ''])[1])}</p><p class="note">${esc(settings(k, b.g || {}))}</p><p class="note">Réglages adoptés ${b.since ? 'le ' + when(b.since) : 'au départ'}. Score test : ${num(b.test.sh, 2)} · ${b.live.tr} trade${b.live.tr > 1 ? 's' : ''} fictif${b.live.tr > 1 ? 's' : ''} depuis le départ.</p></details>
</article>`).join('');
      $('#leg').innerHTML = s.bots.map(b => `<span><i style="background:${colOf(b.col)}"></i>${esc(b.name)}</span>`).join('');
      renderLog(); drawChart();
    }
    tick(true);
  }
  $('#tabs').onclick = e => { const b = e.target.closest('button'); if (b && b.dataset.s !== SYM) { SYM = b.dataset.s; viewKey = ''; buildView(); startLive(); } };

  function ovf(b) {
    const l = b.live, t = b.test.sh, base = `${num(l.sh || 0, 2)} / ${num(t, 2)}`;
    if (l.tr < 10) return `${base} · trop tôt (${l.tr}/10 trades)`;
    if (t > 1 && (l.sh || 0) < 0) return `${base} · ⚠ surapprentissage probable`;
    if ((l.sh || 0) > 0 && t > 0) return `${base} · cohérent`;
    return `${base} · pas d'avantage prouvé`;
  }
  function settings(k, g) {
    const sh = g.sh == null ? '' : g.sh < .5 ? ' · ne parie jamais à la baisse' : ' · peut parier à la baisse';
    const risk = (g.sl ? ` · stop à −${num(g.sl * 100)} % · objectif à +${num(g.tp * 100)} %` : '') + (g.hold ? ` · garde au moins ${dur(R(g.hold))}` : '') + (g.risk ? ` · mise réglée pour viser ${num(g.risk * 100, 1)} % de variation par bougie` : '');
    const t = [
      () => `Réglages appris : moyennes de ${dur(R(g.f))} et ${dur(Math.max(R(g.f) + 5, R(g.s)))}`,
      () => `Réglages appris : moyenne sur ${dur(R(g.k))}, seuil à ${num(g.z, 2)} écart-type`,
      () => `Réglages appris : plus haut et plus bas sur ${dur(R(g.n))}`,
      () => `Réglages appris : variation sur ${dur(R(g.L))}, seuil à ${num(g.t * 100)} %`,
      () => `Réglages appris : RSI sur ${dur(R(g.k))}, achat sous ${R(g.lo)}, vente au-dessus de ${R(g.hi)}`,
      () => `Réglages appris : achat au-dessus de ${num(50 + g.m * 100)} %, vente sous ${num(50 - g.m * 100)} %`,
      () => `Réglages appris : il faut au moins ${R(g.v)} vote${R(g.v) > 1 ? 's' : ''} d'écart`,
      () => `Réglages appris : revend à +${num(g.tp * 100, 2)} % ou à −${num(g.sl * 100)} %`,
      () => `Réglages appris : flux mesuré sur ${dur(R(g.k))}, seuil à ${num(g.th * 100)} points, volume minimal ${num(g.vz, 1)} écart-type`
    ][k];
    return t ? t() + (k === 7 ? '' : risk + sh) + '.' : '';
  }

  /* ---------- Moteur et IA (chargés depuis le dépôt privé) ---------- */
  const loadScript = src => new Promise((ok, ko) => { const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = ko; document.head.appendChild(s); });
  let enginePromise = null;
  function loadEngine() {
    if (!enginePromise) enginePromise = (async () => {
      const code = await fetchJSON('engine.js?ref=main', true);
      const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
      await loadScript(url); URL.revokeObjectURL(url); E = window.Engine;
      try { await loadScript(TFJS); TF = window.tf; await TF.setBackend('cpu'); } catch (x) { TF = null; }
    })().catch(x => { enginePromise = null; throw x; });
    return enginePromise;
  }

  /* ---------- Direct ---------- */
  const LV = { sym: null, t: [], c: [], v: [], tb: [], px: null, cur: null, bt: [], bc: [], bpx: null, baseNN: null, model: null, modelT0: null, ws: null, intent: {}, logs: [], q: null };
  function stopLive() { if (LV.ws) { LV.ws.onclose = null; LV.ws.close(); LV.ws = null; } if (LV.model) { LV.model.dispose(); LV.model = null; } LV.sym = null; LV.px = null; LV.cur = null; LV.bpx = null; LV.baseNN = null; LV.intent = {}; }
  async function startLive() {
    if (!online || !S() || !TOKEN) return;
    try { await loadEngine(); } catch (x) { $('#aiTxt').textContent = 'Le moteur des robots n\'a pas pu être chargé. Réessaie avec « Actualiser ».'; return; }
    if (LV.sym !== SYM) {
      stopLive(); LV.sym = SYM; const mk = MK();
      try {
        const d = await E.fetchKlines(fetch.bind(window), mk.sym, mk.itv, 1000); if (LV.sym !== SYM) return;
        Object.assign(LV, { t: d.t, c: d.c, v: d.v, tb: d.tb, px: d.c[d.c.length - 1], bt: [], bc: [] });
        if (mk.sym !== 'BTCUSDT') { const b = await E.fetchKlines(fetch.bind(window), 'BTCUSDT', mk.itv, 1000); if (LV.sym !== SYM) return; LV.bt = b.t; LV.bc = b.c; LV.bpx = b.c[b.c.length - 1]; }
      } catch (x) { LV.sym = null; $('#aiTxt').textContent = 'Binance ne répond pas depuis ce réseau : le direct reprendra tout seul.'; return; }
      connectWS();
    }
    if (LV.modelT0 !== S().t0 || !LV.baseNN) { buildModel(); baseNN(); }
    tick(true);
  }
  function buildModel() {
    if (LV.model) { LV.model.dispose(); LV.model = null; }
    const s = S(); LV.modelT0 = s.t0;
    if (TF && s.nnW && s.nnW[0] && s.nnW[0].s[0] === E.NF) { LV.model = E.makeModel(TF); E.setW(TF, LV.model, s.nnW); }
  }
  /* Mêmes informations que le serveur : volumes, flux, BTC aligné, financement, plus la bougie en cours si demandée. */
  function buildD(withLive) {
    const mk = MK(), s = S(), cur = withLive && LV.cur;
    const t = withLive ? [...LV.t, cur ? cur.t : LV.t[LV.t.length - 1] + E.MS[mk.itv]] : LV.t.slice();
    const D = E.prep(Float64Array.from(withLive ? [...LV.c, LV.px] : LV.c), E.ppyOf(mk.itv), mk.lev);
    const v = withLive ? [...LV.v, cur ? cur.v : LV.v[LV.v.length - 1]] : LV.v, tb = withLive ? [...LV.tb, cur ? cur.tb : .5] : LV.tb;
    E.attach(D, { t, v: Float64Array.from(v), tb: Float64Array.from(tb) });
    if (LV.bt.length) { const bx = E.alignTo(t, LV.bt, LV.bc); if (withLive && LV.bpx) bx[bx.length - 1] = LV.bpx; D.bx = bx; }
    if (s.fundHist) D.fund = E.fundAt(t, E.MS[mk.itv], s.fundHist);
    return D;
  }
  function baseNN() {
    if (!LV.c.length) return;
    const D = buildD(false);
    if (LV.model) E.predictNN(TF, LV.model, D); LV.baseNN = D.nn;
  }
  function connectWS() {
    const sym = SYM, mk = MK(), me = mk.sym.toLowerCase(), alt = mk.sym !== 'BTCUSDT';
    const streams = [`${me}@kline_${mk.itv}`, ...(alt ? [`btcusdt@kline_${mk.itv}`] : [])].join('/');
    const ws = new WebSocket(`wss://data-stream.binance.vision/stream?streams=${streams}`); LV.ws = ws;
    ws.onmessage = ev => {
      let m; try { m = JSON.parse(ev.data); } catch (x) { return; }
      const k = m && m.data && m.data.k; if (!k || LV.sym !== sym) return;
      if (alt && k.s === 'BTCUSDT') {
        LV.bpx = +k.c;
        if (k.x && +k.t > LV.bt[LV.bt.length - 1]) { LV.bt.push(+k.t); LV.bc.push(+k.c); }
        return;
      }
      if (k.s && k.s !== mk.sym) return;
      LV.px = +k.c; LV.pxT = Date.now(); LV.cur = { t: +k.t, v: +k.v, tb: +k.v > 0 ? +k.V / +k.v : .5 };
      if (k.x && +k.t > LV.t[LV.t.length - 1]) {
        LV.t.push(+k.t); LV.c.push(+k.c); LV.v.push(+k.v); LV.tb.push(LV.cur.tb); LV.cur = null;
        if (LV.t.length > 1500) for (const a of [LV.t, LV.c, LV.v, LV.tb]) a.splice(0, 300);
        baseNN(); addLog(`Bougie de ${hm(+k.t)} clôturée à ${usd(+k.c)}.`);
      }
    };
    ws.onclose = () => { if (LV.ws === ws) { LV.ws = null; setTimeout(() => { if (TOKEN && online && LV.sym === sym && !LV.ws) connectWS(); }, 4000); } };
  }

  /* Ce que chaque robot pense, recalculé à partir du cours de cette seconde. */
  function think() {
    const s = S(); if (!E || !s || !LV.c.length || LV.px == null || !s.bots[0].st) return null;
    const D = buildD(true), n = D.n, i = n - 1;
    let q = null;
    if (LV.model && LV.baseNN) {
      const nn = new Float32Array(n).fill(NaN); nn.set(LV.baseNN.subarray(0, n - 1));
      const f = E.features(D, i);
      if (f) { const t = TF.tensor2d([f]), o = LV.model.predict(t); q = o.dataSync()[0]; t.dispose(); o.dispose(); nn[i] = q; }
      D.nn = nn;
    }
    E.members(D, s.bots.map(b => b.g));
    return { D, i, q, out: s.bots.map((b, k) => ({ it: b.g && E.BOTS[k] ? E.intent(E.BOTS[k], b.g, D, i, b.st) : { pos: 0, why: 'signal' }, why: b.g && E.BOTS[k] ? why(k, b.g, D, i, q) : '' })) };
  }
  function why(k, g, D, i, q) {
    const p = D.p[i];
    switch (k) {
      case 0: { const f = R(g.f), sl = Math.max(f + 5, R(g.s)), a = E.ma(D, i, f), b = E.ma(D, i, sl); return `Moyenne ${dur(f)} : ${usd(a)} ${a > b ? '>' : '<'} moyenne ${dur(sl)} : ${usd(b)}. Tendance ${a > b ? 'haussière' : 'baissière'}.`; }
      case 1: { const kk = R(g.k), z = (p - E.ma(D, i, kk)) / (E.sd(D, i, kk) || 1e-9); return `Écart à la moyenne ${dur(kk)} : ${num(z, 2)} écart-type (il agit au-delà de ±${num(g.z, 2)}).`; }
      case 2: { const nn = R(g.n); let hi = -1e18, lo = 1e18; for (let j = i - nn; j < i; j++) { hi = Math.max(hi, D.p[j]); lo = Math.min(lo, D.p[j]); } return `Plus haut ${dur(nn)} : ${usd(hi)} · plus bas : ${usd(lo)} · cours : ${usd(p)}.`; }
      case 3: { const L = R(g.L), r = p / D.p[i - L] - 1; return `Variation sur ${dur(L)} : ${pc(r, 2)} (il agit au-delà de ±${num(g.t * 100, 2)} %).`; }
      case 4: { const x = E.rsi(D, i, R(g.k)); return `RSI ${dur(R(g.k))} : ${num(x, 0)} (achat sous ${R(g.lo)}, vente au-dessus de ${R(g.hi)}).`; }
      case 5: return q == null ? 'Cerveau de l\'IA en cours de chargement.' : `Probabilité de hausse d'ici ${dur(S().H || 4)} : ${num(q * 100)} % (achat au-dessus de ${num(50 + g.m * 100)} %, vente sous ${num(50 - g.m * 100)} %).`;
      case 6: { let up = 0, dn = 0; for (const m of D.mem) { if (m[i] > 0) up++; else if (m[i] < 0) dn++; } return `Votes : ${up} à l'achat, ${dn} à la vente. Il faut ${R(g.v)} vote${R(g.v) > 1 ? 's' : ''} d'écart pour agir.`; }
      case 7: return `Reste acheté en permanence, revend à +${num(g.tp * 100, 2)} % ou à −${num(g.sl * 100)} %.`;
      case 8: { const f = E.flow(D, i, R(g.k)), z = E.volZ(D, i); return `Achats agressifs sur ${dur(R(g.k))} : ${num((f + .5) * 100)} % du volume (il agit au-delà de ${num((.5 + g.th) * 100)} % ou en dessous de ${num((.5 - g.th) * 100)} %). Volume ${z > g.vz ? 'suffisant' : 'trop faible'} (${num(z, 1)} contre ${num(g.vz, 1)} requis).`; }
    }
    return '';
  }

  /* ---------- Rendu à la seconde ---------- */
  let lastPx = null, lastChart = 0;
  function set(id, txt, c) { const el = document.getElementById(id); if (!el) return; if (el.textContent !== txt) el.textContent = txt; if (c !== undefined) el.className = c; }
  function tick(force) {
    if (!KEY) return;
    const now = Date.now();
    set('hClk', hms(now));
    const nx = new Date(now); nx.setUTCMinutes(7, 0, 0); while (nx <= now) nx.setTime(nx.getTime() + 30 * 6e4);
    const left = R((nx - now) / 1000); set('hNext', `≈ ${String(Math.floor(left / 60)).padStart(2, '0')}:${String(left % 60).padStart(2, '0')}`);
    const s = S(); if (!s) return;
    const live = online && LV.sym === SYM && LV.px != null, px = live ? LV.px : s.price, start = DATA.start || 1e4;
    set('pxLbl', `${s.label || SYM.replace('USDT', '')} ${live ? 'en direct' : 'au dernier passage'}`);
    const pxEl = $('#hPx'), txt = usd(px);
    if (pxEl.textContent !== txt) { pxEl.textContent = txt; if (lastPx != null) { pxEl.classList.remove('up', 'dn'); void pxEl.offsetWidth; pxEl.classList.add(px >= lastPx ? 'up' : 'dn'); } lastPx = px; }
    const th = live ? think() : null;
    const lev = s.lev || 1, caps = s.bots.map(b => b.st ? Math.max(0, start * b.st.eq * (1 + b.st.pos * lev * (b.st.size || 1) * (px / s.price - 1))) : b.live.capital);
    s.bots.forEach((b, k) => {
      const st = b.st || { pos: b.live.pos };
      set(`cap-${k}`, eur(caps[k])); set(`chg-${k}`, pc(caps[k] / start - 1), cls(caps[k] / start - 1));
      set(`pos-${k}`, b.g && b.g.off && !st.pos ? 'Veille' : posTxt(st.pos), 'badge b' + st.pos);
      set(`open-${k}`, st.dead ? 'éliminé (capital à zéro)' : st.pause ? 'en pause (−5 % sur 24 h)' : st.pos && st.entry ? `${posTxt(st.pos)} à ${usd(st.entry)} · ${pc(st.pos * lev * (st.size || 1) * (px / st.entry - 1), 2)} · mise ${R((st.size || 1) * 100)} %` : 'aucun');
      if (th) {
        const o = th.out[k], ip = o.it.pos, ch = ip !== st.pos;
        set(`int-${k}`, (o.it.why === 'elimine' ? 'Éliminé' : o.it.why === 'pause' ? 'En pause' : o.it.why === 'veille' ? 'En veille' : o.it.why === 'maintien' ? `Garde sa position (durée minimale)` : o.it.why === 'stop' ? 'Stop : sortirait' : o.it.why === 'objectif' ? 'Objectif : encaisserait' : ch ? `Passerait à ${posTxt(ip)}` : `Resterait ${posTxt(ip)}`), ch ? 'chg pos' : 'chg');
        set(`why-${k}`, b.g && b.g.off ? `En veille : son meilleur réglage ne gagne pas sur les données récentes jamais vues (score ${num(b.g.score || 0, 2)}). Il ne trade plus jusqu'à trouver un avantage prouvé. Pour info : ${o.why}` : o.why);
        if (LV.intent[k] !== undefined && LV.intent[k] !== ip) addLog(`${b.name} : changerait d'avis, ${posTxt(LV.intent[k])} → ${posTxt(ip)} si la bougie fermait maintenant.`);
        LV.intent[k] = ip;
      } else { set(`int-${k}`, '—', 'chg'); set(`why-${k}`, online ? 'Connexion au cours en direct…' : 'Hors ligne : dernier état connu du serveur.'); }
    });
    const best = s.bots.map((b, k) => k).filter(k => !isTrap(s.bots[k].name)).sort((a, b) => caps[b] - caps[a])[0];
    set('hBest', eur(caps[best])); $('#hBest').previousElementSibling.textContent = `En tête : ${s.bots[best].name}`;
    aiView(th, caps, start);
    $('#tb').innerHTML = s.bots.map((b, k) => [k, caps[k]]).sort((a, b) => b[1] - a[1]).map(([k, c]) => { const b = s.bots[k], l = b.live; return `<tr><td data-l="Robot"><span class="dot" style="background:${colOf(b.col)}"></span>${esc(b.name)}</td><td data-l="Capital maintenant">${eur(c)}</td><td data-l="Depuis le départ" class="${cls(c / start - 1)}">${pc(c / start - 1)}</td><td data-l="Trades">${+l.tr}</td><td data-l="Réussite">${l.tr ? R(l.wr * 100) + ' %' : '—'}</td><td data-l="Perte max">${R(l.dd * 100)} %</td><td data-l="Score réel">${l.tr >= 10 ? num(l.sh || 0, 2) : '—'}</td><td data-l="Score test">${num(b.test.sh, 2)}</td></tr>`; }).join('');
    if (force || now - lastChart > 5000) { lastChart = now; drawChart(caps.map(c => c / start)); }
  }
  function aiView(th, caps, start) {
    const s = S(), k = s.bots.findIndex(b => /IA/.test(b.name)); if (k < 0) return;
    const b = s.bots[k], g = b.g || { m: 0 }, q = th && th.q != null ? th.q : s.aiP;
    $('#gLo').style.left = (50 - g.m * 100) + '%'; $('#gHi').style.left = (50 + g.m * 100) + '%';
    if (q != null) { $('#gP').style.left = Math.max(0, Math.min(100, q * 100)) + '%'; set('aiPct', `${num(q * 100)} % de chances de hausse d'ici ${dur(s.H || 4)}`); }
    set('aiTxt', th && th.q != null ? `Calcul en direct avec le cerveau entraîné à ${hm(s.t0 + (MIN[MK().itv] || 60) * 6e4)} : la probabilité bouge avec chaque variation du cours.` : DATA.tf === false ? 'L\'IA n\'a pas pu tourner au dernier passage du serveur.' : online ? 'Chargement du cerveau de l\'IA…' : 'Hors ligne : dernière probabilité calculée par le serveur.');
    const o = th ? th.out[k] : null;
    const cards = [['Probabilité de hausse', q == null ? '—' : num(q * 100) + ' %'], ['Si la bougie fermait', o ? posTxt(o.it.pos) : '—'], ['Position actuelle', posTxt((b.st || b.live).pos)], ['Capital fictif', eur(caps[k])], ['Depuis le départ', pc(caps[k] / start - 1)], ['Score test', num(b.test.sh, 2)]];
    const html = cards.map(([a, v], j) => `<div class="desk"><span class="note">${a}</span><div class="cap" style="font-size:22px">${esc(v)}</div></div>`).join('');
    if ($('#aiRoom').innerHTML !== html) $('#aiRoom').innerHTML = html;
  }
  function addLog(t) { LV.logs.unshift({ t: Date.now(), txt: t, live: 1 }); LV.logs = LV.logs.slice(0, 40); renderLog(); }
  function renderLog() {
    const s = S(); if (!s) return;
    const srv = (s.events || []).map(e => { const nm = s.bots[e.k] ? s.bots[e.k].name : 'Robot'; return e.v !== undefined ? { t: e.t + 36e5, txt: e.v ? `${nm} : mis en veille, aucun avantage prouvé sur les données récentes.` : `${nm} : sort de veille, il a trouvé un réglage qui gagne sur des données jamais vues.` } : e.d ? { t: e.t + 36e5, txt: `${nm} : nouveaux réglages adoptés, nettement meilleurs sur des données jamais vues (score ${num(e.sc, 2)} contre ${num(e.old, 2)}).` } : { t: e.t + 36e5, txt: `${nm} : ${posTxt(e.a)} → ${posTxt(e.b)} à ${usd(e.p)} (trade fictif du serveur).` }; });
    const all = [...LV.logs, ...srv].sort((a, b) => b.t - a.t).slice(0, 40);
    $('#log').innerHTML = all.length ? all.map(e => `<li><time>${e.live ? hms(e.t) : when(e.t)}</time><span>${esc(e.txt)}</span></li>`).join('') : '<li><time></time><span>Aucun trade pour l\'instant : les robots attendent un signal.</span></li>';
  }
  function drawChart(liveEq) {
    const s = S(), c = $('#cv'); if (!s || !c.clientWidth) return;
    const W = c.clientWidth, H = c.clientHeight, dpr = devicePixelRatio || 1; c.width = W * dpr; c.height = H * dpr; const x = c.getContext('2d'); x.scale(dpr, dpr);
    const series = s.bots.map((b, k) => ({ v: [...s.hist.map(h => h[k + 1] ?? 1), ...(liveEq ? [liveEq[k]] : [])], col: colOf(b.col), dash: isTrap(b.name) ? [2, 3] : [], w: b.col === 'ink' ? 2.6 : 1.8 }));
    if (series[0].v.length < 2) { x.fillStyle = cssv('--mut'); x.font = '15px system-ui'; x.fillText('Les courbes se dessinent au fil des heures.', 12, 30); return; }
    let lo = 1e9, hi = -1e9; for (const sr of series) for (const v of sr.v) { if (v < lo) lo = v; if (v > hi) hi = v; }
    const pad = (hi - lo) * .08 || .004; lo = Math.min(lo - pad, .998); hi = Math.max(hi + pad, 1.002);
    const L = W < 520 ? 8 : 60, T = 10, B = H - 12, Rg = W - 8, X = (i, n) => L + (Rg - L) * i / Math.max(1, n - 1), Y = v => T + (B - T) * (hi - v) / (hi - lo);
    x.font = '12px system-ui';
    for (const v of [lo, 1, hi]) { const y = Y(v); x.strokeStyle = cssv('--line'); x.lineWidth = 1; x.beginPath(); x.moveTo(L, y); x.lineTo(Rg, y); x.stroke(); if (W >= 520) { x.fillStyle = cssv('--mut'); x.textAlign = 'right'; x.fillText(eur(v * (DATA.start || 1e4)), L - 6, y + 4); } }
    for (const sr of series) { x.strokeStyle = sr.col; x.setLineDash(sr.dash); x.lineWidth = sr.w; x.beginPath(); sr.v.forEach((v, i) => i ? x.lineTo(X(i, sr.v.length), Y(v)) : x.moveTo(X(i, sr.v.length), Y(v))); x.stroke(); }
    x.setLineDash([]);
  }

  /* ---------- Cycle de vie ---------- */
  function enterApp() {
    show('vApp'); viewKey = ''; buildView(); refresh();
    timers.push(setInterval(() => tick(false), 1000), setInterval(refresh, 120000));
  }
  addEventListener('online', () => { if (TOKEN) { setNet(true); refresh(); } });
  addEventListener('offline', () => { if (TOKEN) { setNet(false); stopLive(); tick(true); } });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { hiddenAt = Date.now(); return; }
    if (KEY && hiddenAt && Date.now() - hiddenAt > LOCK_AFTER) lock(); else if (TOKEN) refresh();
  });
  new ResizeObserver(() => { if (KEY) drawChart(); }).observe($('#cv'));

  if (ls.get('rs-vault') && ls.get('rs-salt')) showLock();
  else if (ls.get('robots-token')) showLogin(true);
  else showLogin(false);
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
})();
