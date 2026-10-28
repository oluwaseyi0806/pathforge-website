// Browser tests for the PathForge website: layout at phone/tablet/desktop widths,
// accessibility (axe), touch targets, the menu, the sign-up forms and the Ask chat.
// The sign-up and Ask servers are imitated, so nothing real is sent anywhere.
// Run:  npm install  &&  npx playwright install chromium  &&  npm test
const http = require('http'), fs = require('fs'), path = require('path');
const { chromium } = require('playwright');
const ROOT = path.join(__dirname, '..', 'pathforge');
const SHOTS = process.env.SHOTS || '';   // set SHOTS=folder to save screenshots
const TYPES = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.svg':'image/svg+xml', '.webp':'image/webp', '.png':'image/png' };
let signupStatus = 200, signupBody = { ok: true };
const srv = http.createServer((req, res) => {
  const u = req.url.split('?')[0];
  if (u === '/api/signup') { setTimeout(() => { res.writeHead(signupStatus, {'Content-Type':'application/json'}); res.end(JSON.stringify(signupBody)); }, 600); return; }
  if (u === '/api/ask') { setTimeout(() => { res.writeHead(200, {'Content-Type':'application/json'}); res.end(JSON.stringify({ answer: 'Test answer.' })); }, 800); return; }
  const f = path.join(ROOT, u === '/' ? 'index.html' : u);
  fs.readFile(f, (e, d) => { if (e) { res.writeHead(404); res.end(); return; } res.writeHead(200, {'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream'}); res.end(d); });
}).listen(8099, '127.0.0.1');
const FAKE_TS = `window.turnstile={render:function(s,o){setTimeout(function(){o.callback('tok')},50);return 1},reset:function(){}};window.pfTurnstileReady&&window.pfTurnstileReady();`;
const axe = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const fails = []; const ok = (c, m) => { if (!c) fails.push(m); console.log((c ? 'PASS ' : 'FAIL ') + m); };
(async () => {
  const b = await chromium.launch();
  async function page(w, scheme, extra = {}) {
    const ctx = await b.newContext({ viewport: { width: w, height: w < 500 ? 800 : 900 }, colorScheme: scheme, ...extra });
    await ctx.route(/challenges\.cloudflare\.com/, r => r.fulfill({ contentType: 'text/javascript', body: FAKE_TS }));
    await ctx.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
    const p = await ctx.newPage(); p._errors = [];
    p.on('pageerror', e => p._errors.push(e.message));
    p.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) p._errors.push(m.text()); });
    return p;
  }
  // layout, contrast, touch targets on every page, 3 widths, light + dark
  for (const scheme of ['light', 'dark']) for (const w of [375, 768, 1280]) for (const pg of ['index', 'about', 'privacy', 'terms', 'refund']) {
    const p = await page(w, scheme);
    await p.goto(`http://localhost:8099/${pg}.html`); await p.waitForTimeout(300);
    const sw = await p.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    ok(sw <= 0, `${pg} ${w} ${scheme}: no sideways scroll (${sw})`);
    await p.addScriptTag({ content: axe });
    const r = await p.evaluate(() => axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21aa', 'best-practice'] }));
    const v = r.violations.map(x => `${x.id}(${x.nodes.length}): ${x.nodes.slice(0,3).map(n => n.target.join(' ')).join(' | ')}`);
    ok(!v.length, `${pg} ${w} ${scheme}: axe ${v.join('; ')}`);
    const small = await p.evaluate(() => Array.from(document.querySelectorAll('button, .btn, .nav a, .drawer a, .foot a, input, summary, .ask-chip')).filter(e => {
      const r = e.getBoundingClientRect(); if (!r.width || e.closest('[hidden]') || e.closest('.hp')) return false;
      if (e.type === 'checkbox') return false;   // label is the target
      return r.height < 44 || (e.tagName === 'BUTTON' && r.width < 44);
    }).map(e => (e.className || e.tagName) + ':' + (e.textContent || e.id).trim().slice(0, 20) + ' ' + Math.round(e.getBoundingClientRect().height)));
    ok(!small.length, `${pg} ${w} ${scheme}: touch targets ${small.join(', ')}`);
    if (SHOTS && pg === 'index') await p.screenshot({ path: path.join(SHOTS, `index-${w}-${scheme}.png`), fullPage: true });
    ok(!p._errors.length, `${pg} ${w} ${scheme}: console ${p._errors.join(' / ')}`);
    await p.context().close();
  }
  // phone menu
  {
    const p = await page(375, 'light');
    await p.goto('http://localhost:8099/index.html');
    ok(!(await p.isVisible('.nav a.wide')), 'phone: desktop links hidden');
    await p.click('#menu-btn'); await p.waitForTimeout(300);
    ok(await p.evaluate(() => document.activeElement.id === 'drawer-close'), 'menu: focus moves to close button');
    ok(await p.evaluate(() => document.querySelector('main').inert), 'menu: page behind is inert');
    for (let i = 0; i < 12; i++) await p.keyboard.press('Tab');
    ok(await p.evaluate(() => !!document.activeElement.closest('#drawer') && !document.activeElement.closest('[hidden]')), 'menu: Tab stays in visible menu items');
    await p.keyboard.press('Shift+Tab'); await p.keyboard.press('Shift+Tab');
    ok(await p.evaluate(() => !!document.activeElement.closest('#drawer')), 'menu: Shift+Tab stays in menu');
    await p.keyboard.press('Escape'); await p.waitForTimeout(300);
    ok(await p.evaluate(() => document.activeElement.id === 'menu-btn' && !document.querySelector('main').inert && document.getElementById('drawer').hidden), 'menu: Escape closes, focus back, page usable');
    await p.context().close();
  }
  // skip link + current section
  {
    const p = await page(1280, 'light');
    await p.goto('http://localhost:8099/index.html');
    await p.keyboard.press('Tab');
    ok(await p.evaluate(() => document.activeElement.className === 'skip' && document.activeElement.getBoundingClientRect().top >= 0), 'skip link shows on first Tab');
    await p.keyboard.press('Enter'); await p.waitForTimeout(200);
    ok(await p.evaluate(() => document.activeElement.id === 'top'), 'skip link moves focus to main');
    await p.evaluate(() => window.scrollTo({ top: document.getElementById('check').offsetTop - 80, behavior: 'instant' })); await p.waitForTimeout(300);
    ok(await p.evaluate(() => document.querySelector('.nav a[href="#check"]').getAttribute('aria-current') === 'location'), 'scroll to #check highlights Safety check');
    await p.evaluate(() => window.scrollTo({ top: document.getElementById('features').offsetTop - 80, behavior: 'instant' })); await p.waitForTimeout(300);
    ok(await p.evaluate(() => !document.querySelector('.nav a[aria-current]')), 'untracked section: nothing highlighted');
    await p.evaluate(() => window.scrollTo({ top: document.body.scrollHeight, behavior: 'instant' })); await p.waitForTimeout(300);
    ok(await p.evaluate(() => document.querySelector('.nav a[href="#faq"]').getAttribute('aria-current') === 'location'), 'page bottom highlights FAQ');
    // anchor not hidden under sticky header
    await p.click('.nav a[href="#how"]'); await p.waitForTimeout(900);
    ok(await p.evaluate(() => document.querySelector('#how h2').getBoundingClientRect().top >= document.getElementById('head').offsetHeight), 'anchor heading lands below sticky header');
    await p.context().close();
  }
  // forms
  {
    const p = await page(375, 'light');
    await p.goto('http://localhost:8099/index.html'); await p.waitForTimeout(300);
    await p.click('#wl-go');
    const st = await p.evaluate(() => ({
      errs: Array.from(document.querySelectorAll('#wl .field-err:not([hidden])')).map(e => e.textContent),
      inv: Array.from(document.querySelectorAll('#wl [aria-invalid=true]')).map(e => e.id),
      focus: document.activeElement.id, notice: document.getElementById('wl-msg').hidden,
      desc: document.getElementById('wl-email').getAttribute('aria-describedby') }));
        ok(st.errs.join('|') === 'Enter your name.|Enter a valid email address, like name@example.com.|Tick the box to agree.', 'form: one error under each field, same wording');
    ok(st.inv.join() === 'wl-name,wl-email,wl-ok' && st.focus === 'wl-name' && st.desc === 'wl-email-err', 'form: aria-invalid, describedby, focus first problem');
    await p.fill('#wl-name', 'Ada');
    ok(await p.evaluate(() => !document.getElementById('wl-name').hasAttribute('aria-invalid')), 'form: error clears while typing');
    await p.fill('#wl-email', 'ada@example.com'); await p.check('#wl-ok');
    await p.click('#wl-go'); await p.waitForTimeout(150);
    ok(await p.evaluate(() => { const b = document.getElementById('wl-go'); return b.classList.contains('is-loading') && b.disabled && b.textContent === 'Sending...' && document.getElementById('wl').getAttribute('aria-busy') === 'true'; }), 'form: spinner + Sending... while waiting');
    await p.waitForTimeout(800);
    ok(await p.evaluate(() => { const m = document.getElementById('wl-msg'); return !m.hidden && m.textContent === "Thanks! We'll email ada@example.com when there's a new version." && document.getElementById('wl-go').textContent === 'Send me updates' && !document.getElementById('wl-go').classList.contains('is-loading'); }), 'form: success message unchanged, button restored');
    signupStatus = 400; signupBody = { message: 'That email address looks wrong.' };
    await p.fill('#wl-name', 'Ada'); await p.fill('#wl-email', 'ada@example.com'); await p.check('#wl-ok');
    await p.click('#wl-go'); await p.waitForTimeout(900);
    ok(await p.evaluate(() => { const m = document.getElementById('wl-msg'); return m.textContent === 'That email address looks wrong.' && m.getAttribute('role') === 'alert' && m.classList.contains('err'); }), 'form: server error shown as alert');
    signupStatus = 503;
    await p.fill('#tp-name', 'Ada'); await p.fill('#tp-email', 'ada@example.com'); await p.check('#tp-ok');
    await p.click('#tp button[type=submit]'); await p.waitForTimeout(900);
    ok(await p.evaluate(() => !document.querySelector('#tp .download').hidden), 'testpack: 503 fallback still shows download');
    // honeypot
    signupStatus = 500; let hit = false; p.on('request', r => { if (r.url().includes('/api/signup')) hit = true; });
    await p.evaluate(() => { document.getElementById('wl-company').value = 'bot'; });
    await p.fill('#wl-name', 'Bot'); await p.fill('#wl-email', 'b@b.co'); await p.check('#wl-ok');
    await p.click('#wl-go'); await p.waitForTimeout(300);
    ok(!hit, 'honeypot: bot submission not sent');
    ok(!p._errors.length, 'forms: console ' + p._errors.join(' / '));
    await p.context().close();
  }
  // chat
  {
    const p = await page(375, 'dark');
    await p.goto('http://localhost:8099/index.html');
    await p.click('#ask-fab'); await p.waitForTimeout(200);
    await p.fill('#ask-input', 'hello'); await p.keyboard.press('Enter'); await p.waitForTimeout(200);
    const t = await p.evaluate(() => ({ s: document.getElementById('ask-status').textContent, dots: !!document.querySelector('.ask-msg.typing .ask-dots') }));
    ok(t.s === 'PathForge is typing an answer...' && t.dots, 'chat: dots + screen reader typing status');
    await p.waitForTimeout(900);
    ok(await p.evaluate(() => !document.querySelector('.typing') && document.getElementById('ask-status').textContent === '' && /Test answer/.test(document.querySelector('.ask-log').textContent)), 'chat: answer replaces indicator');
    await p.addScriptTag({ content: axe });
    const r = await p.evaluate(() => axe.run(document.getElementById('ask-panel')));
    ok(!r.violations.length, 'chat: axe ' + r.violations.map(v => v.id + ':' + v.nodes.map(n=>n.target).join('|')).join('; '));
    await p.keyboard.press('Escape'); await p.waitForTimeout(250);
    ok(await p.evaluate(() => document.activeElement.id === 'ask-fab'), 'chat: Escape returns focus');
    await p.context().close();
  }
  // reduced motion
  {
    const p = await page(1280, 'light', { reducedMotion: 'reduce' });
    await p.goto('http://localhost:8099/index.html');
    ok(await p.evaluate(() => getComputedStyle(document.documentElement).scrollBehavior === 'auto'), 'reduced motion: no smooth scroll');
    await p.context().close();
  }
  await b.close(); srv.close();
  console.log(`\n${fails.length} failed`); fails.forEach(f => console.log(' - ' + f));
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
