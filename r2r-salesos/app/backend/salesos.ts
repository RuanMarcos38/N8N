import { db, json, error, requireAuth, ai, storage, secrets, invites, isInviteError, increment } from './runtime.ts';
import type { RouterRoutes } from './runtime.ts';

type R = Record<string, any>;
type Ctx = { user?: {userId:string;email?:string;name?:string}; body: unknown; params:Record<string,string>; query:Record<string,string>; event:any };
const id = () => crypto.randomUUID().replace(/-/g,'');
const norm = (s:unknown) => typeof s === 'string' ? s.trim() : '';
const safe = (s:string) => s.replace(/[^A-Za-z0-9]/g,'').slice(0,75);
const tab = (kind:string, owner:string) => 'salesos_'+kind+'_'+safe(owner);
const legacy = (kind:string, owner:string) => 'sdr_'+kind+'_'+safe(owner);
const now = () => new Date().toISOString();
const stages = ['Novo Lead','Validado','Em Prospecção','Contato Realizado','Interação Iniciada','Interesse Identificado','Lead Qualificado','Reunião Agendada','Proposta Enviada','Negociação','Convertido','Perdido'];
const types = ['opportunities','tasks','appointments','messages','knowledge','agents','cadences','activity'];
const editable:Record<string,string[]> = {
  opportunities:['title','leadId','stage','value','priority','assignee','notes','dueAt','tags'],
  tasks:['title','leadId','status','priority','dueAt','assignee','notes'],
  appointments:['title','description','status','leadId','startAt','duration','assignee','timezone','kind'],
  knowledge:['title','content','description','tags','visibility'],
  agents:['name','role','tone','instructions','offer','audience','channels','enabled','budgetLimit','region'],
  cadences:['title','description','steps','status','channels','dailyLimit'],
  messages:[], activity:[]
};
const body = (c:Ctx) => (c.body || {}) as R;
const isEmail=(s:string)=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
const phone=(s:unknown)=>{const p=norm(s).replace(/\D/g,'');return p.startsWith('55')?p:([10,11].includes(p.length)?'55'+p:p);};
const basis=['consent','legitimate_interest_assessed','contractual'];
const all = async (table:string,limit=200) => (await db.list<R>(table,{limit})).items;
const one = async (table:string,key:string) => (await db.get<R>(table,[key],{consistent:true}))[0];
const add = async (table:string, obj:R) => {
  const key=obj.id||'r'+id(); const [saved] = await db.tx.add(table,[{...obj,id:key}]);
  if(!saved) throw new Error('Registro duplicado ou operação não confirmada.');
  return key;
};
const patch = async (table:string,key:string, change:R, expected?:R) => {
  const [ok]=await db.tx.update(table,[{id:key,record:change,...(expected?{if:expected}:{})}],{patch:true});
  if(!ok) throw new Error('Registro indisponível ou alterado por outro usuário.');
};
const respond=(e:unknown)=>error(e instanceof Error?e.message:'Operação não concluída.',400);
const headers=(c:Ctx)=>c.event?.headers||{};
const header=(c:Ctx,name:string)=>String(headers(c)[name]||headers(c)[name.toLowerCase()]||headers(c)[name.toUpperCase()]||'');
const user=(c:Ctx)=>c.user!.userId;
async function scope(uid:string,workspaceId:string): Promise<{ownerId:string;role:string;workspace:R}> {
  if (!workspaceId) throw new Error('Selecione uma empresa.');
  const own=await one(legacy('workspaces',uid),workspaceId);
  if(own)return {ownerId:uid,role:'owner',workspace:{id:workspaceId,...own}};
  const m=await one(tab('membership',uid),'member_'+safe(workspaceId));
  if(!m||m.workspaceId!==workspaceId)throw new Error('Sem acesso a esta empresa.');
  const ws=await one(legacy('workspaces',m.ownerId),workspaceId);
  if(!ws)throw new Error('Empresa indisponível.');
  return {ownerId:m.ownerId,role:m.role as string,workspace:{id:workspaceId,...ws}};
}
const can=(role:string,level:'edit'|'admin') => level==='admin'?['owner','admin'].includes(role):['owner','admin','editor'].includes(role);
async function requireScope(c:Ctx,level:'read'|'edit'|'admin'='read'){
  const b=body(c), workspaceId=norm(b.workspaceId||c.query.workspaceId);
  const s=await scope(user(c),workspaceId);
  if(level!=='read'&&!can(s.role,level))throw new Error('Permissão insuficiente para esta ação.');
  return s;
}
async function audit(owner:string,wid:string,title:string,kind='system',other:R={}) {
  await add(tab('activity',owner),{workspaceId:wid,title,kind,at:now(),...other});
}
async function bootstrap(uid:string){
  const owned=(await all(legacy('workspaces',uid),100)).map(w=>({...w,ownerId:uid,role:'owner'}));
  const joined=await all(tab('membership',uid),100);
  const allowed:R[]=[...owned];
  for (const m of joined) {
    if(allowed.some(w=>w.id===m.workspaceId))continue;
    const w=await one(legacy('workspaces',m.ownerId),m.workspaceId);
    if(w)allowed.push({...w,id:m.workspaceId,ownerId:m.ownerId,role:m.role});
  }
  const owners=[...new Set(allowed.map(w=>w.ownerId))];
  const kinds=[...types,'ledger','topups','team','wallet'];
  const payload:R={workspaces:allowed,leads:[],campaigns:[]};
  for(const k of kinds) payload[k]=[];
  for(const owner of owners.slice(0,12)){
    const [leads,campaigns,...newRows]=await Promise.all([
      all(legacy('leads',owner),300),all(legacy('campaigns',owner),200),
      ...kinds.map(k=>all(tab(k,owner),200))
    ]);
    const permitted=new Set(allowed.filter(w=>w.ownerId===owner).map(w=>w.id));
    payload.leads.push(...leads.filter(v=>permitted.has(v.workspaceId)).map(v=>({...v,ownerId:owner})));
    payload.campaigns.push(...campaigns.filter(v=>permitted.has(v.workspaceId)).map(v=>({...v,ownerId:owner})));
    kinds.forEach((k,i)=>payload[k].push(...newRows[i].filter(v=>permitted.has(v.workspaceId)).map(v=>({...v,ownerId:owner}))));
  }
  const names=await secrets.listSecretNames();
  payload.integrations={
    n8n:names.includes('N8N_WEBHOOK_URL')&&names.includes('N8N_WEBHOOK_TOKEN'),
    meta:names.includes('WHATSAPP_ACCESS_TOKEN'),
    email:names.includes('EMAIL_PROVIDER_KEY'),
    vapi:names.includes('VAPI_API_KEY'),
    retell:names.includes('RETELL_API_KEY'),
    asaasSandbox:names.includes('ASAAS_SANDBOX_API_KEY')&&names.includes('ASAAS_CUSTOMER_ID'),
    googleCalendar:false
  };
  payload.generatedAt=now();
  payload.limits={dailyCalls:500,callWindow:'Seg–Sex 09:00–18:00 (America/Sao_Paulo)'};
  return payload;
}
async function createGeneric(c:Ctx){
  const kind=c.params.kind, b=body(c);
  if(!types.includes(kind)||kind==='messages'||kind==='activity')throw new Error('Tipo de registro não permitido.');
  const s=await requireScope(c,'edit');
  const obj:R={workspaceId:norm(b.workspaceId),createdAt:now(),updatedAt:now()};
  const permitted=editable[kind]||[];
  for(const key of permitted){
    if(key in b)obj[key]=typeof b[key]==='string'?norm(b[key]).slice(0,5000):b[key];
  }
  if(kind==='agents'){
    if(!norm(obj.name))throw new Error('Informe o nome do agente.');
    obj.enabled=false;
  } else if(!norm(obj.title))throw new Error('Informe um título.');
  if(kind==='tasks')obj.status='Pendente';
  if(kind==='cadences'){obj.status='draft'; obj.dailyLimit=Math.min(500,Math.max(1,Number(obj.dailyLimit)||50));obj.steps=Array.isArray(obj.steps)?obj.steps.slice(0,10):[];}
  if(kind==='opportunities'){obj.value=Math.max(0,Number(obj.value)||0);obj.stage=stages.includes(obj.stage)?obj.stage:stages[0];}
  if(kind==='appointments'){
    const t=Date.parse(obj.startAt||'');
    if(!Number.isFinite(t)||t<Date.now()-3600000)throw new Error('Informe data e horário válidos.');
    const duration=Math.min(240,Math.max(15,Number(obj.duration)||60));
    obj.duration=duration;
    obj.status='agendado';
    const locks:R[]=[];
    for(let x=Math.floor(t/900000)*900000;x<t+duration*60000;x+=900000){
      locks.push({id:'slot_'+safe(obj.workspaceId)+'_'+safe(obj.assignee||'default')+'_'+x,workspaceId:obj.workspaceId,at:x});
    }
    if(locks.length>30)throw new Error('Duração acima do limite.');
    const event={...obj,id:'meeting_'+id()};
    try {
      await db.transact([db.tx.add(tab('appointments',s.ownerId),[event]),db.tx.add(tab('slots',s.ownerId),locks)]);
    }catch {throw new Error('Horário ocupado ou reserva incerta. Verifique a agenda antes de tentar novamente.');}
    await audit(s.ownerId,obj.workspaceId,'Agendamento criado: '+obj.title,'appointment',{recordId:event.id});
    return {id:event.id};
  }
  const key=await add(tab(kind,s.ownerId),obj);
  await audit(s.ownerId,obj.workspaceId,'Registro criado: '+(obj.title||obj.name),kind,{recordId:key});
  return {id:key};
}
async function editGeneric(c:Ctx){
  const kind=c.params.kind, b=body(c), key=c.params.id;
  if(!types.includes(kind)||['messages','activity','appointments'].includes(kind))throw new Error('Esta alteração requer operação específica.');
  const s=await requireScope(c,'edit');
  const existing=await one(tab(kind,s.ownerId),key);
  if(!existing||existing.workspaceId!==norm(b.workspaceId))throw new Error('Registro não encontrado.');
  const change:R={updatedAt:now()};
  for(const field of editable[kind]||[]){
    if(field in b)change[field]=typeof b[field]==='string'?norm(b[field]).slice(0,5000):b[field];
  }
  if(kind==='cadences' && 'status' in change && change.status!=='paused'&&change.status!=='draft')
    throw new Error('Cadências automáticas só podem ser ativadas após homologação dos canais e cobrança.');
  if(kind==='agents'&&'enabled' in change)change.enabled=false;
  await patch(tab(kind,s.ownerId),key,change);
  await audit(s.ownerId,norm(b.workspaceId),'Registro atualizado: '+(existing.title||existing.name),kind,{recordId:key});
  return {updated:true};
}
async function addLead(c:Ctx){
  const b=body(c),s=await requireScope(c,'edit');
  const entries=Array.isArray(b.items)?b.items.slice(0,100):[b];
  const result={created:0,duplicate:0,invalid:0};
  for(const row of entries){
    const name=norm(row.name).slice(0,120), email=norm(row.email).toLowerCase().slice(0,150);
    const p=phone(row.phone), source=norm(row.source).slice(0,200), legalBasis=norm(row.legalBasis);
    if(!name||!source||!basis.includes(legalBasis)||(!isEmail(email)&&!/^55\d{10,11}$/.test(p))){result.invalid++;continue;}
    const identifier=(/^55\d{10,11}$/.test(p)?p:email);
    const key='saleslead_'+hashKey(norm(b.workspaceId)+identifier);
    const saved=await db.tx.add(legacy('leads',s.ownerId),[{id:key,name,email,phone:p,company:norm(row.company).slice(0,140),workspaceId:norm(b.workspaceId),source,legalBasis,whatsappOptIn:row.whatsappOptIn===true,voiceAllowed:row.voiceAllowed===true,optOut:false,status:'Novo',stage:'Novo Lead',createdAt:now(),lastContactAt:'',notes:''}]);
    if(saved[0])result.created++;else result.duplicate++;
  }
  if(result.created)await audit(s.ownerId,norm(b.workspaceId),result.created+' contato(s) cadastrado(s)','leads');
  return result;
}
function hashKey(s:string){ let h=2166136261;for(const ch of s){h^=ch.charCodeAt(0);h=Math.imul(h,16777619);}return (h>>>0).toString(36)+'_'+s.length;}
async function updateLead(c:Ctx){
  const b=body(c),s=await requireScope(c,'edit');
  const record=await one(legacy('leads',s.ownerId),c.params.id);
  if(!record||record.workspaceId!==norm(b.workspaceId))throw new Error('Contato não encontrado.');
  const change:R={};
  if(b.optOut===true){change.optOut=true;change.status='bloqueado';change.stage='Perdido';}
  if(b.optOut===false)throw new Error('Remoção do bloqueio exige novo registro formal de autorização.');
  if('stage' in b){
    if(record.optOut)throw new Error('Contato bloqueado para abordagens.');
    if(!stages.includes(b.stage))throw new Error('Etapa inválida.');
    change.stage=b.stage;change.status=b.stage;
  }
  if('notes' in b)change.notes=norm(b.notes).slice(0,2000);
  if(!Object.keys(change).length)throw new Error('Nenhuma alteração válida.');
  await patch(legacy('leads',s.ownerId),c.params.id,change);
  await audit(s.ownerId,norm(b.workspaceId),b.optOut?'Contato adicionado à supressão':'Estágio atualizado: '+(change.stage||'anotação'),'lead-change',{leadId:c.params.id});
  return {updated:true};
}
async function createCampaign(c:Ctx){
  const b=body(c),s=await requireScope(c,'edit');
  const name=norm(b.name);
  const channels=Array.isArray(b.channels)?b.channels.filter((v:unknown)=>['email','whatsapp','voice'].includes(String(v))):[];
  if(!name||!channels.length)throw new Error('Nome e canais são obrigatórios.');
  const campaign={workspaceId:norm(b.workspaceId),name:name.slice(0,150),niche:s.workspace.niche||'Geral',objective:norm(b.objective).slice(0,500),channels,status:'draft',dailyLimit:Math.min(500,Math.max(1,Number(b.dailyLimit)||50)),emailText:norm(b.emailText).slice(0,5000),whatsappText:norm(b.whatsappText).slice(0,1600),whatsappTemplateName:norm(b.whatsappTemplateName),whatsappLanguage:'pt_BR',voiceScript:norm(b.voiceScript).slice(0,5000),createdAt:now()};
  const key=await add(legacy('campaigns',s.ownerId),campaign);
  await audit(s.ownerId,norm(b.workspaceId),'Campanha criada: '+name,'campaign',{campaignId:key});
  return {id:key};
}
async function controlCampaign(c:Ctx){
  const b=body(c),s=await requireScope(c,'admin');
  const campaign=await one(legacy('campaigns',s.ownerId),c.params.id);
  if(!campaign||campaign.workspaceId!==norm(b.workspaceId))throw new Error('Campanha não encontrada.');
  if(b.action==='pause'){
    await patch(legacy('campaigns',s.ownerId),c.params.id,{status:'paused'});
    await db.delete('sdr_active_campaigns',['active_'+safe(s.ownerId)+'_'+safe(c.params.id)]);
  } else if(b.action==='activate'){
    if(b.confirmed!==true)throw new Error('Confirmação explícita obrigatória.');
    const keys=await secrets.listSecretNames();
    if(!keys.includes('N8N_WEBHOOK_URL')||!keys.includes('N8N_WEBHOOK_TOKEN')||!keys.includes('SALESOS_LIVE_DISPATCH_APPROVED'))
      throw new Error('Integração e homologação de produção pendentes. Campanha permanece sem disparos.');
    if((await secrets.readSecret('SALESOS_LIVE_DISPATCH_APPROVED'))!=='approved')
      throw new Error('Homologação de produção não concluída.');
    await db.tx.add('sdr_active_campaigns',[{id:'active_'+safe(s.ownerId)+'_'+safe(c.params.id),ownerId:s.ownerId,campaignId:c.params.id,enabled:true}]);
    await patch(legacy('campaigns',s.ownerId),c.params.id,{status:'active'});
  }else throw new Error('Ação inválida.');
  await audit(s.ownerId,norm(b.workspaceId),'Campanha '+(b.action==='pause'?'pausada':'ativada')+': '+campaign.name,'campaign',{campaignId:c.params.id});
  return {updated:true};
}
async function eventsInbound(c:Ctx){
  const names=await secrets.listSecretNames();
  if(!names.includes('SALESOS_EVENT_TOKEN'))return error('Endpoint sem credencial configurada.',503);
  const expected=await secrets.readSecret('SALESOS_EVENT_TOKEN');
  if(!expected||header(c,'x-salesos-token')!==expected)return error('Não autorizado.',401);
  const b=body(c),uid=norm(b.owner_id),wid=norm(b.workspace_id);
  const eid=norm(b.event_id),kind=norm(b.kind),states=['requested','queued','sent','delivered','read','replied','failed','call_started','call_answered','call_ended','qualified','opt_out'];
  if(!uid||!wid||!eid||eid.length>160||!states.includes(kind))return error('Evento inválido.',400);
  const ws=await one(legacy('workspaces',uid),wid);
  const lead=await one(legacy('leads',uid),norm(b.lead_id));
  if(!ws||!lead||lead.workspaceId!==wid)return error('Relação empresa/contato inválida.',400);
  const item={id:'event_'+hashKey(uid+wid+eid),workspaceId:wid,leadId:norm(b.lead_id),campaignId:norm(b.campaign_id),channel:['email','whatsapp','voice'].includes(b.channel)?b.channel:'email',providerEventId:eid,status:kind,direction:b.direction==='inbound'?'inbound':'outbound',message:norm(b.message).slice(0,5000),provider:norm(b.provider).slice(0,80),at:now(),durationSec:Math.max(0,Math.min(86400,Number(b.durationSec)||0)),costCents:Math.max(0,Math.min(100000,Number(b.costCents)||0))};
  const [added]=await db.tx.add(tab('messages',uid),[item]);
  if(!added)return json({duplicate:true});
  if(kind==='opt_out')await patch(legacy('leads',uid),norm(b.lead_id),{optOut:true,status:'bloqueado',stage:'Perdido'});
  if(kind==='qualified'&&!lead.optOut)await patch(legacy('leads',uid),norm(b.lead_id),{stage:'Lead Qualificado',status:'Lead Qualificado'});
  await audit(uid,wid,'Evento confirmado pelo integrador: '+kind,'provider',{leadId:norm(b.lead_id),channel:item.channel});
  return json({recorded:true});
}
async function createMeetingNote(c:Ctx){
  const b=body(c),s=await requireScope(c,'edit');
  const lead=await one(legacy('leads',s.ownerId),norm(b.leadId));
  if(!lead||lead.workspaceId!==norm(b.workspaceId))throw new Error('Contato inválido.');
  if(!norm(b.message))throw new Error('Anotação vazia.');
  const key=await add(tab('messages',s.ownerId),{workspaceId:norm(b.workspaceId),leadId:norm(b.leadId),channel:'internal',direction:'internal',status:'internal_note',message:norm(b.message).slice(0,4000),at:now(),createdBy:user(c)});
  await audit(s.ownerId,norm(b.workspaceId),'Anotação interna registrada','note',{leadId:norm(b.leadId)});
  return {id:key};
}
async function inviteUser(c:Ctx){
  const b=body(c),s=await requireScope(c,'admin');
  if(s.role!=='owner')throw new Error('Convites restritos ao proprietário da empresa.');
  const emailAddress=norm(b.email).toLowerCase();
  const role=norm(b.role);
  if(!isEmail(emailAddress)||!['admin','editor','viewer'].includes(role))throw new Error('E-mail ou função inválidos.');
  const created=await invites.create({resourceType:'salesos_workspace',authMode:'required',actor:c.user!,allowList:[emailAddress],expiresInSec:604800,context:{ownerId:s.ownerId,workspaceId:norm(b.workspaceId),role}});
  await audit(s.ownerId,norm(b.workspaceId),'Convite emitido para '+emailAddress,'team');
  return {code:created.code,role,email:emailAddress};
}
async function joinInvite(c:Ctx){
  const b=body(c);
  const joined=await invites.join({code:norm(b.code),actor:c.user!});
  if(joined.resourceType!=='salesos_workspace')throw new Error('Convite incompatível.');
  const context=joined.context||{};
  const wid=norm(context.workspaceId),owner=norm(context.ownerId),role=norm(context.role);
  if(!wid||!owner||!['admin','editor','viewer'].includes(role))throw new Error('Dados de convite inválidos.');
  const w=await one(legacy('workspaces',owner),wid);
  if(!w)throw new Error('Empresa removida.');
  const key='member_'+safe(wid);
  const membership={id:key,ownerId:owner,workspaceId:wid,role,email:c.user!.email||'',joinedAt:now()};
  const [saved]=await db.tx.add(tab('membership',user(c)),[membership]);
  if(!saved)throw new Error('Já existe associação com esta empresa.');
  await add(tab('team',owner),{workspaceId:wid,userId:user(c),email:c.user!.email||'',name:c.user!.name||'',role,joinedAt:now()});
  await audit(owner,wid,'Novo membro aceitou o convite','team');
  return {joined:true,workspaceId:wid};
}
async function knowledgeUpload(c:Ctx){
  const b=body(c),s=await requireScope(c,'edit');
  const content=norm(b.data),mime=norm(b.mime),filename=norm(b.filename);
  if(!['application/pdf','text/plain','text/markdown'].includes(mime)||!content||content.length>600000)
    throw new Error('Envie PDF ou texto de até aproximadamente 400 KB.');
  if(!filename||filename.length>180)throw new Error('Nome de arquivo inválido.');
  const fid=id(),path='salesos/'+safe(s.ownerId)+'/'+safe(norm(b.workspaceId))+'/'+fid;
  const [ok]=await storage.write([{path,content,contentType:mime}]);
  if(!ok)throw new Error('Falha ao armazenar o arquivo.');
  const key=await add(tab('knowledge',s.ownerId),{workspaceId:norm(b.workspaceId),title:filename,content:'',storagePath:path,description:'Arquivo armazenado. A indexação automática de PDF não está habilitada.',mime,createdAt:now()});
  await audit(s.ownerId,norm(b.workspaceId),'Arquivo incluído na base de conhecimento','knowledge');
  return {id:key};
}
async function knowledgeUrl(c:Ctx){
  const s=await requireScope(c,'read'),item=await one(tab('knowledge',s.ownerId),c.params.id);
  if(!item||item.workspaceId!==norm(c.query.workspaceId)||!item.storagePath)throw new Error('Arquivo não encontrado.');
  const links=await storage.url([item.storagePath]);
  return {url:links[0]?.url||''};
}
async function generateDraft(c:Ctx){
  const b=body(c),s=await requireScope(c,'edit');
  const channel=['email','whatsapp','voice'].includes(b.channel)?b.channel:'email';
  const knowledge=(await all(tab('knowledge',s.ownerId),100)).filter(x=>x.workspaceId===norm(b.workspaceId)&&x.content).map(x=>x.title+'\n'+x.content).join('\n').slice(0,9000);
  if(!knowledge&&!norm(b.offer))throw new Error('Cadastre a oferta ou conhecimento autorizado antes de gerar.');
  const prompt=['Crie um RASCUNHO de abordagem de prospecção, para revisão humana.','Empresa: '+s.workspace.name,'Nicho: '+(s.workspace.niche||''),'Canal: '+channel,'Objetivo: '+norm(b.objective),'Oferta validada: '+norm(b.offer),'Base autorizada: '+knowledge,'Regras: PT-BR, identifique a IA no canal voz, seja respeitoso, conciso, sem promessas, preços ou dados inventados. Respeite recusas; não presuma consentimento.','Devolva apenas o texto comercial.'].join('\n');
  const response=await ai.generate({prompt,maxTokens:550,thinkingMode:'FAST'});
  await audit(s.ownerId,norm(b.workspaceId),'Rascunho comercial gerado por IA para revisão','ai');
  return {text:response.text,draft:true};
}

