import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID, randomBytes, createHmac, timingSafeEqual } from 'node:crypto';

export type Row = Record<string, any>;
export type Context = { user?: {userId:string;email:string;name:string}; body:any; params:Record<string,string>; query:Record<string,string>; event:any };
export type RouterRoutes = Record<string, Array<(ctx:Context)=>any>>;
export const dataDir = resolve(process.env.DATA_DIR || './data');
mkdirSync(dataDir,{recursive:true});
export const sqlite = new DatabaseSync(resolve(dataDir,'salesos.sqlite'));
sqlite.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS records (collection TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(collection,id));');
const read=(t:string,id:string)=>{const r=sqlite.prepare('SELECT data FROM records WHERE collection=? AND id=?').get(t,id) as any;return r?JSON.parse(r.data):undefined;};
const write=(t:string,r:Row)=>sqlite.prepare('INSERT INTO records(collection,id,data) VALUES(?,?,?) ON CONFLICT(collection,id) DO UPDATE SET data=excluded.data').run(t,r.id,JSON.stringify(r));
export class Operation implements PromiseLike<any[]> {
  run:()=>any[];
  constructor(run:()=>any[]){this.run=run;}
  then<A=any[],B=never>(ok?:((v:any[])=>A|PromiseLike<A>)|null,fail?:((e:any)=>B|PromiseLike<B>)|null):Promise<A|B>{return Promise.resolve().then(()=>this.run()).then(ok,fail);}
}
export const increment=(amount:number)=>({__increment:amount});
const tx={
  add:(t:string,rows:Row[])=>new Operation(()=>rows.map(r=>{const v={...r,id:r.id||randomUUID()};if(read(t,v.id))return false;write(t,v);return v.id;})),
  update:(t:string,rows:Row[],options:Row={})=>new Operation(()=>rows.map(r=>{const old=read(t,r.id);if(!old||Object.entries(r.if||{}).some(([k,v])=>old[k]!==v))return false;const change={...r.record};for(const [k,v] of Object.entries(change))if(v&&typeof v==='object'&&'__increment' in v)change[k]=Number(old[k]||0)+Number(v.__increment);write(t,{...(options.patch?old:{}),...change,id:r.id});return true;}))
};
export const db={
  tx,
  get:async<T=Row>(t:string,ids:string[],_options?:any):Promise<T[]>=>ids.map(id=>read(t,id)),
  list:async<T=Row>(t:string,options:Row={}):Promise<{items:T[];nextToken?:string}>=>{const offset=Number(options.nextToken||0),limit=Math.min(1000,Math.max(1,options.limit||200));if(!Number.isSafeInteger(offset)||offset<0)throw Error('Cursor inválido.');const rows=sqlite.prepare('SELECT data FROM records WHERE collection=? ORDER BY rowid LIMIT ? OFFSET ?').all(t,limit+1,offset) as any[];return {items:rows.slice(0,limit).map(r=>JSON.parse(r.data)),...(rows.length>limit?{nextToken:String(offset+limit)}:{})};},
  add:async(t:string,rows:Row[])=>await tx.add(t,rows),
  delete:async(t:string,ids:string[])=>{for(const id of ids)sqlite.prepare('DELETE FROM records WHERE collection=? AND id=?').run(t,id);},
  transact:async(ops:Operation[])=>{sqlite.exec('BEGIN IMMEDIATE');try{const results=ops.map(op=>op.run());if(results.some(r=>r.some(x=>!x)))throw Error('Conflito de atualização.');sqlite.exec('COMMIT');return results;}catch(e){sqlite.exec('ROLLBACK');throw e;}}
};
export const json=(body:any,statusCode=200)=>({statusCode,body});
export const error=(message:string,statusCode=400)=>json({error:message},statusCode);
export const requireAuth=()=>async(c:Context)=>c.user?undefined:error('Entre na sua conta.',401);
export const requireAdminEmailAllowlist = (emails: string[]) => async (c: Context) => emails.some(email => email && c.user?.email?.toLowerCase() === email.toLowerCase()) ? undefined : error('A conexão deve ser configurada pelo proprietário da instalação.', 403);
export const router=(routes:RouterRoutes)=>routes;
const secretNames=['N8N_WEBHOOK_URL','N8N_WEBHOOK_TOKEN','SALESOS_LIVE_DISPATCH_APPROVED','SALESOS_EVENT_TOKEN','WHATSAPP_ACCESS_TOKEN','WHATSAPP_PHONE_NUMBER_ID','EMAIL_PROVIDER_KEY','VAPI_API_KEY','VAPI_ASSISTANT_ID','VAPI_PHONE_NUMBER_ID','RETELL_API_KEY','ASAAS_SANDBOX_API_KEY','ASAAS_CUSTOMER_ID','ASAAS_WEBHOOK_TOKEN','AI_DRAFT_WEBHOOK_URL','AI_DRAFT_WEBHOOK_TOKEN'];
export const secrets={listSecretNames:async()=>secretNames.filter(k=>!!process.env[k]),readSecret:async(k:string)=>{if(!secretNames.includes(k))throw Error('Configuração inválida.');return process.env[k]||'';}};
export const ai={generate:async({prompt}:Row)=>{const url=process.env.AI_DRAFT_WEBHOOK_URL;if(!url)throw Error('Configure AI_DRAFT_WEBHOOK_URL e AI_DRAFT_WEBHOOK_TOKEN para gerar rascunhos.');if(!url.startsWith('https://')||!process.env.AI_DRAFT_WEBHOOK_TOKEN)throw Error('Integração de IA exige HTTPS e token.');const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+process.env.AI_DRAFT_WEBHOOK_TOKEN},body:JSON.stringify({prompt}),signal:AbortSignal.timeout(45000)});if(!r.ok)throw Error('O serviço de IA não respondeu com sucesso.');const result=await r.json() as Row;if(typeof result.text!=='string'||!result.text.trim())throw Error('O serviço de IA retornou uma resposta vazia.');return {text:result.text};}};
// Files remain in the persistent database; URLs are signed and expire after five minutes.
const signingKey=process.env.SETUP_TOKEN || randomBytes(32).toString('hex');
export const sign=(s:string)=>createHmac('sha256',signingKey).update(s).digest('hex');
export const equal=(a:string,b:string)=>Buffer.byteLength(a)===Buffer.byteLength(b)&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
export const storage={
  write:async(files:Row[])=>files.map(f=>{write('_files',{id:f.path,content:f.content,contentType:f.contentType});return true;}),
  url:async(paths:string[])=>paths.map(path=>{const expires=Date.now()+300000;return {url:'/api/files?path='+encodeURIComponent(path)+'&expires='+expires+'&signature='+sign(path+':'+expires)};})
};
class InviteError extends Error{code='INVITE_INVALID';}
export const isInviteError=(e:any):e is InviteError=>e instanceof InviteError;
const invite=(code:string)=>{const r=read('_invites',code);if(!r||r.expires<Date.now())throw new InviteError('Convite inválido ou expirado.');return r;};
export const invites={
  create:async(args:Row)=>{const code=randomBytes(24).toString('hex');write('_invites',{...args,id:code,code,expires:Date.now()+args.expiresInSec*1000});return {code};},
  resolve:async({code}:Row)=>{const r=invite(code);return {resourceType:r.resourceType,authMode:r.authMode};},
  join:async({code,actor}:Row)=>{const r=invite(code);if(!r.allowList.includes(actor.email.toLowerCase())||(r.joinedBy&&r.joinedBy!==actor.userId))throw new InviteError('Este convite não pertence a esta conta.');write('_invites',{...r,joinedBy:actor.userId});return {resourceType:r.resourceType,context:r.context};}
};
