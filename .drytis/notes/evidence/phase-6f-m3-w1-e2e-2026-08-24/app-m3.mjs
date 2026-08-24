// 6E-M2 E2E clone — VERBATIM real-AdaniOne markup from user evidence
// batch 2 (.drytis/notes/evidence/user-batch-2026-08-23-0724/):
//   travel-date-wrapper > travel_date(.focused) > div.date_picker.undefined
//     > react-datepicker > [__triangle, __aria-live span[role=alert]]
//     > __month-container > __month[role=listbox] > __week
//     > __day(role=option, aria-label "Choose <Day>, <Month> <Nth>, <Year>",
//             tabindex=0, modifiers --selected/--keyboard-selected/--weekend…)
//   trigger inputs: INPUT#onward/#return [role=textbox], class
//     'withIcon form-control', placeholder/name 'Depart on'/'Return on'
// Plus 6B/6D.1 regression cells: data-auto-id click, options-list Click
// (W3), snackbar notification (W1), #id-only 1/1 counter swap (W2).
import http from 'node:http';

const PORT = 8191;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ord = (n) => { const s = ['th','st','nd','rd'], v = n % 100; return n + (s[(v-20)%10] || s[v] || s[0]); };
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const DAYS = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const CAL = Array.from({ length: 10 }, (_, i) => {
  const d = new Date(2026, 8, 5 + i);
  return { iso: `2026-09-${String(5+i).padStart(2,'0')}`,
    label: `Choose ${DAYS[d.getDay()]}, September ${ord(5+i)}, 2026`,
    short: `Sat, 0${5+i} Sep` };
});

const head = `<style>
*{box-sizing:border-box}body{font-family:system-ui;margin:0;color:#111}
main{max-width:860px;margin:0 auto;padding:1.4rem}
.city-inputs-wrapper{display:flex;gap:1.4rem;flex-wrap:wrap}
.travel-date-wrapper{display:flex;gap:1rem}
.travel_date{position:relative}
.travel_date input{font-size:1rem;padding:.5rem .7rem;border:1px solid #ccd;border-radius:6px}
.form-floating label{font-size:.78rem;color:#556}
.date_picker{position:absolute;z-index:9;top:110%;left:0}
.react-datepicker{background:#fff;border:1px solid #ccd;border-radius:8px;padding:.6rem;box-shadow:0 6px 18px rgba(0,0,0,.12)}
.react-datepicker__month{display:grid;gap:2px}
.react-datepicker__week{display:grid;grid-template-columns:repeat(5,52px);gap:2px}
.react-datepicker__day{padding:.45rem .2rem;text-align:center;border:1px solid #eef;border-radius:6px;cursor:pointer;font-size:.92rem}
.react-datepicker__day--selected{background:#0b64d6;color:#fff;border-color:#0b64d6}
.react-datepicker__day--weekend{color:#c34}
.datepicker-date-holder .datepicker-date{font-weight:600}
.reg{display:flex;gap:.8rem;align-items:center;margin:1.6rem 0;flex-wrap:wrap}
.reg button{font-size:.95rem;padding:.45rem 1rem;border:1px solid #ccd;border-radius:6px;background:#fff;cursor:pointer}
.snackbar{position:fixed;bottom:18px;left:50%;transform:translateX(-50%);background:#222;color:#fff;padding:.6rem 1.1rem;border-radius:8px;opacity:0;transition:opacity .18s}
.snackbar.show{opacity:1}
[hidden]{display:none !important}
</style>`;

const body = `
<main>
  <div class="city-inputs-wrapper">
    <div class="travel-date-wrapper">
      <div class="travel_date" id="td-onward">
        <div class="adl-floating-input form-floating">
          <input id="onward" name="onward" role="textbox" class="withIcon form-control" type="text"
                 placeholder="Depart on" aria-label="Depart on" autocomplete="off" readonly>
          <label for="onward">Depart on</label>
        </div>
        <div class="date_picker undefined" id="cal-onward" hidden>
          <div class="react-datepicker">
            <div class="react-datepicker__triangle"></div>
            <span role="alert" aria-live="polite" class="react-datepicker__aria-live"></span>
            <div class="react-datepicker__month-container">
              <div class="react-datepicker__header react-datepicker__header--custom"></div>
              <div class="react-datepicker__month" aria-label="month 2026-09" role="listbox" id="month-onward"></div>
            </div>
          </div>
        </div>
      </div>
      <div class="travel_date" id="td-return">
        <div class="adl-floating-input form-floating">
          <input id="return" name="return" role="textbox" class="withIcon form-control" type="text"
                 placeholder="Return on" aria-label="Return on" autocomplete="off" readonly>
          <label for="return">Return on</label>
        </div>
        <div class="date_picker undefined" id="cal-return" hidden>
          <div class="react-datepicker">
            <div class="react-datepicker__month" aria-label="month 2026-09" role="listbox" id="month-return"></div>
          </div>
        </div>
      </div>
    </div>
  </div>

  <div class="reg">
    <button id="go" data-auto-id="search-flights">Search Flights</button>
    <ul class="options-list" id="opts" hidden>
      <li class="opt" data-testid="airport-opt-1">Bengaluru</li>
      <li class="opt" data-testid="airport-opt-2">Mumbai</li>
    </ul>
    <p id="result-count">0 selected</p>
    <button id="toast-btn">Notify</button>
    <button id="noop-churn">Churn</button>
    <a id="nav-away" href="/flights?origin=MAA&dest=DEL&utm_source=test">Flights</a>
  </div>
</main>
<div class="snackbar" id="snack" role="status">Saved</div>`;

