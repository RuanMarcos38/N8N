import { bridgeEnabled, callBridge, n8nGatewayUrl } from './n8nBridge.ts';
import { router, json, error, requireAuth, db, secrets } from './runtime.ts';
import { salesOsRoutes } from './salesos.ts';

type Item = Record<string, any>;
const clean = (s: string) => s.replace(/[^A-Za-z0-9]/g, '').slice(0, 70);
const table = (name: string, userId: string) =>
  'sdr_' + name + '_' + clean(userId);
const list = async (name: string, userId: string, limit = 150) =>
  (await db.list<Item>(table(name, userId), { limit })).items;
const id = () => 'r' + crypto.randomUUID().replace(/-/g, '');
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const date = () => new Date().toISOString();
const body = (ctx: { body: unknown }) => (ctx.body || {}) as Item;
const basis = ['consent', 'legitimate_interest_assessed', 'contractual'];
const channels = ['email', 'whatsapp', 'voice'];
const stamp = () =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
const clock = () => ({
  hour: Number(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'America/Sao_Paulo',
      hour: '2-digit',
      hourCycle: 'h23',
    }).format(new Date())
  ),
  day: new Date().toLocaleDateString('en-US', {
    timeZone: 'America/Sao_Paulo',
    weekday: 'short',
  }),
});
const hash = (s: string) => {
  let h = 2166136261;
  for (const c of s) {
    h ^= c.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
};
const leadEligible = (l: Item, channel: string) =>
  Boolean(
    l &&
    !l.optOut &&
    l.status !== 'bloqueado' &&
    basis.includes(l.legalBasis) &&
    l.source &&
    (channel === 'email'
      ? /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(l.email || '')
      : /^55\d{10,11}$/.test((l.phone || '').replace(/\D/g, ''))) &&
    !(channel === 'whatsapp' && !l.whatsappOptIn) &&
    !(channel === 'voice' && !l.voiceAllowed)
  );
const replyError = (e: unknown) =>
  error(
    e instanceof Error ? e.message : 'Ocorreu um erro. Tente novamente.',
    400
  );
async function getOne(name: string, uid: string, key: string) {
  return (await db.get<Item>(table(name, uid), [key], { consistent: true }))[0];
}
async function putOne(name: string, uid: string, item: Item) {
  const [key] = await db.add(table(name, uid), [item]);
  if (!key) throw new Error('Não foi possível salvar.');
  return key;
}
async function updateOne(name: string, uid: string, key: string, record: Item) {
  const [ok] = await db.tx.update(table(name, uid), [{ id: key, record }], {
    patch: true,
  });
  if (!ok)
    throw new Error('Registro não encontrado ou atualização concorrente.');
}
async function log(uid: string, event: Item) {
  await putOne('activity', uid, { ...event, at: date() });
}
async function status() {
  const names = await secrets.listSecretNames();
  return {
    n8n:
      names.includes('N8N_WEBHOOK_TOKEN'),
    email: names.includes('EMAIL_PROVIDER_KEY'),
    whatsapp: names.includes('WHATSAPP_ACCESS_TOKEN'),
    voice: names.includes('RETELL_API_KEY'),
  };
}
async function dispatch(
  uid: string,
  lead: Item,
  campaign: Item,
  channel: string,
  manual = false
) {
  if (!channels.includes(channel) || !campaign.channels.includes(channel))
    throw new Error('Canal não habilitado nesta campanha.');
  if (campaign.status !== 'active')
    throw new Error('Ative a campanha antes de enviar.');
  if (!leadEligible(lead, channel))
    throw new Error('Contato sem elegibilidade documentada para este canal.');
  if (lead.lastContactAt && Date.now() - Date.parse(lead.lastContactAt) < 86400000)
    throw new Error('Intervalo mínimo de 24 horas entre contatos não atingido.');
  if (channel === 'whatsapp' && !campaign.whatsappTemplateName)
    throw new Error('Informe o nome do template WhatsApp aprovado antes do envio.');
  const c = clock();
  if (c.hour < 9 || c.hour >= 18 || ['Sat', 'Sun'].includes(c.day))
    throw new Error('Fora da janela comercial (seg-sex, 09h-18h).');
  const usingBridge = await bridgeEnabled(uid);
  if (usingBridge && channel === 'voice') throw new Error('O provedor de ligações ainda não está conectado.');
  const names = await secrets.listSecretNames();
  if (
    (!usingBridge && !names.includes('N8N_WEBHOOK_URL')) ||
    !names.includes('N8N_WEBHOOK_TOKEN')
  )
    throw new Error('Configure o webhook seguro n8n para habilitar os envios.');
  const urlString = usingBridge ? n8nGatewayUrl : await secrets.readSecret('N8N_WEBHOOK_URL');
  const webhookToken = await secrets.readSecret('N8N_WEBHOOK_TOKEN');
  const url = new URL(urlString);
  if (
    url.protocol !== 'https:' ||
    !url.hostname.includes('.') ||
    ['localhost', '127.0.0.1'].includes(url.hostname)
  )
    throw new Error('Webhook n8n precisa ser HTTPS público.');
  const daily = stamp();
  const dailyKey = campaign.id + '_' + daily.replace(/-/g, '');
  const counterTable = table('counters', uid);
  let counter = (
    await db.get<Item>(counterTable, [dailyKey], { consistent: true })
  )[0];
  if (!counter) {
    await db.tx.add(counterTable, [{ id: dailyKey, count: 0 }]);
    counter = (
      await db.get<Item>(counterTable, [dailyKey], { consistent: true })
    )[0];
  }
  const used = Number(counter?.count || 0);
  if (used >= Math.min(Number(campaign.dailyLimit || 50), 500))
    throw new Error('Limite diário da campanha atingido.');
  const receiptId =
    hash(uid + campaign.id + lead.id + channel) +
    '_' +
    campaign.id.slice(-8) +
    '_' +
    lead.id.slice(-8) +
    '_' +
    channel;
  const existing = (
    await db.get<Item>(table('receipts', uid), [receiptId], {
      consistent: true,
    })
  )[0];
  if (existing)
    throw new Error(
      'Este canal já foi acionado para este lead nesta campanha.'
    );
  const reserve = db.tx.add(table('receipts', uid), [
    {
      id: receiptId,
      leadId: lead.id,
      campaignId: campaign.id,
      channel,
      status: 'reserved',
      at: date(),
      manual,
    },
  ]);
  const count = db.tx.update(
    counterTable,
    [{ id: dailyKey, record: { count: used + 1 }, if: { count: used } }],
    { patch: true }
  );
  try {
    await db.transact([reserve, count]);
  } catch {
    throw new Error(
      'Envio já reservado ou limite concorrente; atualize e tente novamente.'
    );
  }
  const payload = {
    event: 'sdr.outreach.requested',
    idempotency_key: receiptId,
    owner_id: uid,
    workspace_id: campaign.workspaceId,
    campaign_id: campaign.id,
    lead_id: lead.id,
    channel,
    created_at: date(),
    lead: {
      name: lead.name,
      company: lead.company,
      email: lead.email,
      phone: lead.phone,
      source: lead.source,
      legal_basis: lead.legalBasis,
    },
    campaign: {
      title: campaign.name,
      niche: campaign.niche,
      objective: campaign.objective,
      whatsapp_template: campaign.whatsappTemplateName || '',
      whatsapp_language: campaign.whatsappLanguage || 'pt_BR',
    },
    message:
      channel === 'email'
        ? campaign.emailText
        : channel === 'whatsapp'
          ? campaign.whatsappText
          : campaign.voiceScript,
    controls: {
      opt_out: lead.optOut,
      whatsapp_opt_in: lead.whatsappOptIn,
      voice_allowed: lead.voiceAllowed,
      max_daily: campaign.dailyLimit,
      require_provider_confirmation: true,
    },
  };
  try {
    let provider: Item | undefined;
    if (usingBridge) {
      provider = await callBridge(uid, channel + '.send', payload);
    } else {
      const response = await fetch(url.toString(), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-SDR-Token': webhookToken,
          'X-Idempotency-Key': receiptId,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(12000),
      });
      if (!response.ok) throw new Error('n8n retornou HTTP ' + response.status);
    }
    await updateOne('receipts', uid, receiptId, { status: 'accepted' });
    await updateOne('leads', uid, lead.id, { lastContactAt: date() });
    if (usingBridge) {
      await db.tx.add('salesos_messages_' + clean(uid), [{
        id: 'bridge_' + receiptId, workspaceId: campaign.workspaceId, leadId: lead.id,
        campaignId: campaign.id, channel, direction: 'outbound', status: 'requested',
        message: payload.message, provider: 'n8n', providerEventId: provider?.providerId || '', at: date(),
      }]);
    }

    await log(uid, {
      title: 'Solicitação ' + channel + ' aceita pelo n8n',
      leadId: lead.id,
      workspaceId: campaign.workspaceId,
      campaignId: campaign.id,
      channel,
      kind: 'dispatch',
    });
    return {
      acceptedByN8n: true,
      receiptId,
      note: 'O n8n aceitou a solicitação; entrega final depende do provedor e do retorno assíncrono.',
    };
  } catch (e) {
    await updateOne('receipts', uid, receiptId, {
      status: 'uncertain',
      detail: e instanceof Error ? e.message : 'Falha',
    });
    await log(uid, {
      title: 'Envio incerto — revisar no n8n antes de tentar novamente',
      leadId: lead.id,
      workspaceId: campaign.workspaceId,
      campaignId: campaign.id,
      channel,
      kind: 'warning',
    });
    throw new Error(
      'Resultado de envio incerto. Consulte o n8n pelo identificador ' +
        receiptId +
        ' antes de repetir.'
    );
  }
}
export const handler = router({
  ...salesOsRoutes,
  'GET /api/_healthcheck': [async () => json({ ok: true })],
  'GET /api/bootstrap': [
    requireAuth(),
    async ctx => {
      const uid = ctx.user!.userId;
      const [
        workspaces,
        leads,
        campaigns,
        activity,
        templates,
        settings,
        connected,
      ] = await Promise.all([
        list('workspaces', uid, 100),
        list('leads', uid, 200),
        list('campaigns', uid, 100),
        list('activity', uid, 100),
        list('templates', uid, 100),
        list('settings', uid, 20),
        status(),
      ]);
      return json({
        workspaces,
        leads,
        campaigns,
        activity: activity.sort((a, b) =>
          String(b.at).localeCompare(String(a.at))
        ),
        templates,
        settings: settings[0] || null,
        connected,
      });
    },
  ],
  'POST /api/workspaces': [
    requireAuth(),
    async ctx => {
      const b = body(ctx),
        uid = ctx.user!.userId;
      if (!str(b.name) || str(b.name).length > 80)
        return error('Informe um nome até 80 caracteres.', 400);
      const key = await putOne('workspaces', uid, {
        name: str(b.name),
        niche: str(b.niche) || 'Geral',
        description: str(b.description).slice(0, 500),
        createdAt: date(),
      });
      return json({ id: key });
    },
  ],
  'POST /api/leads': [
    requireAuth(),
    async ctx => {
      const uid = ctx.user!.userId,
        b = body(ctx);
      const ws = await getOne('workspaces', uid, str(b.workspaceId));
      if (!ws) return error('Espaço de trabalho inválido.', 404);
      const rows = Array.isArray(b.items) ? b.items.slice(0, 100) : [b];
      const results = { created: 0, duplicate: 0, invalid: 0 };
      for (const raw of rows) {
        const r = raw as Item;
        const name = str(r.name).slice(0, 120),
          email = str(r.email).toLowerCase().slice(0, 200),
          digits = str(r.phone).replace(/\D/g, '');
        const phone = digits.startsWith('55')
          ? digits
          : digits.length === 10 || digits.length === 11
            ? '55' + digits
            : digits;
        const source = str(r.source).slice(0, 250);
        if (
          !name ||
          !source ||
          !basis.includes(str(r.legalBasis)) ||
          (!email && !/^55\d{10,11}$/.test(phone))
        ) {
          results.invalid++;
          continue;
        }
        const identity = phone || email;
        const key =
          'lead_' +
          hash(uid + str(b.workspaceId) + identity) +
          '_' +
          hash(identity + uid + str(b.workspaceId));
        const [created] = await db.tx.add(table('leads', uid), [
          {
            id: key,
            workspaceId: str(b.workspaceId),
            name,
            company: str(r.company).slice(0, 140),
            email,
            phone,
            source,
            legalBasis: str(r.legalBasis),
            whatsappOptIn: r.whatsappOptIn === true,
            voiceAllowed: r.voiceAllowed === true,
            optOut: false,
            status: 'Novo',
            notes: str(r.notes).slice(0, 2000),
            createdAt: date(),
            lastContactAt: '',
          },
        ]);
        if (created) results.created++;
        else results.duplicate++;
      }
      return json(results);
    },
  ],
  'PUT /api/leads/:id': [
    requireAuth(),
    async ctx => {
      const uid = ctx.user!.userId,
        key = ctx.params.id,
        original = await getOne('leads', uid, key),
        b = body(ctx);
      if (!original) return error('Lead não encontrado.', 404);
      const record: Item = {};
      for (const field of [
        'status',
        'notes',
        'company',
        'name',
        'lastContactAt',
      ]) {
        if (field in b)
          record[field] = str(b[field]).slice(
            0,
            field === 'notes' ? 2000 : 150
          );
      }
      if (b.optOut === true) {
        record.optOut = true;
        record.status = 'bloqueado';
      }
      if (b.optOut === false)
        return error(
          'Bloqueio não pode ser removido sem nova autorização documentada.',
          400
        );
      if (!Object.keys(record).length)
        return error('Sem alterações válidas.', 400);
      await updateOne('leads', uid, key, record);
      if (record.optOut)
        await log(uid, {
          title: 'Contato bloqueado por oposição',
          workspaceId: original.workspaceId,
          leadId: key,
          kind: 'privacy',
        });
      return json({ updated: true });
    },
  ],
  'DELETE /api/leads/:id': [
    requireAuth(),
    async ctx => {
      const uid = ctx.user!.userId;
      const target = await getOne('leads', uid, ctx.params.id);
      if (!target) return error('Registro não encontrado.', 404);
      await db.delete(table('leads', uid), [ctx.params.id]);
      await log(uid, {
        title: 'Registro de lead excluído',
        workspaceId: target.workspaceId,
        kind: 'privacy',
      });
      return json({ deleted: true });
    },
  ],
  'POST /api/campaigns': [
    requireAuth(),
    async ctx => {
      const uid = ctx.user!.userId,
        b = body(ctx),
        ws = await getOne('workspaces', uid, str(b.workspaceId));
      if (!ws) return error('Nicho/espaço inválido.', 404);
      if (!str(b.name)) return error('Informe o nome da campanha.', 400);
      const selected = Array.isArray(b.channels)
        ? b.channels.filter((c: unknown) => channels.includes(String(c)))
        : [];
      if (!selected.length) return error('Selecione pelo menos um canal.', 400);
      const key = await putOne('campaigns', uid, {
        workspaceId: str(b.workspaceId),
        name: str(b.name).slice(0, 120),
        niche: ws.niche,
        objective: str(b.objective).slice(0, 400),
        channels: selected,
        status: 'draft',
        dailyLimit: Math.min(500, Math.max(1, Number(b.dailyLimit) || 50)),
        emailText: str(b.emailText).slice(0, 5000),
        whatsappText: str(b.whatsappText).slice(0, 1500),
        whatsappTemplateName: str(b.whatsappTemplateName).slice(0, 120),
        whatsappLanguage: str(b.whatsappLanguage) || 'pt_BR',
        voiceScript: str(b.voiceScript).slice(0, 5000),
        createdAt: date(),
      });
      return json({ id: key });
    },
  ],
  'PUT /api/campaigns/:id': [
    requireAuth(),
    async ctx => {
      const uid = ctx.user!.userId,
        b = body(ctx),
        original = await getOne('campaigns', uid, ctx.params.id);
      if (!original) return error('Campanha não encontrada.', 404);
      if (b.action === 'activate') {
        if (b.confirmed !== true)
          return error('Confirmação explícita necessária.', 400);
        if (!(await status()).n8n)
          return error('Configure o webhook n8n antes de ativar.', 400);
        const keys = await secrets.listSecretNames();
        if (!keys.includes('SALESOS_LIVE_DISPATCH_APPROVED') || (await secrets.readSecret('SALESOS_LIVE_DISPATCH_APPROVED')) !== 'approved')
          return error('Homologação de produção pendente. Campanha não ativada.', 400);
        await updateOne('campaigns', uid, ctx.params.id, { status: 'active' });
        await db.tx.add('sdr_active_campaigns', [
          {
            id: 'active_' + clean(uid) + '_' + clean(ctx.params.id),
            ownerId: uid,
            campaignId: ctx.params.id,
            enabled: true,
          },
        ]);
        await log(uid, {
          title: 'Campanha ativada',
          workspaceId: original.workspaceId,
          campaignId: ctx.params.id,
          kind: 'campaign',
        });
      } else if (b.action === 'pause') {
        await updateOne('campaigns', uid, ctx.params.id, { status: 'paused' });
        await db.delete('sdr_active_campaigns', [
          'active_' + clean(uid) + '_' + clean(ctx.params.id),
        ]);
        await log(uid, {
          title: 'Campanha pausada',
          workspaceId: original.workspaceId,
          campaignId: ctx.params.id,
          kind: 'campaign',
        });
      } else return error('Ação desconhecida.', 400);
      return json({ updated: true });
    },
  ],
  'POST /api/dispatch': [
    requireAuth(),
    async ctx => {
      const uid = ctx.user!.userId,
        b = body(ctx);
      const [lead, campaign] = await Promise.all([
        getOne('leads', uid, str(b.leadId)),
        getOne('campaigns', uid, str(b.campaignId)),
      ]);
      if (!lead || !campaign || lead.workspaceId !== campaign.workspaceId)
        return error('Campanha e lead não correspondem.', 400);
      try {
        return json(
          await dispatch(
            uid,
            { ...lead, id: str(b.leadId) },
            { ...campaign, id: str(b.campaignId) },
            str(b.channel),
            true
          )
        );
      } catch (e) {
        return replyError(e);
      }
    },
  ],
  'POST /api/templates': [
    requireAuth(),
    async ctx => {
      const uid = ctx.user!.userId,
        b = body(ctx);
      const ws = await getOne('workspaces', uid, str(b.workspaceId));
      if (!ws) return error('Espaço inválido.', 400);
      if (
        !str(b.title) ||
        !channels.includes(str(b.channel)) ||
        !str(b.content)
      )
        return error('Preencha título, canal e conteúdo.', 400);
      const key = await putOne('templates', uid, {
        workspaceId: str(b.workspaceId),
        title: str(b.title).slice(0, 100),
        channel: str(b.channel),
        content: str(b.content).slice(0, 5000),
        createdAt: date(),
      });
      return json({ id: key });
    },
  ],
  'DELETE /api/templates/:id': [
    requireAuth(),
    async ctx => {
      const uid = ctx.user!.userId,
        target = await getOne('templates', uid, ctx.params.id);
      if (!target) return error('Modelo não encontrado.', 404);
      await db.delete(table('templates', uid), [ctx.params.id]);
      return json({ deleted: true });
    },
  ],
  'GET /api/integrations': [requireAuth(), async () => json(await status())],
});

