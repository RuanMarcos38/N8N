import { db, secrets } from './runtime.ts';

type RecordValue = Record<string, any>;
export const installationOwnerEmail = process.env.N8N_CONNECTION_OWNER_EMAIL || '';
export const n8nGatewayUrl = 'https://n8n-n8n.ke4n49.easypanel.host/webhook/r2r-salesos/v1';
const table = 'salesos_bridge_connection';

export async function bindConnectionOwner(ownerId: string, email: string) {
  if (email.toLowerCase() !== installationOwnerEmail) {
    throw new Error('A conexão das ferramentas deve ser configurada pelo proprietário da instalação.');
  }
  const [existing] = await db.get<RecordValue>(table, ['primary'], { consistent: true });
  if (existing && existing.ownerId !== ownerId) throw new Error('Conexão já vinculada a outra conta.');
  if (!existing) {
    const [saved] = await db.tx.add(table, [{ id: 'primary', ownerId }]);
    if (!saved) {
      const [current] = await db.get<RecordValue>(table, ['primary'], { consistent: true });
      if (current?.ownerId !== ownerId) throw new Error('Não foi possível vincular a conexão.');
    }
  }
}

export async function bridgeEnabled(ownerId: string) {
  const names = await secrets.listSecretNames();
  const [binding] = await db.get<RecordValue>(table, ['primary'], { consistent: true });
  return names.includes('N8N_WEBHOOK_TOKEN') && binding?.ownerId === ownerId;
}

export async function callBridge(ownerId: string, action: string, payload: RecordValue = {}) {
  if (!(await bridgeEnabled(ownerId))) throw new Error('Conecte as ferramentas na aba Integrações.');
  const token = await secrets.readSecret('N8N_WEBHOOK_TOKEN');
  if (token.length < 32) throw new Error('O código da conexão deve ter pelo menos 32 caracteres.');
  const response = await fetch(n8nGatewayUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-SDR-Token': token },
    body: JSON.stringify({ ...payload, action }),
    signal: AbortSignal.timeout(action === 'ai.draft' ? 60000 : 30000),
  });
  if (!response.ok) {
    throw new Error('O conector n8n retornou HTTP ' + response.status + '. Verifique a conexão antes de repetir a operação.');
  }
  const result = await response.json() as RecordValue;
  if (result.ok !== true) throw new Error('O n8n não confirmou esta operação.');
  return result;
}

export async function bridgeStatus(ownerId: string, workspaceId: string) {
  const names = await secrets.listSecretNames();
  const [saved] = await db.get<RecordValue>('salesos_bridge_status', [workspaceId], { consistent: true });
  const health = saved?.ownerId === ownerId ? saved : null;
  return {
    configured: names.includes('N8N_WEBHOOK_TOKEN'),
    bound: await bridgeEnabled(ownerId),
    checkedAt: health?.checkedAt || '',
    services: [
      { key: 'ai', name: 'IA local R2R', connected: health?.services?.ai === true },
      { key: 'email', name: 'E-mail Hostinger', connected: health?.services?.email === true },
      { key: 'whatsapp', name: 'WhatsApp Evolution', connected: health?.services?.whatsapp === true },
      { key: 'calendar', name: 'Google Calendar e Meet', connected: health?.services?.calendar === true },
      { key: 'voice', name: 'Ligações IA', connected: false, missing: 'Conta e provedor de voz ainda não identificados.' },
      { key: 'payments', name: 'Pagamentos', connected: false, missing: 'Conta e provedor de pagamentos ainda não identificados.' },
    ],
  };
}

export async function testBridge(ownerId: string, workspaceId: string, email: string) {
  await bindConnectionOwner(ownerId, email);
  const result = await callBridge(ownerId, 'health');
  const item = { id: workspaceId, ownerId, checkedAt: new Date().toISOString(), services: result.services };
  const [previous] = await db.get<RecordValue>('salesos_bridge_status', [workspaceId], { consistent: true });
  if (previous) {
    if (previous.ownerId !== ownerId) throw new Error('Conexão indisponível para esta empresa.');
    await db.tx.update('salesos_bridge_status', [{ id: workspaceId, record: item }], { patch: true });
  } else {
    await db.tx.add('salesos_bridge_status', [item]);
  }
  return bridgeStatus(ownerId, workspaceId);
}
