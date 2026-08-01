const { chromium } = require('playwright');

async function runValidation() {
  const browser = await chromium.launch({
    executablePath: '/usr/bin/google-chrome',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const results = [];
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
    function setupMutationObserver(target) {
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
      obs.observe(target, { childList: true, attributes: true, subtree: true,
        attributeFilter: ['style','class','hidden','aria-hidden','aria-expanded'] });
    }
    window.__testBoth = function(rootSelector, triggerSelector) {
      const root = document.querySelector(rootSelector);
      const trigger = document.querySelector(triggerSelector);
      if (!root) return { error: 'root not found' };
      setupMutationObserver(trigger);
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

  const patterns = [
    { name: 'CSS-only mega menu', expect: true,
      html: '<style>.sp>.sm{display:none;}.sp:hover>.sm{display:block;}</style><div id="parent" class="sp"><a href="#" id="trigger">Services</a><ul class="sm"><li><a href="/1">Book Flight</a></li></ul></div>' },
    { name: 'CSS-only tooltip', expect: true,
      html: '<style>.tc>.tt{display:none;}.tc:hover>.tt{display:block;}</style><div id="parent" class="tc"><span id="trigger">Help</span><div class="tt">Helpful text</div></div>' },
    { name: 'CSS opacity transition', expect: true,
      html: '<style>.ot>.oc{opacity:0;}.ot:hover>.oc{opacity:1;}</style><div id="parent" class="ot"><span id="trigger">Image</span><div class="oc"><button>View</button></div></div>' },
    { name: 'CSS visibility fade', expect: true,
      html: '<style>.fp>.fd{visibility:hidden;opacity:0;}.fp:hover>.fd{visibility:visible;opacity:1;}</style><div id="parent" class="fp"><a href="#" id="trigger">Reveal</a><div class="fd"><button>Action</button></div></div>' },
    { name: 'CSS sibling selector', expect: true,
      html: '<style>.te~.sp{display:none;}.te:hover~.sp{display:block;}</style><div id="parent"><span class="te" id="trigger">Hover</span><div class="sp"><a href="/a">Link A</a></div></div>' },
    { name: 'Nested menus', expect: true,
      html: '<style>.l1>.l2{display:none;}.l1:hover>.l2{display:block;}.l2i>.l3{display:none;}.l2i:hover>.l3{display:block;}</style><div id="parent" class="l1"><a href="#" id="trigger">Products</a><div class="l2"><div class="l2i"><a href="/e">Electronics</a><div class="l3"><a href="/p">Phones</a></div></div></div></div>' },
    { name: 'CSS-in-JS styled-components', expect: true,
      html: '<style>.sa>.sb{display:none;}.sa:hover>.sb{display:block;}</style><div id="parent" class="sa"><button id="trigger">Styled</button><div class="sb"><a href="/1">Opt 1</a></div></div>' },
    { name: 'Hover action buttons', expect: true,
      html: '<style>.row>.act{opacity:0;visibility:hidden;}.row:hover>.act{opacity:1;visibility:visible;}</style><div id="parent" class="row"><span id="trigger">Data Row</span><div class="act"><button>Edit</button><button>Delete</button></div></div>' },
    { name: 'JS inline style menu', expect: true,
      html: '<div id="parent"><a href="#" id="trigger">JS Menu</a><ul id="submenu" style="display: none;"><li><a href="/1">Item 1</a></li></ul></div><scr' + 'ipt>document.getElementById("trigger").addEventListener("mouseenter",function(){document.getElementById("submenu").style.display="block";});document.getElementById("trigger").addEventListener("mouseleave",function(){document.getElementById("submenu").style.display="none";});</scr' + 'ipt>' },
    { name: 'React-style state menu', expect: true,
      html: '<div id="parent"><button id="trigger">Toggle</button><div id="menu" style="display: none;"><a href="/1">Option 1</a></div></div><scr' + 'ipt>var t=document.getElementById("trigger"),m=document.getElementById("menu");t.addEventListener("mouseenter",function(){m.style.display="block";});t.addEventListener("mouseleave",function(){m.style.display="none";});</scr' + 'ipt>' },
    { name: 'Vue-style class toggle', expect: true,
      html: '<style>.vi>.vd{display:none;}.vi.a>.vd{display:block;}</style><div id="parent" class="vi"><a href="#" id="trigger">Vue</a><div class="vd"><a href="/a">Action</a></div></div><scr' + 'ipt>var p=document.getElementById("parent");document.getElementById("trigger").addEventListener("mouseenter",function(){p.classList.add("a");});p.addEventListener("mouseleave",function(){p.classList.remove("a");});</scr' + 'ipt>' },
    { name: 'Angular-style class toggle', expect: true,
      html: '<style>.nd{display:none;}.no .nd{display:block;}</style><div id="parent"><button id="trigger">Angular</button><div class="nd"><a href="/1">Opt 1</a></div></div><scr' + 'ipt>var p=document.getElementById("parent");document.getElementById("trigger").addEventListener("mouseenter",function(){p.classList.add("no");});p.addEventListener("mouseleave",function(){p.classList.remove("no");});</scr' + 'ipt>' },
    { name: 'Cosmetic-only hover (NEGATIVE)', expect: false,
      html: '<style>.btn{background:blue;}.btn:hover{background:darkblue;cursor:pointer;}</style><div id="parent"><button class="btn" id="trigger">Submit</button></div>' },
    { name: 'Always-visible content (NEGATIVE)', expect: false,
      html: '<div id="parent"><a href="#" id="trigger">Link</a><p>Visible</p></div>' },
    { name: 'Deep enterprise nav', expect: true,
      html: '<style>.mega>.panel{display:none;}.mega:hover>.panel{display:block;}</style><div id="parent" class="mega"><a href="#" id="trigger">Enterprise</a><div class="panel">' + Array.from({length:100},(_,i)=>'<a href="/l'+i+'">L'+i+'</a>').join('') + '</div></div>' }
  ];

  console.log('=== OR LOGIC VALIDATION (MutationObserver + DOM Clone) ===\n');
  let pass = 0, fail = 0;

  for (const p of patterns) {
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
    results.push({ name: p.name, ...r, correct });
    await page.close();
  }

  console.log('\nTotal: ' + pass + ' passed, ' + fail + ' failed of ' + results.length);
  await browser.close();
}

runValidation().catch(console.error);
