'use strict';
// VO₂max Training – Oberfläche, Speicherung (nur auf diesem Gerät), Export und Import.

const STORE_KEY = 'vo2max-training';
const view = document.getElementById('view');
const tabs = document.getElementById('tabs');

// ---------- Speicher ----------
const blankState = () => ({
  version: 1,
  settings: { startDate: null, startPos: 0, freigabe: null, lastBackup: null, pause: 90 },
  checkins: {},  // Datum → { rhr, vital: 0|1|2, feel: [] }
  headaches: [], // Kopfschmerz-Einträge
  sessions: {},  // geplanter Tag → Einheit
  changed: null,
});

function loadState() {
  try {
    const s = JSON.parse(localStorage.getItem(STORE_KEY));
    if (s && s.version === 1) { s.headaches = s.headaches || []; return s; }
  } catch (e) { /* leer oder nicht lesbar */ }
  return blankState();
}
let state = loadState();

function save() {
  state.changed = new Date().toISOString();
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); }
  catch (e) { toast('Speichern fehlgeschlagen – bitte Backup exportieren.'); }
}

let route = { tab: 'heute', date: null, back: 'heute', weekOffset: 0, exercise: 'beinpresse' };
let draft = null;        // Erholungsampel vor dem Speichern
let renderedDay = null;  // für den Tageswechsel im Hintergrund

// ---------- Format ----------
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = v => { const n = parseFloat(String(v).replace(',', '.')); return Number.isFinite(n) ? n : null; };
const deNum = n => (n == null ? '' : String(n).replace('.', ','));
const fmtLong = s => parseDate(s).toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' });
const fmtDay = s => parseDate(s).toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' });
const fmtShort = s => parseDate(s).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });
const fmtFull = s => parseDate(s).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
const setsText = sets => sets.map(x => `${x.r ?? '–'}×${x.kg ? deNum(x.kg) : 'KG'}`).join(' · ');

// ---------- Erholungsampel ----------
const FEEL = [
  ['muede', 'Müde / schlecht geschlafen / Stress'],
  ['krank', 'Infekt / Fieber'],
  ['schmerz', 'Schmerz Knie / Fuß'],
  ['brust', 'Brustschmerz / Schwindel'],
];
const VITAL = ['Keine Abweichung', '1 Abweichung', 'Mehrere'];
const LIGHT_NAME = { g: 'Grün', y: 'Gelb', r: 'Rot' };

function lightOf(c) {
  if (!c) return null;
  const f = c.feel || [];
  if ((c.rhr ?? 0) >= 75 || c.vital === 2 || ['krank', 'schmerz', 'brust'].some(x => f.includes(x))) return 'r';
  if ((c.rhr ?? 0) >= 71 || c.vital === 1 || f.includes('muede')) return 'y';
  return 'g';
}

// Ein gelber Tag allein ändert nichts; zwei gelbe in Folge oder ein roter Tag schon.
function effectOf(date) {
  const t = dayLight(date);
  if (!t) return null;
  if (t === 'r') return 'rest';
  if (t === 'y') return ['y', 'r'].includes(dayLight(addDays(date, -1))) ? 'easy' : 'watch';
  return 'ok';
}

function effectText(date) {
  const e = effectOf(date);
  const brust = (state.checkins[date]?.feel || []).includes('brust');
  if (e === 'rest') return 'Ruhetag oder nur ein Spaziergang.' + (brust ? ' Brustschmerz oder Schwindel ärztlich abklären.' : '');
  if (e === 'easy') return 'Zweiter gelber Tag in Folge: heute locker – Intervalle werden zu Zone 2, Kraft nur 2 Sätze.';
  if (e === 'watch') return 'Ein einzelner gelber Tag ist normal: Plan wie vorgesehen, aufmerksam bleiben. Morgen erneut prüfen.';
  if (e === 'ok') return 'Plan wie vorgesehen.';
  return '';
}

// ---------- Kopfschmerz-Protokoll ----------
// Einträge für die ärztliche Abklärung. Ein Kopfschmerz färbt die Ampel des Tages mit:
// jeder Eintrag Gelb, ab Stärke 7 Rot.
const HA_ONSET = [['sleep', 'Hat mich geweckt'], ['wake', 'Beim Aufwachen'], ['day', 'Später am Tag']];
const HA_LOC = [['stirn', 'Stirn'], ['schlaefe', 'Schläfe'], ['auge', 'Hinter dem Auge'], ['scheitel', 'Scheitel'], ['hinterkopf', 'Hinterkopf / Nacken'], ['ganz', 'Ganzer Kopf']];
const HA_SIDE = [['links', 'Links'], ['rechts', 'Rechts'], ['beide', 'Beidseitig']];
const HA_KIND = [['drueckend', 'Drückend / dumpf'], ['pochend', 'Pochend / pulsierend'], ['stechend', 'Stechend']];
const HA_SYM = [['uebelkeit', 'Übelkeit'], ['licht', 'Lichtempfindlich'], ['laerm', 'Lärmempfindlich'], ['seh', 'Sehstörung / Flimmern'], ['schwindel', 'Schwindel'], ['nacken', 'Nackenschmerz'], ['kiefer', 'Kiefer verspannt / Zähneknirschen'], ['kauen', 'Schmerz beim Kauen']];
// Seit 1.4: Nackenverspannung (Joe: Kopfschmerz immer mit verspanntem Nacken links) und Schlafposition
const HA_NECK = [['nein', 'Nein'], ['links', 'Links'], ['rechts', 'Rechts'], ['beide', 'Beidseitig']];
const HA_POS = [['ruecken', 'Rücken'], ['seite_l', 'Seite links'], ['seite_r', 'Seite rechts'], ['bauch', 'Bauch'], ['wechselnd', 'Wechselnd / unbekannt']];
const KIND_NAME = { krafta: 'Kraft A', kraftb: 'Kraft B', sunday: 'Studio (So)', z2out: 'Zone 2 draußen', walk: 'Alltag', opt: 'Optional', free: 'Frei' };
const HA_PRIOR = [['essen', 'Spätes / schweres Essen'], ['wenig', 'Wenig getrunken'], ['stress', 'Stress'], ['schnarchen', 'Schnarchen / Atemaussetzer bemerkt']];
const HA_EFFECT = ['gut', 'teilweise', 'keine'];
const MED_NAMES = ['Ibuprofen', 'Paracetamol', 'Aspirin (ASS)', 'Thomapyrin', 'Novaminsulfon'];
const MED_WARN = 'Ab etwa 10 Tagen mit Schmerzmitteln im Monat können Schmerzmittel selbst Kopfschmerzen auslösen – mit dem Arzt besprechen.';

const nameOf = (list, k) => list.find(x => x[0] === k)?.[1] ?? k;
const nowTime = () => { const d = new Date(); return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`; };
const haSorted = () => [...state.headaches].sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
const haById = id => state.headaches.find(e => e.id === id);
const haOn = date => state.headaches.filter(e => e.date === date);
const haMonth = ym => state.headaches.filter(e => e.date.slice(0, 7) === ym);
const hasMeds = e => e.meds.some(m => m.name.trim());
const monthName = ym => new Date(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 1, 1).toLocaleDateString('de-DE', { month: 'long', year: 'numeric' });
const avgText = s => (s.avg == null ? '–' : deNum(s.avg.toFixed(1)));
const plural = (n, one, many) => `${deNum(n)} ${n === 1 ? one : many}`;
// Training am Vortag aus dem eigenen Protokoll (nur was in der App erfasst ist)
function prevTraining(date) {
  const s = state.sessions[addDays(date, -1)];
  if (!s || !hasProgress(s)) return null;
  const ex = Object.entries(s.ex).filter(([, a]) => a.some(x => x.ok)).map(([id]) => EX[id]?.name || id);
  return { label: s.kind === 'sunday' && isHome(s.mode) ? 'Sonntag zuhause' : (KIND_NAME[s.kind] || s.kind), ex, kraft: ex.length > 0 };
}
const prevText = t => (t ? `${t.label}${t.ex.length ? ` (${t.ex.join(', ')})` : ' – ohne Kraftübungen'}` : 'kein Training erfasst');
const medText = m => [m.name.trim(), m.dose.trim(), m.time && `um ${m.time}`].filter(Boolean).join(' ') + (m.effect ? `, Wirkung ${m.effect}` : '');

function haMax(date) {
  const p = haOn(date).map(e => e.pain).filter(n => n != null);
  return p.length ? Math.max(...p) : null;
}

// Schlechteres Signal aus Morgen-Ampel und Kopfschmerz
function dayLight(date) {
  const a = lightOf(state.checkins[date]);
  const b = haOn(date).length ? ((haMax(date) ?? 0) >= 7 ? 'r' : 'y') : null;
  if (!a || !b) return a || b;
  const rank = { g: 0, y: 1, r: 2 };
  return rank[a] >= rank[b] ? a : b;
}

function newHeadache() {
  const e = {
    id: 'h' + Date.now().toString(36), date: todayISO(), time: nowTime(), onset: new Date().getHours() < 10 ? 'wake' : 'day', end: '', pain: null,
    loc: [], side: '', neck: '', kind: [], sym: [], pos: '', alc: null, coffee: null, sleep: null, prior: [], meds: [], note: '',
  };
  state.headaches.push(e);
  save();
  return e;
}

function editHeadache(act, t) {
  const e = haById(route.hid);
  if (!e) return;
  const k = t.dataset.k, v = t.dataset.v, i = Number(t.dataset.i);
  switch (act) {
    case 'ha-set': e[k] = k === 'pain' ? Number(v) : (['side', 'neck', 'pos'].includes(k) && e[k] === v ? '' : v); break;
    case 'ha-tog': e[k] = e[k].includes(v) ? e[k].filter(x => x !== v) : [...e[k], v]; break;
    case 'ha-med-add': e.meds.push({ name: '', dose: '', time: nowTime(), effect: '' }); break;
    case 'ha-med-del': e.meds.splice(i, 1); break;
    case 'ha-med-eff': e.meds[i].effect = e.meds[i].effect === v ? '' : v; break;
  }
  save();
  render();
}

function haStats(list) {
  const pains = list.map(e => e.pain).filter(n => n != null);
  return {
    n: list.length,
    days: new Set(list.map(e => e.date)).size,
    medDays: new Set(list.filter(hasMeds).map(e => e.date)).size,
    avg: pains.length ? pains.reduce((a, b) => a + b, 0) / pains.length : null,
    max: pains.length ? Math.max(...pains) : null,
  };
}

function haByMonth() {
  const months = {};
  for (const e of state.headaches) (months[e.date.slice(0, 7)] ||= []).push(e);
  return Object.entries(months).sort((a, b) => b[0].localeCompare(a[0]));
}

function haDuration(e) {
  if (!e.time || !e.end) return '';
  const toMin = s => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));
  let m = toMin(e.end) - toMin(e.time);
  if (m < 0) m += 1440;
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}`;
}

function haLine(e) {
  const meds = e.meds.map(m => m.name.trim()).filter(Boolean).join(', ');
  return `${e.time || '–'} · ${nameOf(HA_ONSET, e.onset)} · Stärke ${e.pain ?? '–'}/10${meds ? ` · ${meds}` : ''}`;
}

function monthLine(ym) {
  const s = haStats(haMonth(ym));
  return `${monthName(ym)}: ${plural(s.days, 'Tag', 'Tage')} mit Kopfschmerz, ${s.medDays} mit Schmerzmitteln${s.avg != null ? `, Ø Stärke ${avgText(s)}` : ''}.`;
}
const medBanner = ym => (haStats(haMonth(ym)).medDays >= 10 ? `<div class="banner y">${MED_WARN}</div>` : '');

