import json, sys
from playwright.sync_api import sync_playwright

toks = json.load(open('/tmp/toks.json'))
errors = []

with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/root/.cache/ms-playwright/chromium-1217/chrome-linux64/chrome', args=['--no-sandbox'])
    pg = b.new_page(viewport={'width': 1440, 'height': 900})
    pg.on('pageerror', lambda e: errors.append(str(e)))
    pg.goto('http://localhost:3000/app.html', wait_until='domcontentloaded')
    pg.evaluate("""([t,u]) => { localStorage.setItem('cr_token', t); localStorage.setItem('cr_user', JSON.stringify(u)); }""",
                [toks['owner'], {'id': toks['owner_id'], 'username': toks['owner_name']}])
    pg.goto('http://localhost:3000/app.html', wait_until='domcontentloaded')
    pg.wait_for_timeout(9000)

    # open the server
    pg.evaluate("""() => { const el=[...document.querySelectorAll('.rail-item')].find(e=>e.innerText.trim()==='GL'); if(el) el.click(); }""")
    pg.wait_for_timeout(2500)

    # member list chip size
    info = pg.evaluate("""() => {
      const rows=[...document.querySelectorAll('.member')];
      const withBadge=rows.filter(r=>r.querySelector('.badge-chip'));
      if(!withBadge.length) return {rows:rows.length, chips:0};
      const c=withBadge[0].querySelector('.badge-chip.compact');
      const img=c.querySelector('img');
      const r=c.getBoundingClientRect(), ir=img.getBoundingClientRect();
      return {rows:rows.length, chips:withBadge.length, chipH:r.height, chipW:r.width, imgW:ir.width, imgH:ir.height, text:c.textContent.trim()};
    }""")
    print('MEMBER LIST:', info)
    pg.screenshot(path='/workspace/round10/shot_members.png')

    # click that member to open profile
    pg.evaluate("""() => { const r=[...document.querySelectorAll('.member')].find(x=>x.querySelector('.badge-chip')); if(r) r.click(); }""")
    pg.wait_for_timeout(1800)
    pinfo = pg.evaluate("""() => {
      const chips=[...document.querySelectorAll('.badge-chip.lg')];
      if(!chips.length) return {lg:0};
      const c=chips[0], img=c.querySelector('img');
      const r=c.getBoundingClientRect(), ir=img.getBoundingClientRect();
      return {lg:chips.length, chipH:r.height, chipW:r.width, imgW:ir.width, imgH:ir.height, text:c.textContent.trim(),
              wrap: !!c.closest('.dp-badges') ? 'dp-badges' : (c.closest('.profile-badges')?'profile-badges':'other')};
    }""")
    print('PROFILE MODAL:', pinfo)
    pg.screenshot(path='/workspace/round10/shot_profile.png')

    print('JS ERRORS:', errors)
    b.close()