async function cancelAppointment(c:Ctx){
  const b=body(c),s=await requireScope(c,'edit');
  const appointment=await one(tab('appointments',s.ownerId),c.params.id);
  if(!appointment||appointment.workspaceId!==norm(b.workspaceId))throw new Error('Compromisso não encontrado.');
  if(appointment.status==='cancelado')return {cancelled:true};
  const start=Date.parse(appointment.startAt),duration=Math.min(240,Math.max(15,Number(appointment.duration)||60));
  if(!Number.isFinite(start))throw new Error('Data inválida. Verificação manual necessária.');
  await patch(tab('appointments',s.ownerId),c.params.id,{status:'cancelado',cancelledAt:now()});
  const slots:string[]=[];
  for(let x=Math.floor(start/900000)*900000;x<start+duration*60000;x+=900000){
    slots.push('slot_'+safe(norm(b.workspaceId))+'_'+safe(appointment.assignee||'default')+'_'+x);
  }
  if(slots.length)await db.delete(tab('slots',s.ownerId),slots);
  await audit(s.ownerId,norm(b.workspaceId),'Compromisso cancelado: '+appointment.title,'appointment',{recordId:c.params.id});
  return {cancelled:true};
}
async function testProvider(c:Ctx){
  const s=await requireScope(c,'admin');
  if(s.role!=='owner')throw new Error('Testes de credenciais estão disponíveis somente ao proprietário.');
  const key=c.params.key,names=await secrets.listSecretNames();
  let url='',config='',headers:Record<string,string>={};
  if(key==='vapi'){
    config='VAPI_API_KEY';url='https://api.vapi.ai/assistant?limit=1';
    if(!names.includes(config))throw new Error('Configure a chave privada Vapi.');
    headers.Authorization='Bearer '+await secrets.readSecret(config);
  } else if(key==='asaas'){
    config='ASAAS_SANDBOX_API_KEY';url='https://api-sandbox.asaas.com/v3/customers?limit=1';
    if(!names.includes(config))throw new Error('Configure o Asaas sandbox.');
    headers.access_token=await secrets.readSecret(config);
  } else if(key==='meta'){
    config='WHATSAPP_ACCESS_TOKEN';url='https://graph.facebook.com/v25.0/me';
    if(!names.includes(config))throw new Error('Configure o token da Meta.');
    headers.Authorization='Bearer '+await secrets.readSecret(config);
  } else throw new Error('Teste de conexão não disponível para este provedor.');
  const result=await fetch(url,{method:'GET',headers,signal:AbortSignal.timeout(10000)});
  if(!result.ok)throw new Error('Teste não aprovado: HTTP '+result.status+'. Confira as permissões e a validade das credenciais.');
  await audit(s.ownerId,norm(body(c).workspaceId),'Teste de autenticação com '+key+' aprovado (somente leitura)','integration');
  return {tested:true,provider:key,validatedAt:now(),note:'Credencial responde a uma requisição somente leitura; entregas reais ainda precisam de homologação.'};
}

