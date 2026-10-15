'use strict';

/* ==========================================================
   Adventskalender – Hauptprogramm
   ----------------------------------------------------------
   1. Hilfsfunktionen   Elemente, Zufall, Klang, Sprache, Ziehen
   2. Speicher          Fortschritt im Browser merken
   3. Datum             Welche Türchen dürfen heute auf?
   4. Kalender          Türchen über das Hintergrundbild verteilen
   5. Bühne             Ein Türchen öffnen, Erfolg anzeigen
   6. Spieltypen        Was hinter einem Türchen passiert
   7. Lehrpersonen      PIN, Freischalten, Datum simulieren
   8. Start
   ========================================================== */


// ==========================================================
// 1. Hilfsfunktionen
// ==========================================================
const $ = (id) => document.getElementById(id);

function element(tag, klasse, text) {
  const el = document.createElement(tag);
  if (klasse) el.className = klasse;
  if (text !== undefined && text !== null) el.textContent = text;
  return el;
}

function knopf(text, beimTippen, klasse = 'knopf') {
  const k = element('button', klasse, text);
  k.type = 'button';
  k.addEventListener('click', beimTippen);
  return k;
}

// Liste zufällig mischen (Kopie)
function mischen(liste) {
  const a = liste.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Zufall mit festem Startwert: gleiche Zahl ergibt immer gleiche Folge
function zufall(startwert) {
  let s = startwert >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function bewegungReduziert() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function wackeln(el) {
  el.classList.remove('wackeln');
  void el.offsetWidth; // Animation neu starten
  el.classList.add('wackeln');
}

// Liegt der Punkt (x, y) auf dem Element? Mit etwas Toleranz für ungenaues Ziehen.
function trifft(el, x, y, toleranz = 28) {
  const r = el.getBoundingClientRect();
  return x >= r.left - toleranz && x <= r.right + toleranz && y >= r.top - toleranz && y <= r.bottom + toleranz;
}


// ---------- Klang (Web Audio, ohne Sounddateien) ----------
let audio = null;
function audioKontext() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  if (!audio) audio = new AC();
  if (audio.state === 'suspended') audio.resume();
  return audio;
}

function ton(frequenz, start = 0, dauer = 0.4, lautstaerke = 0.15, art = 'sine') {
  const ctx = audioKontext();
  if (!ctx) return;
  const t = ctx.currentTime + start;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = art;
  osc.frequency.value = frequenz;
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(lautstaerke, t + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dauer);
  osc.connect(gain).connect(ctx.destination);
  osc.start(t);
  osc.stop(t + dauer + 0.05);
}

const klang = {
  tipp:   () => ton(880, 0, 0.15, 0.07, 'triangle'),
  sanft:  () => ton(330, 0, 0.3, 0.06),                       // statt eines "Falsch"-Tons
  erfolg: () => [523, 659, 784, 1047].forEach((f, i) => ton(f, i * 0.12, 0.7, 0.12, 'triangle')),
  glocke: (f) => { ton(f, 0, 1.8, 0.2); ton(f * 2.76, 0, 0.9, 0.05); },
  zahl:   (n) => ton(440 * Math.pow(2, (n * 2) / 12), 0, 0.35, 0.1, 'triangle')
};


// ---------- Sprache (Vorlesen) ----------
function sprich(text) {
  if (!text || !('speechSynthesis' in window)) return;
  speechSynthesis.cancel();
  const satz = new SpeechSynthesisUtterance(text);
  satz.lang = 'de-DE';
  satz.rate = 0.85;
  const stimme = speechSynthesis.getVoices().find((v) => v.lang.startsWith('de'));
  if (stimme) satz.voice = stimme;
  speechSynthesis.speak(satz);
}

function sprechenStoppen() {
  if ('speechSynthesis' in window) speechSynthesis.cancel();
}

const LAUTSPRECHER_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9H4z"/><path d="M16.5 8.5a5 5 0 0 1 0 7"/><path d="M19 6a8.5 8.5 0 0 1 0 12"/></svg>';

function lautsprecherKnopf(text, beimTippen, klasse = 'knopf knopf-leise') {
  const k = element('button', klasse);
  k.type = 'button';
  k.innerHTML = LAUTSPRECHER_SVG;
  k.append(element('span', '', text));
  k.addEventListener('click', beimTippen);
  return k;
}

const ZAHLWORT = ['null', 'eins', 'zwei', 'drei', 'vier', 'fünf', 'sechs', 'sieben', 'acht', 'neun', 'zehn'];


// ---------- Ziehen (Drag and Drop) mit Antipp-Alternative ----------
// Kinder mit motorischen Schwierigkeiten können auch zuerst das Teil und dann das Ziel antippen.
function ziehbar(el, { loslassen, antippen }) {
  el.classList.add('ziehbar');
  el.addEventListener('pointerdown', (e) => {
    if (el.classList.contains('platziert')) return;
    e.preventDefault();
    el.setPointerCapture(e.pointerId);
    const startX = e.clientX;
    const startY = e.clientY;
    let bewegt = false;
    el.style.transition = 'none';

    const bewegen = (ev) => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      if (!bewegt && Math.hypot(dx, dy) < 8) return;
      bewegt = true;
      el.classList.add('zieht');
      el.style.transform = `translate(${dx}px, ${dy}px) scale(1.12)`;
    };
    const ende = (ev) => {
      el.removeEventListener('pointermove', bewegen);
      el.removeEventListener('pointerup', ende);
      el.removeEventListener('pointercancel', ende);
      el.classList.remove('zieht');
      if (!bewegt) {
        el.style.transform = '';
        if (antippen) antippen(el);
        return;
      }
      const angenommen = ev.type === 'pointerup' && loslassen(el, ev.clientX, ev.clientY);
      if (!angenommen) {
        el.style.transition = 'transform .35s ease';
        el.style.transform = '';
      }
    };
    el.addEventListener('pointermove', bewegen);
    el.addEventListener('pointerup', ende);
    el.addEventListener('pointercancel', ende);
  });
}