// Karte auf „Heute“
function kopfCard(date) {
  const today = haOn(date).sort((a, b) => a.time.localeCompare(b.time));
  return `<section class="card ha">
    <h2>Kopfschmerz-Protokoll</h2>
    ${today.map(e => `<button class="row" data-act="ha-open" data-id="${e.id}"><span>${esc(haLine(e))}</span><span class="muted">ändern ›</span></button>`).join('')}
    <div class="actions"><button class="ghost" data-act="ha-new">+ Kopfschmerz eintragen</button><button class="link" data-act="ha-list">Übersicht & Bericht ›</button></div>
    <p class="hint">${monthLine(date.slice(0, 7))}</p>${medBanner(date.slice(0, 7))}
  </section>`;
}

// Karte im „Verlauf“
function kopfSummaryCard() {
  const ym = todayISO().slice(0, 7);
  return `<section class="card"><h2>Kopfschmerzen</h2>
    <p>${monthLine(ym)}</p>${medBanner(ym)}
    <button class="ghost wide" data-act="ha-list">Übersicht & Bericht ›</button>
  </section>`;
}

function renderKopf() {
  let h = '<header class="page-head"><button class="back" data-act="ha-back">‹ Zurück</button><h1>Kopfschmerzen</h1></header>';
  const months = haByMonth();
  if (!months.length) {
    return h + '<section class="card"><p class="muted">Noch keine Einträge.</p><button class="primary wide" data-act="ha-new">+ Kopfschmerz eintragen</button></section>';
  }
  h += `<section class="card"><h2>Monate</h2><div class="scroll"><table>
    <thead><tr><th>Monat</th><th class="r">Tage</th><th class="r">Schmerzmittel</th><th class="r">Ø Stärke</th><th class="r">Morgens</th></tr></thead>
    <tbody>${months.map(([ym, list]) => {
      const s = haStats(list);
      return `<tr><td>${monthName(ym)}</td><td class="r">${s.days}</td><td class="r${s.medDays >= 10 ? ' warn' : ''}">${s.medDays}</td>
        <td class="r">${avgText(s)}</td><td class="r">${list.filter(e => e.onset !== 'day').length} / ${s.n}</td></tr>`;
    }).join('')}</tbody></table></div>
    <p class="hint">Tage = Tage mit Kopfschmerz · Schmerzmittel = Tage mit Einnahme · Morgens = Einträge „hat mich geweckt“ oder „beim Aufwachen“. ${MED_WARN}</p>
  </section>`;
  h += `<section class="card"><h2>Für den Arzt</h2>
    <p class="hint">Der Bericht fasst alle Einträge zusammen und listet sie einzeln auf – zum Senden per Mail oder Nachricht oder zum Sichern in Notizen (von dort druckbar).</p>
    <button class="primary wide" data-act="ha-report">Bericht teilen</button>
    <button class="ghost wide" data-act="ha-csv">Tabelle für Excel (CSV)</button>
  </section>`;
  h += `<section class="card"><h2>Einträge</h2>
    ${haSorted().reverse().map(e => `<button class="row" data-act="ha-open" data-id="${e.id}"><span><small>${fmtDay(e.date)}</small>${esc(haLine(e))}</span><span class="muted">›</span></button>`).join('')}
    <button class="primary wide" data-act="ha-new">+ Kopfschmerz eintragen</button>
  </section>`;
  return h;
}

function renderKopfEdit() {
  const e = haById(route.hid);
  if (!e) { route.tab = 'kopf'; return renderKopf(); }
  const on = (key, k) => (Array.isArray(e[key]) ? e[key].includes(k) : String(e[key]) === String(k));
  const chips = (key, list) => `<div class="chips">${list.map(([k, l]) => `<button data-act="ha-tog" data-k="${key}" data-v="${k}" class="chip ${on(key, k) ? 'on' : ''}" aria-pressed="${on(key, k)}">${l}</button>`).join('')}</div>`;
  // Einfachauswahl im Chip-Layout (für längere Listen, seit 1.4)
  const pick = (key, list) => `<div class="chips">${list.map(([k, l]) => `<button data-act="ha-set" data-k="${key}" data-v="${k}" class="chip ${on(key, k) ? 'on' : ''}" aria-pressed="${on(key, k)}">${l}</button>`).join('')}</div>`;
  const seg = (key, list, cls = '') => `<div class="seg ${cls}">${list.map(([k, l]) => `<button data-act="ha-set" data-k="${key}" data-v="${k}" class="${on(key, k) ? 'on' : ''}" aria-pressed="${on(key, k)}">${l}</button>`).join('')}</div>`;
  const names = [...new Set([...MED_NAMES, ...state.headaches.flatMap(x => x.meds.map(m => m.name.trim())).filter(Boolean)])];
  const meds = e.meds.map((m, i) => `<div class="med">
      <div class="med-row">
        <label>Mittel<input data-hm="name" data-i="${i}" value="${esc(m.name)}" list="med-names" placeholder="z. B. Ibuprofen" autocomplete="off"></label>
        <label>Dosis<input data-hm="dose" data-i="${i}" value="${esc(m.dose)}" placeholder="400 mg"></label>
        <label>Uhrzeit<input type="time" data-hm="time" data-i="${i}" value="${esc(m.time)}"></label>
      </div>
      <div class="label">Wirkung</div>
      <div class="med-foot"><div class="seg">${HA_EFFECT.map(x => `<button data-act="ha-med-eff" data-i="${i}" data-v="${x}" class="${m.effect === x ? 'on' : ''}" aria-pressed="${m.effect === x}">${x}</button>`).join('')}</div>
        <button class="mini" data-act="ha-med-del" data-i="${i}">Entfernen</button></div>
    </div>`).join('');
  const flag = e.sym.includes('seh') || e.sym.includes('kauen');
  return `<header class="page-head"><button class="back" data-act="ha-done">‹ Zurück</button><div class="kicker">${fmtLong(e.date)}</div><h1>Kopfschmerz</h1></header>
  <section class="card"><h2>Wann</h2>
    <label class="field">Datum<input type="date" data-h="date" value="${e.date}"></label>
    <div class="pair"><label class="field">Beginn<input type="time" data-h="time" value="${e.time}"></label>
      <label class="field">Ende (falls vorbei)<input type="time" data-h="end" value="${e.end}"></label></div>
    ${seg('onset', HA_ONSET)}
  </section>
  <section class="card"><h2>Stärke</h2>
    ${seg('pain', Array.from({ length: 10 }, (_, i) => [i + 1, String(i + 1)]), 'pain')}
    <p class="hint">1 = kaum spürbar · 5 = deutlich, stört · 10 = stärkster vorstellbarer Schmerz. Ab 7 wird die Ampel des Tages rot.</p>
  </section>
  <section class="card"><h2>Schmerzmittel</h2>
    ${meds || '<p class="muted">Keine eingetragen.</p>'}
    <button class="ghost wide" data-act="ha-med-add">+ Schmerzmittel</button>
    <datalist id="med-names">${names.map(n => `<option value="${esc(n)}">`).join('')}</datalist>
  </section>
  <section class="card"><h2>Ort und Art</h2>
    <div class="label">Wo</div>${chips('loc', HA_LOC)}
    <div class="label">Seite</div>${seg('side', HA_SIDE)}
    <div class="label">Nacken verspannt</div>${seg('neck', HA_NECK)}
    <div class="label">Wie</div>${chips('kind', HA_KIND)}
  </section>
  <section class="card"><h2>Begleitsymptome</h2>${chips('sym', HA_SYM)}
    ${flag ? '<div class="banner r">Sehstörung oder Schmerz beim Kauen bitte nicht bis zum Checkup aufschieben, sondern zeitnah ärztlich abklären – bei plötzlichem Sehverlust sofort.</div>' : ''}
  </section>
  <section class="card"><h2>Vorabend und Nacht</h2>
    <div class="trio">
      <label>Alkohol (Gläser)<input data-h="alc" value="${deNum(e.alc)}" inputmode="decimal" placeholder="0"></label>
      <label>Kaffee am Vortag (Tassen)<input data-h="coffee" value="${deNum(e.coffee)}" inputmode="decimal" placeholder="0"></label>
      <label>Schlaf (Stunden)<input data-h="sleep" value="${deNum(e.sleep)}" inputmode="decimal" placeholder="7"></label>
    </div>
    <p class="hint">Schlafdauer z. B. aus der Health-App (Schlaf).</p>
    ${chips('prior', HA_PRIOR)}
    <div class="label">Schlafposition (soweit bekannt)</div>${pick('pos', HA_POS)}
    <p class="hint">Training am Vortag (aus dem Protokoll): ${esc(prevText(prevTraining(e.date)))}</p>
  </section>
  <section class="card"><label class="note">Notiz<textarea data-h="note" rows="3" placeholder="z. B. besser nach dem Frühstück, Kissen gewechselt">${esc(e.note)}</textarea></label>
    <div class="actions"><button class="primary" data-act="ha-done">Fertig</button><button class="ghost" data-act="ha-del">Löschen</button></div>
  </section>
  <details class="card fold"><summary>Warnzeichen – sofort ärztliche Hilfe</summary><ul class="plain">
    <li>Plötzlich einsetzender, extrem starker Kopfschmerz</li>
    <li>Lähmung, Taubheit, Sprach- oder Sehstörung, Verwirrtheit</li>
    <li>Fieber mit steifem Nacken</li>
    <li>Kopfschmerz nach einem Sturz oder Schlag auf den Kopf</li></ul>
    <p class="hint">Dann Notruf 112. Neue oder zunehmende Kopfschmerzen ab 50 zeitnah beim Hausarzt abklären, nicht erst beim Checkup. Die App dokumentiert nur und ersetzt keine ärztliche Beurteilung.</p>
  </details>`;
}

