// 6E-M1 fidelity-upgraded AdaniOne-TECH clone — RESULTS-PAGE measurement fixture.
// Evidence-only phase: this file is a TEST FIXTURE, not product code.
//
// Base structure mirrors .drytis/notes/evidence/adanione-clone-audit/app.mjs
// (evidenced AdaniOne technical characteristics 1–10; see that file's header).
// NEW shapes added for 6E-M1, each traced to an evidenced RCA fact:
//
//  R1  Combobox date-picker with aria-label date cells, role=option inferred
//      (rca-adanione-custom-controls RC4: "calendar cell (aria-label 'Choose
//      Saturday, September 5th, 2026', role inferred option in their combobox
//      date picker)"; Run A int-33 'Enter Fri, 21 Aug Depart on'; Run B
//      int-43/44/62 date cells). Trigger name-shape "Depart on" via
//      placeholder (W4 name-hint path).
//  R2  Flight cards in TWO plausible shapes because the real results-page
//      markup is UNMEASURED (live site egress-blocked; no post-6D.1 user
//      batch). Shape A = current clone guess: plain div.flight with only a
//      widget-named data-auto-id (no role, no interactive class token).
//      Shape B = button-shaped card (role=button + aria-label). Measuring
//      both bounds the O10 residual honestly.
//  R3  Duration filter chips with accessible names '02h 30m' / '12h 10m'
//      (Run B int-65/66 '12h 10m' Unclassified). Real class names unknown →
//      chip 1 carries a 'chip' class token (covered-by-convention branch),
//      chip 2 carries no interactive token (no-signal branch).
//  R4  Skeleton → fetched content swap on the results container (base clone
//      characteristic 6; measures net-zero churn seeding at HEAD).
//  R5  Entity CONTROL: a data-sku cart row (proven entity path — clone audit
//      derived [data-sku="MEAL"] presence assertions). Distinguishes
//      "flight cards don't seed" from "probe broken".
//  R6  Counter consequences on flight pick: data-auto-id="cart-count" text
//      + data-count attribute on cart-badge (base clone evidenced header
//      behavior; measures counter seeding/assertions on the results page).
import http from 'node:http';

const PORT = 8189;
const FLIGHTS = [
  { id: 'F1', no: '6E-5233', dep: '07:40', arr: '09:55', price: 4120 },
  { id: 'F2', no: 'AI-887', dep: '10:15', arr: '12:30', price: 5380 }, // Shape A card
  { id: 'F3', no: 'QP-1478', dep: '14:05', arr: '16:20', price: 3890 }, // Shape B card
];
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