// ==========================================================
// 2. Speicher
// ==========================================================
const SPEICHER_KEY = 'adventskalender-v1';

function speicherLesen() {
  try { return JSON.parse(localStorage.getItem(SPEICHER_KEY)) || {}; }
  catch (e) { return {}; }
}

function speicherSchreiben() {
  try { localStorage.setItem(SPEICHER_KEY, JSON.stringify(zustand)); }
  catch (e) { /* ohne Speicher läuft der Kalender trotzdem, merkt sich aber nichts */ }
}

const zustand = Object.assign({ offen: [], alleFrei: false, simDatum: null }, speicherLesen());
let inhalt = null; // aus content.json


// ==========================================================
// 3. Datum
// ==========================================================
function heute() {
  if (zustand.simDatum) return new Date(zustand.simDatum + 'T12:00:00');
  return new Date();
}
function adventsJahr(d) { return d.getMonth() === 0 ? d.getFullYear() - 1 : d.getFullYear(); }
function datumVonTag(tag) { return new Date(adventsJahr(heute()), 11, tag); } // Monat 11 = Dezember
function istFrei(tag) { return zustand.alleFrei || heute() >= datumVonTag(tag); }
function istHeute(tag) { const h = heute(); return h.getMonth() === 11 && h.getDate() === tag; }
function datumText(d) { return d.toLocaleDateString('de-CH', { day: 'numeric', month: 'long' }); }

function untertitelText() {
  const h = heute();
  if (h.getMonth() === 11 && h.getDate() <= 24) return `Heute ist der ${datumText(h)}. Türchen ${h.getDate()} wartet auf euch.`;
  if (h.getMonth() === 11 || h.getMonth() === 0) return 'Alle Türchen sind offen. Frohe Festtage!';
  const start = new Date(h.getFullYear(), 11, 1);
  const tage = Math.round((start - new Date(h.getFullYear(), h.getMonth(), h.getDate())) / 86400000);
  return `Noch ${tage} ${tage === 1 ? 'Tag' : 'Tage'} bis zum ersten Türchen.`;
}


// ==========================================================
// 4. Kalender
// ==========================================================
// Feste, gemischte Reihenfolge wie bei einem Papierkalender
const GEMISCHT = [7, 15, 2, 20, 11, 4, 23, 9, 17, 1, 13, 6, 19, 10, 24, 3, 16, 8, 21, 12, 5, 18, 14, 22];
const FARBEN = ['papier', 'salbei', 'rose', 'eis'];

function tuerDaten(tag) {
  return inhalt.tueren.find((t) => t.tag === tag) || { tag, typ: 'leer' };
}

function reihenfolge() {
  return inhalt.anordnung === 'geordnet' ? GEMISCHT.slice().sort((a, b) => a - b) : GEMISCHT;
}

function kalenderZeichnen() {
  const kalender = $('kalender');
  kalender.innerHTML = '';

  reihenfolge().forEach((tag, i) => {
    const t = tuerDaten(tag);
    const offen = zustand.offen.includes(tag);
    const frei = istFrei(tag);

    const k = document.createElement('button');
    k.type = 'button';
    k.className = 'tuer';
    if (offen) k.classList.add('ist-offen');
    if (istHeute(tag)) k.classList.add('ist-heute');
    k.dataset.tag = tag;
    k.style.setProperty('--farbe', `var(--tuer-${FARBEN[(tag * 7 + i) % 4]})`);
    k.setAttribute('aria-label', `Türchen ${tag}` + (offen ? ', schon offen' : frei ? '' : ', noch geschlossen'));

    const innen = element('span', 'tuer-innen');
    if (t.symbol) innen.append(element('span', 'tuer-symbol', t.symbol));
    else if (t.bild) innen.innerHTML = `<img src="${t.bild}" alt="">`;
    innen.append(element('span', 'mini-zahl', tag));

    const blatt = element('span', 'tuer-blatt');
    blatt.append(element('span', 'zahl', tag));

    k.append(innen, blatt);
    if (istHeute(tag)) k.append(element('span', 'heute-marke', 'heute'));

    k.addEventListener('click', () => tuerAntippen(tag, k));
    kalender.append(k);
  });

  tuerenPlatzieren();
}

// Verteilt die Türchen locker über das Bild: Raster mit zufälligem Versatz.
// Querformat 6 × 4, Hochformat 4 × 6. Der Versatz ist pro Türchen fest.
function tuerenPlatzieren() {
  const kalender = $('kalender');
  const breite = kalender.clientWidth;
  const hoehe = kalender.clientHeight;
  if (!breite || !hoehe) return;

  const quer = breite >= hoehe;
  const spalten = quer ? 6 : 4;
  const zeilen = quer ? 4 : 6;
  const zelleB = breite / spalten;
  const zelleH = hoehe / zeilen;

  [...kalender.children].forEach((k, platz) => {
    const tag = Number(k.dataset.tag);
    const rnd = zufall(tag * 97 + 13);
    const anteil = tag === 24 ? 0.82 : 0.6 + rnd() * 0.12;
    const groesse = Math.min(zelleB, zelleH) * anteil;
    const spalte = platz % spalten;
    const zeile = Math.floor(platz / spalten);
    const freiB = zelleB - groesse;
    const freiH = zelleH - groesse;
    const x = spalte * zelleB + freiB / 2 + (rnd() - 0.5) * freiB * 0.85;
    const y = zeile * zelleH + freiH / 2 + (rnd() - 0.5) * freiH * 0.85;
    k.style.left = x + 'px';
    k.style.top = y + 'px';
    k.style.setProperty('--groesse', groesse + 'px');
  });
}

