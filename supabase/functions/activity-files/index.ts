import { createClient } from 'npm:@supabase/supabase-js@2.116.0';

const allowedOrigins = new Set([
  'https://samsosleepy2007.github.io',
  'http://127.0.0.1:8766',
  'http://localhost:8766'
]);

const directImage = (value: string) => /^https:\/\/i\.ibb\.co\/\S+$/.test(value);
const githubPrize = (value: string) => /^https:\/\/raw\.githubusercontent\.com\/samsosleepy2007\/Trash-locations-project\/main\/\S+\.(png|jpg|jpeg|webp)$/i.test(value);
const supabasePrize = (value: string) => /^https:\/\/ejhlgroeoyvsyhntagvs\.supabase\.co\/storage\/v1\/object\/public\/activity-prizes\/\S+$/i.test(value);
const httpsPrize = (value: string) => value.length<=2048 && /^https:\/\/\S+$/i.test(value);
const prizeHost = (value: string) => { try { return new URL(value).host; } catch { return 'invalid'; } };
const storageProof = (value: string) => value.startsWith('storage://activity-proofs/');
const clean = (value: unknown, max=800) => String(value ?? '').replace(/[\r\n\t]+/g,' ').slice(0,max);
const sleep = (ms:number) => new Promise(resolve=>setTimeout(resolve,ms));
const extensionFor = (mime:string) => mime==='image/png'?'png':mime==='image/webp'?'webp':'jpg';

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

  if(action==='clear-logs'){
    if(!account.is_admin){
      await log('clear-logs-auth','warn','ADMIN_REQUIRED',403);
      return json(403,{error:'ADMIN_REQUIRED'});
    }
    const {data,error}=await db.rpc('activity_clear_debug_logs',{p_session:session});
    if(error){
      await log('clear-logs','error','CLEAR_LOGS_FAILED',500,`code=${clean(error.code)}; message=${clean(error.message)}`);
      return json(500,{error:'CLEAR_LOGS_FAILED',detail:clean(error.message)});
    }
    return json(200,{cleared:Number(data||0)});
  }

  if(action==='cancel-campaign'){
    if(!account.is_admin){
      await log('campaign-cancel-auth','warn','ADMIN_REQUIRED',403);
      return json(403,{error:'ADMIN_REQUIRED'});
    }

    await log('campaign-cancel','info','START');
    const {data:campaign,error:campaignError}=await db
      .from('activity_campaigns')
      .select('title,enabled,ends_at,prize_caption,prize_path')
      .eq('singleton',true)
      .single();

    if(campaignError||!campaign){
      await log('campaign-cancel','error','CAMPAIGN_NOT_FOUND',500,clean(campaignError?.message));
      return json(500,{error:'CAMPAIGN_NOT_FOUND',detail:clean(campaignError?.message)});
    }

    if(!campaign.enabled){
      await log('campaign-cancel','info','ALREADY_CANCELLED',200);
      return json(200,{cancelled:false,alreadyCancelled:true,campaign});
    }

    const {data,error}=await db.rpc('activity_settings',{
      p_session:session,
      p_title:campaign.title,
      p_enabled:false,
      p_ends:campaign.ends_at,
      p_caption:campaign.prize_caption,
      p_prize:campaign.prize_path
    });

    if(error){
      const message=clean(error.message);
      const known=message.match(/\b(?:ADMIN_REQUIRED|INVALID_PRIZE_URL|PRIZE_IMAGE_NOT_FOUND|CAMPAIGN_NOT_FOUND)\b/)?.[0];
      const code=known||(String(error.code)==='21000'?'SAFEUPDATE_BLOCKED':'CAMPAIGN_CANCEL_FAILED');
      await log('campaign-cancel','error',code,500,`db_code=${clean(error.code)}; message=${message}`);
      return json(500,{error:code,detail:message,dbCode:clean(error.code)});
    }

    await log('campaign-cancel','info','OK',200,'enabled=false; existing submissions and leaderboard retained');
    return json(200,{cancelled:true,campaign:data});
  }

  if(action==='save-settings'){
    if(!account.is_admin){
      await log('settings-auth','warn','ADMIN_REQUIRED',403);
      return json(403,{error:'ADMIN_REQUIRED'});
    }

    const source=String(form.get('source')||'upload');
    const title=String(form.get('title')||'').trim();
    const caption=String(form.get('caption')||'').trim();
    const ends=String(form.get('ends')||'').trim();
    const prize=String(form.get('prize')||'').trim();
    const enabled=String(form.get('enabled')||'false')==='true';

    if(!['upload','github','direct'].includes(source)){
      await log('settings-validate','error','INVALID_PRIZE_SOURCE',400,`source=${clean(source,40)}`);
      return json(400,{error:'INVALID_PRIZE_SOURCE'});
    }
    if(source==='github' && (!prize || !githubPrize(prize))){
      await log('settings-validate','error','INVALID_GITHUB_PRIZE_URL',400,`host=${prizeHost(prize)}`);
      return json(400,{error:'INVALID_GITHUB_PRIZE_URL'});
    }
    if(source==='direct' && (!prize || !httpsPrize(prize))){
      await log('settings-validate','error','INVALID_DIRECT_IMAGE_URL',400,`host=${prizeHost(prize)}`);
      return json(400,{error:'INVALID_DIRECT_IMAGE_URL'});
    }
    if(source==='upload' && prize && !(directImage(prize)||supabasePrize(prize))){
      await log('settings-validate','error','INVALID_UPLOADED_PRIZE_URL',400,`host=${prizeHost(prize)}`);
      return json(400,{error:'INVALID_UPLOADED_PRIZE_URL'});
    }

    await log('settings-save','info','START',undefined,
      `source=${source}; enabled=${enabled}; prize_host=${prize?prizeHost(prize):'none'}`);

    const {data,error}=await db.rpc('activity_settings',{
      p_session:session,
      p_title:title,
      p_enabled:enabled,
      p_ends:ends||null,
      p_caption:caption,
      p_prize:prize||null
    });

    if(error){
      const message=clean(error.message);
      const known=message.match(/\b(?:ADMIN_REQUIRED|END_TIME_MUST_BE_FUTURE|INVALID_PRIZE_URL|PRIZE_IMAGE_NOT_FOUND|CAMPAIGN_NOT_FOUND)\b/)?.[0];
      const code=known||(String(error.code)==='21000'?'SAFEUPDATE_BLOCKED':'SETTINGS_SAVE_FAILED');
      await log('settings-save','error',code,500,
        `db_code=${clean(error.code)}; message=${message}; source=${source}; prize_host=${prize?prizeHost(prize):'none'}`);
      return json(500,{error:code,detail:message,dbCode:clean(error.code)});
    }

    await log('settings-save','info','OK',200,
      `source=${source}; prize_host=${prize?prizeHost(prize):'none'}`);
    return json(200,{campaign:data,source});
  }

  if(action==='sign-proof'){
    if(!account.is_admin){
      await log('sign-proof-auth','warn','ADMIN_REQUIRED',403);
      return json(403,{error:'ADMIN_REQUIRED'});
    }
    const path=String(form.get('path')||'');
    if(directImage(path)){
      await log('sign-proof-success','info','OK',200,'provider=imgbb');
      return json(200,{signedUrl:path,provider:'imgbb'});
    }
    if(storageProof(path)){
      const name=path.slice('storage://activity-proofs/'.length);
      const {data,error}=await db.storage.from('activity-proofs').createSignedUrl(name,300);
      if(error||!data?.signedUrl){
        await log('sign-proof-storage','error','FALLBACK_READ_FAILED',500,clean(error?.message));
        return json(500,{error:'FALLBACK_READ_FAILED'});
      }
      await log('sign-proof-success','info','OK',200,'provider=supabase-fallback');
      return json(200,{signedUrl:data.signedUrl,provider:'supabase-fallback'});
    }
    await log('sign-proof-url','error','INVALID_PHOTO_URL',400,clean(path,180));
    return json(400,{error:'INVALID_PHOTO_URL'});
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

  const uploadId=crypto.randomUUID();
  const {data:imgbbKey,error:keyError}=await db.rpc('activity_imgbb_key');
  let lastImgBB='';

  if(!keyError&&typeof imgbbKey==='string'&&imgbbKey){
    for(let attempt=1;attempt<=3;attempt++){
      try{
        const upload=new FormData();
        upload.set('image',file);
        upload.set('name',action==='upload-prize'?'nrru-activity-prize':`nrru-proof-${uploadId}`);
        const response=await fetch(`https://api.imgbb.com/1/upload?key=${encodeURIComponent(imgbbKey)}`,{
          method:'POST',
          body:upload
        });
        const raw=await response.text();
        const contentType=response.headers.get('content-type')||'';
        const maintenance=response.status===503||/down for maintenance|<!doctype html|<html/i.test(raw);
        let payload:any={};

        if(/json/i.test(contentType)||(!maintenance&&raw.trim().startsWith('{'))){
          try{payload=raw?JSON.parse(raw):{};}
          catch(error){
            lastImgBB=`parse=${clean(error)}; body=${clean(raw,350)}`;
          }
        }else{
          lastImgBB=`content-type=${clean(contentType)}; body=${clean(raw,350)}`;
        }

        const direct=String(payload?.data?.url||'');
        if(response.ok&&payload?.success===true&&directImage(direct)){
          await log('imgbb-upload','info','OK',response.status,`attempt=${attempt}; provider=imgbb; bytes=${file.size}`);
          if(action==='upload-proof')return json(200,{id:uploadId,path:direct,provider:'imgbb'});
          return json(200,{path:direct,provider:'imgbb'});
        }

        const code=maintenance?'IMGBB_MAINTENANCE':'IMAGE_HOST_UPLOAD_FAILED';
        const detail=maintenance
          ? `attempt=${attempt}; ImgBB maintenance; HTTP ${response.status}`
          : `attempt=${attempt}; status=${response.status}; error=${clean(payload?.error?.message||payload?.status_txt||lastImgBB)}`;
        lastImgBB=detail;
        await log('imgbb-attempt','warn',code,response.status,detail);

        const retryable=maintenance||[429,500,502,503,504].includes(response.status);
        if(attempt<3&&retryable)await sleep(attempt===1?250:700);
        else break;
      }catch(error){
        lastImgBB=`attempt=${attempt}; fetch=${clean(error)}`;
        await log('imgbb-attempt','warn','IMAGE_HOST_UNAVAILABLE',502,lastImgBB);
        if(attempt<3)await sleep(attempt===1?250:700);
      }
    }
  }else{
    lastImgBB=`key_error=${clean(keyError?.message)}`;
    await log('imgbb-key','warn','IMAGE_HOST_NOT_CONFIGURED',503,lastImgBB);
  }

  const ext=extensionFor(mime);
  const bucket=action==='upload-proof'?'activity-proofs':'activity-prizes';
  const objectName=action==='upload-proof'
    ? `${account.user_id}/${uploadId}.${ext}`
    : `fallback/${uploadId}.${ext}`;

  const {error:storageError}=await db.storage.from(bucket).upload(objectName,file,{
    contentType:mime,
    cacheControl:'31536000',
    upsert:false
  });

  if(storageError){
    await log('storage-fallback','error','FALLBACK_UPLOAD_FAILED',502,
      `bucket=${bucket}; error=${clean(storageError.message)}; imgbb=${clean(lastImgBB,400)}`);
    return json(502,{
      error:'FALLBACK_UPLOAD_FAILED',
      detail:'ImgBB ใช้งานไม่ได้และระบบสำรองอัปโหลดไม่สำเร็จ'
    });
  }

  await log('storage-fallback','info','OK',200,
    `provider=supabase-fallback; bucket=${bucket}; imgbb=${clean(lastImgBB,400)}`);

  if(action==='upload-proof'){
    return json(200,{
      id:uploadId,
      path:`storage://activity-proofs/${objectName}`,
      provider:'supabase-fallback'
    });
  }

  const publicUrl=db.storage.from('activity-prizes').getPublicUrl(objectName).data.publicUrl;
  return json(200,{path:publicUrl,provider:'supabase-fallback'});
});
