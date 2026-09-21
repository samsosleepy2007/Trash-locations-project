import { createClient } from '@supabase/supabase-js';

export const config=window.ACTIVITY_CONFIG||{};
export const configured=Boolean(config.enabled&&/^https:\/\//.test(config.supabaseUrl||'')&&config.publishableKey);
export const client=configured?createClient(config.supabaseUrl,config.publishableKey,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}}):null;
export const placeholder={title:'แยกให้ถูก ทิ้งให้เป็น',enabled:false,ends_at:null,prize_caption:'รอประกาศของรางวัล',prize_path:null};
const SESSION_KEY='nrru-activity-student-session';

export const thaiDate=value=>value?new Intl.DateTimeFormat('th-TH',{timeZone:'Asia/Bangkok',dateStyle:'medium',timeStyle:'short'}).format(new Date(value)):'รอประกาศวันสิ้นสุด';
export const localThaiInput=value=>value?new Date(new Date(value).getTime()+7*3600000).toISOString().slice(0,16):'';
export function thaiInputISO(value){if(!value)return null;const d=new Date(value+':00+07:00');if(Number.isNaN(d.getTime()))throw Error('กรุณาระบุวันและเวลาให้ถูกต้อง');return d.toISOString();}
export function readableError(error){
 const text=error?.message||String(error);
 const messages={
  INVALID_STUDENT_ID:'กรุณากรอกรหัสนักศึกษา 10 หลัก',
  WEAK_PASSWORD:'รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร และไม่เกิน 72 ตัวอักษร',
  STUDENT_ID_EXISTS:'รหัสนักศึกษานี้สมัครไว้แล้ว กรุณาเข้าสู่ระบบ',
  INVALID_CREDENTIALS:'รหัสนักศึกษาหรือรหัสผ่านไม่ถูกต้อง',
  ACCOUNT_TEMP_LOCKED:'ใส่รหัสผ่านผิดหลายครั้ง บัญชีถูกพักชั่วคราว 5 นาที',
  SESSION_REQUIRED:'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่',
  PROFILE_LOCKED:'ข้อมูลชื่อ คณะ และสาขาถูกล็อกแล้ว ไม่สามารถแก้ไขได้',
  ADMIN_REQUIRED:'บัญชีนี้ไม่มีสิทธิ์ผู้ดูแล',
  CAMPAIGN_CLOSED:'กิจกรรมปิดรับแล้ว ไม่สามารถส่งรายการเพิ่มได้',
  ALREADY_REVIEWED:'รายการนี้ได้รับการตรวจแล้ว กรุณาโหลดข้อมูลใหม่',
  REJECTION_REASON_REQUIRED:'กรุณาระบุเหตุผลกรณีไม่ผ่านก่อนบันทึกผล',
  END_TIME_MUST_BE_FUTURE:'กรุณาตั้งเวลาสิ้นสุดให้เป็นเวลาในอนาคต',
  PHOTO_REQUIRED:'ไม่พบรูปที่อัปโหลด กรุณาลองใหม่',
  PROFILE_REQUIRED:'กรุณาบันทึกข้อมูลผู้เข้าร่วมก่อน',
  SUBMISSION_CONFLICT:'รหัสการส่งซ้ำกับรายการอื่น กรุณาลองใหม่',
  INVALID_IMAGE_TYPE:'รองรับเฉพาะ JPG, PNG หรือ WebP',
  IMAGE_TOO_LARGE:'รูปต้องมีขนาดไม่เกิน 8 MB',
  UPLOAD_FAILED:'อัปโหลดรูปไม่สำเร็จ กรุณาลองใหม่',
  INVALID_PHOTO_URL:'ลิงก์รูปหลักฐานไม่ถูกต้อง',
  INVALID_PRIZE_URL:'ลิงก์รูปของรางวัลไม่ถูกต้อง',
  IMAGE_HOST_NOT_CONFIGURED:'ระบบฝากรูปยังไม่ได้ตั้งค่า กรุณาติดต่อผู้ดูแล',
  IMAGE_HOST_UNAVAILABLE:'เชื่อมต่อบริการฝากรูปไม่ได้ กรุณาลองใหม่',
  IMAGE_HOST_UPLOAD_FAILED:'ImgBB อัปโหลดรูปไม่สำเร็จ กรุณาลองใหม่',
  IMAGE_HOST_BAD_RESPONSE:'ImgBB ตอบกลับมาในรูปแบบที่อ่านไม่ได้',
  IMGBB_MAINTENANCE:'ImgBB ปิดปรับปรุงชั่วคราว ระบบจะลองใช้พื้นที่สำรอง',
  FALLBACK_UPLOAD_FAILED:'ImgBB ใช้งานไม่ได้และพื้นที่สำรองก็อัปโหลดไม่สำเร็จ',
  FALLBACK_READ_FAILED:'โหลดรูปจากพื้นที่สำรองไม่สำเร็จ',
  GITHUB_IMAGE_LIST_FAILED:'โหลดรายการรูปจาก GitHub ไม่สำเร็จ กรุณาลองใหม่หรือวาง Raw URL เอง',
  INVALID_PRIZE_SOURCE:'ประเภทแหล่งรูปของรางวัลไม่ถูกต้อง',
  INVALID_GITHUB_PRIZE_URL:'ลิงก์ GitHub ของรูปของรางวัลไม่ถูกต้อง',
  INVALID_DIRECT_IMAGE_URL:'Direct Image URL ต้องเป็นลิงก์ HTTPS ที่เปิดรูปได้โดยตรง',
  INVALID_UPLOADED_PRIZE_URL:'ลิงก์รูปที่อัปโหลดไม่ใช่ URL จากระบบอัปโหลด',
  SETTINGS_SAVE_FAILED:'บันทึกการตั้งค่ากิจกรรมไม่สำเร็จ',
  CLEAR_LOGS_FAILED:'ล้าง Debug Log ไม่สำเร็จ',
  CAMPAIGN_CANCEL_FAILED:'ยกเลิกกิจกรรมไม่สำเร็จ',
  CAMPAIGN_NOT_FOUND:'ไม่พบกิจกรรมที่ต้องการจัดการ'
 };
 for(const [code,message] of Object.entries(messages))if(text.includes(code))return message;
 if(/fetch|network/i.test(text))return 'เชื่อมต่อไม่สำเร็จ กรุณาตรวจอินเทอร์เน็ตแล้วลองใหม่';
 return 'ทำรายการไม่สำเร็จ กรุณาลองใหม่หรือติดต่อผู้ดูแล';
}
export async function checked(promise){const {data,error}=await promise;if(error)throw error;return data;}
export function sessionToken(){return localStorage.getItem(SESSION_KEY)||'';}
function setSession(token){if(token)localStorage.setItem(SESSION_KEY,token);else localStorage.removeItem(SESSION_KEY);window.dispatchEvent(new Event('activity-auth-change'));}
function first(data){return Array.isArray(data)?data[0]||null:data||null;}