// Bericht als Text für den Arzt
function haReport() {
  const list = haSorted();
  const s = haStats(list);
  const count = (key, names) => {
    const c = {};
    for (const e of list) for (const k of e[key]) c[k] = (c[k] || 0) + 1;
    return Object.entries(c).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${nameOf(names, k)} ${n}×`).join(', ');
  };
  const meds = {};
  for (const e of list) for (const m of e.meds.filter(x => x.name.trim())) {
    const g = (meds[m.name.trim()] ||= { n: 0, doses: new Set(), eff: {} });
    g.n++;
    if (m.dose.trim()) g.doses.add(m.dose.trim());
    if (m.effect) g.eff[m.effect] = (g.eff[m.effect] || 0) + 1;
  }
  const L = ['KOPFSCHMERZ-PROTOKOLL', `Zeitraum ${fmtFull(list[0].date)} – ${fmtFull(list[list.length - 1].date)} · erstellt am ${fmtFull(todayISO())}`, '', 'ZUSAMMENFASSUNG'];
  L.push(`Einträge: ${s.n} an ${plural(s.days, 'Tag', 'Tagen')}`);
  L.push(`Beginn: ${HA_ONSET.map(([k, l]) => `${l} ${list.filter(e => e.onset === k).length}×`).join(' · ')}`);
  if (s.avg != null) L.push(`Stärke (1–10): Ø ${avgText(s)}, höchste ${s.max}`);
  L.push(`Tage mit Schmerzmitteln: ${s.medDays}`);
  for (const [name, g] of Object.entries(meds)) {
    const eff = HA_EFFECT.filter(x => g.eff[x]).map(x => `${x} ${g.eff[x]}×`).join(', ');
    L.push(`  ${name}: ${g.n}× eingenommen${g.doses.size ? ` (${[...g.doses].join(', ')})` : ''}${eff ? ` – Wirkung ${eff}` : ''}`);
  }
  for (const [key, names, label] of [['loc', HA_LOC, 'Ort'], ['kind', HA_KIND, 'Art'], ['sym', HA_SYM, 'Begleitsymptome'], ['prior', HA_PRIOR, 'Vorabend/Nacht']]) {
    const c = count(key, names);
    if (c) L.push(`${label}: ${c}`);
  }
  for (const [key, names, label] of [['neck', HA_NECK, 'Nacken verspannt'], ['pos', HA_POS, 'Schlafposition']]) {
    const c = {};
    for (const e of list) if (e[key]) c[e[key]] = (c[e[key]] || 0) + 1;
    const t = Object.entries(c).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${nameOf(names, k)} ${n}×`).join(', ');
    if (t) L.push(`${label}: ${t} (von ${s.n} Einträgen)`);
  }
  const kv = list.filter(e => prevTraining(e.date)?.kraft).length;
  L.push(`Krafttraining am Vortag: ${kv} von ${s.n} Einträgen (laut Trainingsprotokoll der App)`);
  for (const [ym] of haByMonth().reverse()) {
    const m = haStats(haMonth(ym));
    L.push(`${monthName(ym)}: ${plural(m.days, 'Kopfschmerztag', 'Kopfschmerztage')}, ${plural(m.medDays, 'Schmerzmitteltag', 'Schmerzmitteltage')}${m.avg != null ? `, Ø Stärke ${avgText(m)}` : ''}`);
  }
  L.push('', 'EINZELNE EINTRÄGE');
  for (const e of list) {
    const day = parseDate(e.date).toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' });
    const dur = haDuration(e);
    L.push('', `${day}, ${e.time || '–'} Uhr (${nameOf(HA_ONSET, e.onset)})${e.end ? `, bis ${e.end} Uhr${dur ? ` (${dur})` : ''}` : ''} · Stärke ${e.pain ?? '–'}/10`);
    const where = [e.loc.map(k => nameOf(HA_LOC, k)).join(', '), e.side && nameOf(HA_SIDE, e.side), e.kind.map(k => nameOf(HA_KIND, k)).join(', ')].filter(Boolean).join(' · ');
    if (where) L.push(`  ${where}`);
    if (e.neck) L.push(`  Nacken verspannt: ${nameOf(HA_NECK, e.neck)}`);
    if (e.sym.length) L.push(`  Begleitsymptome: ${e.sym.map(k => nameOf(HA_SYM, k)).join(', ')}`);
    const em = e.meds.filter(m => m.name.trim());
    L.push(`  Schmerzmittel: ${em.length ? em.map(medText).join('; ') : 'keine'}`);
    const prior = [e.alc != null && `Alkohol ${plural(e.alc, 'Glas', 'Gläser')}`, e.coffee != null && `Kaffee am Vortag ${plural(e.coffee, 'Tasse', 'Tassen')}`,
      e.sleep != null && `Schlaf ${deNum(e.sleep)} h`, ...e.prior.map(k => nameOf(HA_PRIOR, k))].filter(Boolean);
    if (prior.length) L.push(`  Vorabend/Nacht: ${prior.join(' · ')}`);
    if (e.pos) L.push(`  Schlafposition: ${nameOf(HA_POS, e.pos)}`);
    L.push(`  Training am Vortag: ${prevText(prevTraining(e.date))}`);
    if (e.note.trim()) L.push(`  Notiz: ${e.note.trim()}`);
  }
  L.push('', 'Selbst erfasst; Stärke nach eigener Einschätzung (1 = kaum spürbar, 10 = stärkster vorstellbarer Schmerz).');
  return L.join('\n');
}

async function shareReport() {
  if (!state.headaches.length) { toast('Noch keine Einträge.'); return; }
  const text = haReport();
  if (navigator.share) {
    try { await navigator.share({ title: 'Kopfschmerz-Protokoll', text }); return; }
    catch (e) { if (e.name === 'AbortError') return; }
  }
  try { await navigator.clipboard.writeText(text); toast('Bericht in die Zwischenablage kopiert'); }
  catch (e) { toast('Teilen ist hier nicht möglich.'); }
}

function haCSV(t) {
  const rows = haSorted().map(e => [
    fmtFull(e.date), e.time, nameOf(HA_ONSET, e.onset), e.end, haDuration(e), e.pain ?? '',
    e.loc.map(k => nameOf(HA_LOC, k)).join(', '), e.side ? nameOf(HA_SIDE, e.side) : '', e.kind.map(k => nameOf(HA_KIND, k)).join(', '),
    e.sym.map(k => nameOf(HA_SYM, k)).join(', '), e.meds.filter(m => m.name.trim()).map(medText).join(' / '),
    deNum(e.alc), deNum(e.coffee), deNum(e.sleep), e.prior.map(k => nameOf(HA_PRIOR, k)).join(', '), e.note,
    e.neck ? nameOf(HA_NECK, e.neck) : '', e.pos ? nameOf(HA_POS, e.pos) : '', prevText(prevTraining(e.date)),
  ]);
  return csvFile(`vo2max-kopfschmerz-${t}.csv`, ['Datum', 'Beginn', 'Zeitpunkt', 'Ende', 'Dauer', 'Stärke', 'Ort', 'Seite', 'Art', 'Begleitsymptome', 'Schmerzmittel',
    'Alkohol (Gläser)', 'Kaffee Vortag (Tassen)', 'Schlaf (h)', 'Vorabend/Nacht', 'Notiz', 'Nacken verspannt', 'Schlafposition', 'Training Vortag'], rows);
}

// ---------- Einheiten ----------
function lastSets(id, before) {
  const dates = Object.keys(state.sessions).filter(d => d < before).sort().reverse();
  for (const d of dates) {
    const sets = state.sessions[d].ex?.[id];
    if (sets && sets.some(x => x.ok)) return { date: d, sets };
  }
  // seit 1.7: neue Übung ohne eigene Vorgeschichte → letzter Wert der Vorgängerübung (z. B. Split Squats beidseitig)
  return EX[id].legacy ? lastSets(EX[id].legacy, before) : null;
}

// Bausteine einer Einheit; ältere Einheiten mit dem gemeinsamen Split-Squat-Eintrag (bis 1.6) zeigen diesen weiter an
// Zuhause Mark (seit 1.8): Prep Cals 1–3, Cal. Session 1–10 und Stretch 1–3 laufen der Reihe nach durch –
// gezählt werden frühere Zuhause-Mark-Sonntage mit Eintrag.
function homeMarkCount(date) {
  return Object.keys(state.sessions).filter(d => d < date && state.sessions[d].mode === 'homeMark' && hasProgress(state.sessions[d])).length;
}
function sessionBlocks(day, s) {
  let blocks = blocksFor(day, s.mode);
  if (blocks.some(b => b.rot)) {
    const k = homeMarkCount(day.date);
    blocks = blocks.map(b => (b.rot ? { ...b, label: `${b.rot[1]} ${(k % b.rot[0]) + 1}` } : b));
  }
  if (!s.ex?.bulgarian || s.ex.bulgarian_l || s.ex.bulgarian_r) return blocks;
  return blocks.filter(b => b.id !== 'bulgarian_r').map(b => (b.id === 'bulgarian_l' ? { ...b, id: 'bulgarian' } : b));
}

function defaultSets(id, n, date) {
  const ex = EX[id], last = lastSets(id, date);
  return Array.from({ length: n }, (_, i) => {
    const prev = last && (last.sets[i] || last.sets[last.sets.length - 1]);
    return { r: ex.reps[i] ?? ex.reps[ex.reps.length - 1], kg: prev ? prev.kg : ex.kg, ok: false };
  });
}

function newSession(day, mode) {
  const s = { kind: day.kind, mode, status: 'open', doneOn: null, checks: {}, ex: {}, cardio: {}, iv: [], rounds: [], note: '' };
  for (const b of blocksFor(day, mode)) {
    if (b.type === 'ex') s.ex[b.id] = defaultSets(b.id, b.sets, day.date);
    if (b.type === 'cardio') s.cardio[b.key] = { min: b.min, dev: b.dev[0], hr: '', ok: false };
    if (b.type === 'intervals') s.iv = Array.from({ length: b.n }, () => ({ hr: '', ok: false }));
    if (b.type === 'circuit') s.rounds = [false, false, false];
  }
  return s;
}

const defaultMode = day => (effectOf(day.date) === 'easy' && (isKraft(day.kind) || day.kind === 'sunday') ? 'easy' : 'normal');
const sessionFor = day => state.sessions[day.date] || newSession(day, defaultMode(day));

function ensureSession(date) {
  if (!state.sessions[date]) {
    const day = dayInfo(state.settings, date);
    state.sessions[date] = newSession(day, defaultMode(day));
  }
  return state.sessions[date];
}

function hasProgress(s) {
  if (!s) return false;
  return s.status !== 'open' || !!s.note
    || Object.values(s.checks).some(Boolean)
    || Object.values(s.ex).some(a => a.some(x => x.ok))
    || Object.values(s.cardio).some(c => c.ok)
    || s.iv.some(x => x.ok) || s.rounds.some(Boolean)
    || (!!s.stand && (s.stand.l != null || s.stand.r != null))
    || s.sit != null;
}

function statusOf(date) {
  const s = state.sessions[date];
  if (!s) return 'open';
  if (s.status !== 'open') return s.status;
  return hasProgress(s) ? 'started' : 'open';
}

function weekStats(monday) {
  let minutes = 0, kraft = 0;
  for (let i = 0; i < 7; i++) {
    const s = state.sessions[addDays(monday, i)];
    if (!s) continue;
    for (const c of Object.values(s.cardio)) if (c.ok) minutes += num(c.min) || 0;
    if (isKraft(s.kind) && s.status === 'done') kraft++;
  }
  return { minutes, kraft };
}

function allHit(id, sets) {
  const reps = EX[id].reps;
  return sets.length >= 2 && sets.every((x, i) => x.ok && (x.r ?? 0) >= (reps[i] ?? reps[reps.length - 1]));
}

// ---------- Bausteine ----------
// Farben je Art des Bausteins (seit 1.9): Aufwärmen gelb, Kraft orange, Ausdauer blau, Intervalle rot,
// Balance violett, Beweglichkeit pink. Abhaken bleibt grün.
const CAT_NAME = { warm: 'Aufwärmen', kraft: 'Kraft', aus: 'Ausdauer', int: 'Intervalle', bal: 'Balance', mob: 'Beweglichkeit' };
function blockCat(b) {
  if (b.type === 'ex' || b.type === 'circuit') return 'kraft';
  if (b.type === 'intervals') return 'int';
  if (b.type === 'cardio') return 'aus';
  return { warmup: 'warm', balance: 'bal', yoga: 'mob', hang: 'kraft', prepcals: 'kraft', calsession: 'aus', walk: 'aus' }[b.key] || 'aus';
}
function dayCat(kind, mode, w) {
  if (isKraft(kind)) return 'kraft';
  if (kind === 'sunday') return w && w.iv && mode === 'normal' ? 'int' : 'aus';
  return kind === 'free' ? 'none' : 'aus';
}
const STATUS_LABEL = { open: 'Offen', started: 'Begonnen', done: 'Erledigt', skipped: 'Ausgelassen' };
const STATUS_ICON = { open: '○', started: '◐', done: '✓', skipped: '–' };

function checkHTML(b, s, day) {
  const on = !!s.checks[b.key];
  return `<div class="block">
    <button class="check ${on ? 'on' : ''}" data-act="check" data-k="${b.key}" aria-pressed="${on}">
      <span class="box" aria-hidden="true"></span><span><b>${esc(b.label)}</b><small>${esc(b.detail || '')}</small></span>
    </button>
    ${b.key === 'balance' ? standHTML(s, day) : ''}
    ${b.list ? `<details class="more"><summary>Übungen</summary><ul>${b.list.map(x => `<li>${esc(x)}</li>`).join('')}</ul></details>` : ''}
  </div>`;
}

