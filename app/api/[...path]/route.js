import {login,logout,userFromRequest,sessionCookie} from '../../../lib/auth.js';
import * as service from '../../../lib/service.js';
import {AppError,assert,integer} from '../../../lib/policy.js';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const json=(value,status=200,headers={})=>Response.json(value,{status,headers:{'Cache-Control':'no-store',...headers}});
async function handle(request){
 try{
 const parts=new URL(request.url).pathname.slice(5).split('/').filter(Boolean),method=request.method;
 if(method!=='GET'){
 const expected=process.env.APP_ORIGIN??new URL(request.url).origin;
 assert(request.headers.get('origin')===expected,'Request origin is not allowed',403);
 assert((request.headers.get('content-type')??'').includes('application/json'),'Use JSON requests',415);
 }
 let body={};
 if(['POST','PATCH'].includes(method)){const raw=await request.text();assert(Buffer.byteLength(raw)<=120000,'Request too large',413);try{body=JSON.parse(raw)}catch{throw new AppError('Invalid JSON')}}
 if(parts.join('/')==='auth/login'&&method==='POST'){const result=await login(body);return json({user:result.user},200,{'Set-Cookie':sessionCookie(result.token)});}
 if(parts.join('/')==='auth/logout'&&method==='POST'){await logout(request);return json({ok:true},200,{'Set-Cookie':sessionCookie('',true)});}
 const user=await userFromRequest(request);
 if(parts.join('/')==='auth/me'&&method==='GET')return json({user});
 if(parts[0]==='dashboard'&&method==='GET')return json(await service.dashboard(user));
 if(parts.join('/')==='reports'&&method==='GET')return json(await service.reports(user,integer(new URL(request.url).searchParams.get('cycle_id'),'Cycle')));
 if(parts.join('/')==='scores/recalculate'&&method==='POST')return json(await service.recalculateScores(user,body));
 if(parts.join('/')==='evidence/sync'&&method==='POST')return json(await service.syncEvidence(user));
 if(parts[0]==='cycles'){
 if(parts.length===1&&method==='POST')return json(await service.createCycle(user,body),201);
 if(parts.length===2&&method==='PATCH')return json(await service.changeCycle(user,integer(parts[1]),body));
 }
 if(['faculty','department'].includes(parts[0])){
 const kind=parts[0];
 if(parts.length===1&&method==='POST')return json(await service.createRecord(user,kind,body),201);
 if(parts.length>=2){
 const id=integer(parts[1]);
 if(parts.length===2&&method==='PATCH')return json(await service.updateRecord(user,kind,id,body));
 if(parts.length===2&&method==='DELETE')return json(await service.deleteEvidence(user,kind,id,true));
 if(parts.length===3&&parts[2]==='status'&&method==='PATCH')return json(await service.changeStatus(user,kind,id,body));
 if(parts.length===3&&parts[2]==='evidence'&&method==='GET')return json(await service.readEvidence(user,kind,id));
 if(parts.length===3&&parts[2]==='evidence'&&method==='DELETE')return json(await service.deleteEvidence(user,kind,id,false));
 if(parts.length===3&&parts[2]==='logs'&&method==='GET')return json({logs:await service.logs(user,kind,id)});
 }
 }
 throw new AppError('Endpoint not found',404);
 }catch(e){
 if(e instanceof AppError)return json({error:e.message},e.status);
 if(e.code==='ER_SIGNAL_EXCEPTION')return json({error:e.sqlMessage??e.message},409);
 if(e.code==='ER_DUP_ENTRY')return json({error:'A record with this unique value already exists'},409);
 if(e.code==='ER_ROW_IS_REFERENCED_2')return json({error:'This record has audit history and cannot be deleted'},409);
 if(e.code==='ER_NO_REFERENCED_ROW_2')return json({error:'A referenced user, criterion, or cycle is missing'},409);
 console.error('IQAC API failure',e.code??e.name);
 return json({error:'Database operation failed. Check database configuration and run the setup steps.'},503);
 }
}
export {handle as GET,handle as POST,handle as PATCH,handle as DELETE};
