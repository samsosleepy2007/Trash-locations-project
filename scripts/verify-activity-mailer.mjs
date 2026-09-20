import {transform} from 'esbuild';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import assert from 'node:assert/strict';
const source=await readFile('supabase/functions/activity-mailer/index.ts','utf8');
const {code}=await transform(source.replace(/^import .*;\n/,''),{loader:'ts',target:'es2022'});
async function scenario({token='',admin=false,mailReady=true,providerOK=true}={}){
 let handler;const calls=[],requests=[];
 const env={SUPABASE_URL:'https://test.invalid',SUPABASE_SERVICE_ROLE_KEY:'test-service',SUPABASE_ANON_KEY:'test-public',ACTIVITY_SCHEDULER_SECRET:'test-scheduler',ACTIVITY_SITE_ORIGIN:'https://example.test',...(mailReady?{RESEND_API_KEY:'test-resend',ACTIVITY_MAIL_FROM:'test@example.test'}:{})};
 runInNewContext(code,{Deno:{env:{get:k=>env[k]},serve:fn=>{handler=fn;}},Response,AbortSignal,createClient:(_url,key)=>({auth:{getUser:async()=>({data:{user:{id:'test-user'}},error:null})},rpc:async(name,args)=>{calls.push({name,args,key});if(name==='activity_is_admin')return {data:admin,error:null};if(name==='activity_claim_mail')return {data:[{id:'job',submission_id:'submission',recipient:'consenting-test@nrru.ac.th',note:'ภาพไม่ชัด',lease_id:'lease'}],error:null};return {data:null,error:null};}}),fetch:async(url,args)=>{requests.push({url,args});return new Response(JSON.stringify(providerOK?{id:'email-test'}:{error:'provider down'}),{status:providerOK?200:503,headers:{'Content-Type':'application/json'}});}});
 const response=await handler(new Request('https://test.invalid/functions/v1/activity-mailer',{method:'POST',headers:token?{Authorization:`Bearer ${token}`}:{}}));return {response,calls,requests};
}
let result=await scenario();assert.equal(result.response.status,403);assert.equal(result.calls.length,0);assert.equal(result.requests.length,0);
result=await scenario({token:'student-token'});assert.equal(result.response.status,403);assert.equal(result.requests.length,0);
result=await scenario({token:'test-scheduler',mailReady:false});assert.equal(result.response.status,503);assert.equal(result.calls.length,0);
result=await scenario({token:'test-scheduler'});assert.equal(result.response.status,200);assert.equal(result.requests.length,1);assert.equal(result.requests[0].args.headers['Idempotency-Key'],'activity-rejection/submission');assert.equal(result.calls.find(x=>x.name==='activity_finish_mail').args.p_provider,'email-test');
result=await scenario({token:'admin-token',admin:true,providerOK:false});assert.equal(result.response.status,200);const ack=result.calls.find(x=>x.name==='activity_finish_mail');assert.equal(ack.args.p_provider,null);assert.equal(ack.args.p_error,'PROVIDER_HTTP_503');assert.equal(ack.args.p_lease,'lease');console.log('PASS: mail worker denies anonymous/student callers, requires configured sender, authenticates admin/scheduler, preserves idempotency key and acknowledges failed sends for retry. All provider requests mocked.');
