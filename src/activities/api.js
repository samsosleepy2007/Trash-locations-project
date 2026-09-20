import { createClient } from '@supabase/supabase-js';
export const config = window.ACTIVITY_CONFIG || {};
export const configured = Boolean(config.enabled && /^https:\/\//.test(config.supabaseUrl || '') && config.publishableKey);
export const client = configured ? createClient(config.supabaseUrl, config.publishableKey, {auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true,storageKey:'nrru-activities-session'}}) : null;
export const universityEmail = email => /^[^@\s]+@nrru\.ac\.th$/i.test(email.trim());
export const placeholder = {title:'แยกให้ถูก ทิ้งให้เป็น',enabled:false,ends_at:null,prize_caption:'รอประกาศของรางวัล',prize_path:null};
export const thaiDate = value => value ? new Intl.DateTimeFormat('th-TH',{timeZone:'Asia/Bangkok',dateStyle:'medium',timeStyle:'short'}).format(new Date(value)) : 'รอประกาศวันสิ้นสุด';
export const localThaiInput = value => value ? new Date(new Date(value).getTime()+7*3600000).toISOString().slice(0,16) : '';
export function thaiInputISO(value) { if(!value) return null; const d=new Date(value+':00+07:00'); if(Number.isNaN(d.getTime())) throw Error('กรุณาระบุวันและเวลาให้ถูกต้อง'); return d.toISOString(); }
export function readableError(error) {
 const text=error?.message || String(error);
 const messages={PROFILE_LOCKED:'ข้อมูลชื่อ คณะ และสาขาถูกล็อกแล้ว ไม่สามารถแก้ไขได้',UNIVERSITY_EMAIL_REQUIRED:'กรุณายืนยันอีเมล @nrru.ac.th ก่อนใช้งาน',ADMIN_REQUIRED:'บัญชีนี้ไม่มีสิทธิ์ผู้ดูแล',CAMPAIGN_CLOSED:'กิจกรรมปิดรับแล้ว ไม่สามารถส่งรายการเพิ่มได้',ALREADY_REVIEWED:'รายการนี้ได้รับการตรวจแล้ว กรุณาโหลดข้อมูลใหม่',END_TIME_MUST_BE_FUTURE:'กรุณาตั้งเวลาสิ้นสุดให้เป็นเวลาในอนาคต',PHOTO_REQUIRED:'ไม่พบรูปที่อัปโหลด กรุณาลองใหม่',PROFILE_REQUIRED:'กรุณาบันทึกข้อมูลผู้เข้าร่วมก่อน',SUBMISSION_CONFLICT:'รหัสการส่งซ้ำกับรายการอื่น กรุณาลองใหม่'};
 for(const [code,message] of Object.entries(messages)) if(text.includes(code)) return message;
 if(/rate.limit|too many|after.*seconds/i.test(text)) return 'ขอรหัสบ่อยเกินไป กรุณารอสักครู่แล้วลองอีกครั้ง';
 if(/email.*not authorized|sending.*email/i.test(text)) return 'ระบบส่งอีเมลยังไม่พร้อม กรุณาติดต่อผู้ดูแล';
 if(/fetch|network/i.test(text)) return 'เชื่อมต่อไม่สำเร็จ กรุณาตรวจอินเทอร์เน็ตแล้วลองใหม่';
 return 'ทำรายการไม่สำเร็จ กรุณาลองใหม่หรือติดต่อผู้ดูแล';
}
export async function checked(promise) {const {data,error}=await promise;if(error)throw error;return data;}
export async function campaignData() {return configured ? (await checked(client.from('activity_campaigns').select('*').single())) : placeholder;}
export async function leaderboard(id) {return configured && id ? checked(client.rpc('activity_leaderboard',{p_campaign:id})) : [];}
export async function ownProfile(id) {return checked(client.from('activity_profiles').select('*').eq('user_id',id).maybeSingle());}
export async function ownHistory(id) {return checked(client.from('activity_submissions').select('id,status,submitted_at,rejection_note,photo_path').eq('user_id',id).order('submitted_at',{ascending:false}).limit(50));}
export async function sendLogin(email) {
 if(!universityEmail(email))throw Error('UNIVERSITY_EMAIL_REQUIRED');
 return checked(client.auth.signInWithOtp({email:email.trim().toLowerCase(),options:{emailRedirectTo:new URL(location.pathname.endsWith('admin.html')?'admin.html':'activity.html',location.href).href}}));
}
export function prizeURL(path){return path && client ? client.storage.from('activity-prizes').getPublicUrl(path).data.publicUrl : null;}
export async function validateImage(file) {
 if(!file || !['image/jpeg','image/png','image/webp'].includes(file.type))throw Error('กรุณาเลือกรูป JPG, PNG หรือ WebP');
 if(file.size>8*1024*1024)throw Error('รูปต้องมีขนาดไม่เกิน 8 MB');
 const bitmap=await createImageBitmap(file).catch(()=>{throw Error('ไฟล์นี้ไม่ใช่รูปที่เปิดอ่านได้');});
 if(bitmap.width>16000 || bitmap.height>16000){bitmap.close();throw Error('รูปมีขนาดกว้างหรือสูงเกิน 16,000 พิกเซล');}
 bitmap.close(); return file;
}
export function extension(file){return {'image/jpeg':'jpg','image/png':'png','image/webp':'webp'}[file.type];}