const ord = (n) => { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const DAYS = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
// September 2026 calendar slice — aria-label uses the W3C date-name shape
// evidenced in RC4 ("Choose Saturday, September 5th, 2026").
const CAL = Array.from({ length: 14 }, (_, i) => {
  const d = new Date(2026, 8, 1 + i);
  return { iso: `2026-09-${String(1 + i).padStart(2, '0')}`,
    label: `Choose ${DAYS[d.getDay()]}, ${MONTHS[8]} ${ord(1 + i)}, 2026`,
    short: `${DAYS[d.getDay()].slice(0, 3)}, ${String(1 + i).padStart(2, '0')} Sep` };
});

const shellHead = `<style>
*{box-sizing:border-box}body{font-family:system-ui;margin:0;color:#111}
header{display:flex;align-items:center;gap:1rem;padding:.7rem 1.2rem;background:#0b1f4b;color:#fff;position:sticky;top:0}
header a{color:#fff;text-decoration:none;font-size:.95rem}
.badge{position:relative;margin-left:auto;cursor:pointer}
.badge .count{position:absolute;top:-8px;right:-10px;background:#e87;border-radius:9px;font-size:.72rem;padding:1px 5px}
main{max-width:880px;margin:0 auto;padding:1.2rem}
input{font-size:1rem;padding:.5rem;border:1px solid #ccd;border-radius:6px}
button{font-size:.95rem;padding:.45rem .9rem;border:1px solid #ccd;border-radius:6px;background:#fff;cursor:pointer}
.svc-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:.7rem;margin:1rem 0}
.svc{border:1px solid #dde;padding:.8rem;border-radius:8px;text-align:center}
.skel{height:64px;border-radius:8px;background:linear-gradient(90deg,#eee 25%,#f7f7f7 50%,#eee 75%);background-size:200% 100%;animation:w 1.2s infinite;margin:.6rem 0}
@keyframes w{to{background-position:-200% 0}}
.flight{display:flex;align-items:center;gap:1rem;border:1px solid #dde;border-radius:8px;padding:.8rem 1rem;margin:.6rem 0}
.f-right{margin-left:auto;font-weight:600}
.calendar{position:absolute;z-index:9;background:#fff;border:1px solid #ccd;border-radius:8px;padding:.6rem;display:grid;grid-template-columns:repeat(7,44px);gap:4px}
.cal-cell{padding:.4rem;text-align:center;border:1px solid #eee;border-radius:6px;cursor:pointer}
.filters{display:flex;gap:.6rem;margin:.8rem 0}
.dur-chip,.dur-opt{border:1px solid #ccd;border-radius:14px;padding:.3rem .8rem;cursor:pointer;font-size:.9rem}
.sel-note{font-size:.9rem;color:#060;margin:.4rem 0}
[hidden]{display:none !important}
</style>`;

const clientJs = `
function beacon(e, extra){ fetch('/collect?e=' + e + (extra ? '&' + extra : ''), {keepalive:true}).catch(()=>{}); }
document.addEventListener('click', (ev) => { const b = ev.target.closest('button,a'); if (b) beacon('click', 't=' + encodeURIComponent(b.getAttribute('data-auto-id') || b.tagName)); }, true);
async function softNav(path){ history.pushState({}, '', path); beacon('navigate','path='+encodeURIComponent(path)); await renderRoute(); window.scrollTo(0,0); }
document.addEventListener('click', (ev) => { const a = ev.target.closest('a[data-soft]'); if (!a) return; ev.preventDefault(); softNav(a.getAttribute('href')); });

let picked = 0;
function bumpBadge(){ const n = picked;
  const c = document.querySelector('[data-auto-id="cart-count"]'); if (c) c.textContent = String(n);
  const b = document.querySelector('[data-auto-id="cart-badge"]'); if (b) b.setAttribute('data-count', String(n)); }

async function renderRoute(){
  const main = document.getElementById('app-root');
  const path = location.pathname;
  bumpBadge();
  if (path.startsWith('/flights')) { await renderFlights(main); }
  else { renderHome(main); }
}

function renderHome(main){
  main.innerHTML = '<h1>One-stop travel</h1>' +
    '<div class="svc-grid" data-auto-id="services-grid">' +
    ['Flight booking','Duty free','Lounges','Flight status'].map(s => '<div class="svc" data-auto-id="svc-' + s.toLowerCase().replace(/\\\\W+/g,'-') + '">' + s + '</div>').join('') +
    '</div><a href="/flights" data-soft data-auto-id="book-flight">Book Flight</a>';
}

async function renderFlights(main){
  main.innerHTML = '<h1>Flights</h1>' +
    // R1: combobox date-picker — trigger name-shape via placeholder (W4 path)
    '<label for="depart">Depart on <input id="depart" data-auto-id="depart-on" placeholder="Depart on" autocomplete="off" readonly></label>' +
    '<div class="calendar" id="cal" data-auto-id="calendar" role="grid" hidden></div>' +
    // R3: duration chips — evidenced accessible names '02h 30m' / '12h 10m'
    '<div class="filters" data-auto-id="duration-filters">' +
      '<div class="dur-chip" data-auto-id="duration-under-2h">02h 30m</div>' +
      '<div class="dur-opt" data-auto-id="duration-12h">12h 10m</div>' +
    '</div>' +
    // R4: skeleton → fetched swap (measures net-zero churn seeding)
    '<div id="flights-root"><div class="skel" data-auto-id="skel-0"></div><div class="skel" data-auto-id="skel-1"></div><div class="skel" data-auto-id="skel-2"></div></div>' +
    '<div class="sel-note" data-auto-id="pick-note" hidden>Flight selected.</div>' +
    // R5: entity CONTROL row (proven data-sku path)
    '<h2>Your selections</h2><div class="flight" data-auto-id="cart-item-MEAL" data-sku="MEAL"><div>In-flight meal</div><div class="f-right">₹450</div></div>';
  const cal = document.getElementById('cal');
  cal.innerHTML = CAL.map(c => '<div class="cal-cell" role="option" aria-label="' + c.label + '" data-auto-id="date-cell-' + c.iso + '">' + parseInt(c.iso.slice(-2), 10) + '</div>').join('');
  document.getElementById('depart').addEventListener('click', () => { cal.hidden = !cal.hidden; });
  cal.querySelectorAll('.cal-cell').forEach(cell => {
    // Evidenced sequencing (Run A int-33 'Enter Fri, 21 Aug' → 'Sat 05 Sep'
    // value transition captured by the recorder): the real site writes the
    // field value at MOUSEDOWN time — BEFORE the browser's mousedown→blur
    // order completes the input's lifecycle. A value written in the click
    // handler (after blur) is invisible to capture. Value-first-then-blur.
    cell.addEventListener('mousedown', () => {
      const c = CAL.find(x => 'date-cell-' + x.iso === cell.getAttribute('data-auto-id'));
      const inp = document.getElementById('depart');
      inp.value = c.short;
      inp.dispatchEvent(new Event('input', { bubbles: true }));
      inp.dispatchEvent(new Event('change', { bubbles: true }));
    });
    cell.addEventListener('click', () => {
      cal.hidden = true; beacon('date_selected');
    });
  });
  document.querySelectorAll('.dur-chip,.dur-opt').forEach(chip => chip.addEventListener('click', () => { chip.style.fontWeight = '700'; beacon('filter_applied'); }));
  await delay(900); // skeleton → fetched content swap
  const root = document.getElementById('flights-root'); if (!root) return;
  root.innerHTML = FLIGHTS.map(f =>
    f.id === 'F3'
      // R2 Shape B: button-shaped card (role=button + aria-label)
      ? '<div class="flight" role="button" tabindex="0" aria-label="Select flight ' + f.no + '" data-auto-id="flight-' + f.id + '">' +
        '<div><strong>' + f.no + '</strong><br><small>' + f.dep + ' – ' + f.arr + '</small></div><div class="f-right">₹' + f.price + '</div></div>'
      // R2 Shape A: current clone guess — plain div, widget-named data-auto-id only
      : '<div class="flight" data-auto-id="flight-' + f.id + '">' +
        '<div><strong>' + f.no + '</strong><br><small>' + f.dep + ' – ' + f.arr + '</small></div><div class="f-right">₹' + f.price + '</div></div>'
  ).join('');
  root.querySelectorAll('.flight').forEach(card => {
    card.addEventListener('click', () => {
      picked++; bumpBadge(); // R6 counter consequence on the results page
      const n = document.querySelector('[data-auto-id="pick-note"]'); if (n) n.hidden = false;
      beacon('flight_picked', 'f=' + card.getAttribute('data-auto-id'));
    });
  });
}

renderRoute();
`;

const header = `<header>
<a href="/" data-soft data-auto-id="nav-home">Home</a>
<a href="/flights" data-soft data-auto-id="nav-flights">Flights</a>
<span class="badge" data-auto-id="cart-badge" data-count="0" role="button" aria-label="Cart items">
  <span class="count" data-auto-id="cart-count">0</span>
</span>
</header>`;

const page = (title) => `<!doctype html><html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${title}</title>${shellHead}</head>
<body>${header}<main id="app-root"></main>
<script>const FLIGHTS = ${JSON.stringify(FLIGHTS)}; const CAL = ${JSON.stringify(CAL)}; const delay = (ms) => new Promise((r) => setTimeout(r, ms));
${clientJs}</script></body></html>`;

http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  const json = (o) => { res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' }); res.end(JSON.stringify(o)); };
  if (u.pathname === '/collect') return json({ ok: true });
  if (u.pathname.startsWith('/flights')) { res.writeHead(200, { 'content-type': 'text/html' }); return res.end(page('Flights — One Travel')); }
  res.writeHead(200, { 'content-type': 'text/html' }); res.end(page('One Travel — Home'));
}).listen(PORT, '127.0.0.1', () => console.log('6E-M1 fixture on', PORT));
