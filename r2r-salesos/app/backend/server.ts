import express from 'express';
import { randomBytes, scryptSync, createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { handler, dispatchCron } from './index.ts';
import { sqlite, db, json, equal, sign } from './runtime.ts';

const app=express();
app.disable('x-powered-by');
app.use(express.json({limit:'1mb'}));
app.use((req,res,next)=>{res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','same-origin');res.setHeader('X-Frame-Options','DENY');if(req.path.startsWith('/api/'))res.setHeader('Cache-Control','no-store');if(!['GET','HEAD','OPTIONS'].includes(req.method)&&req.headers.origin&&req.headers.origin!==process.env.APP_URL&&req.headers.origin!==`${req.protocol}://${req.headers.host}`){res.status(403).json({error:'Origem não autorizada.'});return;}next();});
const digest=(s:string)=>createHash('sha256').update(s).digest('hex');
const key=(req:any)=>digest(String(req.headers.cookie||'').split(';').map((s:string)=>s.trim()).find((s:string)=>s.startsWith('salesos_session='))?.slice(16)||'');
const publicUser=(u:any)=>({userId:u.id,email:u.email,name:u.name});
const sessionUser=async(req:any)=>{const s=(await db.get<any>('_sessions',[key(req)]))[0];if(!s||s.expires<Date.now())return undefined;const u=(await db.get<any>('_users',[s.userId]))[0];return u?publicUser(u):undefined;};
const cookieOptions={httpOnly:true,sameSite:'lax' as const,secure:process.env.COOKIE_SECURE!=='false',path:'/'};
const session=async(res:any,u:any)=>{const token=randomBytes(32).toString('hex');await db.add('_sessions',[{id:digest(token),userId:u.id,expires:Date.now()+86400000}]);res.cookie('salesos_session',token,{...cookieOptions,maxAge:86400000});};
const attempts=new Map<string,{n:number,until:number}>();
app.use('/api/auth',(req,res,next)=>{if(req.method==='GET'){next();return;}const ip=req.socket.remoteAddress||'unknown',now=Date.now();for(const [k,v] of attempts)if(v.until<now)attempts.delete(k);const a=attempts.get(ip)||{n:0,until:now+60000};a.n++;attempts.set(ip,a);if(a.n>20){res.status(429).json({error:'Muitas tentativas. Aguarde um minuto.'});return;}next();});
app.get('/api/health',(_req,res)=>{sqlite.prepare('SELECT 1').get();res.json({ok:true,service:'R2R SalesOS'});});
app.get('/api/auth/user',async(req,res)=>res.json({user:await sessionUser(req)||null}));
app.get('/api/auth/status',async(_req,res)=>res.json({setupRequired:!(await db.list('_users',{limit:1})).items.length}));
app.post('/api/auth/register',async(req,res)=>{
 const b=req.body||{},email=String(b.email||'').trim().toLowerCase(),name=String(b.name||'').trim(),password=String(b.password||'');
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>254||!name||name.length>100||password.length<12||password.length>200){res.status(400).json({error:'Informe nome, e-mail e senha com 12 a 200 caracteres.'});return;}
 const setupRequired=!(await db.list('_users',{limit:1})).items.length;
 if(setupRequired){if(!process.env.SETUP_TOKEN||!equal(String(b.setupToken||''),process.env.SETUP_TOKEN)){res.status(403).json({error:'Código de instalação inválido.'});return;}}
 else {const r=(await db.get<any>('_invites',[String(b.inviteCode||'')]))[0];if(!r||r.expires<Date.now()||!r.allowList.includes(email)||r.joinedBy){res.status(403).json({error:'Cadastro disponível apenas com convite válido para este e-mail.'});return;}}
 const id=digest(email),salt=randomBytes(16).toString('hex'),hash=scryptSync(password,salt,64).toString('hex'),u={id,email,name,salt,hash};
 const [ok]=await db.tx.add('_users',[u]);if(!ok){res.status(409).json({error:'Conta já cadastrada. Entre com sua senha.'});return;}
 await session(res,u);res.json({user:publicUser(u)});
});
app.post('/api/auth/login',async(req,res)=>{const email=String(req.body?.email||'').trim().toLowerCase(),password=String(req.body?.password||'').slice(0,201);const u=(await db.get<any>('_users',[digest(email)]))[0];const hash=scryptSync(password,u?.salt||'invalid-user-salt',64).toString('hex');if(!u||!equal(hash,u.hash)){res.status(401).json({error:'E-mail ou senha inválidos.'});return;}await session(res,u);res.json({user:publicUser(u)});});
app.post('/api/auth/logout',async(req,res)=>{await db.delete('_sessions',[key(req)]);res.clearCookie('salesos_session',cookieOptions).json({ok:true});});
app.get('/api/files',async(req,res)=>{const path=String(req.query.path||''),expires=Number(req.query.expires),signature=String(req.query.signature||'');if(!Number.isFinite(expires)||expires<Date.now()||expires>Date.now()+300000||!equal(signature,sign(path+':'+expires))){res.status(403).json({error:'Link expirado ou inválido.'});return;}const f=(await db.get<any>('_files',[path]))[0];if(!f){res.sendStatus(404);return;}res.setHeader('Content-Type',f.contentType);res.setHeader('Content-Disposition','attachment');res.send(Buffer.from(f.content,'base64'));});
app.use('/api',async(req,res)=>{
 const pathname=req.originalUrl.split('?')[0];
 for(const [route,chain] of Object.entries(handler)){
  const [method,path]=route.split(' ');if(method!==req.method)continue;
  const names:string[]=[];const pattern=path.replace(/:([a-zA-Z]+)/g,(_,name)=>{names.push(name);return '([^/]+)';});const match=pathname.match(new RegExp('^'+pattern+'$'));if(!match)continue;
  const ctx={user:await sessionUser(req),body:req.body,params:Object.fromEntries(names.map((n,i)=>[n,decodeURIComponent(match[i+1])])),query:Object.fromEntries(new URL(req.originalUrl,'http://local').searchParams),event:{headers:req.headers}};
  try{for(const fn of chain){const result=await fn(ctx);if(result!==undefined){res.status(result.statusCode||200).json(result.body);return;}}res.status(204).end();}catch(e){console.error('Request failed',req.method,pathname,e instanceof Error?e.message:'unknown');res.status(500).json({error:'Não foi possível concluir a operação.'});}return;
 }
 res.status(404).json({error:'Endpoint não encontrado.'});
});
const dist=resolve('dist');
app.use(express.static(dist,{index:false}));
app.get('/{*path}',(_req,res)=>res.sendFile(resolve(dist,'index.html')));
app.use((err:any,_req:any,res:any,_next:any)=>res.status(err.status===413?413:400).json({error:'Requisição inválida.'}));
const port=Number(process.env.PORT||3000);
const server=app.listen(port,'0.0.0.0',()=>console.log('SalesOS listening on '+port));
let running=false;
const cron=setInterval(async()=>{if(running)return;running=true;try{await dispatchCron();}catch{console.error('Scheduled dispatch failed');}finally{running=false;}},60000);
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>{clearInterval(cron);server.close(()=>{sqlite.close();process.exit(0);});});
