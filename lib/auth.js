import {randomBytes} from 'node:crypto';
import {pool,transaction} from './db.js';
import {digest,verifyPassword,hashPassword} from './password.js';
import {assert,text} from './policy.js';
export const cookieName='iqac_session';
const safeUser=u=>({user_id:Number(u.user_id),first_name:u.first_name,last_name:u.last_name,email:u.email,role:u.role,dept_id:u.dept_id===null?null:Number(u.dept_id)});
export async function userFromRequest(request){
 const value=request.headers.get('cookie')?.split(';').map(x=>x.trim()).find(x=>x.startsWith(cookieName+'='))?.slice(cookieName.length+1);
 assert(value&&/^[a-f0-9]{64}$/.test(value),'Please sign in',401);
 const [rows]=await pool.execute('SELECT u.* FROM Portal_Sessions s JOIN User_Auth_Roles u ON u.user_id=s.user_id WHERE s.token_hash=? AND s.expires_at>NOW() AND u.is_active=TRUE',[digest(value)]);
 assert(rows.length,'Your session has expired. Please sign in',401);return safeUser(rows[0]);
}
export async function login(input){
 const email=text(input.email,'Email',150).toLowerCase(),password=input.password;
 assert(typeof password==='string'&&password.length>0&&password.length<=256,'Password is required (max 256 characters)');
 const result=await transaction(null,async c=>{
 await c.execute('INSERT IGNORE INTO Portal_Login_Attempts(email,attempts,window_started) VALUES(?,0,NOW())',[email]);
 const [[attempt]]=await c.execute('SELECT attempts,window_started < DATE_SUB(NOW(),INTERVAL 15 MINUTE) AS reset_window FROM Portal_Login_Attempts WHERE email=? FOR UPDATE',[email]);
 if(Number(attempt.reset_window)===1)await c.execute('UPDATE Portal_Login_Attempts SET attempts=0,window_started=NOW() WHERE email=?',[email]);
 else if(Number(attempt.attempts)>=5)return {limited:true};
 await c.execute('UPDATE Portal_Login_Attempts SET attempts=attempts+1 WHERE email=?',[email]);
 const [rows]=await c.execute('SELECT * FROM User_Auth_Roles WHERE email=? AND is_active=TRUE',[email]);
 const user=rows[0];
 const valid=await verifyPassword(password,user?.password_hash??'scrypt$00000000000000000000000000000000$'+'0'.repeat(128));
 if(!user||!valid)return {invalid:true};
 if(!user.password_hash.startsWith('scrypt$'))await c.execute('UPDATE User_Auth_Roles SET password_hash=? WHERE user_id=?',[await hashPassword(password),user.user_id]);
 await c.execute('DELETE FROM Portal_Login_Attempts WHERE email=?',[email]);
 await c.execute('DELETE FROM Portal_Sessions WHERE expires_at<=NOW()');
 const token=randomBytes(32).toString('hex');
 await c.execute('INSERT INTO Portal_Sessions(token_hash,user_id,expires_at) VALUES(?,?,DATE_ADD(NOW(),INTERVAL 8 HOUR))',[digest(token),user.user_id]);
 return {user:safeUser(user),token};
 });
 assert(!result.limited,'Too many sign-in attempts. Try again in 15 minutes',429);
 assert(!result.invalid,'Email or password is incorrect',401);return result;
}
export function sessionCookie(token,remove=false){
 const secure=process.env.COOKIE_SECURE==='true';
 return cookieName+'='+token+'; Path=/; HttpOnly; SameSite=Strict; Max-Age='+(remove?0:28800)+(secure?'; Secure':'');
}
export async function logout(request){
 const token=request.headers.get('cookie')?.split(';').map(x=>x.trim()).find(x=>x.startsWith(cookieName+'='))?.slice(cookieName.length+1);
 if(token)await pool.execute('DELETE FROM Portal_Sessions WHERE token_hash=?',[digest(token)]);
}
