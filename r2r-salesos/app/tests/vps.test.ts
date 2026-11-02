import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

test('VPS: authentication, isolation, CRUD, files, invites and persistence', {timeout:60000}, async()=>{
 const dir=mkdtempSync(join(tmpdir(),'salesos-test-')),port=18000+Math.floor(Math.random()*10000),base='http://127.0.0.1:'+port,setupToken=randomBytes(32).toString('hex');
 let child:ChildProcess,logs='';
 async function start(){child=spawn(process.execPath,['backend/server.ts'],{env:{...process.env,DATA_DIR:dir,PORT:String(port),SETUP_TOKEN:setupToken,COOKIE_SECURE:'false',APP_URL:base},stdio:['ignore','pipe','pipe']});child.stdout!.on('data',b=>logs+=b);child.stderr!.on('data',b=>logs+=b);for(let i=0;i<100;i++){try{if((await fetch(base+'/api/health')).ok)return;}catch{}await new Promise(r=>setTimeout(r,100));}throw Error(logs);}
 async function stop(){if(child?.exitCode===null){const done=new Promise<void>(r=>child.once('exit',()=>r()));child.kill();await done;}}
 async function call(path:string,method='GET',body?:any,cookie=''){const r=await fetch(base+path,{method,headers:{...(body?{'Content-Type':'application/json'}:{}),...(cookie?{Cookie:cookie}:{})},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]||''};}
 const password='Test-only-secure-password-123';
 try{
 await start();
 assert.equal((await call('/api/salesos/bootstrap')).status,401);
 assert.equal((await call('/api/auth/register','POST',{name:'Admin',email:'admin@example.test',password,setupToken:'wrong'})).status,403);
 const account=await call('/api/auth/register','POST',{name:'Admin',email:'admin@example.test',password,setupToken});assert.equal(account.status,200);const owner=account.cookie;
 assert.equal((await call('/api/auth/status')).data.setupRequired,false);
 assert.equal((await call('/api/auth/register','POST',{name:'Attacker',email:'other@example.test',password,setupToken})).status,403);
 assert.equal((await call('/api/auth/login','POST',{email:'admin@example.test',password:'wrong'})).status,401);
 const company=await call('/api/workspaces','POST',{name:'Clínica Teste',niche:'Estética'},owner);assert.equal(company.status,200);const workspaceId=company.data.id;
 const studioBody={workspaceId,channel:'whatsapp',objective:'Apresentação personalizada',offer:'Oferta verificada',content:'Texto revisado',revision:0,requestId:'save-test-1'};
 const savedStudio=await call('/api/salesos/intelligence','PUT',studioBody,owner);assert.equal(savedStudio.status,200);assert.equal(savedStudio.data.studio.revision,1);
 assert.equal((await call('/api/salesos/intelligence','PUT',studioBody,owner)).data.studio.revision,1);
 assert.equal((await call('/api/salesos/intelligence?workspaceId='+workspaceId,'GET',undefined,owner)).data.studio.content,'Texto revisado');
 assert.equal((await call('/api/salesos/intelligence','PUT',{...studioBody,requestId:'stale-save'},owner)).status,400);
 assert.equal((await call('/api/salesos/intelligence','PUT',{...studioBody,revision:1,content:'',offer:'',objective:'',requestId:'empty-save'},owner)).status,400);
 const updatedStudio=await call('/api/salesos/intelligence','PUT',{...studioBody,revision:1,content:'Texto final',requestId:'save-test-2'},owner);assert.equal(updatedStudio.data.studio.revision,2);
 const otherCompany=await call('/api/workspaces','POST',{name:'Outra empresa'},owner);
 assert.equal((await call('/api/salesos/intelligence?workspaceId='+otherCompany.data.id,'GET',undefined,owner)).data.studio,null);
 const lead=await call('/api/salesos/leads','POST',{workspaceId,name:'Lead Teste',email:'lead@example.test',source:'Teste autorizado',legalBasis:'consent'},owner);assert.equal(lead.status,200,JSON.stringify(lead.data));
 let boot=await call('/api/salesos/bootstrap','GET',undefined,owner);assert.equal(boot.data.workspaces.length,2);assert.equal(boot.data.leads.length,1);const leadId=boot.data.leads[0].id;
 assert.equal((await call('/api/salesos/n8n/status?workspaceId='+workspaceId,'GET',undefined,owner)).data.configured,false);
 assert.equal((await call('/api/salesos/n8n/test','POST',{workspaceId},owner)).status,403);
 const meeting=await call('/api/salesos/records/appointments','POST',{workspaceId,title:'Reunião local',startAt:new Date(Date.now()+86400000).toISOString(),duration:30},owner);assert.equal(meeting.status,200);
 assert.equal((await call('/api/salesos/calendar/sync','POST',{workspaceId,appointmentId:meeting.data.id},owner)).status,400);
 assert.equal((await call('/api/salesos/appointments/'+meeting.data.id+'/cancel','POST',{workspaceId},owner)).status,200);
 const opportunity=await call('/api/salesos/records/opportunities','POST',{workspaceId,title:'Oportunidade',leadId,stage:'Novo Lead',value:100},owner);assert.equal(opportunity.status,200,JSON.stringify(opportunity.data));
 const knowledge=await call('/api/salesos/knowledge/upload','POST',{workspaceId,filename:'teste.txt',mime:'text/plain',data:Buffer.from('conteúdo de teste').toString('base64')},owner);assert.equal(knowledge.status,200);
 const file=await call('/api/salesos/knowledge/'+knowledge.data.id+'/url?workspaceId='+workspaceId,'GET',undefined,owner);assert.equal(file.status,200);assert.equal(await (await fetch(base+file.data.url)).text(),'conteúdo de teste');assert.equal((await fetch(base+file.data.url.replace(/signature=.*/,'signature=invalid'))).status,403);
 const invitation=await call('/api/salesos/team/invite','POST',{workspaceId,email:'viewer@example.test',role:'viewer'},owner);assert.equal(invitation.status,200);
 const invited=await call('/api/auth/register','POST',{name:'Viewer',email:'viewer@example.test',password,inviteCode:invitation.data.code});assert.equal(invited.status,200);const viewer=invited.cookie;
 assert.equal((await call('/api/salesos/bootstrap','GET',undefined,viewer)).data.leads.length,0);
 assert.equal((await call('/api/salesos/team/join','POST',{code:invitation.data.code},viewer)).status,200);
 assert.equal((await call('/api/salesos/bootstrap','GET',undefined,viewer)).data.leads.length,1);
 assert.equal((await call('/api/salesos/intelligence','PUT',{...studioBody,revision:2,requestId:'viewer-save'},viewer)).status,400);
 assert.equal((await call('/api/salesos/intelligence?workspaceId='+otherCompany.data.id,'GET',undefined,viewer)).status,400);
 const forbidden=await call('/api/salesos/records/tasks','POST',{workspaceId,title:'Proibido'},viewer);assert.notEqual(forbidden.status,200);
 const csrf=await fetch(base+'/api/workspaces',{method:'POST',headers:{Origin:'https://evil.example','Content-Type':'application/json',Cookie:owner},body:JSON.stringify({name:'Não criar'})});assert.equal(csrf.status,403);
 await stop();await start();boot=await call('/api/salesos/bootstrap','GET',undefined,owner);assert.equal(boot.status,200);assert.equal(boot.data.leads[0].name,'Lead Teste');assert.equal(boot.data.opportunities.length,1);assert.equal((await call('/api/salesos/intelligence?workspaceId='+workspaceId,'GET',undefined,owner)).data.studio.content,'Texto final');
 assert.equal((await call('/api/auth/logout','POST',{},owner)).status,200);assert.equal((await call('/api/salesos/bootstrap','GET',undefined,owner)).status,401);
 }finally{await stop();rmSync(dir,{recursive:true,force:true});}
});

