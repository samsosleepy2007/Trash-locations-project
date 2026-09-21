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

 const staticContext=await browser.newContext({viewport:{width:1440,height:1100}});
 await staticContext.route('**/activity-config.js',r=>r.fulfill({contentType:'text/javascript',body:"window.ACTIVITY_CONFIG={enabled:false,supabaseUrl:'https://activity-fixture.test',publishableKey:'test-only-public-key'}"}));
 const p=await staticContext.newPage();p.on('pageerror',e=>errors.push(e.message));
 await p.goto('http://127.0.0.1:8766/activity.html');await p.waitForSelector('.a-podium-place');
 assert.equal(await p.locator('.a-podium-place').count(),3);assert.equal(await p.locator('.a-waiting').count(),3);assert.ok(await p.getByRole('button',{name:'ยังไม่เปิดรับกิจกรรม'}).isDisabled());
 await p.screenshot({animations:'disabled',path:'verification/activity-desktop.png',fullPage:true});
 await p.setViewportSize({width:390,height:844});await p.screenshot({animations:'disabled',path:'verification/activity-mobile.png',fullPage:true});assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await staticContext.close();

 const student='11111111-1111-4111-8111-111111111111';
 const campaign={id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',title:'แยกให้ถูก ทิ้งให้เป็น',enabled:true,ends_at:new Date(Date.now()+86400000).toISOString(),prize_caption:'รอประกาศของรางวัล',prize_path:null,updated_at:'2026-09-20T00:00:00Z'};

 async function fixture(role,{saved=false,closed=false,campaignDraft=false}={}){
  const context=await browser.newContext({viewport:{width:1280,height:1000}}),calls=[];
  if(role==='student'||role==='admin')await context.addInitScript(()=>localStorage.setItem('nrru-activity-student-session','test-session-token'));
  await context.route('**/activity-config.js',r=>r.fulfill({contentType:'text/javascript',body:"window.ACTIVITY_CONFIG={enabled:true,supabaseUrl:'https://activity-fixture.test',publishableKey:'test-only-public-key'}"}));
  await context.route('https://api.github.com/repos/samsosleepy2007/Trash-locations-project/git/trees/main?recursive=1',r=>r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({tree:[{type:'blob',path:'image/nrru-logo.png'},{type:'blob',path:'image/map.jpeg'},{type:'blob',path:'README.md'}]})}));
  await context.route('https://raw.githubusercontent.com/samsosleepy2007/Trash-locations-project/main/image/**',async r=>r.fulfill({status:200,contentType:'image/png',body:await readFile('image/nrru-logo.png')}));
  await context.route('https://activity-fixture.test/**',async r=>{
   const req=r.request(),url=new URL(req.url()),path=url.pathname,content=req.postData()||'';
   let body=null;try{body=req.postDataJSON();}catch{}
   calls.push({path,body,content});let data={};

   if(path==='/rest/v1/activity_campaigns')data=campaignDraft?{...campaign,enabled:false,ends_at:null}:({...campaign,enabled:!closed,ends_at:closed?'2020-01-01T00:00:00Z':campaign.ends_at});
   else if(path.endsWith('/rpc/activity_leaderboard'))data=[];
   else if(path.endsWith('/rpc/activity_login'))data=[{session_token:'login-session',user_id:student,student_id:'6940108219',is_admin:false}];
   else if(path.endsWith('/rpc/activity_register'))data=[{session_token:'register-session',user_id:student,student_id:'6940108219',is_admin:false}];
   else if(path.endsWith('/rpc/activity_me'))data=[{user_id:student,student_id:'6940108219',is_admin:role==='admin'}];
   else if(path.endsWith('/rpc/activity_logout'))data=null;
   else if(path.endsWith('/rpc/activity_own_profile'))data=saved?[{user_id:student,display_name:'ผู้เข้าร่วมทดสอบ',faculty:'วิทยาศาสตร์',major:'คอมพิวเตอร์'}]:[];
   else if(path.endsWith('/rpc/activity_own_history'))data=[];
   else if(path.endsWith('/rpc/activity_save_profile'))data={user_id:student,display_name:body.p_name,faculty:body.p_faculty,major:body.p_major};
   else if(path.endsWith('/rpc/activity_submit'))data=body.p_id;
   else if(path.endsWith('/rpc/activity_admin_queue'))data=role==='admin'?[{id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',status:'pending',photo_path:'https://i.ibb.co/test-proof/proof.png',submitted_at:'2026-09-20T00:00:00Z',reviewed_at:null,rejection_note:null,display_name:'ผู้เข้าร่วมทดสอบ',faculty:'วิทยาศาสตร์',major:'คอมพิวเตอร์'}]:[];
   else if(path.endsWith('/rpc/activity_admin_logs'))data=role==='admin'?[{id:1,student_id:'1234567890',action:'activity-files',stage:'imgbb-upload',level:'error',code:'IMAGE_HOST_UPLOAD_FAILED',http_status:400,detail:'Invalid API key',created_at:'2026-09-20T00:00:00Z'}]:[];
   else if(path.endsWith('/rpc/activity_clear_debug_logs'))data=1;
   else if(path.endsWith('/rpc/activity_review'))data=body.p_decision;
   else if(path.endsWith('/rpc/activity_settings'))data=campaign;
   else if(path.endsWith('/functions/v1/activity-files')){
    if(content.includes('sign-proof'))data={signedUrl:'http://127.0.0.1:8766/image/nrru-logo.png'};
    else if(content.includes('upload-prize'))data={path:'https://i.ibb.co/test-prize/prize.png'};
    else data={id:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',path:'https://i.ibb.co/test-proof/proof.png'};
   }
   await r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
  });
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));return {page,context,calls};
 }

 const auth=await fixture('login');
 await auth.page.goto('http://127.0.0.1:8766/activity.html');
 await auth.page.getByRole('button',{name:'ส่งกิจกรรม',exact:true}).click();
 assert.equal(await auth.page.getByLabel('รหัสนักศึกษา',{exact:true}).getAttribute('placeholder'),'กรอกรหัสนักศึกษา 10 หลัก');
 await auth.page.getByLabel('รหัสนักศึกษา',{exact:true}).fill('6940108219');
 await auth.page.getByLabel('รหัสผ่าน',{exact:true}).fill('secret12');
 await auth.page.getByRole('button',{name:'เข้าสู่ระบบ',exact:true}).last().click();
 await auth.page.getByText('รหัสนักศึกษา 6940108219').waitFor();
 assert.equal(auth.calls.filter(x=>x.path.endsWith('/rpc/activity_login')).length,1);
 assert.equal(await auth.page.evaluate(()=>localStorage.getItem('nrru-activity-student-session')),'login-session');
 await auth.context.close();

 const registerFixture=await fixture('login');
 await registerFixture.page.goto('http://127.0.0.1:8766/activity.html');
 await registerFixture.page.getByRole('button',{name:'ส่งกิจกรรม',exact:true}).click();
 await registerFixture.page.getByRole('button',{name:'สมัครบัญชี',exact:true}).click();
 await registerFixture.page.getByLabel('รหัสนักศึกษา',{exact:true}).fill('6940108219');
 await registerFixture.page.getByLabel('รหัสผ่าน',{exact:true}).fill('secret12');
 await registerFixture.page.getByLabel('ยืนยันรหัสผ่าน',{exact:true}).fill('secret12');
 await registerFixture.page.getByRole('button',{name:'สร้างบัญชี',exact:true}).click();
 await registerFixture.page.getByText('รหัสนักศึกษา 6940108219').waitFor();
 assert.equal(registerFixture.calls.filter(x=>x.path.endsWith('/rpc/activity_register')).length,1);
 await registerFixture.context.close();

 const first=await fixture('student');
 await first.page.goto('http://127.0.0.1:8766/activity.html');
 await first.page.getByRole('button',{name:'ส่งกิจกรรม',exact:true}).click();
 await first.page.getByLabel('ชื่อที่จะแสดง',{exact:true}).fill('ผู้เข้าร่วมทดสอบ');
 await first.page.getByLabel('คณะ',{exact:true}).fill('วิทยาศาสตร์');
 await first.page.getByLabel('สาขา',{exact:true}).fill('คอมพิวเตอร์');
 await first.page.getByRole('checkbox').check();
 await first.page.getByLabel('อัปโหลดรูปกิจกรรม').setInputFiles('image/nrru-logo.png');
 await first.page.locator('.a-proof-preview').waitFor();
 await first.page.screenshot({animations:'disabled',path:'verification/activity-submit.png'});
 await first.page.getByRole('button',{name:'ส่งให้ผู้ดูแลตรวจ'}).click();
 await first.page.locator('.a-success').waitFor();
 assert.equal(first.calls.filter(x=>x.path.endsWith('/rpc/activity_save_profile')).length,1);
 assert.equal(first.calls.filter(x=>x.path.endsWith('/functions/v1/activity-files')&&x.content.includes('upload-proof')).length,1);
 assert.equal(first.calls.filter(x=>x.path.endsWith('/rpc/activity_submit')).length,1);
 await first.context.close();

 const returning=await fixture('student',{saved:true});
 await returning.page.goto('http://127.0.0.1:8766/activity.html');await returning.page.getByRole('button',{name:'ส่งกิจกรรม',exact:true}).click();
 await returning.page.getByText('ข้อมูลนี้บันทึกแล้วและไม่สามารถแก้ไขได้',{exact:true}).waitFor();
 for(const field of ['ชื่อที่จะแสดง','คณะ','สาขา'])assert.ok(await returning.page.getByLabel(field,{exact:true}).isDisabled());
 await returning.context.close();

 const denied=await fixture('student');
 await denied.page.goto('http://127.0.0.1:8766/admin.html');
 await denied.page.getByText('รหัสนักศึกษานี้ยังไม่มีสิทธิ์ผู้ดูแล',{exact:true}).waitFor();
 assert.equal(await denied.page.getByRole('button',{name:'ตรวจรูป'}).count(),0);
 await denied.context.close();

 const admin=await fixture('admin');
 await admin.page.goto('http://127.0.0.1:8766/admin.html');
 await admin.page.getByRole('button',{name:'ตรวจรูป'}).waitFor();
 await admin.page.getByRole('heading',{name:'Activity / ImgBB Log'}).waitFor();
 await admin.page.getByText('IMAGE_HOST_UPLOAD_FAILED · HTTP 400',{exact:true}).waitFor();
 await admin.page.getByText('Invalid API key',{exact:true}).waitFor();
 await admin.page.screenshot({animations:'disabled',path:'verification/activity-admin.png',fullPage:true});
 await admin.page.getByRole('button',{name:'ตรวจรูป'}).click();
 await admin.page.locator('.a-proof').waitFor();
 const rejectButton=admin.page.getByRole('button',{name:'ผิด · ไม่ให้คะแนน',exact:true});
 assert.ok(await rejectButton.isDisabled());
 await admin.page.getByLabel('เหตุผลกรณีไม่ผ่าน (จำเป็น)',{exact:true}).fill('รูปไม่เห็นถังแยกประเภทชัดเจน');
 assert.ok(!(await rejectButton.isDisabled()));
 await admin.page.getByRole('button',{name:'ถูกต้อง · +1 คะแนน',exact:true}).click();
 await admin.page.getByText('อนุมัติแล้ว เพิ่ม 1 คะแนน',{exact:true}).waitFor();
 assert.equal(admin.calls.filter(x=>x.path.endsWith('/rpc/activity_review')).length,1);
 assert.equal(admin.calls.find(x=>x.path.endsWith('/rpc/activity_review')).body.p_decision,'approved');
 await admin.context.close();

 const draft=await fixture('admin',{campaignDraft:true});
 await draft.page.goto('http://127.0.0.1:8766/admin.html');
 await draft.page.getByRole('heading',{name:'ตั้งค่ากิจกรรม'}).waitFor();
 const endInput=draft.page.getByLabel('วันและเวลาสิ้นสุด (เวลาไทย)',{exact:true});
 assert.ok((await endInput.inputValue()).length>=16);
 await draft.page.getByRole('button',{name:'เลือกจาก GitHub',exact:true}).click();
 await draft.page.getByRole('button',{name:/nrru-logo\.png/}).click();
 assert.match(await draft.page.getByLabel('GitHub Raw URL',{exact:true}).inputValue(),/raw\.githubusercontent\.com\/samsosleepy2007\/Trash-locations-project\/main\/image\/nrru-logo\.png$/);
 const enableBox=draft.page.getByLabel('เปิดรับการส่งกิจกรรม',{exact:true});
 await enableBox.check();
 await draft.page.getByRole('button',{name:'บันทึกการตั้งค่า',exact:true}).click();
 await draft.page.getByText('บันทึกการตั้งค่ากิจกรรมแล้ว',{exact:true}).waitFor();
 const settingsCall=draft.calls.find(x=>x.path.endsWith('/rpc/activity_settings'));
 assert.equal(settingsCall.body.p_enabled,true);
 assert.ok(settingsCall.body.p_ends);
 assert.equal(settingsCall.body.p_prize,'https://raw.githubusercontent.com/samsosleepy2007/Trash-locations-project/main/image/nrru-logo.png');
 assert.ok(new Date(settingsCall.body.p_ends).getTime()>Date.now());
 await draft.context.close();

 const closed=await fixture('student',{closed:true});
 await closed.page.goto('http://127.0.0.1:8766/activity.html');
 await closed.page.getByText('หมดเขตส่งกิจกรรมแล้ว',{exact:true}).waitFor();
 assert.ok(await closed.page.getByRole('button',{name:'ยังไม่เปิดรับกิจกรรม'}).isDisabled());
 await closed.context.close();

 assert.deepEqual(errors,[]);
 console.log('PASS: generic student login UI, GitHub prize picker, ImgBB fallback, automatic campaign deadline, first submission, locked profile, admin review and closed campaign.');
}finally{await browser?.close();await new Promise(r=>server.close(r));}
