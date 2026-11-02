import { useEffect, useRef, useState } from 'react';
import { BookOpenText, Copy, FileText, Save, Sparkles } from 'lucide-react';
import { api } from './client';

type Studio = {
  channel: string;
  objective: string;
  offer: string;
  content: string;
  revision: number;
  updatedAt?: string;
};
const emptyStudio: Studio = { channel: 'email', objective: '', offer: '', content: '', revision: 0 };
const message = (e: unknown) => e instanceof Error ? e.message : 'Não foi possível concluir.';

type Props = {
  workspaceId: string;
  userId: string;
  editable: boolean;
  onNotice: (text: string) => void;
};

export default function CommercialIntelligence({ workspaceId, userId, editable, onNotice }: Props) {
  const cacheKey = `salesos-studio-v1:${userId}:${workspaceId}`;
  const [studio, setStudio] = useState<Studio>({ ...emptyStudio });
  const [dirty, setDirty] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');
  const saveRequest = useRef('');
  const generationRequest = useRef('');

  const remember = (value: Studio, changed: boolean) => {
    try { localStorage.setItem(cacheKey, JSON.stringify({ studio: value, dirty: changed })); }
    catch { /* Server saving remains available when browser storage is disabled. */ }
  };

  useEffect(() => {
    let active = true;
    let cached: { studio: Studio; dirty: boolean } | null = null;
    try {
      const raw = localStorage.getItem(cacheKey);
      if (raw) cached = JSON.parse(raw);
      if (cached?.studio) {
        setStudio(cached.studio);
        setDirty(cached.dirty);
      }
    } catch { cached = null; }
    api.get('/api/salesos/intelligence?workspaceId=' + encodeURIComponent(workspaceId))
      .then(response => {
        if (!active) return;
        const saved = response.data.studio;
        if (!cached?.dirty) {
          setStudio(saved || { ...emptyStudio });
          setDirty(false);
        }
      })
      .catch(e => { if (active) setError(message(e)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [cacheKey, workspaceId]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const change = (key: keyof Studio, value: string) => {
    const next = { ...studio, [key]: value };
    setStudio(next);
    setDirty(true);
    setError('');
    saveRequest.current = '';
    generationRequest.current = '';
    remember(next, true);
  };

  const save = async () => {
    if (!workspaceId || loading || !editable) return;
    setSaving(true);
    setError('');
    if (!saveRequest.current) saveRequest.current = crypto.randomUUID();
    try {
      const response = await api.put('/api/salesos/intelligence', {
        ...studio, workspaceId, requestId: saveRequest.current,
      });
      setStudio(response.data.studio);
      setDirty(false);
      remember(response.data.studio, false);
      onNotice('Personalização salva nesta empresa.');
    } catch (e) { setError(message(e)); }
    finally { setSaving(false); }
  };

  const reopen = async () => {
    if (dirty && !window.confirm('Reabrir a versão salva e descartar as alterações locais? Copie seu texto antes se quiser preservá-lo.')) return;
    setLoading(true);
    setError('');
    try {
      const response = await api.get('/api/salesos/intelligence?workspaceId=' + encodeURIComponent(workspaceId));
      const saved = response.data.studio || { ...emptyStudio };
      setStudio(saved);
      setDirty(false);
      saveRequest.current = '';
      remember(saved, false);
    } catch (e) { setError(message(e)); }
    finally { setLoading(false); }
  };

  const generate = async () => {
    setGenerating(true);
    setError('');
    try {
      if (!generationRequest.current) generationRequest.current = crypto.randomUUID().replace(/-/g, '');
      const response = await api.post('/api/salesos/ai/draft', {
        workspaceId, channel: studio.channel, objective: studio.objective, offer: studio.offer, requestId: generationRequest.current,
      });
      let result = response.data;
      if (result.jobId) {
        const deadline = Date.now() + 240000;
        while (Date.now() < deadline) {
          const update = await api.get('/api/salesos/ai/jobs/' + result.jobId + '?workspaceId=' + encodeURIComponent(workspaceId));
          if (update.data.state === 'completed') { result = update.data; break; }
          if (update.data.state === 'failed') { generationRequest.current = ''; throw new Error(update.data.error || 'A IA não concluiu o rascunho.'); }
          await new Promise(resolve => setTimeout(resolve, 4000));
        }
        if (!result.text) throw new Error('A IA ainda está processando. Tente consultar novamente em instantes.');
      }
      if (typeof result.text !== 'string' || !result.text.trim()) throw new Error('A IA retornou um rascunho vazio.');
      change('content', result.text);
      onNotice('Rascunho gerado. Revise o texto e salve sua personalização.');
    } catch (e) { setError(message(e)); }
    finally { setGenerating(false); }
  };

  if (!workspaceId) return <div className='sos-empty'><BookOpenText /><h3>Selecione uma empresa</h3><p>Suas personalizações ficam vinculadas à empresa selecionada.</p></div>;
  const disabled = loading || saving || generating;
  return (
    <section aria-label='Editor de inteligência comercial'>
      <div className='sos-info-line' role='status'>
        <Save size={16} />
        {loading ? 'Carregando personalização…' : dirty ? 'Há alterações ainda não salvas no servidor.' : studio.updatedAt ? 'Salvo em ' + new Date(studio.updatedAt).toLocaleString('pt-BR') : 'Personalize e salve sua abordagem nesta empresa.'}
      </div>
      {error && <div className='sos-info-line' role='alert'>{error}</div>}
      <div className='sos-two-col intelligence'>
        <div className='sos-panel'>
          <div className='sos-panel-head'><div><h3>Studio de abordagens com IA</h3><p>Seu contexto comercial salvo por empresa</p></div><Sparkles size={19} /></div>
          <div className='sos-form-stack'>
            <label className='sos-field'><span>Canal</span><select value={studio.channel} disabled={!editable || disabled} onChange={e => change('channel', e.target.value)}><option value='email'>E-mail</option><option value='whatsapp'>WhatsApp</option><option value='voice'>Ligação IA</option></select></label>
            <label className='sos-field'><span>Objetivo da abordagem</span><input maxLength={1000} value={studio.objective} disabled={!editable || disabled} onChange={e => change('objective', e.target.value)} placeholder='Ex.: Apresentar serviços de marketing digital' /></label>
            <label className='sos-field'><span>Oferta comercial verificada</span><textarea rows={8} maxLength={12000} value={studio.offer} disabled={!editable || disabled} onChange={e => change('offer', e.target.value)} placeholder='Descreva os serviços e condições que deseja usar.' /></label>
            <button type='button' className='sos-btn primary' disabled={disabled || !editable} onClick={save}><Save size={16} />{saving ? 'Salvando…' : 'Salvar personalização'}</button>
            <button type='button' className='sos-btn secondary' disabled={disabled} onClick={reopen}>Reabrir versão salva</button>
            <button type='button' className='sos-btn secondary' disabled={disabled || !editable} onClick={generate}><Sparkles size={16} />{generating ? 'Gerando…' : 'Gerar rascunho com IA'}</button>
          </div>
        </div>
        <div className='sos-panel'>
          <div className='sos-panel-head'><div><h3>Conteúdo personalizado</h3><p>Edite o texto e clique em Salvar personalização</p></div><FileText size={18} /></div>
          <div className='sos-form-stack'>
            <label className='sos-field'><span>Texto da abordagem</span><textarea rows={18} maxLength={24000} value={studio.content} disabled={!editable || disabled} onChange={e => change('content', e.target.value)} placeholder='Escreva seu texto ou gere um rascunho com IA.' /></label>
            <small>Rascunho para revisão. Salvar não envia mensagens nem inicia ligações.</small>
            <button type='button' className='sos-btn secondary' disabled={!studio.content} onClick={() => navigator.clipboard.writeText(studio.content).then(() => onNotice('Conteúdo copiado.')).catch(e => setError(message(e)))}><Copy size={15} />Copiar texto</button>
          </div>
        </div>
      </div>
    </section>
  );
}
