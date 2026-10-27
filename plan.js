'use strict';
// Trainingsplan „VO₂max“ (Trainingsbewertung vom 27.09.2026) – Inhalte und Wochenlogik.
// Wochen laufen Mo–So. Phase 2 beginnt frühestens in der Woche nach der ärztlichen Freigabe;
// bis dahin wiederholt sich Phase 1 (drei Wochen wie Woche 3, dann eine Entlastungswoche).

// ---------- Datumshilfen (lokale Zeit, Format JJJJ-MM-TT) ----------
const pad2 = n => String(n).padStart(2, '0');
const isoDate = d => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const parseDate = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (s, n) => { const d = parseDate(s); d.setDate(d.getDate() + n); return isoDate(d); };
const weekday = s => (parseDate(s).getDay() + 6) % 7; // 0 = Montag
const mondayOf = s => addDays(s, -weekday(s));
const daysBetween = (a, b) => Math.round((parseDate(b) - parseDate(a)) / 86400000);
const todayISO = () => isoDate(new Date());

// ---------- Übungen ----------
// reps: Ziel-Wiederholungen je Satz (bei Spannen die Obergrenze), kg: Startgewicht,
// step: Steigerung in kg (0 = keine), bw: Körpergewicht (kg = Zusatzgewicht)
const EX = {
  latzug_a:      { name: 'Latzug', reps: [12, 10, 8], kg: 55, step: 2.5, hint: 'Zur oberen Brust ziehen, Schulterblätter nach hinten-unten.' },
  beinpresse:    { name: 'Beinpresse', reps: [12, 10, 8], kg: 80, step: 5, hint: 'Füße schulterbreit, eher hoch auf der Platte (knieschonend). Knie oben nicht ganz durchstrecken, Tiefe schmerzfrei.' },
  rudermaschine: { name: 'Rudermaschine', reps: [12, 10, 8], kg: 55, step: 2.5, hint: 'Aufrecht sitzen, Ellbogen eng am Körper.' },
  brustpresse_a: { name: 'Brustpresse', reps: [12, 10, 8], kg: 37.5, step: 2.5, hint: 'Kontrolliert zurück, Schultern unten.' },
  beinbeuger_a:  { name: 'Beinbeuger', reps: [10, 10, 10], kg: 50, step: 5, hint: 'Langsam ablassen (3 s).' },
  hyperext:      { name: 'Hyperextensions', reps: [20, 20, 20], range: '15–20', kg: 0, step: 0, bw: true, hint: 'Nur bis zur Körperlinie hochkommen, nicht überstrecken.' },
  hipthrust:     { name: 'Hip Thrust', extra: true, reps: [12, 12, 12], range: '10–12', kg: 60, step: 5, hint: 'Oben 1 s halten, Gesäß anspannen, kein Hohlkreuz.' },
  waden:         { name: 'Waden heben', extra: true, reps: [15, 15], kg: 0, step: 0, bw: true, hint: 'Langsam, 3 s ablassen – stärkt Fuß und Achillessehne. Nur schmerzfrei.' },

  latzug_b:      { name: 'Latzug', reps: [12, 10, 8], kg: 50, step: 2.5, hint: 'Etwas leichter als am Dienstag, dafür sauber bis zur Brust.' },
  goblet:        { name: 'Goblet Squats', reps: [12, 10, 8], kg: 12, step: 2, hint: 'Mit Kurzhantel, Ziel 16 kg × 12. Auf eine Bank setzen, falls das Knie meckert.' },
  rudern_l:      { name: 'Einarmiges Rudern links', reps: [12, 10, 8], kg: 20, step: 2, pair: 'rudern_r', hint: 'Rücken gerade, Hantel zur Hüfte ziehen.' },
  rudern_r:      { name: 'Einarmiges Rudern rechts', reps: [12, 10, 8], kg: 20, step: 2, pair: 'rudern_l', hint: 'Rücken gerade, Hantel zur Hüfte ziehen.' },
  brustpresse_b: { name: 'Brustpresse', reps: [12, 10, 8], kg: 35, step: 2.5, hint: 'Kontrolliert zurück, Schultern unten.' },
  beinbeuger_b:  { name: 'Beinbeuger', reps: [12, 10, 10], kg: 50, step: 5, hint: 'Langsam ablassen (3 s).' },
  bulgarian:     { name: 'Bulgarian Split Squats', extra: true, reps: [10, 10], range: '8–10 je Bein', kg: 0, step: 0, bw: true, hint: 'Kurze Schrittstellung, Hand an einer Stange. Tiefe nach Kniegefühl – zugleich Balance-Training.' },
  seitheben:     { name: 'Seitheben', extra: true, reps: [15, 15], range: '12–15', kg: 5, step: 1, hint: 'Nur bis Schulterhöhe.' },
  beineheben:    { name: 'Beine heben / Crunch', extra: true, reps: [12, 12], kg: 0, step: 0, bw: true, hint: 'Rücken bleibt am Boden bzw. an der Lehne.' },
};

