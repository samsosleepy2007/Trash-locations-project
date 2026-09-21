import {PGlite} from '@electric-sql/pglite';
import {readFile,readdir} from 'node:fs/promises';
import assert from 'node:assert/strict';

const db=new PGlite();
await db.exec(`
create role anon; create role authenticated; create role service_role;
create schema auth; create schema storage; create schema extensions;
create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
grant usage on schema public,auth,storage to anon,authenticated,service_role;
grant execute on function auth.uid() to anon,authenticated,service_role;
create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id),name text);
alter table storage.objects enable row level security;
grant select,insert,update,delete on storage.objects to authenticated;
create function storage.foldername(text) returns text[] language sql immutable as $$select string_to_array($1,'/')$$;
create function extensions.digest(text,text) returns bytea language sql immutable as $$select convert_to(md5($1),'UTF8')$$;
create function extensions.gen_random_bytes(int) returns bytea language sql volatile as $$select convert_to(gen_random_uuid()::text||gen_random_uuid()::text,'UTF8')$$;
create function extensions.gen_salt(text,int) returns text language sql immutable as $$select 'test-salt'::text$$;
create function extensions.crypt(text,text) returns text language sql immutable as $$select 'test$'||md5($1)$$;
`);

const migrations=(await readdir('supabase/migrations')).filter(f=>f.endsWith('.sql')).sort();
for(const migration of migrations){
 let sql=await readFile(`supabase/migrations/${migration}`,'utf8');
 sql=sql.replace('create extension if not exists pgcrypto with schema extensions;','-- pgcrypto is stubbed by this PGlite test');
 await db.exec(sql);
}

async function as(role,sql,params=[]){await db.exec('reset role');await db.exec(`set role ${role}`);try{return await db.query(sql,params);}finally{await db.exec('reset role');}}
async function denied(role,sql,params=[],pattern){await assert.rejects(()=>as(role,sql,params),pattern);}
async function rpc(sql,params=[]){return as('anon',sql,params);}
function row(result){return result.rows[0];}

await denied('anon',"select * from activity_private.accounts",[],/permission denied/);
await denied('anon',"select activity_register('123','123456')",[],/INVALID_STUDENT_ID/);
await denied('anon',"select activity_register('1234567890','123')",[],/WEAK_PASSWORD/);

const student=row(await rpc("select * from activity_register('1234567890','student-pass')"));
const admin=row(await rpc("select * from activity_register('6940108219','admin-pass')"));
assert.equal(student.student_id,'1234567890');
assert.equal(student.is_admin,false);
assert.equal(admin.is_admin,true);
assert.equal(row(await as('service_role','select * from activity_me($1)',[admin.session_token])).student_id,'6940108219');
assert.ok(student.session_token.length>=64);
await denied('anon',"select * from activity_register('1234567890','another-pass')",[],/STUDENT_ID_EXISTS/);

assert.equal((await rpc("select * from activity_login('1234567890','wrong-pass')")).rows.length,0);
assert.equal(row(await db.query("select failed_attempts from activity_private.accounts where student_id='1234567890'")).failed_attempts,1);
const login=row(await rpc("select * from activity_login('1234567890','student-pass')"));
assert.equal(login.user_id,student.user_id);
assert.equal(row(await rpc('select * from activity_me($1)',[login.session_token])).student_id,'1234567890');

const profile=row(await rpc("select (activity_save_profile($1,'ชื่อทดสอบ','วิทยาศาสตร์','คอมพิวเตอร์')).*",[login.session_token]));
assert.equal(profile.display_name,'ชื่อทดสอบ');
await rpc("select activity_save_profile($1,'ชื่อทดสอบ','วิทยาศาสตร์','คอมพิวเตอร์')",[login.session_token]);
await denied('anon',"select activity_save_profile($1,'ชื่อใหม่','วิทยาศาสตร์','คอมพิวเตอร์')",[login.session_token],/PROFILE_LOCKED/);
await denied('anon',"select * from activity_profiles",[],/permission denied/);
await db.query("insert into activity_private.integration_secrets(name,secret_value) values('imgbb_api_key','test-secret')");
await denied('anon',"select activity_imgbb_key()",[],/permission denied/);
assert.equal(row(await as('service_role',"select activity_imgbb_key() as secret")).secret,'test-secret');
await as('service_role',"select activity_debug_write($1,'activity-files','imgbb-upload','error','IMAGE_HOST_UPLOAD_FAILED',400,'Invalid API key')",[student.user_id]);
await denied('anon',"select * from activity_admin_logs($1,100)",[login.session_token],/ADMIN_REQUIRED/);
const debugRows=(await rpc('select * from activity_admin_logs($1,100)',[admin.session_token])).rows;
assert.equal(debugRows.length,1);
assert.equal(debugRows[0].code,'IMAGE_HOST_UPLOAD_FAILED');
assert.equal(debugRows[0].student_id,'1234567890');
assert.equal(row(await rpc('select activity_clear_debug_logs($1) as n',[admin.session_token])).n,1);