let animationLaeuft = false;

function tuerAntippen(tag, k) {
  if (animationLaeuft) return;
  audioKontext(); // Ton freischalten (iPad erlaubt Ton erst nach einem Tippen)

  if (!istFrei(tag)) {
    wackeln(k);
    meldung(`Türchen ${tag} ist am ${datumText(datumVonTag(tag))} dran.`);
    return;
  }

  letzterKnopf = k;
  if (zustand.offen.includes(tag)) { buehneOeffnen(tag); return; }

  zustand.offen.push(tag);
  speicherSchreiben();

  animationLaeuft = true;
  k.classList.add('oeffnet');
  setTimeout(() => {
    k.classList.remove('oeffnet');
    k.classList.add('ist-offen');
    k.setAttribute('aria-label', `Türchen ${tag}, schon offen`);
    animationLaeuft = false;
    buehneOeffnen(tag);
  }, bewegungReduziert() ? 50 : 900);
}


// ==========================================================
// 5. Bühne
// ==========================================================
let letzterKnopf = null;
let aktuellerTag = null;
let spielNummer = 0;     // zählt hoch bei jedem Öffnen; alte Zeitgeber prüfen damit, ob sie noch gelten
let aufraeumen = [];      // Funktionen, die beim Schliessen laufen (Zeitgeber, Animationen)

function spielLaeuft(nummer) { return nummer === spielNummer && !$('buehne').hidden; }

function spielAufraeumen() {
  aufraeumen.forEach((f) => { try { f(); } catch (e) { /* egal */ } });
  aufraeumen = [];
  sprechenStoppen();
  document.querySelectorAll('.geschafft').forEach((el) => el.remove());
  $('buehne-inhalt').innerHTML = ''; // stoppt auch Videos
}

function buehneOeffnen(tag) {
  spielAufraeumen();
  spielNummer++;
  aktuellerTag = tag;

  const t = tuerDaten(tag);
  $('buehne-tag').textContent = `${tag}. Dezember`;

  const ziel = $('buehne-inhalt');
  if (t.aufgabe) {
    const zeile = element('div', 'aufgabe');
    zeile.append(element('p', 'aufgabe-text', t.aufgabe));
    zeile.append(lautsprecherKnopf('Vorlesen', () => sprich(t.aufgabe), 'knopf knopf-leise knopf-klein'));
    ziel.append(zeile);
  }
  const feld = element('div', 'spielfeld');
  ziel.append(feld);

  $('buehne').hidden = false;
  document.body.classList.add('buehne-offen');

  const spieltyp = spieltypen[t.typ] || spieltypen.unbekannt;
  spieltyp(feld, t, spielNummer);
  $('zurueck').focus();
}

function buehneSchliessen() {
  spielAufraeumen();
  spielNummer++;
  $('buehne').hidden = true;
  document.body.classList.remove('buehne-offen');
  if (letzterKnopf) letzterKnopf.focus();
}

// Gemeinsamer Abschluss für alle Spiele: Sterne, Klang, Lob, "Nochmal"
function geschafft(text, nummer) {
  if (nummer !== undefined && !spielLaeuft(nummer)) return;
  klang.erfolg();
  sprich(text);

  const panel = element('div', 'geschafft');
  const sterne = element('div', 'sterne');
  sterne.setAttribute('aria-hidden', 'true');
  for (let i = 0; i < 9; i++) {
    const s = element('span', 'funke', '⭐');
    s.style.setProperty('--winkel', `${i * 40}deg`);
    sterne.append(s);
  }
  sterne.append(element('span', 'stern-gross', '⭐'));
  panel.append(sterne);
  panel.append(element('p', 'geschafft-text', text || 'Super gemacht!'));

  const reihe = element('div', 'zeile zentriert');
  reihe.append(knopf('Nochmal', () => buehneOeffnen(aktuellerTag), 'knopf knopf-leise'));
  reihe.append(knopf('Zum Kalender', buehneSchliessen));
  panel.append(reihe);

  $('buehne').append(panel);
}


// ==========================================================
// 6. Spieltypen
// ==========================================================
// Jeder Spieltyp ist eine Funktion (feld, tuer, nummer).
// "feld" ist der leere Spielbereich, "tuer" der Eintrag aus content.json,
// "nummer" erlaubt Zeitgebern zu prüfen, ob das Spiel noch offen ist.

