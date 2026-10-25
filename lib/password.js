import {randomBytes,scrypt as scryptCallback,timingSafeEqual,createHash} from 'node:crypto';
import {promisify} from 'node:util';
const scrypt=promisify(scryptCallback);
export const digest=value=>createHash('sha256').update(value).digest('hex');
export async function hashPassword(password){const salt=randomBytes(16).toString('hex');const key=await scrypt(password,salt,64);return 'scrypt$'+salt+'$'+key.toString('hex');}
export async function verifyPassword(password,stored){
 if(stored.startsWith('scrypt$')){const [,salt,hash]=stored.split('$');if(!salt||!hash||hash.length!==128)return false;const key=await scrypt(password,salt,64);return timingSafeEqual(Buffer.from(hash,'hex'),key);}
 if(/^[a-f0-9]{64}$/i.test(stored))return timingSafeEqual(Buffer.from(stored,'hex'),Buffer.from(digest(password),'hex'));
 return false;
}