const KRAFT_A = { app: ['latzug_a', 'beinpresse', 'rudermaschine', 'brustpresse_a', 'beinbeuger_a', 'hyperext'], extra: ['hipthrust', 'waden'] };
const KRAFT_B = { app: ['latzug_b', 'goblet', 'rudern_l', 'rudern_r', 'brustpresse_b', 'beinbeuger_b'], extra: ['bulgarian', 'seitheben', 'beineheben'] };

const DEV_STUDIO = ['Ergometer', 'Rudergerät', 'Crosstrainer'];
const DEV_OUT = ['Rad outdoor', 'Gehen outdoor', 'Schwimmen', 'Nordic Walking', 'Lauf-Geh-Wechsel'];

const BALANCE = [
  'Einbeinstand 3 × 30 s je Bein (Steigerung: Augen zu, Kopf langsam drehen, weiche Matte)',
  'Tandemgang 2 × 10 Schritte vor- und rückwärts (Ferse direkt vor die Zehen)',
  'Ausfallschritt rückwärts langsam 2 × 6 je Bein, 2 s Pause unten',
];
const CIRCUIT = [
  'Kniebeuge zum Stuhl – 12',
  'Liegestütz an Tisch oder Bank – 10',
  'Rudern mit Band oder Handtuch – 12',
  'Ausfallschritt rückwärts – 8 je Bein',
  'Unterarmstütz – 30 s',
];

// ---------- Wochen ----------
// anhang: Zone 2 nach Kraft Di/Do · mi: Mittwoch draußen · so: Sonntag Zone 2 · iv: [Anzahl, Minuten]
const PHASE_NAMES = { 1: 'Grundlage', 2: 'Intervalle einführen', 3: 'Aufbau' };
const WEEKS = [
  { phase: 1, nr: 1, anhang: 15, mi: 30, so: 35, sets: 2 },
  { phase: 1, nr: 2, anhang: 15, mi: 35, so: 40, sets: 3 },
  { phase: 1, nr: 3, anhang: 20, mi: 45, so: 50, sets: 3 },
  { phase: 1, nr: 4, anhang: 10, mi: 30, so: 35, sets: 2, deload: true },
  { phase: 2, nr: 5, anhang: 20, mi: 45, iv: [4, 2], sets: 3 },
  { phase: 2, nr: 6, anhang: 20, mi: 45, iv: [4, 3], sets: 3 },
  { phase: 2, nr: 7, anhang: 20, mi: 45, iv: [4, 3], sets: 3 },
  { phase: 2, nr: 8, anhang: 15, mi: 30, so: 35, sets: 2, deload: true },
  { phase: 3, nr: 9, anhang: 20, mi: 45, iv: [4, 4], sets: 3 },
  { phase: 3, nr: 10, anhang: 20, mi: 50, iv: [4, 4], sets: 3 },
  { phase: 3, nr: 11, anhang: 20, mi: 50, iv: [4, 4], sets: 3 },
  { phase: 3, nr: 12, anhang: 15, mi: 35, so: 35, sets: 2, deload: true },
];
const IV_HR = { 2: '145–155', 3: '150–160' };

const ivMinutes = w => 10 + w.iv[0] * w.iv[1] + (w.iv[0] - 1) * 3 + 5;
const sundayMinutes = w => (w.iv ? ivMinutes(w) : w.so);
const weekTarget = w => 2 * w.anhang + w.mi + sundayMinutes(w);