// Einbeinstand in Sekunden je Bein (bester von 3 Versuchen) – Fortschritt und Seitenunterschied (seit 1.3)
function lastStand(date) {
  const d = Object.keys(state.sessions).filter(x => x < date).sort().reverse()
    .find(x => { const t = state.sessions[x].stand; return !!t && (t.l != null || t.r != null); });
  return d ? { date: d, ...state.sessions[d].stand } : null;
}

function standHTML(s, day) {
  const t = s.stand || {};
  const last = lastStand(day.date);
  const sec = v => (v == null ? '–' : `${deNum(v)} s`);
  return `<div class="c-row two">
      <label>Einbeinstand links (s)<input data-f="standl" value="${deNum(t.l)}" placeholder="Sek." inputmode="decimal"></label>
      <label>Einbeinstand rechts (s)<input data-f="standr" value="${deNum(t.r)}" placeholder="Sek." inputmode="decimal"></label>
    </div>
    <p class="hint">Je Bein den besten von 3 Versuchen eintragen.${last ? ` Zuletzt (${fmtShort(last.date)}): links ${sec(last.l)} · rechts ${sec(last.r)}.` : ''}</p>
    ${sitDue(s, day) ? sitHTML(s, day) : ''}`;
}

// 30-Sekunden-Aufstehtest einmal im Monat (seit 1.7): erscheint sonntags im Balance-Block,
// bis im laufenden Monat ein Wert eingetragen ist. Misst Beinkraft fürs Aufstehen aus dem Stuhl.
function lastSit(date) {
  const d = Object.keys(state.sessions).filter(x => x < date).sort().reverse()
    .find(x => state.sessions[x].sit != null);
  return d ? { date: d, n: state.sessions[d].sit } : null;
}
function sitDue(s, day) {
  if (s.sit != null) return true;
  if (day.kind !== 'sunday') return false;
  const last = lastSit(day.date);
  return !last || last.date.slice(0, 7) !== day.date.slice(0, 7);
}
function sitHTML(s, day) {
  const last = lastSit(day.date);
  return `<div class="c-row two">
      <label>Aufstehtest 30 s (Wdh.)<input data-f="sit" value="${deNum(s.sit)}" placeholder="Anzahl" inputmode="numeric"></label>
    </div>
    <p class="hint">Monatstest: Bank oder Stuhl ohne Armlehnen, Arme vor der Brust gekreuzt. 30 s lang so oft wie möglich ganz aufstehen und wieder hinsetzen; ein über die Hälfte geschafftes Aufstehen am Ende zählt mit. Mittlere Hälfte der Männer 65–69: 12–18.${last ? ` Zuletzt (${fmtShort(last.date)}): ${deNum(last.n)}.` : ''}</p>`;
}

function exHTML(b, s, day) {
  const ex = EX[b.id];
  const sets = s.ex[b.id] || defaultSets(b.id, b.sets, day.date);
  const last = lastSets(b.id, day.date);
  const repsText = ex.range || ex.reps.slice(0, sets.length).join('/');
  const startText = ex.bw ? 'Körpergewicht' : `Start ${deNum(ex.kg)} kg`;
  let suggest = '';
  if (last && ex.step && !day.week.deload && s.mode !== 'easy' && allHit(b.id, last.sets)) {
    const next = Math.max(...last.sets.map(x => x.kg || 0)) + ex.step;
    if (sets.some(x => (x.kg || 0) < next)) {
      suggest = `<button class="suggest" data-act="suggest" data-kg="${next}">Letztes Mal alles geschafft → ${deNum(next)} kg übernehmen</button>`;
    }
  }
  const rows = sets.map((x, i) => `<div class="set ${x.ok ? 'ok' : ''}">
      <span class="n">${i + 1}</span>
      <input class="reps" data-f="r" data-i="${i}" value="${x.r ?? ''}" inputmode="numeric" aria-label="Wiederholungen Satz ${i + 1}">
      <span class="x">Wdh ×</span>
      <input class="kg" data-f="kg" data-i="${i}" value="${x.kg ? deNum(x.kg) : ''}" placeholder="${ex.bw ? 'KG' : '0'}" inputmode="decimal" aria-label="Gewicht Satz ${i + 1}">
      <span class="x">kg</span>
      <button class="tick" data-act="setok" data-i="${i}" aria-label="Satz ${i + 1} erledigt" aria-pressed="${x.ok}">✓</button>
    </div>`).join('');
  return `<div class="block ex" data-ex="${b.id}">
    <div class="ex-top"><b>${esc(ex.name)}</b>${ex.extra ? '<span class="tag">Zusatz</span>' : '<span class="tag app">App</span>'}</div>
    <div class="meta">${sets.length} × ${esc(repsText)} · ${startText}${ex.bw ? ' (Zusatzgewicht eintragbar)' : ''}</div>
    ${last ? `<div class="meta last">Letztes Mal ${fmtShort(last.date)}: ${esc(setsText(last.sets))}</div>` : ''}
    ${suggest}
    <div class="sets">${rows}</div>
    <div class="ex-foot">
      <button class="mini" data-act="addset">+ Satz</button>
      ${sets.length > 1 ? '<button class="mini" data-act="delset">− Satz</button>' : ''}
      <details class="more"><summary>Ausführung</summary><p>${esc(ex.hint)}</p></details>
    </div>
  </div>`;
}

// Watt und Trittfrequenz an Studiogeräten – Fortschritt in Zone 2 = mehr Watt bei gleichem Puls (seit 1.3)
// Seit 1.6: Stufe an allen Studiogeräten; Rudergerät mit Zeit, Strecke und Schlägen vom Endbildschirm,
// daraus Ø /500 m, Ø-Watt (Formel Watt = 2,80 / (s pro m)³) und Ø-Schlagzahl.
const DEV_HINT = { 'Ergometer': CADENCE, 'Rudergerät': ROWING };

function parseMMSS(v) {
  const t = String(v ?? '').trim();
  if (!t) return null;
  const m = t.match(/^(\d{1,3})[:.](\d{1,2})$/);
  if (m) return Number(m[1]) * 60 + Number(m[2]);
  const n = num(t);
  return n && n > 0 ? Math.round(n * 60) : null;
}
const fmtMMSS = sec => (sec == null ? '' : `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')}`);

function rowCalc(c) {
  if (!c.tsec || !c.dist) return null;
  const sPerM = c.tsec / c.dist;
  return {
    split: sPerM * 500,
    watt: Math.round(2.8 / Math.pow(sPerM, 3)),
    spm: c.strokes ? Math.round(c.strokes / (c.tsec / 60) * 10) / 10 : null,
  };
}
function rowCalcText(c) {
  const r = rowCalc(c);
  if (!r) return 'Zeit und Strecke eintragen – dann rechnet die App Ø /500 m, Ø-Watt und Ø-Schlagzahl aus.';
  return `Berechnet: Ø ${fmtMMSS(r.split)} /500 m · ${r.watt} W${r.spm != null ? ` · ${deNum(r.spm)} Schläge/min` : ''}`;
}

function lastCardio(date, dev) {
  for (const d of Object.keys(state.sessions).filter(x => x < date).sort().reverse()) {
    const c = Object.values(state.sessions[d].cardio || {}).find(x => x.dev === dev && x.watt != null);
    if (c) return { date: d, ...c };
  }
  return null;
}

function powerHTML(b, c, day) {
  const row = c.dev === 'Rudergerät';
  const last = lastCardio(day.date, c.dev);
  const r = last && row ? rowCalc(last) : null;
  const parts = last ? [
    `${deNum(last.watt)} W`,
    last.rpm != null ? `${deNum(last.rpm)} ${row ? 'Schläge/min' : 'rpm'}` : '',
    r ? `${fmtMMSS(r.split)} /500 m` : '',
    last.lvl ? `Stufe ${last.lvl}` : '',
    last.hr ? `Puls ${last.hr}` : '',
  ].filter(Boolean).join(' · ') : '';
  const rowFields = row ? `<div class="c-row four">
      <label>Min<input data-f="ctm" data-k="${b.key}" value="${c.tsec != null ? Math.floor(c.tsec / 60) : ''}" placeholder="opt." inputmode="numeric"></label>
      <label>Sek<input data-f="cts" data-k="${b.key}" value="${c.tsec != null ? Math.round(c.tsec % 60) : ''}" placeholder="opt." inputmode="numeric"></label>
      <label>Strecke (m)<input data-f="cdist" data-k="${b.key}" value="${deNum(c.dist)}" placeholder="opt." inputmode="numeric"></label>
      <label>Schläge<input data-f="cstr" data-k="${b.key}" value="${deNum(c.strokes)}" placeholder="opt." inputmode="numeric"></label>
    </div>
    <p class="hint calc" data-out="row-${b.key}">${esc(rowCalcText(c))}</p>` : '';
  return `${rowFields}<div class="c-row three">
      <label>Ø-Watt<input data-f="cw" data-k="${b.key}" value="${deNum(c.watt)}" placeholder="opt." inputmode="numeric"></label>
      <label>${row ? 'Schläge/min' : 'Ø-rpm'}<input data-f="crpm" data-k="${b.key}" value="${deNum(c.rpm)}" placeholder="opt." inputmode="decimal"></label>
      <label>Stufe<input data-f="clvl" data-k="${b.key}" value="${esc(c.lvl ?? '')}" placeholder="opt." inputmode="decimal"></label>
    </div>
    ${last ? `<p class="hint">Zuletzt ${esc(c.dev)} (${fmtShort(last.date)}): ${esc(parts)}</p>` : ''}`;
}

function cardioHTML(b, s, day) {
  const c = s.cardio[b.key] || { min: b.min, dev: b.dev[0], hr: '', ok: false };
  const devs = b.dev.includes(c.dev) ? b.dev : [...b.dev, c.dev];
  return `<div class="block cardio ${c.ok ? 'ok' : ''}">
    <div class="c-top"><span><b>${esc(b.label)}</b><small>Ziel ${b.min} min</small></span>
      <button class="tick" data-act="cok" data-k="${b.key}" aria-label="${esc(b.label)} erledigt" aria-pressed="${c.ok}">✓</button></div>
    <div class="c-row">
      <label>Minuten<input data-f="cmin" data-k="${b.key}" value="${c.min ?? ''}" inputmode="numeric"></label>
      <label class="grow">Gerät / Aktivität<select data-f="cdev" data-k="${b.key}">${devs.map(d => `<option ${d === c.dev ? 'selected' : ''}>${esc(d)}</option>`).join('')}</select></label>
      <label>Ø-Puls<input data-f="chr" data-k="${b.key}" value="${esc(c.hr)}" placeholder="opt." inputmode="numeric"></label>
    </div>
    ${b.dev.includes('Ergometer') ? powerHTML(b, c, day) : ''}
    ${b.list ? `<details class="more"><summary>${esc(b.listLabel || 'Übungen')}</summary><ul>${b.list.map(x => `<li>${esc(x)}</li>`).join('')}</ul></details>` : ''}
    ${b.hint ? `<p class="hint">${esc(b.hint + (b.z2 && b.dev.includes('Ergometer') ? (DEV_HINT[c.dev] || '') : ''))}</p>` : ''}
  </div>`;
}

function intervalsHTML(b, s) {
  const rows = Array.from({ length: b.n }, (_, i) => {
    const x = s.iv[i] || { hr: '', ok: false };
    return `<div class="set iv ${x.ok ? 'ok' : ''}">
      <span class="n">${i + 1}</span><span class="x">${b.d} min</span>
      <input data-f="ivhr" data-i="${i}" value="${esc(x.hr)}" placeholder="Puls am Ende" inputmode="numeric" aria-label="Puls am Ende von Intervall ${i + 1}">
      <button class="tick" data-act="ivok" data-i="${i}" aria-label="Intervall ${i + 1} erledigt" aria-pressed="${x.ok}">✓</button>
    </div>`;
  }).join('');
  return `<div class="block">
    <div class="ex-top"><b>Intervalle ${b.n} × ${b.d} min zügig-hart</b></div>
    <p class="hint">Puls am Ende jedes Intervalls ${b.hr}/min, nur noch kurze Sätze (7–8 von 10). Dazwischen 3 min locker. Tempo so wählen, dass das letzte Intervall genauso schaffbar ist wie das erste.</p>
    <div class="sets">${rows}</div>
  </div>`;
}