export const dispatchCron = async () => {
  const active = await db.list<Item>('sdr_active_campaigns', { limit: 60 });
  const c = clock();
  if (c.hour < 9 || c.hour >= 18 || ['Sat', 'Sun'].includes(c.day))
    return { statusCode: 200 };
  for (const a of active.items.slice(0, 15)) {
    if (!a.enabled) continue;
    const uid = a.ownerId,
      campaign = await getOne('campaigns', uid, a.campaignId);
    if (!campaign || campaign.status !== 'active') continue;
    let done = 0;
    let cursor: string | undefined;
    for (let pageNo = 0; pageNo < 12 && done < 5; pageNo++) {
      const page = await db.list<Item>(table('leads', uid), { limit: 200, ...(cursor ? { nextToken: cursor } : {}) });
      for (const lead of page.items) {
        if (done >= 5) break;
        if (lead.workspaceId !== campaign.workspaceId) continue;
        if (lead.lastContactAt && Date.now() - Date.parse(lead.lastContactAt) < 86400000) continue;
        for (const channel of campaign.channels) {
          if (!leadEligible(lead, channel)) continue;
          if (channel === 'whatsapp' && !campaign.whatsappTemplateName) continue;
          const receiptId = hash(uid + a.campaignId + lead.id + channel) + '_' + a.campaignId.slice(-8) + '_' + lead.id.slice(-8) + '_' + channel;
          if (await getOne('receipts', uid, receiptId)) continue;
          try { await dispatch(uid, lead, { ...campaign, id: a.campaignId }, channel, false); done++; }
          catch (e) { console.warn('Dispatch skipped:', e instanceof Error ? e.message : String(e)); }
          break;
        }
      }
      cursor = page.nextToken;
      if (!cursor) break;
    }
  }
  return { statusCode: 200 };
};