// Plan-Woche für den Kalenderwochen-Index ab der Startwoche (0 = Woche mit dem Starttag)
function weekAt(settings, index) {
  const startMonday = mondayOf(settings.startDate);
  const cleared = monday => !!settings.freigabe && mondayOf(settings.freigabe) < monday;
  let pos = settings.startPos || 0, waitCount = 0, week = null;
  for (let k = 0; k <= index; k++) {
    const monday = addDays(startMonday, 7 * k);
    if (pos < 4) week = { ...WEEKS[pos++] };
    else if (!cleared(monday)) week = { ...WEEKS[waitCount++ % 4 === 3 ? 3 : 2], waiting: true };
    else if (pos < 12) week = { ...WEEKS[pos++] };
    else week = { ...WEEKS[8 + ((pos++ - 12) % 4)], repeat: true };
    week.monday = monday;
  }
  return week;
}

const DAY_KINDS = ['walk', 'krafta', 'z2out', 'kraftb', 'opt', 'free', 'sunday'];

function dayInfo(settings, date) {
  if (!settings.startDate) return { kind: 'setup', date };
  if (date < settings.startDate) return { kind: 'pre', date };
  const index = Math.floor(daysBetween(mondayOf(settings.startDate), date) / 7);
  return { kind: DAY_KINDS[weekday(date)], date, index, week: weekAt(settings, index) };
}

function weekLabel(w) {
  if (w.waiting) return w.deload ? 'Phase 1 · Entlastung' : 'Phase 1 · fortsetzen';
  return `Phase ${w.phase} · Woche ${w.nr}${w.repeat ? ' (Wiederholung)' : ''}`;
}
function weekNotes(w) {
  const notes = [w.waiting ? 'Ärztliche Freigabe ausstehend – noch keine Intervalle' : PHASE_NAMES[w.phase]];
  if (w.deload) notes.push('Entlastung: Ausdauer −30 %, Kraft nur 2 Sätze mit gleichen Gewichten');
  else if (w.sets === 2) notes.push('Kraft mit 2 Sätzen je Übung');
  if (w.repeat) notes.push('12-Wochen-Plan abgeschlossen – Phase 3 läuft weiter');
  return notes;
}

const isKraft = kind => kind === 'krafta' || kind === 'kraftb';
const isMain = kind => isKraft(kind) || kind === 'z2out' || kind === 'sunday';

function dayTitle(day, mode = 'normal') {
  const w = day.week;
  switch (day.kind) {
    case 'walk':   return { title: 'Frei', sub: 'Alltag: nach dem Essen 10–15 min gehen' };
    case 'krafta': return mode === 'minimal'
      ? { title: 'Minimalprogramm', sub: 'Kraftzirkel ohne Geräte statt Kraft A', dur: '20–40 min' }
      : { title: 'Kraft A + Zone 2', sub: 'Studio · App „Ganzkörper mit Beinpresse“', dur: '~80 min' };
    case 'z2out':  return { title: 'Zone 2 draußen', sub: 'Rad, zügig gehen mit Steigungen oder Schwimmbad', dur: `${w.mi} min` };
    case 'kraftb': return mode === 'minimal'
      ? { title: 'Minimalprogramm', sub: 'Kraftzirkel ohne Geräte statt Kraft B', dur: '20–40 min' }
      : { title: 'Kraft B + Zone 2', sub: 'Studio · App „Ganzkörper mit Goblet Squats“', dur: '~80 min' };
    case 'opt':    return { title: 'Frei – optional locker', sub: '30–45 min draußen, kein Muss' };
    case 'free':   return { title: 'Frei', sub: 'Wochenplanung & Einkauf – Ruhetag vor dem Sonntag' };
    case 'sunday': return w.iv && mode !== 'easy'
      ? { title: `Studio · Intervalle ${w.iv[0]} × ${w.iv[1]} min`, sub: 'Ergometer, Rudergerät oder Crosstrainer + Balance + Yoga', dur: `~${sundayMinutes(w) + 15} min` }
      : { title: 'Studio · Zone 2', sub: 'Ergometer, Rudergerät oder Crosstrainer + Balance + Yoga', dur: `~${sundayMinutes(w) + 15} min` };
  }
  return { title: '', sub: '' };
}