function circuitHTML(s) {
  return `<div class="block">
    <div class="ex-top"><b>Kraftzirkel – 3 Runden</b></div>
    <ol class="plain">${CIRCUIT.map(x => `<li>${esc(x)}</li>`).join('')}</ol>
    <p class="hint">Ohne Pause zwischen den Übungen, 1 min Pause zwischen den Runden.</p>
    <div class="rounds">${[0, 1, 2].map(i => `<button class="round ${s.rounds[i] ? 'on' : ''}" data-act="round" data-i="${i}" aria-pressed="${!!s.rounds[i]}">Runde ${i + 1}</button>`).join('')}</div>
  </div>`;
}

function modeSwitch(day, s) {
  const modes = [['normal', day.kind === 'sunday' ? 'Studio' : 'Normal']];
  if (isKraft(day.kind) || (day.kind === 'sunday' && day.week.iv)) modes.push(['easy', 'Locker (Ampel)']);
  if (isKraft(day.kind)) modes.push(['minimal', 'Minimalprogramm']);
  if (day.kind === 'sunday') modes.push(['homeClaude', 'Zuhause Claude'], ['homeMark', 'Zuhause Mark']); // seit 1.8
  if (modes.length < 2) return '';
  return `<div class="seg" role="group" aria-label="Variante">${modes.map(([m, l]) =>
    `<button data-act="mode" data-mode="${m}" class="${s.mode === m ? 'on' : ''}" aria-pressed="${s.mode === m}">${l}</button>`).join('')}</div>`;
}

function sessionHTML(day) {
  const s = sessionFor(day);
  const t = dayTitle(day, s.mode);
  const blocks = sessionBlocks(day, s);
  const st = statusOf(day.date);
  const effect = effectOf(day.date);
  let h = `<section class="session c-${dayCat(day.kind, s.mode, day.week)}" data-date="${day.date}">
    <div class="sess-head">
      <div><h2>${esc(t.title)}</h2><p class="sub">${esc(t.sub)}${t.dur ? ` · ${esc(t.dur)}` : ''}</p></div>
      ${blocks.length ? `<span class="pill ${st}">${STATUS_ICON[st]} ${STATUS_LABEL[st]}</span>` : ''}
    </div>`;
  if (!blocks.length) return h + '<p class="muted">Kein Training geplant.</p></section>';
  if ((effect === 'easy' || effect === 'rest') && isMain(day.kind)) {
    h += `<div class="banner ${effect === 'rest' ? 'r' : 'y'}">${esc(effectText(day.date))}</div>`;
  }
  h += modeSwitch(day, s);
  const cats = blocks.map((b, i) => blockCat(b.type === 'head' ? (blocks.slice(i + 1).find(x => x.type !== 'head') || b) : b));
  const used = Object.keys(CAT_NAME).filter(c => cats.includes(c));
  if (used.length > 1) h += `<div class="legend">${used.map(c => `<span class="c-${c}"><i></i>${CAT_NAME[c]}</span>`).join('')}</div>`;
  blocks.forEach((b, i) => {
    const c = cats[i];
    if (b.type === 'head') { h += `<h3 class="block-head c-${c}">${esc(b.label)}</h3>${b.hint ? `<p class="hint">${esc(b.hint)}</p>` : ''}`; return; }
    let x = '';
    if (b.type === 'check') x = checkHTML(b, s, day);
    else if (b.type === 'ex') x = exHTML(b, s, day);
    else if (b.type === 'cardio') x = cardioHTML(b, s, day);
    else if (b.type === 'intervals') x = intervalsHTML(b, s);
    else if (b.type === 'circuit') x = circuitHTML(s);
    h += `<div class="tile c-${c}">${x}</div>`;
  });
  h += `<label class="note">Notiz<textarea data-f="note" rows="3" placeholder="z. B. Knie, Befinden, Besonderheiten">${esc(s.note)}</textarea></label>`;
  if (s.status === 'open') {
    h += `<div class="actions"><button class="primary" data-act="finish">Einheit abschließen</button><button class="ghost" data-act="skip">Ausgelassen</button></div>`;
  } else {
    h += `<div class="actions"><p class="muted">${s.status === 'done' ? `Erledigt am ${fmtFull(s.doneOn || day.date)}` : 'Als ausgelassen markiert'}</p><button class="ghost" data-act="reopen">Wieder öffnen</button></div>`;
  }
  return h + '</section>';
}

// ---------- Seiten ----------
function weekBadge(day) {
  if (!day.week) return '';
  return `<span class="badge">${esc(weekLabel(day.week))}</span>${day.week.deload ? '<span class="badge soft">Entlastung</span>' : ''}`;
}

function backupBanner() {
  const st = state.settings;
  const dates = [...Object.keys(state.sessions).filter(d => hasProgress(state.sessions[d])), ...Object.keys(state.checkins), ...state.headaches.map(e => e.date)].sort();
  if (!dates.length) return '';
  const since = daysBetween((st.lastBackup || dates[0]).slice(0, 10), todayISO());
  const newer = !st.lastBackup || (state.changed && state.changed > st.lastBackup);
  if (since < 7 || !newer) return '';
  return `<div class="banner info"><span>${st.lastBackup ? `Letztes Backup vor ${since} Tagen.` : 'Noch kein Backup gemacht.'} Sichere deine Einträge, z. B. in iCloud Drive.</span>
    <button class="primary small" data-act="export-json">Jetzt sichern</button></div>`;
}

function posOptions(selected) {
  return WEEKS.map((w, i) => `<option value="${i}" ${i === selected ? 'selected' : ''}>Phase ${w.phase} · Woche ${w.nr} – ${PHASE_NAMES[w.phase]}${w.deload ? ' (Entlastung)' : ''}</option>`).join('');
}

function setupCard() {
  return `<section class="card">
    <h2>Plan einrichten</h2>
    <p>Lege fest, ab wann die App dir Trainingstage anbietet.</p>
    <label class="field">Starttag<input type="date" id="su-date" value="${todayISO()}"></label>
    <label class="field">Einstieg<select id="su-pos">${posOptions(0)}</select></label>
    <p class="hint">Woche 1 ist die Kalenderwoche (Mo–So) mit dem Starttag; Tage davor bleiben leer. Intervalle (Phase 2) gibt es erst ab der Woche nach der ärztlichen Freigabe – die stellst du unter „Mehr“ ein.</p>
    <button class="primary" data-act="setup">Plan starten</button>
  </section>`;
}

function ampelCard(date) {
  const c = state.checkins[date];
  if (c && !draft) {
    const l = dayLight(date);
    return `<section class="card ampel lit-${l}">
      <div class="ampel-row"><span class="dot ${l}" aria-hidden="true"></span>
        <div><b>Erholungsampel: ${LIGHT_NAME[l]}</b><small>Ruhepuls gestern ${c.rhr ?? '–'} · ${VITAL[c.vital ?? 0]}${(c.feel || []).length ? ' · ' + c.feel.map(f => FEEL.find(x => x[0] === f)[1]).join(', ') : ''}${haOn(date).length ? ` · Kopfschmerz ${haMax(date) ?? '–'}/10` : ''}</small></div>
        <button class="mini" data-act="ampel-edit">Ändern</button></div>
      <p class="hint">${esc(effectText(date))}</p>
    </section>`;
  }
  const d = draft || { rhr: null, vital: 0, feel: [] };
  return `<section class="card ampel lit-none">
    <h2>Erholungsampel</h2>
    <p class="hint">Morgens, vor Kaffee und Training. Ruhepuls: Health → Herz → Ruhepuls → „W“ → Balken von gestern. Dazu die Vitalwerte-App der Watch.</p>
    <label class="field">Ruhepuls gestern<input data-draft="rhr" value="${d.rhr ?? ''}" inputmode="numeric" placeholder="z. B. 66"></label>
    <div class="label">Vitalwerte-App</div>
    <div class="seg">${VITAL.map((v, i) => `<button data-act="vital" data-i="${i}" class="${d.vital === i ? 'on' : ''}" aria-pressed="${d.vital === i}">${v}</button>`).join('')}</div>
    <div class="label">Befinden (falls zutreffend)</div>
    <div class="chips">${FEEL.map(([k, l]) => `<button data-act="feel" data-k="${k}" class="chip ${d.feel.includes(k) ? 'on' : ''}" aria-pressed="${d.feel.includes(k)}">${l}</button>`).join('')}</div>
    <div class="actions"><button class="primary" data-act="ampel-save">Ampel setzen</button>${c ? '<button class="ghost" data-act="ampel-cancel">Abbrechen</button>' : ''}</div>
  </section>`;
}

function openThisWeek(day) {
  const monday = mondayOf(day.date);
  const open = [];
  for (let d = monday; d < day.date; d = addDays(d, 1)) {
    if (d < state.settings.startDate) continue;
    const info = dayInfo(state.settings, d);
    const st = statusOf(d);
    if (isMain(info.kind) && (st === 'open' || st === 'started')) open.push(info);
  }
  if (!open.length) return '';
  return `<section class="card open">
    <div class="label">Noch offen diese Woche</div>
    ${open.map(i => `<button class="row" data-act="open-day" data-d="${i.date}"><span class="kd c-${dayCat(i.kind, 'normal', i.week)}">${fmtDay(i.date)} · ${esc(dayTitle(i).title)}</span><span class="muted">nachholen ›</span></button>`).join('')}
  </section>`;
}

function renderHeute() {
  const date = todayISO();
  const day = dayInfo(state.settings, date);
  let h = `<header class="page-head"><div class="kicker">${fmtLong(date)}</div><h1>Heute</h1><div>${weekBadge(day)}</div></header>`;
  h += backupBanner();
  if (day.kind === 'setup') return h + setupCard();
  h += ampelCard(date);
  h += kopfCard(date);
  if (day.kind === 'pre') {
    const n = daysBetween(date, state.settings.startDate);
    return h + `<section class="card"><h2>Noch ${n} ${n === 1 ? 'Tag' : 'Tage'} bis zum Start</h2><p>Dein Plan beginnt am ${fmtLong(state.settings.startDate)}.</p></section>`;
  }
  h += openThisWeek(day);
  if (effectOf(date) === 'rest' && isMain(day.kind) && !hasProgress(state.sessions[date])) {
    return h + `<div class="banner r">${esc(effectText(date))}</div>
      <details class="card fold"><summary>Geplante Einheit trotzdem anzeigen</summary>${sessionHTML(day)}</details>`;
  }
  return h + sessionHTML(day);
}

function renderTag() {
  const day = dayInfo(state.settings, route.date);
  let h = `<header class="page-head"><button class="back" data-act="back">‹ Zurück</button><div class="kicker">${fmtLong(route.date)}</div><div>${weekBadge(day)}</div></header>`;
  if (day.kind === 'setup' || day.kind === 'pre') return h + '<section class="card"><p>Dieser Tag liegt vor dem Planstart.</p></section>';
  const c = state.checkins[route.date];
  if (c) h += `<div class="ampel-mini"><span class="dot ${dayLight(route.date)}"></span>Ampel ${LIGHT_NAME[dayLight(route.date)]} · Ruhepuls ${c.rhr ?? '–'}</div>`;
  return h + sessionHTML(day);
}