const spieltypen = {

  // ---------- Bild mit Text ----------
  bild(feld, t) {
    const rahmen = element('div', 'bild-rahmen');
    if (t.bild) { const img = new Image(); img.src = t.bild; img.alt = t.text || ''; rahmen.append(img); }
    feld.append(rahmen);
    if (t.text) {
      feld.append(element('p', 'bild-text', t.text));
      feld.append(lautsprecherKnopf('Vorlesen', () => sprich(t.text)));
    }
  },

  // ---------- Video ----------
  video(feld, t) {
    const huelle = element('div', 'video-huelle');
    const v = document.createElement('video');
    v.src = t.video;
    v.playsInline = true;           // auf dem iPad nicht automatisch Vollbild
    v.setAttribute('playsinline', '');
    v.preload = 'metadata';
    v.controls = false;
    const start = element('button', 'video-start');
    start.type = 'button';
    start.setAttribute('aria-label', 'Video abspielen');
    start.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z" fill="currentColor"/></svg>';
    start.addEventListener('click', () => { v.play(); start.hidden = true; });
    v.addEventListener('click', () => { if (!v.paused) { v.pause(); start.hidden = false; } });
    v.addEventListener('ended', () => { start.hidden = false; v.currentTime = 0; });
    huelle.append(v, start);
    feld.append(huelle);
  },

  // ---------- Ursache-Wirkung: Schnee zaubern ----------
  schneezauber(feld, t, nummer) {
    const himmel = element('div', 'himmel');
    const decke = element('div', 'schneedecke');
    himmel.append(decke);
    feld.append(himmel);
    let tipps = 0;
    const ziel = t.tipps || 12;
    let fertig = false;

    himmel.addEventListener('pointerdown', (e) => {
      const r = himmel.getBoundingClientRect();
      const x = e.clientX - r.left;
      const y = e.clientY - r.top;
      for (let i = 0; i < 6; i++) {
        const f = element('span', 'flocke-fall', '❄️');
        f.style.left = x + (Math.random() - 0.5) * 120 + 'px';
        f.style.top = y + (Math.random() - 0.5) * 40 + 'px';
        f.style.setProperty('--weg', (r.height - y + 40) + 'px');
        f.style.setProperty('--seite', (Math.random() - 0.5) * 80 + 'px');
        f.style.animationDuration = (2.2 + Math.random() * 1.5) + 's';
        f.addEventListener('animationend', () => f.remove());
        himmel.append(f);
      }
      ton(660 + Math.random() * 440, 0, 0.5, 0.06, 'sine');
      if (fertig) return;
      tipps++;
      decke.style.height = Math.min(8 + tipps * 2.2, 36) + '%';
      if (tipps >= ziel) {
        fertig = true;
        const mann = element('span', 'schneemann-auftritt', '⛄');
        himmel.append(mann);
        setTimeout(() => geschafft(t.schluss, nummer), 1400);
      }
    });
  },

  // ---------- Ursache-Wirkung: Kerzen anzünden ----------
  kerzen(feld, t, nummer) {
    const n = t.anzahl || 4;
    const kranz = element('div', 'kranz');
    kranz.append(element('div', 'kranz-ring'));
    let an = 0;
    for (let i = 0; i < n; i++) {
      const k = element('button', 'kerze');
      k.type = 'button';
      k.setAttribute('aria-label', `Kerze ${i + 1}`);
      k.style.setProperty('--x', `${((i + 1) / (n + 1)) * 100}%`);
      k.style.setProperty('--hoch', `${i % 2 ? 6 : 0}%`);
      k.append(element('span', 'flamme'), element('span', 'docht'), element('span', 'kerzen-koerper'));
      k.addEventListener('click', () => {
        if (k.classList.contains('an')) return;
        k.classList.add('an');
        k.setAttribute('aria-label', `Kerze ${i + 1}, brennt`);
        ton(523 * Math.pow(2, (i * 4) / 12), 0, 1, 0.12, 'sine');
        an++;
        if (an === n) setTimeout(() => geschafft(t.schluss, nummer), 900);
      });
      kranz.append(k);
    }
    feld.append(kranz);
  },

  // ---------- Hören: Tiergeräusche ----------
  tiergeraeusch(feld, t, nummer) {
    let runde = 0;
    const fortschritt = element('div', 'fortschritt');
    const hoeren = element('div', 'hoeren-zeile');
    const auswahl = element('div', 'auswahl');
    feld.append(fortschritt, hoeren, auswahl);

    const abspielen = (r) => {
      if (r.ton) {
        const a = new Audio(r.ton);
        a.play().catch(() => sprich(r.laut));
        aufraeumen.push(() => a.pause());
      } else {
        sprich(r.laut); // ohne Sounddatei spricht das iPad das Geräusch
      }
    };

    const zeigeRunde = () => {
      const r = t.runden[runde];
      let fehler = 0;
      fortschritt.innerHTML = '';
      t.runden.forEach((_, i) => fortschritt.append(element('span', i < runde ? 'punkt voll' : i === runde ? 'punkt jetzt' : 'punkt')));

      hoeren.innerHTML = '';
      hoeren.append(lautsprecherKnopf('Hören', () => abspielen(r), 'knopf knopf-gross'));

      auswahl.innerHTML = '';
      mischen(r.auswahl).forEach((tier) => {
        const b = element('button', 'wahl', tier);
        b.type = 'button';
        b.addEventListener('click', () => {
          if (tier === r.richtig) {
            b.classList.add('richtig');
            klang.tipp();
            sprich(`Ja! Das ist ${r.name}.`);
            auswahl.querySelectorAll('button').forEach((x) => { x.disabled = true; });
            setTimeout(() => {
              if (!spielLaeuft(nummer)) return;
              runde++;
              if (runde < t.runden.length) zeigeRunde();
              else geschafft(t.schluss, nummer);
            }, 2000);
          } else {
            fehler++;
            wackeln(b);
            klang.sanft();
            if (fehler >= 2) auswahl.querySelectorAll('button').forEach((x) => { if (x.textContent === r.richtig) x.classList.add('hinweis'); });
          }
        });
        auswahl.append(b);
      });
    };
    zeigeRunde();
  },

  // ---------- Memory ----------
  memory(feld, t, nummer) {
    const karten = mischen([...t.karten, ...t.karten]);
    const raster = element('div', 'memory');
    raster.style.setProperty('--spalten', karten.length > 6 ? 4 : 3);
    let offen = [];
    let gefunden = 0;
    let sperre = false;

    karten.forEach((symbol) => {
      const k = element('button', 'karte');
      k.type = 'button';
      k.dataset.symbol = symbol;
      k.setAttribute('aria-label', 'Karte');
      k.innerHTML = `<span class="karte-innen"><span class="karte-ruecken"></span><span class="karte-vorne">${symbol}</span></span>`;
      k.addEventListener('click', () => {
        if (sperre || k.classList.contains('offen')) return;
        k.classList.add('offen');
        k.setAttribute('aria-label', symbol);
        klang.tipp();
        offen.push(k);
        if (offen.length < 2) return;

        const [a, b] = offen;
        offen = [];
        if (a.dataset.symbol === b.dataset.symbol) {
          a.classList.add('paar'); b.classList.add('paar');
          gefunden++;
          ton(784, 0.1, 0.5, 0.1, 'triangle');
          if (gefunden === t.karten.length) setTimeout(() => geschafft(t.schluss, nummer), 700);
        } else {
          sperre = true;
          const zeit = setTimeout(() => {
            a.classList.remove('offen'); b.classList.remove('offen');
            a.setAttribute('aria-label', 'Karte'); b.setAttribute('aria-label', 'Karte');
            sperre = false;
          }, 1300);
          aufraeumen.push(() => clearTimeout(zeit));
        }
      });
      raster.append(k);
    });
    feld.append(raster);
  },

  // ---------- Zuordnen (Schatten, Sortieren, Anziehen) ----------
  zuordnen(feld, t, nummer) {
    let rest = t.teile.length;
    let gewaehlt = null;

    // Ziele: entweder in einer Reihe oder über einem Bild verteilt
    let zielBereich;
    if (t.bild) {
      zielBereich = element('div', 'bildfeld');
      const img = new Image();
      img.src = t.bild;
      img.alt = '';
      zielBereich.append(img);
    } else {
      zielBereich = element('div', 'ziele');
    }

    const zielEls = t.ziele.map((z) => {
      const d = element('div', 'ziel');
      d.dataset.id = z.id;
      if (t.bild) {
        d.classList.add('ziel-auf-bild');
        d.style.left = z.x + '%';
        d.style.top = z.y + '%';
        d.style.setProperty('--g', z.g);
      }
      if (z.farbe) {
        d.classList.add('ziel-kiste');
        d.style.setProperty('--zielfarbe', z.farbe);
        d.append(element('span', 'ziel-text', z.text || ''));
        d.append(element('span', 'ablage'));
      }
      if (z.e) d.append(element('span', 'ziel-symbol' + (z.schatten ? ' schatten' : ''), z.e));
      zielBereich.append(d);
      return d;
    });

    const platzieren = (teil, zielEl) => {
      if (teil.dataset.ziel !== zielEl.dataset.id) {
        klang.sanft();
        wackeln(teil);
        return false;
      }
      klang.tipp();
      teil.classList.remove('gewaehlt');
      teil.classList.add('platziert');
      teil.style.transition = '';
      teil.style.transform = '';
      const schatten = zielEl.querySelector('.schatten');
      const ablage = zielEl.querySelector('.ablage');
      if (schatten) schatten.replaceWith(teil);
      else if (ablage) ablage.append(teil);
      else zielEl.append(teil);
      zielEl.classList.add('gefuellt');
      rest--;
      if (rest === 0) setTimeout(() => geschafft(t.schluss, nummer), 700);
      return true;
    };

    const teileReihe = element('div', 'teile');
    mischen(t.teile).forEach((tt) => {
      const b = element('div', 'teil', tt.e);
      b.dataset.ziel = tt.ziel;
      b.setAttribute('role', 'button');
      b.setAttribute('aria-label', tt.e);
      ziehbar(b, {
        loslassen: (el, x, y) => {
          const z = zielEls.find((zz) => trifft(zz, x, y));
          return z ? platzieren(el, z) : false;
        },
        antippen: (el) => {
          if (gewaehlt) gewaehlt.classList.remove('gewaehlt');
          gewaehlt = el;
          el.classList.add('gewaehlt');
          klang.tipp();
        }
      });
      teileReihe.append(b);
    });

    zielEls.forEach((z) => z.addEventListener('click', () => {
      if (gewaehlt && !gewaehlt.classList.contains('platziert')) {
        if (platzieren(gewaehlt, z)) gewaehlt = null;
      }
    }));

    feld.append(zielBereich, teileReihe);
  },

  // ---------- Puzzle ----------
  puzzle(feld, t, nummer) {
    const spalten = t.spalten || 2;
    const zeilen = t.zeilen || 2;
    const anzahl = spalten * zeilen;
    let rest = anzahl;
    let gewaehlt = null;

    const brett = element('div', 'puzzle-brett');
    brett.style.setProperty('--spalten', spalten);
    brett.style.setProperty('--zeilen', zeilen);
    brett.style.setProperty('--bild', `url("${t.bild}")`);

    const plaetze = [];
    for (let i = 0; i < anzahl; i++) {
      const p = element('div', 'puzzle-platz');
      p.dataset.index = i;
      brett.append(p);
      plaetze.push(p);
    }

    const teilStil = (el, i) => {
      const sp = i % spalten;
      const ze = Math.floor(i / spalten);
      el.style.backgroundImage = `url("${t.bild}")`;
      el.style.backgroundSize = `${spalten * 100}% ${zeilen * 100}%`;
      el.style.backgroundPosition = `${spalten > 1 ? (sp / (spalten - 1)) * 100 : 0}% ${zeilen > 1 ? (ze / (zeilen - 1)) * 100 : 0}%`;
    };

    const platzieren = (teil, platz) => {
      if (teil.dataset.index !== platz.dataset.index || platz.firstChild) {
        klang.sanft();
        wackeln(teil);
        return false;
      }
      klang.tipp();
      teil.classList.remove('gewaehlt');
      teil.classList.add('platziert');
      teil.style.transition = '';
      teil.style.transform = '';
      platz.append(teil);
      rest--;
      if (rest === 0) { brett.classList.add('fertig'); setTimeout(() => geschafft(t.schluss, nummer), 700); }
      return true;
    };

    const ablage = element('div', 'puzzle-ablage');
    ablage.style.setProperty('--spalten', spalten);
    mischen([...Array(anzahl).keys()]).forEach((i) => {
      const teil = element('div', 'puzzle-teil');
      teil.dataset.index = i;
      teil.setAttribute('role', 'button');
      teil.setAttribute('aria-label', `Puzzleteil ${i + 1}`);
      teilStil(teil, i);
      ziehbar(teil, {
        loslassen: (el, x, y) => {
          const p = plaetze.find((pp) => trifft(pp, x, y, 10));
          return p ? platzieren(el, p) : false;
        },
        antippen: (el) => {
          if (gewaehlt) gewaehlt.classList.remove('gewaehlt');
          gewaehlt = el;
          el.classList.add('gewaehlt');
          klang.tipp();
        }
      });
      ablage.append(teil);
    });

    plaetze.forEach((p) => p.addEventListener('click', () => {
      if (gewaehlt && !gewaehlt.classList.contains('platziert') && platzieren(gewaehlt, p)) gewaehlt = null;
    }));

    feld.append(brett, ablage);
  },

  // ---------- Zählen ----------
  zaehlen(feld, t, nummer) {
    const n = t.anzahl || 3;
    let gezaehlt = 0;
    const reihe = element('div', 'zaehl-reihe');
    const anzeige = element('div', 'zaehl-anzeige', ' ');
    const frage = element('div', 'zaehl-frage');
    frage.hidden = true;

    for (let i = 0; i < n; i++) {
      const o = element('button', 'zaehl-objekt', t.objekt);
      o.type = 'button';
      o.setAttribute('aria-label', 'Antippen zum Zählen');
      o.addEventListener('click', () => {
        if (o.classList.contains('gezaehlt')) return;
        gezaehlt++;
        o.classList.add('gezaehlt');
        o.append(element('span', 'zaehl-nummer', gezaehlt));
        klang.zahl(gezaehlt);
        sprich(ZAHLWORT[gezaehlt] || String(gezaehlt));
        anzeige.textContent = gezaehlt;
        if (gezaehlt === n) {
          const zeit = setTimeout(() => {
            if (!spielLaeuft(nummer)) return;
            frage.hidden = false;
            sprich('Wie viele sind es?');
          }, 1000);
          aufraeumen.push(() => clearTimeout(zeit));
        }
      });
      reihe.append(o);
    }

    frage.append(element('p', 'zaehl-frage-text', 'Wie viele sind es?'));
    const wahlen = element('div', 'auswahl');
    let fehler = 0;
    (t.auswahl || [n - 1, n, n + 1]).forEach((zahl) => {
      const b = element('button', 'wahl wahl-zahl', zahl);
      b.type = 'button';
      b.addEventListener('click', () => {
        if (zahl === n) { b.classList.add('richtig'); geschafft(t.schluss, nummer); }
        else {
          fehler++;
          wackeln(b);
          klang.sanft();
          if (fehler >= 2) wahlen.querySelectorAll('button').forEach((x) => { if (Number(x.textContent) === n) x.classList.add('hinweis'); });
        }
      });
      wahlen.append(b);
    });
    frage.append(wahlen);

    feld.append(reihe, anzeige, frage);
  },

  // ---------- Musik: Glockenspiel ----------
  glockenspiel(feld, t) {
    const noten = [523, 587, 659, 784, 880]; // Pentatonik: klingt immer schön zusammen
    const farben = ['#d9655a', '#e8b84f', '#7fae86', '#5f86c4', '#a688c4'];
    const reihe = element('div', 'glocken');
    noten.forEach((f, i) => {
      const g = element('button', 'glocke', '🔔');
      g.type = 'button';
      g.setAttribute('aria-label', `Glocke ${i + 1}`);
      g.style.setProperty('--glockenfarbe', farben[i]);
      g.style.setProperty('--hoehe', 1 - i * 0.08);
      g.addEventListener('pointerdown', () => {
        klang.glocke(f);
        g.classList.remove('schwingt');
        void g.offsetWidth;
        g.classList.add('schwingt');
      });
      reihe.append(g);
    });
    feld.append(reihe);
    feld.append(knopf('Fertig', () => geschafft(t.schluss), 'knopf knopf-leise'));
  },

  // ---------- Fangen: Schneeflocken ----------
  fangen(feld, t, nummer) {
    const ziel = t.anzahl || 8;
    let gefangen = 0;
    const himmel = element('div', 'himmel fang-himmel');
    const zaehler = element('div', 'fang-zaehler');
    for (let i = 0; i < ziel; i++) zaehler.append(element('span', 'fang-punkt', t.objekt));
    feld.append(zaehler, himmel);

    const flocken = [];
    const neueFlocke = () => {
      const b = element('button', 'fang-flocke', t.objekt);
      b.type = 'button';
      b.setAttribute('aria-label', 'Schneeflocke');
      const daten = { el: b, x: Math.random(), y: flocken.length ? -0.15 - Math.random() * 0.3 : 0.05, tempo: 0.00008 + Math.random() * 0.00004, phase: Math.random() * 6 };
      b.addEventListener('pointerdown', () => {
        if (b.classList.contains('gefangen')) return;
        b.classList.add('gefangen');
        ton(880 + gefangen * 60, 0, 0.4, 0.1, 'triangle');
        gefangen++;
        zaehler.children[gefangen - 1].classList.add('voll');
        flocken.splice(flocken.indexOf(daten), 1);
        setTimeout(() => b.remove(), 400);
        if (gefangen >= ziel) setTimeout(() => geschafft(t.schluss, nummer), 600);
      });
      himmel.append(b);
      flocken.push(daten);
    };

    let letzte = performance.now();
    let rafId = 0;
    const schritt = (jetzt) => {
      if (!spielLaeuft(nummer)) return;
      const dt = Math.min(jetzt - letzte, 50);
      letzte = jetzt;
      const noetig = Math.min(3, ziel - gefangen);
      while (flocken.length < noetig) neueFlocke();
      const B = himmel.clientWidth;
      const H = himmel.clientHeight;
      flocken.forEach((f) => {
        f.y += f.tempo * dt * (bewegungReduziert() ? 0.5 : 1);
        if (f.y > 1.05) { f.y = -0.15; f.x = Math.random(); }
        const x = f.x * (B - 72) + Math.sin(jetzt / 900 + f.phase) * 18;
        f.el.style.transform = `translate(${Math.max(0, x)}px, ${f.y * H}px)`;
      });
      rafId = requestAnimationFrame(schritt);
    };
    rafId = requestAnimationFrame(schritt);
    aufraeumen.push(() => cancelAnimationFrame(rafId));
  },

  // ---------- Geschenk auspacken ----------
  auspacken(feld, t, nummer) {
    const ziel = t.tipps || 3;
    let tipps = 0;
    const paket = element('button', 'paket', '🎁');
    paket.type = 'button';
    paket.setAttribute('aria-label', 'Geschenk');
    const ueberraschung = element('div', 'ueberraschung', t.ueberraschung);
    ueberraschung.hidden = true;
    paket.addEventListener('click', () => {
      tipps++;
      ton(440 + tipps * 110, 0, 0.3, 0.1, 'triangle');
      wackeln(paket);
      paket.style.setProperty('--wachsen', 1 + tipps * 0.08);
      if (tipps >= ziel) {
        paket.hidden = true;
        ueberraschung.hidden = false;
        setTimeout(() => geschafft(t.schluss, nummer), 1200);
      }
    });
    feld.append(paket, ueberraschung);
  },

  // ---------- Baum schmücken ----------
  schmuecken(feld, t, nummer) {
    let rest = t.schmuck.length;
    let gewaehlt = null;
    const baum = element('div', 'baum');
    const img = new Image();
    img.src = t.bild;
    img.alt = 'Tannenbaum';
    baum.append(img);

    const aufhaengen = (kugel, x, y) => {
      const r = baum.getBoundingClientRect();
      const px = ((x - r.left) / r.width) * 100;
      const py = ((y - r.top) / r.height) * 100;
      // Grob: Nur innerhalb des Baumdreiecks (oben schmal, unten breit)
      const halbeBreite = Math.max(4, (py - 14) * 0.52);
      if (py < 16 || py > 84 || Math.abs(px - 50) > halbeBreite) { klang.sanft(); wackeln(kugel); return false; }
      klang.tipp();
      kugel.classList.remove('gewaehlt');
      kugel.classList.add('platziert', 'haengt');
      kugel.style.transition = '';
      kugel.style.transform = '';
      kugel.style.left = px + '%';
      kugel.style.top = py + '%';
      baum.append(kugel);
      rest--;
      if (rest === 0) setTimeout(() => geschafft(t.schluss, nummer), 700);
      return true;
    };

    const ablage = element('div', 'teile');
    t.schmuck.forEach((s) => {
      const k = element('div', 'teil', s);
      k.setAttribute('role', 'button');
      k.setAttribute('aria-label', 'Kugel');
      ziehbar(k, {
        loslassen: (el, x, y) => aufhaengen(el, x, y),
        antippen: (el) => {
          if (gewaehlt) gewaehlt.classList.remove('gewaehlt');
          gewaehlt = el;
          el.classList.add('gewaehlt');
          klang.tipp();
        }
      });
      ablage.append(k);
    });
    baum.addEventListener('click', (e) => {
      if (gewaehlt && !gewaehlt.classList.contains('platziert') && aufhaengen(gewaehlt, e.clientX, e.clientY)) gewaehlt = null;
    });

    feld.append(baum, ablage);
  },

  // ---------- Suchbild ----------
  suchbild(feld, t, nummer) {
    const szene = element('div', 'szene');
    szene.style.backgroundImage = `url("${t.szene}")`;
    const z = t.ziel;
    const rnd = zufall(t.tag * 31 + 7);

    // Ablenkende Figuren verteilen, mit Abstand zum gesuchten Objekt
    (t.deko || []).forEach((e) => {
      let x, y, versuche = 0;
      do {
        x = 6 + rnd() * 88;
        y = 50 + rnd() * 42;
        versuche++;
      } while (Math.hypot(x - z.x, (y - z.y) * 0.75) < 12 && versuche < 30);
      const d = element('span', 'deko', e);
      d.style.left = x + '%';
      d.style.top = y + '%';
      d.style.setProperty('--g', 4.5 + rnd() * 2.5);
      szene.append(d);
    });

    const gesucht = element('button', 'gesucht');
    gesucht.type = 'button';
    gesucht.setAttribute('aria-label', 'Gefunden');
    gesucht.style.left = z.x + '%';
    gesucht.style.top = z.y + '%';
    gesucht.style.setProperty('--g', z.groesse || 8);
    if (z.bild) { const img = new Image(); img.src = z.bild; img.alt = ''; gesucht.append(img); }
    else gesucht.textContent = z.e;

    let fehler = 0;
    let gefunden = false;
    szene.addEventListener('click', (e) => {
      if (gefunden) return;
      if (gesucht.contains(e.target)) {
        gefunden = true;
        gesucht.classList.add('gefunden');
        setTimeout(() => geschafft(t.schluss, nummer), 600);
        return;
      }
      fehler++;
      klang.sanft();
      if (fehler === 3) gesucht.classList.add('hinweis'); // Hilfe nach drei Versuchen
    });

    szene.append(gesucht);
    feld.append(szene);
  },

  leer(feld) {
    feld.append(element('p', 'bild-text', 'Hinter diesem Türchen ist noch nichts.'));
  },

  unbekannt(feld, t) {
    feld.append(element('p', 'bild-text', `Der Spieltyp «${t.typ}» kommt bald.`));
  }
};


