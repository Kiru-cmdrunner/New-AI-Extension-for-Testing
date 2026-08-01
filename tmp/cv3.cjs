const { chromium } = require('playwright');

async function runValidation() {
  const browser = await chromium.launch({
    executablePath: '/usr/bin/google-chrome',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const injectFn = `
    function captureElementVisibility(el) {
      const cs = window.getComputedStyle(el);
      return { display: cs.display, visibility: cs.visibility, opacity: cs.opacity };
    }
    function isInvisible(s) { return s.display==='none'||s.visibility==='hidden'||s.opacity==='0'; }
    function isVisible(s) { return !isInvisible(s); }
    function takeVisibilitySnapshot(root) {
      const states = [captureElementVisibility(root)];
      const d = root.querySelectorAll('*');
      for (let i=0;i<d.length;i++) states.push(captureElementVisibility(d[i]));
      return { states };
    }
    function takePreHoverSnapshot(root) {
      const clone = root.cloneNode(true);
      const container = document.createElement('div');
      container.style.cssText = 'position:absolute;left:-9999px;top:-9999px;width:1px;height:1px;overflow:hidden;pointer-events:none;';
      container.appendChild(clone);
      document.body.appendChild(container);
      const snap = takeVisibilitySnapshot(clone);
      container.remove();
      return snap;
    }
    function detectVisibilityTransition(baseline, root) {
      const current = takeVisibilitySnapshot(root);
      let tc = 0;
      for (let i=0;i<baseline.states.length&&i<current.states.length;i++)
        if (isInvisible(baseline.states[i])&&isVisible(current.states[i])) tc++;
      return { qualified: tc>0, transitionCount: tc };
    }
    let moQualified = false;
    let moMutations = [];
    function setupMO(element) {
      moQualified = false;
      moMutations = [];
      const obs = new MutationObserver((muts) => {
        for (const m of muts) {
          moMutations.push({ type: m.type, attr: m.attributeName });
          if (m.type === 'childList' && (m.addedNodes.length || m.removedNodes.length)) moQualified = true;
          if (m.type === 'attributes') {
            if (m.attributeName === 'class' || m.attributeName === 'style' ||
                m.attributeName === 'hidden' || m.attributeName === 'aria-hidden') moQualified = true;
          }
        }
      });
      obs.observe(element, { childList: true, attributes: true, subtree: true,
        attributeFilter: ['style','class','hidden','aria-hidden','aria-expanded'] });
    }
    window.__testBoth = function(rootSel, triggerSel) {
      const root = document.querySelector(rootSel);
      const trigger = document.querySelector(triggerSel);
      if (!root) return { error: 'root not found' };
      setupMO(root);
      const baseline = takePreHoverSnapshot(root);
      const visResult = detectVisibilityTransition(baseline, root);
      const overallQualified = moQualified || visResult.qualified;
      return {
        totalElements: baseline.states.length,
        moQualified,
        moMutationCount: moMutations.length,
        visQualified: visResult.qualified,
        visTransitionCount: visResult.transitionCount,
        overallQualified,
        qualifiedBy: moQualified ? 'mutation-observer' : (visResult.qualified ? 'visibility-transition' : 'none')
      };
    };
  `;

  const jsPatterns = [
    { name: 'JS inline style menu', expect: true,
      html: '<div id="parent"><a href="#" id="trigger">JS Menu</a><ul id="submenu" style="display:none;"><li><a href="/1">Item 1</a></li></ul></div><scr' + 'ipt>document.getElementById("trigger").addEventListener("mouseenter",function(){document.getElementById("submenu").style.display="block";});document.getElementById("trigger").addEventListener("mouseleave",function(){document.getElementById("submenu").style.display="none";});</scr' + 'ipt>' },
    { name: 'React-style state menu', expect: true,
      html: '<div id="parent"><button id="trigger">Toggle</button><div id="menu" style="display:none;"><a href="/1">Option 1</a></div></div><scr' + 'ipt>var t=document.getElementById("trigger"),m=document.getElementById("menu");t.addEventListener("mouseenter",function(){m.style.display="block";});t.addEventListener("mouseleave",function(){m.style.display="none";});</scr' + 'ipt>' },
    { name: 'Vue-style class toggle', expect: true,
      html: '<style>.vi>.vd{display:none;}.vi.a>.vd{display:block;}</style><div id="parent" class="vi"><a href="#" id="trigger">Vue</a><div class="vd"><a href="/a">Action</a></div></div><scr' + 'ipt>var p=document.getElementById("parent");document.getElementById("trigger").addEventListener("mouseenter",function(){p.classList.add("a");});p.addEventListener("mouseleave",function(){p.classList.remove("a");});</scr' + 'ipt>' },
    { name: 'Angular-style class toggle', expect: true,
      html: '<style>.nd{display:none;}.no .nd{display:block;}</style><div id="parent"><button id="trigger">Angular</button><div class="nd"><a href="/1">Opt 1</a></div></div><scr' + 'ipt>var p=document.getElementById("parent");document.getElementById("trigger").addEventListener("mouseenter",function(){p.classList.add("no");});p.addEventListener("mouseleave",function(){p.classList.remove("no");});</scr' + 'ipt>' }
  ];

  console.log('=== JS-Driven Patterns with MO on PARENT (correct scope) ===\n');
  let pass = 0, fail = 0;
  for (const p of jsPatterns) {
    const page = await browser.newPage();
    await page.setContent(p.html);
    await page.evaluate('(function(){' + injectFn + '})()');
    await page.mouse.move(10, 10);
    await page.waitForTimeout(50);
    await page.hover('#trigger');
    await page.waitForTimeout(300);
    const r = await page.evaluate(() => window.__testBoth('#parent', '#trigger'));
    const correct = r.overallQualified === p.expect;
    if (correct) pass++; else fail++;
    console.log((correct ? 'PASS' : 'FAIL') + ' ' + p.name +
      '  [MO:' + r.moQualified + '/' + r.moMutationCount + 'mut Clone:' + r.visQualified + '/' + r.visTransitionCount + 'tr] => ' + r.qualifiedBy);
    await page.close();
  }
  console.log('\nTotal: ' + pass + ' passed, ' + fail + ' failed of ' + jsPatterns.length);
  await browser.close();
}
runValidation().catch(console.error);
