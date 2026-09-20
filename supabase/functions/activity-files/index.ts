import { createClient } from 'npm:@supabase/supabase-js@2.116.0';

const allowedOrigins = new Set([
  'https://samsosleepy2007.github.io',
  'http://127.0.0.1:8766',
  'http://localhost:8766'
]);

const directImage = (value: string) => /^https:\/\/i\.ibb\.co\/\S+$/.test(value);

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

  let form:FormData;
  try{form=await request.formData();}catch{return json(400,{error:'INVALID_FORM'});}
  const action=String(form.get('action')||'');

  if(action==='sign-proof'){
    if(!account.is_admin)return json(403,{error:'ADMIN_REQUIRED'});
    const path=String(form.get('path')||'');
    if(!directImage(path))return json(400,{error:'INVALID_PHOTO_URL'});
    return json(200,{signedUrl:path});
  }

  const file=form.get('file');
  if(!(file instanceof File))return json(400,{error:'PHOTO_REQUIRED'});

  const mime=file.type;
  if(!['image/jpeg','image/png','image/webp'].includes(mime)){
    return json(400,{error:'INVALID_IMAGE_TYPE'});
  }
  if(file.size<=0||file.size>8*1024*1024){
    return json(400,{error:'IMAGE_TOO_LARGE'});
  }

  if(action==='upload-proof'){
    const {data:campaign,error:campaignError}=await db
      .from('activity_campaigns')
      .select('enabled,ends_at')
      .single();

    if(campaignError||!campaign?.enabled||!campaign.ends_at||
       Date.now()>=new Date(campaign.ends_at).getTime()){
      return json(409,{error:'CAMPAIGN_CLOSED'});
    }
  }else if(action==='upload-prize'){
    if(!account.is_admin)return json(403,{error:'ADMIN_REQUIRED'});
  }else{
    return json(400,{error:'INVALID_ACTION'});
  }

  const {data:imgbbKey,error:keyError}=await db.rpc('activity_imgbb_key');
  if(keyError||typeof imgbbKey!=='string'||!imgbbKey){
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
  }catch{
    return json(502,{error:'IMAGE_HOST_UNAVAILABLE'});
  }

  let payload:any={};
  try{payload=await response.json();}catch{}
  const direct=String(payload?.data?.url||'');

  if(!response.ok||payload?.success!==true||!directImage(direct)){
    return json(502,{error:'IMAGE_HOST_UPLOAD_FAILED'});
  }

  if(action==='upload-proof'){
    return json(200,{id:crypto.randomUUID(),path:direct});
  }

  return json(200,{path:direct});
});
