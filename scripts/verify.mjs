import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
const root = resolve('.');
const mime = {'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.jpeg':'image/jpeg'};
const server = createServer(async (req,res) => {
  try {
    const path = resolve(root, '.' + decodeURIComponent(new URL(req.url,'http://localhost').pathname === '/' ? '/index.html' : new URL(req.url,'http://localhost').pathname));
    if (!path.startsWith(root + '/')) {res.writeHead(403).end();return;}
    res.writeHead(200,{'Content-Type':mime[extname(path)] || 'text/plain'}).end(await readFile(path));
  } catch {res.writeHead(404).end();}
});
await new Promise(r=>server.listen(8765,'127.0.0.1',r));
await mkdir('verification',{recursive:true});
let browser;
try {
  browser = await chromium.launch({headless:true});
  const page = await browser.newPage({viewport:{width:1440,height:1050}});
  const errors=[]; page.on('pageerror', e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:8765');
  await page.waitForSelector('#animated-heading>span');
  await page.waitForTimeout(1200);
  assert.equal(await page.locator('.card').count(),10);
  assert.ok(await page.locator('.logo').evaluate(e=>e.complete&&e.naturalWidth>0));
  await page.screenshot({path:'verification/desktop.png',fullPage:true});
  await page.locator('.card').first().click();
  await page.waitForSelector('.photo-card img');
  assert.equal(await page.locator('#photo-count').textContent(),'ภาพ 1 / 2');
  assert.equal(await page.locator('.photo-card img').first().evaluate(e=>getComputedStyle(e).objectFit),'contain');
  await page.waitForTimeout(3000);
  assert.equal(await page.locator('#photo-count').textContent(),'ภาพ 2 / 2');
  await page.waitForTimeout(3000);
  assert.equal(await page.locator('#photo-count').textContent(),'ภาพ 1 / 2');
  await page.locator('#pause').click();
  await page.waitForTimeout(6000);
  assert.equal(await page.locator('#photo-count').textContent(),'ภาพ 1 / 2');
  await page.locator('#next').click();
  await page.waitForTimeout(700);
  assert.equal(await page.locator('#photo-count').textContent(),'ภาพ 2 / 2');
  await page.screenshot({path:'verification/gallery.png'});
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#detail').evaluate(e=>e.open),false);
  assert.equal(await page.locator('.card').first().evaluate(e=>e===document.activeElement),true);
  await page.locator('#q').fill('อาคาร 11');
  assert.equal(await page.locator('.card').count(),1);
  assert.equal(await page.locator('.pin:not(.filtered)').count(),1);
  await page.locator('.card').click();
  await page.waitForSelector('.photo-card img');
  assert.equal(await page.locator('.photo-card').count(),1);
  assert.equal(await page.locator('#next').isVisible(),false);
  await page.keyboard.press('Escape');
  await page.locator('#reset').click();
  assert.equal(await page.locator('.card').count(),10);
  await page.setViewportSize({width:390,height:844});
  await page.waitForTimeout(1000);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.screenshot({path:'verification/mobile.png',fullPage:true});
  await page.locator('.card').first().click();
  await page.waitForSelector('.photo-card img');
  await page.locator('#pause').click();
  await page.waitForTimeout(800);
  assert.ok(await page.locator('#detail').evaluate(e=>{const r=e.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth;}));
  await page.screenshot({path:'verification/mobile-gallery.png'});
  // Swipe and keyboard navigation use the existing gallery state/timer.
  await page.locator('#gallery').evaluate(element => {
    const start = new Touch({identifier:1,target:element,clientX:250,clientY:100});
    const end = new Touch({identifier:1,target:element,clientX:100,clientY:100});
    element.dispatchEvent(new TouchEvent('touchstart',{bubbles:true,touches:[start],changedTouches:[start]}));
    element.dispatchEvent(new TouchEvent('touchend',{bubbles:true,touches:[],changedTouches:[end]}));
  });
  assert.equal(await page.locator('#photo-count').textContent(),'ภาพ 2 / 2');
  await page.keyboard.press('Escape');
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.locator('.card').first().click();
  await page.waitForSelector('.photo-card img');
  await page.waitForTimeout(6000);
  assert.equal(await page.locator('#photo-count').textContent(),'ภาพ 1 / 2');
  assert.equal(await page.locator('#pause').getAttribute('aria-pressed'),'true');
  assert.deepEqual(errors,[]);
  // Optional enhancement failure must leave the original static gallery functional.
  const fallback = await browser.newPage();
  await fallback.route('**/assets/*.js',route=>route.abort());
  await fallback.goto('http://127.0.0.1:8765');
  await fallback.locator('.card').first().click();
  await fallback.waitForSelector('.slide.current');
  assert.equal(await fallback.locator('.slide').count(),2);
  assert.equal(await fallback.locator('.slide').first().evaluate(e=>getComputedStyle(e).objectFit),'contain');
  console.log('PASS: desktop/mobile, full-image cards, 3000ms rotation, pause, buttons, search, single image, focus return, swipe, reduced motion, optional-bundle failure, no page errors.');
} finally {
  await browser?.close(); server.close();
}