const js = `
const CAL = ${JSON.stringify(CAL)};
function buildCal(monthEl, input){
  monthEl.innerHTML = '';
  const week = document.createElement('div');
  week.className = 'react-datepicker__week';
  CAL.forEach((c, i) => {
    const day = document.createElement('div');
    const mods = ['react-datepicker__day'];
    if (i === 0) mods.push('react-datepicker__day--selected','react-datepicker__day--keyboard-selected');
    if (i === 6) mods.push('react-datepicker__day--weekend');
    day.className = mods.join(' ');
    day.setAttribute('role','option');
    day.setAttribute('tabindex','0');
    day.setAttribute('aria-label', c.label);
    day.setAttribute('aria-selected', i === 0 ? 'true' : 'false');
    day.setAttribute('aria-disabled','false');
    day.innerHTML = '<div class="datepicker-date-holder"><div class="full datepicker-date"><span>' + parseInt(c.iso.slice(-2),10) + '</span></div></div><p class="bg-fff fs-9">7,000</p>';
    // Real-site sequencing (6E-M1 evidence): framework writes the value at
    // MOUSEDOWN time — before the input's blur completes the lifecycle.
    day.addEventListener('mousedown', () => {
      input.value = c.short;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    day.addEventListener('click', () => { input.closest('.travel_date').querySelector('.date_picker').hidden = true; });
    week.appendChild(day);
  });
  monthEl.appendChild(week);
}
function wire(id, calId){
  const input = document.getElementById(id);
  const cal = document.getElementById(calId);
  buildCal(cal.querySelector('.react-datepicker__month'), input);
  input.addEventListener('click', () => { cal.hidden = !cal.hidden; });
}
wire('onward','cal-onward'); wire('return','cal-return');

let sel = 0;
document.getElementById('go').addEventListener('click', () => {
  const o = document.getElementById('opts');
  o.hidden = !o.hidden; sel++; 
  document.getElementById('result-count').textContent = sel + ' selected';
  fetch('/collect?e=search').catch(()=>{});
});
document.querySelectorAll('#opts .opt').forEach(li => li.addEventListener('click', () => {
  document.getElementById('result-count').textContent = (++sel) + ' selected';
}));
document.getElementById('noop-churn').addEventListener('click', () => {
  const p = document.getElementById('result-count');
  // attribute-only churn that materializes nothing: set class to the SAME
  // value it already has (final delta old==new), no child/text changes.
  p.setAttribute('data-churn', '1');
  p.setAttribute('data-churn', '1');
  p.setAttribute('class', p.getAttribute('class') || '');
});
document.getElementById('toast-btn').addEventListener('click', () => {
  const s = document.getElementById('snack');
  s.classList.add('show');
  setTimeout(() => s.classList.remove('show'), 600);
  fetch('/collect?e=notify').catch(()=>{});
});
`;

http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/collect') { res.writeHead(200, {'content-type':'application/json'}); return res.end('{"ok":true}'); }
  if (u.pathname === '/flights') {
    // deliberately NO <title> → empty pageTitle at onCommitted (O14 fixture)
    res.writeHead(200, { 'content-type': 'text/html' });
    return res.end('<!doctype html><html lang="en"><head><meta charset="utf-8"/></head><body><h1>Flights page (no title)</h1><button id="noop-churn">Churn</button></body></html>');
  }
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"/><title>6E-M2 — react-datepicker verbatim clone</title>${head}</head><body>${body}<script>${js}</script></body></html>`);
}).listen(PORT, '127.0.0.1', () => console.log('6F-M3 fixture on', PORT));