// ==========================================================
// 7. Lehrpersonen
// ==========================================================
let pinEingabe = '';
let druckTimer = null;

function pinOeffnen() {
  pinEingabe = '';
  pinPunkteZeigen();
  $('pin').hidden = false;
}

function pinPunkteZeigen() {
  [...$('pin-punkte').children].forEach((p, i) => p.classList.toggle('voll', i < pinEingabe.length));
}

function pinZiffer(z) {
  if (pinEingabe.length >= 4) return;
  pinEingabe += z;
  pinPunkteZeigen();
  if (pinEingabe.length === 4) setTimeout(pinPruefen, 150);
}

function pinPruefen() {
  if (pinEingabe === String(inhalt.pin)) {
    $('pin').hidden = true;
    lehrerOeffnen();
    return;
  }
  wackeln($('pin-punkte'));
  setTimeout(() => { pinEingabe = ''; pinPunkteZeigen(); }, 400);
}

function lehrerOeffnen() {
  $('alle-frei').checked = zustand.alleFrei;
  $('sim-datum').value = zustand.simDatum || '';
  $('bestaetigen').hidden = true;
  lehrerInfo();
  $('lehrer').hidden = false;
}

function lehrerInfo() {
  const h = heute();
  $('lehrer-info').textContent =
    `Datum: ${h.toLocaleDateString('de-CH')} (${zustand.simDatum ? 'simuliert' : 'echt'}). Geöffnet: ${zustand.offen.length} von 24 Türchen.`;
}

