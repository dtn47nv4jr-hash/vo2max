'use strict';
// VO₂max Training – Oberfläche, Speicherung (nur auf diesem Gerät), Export und Import.

const STORE_KEY = 'vo2max-training';
const view = document.getElementById('view');
const tabs = document.getElementById('tabs');

// ---------- Speicher ----------
const blankState = () => ({
  version: 1,
  settings: { startDate: null, startPos: 0, freigabe: null, lastBackup: null },
  checkins: {},  // Datum → { rhr, vital: 0|1|2, feel: [] }
  sessions: {},  // geplanter Tag → Einheit
  changed: null,
});

function loadState() {
  try {
    const s = JSON.parse(localStorage.getItem(STORE_KEY));
    if (s && s.version === 1) return s;
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
  const t = lightOf(state.checkins[date]);
  if (!t) return null;
  if (t === 'r') return 'rest';
  if (t === 'y') return ['y', 'r'].includes(lightOf(state.checkins[addDays(date, -1)])) ? 'easy' : 'watch';
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

// ---------- Einheiten ----------
function lastSets(id, before) {
  const dates = Object.keys(state.sessions).filter(d => d < before).sort().reverse();
  for (const d of dates) {
    const sets = state.sessions[d].ex?.[id];
    if (sets && sets.some(x => x.ok)) return { date: d, sets };
  }
  return null;
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
    || s.iv.some(x => x.ok) || s.rounds.some(Boolean);
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
const STATUS_LABEL = { open: 'Offen', started: 'Begonnen', done: 'Erledigt', skipped: 'Ausgelassen' };
const STATUS_ICON = { open: '○', started: '◐', done: '✓', skipped: '–' };

function checkHTML(b, s) {
  const on = !!s.checks[b.key];
  return `<div class="block">
    <button class="check ${on ? 'on' : ''}" data-act="check" data-k="${b.key}" aria-pressed="${on}">
      <span class="box" aria-hidden="true"></span><span><b>${esc(b.label)}</b><small>${esc(b.detail || '')}</small></span>
    </button>
    ${b.list ? `<details class="more"><summary>Übungen</summary><ul>${b.list.map(x => `<li>${esc(x)}</li>`).join('')}</ul></details>` : ''}
  </div>`;
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

function cardioHTML(b, s) {
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
    ${b.hint ? `<p class="hint">${esc(b.hint)}</p>` : ''}
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
  const modes = [['normal', 'Normal']];
  if (isKraft(day.kind) || (day.kind === 'sunday' && day.week.iv)) modes.push(['easy', 'Locker (Ampel)']);
  if (isKraft(day.kind)) modes.push(['minimal', 'Minimalprogramm']);
  if (modes.length < 2) return '';
  return `<div class="seg" role="group" aria-label="Variante">${modes.map(([m, l]) =>
    `<button data-act="mode" data-mode="${m}" class="${s.mode === m ? 'on' : ''}" aria-pressed="${s.mode === m}">${l}</button>`).join('')}</div>`;
}

function sessionHTML(day) {
  const s = sessionFor(day);
  const t = dayTitle(day, s.mode);
  const blocks = blocksFor(day, s.mode);
  const st = statusOf(day.date);
  const effect = effectOf(day.date);
  let h = `<section class="session" data-date="${day.date}">
    <div class="sess-head">
      <div><h2>${esc(t.title)}</h2><p class="sub">${esc(t.sub)}${t.dur ? ` · ${esc(t.dur)}` : ''}</p></div>
      ${blocks.length ? `<span class="pill ${st}">${STATUS_ICON[st]} ${STATUS_LABEL[st]}</span>` : ''}
    </div>`;
  if (!blocks.length) return h + '<p class="muted">Kein Training geplant.</p></section>';
  if ((effect === 'easy' || effect === 'rest') && isMain(day.kind)) {
    h += `<div class="banner ${effect === 'rest' ? 'r' : 'y'}">${esc(effectText(day.date))}</div>`;
  }
  h += modeSwitch(day, s);
  for (const b of blocks) {
    if (b.type === 'check') h += checkHTML(b, s);
    else if (b.type === 'head') h += `<h3 class="block-head">${esc(b.label)}</h3>${b.hint ? `<p class="hint">${esc(b.hint)}</p>` : ''}`;
    else if (b.type === 'ex') h += exHTML(b, s, day);
    else if (b.type === 'cardio') h += cardioHTML(b, s);
    else if (b.type === 'intervals') h += intervalsHTML(b, s);
    else if (b.type === 'circuit') h += circuitHTML(s);
  }
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
  const dates = [...Object.keys(state.sessions).filter(d => hasProgress(state.sessions[d])), ...Object.keys(state.checkins)].sort();
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
    const l = lightOf(c);
    return `<section class="card ampel">
      <div class="ampel-row"><span class="dot ${l}" aria-hidden="true"></span>
        <div><b>Erholungsampel: ${LIGHT_NAME[l]}</b><small>Ruhepuls gestern ${c.rhr ?? '–'} · ${VITAL[c.vital ?? 0]}${(c.feel || []).length ? ' · ' + c.feel.map(f => FEEL.find(x => x[0] === f)[1]).join(', ') : ''}</small></div>
        <button class="mini" data-act="ampel-edit">Ändern</button></div>
      <p class="hint">${esc(effectText(date))}</p>
    </section>`;
  }
  const d = draft || { rhr: null, vital: 0, feel: [] };
  return `<section class="card ampel">
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
  return `<section class="card">
    <div class="label">Noch offen diese Woche</div>
    ${open.map(i => `<button class="row" data-act="open-day" data-d="${i.date}"><span>${fmtDay(i.date)} · ${esc(dayTitle(i).title)}</span><span class="muted">nachholen ›</span></button>`).join('')}
  </section>`;
}

function renderHeute() {
  const date = todayISO();
  const day = dayInfo(state.settings, date);
  let h = `<header class="page-head"><div class="kicker">${fmtLong(date)}</div><h1>Heute</h1><div>${weekBadge(day)}</div></header>`;
  h += backupBanner();
  if (day.kind === 'setup') return h + setupCard();
  h += ampelCard(date);
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
  if (c) h += `<div class="ampel-mini"><span class="dot ${lightOf(c)}"></span>Ampel ${LIGHT_NAME[lightOf(c)]} · Ruhepuls ${c.rhr ?? '–'}</div>`;
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
    <div class="bar" role="meter" aria-valuemin="0" aria-valuemax="${target}" aria-valuenow="${stats.minutes}" aria-label="Ausdauerminuten"><span style="width:${pct}%"></span></div>
    <div class="stat"><span>Kraft</span><b>${stats.kraft} / 2 Einheiten</b></div>
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
    h += `<button class="row ${d === todayISO() ? 'today' : ''} ${isMain(info.kind) ? '' : 'light'}" data-act="open-day" data-d="${d}">
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
    for (let i = 0; i < 7; i++) { const l = lightOf(state.checkins[addDays(m, i)]); if (l) lights[l]++; }
    rows.push(`<tr><td>${fmtShort(m)}</td><td>${esc(weekLabel(w).replace('Phase ', 'P').replace(' · Woche ', ' W'))}</td>
      <td class="r">${s.minutes}/${weekTarget(w)}</td><td class="r">${s.kraft}/2</td>
      <td class="lights">${lights.g ? `<span class="dot g"></span>${lights.g}` : ''} ${lights.y ? `<span class="dot y"></span>${lights.y}` : ''} ${lights.r ? `<span class="dot r"></span>${lights.r}` : ''}</td></tr>`);
  }
  h += `<section class="card"><h2>Wochen</h2><div class="scroll"><table>
    <thead><tr><th>Woche ab</th><th>Plan</th><th class="r">Ausdauer</th><th class="r">Kraft</th><th>Ampel</th></tr></thead>
    <tbody>${rows.join('')}</tbody></table></div></section>`;
  // Kraftwerte
  const opts = Object.entries(EX).map(([id, e]) => `<option value="${id}" ${id === route.exercise ? 'selected' : ''}>${esc(e.name)}${KRAFT_A.app.includes(id) || KRAFT_A.extra.includes(id) ? ' (A)' : ' (B)'}</option>`).join('');
  const hist = Object.keys(state.sessions).sort().reverse()
    .map(d => ({ d, sets: state.sessions[d].ex?.[route.exercise] }))
    .filter(x => x.sets && x.sets.some(y => y.ok)).slice(0, 20);
  h += `<section class="card"><h2>Kraftwerte</h2>
    <label class="field"><select data-pick="exercise">${opts}</select></label>
    ${hist.length ? `<table><tbody>${hist.map(x => `<tr><td>${fmtShort(x.d)}</td><td>${esc(setsText(x.sets.filter(y => y.ok)))}</td></tr>`).join('')}</tbody></table>`
      : '<p class="muted">Noch keine erledigten Sätze.</p>'}
  </section>`;
  // Ampel
  const cks = Object.keys(state.checkins).sort().reverse().slice(0, 21);
  h += `<section class="card"><h2>Erholungsampel</h2>
    ${cks.length ? `<table><tbody>${cks.map(d => { const c = state.checkins[d], l = lightOf(c); return `<tr><td>${fmtDay(d)}</td><td><span class="dot ${l}"></span>${LIGHT_NAME[l]}</td><td class="r">${c.rhr ?? '–'}/min</td></tr>`; }).join('')}</tbody></table>`
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
  <p class="foot muted">Version 1.0 · funktioniert offline · keine Daten verlassen das Gerät, außer du exportierst sie.</p>`;
  return h;
}

// ---------- Rendern ----------
function render() {
  renderedDay = todayISO();
  ensureDraft();
  const page = { heute: renderHeute, tag: renderTag, woche: renderWoche, verlauf: renderVerlauf, mehr: renderMehr }[route.tab];
  view.innerHTML = page();
  const active = route.tab === 'tag' ? route.back : route.tab;
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
    einheiten.push([fmtFull(d), title, info.week ? weekLabel(info.week) : '', STATUS_LABEL[statusOf(d)], s.mode, s.doneOn ? fmtFull(s.doneOn) : '', s.note]);
    for (const [id, sets] of Object.entries(s.ex)) {
      sets.forEach((x, i) => kraft.push([fmtFull(d), title, EX[id].name, i + 1, x.r ?? '', deNum(x.kg || 0), x.ok ? 'ja' : 'nein']));
    }
    for (const [k, c] of Object.entries(s.cardio)) ausdauer.push([fmtFull(d), title, CARDIO_NAME[k] || k, c.min ?? '', c.dev, c.hr, c.ok ? 'ja' : 'nein']);
    s.iv.forEach((x, i) => ausdauer.push([fmtFull(d), title, `Intervall ${i + 1}`, '', '', x.hr, x.ok ? 'ja' : 'nein']));
  }
  for (const d of Object.keys(state.checkins).sort()) {
    const c = state.checkins[d];
    ampel.push([fmtFull(d), c.rhr ?? '', VITAL[c.vital ?? 0], (c.feel || []).map(f => FEEL.find(x => x[0] === f)[1]).join(', '), LIGHT_NAME[lightOf(c)]]);
  }
  const t = todayISO();
  shareFiles([
    csvFile(`vo2max-einheiten-${t}.csv`, ['Datum', 'Einheit', 'Planwoche', 'Status', 'Variante', 'Erledigt am', 'Notiz'], einheiten),
    csvFile(`vo2max-kraft-${t}.csv`, ['Datum', 'Einheit', 'Übung', 'Satz', 'Wdh', 'kg', 'erledigt'], kraft),
    csvFile(`vo2max-ausdauer-${t}.csv`, ['Datum', 'Einheit', 'Block', 'Minuten', 'Gerät', 'Puls', 'erledigt'], ausdauer),
    csvFile(`vo2max-ampel-${t}.csv`, ['Datum', 'Ruhepuls Vortag', 'Vitalwerte', 'Befinden', 'Ampel'], ampel),
  ]);
}

async function importJSON(file) {
  try {
    const s = JSON.parse(await file.text());
    if (!s || s.version !== 1 || !s.settings || !s.sessions || !s.checkins) throw new Error('format');
    const n = Object.keys(s.sessions).length;
    if (!confirm(`Backup mit ${n} Einheiten einspielen? Die aktuellen Daten auf diesem Gerät werden ersetzt.`)) return;
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
      case 'setok': s.ex[id][i].ok = !s.ex[id][i].ok; break;
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
    case 'export-json': exportJSON(); break;
    case 'export-csv': exportCSV(); break;
    case 'import': document.getElementById('import-file').click(); break;
  }
});

function onField(e) {
  const t = e.target;
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
      case 'ivhr': s.iv[i].hr = v.trim(); break;
      case 'note': s.note = v; break;
    }
    save();
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
});

// ---------- Start ----------
render();

if ('serviceWorker' in navigator) {
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register('sw.js').catch(() => {});
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadController) location.reload(); });
}
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