async function integrationsStatus(){
  const names=await secrets.listSecretNames();
  return [
    {key:'n8n',name:'n8n',configured:names.includes('N8N_WEBHOOK_URL')&&names.includes('N8N_WEBHOOK_TOKEN')},
    {key:'meta',name:'WhatsApp Cloud API',configured:names.includes('WHATSAPP_ACCESS_TOKEN')},
    {key:'email',name:'E-mail SMTP/API',configured:names.includes('EMAIL_PROVIDER_KEY')},
    {key:'vapi',name:'Vapi Voz IA',configured:names.includes('VAPI_API_KEY')},
    {key:'calendar',name:'Google Calendar OAuth',configured:false},
    {key:'asaas',name:'Asaas Sandbox',configured:names.includes('ASAAS_SANDBOX_API_KEY')&&names.includes('ASAAS_CUSTOMER_ID')},
    {key:'events',name:'Webhooks de retorno',configured:names.includes('SALESOS_EVENT_TOKEN')}
  ].map(v=>({...v,validated:false,status:v.configured?'Credencial presente — teste pendente':'Não configurado'}));
}
async function topUp(c:Ctx){
  const b=body(c),s=await requireScope(c,'admin');
  if(s.role!=='owner')throw new Error('Recarga exclusiva do proprietário.');
  const cents=Math.round(Number(b.amount)*100),requestId=norm(b.requestId);
  if(cents<5000||cents>100000||!/^[-a-zA-Z0-9]{16,70}$/.test(requestId))
    throw new Error('Valor deve estar entre R$ 50 e R$ 1.000 e requisição precisa ter ID único.');
  const names=await secrets.listSecretNames();
  if(!names.includes('ASAAS_SANDBOX_API_KEY')||!names.includes('ASAAS_CUSTOMER_ID'))
    throw new Error('Configure o Asaas SANDBOX antes de gerar recarga de teste.');
  const table=tab('topups',s.ownerId),key='topup_'+safe(requestId);
  const existing=await one(table,key);
  if(existing)return {id:key,status:existing.status,url:existing.url||'',sandbox:true};
  const [locked]=await db.tx.add(table,[{id:key,workspaceId:norm(b.workspaceId),amountCents:cents,status:'initiating',requestId,createdAt:now(),sandbox:true}]);
  if(!locked)throw new Error('Cobrança já solicitada. Consulte o extrato.');
  const apiKey=await secrets.readSecret('ASAAS_SANDBOX_API_KEY'),customer=await secrets.readSecret('ASAAS_CUSTOMER_ID');
  try{
    const res=await fetch('https://api-sandbox.asaas.com/v3/payments',{method:'POST',headers:{'Content-Type':'application/json','access_token':apiKey},body:JSON.stringify({customer,billingType:'UNDEFINED',value:cents/100,dueDate:new Date(Date.now()+86400000).toISOString().slice(0,10),description:'Créditos de teste R2R SalesOS',externalReference:requestId}),signal:AbortSignal.timeout(15000)});
    const jsonResult=await res.json() as R;
    if(!res.ok||!jsonResult.id)throw new Error('Asaas sandbox recusou a requisição.');
    await patch(table,key,{status:'pending',providerId:jsonResult.id,url:jsonResult.invoiceUrl||'',updatedAt:now()});
    await add('salesos_payment_map',{id:'pay_'+safe(jsonResult.id),ownerId:s.ownerId,workspaceId:norm(b.workspaceId),topupId:key,amountCents:cents,sandbox:true});
    await audit(s.ownerId,norm(b.workspaceId),'Cobrança sandbox gerada — pagamento ainda não confirmado','billing');
    return {id:key,status:'pending',url:jsonResult.invoiceUrl||'',sandbox:true};
  } catch (e) {
    await patch(table,key,{status:'uncertain',updatedAt:now()});
    throw new Error('Criação de cobrança incerta. Confira no Asaas sandbox antes de tentar novamente.');
  }
}
async function asaasCallback(c:Ctx){
  const names=await secrets.listSecretNames();
  if(!names.includes('ASAAS_WEBHOOK_TOKEN')||!names.includes('ASAAS_SANDBOX_API_KEY'))return error('Webhook indisponível.',503);
  const token=await secrets.readSecret('ASAAS_WEBHOOK_TOKEN');
  if(!token||header(c,'asaas-access-token')!==token)return error('Não autorizado.',401);
  const b=body(c),eventId=norm(b.id),pay=norm(b.payment?.id),kind=norm(b.event);
  if(!eventId||!pay)return error('Evento inválido.',400);
  const record=await one('salesos_payment_map','pay_'+safe(pay));
  if(!record)return error('Cobrança desconhecida.',404);
  if(!['PAYMENT_RECEIVED','PAYMENT_CONFIRMED'].includes(kind))return json({ignored:true});
  const key=await secrets.readSecret('ASAAS_SANDBOX_API_KEY');
  const res=await fetch('https://api-sandbox.asaas.com/v3/payments/'+encodeURIComponent(pay),{headers:{'access_token':key},signal:AbortSignal.timeout(9000)});
  if(!res.ok)return error('Falha de verificação do provedor.',502);
  const payment=await res.json() as R;
  if(!['RECEIVED','CONFIRMED'].includes(payment.status)||Math.round(Number(payment.value)*100)!==record.amountCents)return error('Pagamento ainda não confirmado.',409);
  const walletTable=tab('wallet',record.ownerId);
  await db.tx.add(walletTable,[{id:record.workspaceId,workspaceId:record.workspaceId,balanceCents:0,reservedCents:0}]);
  const creditId='credit_'+safe(pay);
  if(await one(tab('ledger',record.ownerId),creditId))return json({duplicate:true});
  try{
    await db.transact([
      db.tx.add(tab('ledger',record.ownerId),[{id:creditId,workspaceId:record.workspaceId,providerId:pay,deltaCents:record.amountCents,kind:'sandbox_topup',at:now(),sandbox:true}]),
      db.tx.update(walletTable,[{id:record.workspaceId,record:{balanceCents:increment(record.amountCents)}}],{patch:true})
    ]);
  }catch {return error('Conciliação indeterminada — revisão necessária.',503);}
  await patch(tab('topups',record.ownerId),record.topupId,{status:'confirmed',updatedAt:now()});
  await audit(record.ownerId,record.workspaceId,'Recarga sandbox confirmada pelo provedor','billing');
  return json({credited:true,sandbox:true});
}
export const salesOsRoutes:RouterRoutes={
  'GET /api/salesos/bootstrap':[requireAuth(),async c=>json(await bootstrap(user(c)))],
  'POST /api/salesos/records/:kind':[requireAuth(),async c=>{try{return json(await createGeneric(c));}catch(e){return respond(e);}}],
  'PUT /api/salesos/records/:kind/:id':[requireAuth(),async c=>{try{return json(await editGeneric(c));}catch(e){return respond(e);}}],
  'POST /api/salesos/leads':[requireAuth(),async c=>{try{return json(await addLead(c));}catch(e){return respond(e);}}],
  'PUT /api/salesos/leads/:id':[requireAuth(),async c=>{try{return json(await updateLead(c));}catch(e){return respond(e);}}],
  'POST /api/salesos/campaigns':[requireAuth(),async c=>{try{return json(await createCampaign(c));}catch(e){return respond(e);}}],
  'POST /api/salesos/campaigns/:id/action':[requireAuth(),async c=>{try{return json(await controlCampaign(c));}catch(e){return respond(e);}}],
  'POST /api/salesos/notes':[requireAuth(),async c=>{try{return json(await createMeetingNote(c));}catch(e){return respond(e);}}],
  'POST /api/salesos/ai/draft':[requireAuth(),async c=>{try{return json(await generateDraft(c));}catch(e){return respond(e);}}],
  'POST /api/salesos/knowledge/upload':[requireAuth(),async c=>{try{return json(await knowledgeUpload(c));}catch(e){return respond(e);}}],
  'GET /api/salesos/knowledge/:id/url':[requireAuth(),async c=>{try{return json(await knowledgeUrl(c));}catch(e){return respond(e);}}],
  'POST /api/salesos/team/invite':[requireAuth(),async c=>{try{return json(await inviteUser(c));}catch(e){return respond(e);}}],
  'GET /api/salesos/invites/:code':[async c=>{try{return json(await invites.resolve({code:c.params.code}));}catch(e){return isInviteError(e)?error(e.code,400):respond(e);}}],
  'POST /api/salesos/team/join':[requireAuth(),async c=>{try{return json(await joinInvite(c));}catch(e){return respond(e);}}],
  'GET /api/salesos/integrations':[requireAuth(),async()=>json(await integrationsStatus())],
  'POST /api/salesos/integrations/:key/test':[requireAuth(),async c=>{try{return json(await testProvider(c));}catch(e){return respond(e);}}],
  'POST /api/salesos/appointments/:id/cancel':[requireAuth(),async c=>{try{return json(await cancelAppointment(c));}catch(e){return respond(e);}}],
  'POST /api/salesos/wallet/topup':[requireAuth(),async c=>{try{return json(await topUp(c));}catch(e){return respond(e);}}],
  'POST /api/salesos/asaas/webhook':[async c=>{try{return await asaasCallback(c);}catch(e){return respond(e);}}],
  'POST /api/salesos/events/inbound':[async c=>{try{return await eventsInbound(c);}catch(e){return respond(e);}}]
};