function chipAktualisieren() {
  const teile = [];
  if (zustand.alleFrei) teile.push('alle frei');
  if (zustand.simDatum) teile.push('Datum simuliert');
  $('lehrer-chip').hidden = teile.length === 0;
  $('lehrer-chip').textContent = 'Lehrpersonen: ' + teile.join(', ');
}

function neuZeichnen() {
  $('titel').textContent = inhalt.titel || 'Unser Adventskalender';
  $('untertitel').textContent = untertitelText();
  chipAktualisieren();
  kalenderZeichnen();
}

function aenderungSpeichern() {
  speicherSchreiben();
  neuZeichnen();
  lehrerInfo();
}

function ereignisseVerbinden() {
  // 3 Sekunden auf den Titel drücken öffnet die PIN-Eingabe
  const titel = $('titel');
  const druckEnde = () => { clearTimeout(druckTimer); titel.classList.remove('drueckt'); };
  titel.addEventListener('pointerdown', () => {
    titel.classList.add('drueckt');
    druckTimer = setTimeout(() => { druckEnde(); pinOeffnen(); }, 3000);
  });
  ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => titel.addEventListener(ev, druckEnde));
  titel.addEventListener('contextmenu', (e) => e.preventDefault());
  $('lehrer-chip').addEventListener('click', pinOeffnen);

  $('tastatur').addEventListener('click', (e) => {
    const taste = e.target.closest('[data-ziffer]');
    if (taste) pinZiffer(taste.dataset.ziffer);
  });
  $('pin-loeschen').addEventListener('click', () => { pinEingabe = pinEingabe.slice(0, -1); pinPunkteZeigen(); });
  $('pin-abbrechen').addEventListener('click', () => { $('pin').hidden = true; });

  $('alle-frei').addEventListener('change', (e) => { zustand.alleFrei = e.target.checked; aenderungSpeichern(); });
  $('sim-datum').addEventListener('change', (e) => { zustand.simDatum = e.target.value || null; aenderungSpeichern(); });
  $('sim-weg').addEventListener('click', () => { zustand.simDatum = null; $('sim-datum').value = ''; aenderungSpeichern(); });
  $('zuruecksetzen').addEventListener('click', () => { $('bestaetigen').hidden = false; });
  $('nein-zuruecksetzen').addEventListener('click', () => { $('bestaetigen').hidden = true; });
  $('ja-zuruecksetzen').addEventListener('click', () => {
    zustand.offen = [];
    $('bestaetigen').hidden = true;
    aenderungSpeichern();
    meldung('Alle Türchen sind wieder geschlossen.');
  });
  $('lehrer-fertig').addEventListener('click', () => { $('lehrer').hidden = true; });

  $('zurueck').addEventListener('click', buehneSchliessen);

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!$('pin').hidden) $('pin').hidden = true;
    else if (!$('lehrer').hidden) $('lehrer').hidden = true;
    else if (!$('buehne').hidden) buehneSchliessen();
  });

  // Nach dem Aufwecken des iPads: Datum neu prüfen
  document.addEventListener('visibilitychange', () => { if (!document.hidden) neuZeichnen(); });

  // Beim Drehen des iPads die Türchen neu verteilen
  let resizeTimer = null;
  window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(tuerenPlatzieren, 120); });
}

let meldungTimer = null;
function meldung(text) {
  const m = $('meldung');
  m.textContent = text;
  m.hidden = false;
  clearTimeout(meldungTimer);
  meldungTimer = setTimeout(() => { m.hidden = true; }, 2800);
}


// ==========================================================
// 8. Start
// ==========================================================
async function start() {
  try {
    const antwort = await fetch('content.json', { cache: 'no-store' });
    if (!antwort.ok) throw new Error('HTTP ' + antwort.status);
    inhalt = await antwort.json();
  } catch (e) {
    $('kalender').innerHTML =
      '<p class="fehler">Die Datei content.json konnte nicht geladen werden. ' +
      'Öffne den Kalender über einen Webserver (z.B. GitHub Pages) und nicht direkt als Datei.</p>';
    console.error(e);
    return;
  }
  if (inhalt.hintergrund) document.body.style.backgroundImage = `url("${inhalt.hintergrund}")`;
  ereignisseVerbinden();
  neuZeichnen();
}

start();