function kraftHint(w) {
  if (w.deload) return 'Entlastung: nur 2 Sätze, gleiche Gewichte · Satzpause 60–90 s.';
  if (w.phase === 1) return 'Satzpause 60–90 s · 1–2 Wdh. „im Tank“ · Anstrengung 7–8 von 10.';
  return 'Satzpause 60–90 s · Doppelte Progression: alle Sätze am oberen Ende sauber geschafft → nächstes Mal mehr Gewicht. 1–2 Wdh. „im Tank“.';
}

// Ablauf einer Einheit als Liste von Bausteinen
function blocksFor(day, mode = 'normal') {
  const w = day.week;
  const sets = mode === 'easy' ? 2 : w.sets;
  const strength = ids => ids.map(id => ({ type: 'ex', id, sets: Math.min(EX[id].reps.length, sets) }));
  const balance = { type: 'check', key: 'balance', label: 'Balance-Block', detail: '5 min', list: BALANCE };
  const minimal = [
    { type: 'circuit' },
    { type: 'cardio', key: 'gehen', label: 'Zügig gehen (wenn Zeit)', min: 20, dev: ['Gehen outdoor', ...DEV_OUT.filter(d => d !== 'Gehen outdoor')], hint: 'Ersetzt den Ausdauer-Anhang der ausgefallenen Studioeinheit.' },
  ];
  switch (day.kind) {
    case 'walk':
      return [{ type: 'check', key: 'walk', label: 'Nach dem Essen gehen', detail: '10–15 min' }];
    case 'krafta':
    case 'kraftb': {
      if (mode === 'minimal') return minimal;
      const a = day.kind === 'krafta';
      const k = a ? KRAFT_A : KRAFT_B;
      return [
        { type: 'check', key: 'warmup', label: 'Aufwärmen', detail: a ? '8 min Ergometer locker' : '8 min Rudergerät oder Crosstrainer locker' },
        balance,
        { type: 'head', label: a ? 'Kraft A · App-Vorlage' : 'Kraft B · App-Vorlage', hint: kraftHint(w) },
        ...strength(k.app),
        { type: 'head', label: 'Zusatzübungen', hint: 'Im Anschluss an die App-Einheit. Bei Zeitmangel zuerst hier kürzen.' },
        ...strength(k.extra),
        { type: 'cardio', key: 'anhang', label: 'Zone 2 · Ausdauer-Anhang', min: w.anhang,
          dev: a ? DEV_STUDIO : ['Rudergerät', 'Crosstrainer', 'Ergometer'],
          hint: 'Bewusst locker: Puls ~115–130, ganze Sätze sprechen. Erst Kraft, dann Ausdauer.' },
      ];
    }
    case 'z2out':
      return [{ type: 'cardio', key: 'mi', label: 'Zone 2 draußen', min: w.mi, dev: DEV_OUT,
        hint: 'Erst 5 min ganz locker. Puls ~115–130. Auf der Watch als „Outdoor“-Training aufzeichnen – nur das liefert VO₂max-Schätzungen. Schlechtes Wetter: Nordic Walking, hügelig gehen oder Schwimmbad.' }];
    case 'opt':
      return [{ type: 'cardio', key: 'fr', label: 'Optional: Zone 2 draußen', min: 30, dev: DEV_OUT,
        hint: 'Nur wenn Kopf und Zeit es hergeben – Puffer für Ausgefallenes, kein Pflichtprogramm.' }];
    case 'free':
      return [];
    case 'sunday': {
      const yoga = { type: 'check', key: 'yoga', label: 'Yoga / Mobility', detail: '10 min · Hüfte, Rücken, Schultern' };
      if (w.iv && mode !== 'easy') {
        return [
          { type: 'intervals', n: w.iv[0], d: w.iv[1], hr: IV_HR[w.phase] },
          { type: 'cardio', key: 'so', label: 'Ausdauer gesamt', min: ivMinutes(w), dev: DEV_STUDIO,
            hint: `10 min einrollen · ${w.iv[0]} × ${w.iv[1]} min zügig-hart mit je 3 min locker · 5–10 min ausrollen.` },
          balance, yoga,
        ];
      }
      return [
        { type: 'cardio', key: 'so', label: 'Zone 2 · Studio', min: sundayMinutes(w), dev: DEV_STUDIO,
          hint: 'Erste 5 min ganz locker, dann gleichmäßig ~115–130. Geräte gern abwechseln.' },
        balance, yoga,
      ];
    }
  }
  return [];
}