export async function register(studentId,password){
 const row=first(await checked(client.rpc('activity_register',{p_student_id:studentId.trim(),p_password:password})));
 if(!row?.session_token)throw Error('REGISTER_FAILED');
 setSession(row.session_token);
 return {id:row.user_id,student_id:row.student_id,is_admin:Boolean(row.is_admin)};
}
export async function login(studentId,password){
 const row=first(await checked(client.rpc('activity_login',{p_student_id:studentId.trim(),p_password:password})));
 if(!row?.session_token)throw Error('INVALID_CREDENTIALS');
 setSession(row.session_token);
 return {id:row.user_id,student_id:row.student_id,is_admin:Boolean(row.is_admin)};
}
export async function accountInfo(){
 const token=sessionToken();if(!configured||!token)return null;
 const row=first(await checked(client.rpc('activity_me',{p_session:token})));
 if(!row){setSession('');return null;}
 return {id:row.user_id,student_id:row.student_id,is_admin:Boolean(row.is_admin)};
}
export async function logout(){
 const token=sessionToken();try{if(client&&token)await client.rpc('activity_logout',{p_session:token});}finally{setSession('');}
}
export async function campaignData(){return configured?(await checked(client.from('activity_campaigns').select('*').single())):placeholder;}
export async function leaderboard(id){return configured&&id?checked(client.rpc('activity_leaderboard',{p_campaign:id})):[];}
export async function ownProfile(){const rows=await checked(client.rpc('activity_own_profile',{p_session:sessionToken()}));return first(rows);}
export async function ownHistory(){return checked(client.rpc('activity_own_history',{p_session:sessionToken()}));}
export async function saveProfile(fields){return checked(client.rpc('activity_save_profile',{p_session:sessionToken(),p_name:fields.display_name,p_faculty:fields.faculty,p_major:fields.major}));}
export async function submitActivity(id,campaign,path){return checked(client.rpc('activity_submit',{p_session:sessionToken(),p_id:id,p_campaign:campaign,p_photo:path}));}
export async function adminQueue(){return checked(client.rpc('activity_admin_queue',{p_session:sessionToken()}));}
export async function adminLogs(limit=100){return checked(client.rpc('activity_admin_logs',{p_session:sessionToken(),p_limit:limit}));}
export async function reviewActivity(id,decision,note){return checked(client.rpc('activity_review',{p_session:sessionToken(),p_id:id,p_decision:decision,p_note:note}));}
export const githubPrizeURL=value=>/^https:\/\/raw\.githubusercontent\.com\/samsosleepy2007\/Trash-locations-project\/main\/[^\s]+\.(png|jpg|jpeg|webp)$/i.test(value||'');
export const managedPrizeURL=value=>/^https:\/\/i\.ibb\.co\//.test(value||'')||/^https:\/\/ejhlgroeoyvsyhntagvs\.supabase\.co\/storage\/v1\/object\/public\/activity-prizes\//.test(value||'');
export const directPrizeURL=value=>typeof value==='string'&&value.length<=2048&&/^https:\/\/\S+$/i.test(value);
export function prizeURL(path){const value=path||'';return directPrizeURL(value)?value:null;}
export async function githubPrizeImages(){
 const response=await fetch('https://api.github.com/repos/samsosleepy2007/Trash-locations-project/git/trees/main?recursive=1',{headers:{Accept:'application/vnd.github+json'}});
 if(!response.ok)throw Error('GITHUB_IMAGE_LIST_FAILED');
 const data=await response.json();
 return (data.tree||[])
  .filter(item=>item?.type==='blob'&&/^image\/.+\.(png|jpg|jpeg|webp)$/i.test(item.path||''))
  .map(item=>({path:item.path,url:encodeURI(`https://raw.githubusercontent.com/samsosleepy2007/Trash-locations-project/main/${item.path}`)}))
  .sort((a,b)=>a.path.localeCompare(b.path,'th'));
}
export async function validateImage(file){
 if(!file||!['image/jpeg','image/png','image/webp'].includes(file.type))throw Error('กรุณาเลือกรูป JPG, PNG หรือ WebP');
 if(file.size>8*1024*1024)throw Error('รูปต้องมีขนาดไม่เกิน 8 MB');
 const bitmap=await createImageBitmap(file).catch(()=>{throw Error('ไฟล์นี้ไม่ใช่รูปที่เปิดอ่านได้');});
 if(bitmap.width>16000||bitmap.height>16000){bitmap.close();throw Error('รูปมีขนาดกว้างหรือสูงเกิน 16,000 พิกเซล');}
 bitmap.close();return file;
}
async function fileAction(action,{file,path,fields}={}){
 const form=new FormData();form.set('action',action);if(file)form.set('file',file);if(path)form.set('path',path);
 for(const [key,value] of Object.entries(fields||{}))form.set(key,value==null?'':String(value));
 const response=await fetch(`${config.supabaseUrl}/functions/v1/activity-files`,{method:'POST',headers:{apikey:config.publishableKey,'x-activity-session':sessionToken()},body:form});
 let data={};try{data=await response.json();}catch{}
 if(!response.ok){const code=data.error||`FILE_HTTP_${response.status}`;const detail=data.detail?` · ${data.detail}`:'';throw Error(`${code}${detail}`);}
 return data;
}
export const uploadProof=file=>fileAction('upload-proof',{file});
export const signProof=path=>fileAction('sign-proof',{path});
export const uploadPrize=file=>fileAction('upload-prize',{file});

export const clearAdminLogs=()=>fileAction('clear-logs');
export const cancelCampaign=()=>fileAction('cancel-campaign');
export const saveSettings=({title,enabled,ends,caption,prize,source='upload'})=>fileAction('save-settings',{fields:{title,enabled,ends:ends||'',caption,prize:prize||'',source}});
export function readableAdminError(error){
 const raw=String(error?.message||error||'').replace(/[\r\n\t]+/g,' ').slice(0,320);
 const base=readableError(error);
 if(!raw||base===raw)return base;
 return `${base} · ${raw}`;
}