const campaign=row(await db.query('select id from activity_campaigns')).id;
await denied('anon',"select activity_settings($1,'ทดสอบ',true,now()+interval '1 day','รางวัล',null)",[login.session_token],/ADMIN_REQUIRED/);
await rpc("select activity_settings($1,'ทดสอบ',true,null,'รางวัล',null)",[admin.session_token]);
const started=row(await db.query("select enabled,ends_at from activity_campaigns where id=$1",[campaign]));
assert.equal(started.enabled,true);
assert.ok(new Date(started.ends_at).getTime()>Date.now()+6*24*3600*1000);
await denied('anon',"select activity_settings($1,'ทดสอบ',true,now()+interval '1 day','รางวัล','https://example.com/prize.jpg')",[admin.session_token],/INVALID_PRIZE_URL/);
await db.query("insert into storage.objects(bucket_id,name) values('activity-prizes','fallback/prize.png')");
const fallbackPrize='https://ejhlgroeoyvsyhntagvs.supabase.co/storage/v1/object/public/activity-prizes/fallback/prize.png';
await rpc("select activity_settings($1,'ทดสอบ',true,now()+interval '1 day','รางวัล',$2)",[admin.session_token,fallbackPrize]);
assert.equal(row(await db.query('select prize_path from activity_campaigns where id=$1',[campaign])).prize_path,fallbackPrize);
const githubPrize='https://raw.githubusercontent.com/samsosleepy2007/Trash-locations-project/main/image/nrru-logo.png';
await rpc("select activity_settings($1,'ทดสอบ',true,now()+interval '1 day','รางวัล',$2)",[admin.session_token,githubPrize]);
assert.equal(row(await db.query('select prize_path from activity_campaigns where id=$1',[campaign])).prize_path,githubPrize);
const directPrize='https://cdn.example.test/rewards/green-campus?id=7';
await rpc("select activity_settings($1,'ทดสอบ',true,now()+interval '1 day','รางวัล',$2)",[admin.session_token,directPrize]);
assert.equal(row(await db.query('select prize_path from activity_campaigns where id=$1',[campaign])).prize_path,directPrize);
assert.equal(row(await db.query("select to_regprocedure('public.activity_settings(text,boolean,timestamptz,text,text)') is null as gone")).gone,true);
assert.equal(row(await db.query("select to_regprocedure('activity_private.settings(text,boolean,timestamptz,text,text)') is null as gone")).gone,true);

async function submit(n){
 const id=`aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12,'0')}`;
 const path=`https://i.ibb.co/test-${n}/proof-${n}.jpg`;
 await rpc('select activity_submit($1,$2,$3,$4)',[login.session_token,id,campaign,path]);
 return {id,path};
}
const first=await submit(1),second=await submit(2);
await rpc('select activity_submit($1,$2,$3,$4)',[login.session_token,first.id,campaign,first.path]);
const fallbackId='aaaaaaaa-aaaa-4aaa-8aaa-000000000003';
const fallbackObject=`${student.user_id}/${fallbackId}.jpg`;
await db.query("insert into storage.objects(bucket_id,name) values('activity-proofs',$1)",[fallbackObject]);
const fallbackPath=`storage://activity-proofs/${fallbackObject}`;
await rpc('select activity_submit($1,$2,$3,$4)',[login.session_token,fallbackId,campaign,fallbackPath]);
await denied('anon','select activity_submit($1,$2,$3,$4)',[
 login.session_token,
 'aaaaaaaa-aaaa-4aaa-8aaa-000000000004',
 campaign,
 'storage://activity-proofs/11111111-1111-4111-8111-111111111111/not-owned.jpg'
],/INVALID_PHOTO_URL|PHOTO_REQUIRED/);
assert.equal(row(await db.query('select count(*)::int as n from activity_submissions')).n,3);
assert.equal(row(await db.query('select count(*)::int as n from activity_submissions where proof_object_id is null')).n,2);
assert.equal(row(await db.query('select count(*)::int as n from activity_submissions where proof_object_id is not null')).n,1);
assert.equal((await rpc('select * from activity_own_history($1)',[login.session_token])).rows.length,3);

const queue=await rpc('select * from activity_admin_queue($1)',[admin.session_token]);
assert.equal(queue.rows.length,3);
assert.equal(queue.rows[0].display_name,'ชื่อทดสอบ');
await denied('anon',"select activity_review($1,$2,'rejected','')",[admin.session_token,second.id],/REJECTION_REASON_REQUIRED/);
await rpc("select activity_review($1,$2,'approved','')",[admin.session_token,first.id]);
await rpc("select activity_review($1,$2,'approved','')",[admin.session_token,first.id]);
await denied('anon',"select activity_review($1,$2,'rejected','เหตุผล')",[admin.session_token,first.id],/ALREADY_REVIEWED/);
await rpc("select activity_review($1,$2,'rejected','ภาพไม่ชัด')",[admin.session_token,second.id]);

const board=(await rpc('select * from activity_leaderboard($1)',[campaign])).rows;
assert.equal(Number(board[0].points),1);
assert.deepEqual(Object.keys(board[0]),['rank','display_name','faculty','major','points']);
const history=(await rpc('select * from activity_own_history($1)',[login.session_token])).rows;
assert.equal(history.find(x=>x.id===second.id).rejection_note,'ภาพไม่ชัด');

await rpc('select activity_logout($1)',[login.session_token]);
assert.equal((await rpc('select * from activity_me($1)',[login.session_token])).rows.length,0);
await denied('anon',"select * from activity_own_history($1)",[login.session_token],/SESSION_REQUIRED/);
await denied('anon',"select activity_settings($1,'ทดสอบ',true,now()-interval '1 hour','รางวัล',null)",[admin.session_token],/END_TIME_MUST_BE_FUTURE/);

await db.close();
console.log('PASS: student ID auth, uploaded + GitHub + direct prize images, legacy settings overload cleanup, private logs, automatic campaign deadline, immutable profiles, admin review and leaderboard.');