function renderWoche() {
  let h = '<header class="page-head"><h1>Woche</h1></header>';
  const st = state.settings;
  if (!st.startDate) return h + setupCard();
  const monday = addDays(mondayOf(todayISO()), 7 * route.weekOffset);
  const sunday = addDays(monday, 6);
  h += `<div class="weeknav">
      <button class="mini" data-act="week" data-d="-1" aria-label="Vorherige Woche">‹</button>
      <div><b>${fmtShort(monday)} – ${fmtShort(sunday)}</b>${route.weekOffset ? '<button class="link" data-act="week" data-d="0">zu heute</button>' : ''}</div>
      <button class="mini" data-act="week" data-d="1" aria-label="Nächste Woche">›</button></div>`;
  if (sunday < st.startDate) return h + `<section class="card"><p>Vor dem Planstart (${fmtFull(st.startDate)}).</p></section>`;
  const ref = dayInfo(st, monday < st.startDate ? st.startDate : monday);
  const w = ref.week;
  const stats = weekStats(monday);
  const target = weekTarget(w);
  const pct = Math.min(100, Math.round((stats.minutes / target) * 100));
  h += `<section class="card">
    <div class="week-title"><b>${esc(weekLabel(w))}</b></div>
    <ul class="notes">${weekNotes(w).map(n => `<li>${esc(n)}</li>`).join('')}</ul>
    <div class="stat"><span>Ausdauer</span><b>${stats.minutes} / ${target} min</b></div>
    <div class="bar c-aus" role="meter" aria-valuemin="0" aria-valuemax="${target}" aria-valuenow="${stats.minutes}" aria-label="Ausdauerminuten"><span style="width:${pct}%"></span></div>
    <div class="stat"><span>Kraft</span><b>${stats.kraft} / 2 Einheiten</b></div>
    <div class="bar c-kraft" role="meter" aria-valuemin="0" aria-valuemax="2" aria-valuenow="${stats.kraft}" aria-label="Krafteinheiten"><span style="width:${Math.min(100, stats.kraft * 50)}%"></span></div>
    <p class="hint">Ziel ohne den optionalen Freitag; Freitagsminuten zählen mit.</p>
  </section>`;
  h += '<section class="card days">';
  for (let i = 0; i < 7; i++) {
    const d = addDays(monday, i);
    const info = dayInfo(st, d);
    if (info.kind === 'pre') { h += `<div class="row dim"><span>${fmtDay(d)}</span><span class="muted">vor dem Start</span></div>`; continue; }
    const s = state.sessions[d];
    const t = dayTitle(info, s ? s.mode : 'normal');
    const stt = statusOf(d);
    const hasBlocks = blocksFor(info, s ? s.mode : 'normal').length > 0;
    h += `<button class="row c-${dayCat(info.kind, s ? s.mode : 'normal', info.week)} ${d === todayISO() ? 'today' : ''} ${isMain(info.kind) ? '' : 'light'}" data-act="open-day" data-d="${d}">
      <span><small>${fmtDay(d)}</small>${esc(t.title)}</span>
      <span class="st ${stt}">${hasBlocks ? STATUS_ICON[stt] : ''}</span></button>`;
  }
  return h + '</section>';
}

function renderVerlauf() {
  let h = '<header class="page-head"><h1>Verlauf</h1></header>';
  const st = state.settings;
  if (!st.startDate) return h + '<section class="card"><p>Noch kein Plan eingerichtet.</p></section>';
  // Wochen
  const first = mondayOf(st.startDate);
  const rows = [];
  for (let m = mondayOf(todayISO()); m >= first; m = addDays(m, -7)) {
    const w = dayInfo(st, m < st.startDate ? st.startDate : m).week;
    const s = weekStats(m);
    const lights = { g: 0, y: 0, r: 0 };
    for (let i = 0; i < 7; i++) { const l = dayLight(addDays(m, i)); if (l) lights[l]++; }
    rows.push(`<tr><td>${fmtShort(m)}</td><td>${esc(weekLabel(w).replace('Phase ', 'P').replace(' · Woche ', ' W'))}</td>
      <td class="r">${s.minutes}/${weekTarget(w)}</td><td class="r">${s.kraft}/2</td>
      <td class="lights">${lights.g ? `<span class="dot g"></span>${lights.g}` : ''} ${lights.y ? `<span class="dot y"></span>${lights.y}` : ''} ${lights.r ? `<span class="dot r"></span>${lights.r}` : ''}</td></tr>`);
  }
  h += `<section class="card edge c-aus"><h2>Wochen</h2><div class="scroll"><table>
    <thead><tr><th>Woche ab</th><th>Plan</th><th class="r">Ausdauer</th><th class="r">Kraft</th><th>Ampel</th></tr></thead>
    <tbody>${rows.join('')}</tbody></table></div></section>`;
  // Kraftwerte
  const opts = Object.entries(EX).map(([id, e]) => `<option value="${id}" ${id === route.exercise ? 'selected' : ''}>${esc(e.name)}${KRAFT_A.app.includes(id) || KRAFT_A.extra.includes(id) ? ' (A)' : ' (B)'}</option>`).join('');
  const hist = Object.keys(state.sessions).sort().reverse()
    .map(d => ({ d, sets: state.sessions[d].ex?.[route.exercise] }))
    .filter(x => x.sets && x.sets.some(y => y.ok)).slice(0, 20);
  h += `<section class="card edge c-kraft"><h2>Kraftwerte</h2>
    <label class="field"><select data-pick="exercise">${opts}</select></label>
    ${hist.length ? `<table><tbody>${hist.map(x => `<tr><td>${fmtShort(x.d)}</td><td>${esc(setsText(x.sets.filter(y => y.ok)))}</td></tr>`).join('')}</tbody></table>`
      : '<p class="muted">Noch keine erledigten Sätze.</p>'}
  </section>`;
  h += kopfSummaryCard();
  // Ampel
  const cks = Object.keys(state.checkins).sort().reverse().slice(0, 21);
  h += `<section class="card edge c-ok"><h2>Erholungsampel</h2>
    ${cks.length ? `<table><tbody>${cks.map(d => { const c = state.checkins[d], l = dayLight(d); return `<tr><td>${fmtDay(d)}</td><td><span class="dot ${l}"></span>${LIGHT_NAME[l]}</td><td class="r">${c.rhr ?? '–'}/min</td></tr>`; }).join('')}</tbody></table>`
      : '<p class="muted">Noch keine Einträge.</p>'}
  </section>`;
  return h;
}

function renderMehr() {
  const st = state.settings;
  let h = '<header class="page-head"><h1>Mehr</h1></header>';
  h += `<section class="card"><h2>Plan</h2>
    <label class="field">Starttag<input type="date" data-set="startDate" value="${st.startDate || ''}"></label>
    <label class="field">Einstieg<select data-set="startPos">${posOptions(st.startPos || 0)}</select></label>
    <p class="hint">Woche 1 = Kalenderwoche mit dem Starttag. Änderungen verschieben nur den Plan, deine Einträge bleiben erhalten.</p>
  </section>`;
  h += `<section class="card"><h2>Pausen-Timer</h2>
    <label class="field">Satzpause<select data-set="pause">${PAUSES.map(p => `<option value="${p}" ${p === pauseLength() ? 'selected' : ''}>${p ? `${p} Sekunden` : 'Aus'}</option>`).join('')}</select></label>
    <p class="hint">Startet, sobald du einen Satz abhakst; Antippen beendet die Pause. Beim einarmigen Rudern erst nach beiden Seiten. Die letzten 3 Sekunden zählt ein Piepton herunter, am Ende ein langer Ton und 3 Sekunden Blinken – solange die App offen ist. Die Lautstärke regeln die Lautstärketasten. Während der Pause bleibt der Bildschirm an.</p>
  </section>`;
  h += `<section class="card"><h2>Ärztliche Freigabe</h2>
    <label class="switch"><input type="checkbox" data-set="freigabeOn" ${st.freigabe ? 'checked' : ''}><span>Freigabe für Intervalle erhalten</span></label>
    ${st.freigabe ? `<label class="field">Datum der Freigabe<input type="date" data-set="freigabe" value="${st.freigabe}"></label>
      <p class="hint">Intervalle ab der Woche vom ${fmtFull(addDays(mondayOf(st.freigabe), 7))} – frühestens nach Woche 4.</p>`
      : '<p class="hint">Bis dahin läuft Phase 1 weiter: drei Wochen wie Woche 3, dann eine Entlastungswoche. Freigabe = Belastungs-EKG bis zur Ausbelastung.</p>'}
  </section>`;
  h += `<section class="card"><h2>Daten sichern</h2>
    <p class="hint">Deine Einträge liegen nur auf diesem iPhone. ${st.lastBackup ? `Letztes Backup: ${fmtFull(st.lastBackup.slice(0, 10))}.` : 'Noch kein Backup.'}</p>
    <button class="primary wide" data-act="export-json">Backup exportieren (JSON)</button>
    <button class="ghost wide" data-act="export-csv">Tabellen für Excel (CSV)</button>
    <button class="ghost wide" data-act="import">Backup einspielen …</button>
    <input type="file" id="import-file" accept="application/json,.json" hidden>
  </section>`;
  h += `<section class="card rules"><h2>Regeln & Hinweise</h2>
    <details><summary>Tempo und Puls</summary><ul>
      <li><b>Zone 2:</b> ganze Sätze sprechen, ~115–130/min, Anstrengung 3–4 von 10.</li>
      <li><b>Intervalle:</b> Phase 2 145–155/min, Phase 3 150–160/min am Ende des Intervalls, 7–8 von 10.</li>
      <li><b>Kraft:</b> 1–2 Wiederholungen „im Tank“, saubere Technik, Satzpause 60–90 s.</li></ul></details>
    <details><summary>Erholungsampel</summary><ul>
      <li><span class="dot g"></span><b>Grün:</b> Ruhepuls ≤ 70, keine Abweichung, fit → Plan wie vorgesehen.</li>
      <li><span class="dot y"></span><b>Gelb:</b> 71–74, eine Abweichung oder müde/Stress → ein gelber Tag ist normal; zwei in Folge: Intervalle → Zone 2, Kraft 2 Sätze.</li>
      <li><span class="dot r"></span><b>Rot:</b> ≥ 75, mehrere Abweichungen, Infekt, Schmerz → Ruhetag oder Spaziergang.</li>
      <li>Kopfschmerz am selben Tag zählt als Abweichung (Gelb), ab Stärke 7 Rot.</li>
      <li>Das schlechtere Signal zählt. HRV nur als Trend, nicht für die Tagesentscheidung.</li></ul></details>
    <details><summary>Gewichte steigern</summary><ul>
      <li>Alle Sätze am oberen Ende sauber geschafft → nächstes Mal +2,5 kg (Oberkörper) bzw. +5 kg (Beinpresse, Hip Thrust, Beinbeuger), Kurzhanteln eine Stufe.</li>
      <li>Danach wieder am unteren Ende der Wiederholungen beginnen.</li></ul></details>
    <details><summary>Zeitmangel & schlechtes Wetter</summary><ul>
      <li>Priorität: Di · Do · So → Mi → Anhänge Di/Do → Fr. Zuerst den Anhang kürzen, nicht die Kraft.</li>
      <li>Kraft fällt aus → Minimalprogramm (Variante in der Einheit wählen).</li>
      <li>Mittwoch bei Regen: Nordic Walking, hügelig gehen oder Schwimmbad.</li>
      <li>Jogging nur als Lauf-Geh-Wechsel: 6 × (2 min joggen / 2 min gehen); Schmerz höchstens 3 von 10.</li></ul></details>
    <details><summary>Sicherheit</summary><ul>
      <li>Brustschmerz, ungewohnte Atemnot oder Schwindel unter Belastung: sofort abbrechen und ärztlich abklären.</li>
      <li>Intervalle erst nach ärztlicher Freigabe (Belastungs-EKG bis zur Ausbelastung).</li>
      <li>Vorschlag auf Basis deiner Daten, kein ärztlicher Trainingsplan.</li></ul></details>
  </section>
  <p class="foot muted">Version 1.9 · funktioniert offline · keine Daten verlassen das Gerät, außer du exportierst sie.</p>`;
  return h;
}

