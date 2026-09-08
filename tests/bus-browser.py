"""Browser tests use synthetic responses; no live ETA claims are made."""
import json
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
HTML=(ROOT/'bus/index.html').read_text().replace('<link rel="stylesheet" href="./theme.v2.css">','<style>'+(ROOT/'bus/theme.v2.css').read_text()+'</style>').replace('<script type="module" src="./app.v2.mjs"></script>','')
SCRIPT=(ROOT/'bus/domain.v2.mjs').read_text().replace('export ', '')+'\n'+(ROOT/'bus/app.v2.mjs').read_text().split('\n',1)[1]
def mount(page, initial='screenshot'):
    page.set_content(HTML)
    page.evaluate("""mode => {
      window.__mode = mode;
      window.fetch = async input => {
        const isB = String(input).includes('backward=1');
        if(window.__mode === 'failure' && isB) throw new TypeError('mock network failure');
        const bad = {line:'111路🚌',destination:'公交民辉站',estimated_time:'0分⏱',remaining_stations:'23站',expected_arrival:'1970-01-01 07:59'};
        let items = [];
        if(isB && window.__mode === 'screenshot') items=[bad,{...bad,line:'971路🚌',remaining_stations:'14站'}];
        if(isB && window.__mode === 'valid') items=[{...bad,line:'测试有效线路',estimated_time:'3分',remaining_stations:'2站',expected_arrival:null},bad];
        if(isB && window.__mode === 'xss') items=[{...bad,line:'<img src=x onerror=alert(1)>',estimated_time:'3分',remaining_stations:'2站',expected_arrival:null}];
        return new Response(JSON.stringify({code:200,data:{'台州-群辉':items}}),{status:200,headers:{'Content-Type':'application/json'}});
      };
    }""", initial)
    page.add_script_tag(type='module',content=SCRIPT)
errors=[]; checks=[]
def record(**changes):
    d={'line':'111路🚌','destination':'公交民辉站','estimated_time':'0分⏱','remaining_stations':'23站','expected_arrival':'1970-01-01 07:59'}
    d.update(changes);return d
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox'])
    for width,height in [(320,740),(390,844),(430,932),(1280,900)]:
        context=browser.new_context(viewport={'width':width,'height':height},device_scale_factor=1,timezone_id='America/Los_Angeles')
        page=context.new_page();page.on('pageerror',lambda e: errors.append(str(e)))
        mount(page);page.wait_for_selector('body[data-state="ready"]');page.wait_for_timeout(1100)
        body=page.locator('body').inner_text()
        assert '1970' not in body
        assert '0分' not in body
        assert '23 站' in body
        assert page.locator('#winner').get_attribute('data-state')=='uncertain'
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'),width
        page.locator('.settings summary').click()
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'),f'inputs overflow {width}'
        page.locator('.settings summary').click()
        if width==390:page.screenshot(path=str(ROOT/'regression-mobile.png'),full_page=True)
        checks.append(f'{width}px: screenshot values rejected; no horizontal overflow, including expanded form')
        context.close()
    context=browser.new_context(viewport={'width':390,'height':844})
    page=context.new_page();page.on('pageerror',lambda e: errors.append(str(e)))
    mount(page,'valid');page.wait_for_selector('body[data-state="ready"]')
    assert '测试有效线路' in page.locator('#winner').inner_text()
    assert '1970' not in page.locator('body').inner_text()
    checks.append('valid estimate beats quarantined zero/epoch record')
    page.evaluate("window.__mode='failure'");page.locator('#refresh').click();page.wait_for_selector('body[data-state="ready"]')
    assert page.locator('#winner').get_attribute('data-state')=='uncertain'
    assert '旧记录' in page.locator('#list').inner_text()
    page.locator('#all').click();page.locator('#minhui').click()
    assert page.locator('#winner').get_attribute('data-state')=='uncertain'
    checks.append('failed B direction + filter toggling never revalidates old data')
    page.evaluate("window.__mode='empty'");page.locator('#refresh').click();page.wait_for_selector('body[data-state="ready"]')
    assert page.locator('.bus').count()==0
    checks.append('successful empty result clears old buses')
    page.evaluate("window.__mode='xss'");page.locator('#refresh').click();page.wait_for_selector('body[data-state="ready"]')
    assert page.locator('#list img').count()==0
    assert '<img' in page.locator('#list').inner_text()
    checks.append('upstream HTML rendered as text, never executed')
    page.evaluate("window.__mode='valid'");page.locator('#refresh').click();page.wait_for_selector('body[data-state="ready"]')
    page.evaluate("window.dispatchEvent(new Event('offline'))")
    assert page.locator('#winner').get_attribute('data-state')=='offline'
    checks.append('offline event immediately removes recommendation')
    page.locator('.settings summary').click();page.locator('#site').fill('新站点');page.locator('#query-form button').click()
    assert '111' not in page.locator('#list').inner_text()
    checks.append('changing boarding station clears old station records even offline')
    context.close();browser.close()
assert not errors, errors
for c in checks:print('PASS',c)
(ROOT/'browser-results.json').write_text(json.dumps({'checks':checks,'page_errors':errors,'engine':'local Chromium; inline local HTML/CSS/JS with mocked fetch; no live network or module loader test'},ensure_ascii=False,indent=2))
