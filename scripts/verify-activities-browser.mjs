import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
const root=resolve('.'),mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.jpeg':'image/jpeg'};
const server=createServer(async(req,res)=>{try{const p=resolve(root,'.'+new URL(req.url,'http://localhost').pathname);if(!p.startsWith(root+'/'))return res.writeHead(403).end();res.writeHead(200,{'Content-Type':mime[extname(p)]||'text/plain'}).end(await readFile(p));}catch{res.writeHead(404).end();}});
await new Promise(r=>server.listen(8766,'127.0.0.1',r));await mkdir('verification',{recursive:true});
let browser;const errors=[];
try{
 browser=await chromium.launch({headless:true});
 const p=await browser.newPage({viewport:{width:1440,height:1100}});p.on('pageerror',e=>errors.push(e.message));
 await p.goto('http://127.0.0.1:8766/activity.html');await p.waitForSelector('.a-podium-place');assert.equal(await p.locator('.a-podium-place').count(),3);assert.equal(await p.locator('.a-waiting').count(),3);assert.ok(await p.getByRole('button',{name:'ยังไม่เปิดรับกิจกรรม'}).isDisabled());await p.screenshot({animations:'disabled',path:'verification/activity-desktop.png',fullPage:true});
 await p.setViewportSize({width:390,height:844});await p.screenshot({animations:'disabled',path:'verification/activity-mobile.png',fullPage:true});assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await p.goto('http://127.0.0.1:8766/admin.html');await p.waitForSelector('.a-gate');assert.equal(await p.locator('input').count(),0);
 const student='11111111-1111-4111-8111-111111111111',campaign={id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',title:'แยกให้ถูก ทิ้งให้เป็น',enabled:true,ends_at:new Date(Date.now()+86400000).toISOString(),prize_caption:'รอประกาศของรางวัล',prize_path:null,updated_at:'2026-09-20T00:00:00Z'};
 async function fixture(role,{saved=false,closed=false}={}){
  const context=await browser.newContext({viewport:{width:1280,height:1000}}),calls=[];
  const user={id:student,email:'6940108219@nrru.ac.th',email_confirmed_at:'2026-01-01T00:00:00Z',aud:'authenticated',role:'authenticated',app_metadata:{},user_metadata:{},created_at:'2026-01-01T00:00:00Z'};
  if(role!=='anon')await context.addInitScript(session=>localStorage.setItem('nrru-activities-session',JSON.stringify(session)),{access_token:'test-only-token',refresh_token:'test-only-refresh',expires_at:Math.floor(Date.now()/1000)+3600,expires_in:3600,token_type:'bearer',user});
  await context.route('**/activity-config.js',r=>r.fulfill({contentType:'text/javascript',body:"window.ACTIVITY_CONFIG={enabled:true,supabaseUrl:'https://activity-fixture.test',publishableKey:'test-only-public-key'}"}));
  await context.route('https://activity-fixture.test/**',async r=>{
   const req=r.request(),url=new URL(req.url()),path=url.pathname,body=(req.headers()['content-type']||'').includes('application/json')?req.postDataJSON():null;calls.push({path,body});let data={};
   if(path.includes('/object/sign/')&&req.method()==='GET')return r.fulfill({contentType:'image/png',body:await readFile('image/nrru-logo.png')});
   if(path==='/auth/v1/user')data={...user};else if(path==='/auth/v1/otp')data={};
   else if(path.includes('/activity_campaigns'))data={...campaign,enabled:!closed,ends_at:closed?'2020-01-01T00:00:00Z':campaign.ends_at};
   else if(path.endsWith('/activity_leaderboard'))data=[];
   else if(path.endsWith('/activity_is_admin'))data=role==='admin';
   else if(path.endsWith('/activity_notifications'))data=[];
   else if(path.endsWith('/activity_profiles'))data=saved?{user_id:student,display_name:'ผู้เข้าร่วมทดสอบ',faculty:'วิทยาศาสตร์',major:'คอมพิวเตอร์'}:null;
   else if(path.endsWith('/activity_submissions'))data=role==='admin'&&url.searchParams.get('status')==='eq.pending'?[{id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',status:'pending',photo_path:'fixture/photo.png',submitted_at:'2026-09-20T00:00:00Z',activity_profiles:{display_name:'ผู้เข้าร่วมทดสอบ',faculty:'วิทยาศาสตร์',major:'คอมพิวเตอร์'}}]:[];
   else if(path.endsWith('/activity_save_profile'))data={user_id:student,display_name:body.p_name,faculty:body.p_faculty,major:body.p_major};
   else if(path.endsWith('/activity_submit'))data=body.p_id;
   else if(path.includes('/object/sign/'))data={signedURL:'/object/sign/activity-proofs/fixture/photo.png?token=fixture'};
   else if(path.includes('/object/'))data={Key:'fixture/photo.png'};
   await r.fulfill({contentType:'application/json',body:JSON.stringify(data)});
  });
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));return {page,context,calls};
 }
 const anon=await fixture('anon');await anon.page.goto('http://127.0.0.1:8766/activity.html');await anon.page.getByRole('button',{name:'ส่งกิจกรรม',exact:true}).click();await anon.page.getByLabel('อีเมลมหาวิทยาลัย',{exact:true}).fill('outsider@example.com');await anon.page.getByRole('button',{name:'ส่งลิงก์เข้าสู่ระบบ'}).click();await anon.page.getByRole('alert').waitFor();assert.equal(anon.calls.filter(x=>x.path.endsWith('/otp')).length,0);await anon.page.getByLabel('อีเมลมหาวิทยาลัย',{exact:true}).fill('6940108219@nrru.ac.th');await anon.page.getByRole('button',{name:'ส่งลิงก์เข้าสู่ระบบ'}).click();await anon.page.getByText('ตรวจกล่องอีเมลของคุณ').waitFor();assert.equal(anon.calls.filter(x=>x.path.endsWith('/otp')).length,1);await anon.context.close();
 const first=await fixture('student');await first.page.goto('http://127.0.0.1:8766/activity.html');await first.page.getByRole('button',{name:'ส่งกิจกรรม',exact:true}).click();await first.page.getByLabel('ชื่อที่จะแสดง',{exact:true}).fill('ผู้เข้าร่วมทดสอบ');await first.page.getByLabel('คณะ',{exact:true}).fill('วิทยาศาสตร์');await first.page.getByLabel('สาขา',{exact:true}).fill('คอมพิวเตอร์');await first.page.getByRole('checkbox').check();await first.page.getByLabel('อัปโหลดรูปกิจกรรม').setInputFiles('image/nrru-logo.png');await first.page.locator('.a-proof-preview').waitFor();await first.page.screenshot({animations:'disabled',path:'verification/activity-submit.png'});await first.page.getByRole('button',{name:'ส่งให้ผู้ดูแลตรวจ'}).click();await first.page.locator('.a-success').waitFor();assert.equal(first.calls.filter(x=>x.path.endsWith('/activity_save_profile')).length,1);assert.equal(first.calls.filter(x=>x.path.endsWith('/activity_submit')).length,1);await first.context.close();
 const returning=await fixture('student',{saved:true});await returning.page.goto('http://127.0.0.1:8766/activity.html');await returning.page.getByRole('button',{name:'ส่งกิจกรรม',exact:true}).click();await returning.page.getByText('ข้อมูลนี้บันทึกแล้วและไม่สามารถแก้ไขได้',{exact:true}).waitFor();for(const field of ['ชื่อที่จะแสดง','คณะ','สาขา'])assert.ok(await returning.page.getByLabel(field,{exact:true}).isDisabled());await returning.context.close();
 const denied=await fixture('student');await denied.page.goto('http://127.0.0.1:8766/admin.html');await denied.page.getByText('บัญชีนี้ยังไม่มีสิทธิ์ผู้ดูแล กรุณาติดต่อผู้รับผิดชอบกิจกรรม',{exact:true}).waitFor();assert.equal(await denied.page.getByRole('button',{name:'ตรวจรูป'}).count(),0);await denied.context.close();
 const admin=await fixture('admin');await admin.page.goto('http://127.0.0.1:8766/admin.html');await admin.page.getByRole('button',{name:'ตรวจรูป'}).waitFor();await admin.page.screenshot({animations:'disabled',path:'verification/activity-admin.png',fullPage:true});await admin.page.getByRole('button',{name:'ตรวจรูป'}).click();await admin.page.locator('.a-proof').waitFor();await admin.page.getByRole('button',{name:'ถูกต้อง · +1 คะแนน',exact:true}).click();await admin.page.getByText('อนุมัติแล้ว เพิ่ม 1 คะแนน',{exact:true}).waitFor();assert.equal(admin.calls.filter(x=>x.path.endsWith('/activity_review')).length,1);assert.equal(admin.calls.find(x=>x.path.endsWith('/activity_review')).body.p_decision,'approved');await admin.context.close();
 const closed=await fixture('student',{closed:true});await closed.page.goto('http://127.0.0.1:8766/activity.html');await closed.page.getByText('หมดเขตส่งกิจกรรมแล้ว',{exact:true}).waitFor();assert.ok(await closed.page.getByRole('button',{name:'ยังไม่เปิดรับกิจกรรม'}).isDisabled());await closed.context.close();assert.deepEqual(errors,[]);console.log('PASS: desktop/mobile empty podium, gated launch, university email UI, first submission, locked returning profile, admin gate/review, closed campaign. Auth and Storage network fixtures only; no real emails sent.');
}finally{await browser?.close();await new Promise(r=>server.close(r));}
