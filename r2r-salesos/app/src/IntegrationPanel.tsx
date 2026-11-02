import { useEffect, useState } from 'react';
import { CheckCircle2, Cable, RefreshCcw } from 'lucide-react';
import { api } from './client';

type State = {
  configured: boolean;
  bound: boolean;
  checkedAt: string;
  services: {key: string; name: string; connected: boolean; missing?: string}[];
};
export default function IntegrationPanel({workspaceId, admin}: {workspaceId: string; admin: boolean}) {
  const [state, setState] = useState<State | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    if (!workspaceId) return;
    api.get('/api/salesos/n8n/status?workspaceId=' + encodeURIComponent(workspaceId))
      .then(response => { if (active) setState(response.data); })
      .catch(e => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [workspaceId]);
  const test = async () => {
    setBusy(true);
    setError('');
    try {
      const response = await api.post('/api/salesos/n8n/test', {workspaceId});
      setState(response.data);
    } catch (e) { setError(e instanceof Error ? e.message : 'Não foi possível testar a conexão.'); }
    finally { setBusy(false); }
  };
  if (!workspaceId) return <div className='sos-info-line'>Selecione uma empresa para configurar suas integrações.</div>;
  return (
    <section aria-label='Conexões das ferramentas'>
      <div className='sos-info-line'>
        <Cable size={17} />
        {state?.bound ? 'Conector n8n vinculado a esta instalação.' : 'Conecte o SalesOS ao n8n com o código protegido da instalação.'}
      </div>
      {error && <div className='sos-info-line' role='alert'>{error}</div>}
      <div className='sos-cardgrid integration-grid'>
        {state?.services.map(service => (
          <div className='sos-card' key={service.key}>
            <div className='sos-card-head'><span className='sos-card-icon'><Cable size={19}/></span><span className={'sos-status ' + (service.connected ? 'good' : 'neutral')}>{service.connected ? 'Conectado' : 'Pendente'}</span></div>
            <h3>{service.name}</h3>
            <p>{service.missing || (service.connected ? 'A conexão respondeu ao teste de acesso. As operações ficam registradas no sistema.' : 'Aguardando conexão e teste de acesso.')}</p>
            {service.connected && <small><CheckCircle2 size={14}/>Verificado em {new Date(state.checkedAt).toLocaleString('pt-BR')}</small>}
          </div>
        ))}
      </div>
      {!state?.configured && <p className='sos-note'>O código da conexão ainda precisa ser cadastrado no formulário seguro e na credencial do conector n8n.</p>}
      <button type='button' className='sos-btn primary' disabled={busy || !admin || !state?.configured} onClick={test}><RefreshCcw size={16}/>{busy ? 'Verificando…' : 'Conectar e testar ferramentas'}</button>
      <p className='sos-note'>O teste consulta acesso e disponibilidade. Não envia mensagens, não inicia ligações e não faz cobranças.</p>
    </section>
  );
}
