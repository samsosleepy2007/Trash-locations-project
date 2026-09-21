import { createClient } from 'npm:@supabase/supabase-js@2.116.0';

const allowedOrigins = new Set([
  'https://samsosleepy2007.github.io',
  'http://127.0.0.1:8766',
  'http://localhost:8766'
]);

const directImage = (value: string) => /^https:\/\/i\.ibb\.co\/\S+$/.test(value);
const clean = (value: unknown, max=800) => String(value ?? '').replace(/[\r\n\t]+/g,' ').slice(0,max);

Deno.serve(async request => {
  const origin=request.headers.get('Origin') || '';
  const cors={
    'Access-Control-Allow-Origin':allowedOrigins.has(origin)?origin:'https://samsosleepy2007.github.io',
    'Access-Control-Allow-Headers':'content-type, apikey, x-activity-session',
    'Access-Control-Allow-Methods':'POST, OPTIONS',
    'Vary':'Origin'
  };
  const json=(status:number,data:unknown)=>new Response(JSON.stringify(data),{
    status,
    headers:{...cors,'Content-Type':'application/json'}
  });

  if(request.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
  if(request.method!=='POST')return json(405,{error:'METHOD_NOT_ALLOWED'});

  const session=request.headers.get('x-activity-session') || '';
  if(!session)return json(401,{error:'SESSION_REQUIRED'});

  const url=Deno.env.get('SUPABASE_URL')!;
  const key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const db=createClient(url,key,{auth:{persistSession:false}});

  const {data:me,error:meError}=await db.rpc('activity_me',{p_session:session});
  const account=Array.isArray(me)?me[0]:null;
  if(meError||!account)return json(401,{error:'SESSION_REQUIRED'});

  const log=async(stage:string,level='info',code?:string,httpStatus?:number,detail?:string)=>{
    try{
      await db.rpc('activity_debug_write',{
        p_account:account.user_id,
        p_action:'activity-files',
        p_stage:stage,
        p_level:level,
        p_code:code||null,
        p_http_status:httpStatus||null,
        p_detail:detail?clean(detail,1000):null
      });
    }catch{}
  };

  let form:FormData;
  try{form=await request.formData();}
  catch(error){
    await log('parse-form','error','INVALID_FORM',400,clean(error));
    return json(400,{error:'INVALID_FORM'});
  }
  const action=String(form.get('action')||'');

  if(action==='sign-proof'){
    if(!account.is_admin){
      await log('sign-proof-auth','warn','ADMIN_REQUIRED',403);
      return json(403,{error:'ADMIN_REQUIRED'});
    }
    const path=String(form.get('path')||'');
    if(!directImage(path)){
      await log('sign-proof-url','error','INVALID_PHOTO_URL',400,clean(path,180));
      return json(400,{error:'INVALID_PHOTO_URL'});
    }
    await log('sign-proof-success','info','OK',200);
    return json(200,{signedUrl:path});
  }

  const file=form.get('file');
  if(!(file instanceof File)){
    await log('validate-file','error','PHOTO_REQUIRED',400);
    return json(400,{error:'PHOTO_REQUIRED'});
  }

  const mime=file.type;
  await log('upload-request','info','START',undefined,`action=${action}; mime=${mime}; bytes=${file.size}`);

  if(!['image/jpeg','image/png','image/webp'].includes(mime)){
    await log('validate-file','error','INVALID_IMAGE_TYPE',400,`mime=${mime}`);
    return json(400,{error:'INVALID_IMAGE_TYPE'});
  }
  if(file.size<=0||file.size>8*1024*1024){
    await log('validate-file','error','IMAGE_TOO_LARGE',400,`bytes=${file.size}`);
    return json(400,{error:'IMAGE_TOO_LARGE'});
  }

  if(action==='upload-proof'){
    const {data:campaign,error:campaignError}=await db
      .from('activity_campaigns')
      .select('enabled,ends_at')
      .single();

    if(campaignError||!campaign?.enabled||!campaign.ends_at||
       Date.now()>=new Date(campaign.ends_at).getTime()){
      await log('campaign-check','warn','CAMPAIGN_CLOSED',409,
        `db_error=${clean(campaignError?.message)}; enabled=${Boolean(campaign?.enabled)}; ends_at=${campaign?.ends_at||'null'}`);
      return json(409,{error:'CAMPAIGN_CLOSED'});
    }
  }else if(action==='upload-prize'){
    if(!account.is_admin){
      await log('upload-prize-auth','warn','ADMIN_REQUIRED',403);
      return json(403,{error:'ADMIN_REQUIRED'});
    }
  }else{
    await log('validate-action','error','INVALID_ACTION',400,`action=${clean(action,80)}`);
    return json(400,{error:'INVALID_ACTION'});
  }

  const {data:imgbbKey,error:keyError}=await db.rpc('activity_imgbb_key');
  if(keyError||typeof imgbbKey!=='string'||!imgbbKey){
    await log('imgbb-key','error','IMAGE_HOST_NOT_CONFIGURED',503,`rpc_error=${clean(keyError?.message)}`);
    return json(503,{error:'IMAGE_HOST_NOT_CONFIGURED'});
  }

  const upload=new FormData();
  upload.set('image',file);
  upload.set('name',action==='upload-prize'?'nrru-activity-prize':`nrru-proof-${crypto.randomUUID()}`);

  let response:Response;
  try{
    response=await fetch(`https://api.imgbb.com/1/upload?key=${encodeURIComponent(imgbbKey)}`,{
      method:'POST',
      body:upload
    });
  }catch(error){
    await log('imgbb-fetch','error','IMAGE_HOST_UNAVAILABLE',502,clean(error));
    return json(502,{error:'IMAGE_HOST_UNAVAILABLE'});
  }

  let payload:any={};
  let raw='';
  try{
    raw=await response.text();
    payload=raw?JSON.parse(raw):{};
  }catch(error){
    await log('imgbb-response-parse','error','IMAGE_HOST_BAD_RESPONSE',response.status,
      `parse=${clean(error)}; body=${clean(raw,500)}`);
    return json(502,{error:'IMAGE_HOST_UPLOAD_FAILED',detail:'ImgBB returned an unreadable response'});
  }

  const direct=String(payload?.data?.url||'');
  const imgbbError=clean(payload?.error?.message||payload?.error||payload?.status_txt||'');

  if(!response.ok||payload?.success!==true||!directImage(direct)){
    await log('imgbb-upload','error','IMAGE_HOST_UPLOAD_FAILED',response.status,
      `success=${String(payload?.success)}; status=${payload?.status||''}; status_txt=${clean(payload?.status_txt)}; error=${imgbbError}`);
    return json(502,{
      error:'IMAGE_HOST_UPLOAD_FAILED',
      detail:imgbbError||`ImgBB HTTP ${response.status}`,
      upstreamStatus:response.status
    });
  }

  await log('imgbb-upload','info','OK',response.status,`host=i.ibb.co; bytes=${file.size}`);

  if(action==='upload-proof'){
    return json(200,{id:crypto.randomUUID(),path:direct});
  }
  return json(200,{path:direct});
});