test('atomic reservations rollback, conditional updates, pagination and increments',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'salesos-db-test-'));process.env.DATA_DIR=dir;
 const {db,increment,sqlite}=await import('../backend/runtime.ts');
 try{
 await db.add('wallet',[{id:'one',count:0}]);
 await assert.rejects(db.transact([db.tx.add('locks',[{id:'reserved'}]),db.tx.update('wallet',[{id:'one',record:{count:1},if:{count:9}}],{patch:true})]));
 assert.equal((await db.get('locks',['reserved']))[0],undefined);
 await db.transact([db.tx.add('locks',[{id:'reserved'}]),db.tx.update('wallet',[{id:'one',record:{count:increment(2)}}],{patch:true})]);
 assert.equal((await db.get<any>('wallet',['one']))[0].count,2);
 process.env.N8N_CONNECTION_OWNER_EMAIL='owner@example.test';
 process.env.N8N_WEBHOOK_TOKEN='test-only-connection-token-for-unit-tests-12345';
 const bridge=await import('../backend/n8nBridge.ts');
 await assert.rejects(bridge.bindConnectionOwner('other-owner','other@example.test'));
 await bridge.bindConnectionOwner('real-owner','owner@example.test');
 assert.equal(await bridge.bridgeEnabled('other-owner'),false);
 assert.equal(await bridge.bridgeEnabled('real-owner'),true);
 const realFetch=globalThis.fetch;
 try {
   globalThis.fetch=async(input,init)=>{
     assert.equal(String(input),bridge.n8nGatewayUrl);
     assert.equal(JSON.parse(String(init?.body)).action,'health');
     return new Response(JSON.stringify({ok:true,services:{email:true,whatsapp:true,calendar:true,ai:true}}),{status:200,headers:{'Content-Type':'application/json'}});
   };
   const status=await bridge.testBridge('real-owner','workspace-for-test','owner@example.test');
   assert.equal(status.services.filter(s=>s.connected).length,4);
   assert.equal(JSON.stringify(status).includes(process.env.N8N_WEBHOOK_TOKEN!),false);
   await assert.rejects(bridge.callBridge('other-owner','health'));
 } finally { globalThis.fetch=realFetch;delete process.env.N8N_WEBHOOK_TOKEN;delete process.env.N8N_CONNECTION_OWNER_EMAIL; }
 await db.add('pages',[{id:'a'},{id:'b'},{id:'c'}]);const first=await db.list('pages',{limit:2});assert.equal(first.items.length,2);assert.equal((await db.list('pages',{limit:2,nextToken:first.nextToken})).items.length,1);
 }finally{sqlite.close();rmSync(dir,{recursive:true,force:true});}
});