// ---------- Rendern ----------
function render() {
  renderedDay = todayISO();
  ensureDraft();
  const page = { heute: renderHeute, tag: renderTag, woche: renderWoche, verlauf: renderVerlauf, mehr: renderMehr, kopf: renderKopf, kopfedit: renderKopfEdit }[route.tab];
  view.innerHTML = page();
  const kopfTab = route.kopfBack || 'verlauf';
  const active = { tag: route.back, kopf: kopfTab, kopfedit: route.back === 'kopf' ? kopfTab : route.back }[route.tab] || route.tab;
  for (const b of tabs.querySelectorAll('button')) b.classList.toggle('on', b.dataset.tab === active);
}

function go(tab, extra = {}) {
  route = { ...route, tab, ...extra };
  render();
  window.scrollTo(0, 0);
}

let toastTimer = null;
function toast(msg) {
  let el = document.getElementById('toast');
  if (!el) { el = document.createElement('div'); el.id = 'toast'; el.setAttribute('role', 'status'); document.body.appendChild(el); }
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

// ---------- Pausen-Timer ----------
// Zählt gegen die Uhrzeit, damit die Restzeit nach einem App-Wechsel stimmt.
// Ton gibt es nur bei offener App: iOS hält Web-Apps im Hintergrund an.
const PAUSES = [0, 60, 90, 120];   // 0 = aus
const CUES = [3000, 2000, 1000, 0]; // Töne bei 3, 2, 1 s Restzeit und am Ende
const pauseLength = () => state.settings.pause ?? 90;
let pause = null;                  // { key, end, total, done, cues, out }
let pauseTick = null, pauseHide = null, audio = null, wakeLock = null;

// Was nach der Pause kommt; null = keine Pause (Seitenwechsel oder alles geschafft)
function nextUp(s, day, id, i) {
  const pair = EX[id].pair;
  if (pair && s.ex[pair] && s.ex[pair][i] && !s.ex[pair][i].ok) return null;
  for (const k of [pair, id].filter(Boolean)) {
    const j = (s.ex[k] || []).findIndex(x => !x.ok);
    if (j >= 0) return `Als Nächstes: ${EX[k].name}, Satz ${j + 1}`;
  }
  const ids = sessionBlocks(day, s).filter(b => b.type === 'ex').map(b => b.id);
  const pos = ids.indexOf(id);
  const next = [...ids.slice(pos + 1), ...ids.slice(0, pos)].find(k => (s.ex[k] || []).some(x => !x.ok));
  return next ? `Als Nächstes: ${EX[next].name}` : null;
}

// iOS gibt Ton nur frei, wenn er bei einem Tipp vorbereitet wurde. War der Bildschirm
// zwischendurch aus, hält iOS den alten Audio-Kontext an – dann bei jedem Tipp neu anlegen.
function unlockAudio() {
  try {
    // Als Wiedergabe angemeldet: Ton auch bei stummgeschaltetem iPhone, mit Medienlautstärke
    if (navigator.audioSession) navigator.audioSession.type = 'playback';
    if (audio && audio.state !== 'running') { audio.close?.().catch(() => {}); audio = null; }
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    if (audio.state !== 'running') audio.resume();
    const b = audio.createBufferSource();   // stiller Puffer schaltet den Ton sicher frei
    b.buffer = audio.createBuffer(1, 1, 22050);
    b.connect(audio.destination);
    b.start(0);
  } catch (e) { audio = null; }
}

// Nach der Pause den Ton wieder abgeben, damit die App andere Wiedergaben nicht blockiert
function releaseAudio() {
  setTimeout(() => { if (audio && audio.state === 'running' && (!pause || pause.done)) audio.suspend(); }, 1500);
}

// Kräftiger Piepton als Rechteckwelle; at = Startzeit auf der Audio-Uhr
function tone(at, freq, len) {
  if (!audio || !pause?.out) return;
  const o = audio.createOscillator(), g = audio.createGain();
  o.type = 'square';
  o.frequency.value = freq;
  g.gain.setValueAtTime(0, at);
  g.gain.linearRampToValueAtTime(0.9, at + 0.005);
  g.gain.setValueAtTime(0.9, at + len - 0.02);
  g.gain.linearRampToValueAtTime(0, at + len);
  o.connect(g).connect(pause.out);
  o.start(at);
  o.stop(at + len + 0.01);
}

// Plant fällige Töne punktgenau ein; verpasste (App war im Hintergrund) entfallen
function scheduleCues(left) {
  if (!audio || !pause.out) return;
  if (audio.state !== 'running') audio.resume();
  for (const m of CUES) {
    if (pause.cues.has(m) || left > m + 400) continue;
    pause.cues.add(m);
    if (left < m - 150) continue;
    const at = audio.currentTime + Math.max(0, left - m) / 1000;
    if (m) tone(at, 1320, 0.15); else tone(at, 1760, 0.7);
  }
}

function flashScreen() {
  let el = document.getElementById('flash');
  if (!el) {
    el = document.createElement('div');
    el.id = 'flash';
    el.addEventListener('animationend', () => el.classList.remove('on'));
    document.body.appendChild(el);
  }
  el.classList.remove('on');
  void el.offsetWidth;   // Animation neu starten
  el.classList.add('on');
}

async function keepAwake(on) {
  try {
    if (on && !wakeLock && navigator.wakeLock) {
      const lock = await navigator.wakeLock.request('screen');
      if (!pause || pause.done) { lock.release(); return; }
      wakeLock = lock;
      lock.addEventListener('release', () => { if (wakeLock === lock) wakeLock = null; });
    } else if (!on && wakeLock) {
      const lock = wakeLock;
      wakeLock = null;
      await lock.release();
    }
  } catch (e) { /* nicht unterstützt oder abgelehnt */ }
}

function pauseBar() {
  let el = document.getElementById('pause');
  if (!el) {
    el = document.createElement('button');
    el.id = 'pause';
    el.type = 'button';
    el.addEventListener('click', stopPause);
    document.body.appendChild(el);
  }
  return el;
}

function startPause(key, label) {
  const total = pauseLength();
  if (!total) return;
  clearInterval(pauseTick);
  clearTimeout(pauseHide);
  pause?.out?.disconnect();
  pause = { key, end: Date.now() + total * 1000, total, done: false, cues: new Set(), out: null };
  if (audio) { pause.out = audio.createGain(); pause.out.connect(audio.destination); }
  const el = pauseBar();
  el.classList.remove('done');
  el.innerHTML = `<span class="p-fill"></span><span class="p-label">Pause · ${esc(label)}</span><b class="p-time"></b><span class="p-stop">Stopp</span>`;
  el.setAttribute('aria-label', `Pause läuft, ${label}. Antippen beendet die Pause.`);
  el.classList.add('show');
  document.body.classList.add('pausing');
  keepAwake(true);
  pauseTick = setInterval(updatePause, 250);
  updatePause();
}

function updatePause() {
  if (!pause || pause.done) return;
  const left = Math.max(0, pause.end - Date.now());
  scheduleCues(left);
  if (left === 0) {
    // Erst lange nach dem Ende zurück in der App: kein verspäteter Alarm mehr
    if (Date.now() - pause.end > 60000) stopPause(); else finishPause();
    return;
  }
  const sec = Math.ceil(left / 1000), el = pauseBar();
  el.querySelector('.p-time').textContent = `${Math.floor(sec / 60)}:${pad2(sec % 60)}`;
  el.querySelector('.p-fill').style.transform = `scaleX(${left / (pause.total * 1000)})`;
}

function finishPause() {
  pause.done = true;
  clearInterval(pauseTick);
  keepAwake(false);
  flashScreen();
  releaseAudio();
  const el = pauseBar();
  el.classList.add('done');
  el.querySelector('.p-label').textContent = 'Pause vorbei';
  el.querySelector('.p-time').textContent = 'Weiter!';
  el.querySelector('.p-stop').textContent = 'OK';
  el.setAttribute('aria-label', 'Pause vorbei. Antippen schließt den Hinweis.');
  pauseHide = setTimeout(stopPause, 8000);
}

function stopPause() {
  clearInterval(pauseTick);
  clearTimeout(pauseHide);
  pause?.out?.disconnect();
  pause = null;
  keepAwake(false);
  releaseAudio();
  document.getElementById('flash')?.classList.remove('on');
  document.getElementById('pause')?.classList.remove('show', 'done');
  document.body.classList.remove('pausing');
}

// ---------- Export / Import ----------
async function shareFiles(files) {
  if (navigator.canShare && navigator.canShare({ files })) {
    try { await navigator.share({ files }); return true; }
    catch (e) { if (e.name === 'AbortError') return false; }
  }
  for (const f of files) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(f);
    a.download = f.name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }
  return true;
}

async function exportJSON() {
  const file = new File([JSON.stringify(state, null, 1)], `vo2max-backup-${todayISO()}.json`, { type: 'application/json' });
  if (await shareFiles([file])) {
    state.settings.lastBackup = new Date().toISOString();
    save();
    render();
    toast('Backup erstellt');
  }
}

const CARDIO_NAME = { anhang: 'Zone 2 Anhang', mi: 'Zone 2 draußen', fr: 'Freitag optional', so: 'Sonntag Studio', gehen: 'Zügig gehen' };

