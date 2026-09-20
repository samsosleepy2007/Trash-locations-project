import { createClient } from 'npm:@supabase/supabase-js@2.116.0';
// Never expose the service key, scheduler secret, or Resend key to the browser.
Deno.serve(async request => {
 const origin=Deno.env.get('ACTIVITY_SITE_ORIGIN') || '';
 const cors={'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS','Vary':'Origin'};
 const respond=(status:number,data:unknown)=>new Response(JSON.stringify(data),{status,headers:{...cors,'Content-Type':'application/json'}});
 if(request.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
 if(request.method!=='POST')return respond(405,{error:'METHOD_NOT_ALLOWED'});
 const url=Deno.env.get('SUPABASE_URL')!,key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
 const auth=request.headers.get('Authorization') || '';
 const scheduler=Deno.env.get('ACTIVITY_SCHEDULER_SECRET');
 let authorized=Boolean(scheduler&&auth===`Bearer ${scheduler}`);
 if(!authorized&&auth.startsWith('Bearer ')){
  const userClient=createClient(url,Deno.env.get('SUPABASE_ANON_KEY')!,{global:{headers:{Authorization:auth}},auth:{persistSession:false}});
  const {data:user,error}=await userClient.auth.getUser();
  if(!error&&user.user){const {data:admin,error:roleError}=await userClient.rpc('activity_is_admin');authorized=!roleError&&admin===true;}
 }
 if(!authorized)return respond(403,{error:'ADMIN_REQUIRED'});
 const resend=Deno.env.get('RESEND_API_KEY'),from=Deno.env.get('ACTIVITY_MAIL_FROM');
 if(!resend||!from)return respond(503,{error:'MAIL_NOT_CONFIGURED'});
 const db=createClient(url,key,{auth:{persistSession:false}});
 const {data:jobs,error}=await db.rpc('activity_claim_mail');
 if(error)return respond(500,{error:'QUEUE_UNAVAILABLE'});
 let sent=0,failed=0;
 for(const job of jobs||[]){
  let provider:string|null=null,failure:string|null=null;
  try{
   if(!/^[^@\s]+@nrru\.ac\.th$/i.test(job.recipient))throw Error('RECIPIENT_DOMAIN');
   const result=await fetch('https://api.resend.com/emails',{method:'POST',signal:AbortSignal.timeout(15000),headers:{'Authorization':`Bearer ${resend}`,'Content-Type':'application/json','Idempotency-Key':`activity-rejection/${job.submission_id}`},body:JSON.stringify({from,to:[job.recipient],subject:'ผลการตรวจกิจกรรมแยกขยะ — NRRU Green Campus',text:`ผลการตรวจรายการ ${job.submission_id}\n\nไม่ตรงตามกฎกติกาจึงไม่ได้ point\n\nกรุณาถ่ายรูปขยะของตัวเองที่จะนำไปทิ้งคู่กับถังขยะแยกประเภทให้ชัดเจน\n${job.note?`\nเหตุผลจากผู้ดูแล: ${job.note}\n`:''}\nสามารถส่งกิจกรรมใหม่ได้ก่อนหมดเขต\nNRRU Green Campus`})});
   const data=await result.json();if(!result.ok||!data.id)throw Error(`PROVIDER_HTTP_${result.status}`);provider=data.id;sent++;
  }catch(error){failure=error instanceof Error?error.message:'DELIVERY_ERROR';failed++;}
  const result=await db.rpc('activity_finish_mail',{p_id:job.id,p_lease:job.lease_id,p_provider:provider,p_error:failure});
  if(result.error)return respond(500,{error:'QUEUE_ACK_FAILED',sent,failed});
 }
 return respond(200,{sent,failed});
});
