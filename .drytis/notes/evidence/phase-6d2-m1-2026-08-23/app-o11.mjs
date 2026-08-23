// M1-A app: O11 nested-target repro surface. Three fixtures on one page:
//  (1) #btn-nested   <button> wrapping <i class="icon-star"> — mousedown lands on the
//      child, click resolves on the parent (the AdaniOne int-47/48 shape, RC1).
//  (2) #btn-flat     plain <button> — same-element control (S1' pairing expected).
//  (3) #sib-a / #sib-b two sibling <button>s — unrelated-adjacent control
//      (must stay TWO cards; never collapsible).
// No role/tabindex on the inner <i> so the press is not claimed by Click.
import http from 'node:http';

const PAGE = `<!doctype html><html><head><meta charset="utf-8">
<title>O11 Nested Press Fixture</title>
<style>
  body{font-family:system-ui;margin:24px;background:#fafafa}
  button{font-size:16px;padding:10px 16px;margin:6px;background:#eef;border:1px solid #99f;border-radius:6px}
  i{font-style:normal;margin-right:6px;color:#555}
  .mark{color:#0a7;min-height:1.2em;font-family:monospace}
</style></head><body>
<main id="app">
  <h3>O11 fixtures</h3>
  <p><button id="btn-nested"><i class="icon-star"></i>Favorite</button>
     <span class="mark" id="m-nested"></span></p>
  <!-- The ACTUAL AdaniOne int-47/48 shape: non-interactive parent + child span.
       role=listitem is NOT interactive; nothing here is a button/link/control. -->
  <ul id="trip-type" style="list-style:none;padding:0">
    <li id="wrap-nested" role="listitem" style="padding:8px 12px;border:1px solid #ccc;display:inline-block;cursor:pointer">
      <span class="icon-radio"></span>Round Trip
    </li>
  </ul>
  <span class="mark" id="m-wrap"></span>
  <!-- Target-asymmetry shape: mousedown lands on a TARGET-WORTHY child
       (role=button + name), which is REMOVED on mousedown (optimistic-UI /
       press-consume pattern). Mouseup + click then resolve to the parent LI.
       This is the only structural way mousedown and click resolve differently. -->
  <ul id="swap-case" style="list-style:none;padding:0">
    <li id="wrap-swap" role="listitem" style="padding:8px 12px;border:1px solid #ccc;display:inline-block;cursor:pointer">
      <span role="button" aria-label="Star" id="inner-star">★</span> Swap Case
    </li>
  </ul>
  <span class="mark" id="m-swap"></span>
  <!-- Cross-target press: down on one named control, up on a DIFFERENT named
       control (a genuine drag-to-different-target). Browsers dispatch NO click
       here either; we keep it as the honest two-event shape (both events exist,
       both resolve to targets, no click at all). -->
  <p id="cross-row" style="margin-top:10px">
    <span role="button" aria-label="Source pill" id="pill-a" style="display:inline-block;padding:8px 14px;border:1px solid #888;border-radius:16px;cursor:pointer">Source</span>
    <span role="button" aria-label="Target pill" id="pill-b" style="display:inline-block;padding:8px 14px;border:1px solid #888;border-radius:16px;cursor:pointer;margin-left:8px">Target</span>
  </p>
  <span class="mark" id="m-cross"></span>
  <p><button id="btn-flat">Plain button</button>
     <span class="mark" id="m-flat"></span></p>
  <p><button id="sib-a">Sibling A</button><button id="sib-b">Sibling B</button>
     <span class="mark" id="m-sib"></span></p>
</main>
<script>
  // Deterministic press feedback so the recorder's consequence-settling has
  // something structural to observe (text swap on the mark span).
  const mk = (id) => { const m = document.getElementById(id); let n = 0;
    return () => { m.textContent = 'pressed ' + (++n); }; };
  document.getElementById('btn-nested').addEventListener('click', mk('m-nested'));
  document.getElementById('wrap-nested').addEventListener('click', mk('m-wrap'));
  // Swap case: the mousedown target is consumed the moment it is pressed.
  const wrapSwap = document.getElementById('wrap-swap');
  wrapSwap.addEventListener('mousedown', () => {
    const star = document.getElementById('inner-star');
    if (star) star.remove(); // press consumes the control (optimistic UI)
  });
  wrapSwap.addEventListener('click', () => { mk('m-swap')(); wrapSwap.resetStar(); });
  wrapSwap.resetStar = () => {
    if (!document.getElementById('inner-star')) {
      const s = document.createElement('span');
      s.role = 'button'; s.setAttribute('role', 'button'); s.setAttribute('aria-label', 'Star');
      s.id = 'inner-star'; s.textContent = '★';
      wrapSwap.insertBefore(s, wrapSwap.firstChild);
    }
  };
  document.getElementById('btn-flat').addEventListener('click', mk('m-flat'));
  // Cross-target: no click handlers at all — we only want the two physical
  // events (mousedown on Source, mouseup on Target; no click dispatched).
  document.getElementById('pill-a').addEventListener('mousedown', () => { document.getElementById('m-cross').textContent = 'down'; });
  document.getElementById('pill-b').addEventListener('mouseup', () => { document.getElementById('m-cross').textContent = 'down+up'; });
  document.getElementById('sib-a').addEventListener('click', mk('m-sib'));
  document.getElementById('sib-b').addEventListener('click', mk('m-sib'));
</script>
</body></html>`;

http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(PAGE);
}).listen(8188, '127.0.0.1', () => console.log('o11 app on 8188'));