function csvFile(name, header, rows) {
  const cell = v => { const s = String(v ?? ''); return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const text = '﻿' + [header, ...rows].map(r => r.map(cell).join(';')).join('\r\n');
  return new File([text], name, { type: 'text/csv' });
}

function exportCSV() {
  const kraft = [], ausdauer = [], einheiten = [], ampel = [];
  for (const d of Object.keys(state.sessions).sort()) {
    const s = state.sessions[d];
    if (!hasProgress(s)) continue;
    const info = dayInfo(state.settings, d);
    const title = info.week ? dayTitle(info, s.mode).title : s.kind;
    einheiten.push([fmtFull(d), title, info.week ? weekLabel(info.week) : '', STATUS_LABEL[statusOf(d)], s.mode, s.doneOn ? fmtFull(s.doneOn) : '', deNum(s.stand?.l), deNum(s.stand?.r), deNum(s.sit), s.note]);
    for (const [id, sets] of Object.entries(s.ex)) {
      sets.forEach((x, i) => kraft.push([fmtFull(d), title, EX[id].name, i + 1, x.r ?? '', deNum(x.kg || 0), x.ok ? 'ja' : 'nein']));
    }
    for (const [k, c] of Object.entries(s.cardio)) { const r = rowCalc(c); ausdauer.push([fmtFull(d), title, k === 'so' && isHome(s.mode) ? 'Sonntag zuhause' : (CARDIO_NAME[k] || k), c.min ?? '', c.dev, c.hr, deNum(c.watt), deNum(c.rpm), c.ok ? 'ja' : 'nein', c.lvl ?? '', fmtMMSS(c.tsec), deNum(c.dist), deNum(c.strokes), r ? fmtMMSS(r.split) : '']); }
    s.iv.forEach((x, i) => ausdauer.push([fmtFull(d), title, `Intervall ${i + 1}`, '', '', x.hr, '', '', x.ok ? 'ja' : 'nein']));
  }
  for (const d of Object.keys(state.checkins).sort()) {
    const c = state.checkins[d];
    ampel.push([fmtFull(d), c.rhr ?? '', VITAL[c.vital ?? 0], (c.feel || []).map(f => FEEL.find(x => x[0] === f)[1]).join(', '), LIGHT_NAME[dayLight(d)]]);
  }
  const t = todayISO();
  shareFiles([
    csvFile(`vo2max-einheiten-${t}.csv`, ['Datum', 'Einheit', 'Planwoche', 'Status', 'Variante', 'Erledigt am', 'Einbeinstand links (s)', 'Einbeinstand rechts (s)', 'Aufstehtest 30 s (Wdh.)', 'Notiz'], einheiten),
    csvFile(`vo2max-kraft-${t}.csv`, ['Datum', 'Einheit', 'Übung', 'Satz', 'Wdh', 'kg', 'erledigt'], kraft),
    csvFile(`vo2max-ausdauer-${t}.csv`, ['Datum', 'Einheit', 'Block', 'Minuten', 'Gerät', 'Puls', 'Watt', 'rpm / Schläge pro min', 'erledigt', 'Stufe', 'Zeit Gerät (min:s)', 'Strecke (m)', 'Schläge', 'Ø /500 m'], ausdauer),
    csvFile(`vo2max-ampel-${t}.csv`, ['Datum', 'Ruhepuls Vortag', 'Vitalwerte', 'Befinden', 'Ampel'], ampel),
    haCSV(t),
  ]);
}

async function importJSON(file) {
  try {
    const s = JSON.parse(await file.text());
    if (!s || s.version !== 1 || !s.settings || !s.sessions || !s.checkins) throw new Error('format');
    s.headaches = s.headaches || [];
    const n = Object.keys(s.sessions).length;
    if (!confirm(`Backup mit ${n} Einheiten und ${s.headaches.length} Kopfschmerz-Einträgen einspielen? Die aktuellen Daten auf diesem Gerät werden ersetzt.`)) return;
    state = s;
    save();
    render();
    toast('Backup eingespielt');
  } catch (e) {
    toast('Die Datei ist kein gültiges Backup.');
  }
}

// ---------- Ereignisse ----------
tabs.addEventListener('click', e => {
  const b = e.target.closest('[data-tab]');
  if (b) go(b.dataset.tab, b.dataset.tab === 'woche' ? { weekOffset: 0 } : {});
});

view.addEventListener('click', e => {
  const t = e.target.closest('[data-act]');
  if (!t) return;
  const act = t.dataset.act;
  const date = t.closest('[data-date]')?.dataset.date;
  const id = t.closest('[data-ex]')?.dataset.ex;
  const i = Number(t.dataset.i);

  // Aktionen innerhalb einer Einheit
  if (date && ['check', 'setok', 'cok', 'ivok', 'round', 'suggest', 'addset', 'delset', 'mode', 'finish', 'skip', 'reopen'].includes(act)) {
    const s = ensureSession(date);
    const day = dayInfo(state.settings, date);
    switch (act) {
      case 'check': s.checks[t.dataset.k] = !s.checks[t.dataset.k]; break;
      case 'setok': {
        const set = s.ex[id][i], key = `${date}|${id}|${i}`;
        set.ok = !set.ok;
        if (set.ok) {
          unlockAudio();
          const label = nextUp(s, day, id, i);
          if (label) startPause(key, label);
        } else if (pause && pause.key === key) stopPause();
        break;
      }
      case 'cok': s.cardio[t.dataset.k].ok = !s.cardio[t.dataset.k].ok; break;
      case 'ivok': s.iv[i].ok = !s.iv[i].ok; break;
      case 'round': s.rounds[i] = !s.rounds[i]; break;
      case 'suggest': s.ex[id].forEach(x => { x.kg = Number(t.dataset.kg); }); break;
      case 'addset': {
        const sets = s.ex[id], prev = sets[sets.length - 1], reps = EX[id].reps;
        sets.push({ r: reps[sets.length] ?? reps[reps.length - 1], kg: prev ? prev.kg : EX[id].kg, ok: false });
        break;
      }
      case 'delset': if (s.ex[id].length > 1) s.ex[id].pop(); break;
      case 'mode': {
        const mode = t.dataset.mode;
        if (mode === s.mode) return;
        if (hasProgress(s) && !confirm('Variante wechseln? Die Eingaben dieser Einheit werden zurückgesetzt (die Notiz bleibt).')) return;
        const note = s.note;
        state.sessions[date] = newSession(day, mode);
        state.sessions[date].note = note;
        break;
      }
      case 'finish': s.status = 'done'; s.doneOn = todayISO(); toast('Einheit gespeichert'); break;
      case 'skip': s.status = 'skipped'; s.doneOn = null; break;
      case 'reopen': s.status = 'open'; s.doneOn = null; break;
    }
    save();
    render();
    return;
  }

  switch (act) {
    case 'setup': {
      const d = document.getElementById('su-date').value;
      if (!d) { toast('Bitte einen Starttag wählen.'); return; }
      state.settings.startDate = d;
      state.settings.startPos = Number(document.getElementById('su-pos').value);
      save();
      render();
      break;
    }
    case 'vital': draft.vital = i; render(); break;
    case 'feel': {
      const k = t.dataset.k;
      draft.feel = draft.feel.includes(k) ? draft.feel.filter(x => x !== k) : [...draft.feel, k];
      render();
      break;
    }
    case 'ampel-save':
      state.checkins[todayISO()] = { rhr: draft.rhr, vital: draft.vital, feel: draft.feel };
      draft = null;
      save();
      render();
      break;
    case 'ampel-edit': {
      const c = state.checkins[todayISO()];
      draft = { rhr: c.rhr, vital: c.vital ?? 0, feel: [...(c.feel || [])] };
      render();
      break;
    }
    case 'ampel-cancel': draft = null; render(); break;
    case 'open-day': go('tag', { date: t.dataset.d, back: route.tab === 'tag' ? route.back : route.tab }); break;
    case 'back': go(route.back); break;
    case 'week': route.weekOffset = t.dataset.d === '0' ? 0 : route.weekOffset + Number(t.dataset.d); render(); break;
    case 'ha-new': go('kopfedit', { hid: newHeadache().id, back: route.tab }); break;
    case 'ha-open': go('kopfedit', { hid: t.dataset.id, back: route.tab }); break;
    case 'ha-list': go('kopf', { kopfBack: route.tab }); break;
    case 'ha-back': go(route.kopfBack || 'verlauf'); break;
    case 'ha-done': go(route.back); break;
    case 'ha-del':
      if (!confirm('Diesen Kopfschmerz-Eintrag löschen?')) return;
      state.headaches = state.headaches.filter(x => x.id !== route.hid);
      save();
      go(route.back);
      break;
    case 'ha-set': case 'ha-tog': case 'ha-med-add': case 'ha-med-del': case 'ha-med-eff': editHeadache(act, t); break;
    case 'ha-report': shareReport(); break;
    case 'ha-csv': shareFiles([haCSV(todayISO())]); break;
    case 'export-json': exportJSON(); break;
    case 'export-csv': exportCSV(); break;
    case 'import': document.getElementById('import-file').click(); break;
  }
});

// Rudergerät: berechnete Werte in Watt- und Schlagzahl-Feld übernehmen, ohne neu zu zeichnen (Fokus bleibt) – seit 1.6
function rowUpdate(c, k, el) {
  const box = el.closest('.cardio');
  const r = rowCalc(c);
  if (r) {
    c.watt = r.watt;
    if (r.spm != null) c.rpm = r.spm;
    const w = box?.querySelector('[data-f="cw"]'), p = box?.querySelector('[data-f="crpm"]');
    if (w) w.value = deNum(c.watt);
    if (p && r.spm != null) p.value = deNum(c.rpm);
  }
  const out = box?.querySelector(`[data-out="row-${k}"]`);
  if (out) out.textContent = rowCalcText(c);
}

function onField(e) {
  const t = e.target;
  if (t.dataset.h || t.dataset.hm) {
    const h = haById(route.hid);
    if (!h) return;
    const v = t.value;
    if (t.dataset.hm) h.meds[Number(t.dataset.i)][t.dataset.hm] = v;
    else if (t.dataset.h === 'date') { if (v) h.date = v; }
    else if (['alc', 'coffee', 'sleep'].includes(t.dataset.h)) h[t.dataset.h] = num(v);
    else h[t.dataset.h] = v;
    save();
    return;
  }
  if (t.dataset.f) {
    const date = t.closest('[data-date]').dataset.date;
    const s = ensureSession(date);
    const id = t.closest('[data-ex]')?.dataset.ex;
    const i = Number(t.dataset.i), k = t.dataset.k, v = t.value;
    switch (t.dataset.f) {
      case 'r': s.ex[id][i].r = num(v); break;
      case 'kg': s.ex[id][i].kg = num(v) ?? 0; break;
      case 'cmin': s.cardio[k].min = num(v); break;
      case 'cdev': s.cardio[k].dev = v; break;
      case 'chr': s.cardio[k].hr = v.trim(); break;
      case 'cw': s.cardio[k].watt = num(v); break;
      case 'crpm': s.cardio[k].rpm = num(v); break;
      case 'clvl': s.cardio[k].lvl = v.trim(); break;
      case 'ctm':
      case 'cts': { // Zeit in zwei Zahlenfeldern (iPhone-Zahlentastatur hat keinen Doppelpunkt) – seit 1.6.1
        const box = t.closest('.cardio');
        const m = num(box.querySelector('[data-f="ctm"]').value), sec = num(box.querySelector('[data-f="cts"]').value);
        s.cardio[k].tsec = m == null && sec == null ? null : Math.round((m || 0) * 60 + (sec || 0));
        rowUpdate(s.cardio[k], k, t); break;
      }
      case 'cdist': s.cardio[k].dist = num(v); rowUpdate(s.cardio[k], k, t); break;
      case 'cstr': s.cardio[k].strokes = num(v); rowUpdate(s.cardio[k], k, t); break;
      case 'standl': s.stand = s.stand || {}; s.stand.l = num(v); break;
      case 'standr': s.stand = s.stand || {}; s.stand.r = num(v); break;
      case 'sit': s.sit = num(v); break;
      case 'ivhr': s.iv[i].hr = v.trim(); break;
      case 'note': s.note = v; break;
    }
    save();
    if (t.dataset.f === 'cdev' && e.type === 'change') render();
    return;
  }
  if (t.dataset.draft === 'rhr') {
    draft = draft || { rhr: null, vital: 0, feel: [] };
    draft.rhr = num(t.value);
    return;
  }
  if (t.dataset.pick === 'exercise' && e.type === 'change') { route.exercise = t.value; render(); return; }
  if (t.dataset.set && e.type === 'change') {
    const st = state.settings;
    switch (t.dataset.set) {
      case 'startDate': if (t.value) st.startDate = t.value; break;
      case 'startPos': st.startPos = Number(t.value); break;
      case 'freigabeOn': st.freigabe = t.checked ? todayISO() : null; break;
      case 'freigabe': if (t.value) st.freigabe = t.value; break;
      case 'pause': st.pause = Number(t.value); if (!st.pause) stopPause(); break;
    }
    save();
    render();
    return;
  }
  if (t.id === 'import-file' && e.type === 'change' && t.files[0]) importJSON(t.files[0]);
}
view.addEventListener('input', onField);
view.addEventListener('change', onField);

// Ampel-Entwurf anlegen, sobald die Eingabe sichtbar ist
function ensureDraft() {
  if (!draft && route.tab === 'heute' && state.settings.startDate && !state.checkins[todayISO()]) draft = { rhr: null, vital: 0, feel: [] };
}

// Tageswechsel, während die App im Hintergrund lag
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && renderedDay !== todayISO()) { draft = null; ensureDraft(); render(); }
  // Das System gibt die Bildschirmsperre im Hintergrund frei
  if (!document.hidden && pause && !pause.done) { keepAwake(true); updatePause(); }
});

// ---------- Start ----------
render();

if ('serviceWorker' in navigator) {
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register('sw.js').catch(() => {});
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadController) location.reload(); });
}
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
