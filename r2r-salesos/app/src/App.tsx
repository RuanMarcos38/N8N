import { useEffect, useMemo, useState } from 'react';
import SalesOSApp from './SalesOSApp';
import { auth, api } from '@appdeploy/client';
import {
  LayoutDashboard,
  Users,
  Megaphone,
  Layers3,
  MessageSquare,
  Workflow,
  Settings,
  BarChart3,
  Search,
  Bell,
  ChevronDown,
  Plus,
  PhoneCall,
  Mail,
  Send,
  ShieldCheck,
  ArrowUpRight,
  Sparkles,
  TrendingUp,
  Building2,
  CheckCircle2,
  CircleAlert,
  Clock,
  RefreshCw,
  PauseCircle,
  PlayCircle,
  Upload,
  Download,
  Trash2,
  X,
  Menu,
  LogOut,
  ChevronRight,
  FileText,
  Ban,
  Globe2,
  Activity,
  CalendarClock,
  CircleDot,
  Filter,
  Database,
  Link2,
  Copy,
} from 'lucide-react';

type Row = Record<string, any>;
type State = {
  workspaces: Row[];
  leads: Row[];
  campaigns: Row[];
  templates: Row[];
  activity: Row[];
  connected: Row;
};
const empty: State = {
  workspaces: [],
  leads: [],
  campaigns: [],
  templates: [],
  activity: [],
  connected: {},
};
const nav = [
  { key: 'dashboard', title: 'Visão geral', icon: LayoutDashboard },
  { key: 'leads', title: 'Leads & contatos', icon: Users },
  { key: 'campaigns', title: 'Campanhas', icon: Megaphone },
  { key: 'workspaces', title: 'Nichos e operações', icon: Layers3 },
  { key: 'templates', title: 'Scripts & mensagens', icon: MessageSquare },
  { key: 'automations', title: 'Automações n8n', icon: Workflow },
  { key: 'reports', title: 'Relatórios', icon: BarChart3 },
  { key: 'settings', title: 'Configurações', icon: Settings },
];
const channelLabel: Row = {
  email: 'E-mail',
  whatsapp: 'WhatsApp',
  voice: 'Ligação IA',
};
const money = (n: number) =>
  new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    maximumFractionDigits: 0,
  }).format(n);
const today = () => new Date().toLocaleDateString('pt-BR');
const pill = (s: string) =>
  s === 'active'
    ? 'success'
    : s === 'paused'
      ? 'warning'
      : s === 'bloqueado'
        ? 'danger'
        : 'neutral';
const getError = (e: unknown) => {
  const er = e as {
    response?: { data?: { error?: string; message?: string } };
    message?: string;
  };
  return (
    er?.response?.data?.message ||
    er?.response?.data?.error ||
    er?.message ||
    'Não foi possível concluir a ação.'
  );
};
const downloadCsv = (items: Row[]) => {
  const cols = [
    'name',
    'company',
    'email',
    'phone',
    'source',
    'legalBasis',
    'status',
    'workspaceId',
  ];
  const cell = (v: unknown) => '"' + String(v ?? '').replace(/"/g, '""') + '"';
  const csv = [
    cols.join(','),
    ...items.map(i => cols.map(c => cell(i[c])).join(',')),
  ].join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(
    new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' })
  );
  a.download = 'leads-sdr.csv';
  a.click();
  URL.revokeObjectURL(a.href);
};
const parseCsv = (src: string) => {
  const sep = src.split('\n')[0]?.includes(';') ? ';' : ',';
  const lines = src.trim().split(/\r?\n/);
  const parseLine = (line: string) => {
    const out: string[] = [];
    let current = '',
      inside = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"' && line[i + 1] === '"' && inside) {
        current += '"';
        i++;
      } else if (ch === '"') inside = !inside;
      else if (ch === sep && !inside) {
        out.push(current.trim());
        current = '';
      } else current += ch;
    }
    out.push(current.trim());
    return out;
  };
  const headers = parseLine(lines.shift() || '').map(s =>
    s.trim().toLowerCase()
  );
  return lines.filter(Boolean).map(line => {
    const fields = parseLine(line),
      o: Row = {};
    headers.forEach((h, i) => {
      const col: Row = {
        nome: 'name',
        name: 'name',
        empresa: 'company',
        company: 'company',
        email: 'email',
        telefone: 'phone',
        celular: 'phone',
        whatsapp: 'phone',
        phone: 'phone',
        origem: 'source',
        source: 'source',
        baselegal: 'legalBasis',
        legalbasis: 'legalBasis',
        consentimento: 'whatsappOptIn',
        whatsappoptin: 'whatsappOptIn',
        voiceallowed: 'voiceAllowed',
      };
      const key = col[h.replace(/[^a-z]/g, '')];
      if (key) o[key] = fields[i] || '';
    });
    o.whatsappOptIn = ['true', 'sim', '1', 'yes'].includes(
      String(o.whatsappOptIn || '').toLowerCase()
    );
    o.voiceAllowed = ['true', 'sim', '1', 'yes'].includes(
      String(o.voiceAllowed || '').toLowerCase()
    );
    return o;
  });
};
function App() {
  const [user, setUser] = useState<Row | null>(null);
  const [ready, setReady] = useState(false);
  const [page, setPage] = useState('dashboard');
  const [data, setData] = useState<State>(empty);
  const [workspaceId, setWorkspaceId] = useState('all');
  const [modal, setModal] = useState('');
  const [toast, setToast] = useState('');
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState('');
  const [mobileNav, setMobileNav] = useState(false);
  const [form, setForm] = useState<Row>({});
  const [importRows, setImportRows] = useState<Row[]>([]);
  const [lastUpdated, setLastUpdated] = useState('');
  const alert = (s: string) => {
    setToast(s);
  };
  const load = async () => {
    const res = await api.get('/api/bootstrap');
    setData(res.data);
    setLastUpdated(today());
  };
  useEffect(() => {
    let alive = true;
    auth
      .getUser()
      .then(async u => {
        if (!alive) return;
        setUser(u);
        if (u) {
          try {
            await load();
          } catch (e) {
            alert(getError(e));
          }
        }
        setReady(true);
      })
      .catch(e => {
        alert(getError(e));
        setReady(true);
      });
    return () => {
      alive = false;
    };
  }, []);
  const mutate = async (
    url: string,
    method: 'post' | 'put' | 'delete',
    b: Row = {}
  ) => {
    setBusy(true);
    try {
      const res =
        method === 'post'
          ? await api.post(url, b)
          : method === 'put'
            ? await api.put(url, b)
            : await api.delete(url, b);
      await load();
      setModal('');
      setForm({});
      setImportRows([]);
      alert('Operação salva com sucesso.');
      return res.data;
    } catch (e) {
      alert(getError(e));
      return null;
    } finally {
      setBusy(false);
    }
  };
  const open = (name: string, initial: Row = {}) => {
    setForm(initial);
    setModal(name);
    setImportRows([]);
  };
  const workspace = data.workspaces.find(w => w.id === workspaceId);
  const scoped = (rows: Row[]) =>
    rows.filter(r => workspaceId === 'all' || r.workspaceId === workspaceId);
  const leads = scoped(data.leads).filter(l =>
    [l.name, l.company, l.email, l.phone]
      .join(' ')
      .toLowerCase()
      .includes(query.toLowerCase())
  );
  const campaigns = scoped(data.campaigns);
  const activity = scoped(data.activity);
  const eligible = leads.filter(
    l => !l.optOut && l.status !== 'bloqueado' && l.legalBasis && l.source
  );
  const active = campaigns.filter(c => c.status === 'active');
  const contacted = activity.filter(a => a.kind === 'dispatch').length;
  const name =
    page === 'dashboard'
      ? 'Visão geral'
      : nav.find(n => n.key === page)?.title || 'Painel';
  const set = (key: string, v: any) => setForm(f => ({ ...f, [key]: v }));
  if (!ready)
    return (
      <div className="center-page">
        <div className="brand-large">
          <span className="brand-symbol">S</span> SDR
          <span className="brand-accent">Flow</span>
        </div>
        <p>Carregando ambiente seguro...</p>
      </div>
    );
  if (!user)
    return (
      <div className="login-wrap">
        <div className="login-panel">
          <div className="brand-large">
            <span className="brand-symbol">S</span> SDR
            <span className="brand-accent">Flow</span>
          </div>
          <div className="eyebrow">PLATAFORMA INTELIGENTE DE PROSPECÇÃO</div>
          <h1>Uma operação comercial inteira, em um só lugar.</h1>
          <p>
            Organize nichos, qualifique contatos e orquestre e-mail, WhatsApp e
            chamadas com IA com segurança e rastreabilidade.
          </p>
          <button
            className="primary large"
            onClick={async () => {
              try {
                await auth.signInWithRedirect();
              } catch (e) {
                alert(getError(e));
              }
            }}
          >
            Entrar na plataforma <ArrowUpRight size={17} />
          </button>
          <div className="login-footer">
            <ShieldCheck size={16} /> Acesso protegido por autenticação
          </div>
          {toast && <p className="error-inline">{toast}</p>}
        </div>
        <div className="login-illustration">
          <div className="illustration-orb" />
          <div className="demo-stat">
            <Activity size={27} />
            <span>Inteligência comercial</span>
            <strong>
              Todos os canais.
              <br />
              Uma única visão.
            </strong>
          </div>
          <div className="float-note">
            <CheckCircle2 /> Fluxos organizados por nicho
          </div>
        </div>
      </div>
    );
  return (
    <div className="shell">
      <aside className={'sidebar ' + (mobileNav ? 'show' : '')}>
        <div className="sidebar-brand">
          <span className="brand-symbol">S</span>
          <span>
            SDR<span className="brand-accent">Flow</span>
            <small>INTELLIGENCE PLATFORM</small>
          </span>
        </div>
        <div className="nav-label">WORKSPACE</div>
        <nav>
          {nav.map(n => (
            <button
              key={n.key}
              className={'side-link ' + (page === n.key ? 'selected' : '')}
              onClick={() => {
                setPage(n.key);
                setMobileNav(false);
                setQuery('');
              }}
            >
              <n.icon size={17} />
              {n.title}
              {n.key === 'campaigns' && active.length > 0 && (
                <i>{active.length}</i>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="help-card">
            <Sparkles size={18} />
            <b>Operação inteligente</b>
            <span>Organize cada nicho de forma independente.</span>
          </div>
          <div className="identity">
            <div className="avatar">
              {(user.name || user.email || 'U')[0]?.toUpperCase()}
            </div>
            <div>
              <strong>{user.name || 'Administrador'}</strong>
              <small>{user.email || 'Conta conectada'}</small>
            </div>
            <button
              title="Sair"
              onClick={async () => {
                await auth.signOut();
                setUser(null);
              }}
            >
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </aside>
      <div className="workspace-body">
        <header className="topbar">
          <div className="top-left">
            <button
              className="icon-btn mobile-toggle"
              onClick={() => setMobileNav(!mobileNav)}
            >
              <Menu size={21} />
            </button>
            <span className="breadcrumb">Workspace</span>
            <ChevronRight size={14} color="#9aa8b6" />
            <strong>{name}</strong>
          </div>
          <div className="top-right">
            <div className="top-search">
              <Search size={17} />
              <input
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Buscar leads ou empresas..."
              />
            </div>
            <span className="top-date">{today()}</span>
            <button
              className="icon-btn"
              onClick={() =>
                load()
                  .then(() => alert('Dados atualizados.'))
                  .catch(e => alert(getError(e)))
              }
              title="Atualizar"
            >
              <RefreshCw size={17} />
            </button>
            <div className="avatar small">
              {(user.name || 'U')[0].toUpperCase()}
            </div>
          </div>
        </header>
        <div className="nav-tabs">
          <button
            className={page === 'dashboard' ? 'tab-active' : ''}
            onClick={() => setPage('dashboard')}
          >
            Meu painel
          </button>
          <button
            className={page === 'campaigns' ? 'tab-active' : ''}
            onClick={() => setPage('campaigns')}
          >
            Gestão comercial
          </button>
          <button
            className={page === 'reports' ? 'tab-active' : ''}
            onClick={() => setPage('reports')}
          >
            Analytics
          </button>
          <button
            className={page === 'automations' ? 'tab-active' : ''}
            onClick={() => setPage('automations')}
          >
            Automações
          </button>
          <div className="tab-spacer" />
          <div className="select-wrap">
            <Globe2 size={15} />
            <select
              aria-label="Filtrar nicho"
              value={workspaceId}
              onChange={e => setWorkspaceId(e.target.value)}
            >
              <option value="all">Todos os nichos</option>
              {data.workspaces.map(w => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
            <ChevronDown size={13} />
          </div>
        </div>
        <main className="main">
          <div className="page-heading">
            <div>
              <div className="eyebrow">
                CENTRAL DE OPERAÇÕES · SDR INTELLIGENCE
              </div>
              <h1>{name}</h1>
              <p>
                {page === 'dashboard'
                  ? 'Controle suas campanhas, identifique oportunidades e acompanhe cada contato em tempo real.'
                  : page === 'leads'
                    ? 'Gerencie sua base com origem, consentimento e histórico documentados.'
                    : page === 'campaigns'
                      ? 'Construa jornadas de prospecção específicas para cada operação.'
                      : page === 'workspaces'
                        ? 'Adapte a plataforma para diferentes nichos, negócios e ofertas.'
                        : page === 'templates'
                          ? 'Personalize a abordagem, tom de voz e conteúdo de cada canal.'
                          : page === 'automations'
                            ? 'Conecte o motor multicanal às automações existentes sem alterá-las.'
                            : page === 'reports'
                              ? 'Indicadores reais das atividades registradas na plataforma.'
                              : 'Gerencie conexões, limites e práticas de segurança.'}
              </p>
            </div>
            <div className="heading-actions">
              {page === 'leads' ? (
                <>
                  <button className="secondary" onClick={() => open('import')}>
                    <Upload size={16} /> Importar CSV
                  </button>
                  <button className="primary" onClick={() => open('lead')}>
                    <Plus size={17} /> Novo lead
                  </button>
                </>
              ) : page === 'campaigns' ? (
                <button className="primary" onClick={() => open('campaign')}>
                  <Plus size={17} /> Nova campanha
                </button>
              ) : page === 'workspaces' ? (
                <button className="primary" onClick={() => open('workspace')}>
                  <Plus size={17} /> Novo nicho
                </button>
              ) : page === 'templates' ? (
                <button className="primary" onClick={() => open('template')}>
                  <Plus size={17} /> Novo script
                </button>
              ) : page === 'dashboard' ? (
                <button
                  className="primary"
                  onClick={() =>
                    data.workspaces.length
                      ? open('campaign')
                      : open('workspace')
                  }
                >
                  <Plus size={17} /> Criar campanha
                </button>
              ) : null}
            </div>
          </div>
          {page === 'dashboard' && (
            <>
              <div className="intro-banner">
                <div>
                  <span className="banner-mini">
                    <Sparkles size={13} /> OPERAÇÃO MULTICANAL
                  </span>
                  <h2>Sua central comercial, mais inteligente.</h2>
                  <p>
                    Planeje abordagens personalizadas, preserve o histórico e
                    escale com governança.
                  </p>
                  <button onClick={() => setPage('automations')}>
                    Explorar integrações <ArrowUpRight size={15} />
                  </button>
                </div>
                <div className="banner-art">
                  <div className="network-circle one" />
                  <div className="network-circle two" />
                  <div className="network-circle three" />
                  <span>
                    <PhoneCall size={24} />
                  </span>
                  <i>
                    <Mail size={21} />
                  </i>
                  <b>
                    <MessageSquare size={23} />
                  </b>
                </div>
              </div>
              <div className="section-head">
                <h2>Indicadores de operação</h2>
                <span>Visão consolidada</span>
              </div>
              <div className="stats-grid">
                <Stat
                  icon={<Users size={19} />}
                  title="Total de leads"
                  value={String(leads.length)}
                  desc="Base cadastrada"
                  color="blue"
                />
                <Stat
                  icon={<ShieldCheck size={19} />}
                  title="Contatos elegíveis"
                  value={String(eligible.length)}
                  desc="Com origem e base legal"
                  color="teal"
                />
                <Stat
                  icon={<Megaphone size={19} />}
                  title="Campanhas ativas"
                  value={String(active.length)}
                  desc="Envios autorizados"
                  color="purple"
                />
                <Stat
                  icon={<Send size={19} />}
                  title="Envios aceitos"
                  value={String(contacted)}
                  desc="Aceites recebidos do n8n"
                  color="orange"
                />
              </div>
              <div className="dashboard-grid">
                <div className="panel">
                  <div className="panel-head">
                    <div>
                      <h3>Panorama das campanhas</h3>
                      <p>Status da sua operação</p>
                    </div>
                    <button className="bare" onClick={() => setPage('reports')}>
                      Ver relatório <ArrowUpRight size={14} />
                    </button>
                  </div>
                  <div className="bar-chart">
                    {['Em execução', 'Rascunhos', 'Pausadas', 'Com leads'].map(
                      (lbl, i) => {
                        const values = [
                          active.length,
                          campaigns.filter(c => c.status === 'draft').length,
                          campaigns.filter(c => c.status === 'paused').length,
                          eligible.length,
                        ];
                        const max = Math.max(...values, 1);
                        return (
                          <div className="bar-item" key={lbl}>
                            <div className="bar-track">
                              <div
                                className={'bar-fill bar-' + i}
                                style={{
                                  height:
                                    Math.max(4, (values[i] / max) * 100) + '%',
                                }}
                              />
                            </div>
                            <strong>{values[i]}</strong>
                            <span>{lbl}</span>
                          </div>
                        );
                      }
                    )}
                  </div>
                  <div className="chart-caption">
                    <CircleDot size={13} /> Indicadores de registros reais, não
                    métricas simuladas
                  </div>
                </div>
                <div className="panel">
                  <div className="panel-head">
                    <div>
                      <h3>Atividades recentes</h3>
                      <p>Últimos eventos registrados</p>
                    </div>
                    <Activity size={19} color="#6e8095" />
                  </div>
                  {activity.length ? (
                    <div className="activity-list">
                      {activity.slice(0, 5).map((a, i) => (
                        <div className="activity-line" key={a.id || i}>
                          <span className="activity-bullet">
                            <CheckCircle2 size={14} />
                          </span>
                          <div>
                            <strong>{a.title}</strong>
                            <small>
                              {new Date(a.at).toLocaleString('pt-BR')}
                            </small>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <Empty
                      title="Nenhuma atividade registrada"
                      desc="Crie seu primeiro nicho e comece a organizar a operação."
                      icon={<Activity />}
                    />
                  )}
                </div>
              </div>
              <div className="section-head">
                <h2>Aplicativos e atalhos</h2>
                <span>Acesso rápido</span>
              </div>
              <div className="shortcuts">
                {[
                  {
                    p: 'leads',
                    t: 'Gestão de leads',
                    d: 'Importar, filtrar e qualificar',
                    i: Users,
                    c: 'pink',
                  },
                  {
                    p: 'campaigns',
                    t: 'Campanhas',
                    d: 'Criar jornadas multicanal',
                    i: Megaphone,
                    c: 'teal',
                  },
                  {
                    p: 'templates',
                    t: 'Scripts com IA',
                    d: 'Mensagens por nicho',
                    i: MessageSquare,
                    c: 'purple',
                  },
                  {
                    p: 'automations',
                    t: 'Integrações n8n',
                    d: 'Orquestração segura',
                    i: Workflow,
                    c: 'blue',
                  },
                ].map(k => (
                  <button
                    className="shortcut"
                    key={k.p}
                    onClick={() => setPage(k.p)}
                  >
                    <span className={'app-icon ' + k.c}>
                      <k.i size={20} />
                    </span>
                    <span>
                      <b>{k.t}</b>
                      <small>{k.d}</small>
                    </span>
                    <ArrowUpRight size={15} />
                  </button>
                ))}
              </div>
            </>
          )}
          {page === 'leads' && (
            <div className="panel table-panel">
              <div className="panel-head">
                <div>
                  <h3>Base de contatos</h3>
                  <p>
                    {leads.length} registros neste filtro · CSV com origem e
                    base legal obrigatórias
                  </p>
                </div>
                <button
                  className="secondary smallbtn"
                  onClick={() => downloadCsv(leads)}
                >
                  <Download size={15} /> Exportar
                </button>
              </div>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Contato</th>
                      <th>Empresa</th>
                      <th>Telefone / e-mail</th>
                      <th>Base legal</th>
                      <th>Status</th>
                      <th>Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {leads.length ? (
                      leads.map(l => (
                        <tr key={l.id}>
                          <td>
                            <div className="name-cell">
                              <span className="mini-avatar">
                                {l.name?.[0]?.toUpperCase()}
                              </span>
                              <strong>{l.name}</strong>
                            </div>
                          </td>
                          <td>{l.company || '—'}</td>
                          <td>
                            <div className="two-lines">
                              {l.phone || '—'}
                              <small>{l.email || '—'}</small>
                            </div>
                          </td>
                          <td>
                            <span className="muted-small">
                              {l.legalBasis === 'consent'
                                ? 'Consentimento'
                                : l.legalBasis ===
                                    'legitimate_interest_assessed'
                                  ? 'Legítimo interesse avaliado'
                                  : 'Contratual'}
                            </span>
                          </td>
                          <td>
                            <span className={'badge ' + pill(l.status)}>
                              {l.optOut ? 'Bloqueado' : l.status}
                            </span>
                          </td>
                          <td>
                            <div className="row-actions">
                              <button
                                onClick={() => open('leadEdit', l)}
                                title="Editar"
                              >
                                Editar
                              </button>
                              {!l.optOut && (
                                <button
                                  className="danger-text"
                                  onClick={() => {
                                    if (
                                      confirm(
                                        'Bloquear contato permanentemente para novas campanhas?'
                                      )
                                    )
                                      mutate('/api/leads/' + l.id, 'put', {
                                        optOut: true,
                                      });
                                  }}
                                >
                                  Bloquear
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={6}>
                          <Empty
                            title="Ainda não há leads"
                            desc="Cadastre manualmente ou importe um CSV com origem e base legal."
                            icon={<Users />}
                          />
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          {page === 'campaigns' && (
            <div className="campaign-grid">
              {campaigns.length ? (
                campaigns.map(c => (
                  <div className="campaign-card" key={c.id}>
                    <div className="campaign-top">
                      <span className="campaign-icon">
                        <Megaphone size={20} />
                      </span>
                      <span className={'badge ' + pill(c.status)}>
                        {c.status === 'active'
                          ? 'Em execução'
                          : c.status === 'paused'
                            ? 'Pausada'
                            : 'Rascunho'}
                      </span>
                    </div>
                    <h3>{c.name}</h3>
                    <p>{c.objective || 'Sem descrição definida'}</p>
                    <div className="campaign-channels">
                      {c.channels.map((ch: string) => (
                        <span key={ch}>
                          {ch === 'email' ? (
                            <Mail size={13} />
                          ) : ch === 'whatsapp' ? (
                            <MessageSquare size={13} />
                          ) : (
                            <PhoneCall size={13} />
                          )}{' '}
                          {channelLabel[ch]}
                        </span>
                      ))}
                    </div>
                    <div className="campaign-bottom">
                      <span>
                        <CalendarClock size={15} /> Até {c.dailyLimit} por dia
                      </span>
                      {c.status === 'active' ? (
                        <button
                          className="outline-danger"
                          disabled={busy}
                          onClick={() =>
                            mutate('/api/campaigns/' + c.id, 'put', {
                              action: 'pause',
                            })
                          }
                        >
                          <PauseCircle size={16} /> Pausar
                        </button>
                      ) : (
                        <button
                          className="primary smallbtn"
                          disabled={busy}
                          onClick={() => {
                            if (
                              confirm(
                                'Ativar campanha? Isso autoriza o envio apenas para contatos elegíveis pela integração n8n configurada.'
                              )
                            )
                              mutate('/api/campaigns/' + c.id, 'put', {
                                action: 'activate',
                                confirmed: true,
                              });
                          }}
                        >
                          <PlayCircle size={15} /> Ativar
                        </button>
                      )}
                    </div>
                  </div>
                ))
              ) : (
                <Empty
                  title="Nenhuma campanha"
                  desc="Crie uma campanha vinculada a um nicho para configurar seus três canais."
                  icon={<Megaphone />}
                />
              )}
            </div>
          )}
          {page === 'workspaces' && (
            <div className="campaign-grid">
              {data.workspaces.length ? (
                data.workspaces.map(w => (
                  <div className="campaign-card" key={w.id}>
                    <div className="campaign-top">
                      <span className="campaign-icon">
                        <Building2 size={20} />
                      </span>
                      <span className="badge neutral">{w.niche}</span>
                    </div>
                    <h3>{w.name}</h3>
                    <p>
                      {w.description ||
                        'Espaço independente para campanhas, leads e conteúdo.'}
                    </p>
                    <div className="workspace-metrics">
                      <span>
                        <Users size={15} />{' '}
                        {data.leads.filter(l => l.workspaceId === w.id).length}{' '}
                        leads
                      </span>
                      <span>
                        <Megaphone size={15} />{' '}
                        {
                          data.campaigns.filter(c => c.workspaceId === w.id)
                            .length
                        }{' '}
                        campanhas
                      </span>
                    </div>
                    <button
                      className="text-link"
                      onClick={() => {
                        setWorkspaceId(w.id);
                        setPage('dashboard');
                      }}
                    >
                      Abrir operação <ChevronRight size={16} />
                    </button>
                  </div>
                ))
              ) : (
                <Empty
                  title="Crie seu primeiro nicho"
                  desc="Ex.: Imobiliário, marketing, indústria, saúde ou consultoria."
                  icon={<Layers3 />}
                />
              )}
            </div>
          )}
          {page === 'templates' && (
            <div className="templates-grid">
              {scoped(data.templates).length ? (
                scoped(data.templates).map(t => (
                  <div className="panel template-card" key={t.id}>
                    <div className="template-head">
                      <span className="badge neutral">
                        {channelLabel[t.channel]}
                      </span>
                      <button
                        className="icon-btn"
                        title="Excluir"
                        onClick={() => {
                          if (confirm('Excluir este modelo?'))
                            mutate('/api/templates/' + t.id, 'delete');
                        }}
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                    <h3>{t.title}</h3>
                    <p>{t.content}</p>
                    <button
                      className="text-link"
                      onClick={() => {
                        navigator.clipboard
                          .writeText(t.content)
                          .then(() => alert('Modelo copiado.'));
                      }}
                    >
                      <Copy size={15} /> Copiar conteúdo
                    </button>
                  </div>
                ))
              ) : (
                <Empty
                  title="Biblioteca de scripts vazia"
                  desc="Adicione abordagens específicas para seus nichos e canais."
                  icon={<FileText />}
                />
              )}
            </div>
          )}
          {page === 'automations' && (
            <>
              <div className="section-head">
                <h2>Conexões e integrações</h2>
                <span>Visibilidade real de configuração</span>
              </div>
              <div className="integrations-grid">
                {[
                  {
                    key: 'n8n',
                    title: 'n8n Webhook',
                    detail: 'Orquestração de entregas e respostas',
                    icon: Workflow,
                  },
                  {
                    key: 'email',
                    title: 'Provedor de E-mail',
                    detail: 'Chave opcional do provedor de envio',
                    icon: Mail,
                  },
                  {
                    key: 'whatsapp',
                    title: 'Meta WhatsApp API',
                    detail: 'API oficial e modelos aprovados',
                    icon: MessageSquare,
                  },
                  {
                    key: 'voice',
                    title: 'Retell AI',
                    detail: 'Agentes telefônicos com IA',
                    icon: PhoneCall,
                  },
                ].map(x => (
                  <div className="panel integration" key={x.key}>
                    <span className="integration-icon">
                      <x.icon size={21} />
                    </span>
                    <h3>{x.title}</h3>
                    <p>{x.detail}</p>
                    <span
                      className={
                        'badge ' +
                        (data.connected[x.key] ? 'success' : 'warning')
                      }
                    >
                      {data.connected[x.key]
                        ? 'Credencial disponível'
                        : 'Não configurado'}
                    </span>
                  </div>
                ))}
              </div>
              <div className="panel documentation">
                <div className="panel-head">
                  <div>
                    <h3>Contrato de integração n8n</h3>
                    <p>
                      O painel envia solicitações para um endpoint seguro
                      configurado nos segredos do servidor.
                    </p>
                  </div>
                  <span className="badge neutral">HTTP POST</span>
                </div>
                <div className="doc-grid">
                  <div>
                    <b>1. Webhook de entrada</b>
                    <p>
                      Crie um novo workflow no n8n com Webhook POST, sem alterar
                      os existentes. Configure HTTPS e valide o cabeçalho
                      X-SDR-Token.
                    </p>
                  </div>
                  <div>
                    <b>2. Roteamento por canal</b>
                    <p>
                      Utilize o campo channel para direcionar a ação aos
                      provedores de e-mail, Meta WhatsApp ou Retell AI.
                    </p>
                  </div>
                  <div>
                    <b>3. Segurança e entrega</b>
                    <p>
                      Confirme opt-in, bloqueios, templates aprovados e
                      idempotência. O HTTP 2xx confirma apenas o aceite no n8n.
                    </p>
                  </div>
                </div>
                <pre className="code-snippet">
                  {
                    '{\n  "event": "sdr.outreach.requested",\n  "idempotency_key": "identificador-unico",\n  "channel": "email | whatsapp | voice",\n  "lead": { "name": "...", "email": "...", "phone": "..." },\n  "message": "script configurado"\n}'
                  }
                </pre>
              </div>
            </>
          )}
          {page === 'reports' && (
            <>
              <div className="stats-grid">
                <Stat
                  icon={<Users size={19} />}
                  title="Contatos cadastrados"
                  value={String(leads.length)}
                  desc="Total na base filtrada"
                  color="blue"
                />
                <Stat
                  icon={<ShieldCheck size={19} />}
                  title="Elegíveis"
                  value={String(eligible.length)}
                  desc="Validação documental"
                  color="teal"
                />
                <Stat
                  icon={<CircleAlert size={19} />}
                  title="Bloqueados"
                  value={String(leads.filter(l => l.optOut).length)}
                  desc="Não contatar"
                  color="orange"
                />
                <Stat
                  icon={<Send size={19} />}
                  title="Requisições aceitas"
                  value={String(contacted)}
                  desc="Retorno síncrono do n8n"
                  color="purple"
                />
              </div>
              <div className="panel">
                <div className="panel-head">
                  <div>
                    <h3>Auditoria de atividades</h3>
                    <p>Histórico recente e rastreável</p>
                  </div>
                  <button
                    className="secondary smallbtn"
                    onClick={() => downloadCsv(leads)}
                  >
                    <Download size={15} /> Base CSV
                  </button>
                </div>
                {activity.length ? (
                  <div className="audit-list">
                    {activity.map((a, i) => (
                      <div key={a.id || i} className="audit-row">
                        <span className="activity-bullet">
                          <Activity size={15} />
                        </span>
                        <div>
                          <b>{a.title}</b>
                          <small>
                            {new Date(a.at).toLocaleString('pt-BR')} · {a.kind}
                          </small>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <Empty
                    title="Sem atividades registradas"
                    desc="O histórico é preenchido conforme as operações são executadas."
                    icon={<BarChart3 />}
                  />
                )}
              </div>
            </>
          )}
          {page === 'settings' && (
            <div className="settings-grid">
              <div className="panel">
                <div className="panel-head">
                  <div>
                    <h3>Proteção e governança</h3>
                    <p>Políticas aplicadas pelo backend</p>
                  </div>
                  <ShieldCheck color="#16a286" size={22} />
                </div>
                {[
                  'Autenticação obrigatória para dados e campanhas',
                  'Dados isolados por usuário e nicho',
                  'Obrigatório informar origem e base legal dos contatos',
                  'Opt-out bloqueia novas solicitações',
                  'WhatsApp exige opt-in específico',
                  'Ligação exige autorização de voz documentada',
                  'Somente dias úteis, 9h às 18h (São Paulo)',
                  'Máximo de 500 tentativas/dia por campanha',
                  'Campanhas criadas pausadas por padrão',
                  'Sem repetição automática após envio incerto',
                ].map(t => (
                  <div className="setting-row" key={t}>
                    <CheckCircle2 size={17} />
                    {t}
                  </div>
                ))}
              </div>
              <div className="panel">
                <div className="panel-head">
                  <div>
                    <h3>Configuração de ambiente</h3>
                    <p>Status das dependências</p>
                  </div>
                  <Settings size={20} />
                </div>
                <div className="settings-note">
                  <b>Importante</b>
                  <p>
                    As credenciais são armazenadas como segredos no backend, não
                    no navegador. O disparador multicanal usa um webhook HTTPS
                    do n8n. Não são enviados e-mails, WhatsApps ou ligações até
                    que o endpoint esteja configurado e a campanha seja ativada.
                  </p>
                </div>
                <div className="setting-row">
                  <Link2 size={17} /> Webhook n8n{' '}
                  <span
                    className={
                      'badge ' + (data.connected.n8n ? 'success' : 'warning')
                    }
                  >
                    {data.connected.n8n ? 'Configurado' : 'Pendente'}
                  </span>
                </div>
                <div className="setting-row">
                  <Clock size={17} /> Última atualização{' '}
                  <span>{lastUpdated || '—'}</span>
                </div>
                <button
                  className="secondary"
                  onClick={() =>
                    load().then(() => alert('Integrações atualizadas.'))
                  }
                >
                  <RefreshCw size={16} /> Verificar conexões
                </button>
              </div>
            </div>
          )}
          {data.workspaces.length === 0 && page === 'dashboard' && (
            <div className="onboarding">
              <div className="onboarding-icon">
                <Building2 />
              </div>
              <div>
                <b>Comece criando um nicho de atuação</b>
                <p>
                  Separe marketing, imobiliário, indústria ou qualquer outro
                  segmento.
                </p>
              </div>
              <button className="primary" onClick={() => open('workspace')}>
                Criar nicho <ChevronRight size={15} />
              </button>
            </div>
          )}
          <footer className="app-footer">
            <span>© 2026 SDRFlow · Plataforma de operações comerciais</span>
            <span>
              <ShieldCheck size={13} /> Seus dados protegidos · Sem envios de
              teste automáticos
            </span>
          </footer>
        </main>
      </div>
      {toast && (
        <div className="toast">
          <CircleAlert size={16} />
          <span>{toast}</span>
          <button onClick={() => setToast('')}>
            <X size={15} />
          </button>
        </div>
      )}
      {modal && (
        <div
          className="modal-backdrop"
          onMouseDown={e => {
            if (e.target === e.currentTarget) setModal('');
          }}
        >
          <div className="modal">
            <div className="modal-header">
              <div>
                <div className="eyebrow">SDRFLOW · CADASTRO</div>
                <h2>
                  {modal === 'workspace'
                    ? 'Novo nicho / operação'
                    : modal === 'lead'
                      ? 'Cadastrar contato'
                      : modal === 'import'
                        ? 'Importar leads por CSV'
                        : modal === 'leadEdit'
                          ? 'Editar lead'
                          : modal === 'campaign'
                            ? 'Nova campanha multicanal'
                            : 'Novo script de abordagem'}
                </h2>
              </div>
              <button className="icon-btn" onClick={() => setModal('')}>
                <X size={21} />
              </button>
            </div>
            <form
              onSubmit={async e => {
                e.preventDefault();
                if (modal === 'workspace')
                  await mutate('/api/workspaces', 'post', form);
                if (modal === 'lead') await mutate('/api/leads', 'post', form);
                if (modal === 'leadEdit')
                  await mutate('/api/leads/' + form.id, 'put', form);
                if (modal === 'campaign')
                  await mutate('/api/campaigns', 'post', form);
                if (modal === 'template')
                  await mutate('/api/templates', 'post', form);
                if (modal === 'import') {
                  if (!importRows.length) {
                    alert('Selecione um arquivo CSV válido.');
                    return;
                  }
                  const all = importRows.map(r => ({
                    ...r,
                    workspaceId: form.workspaceId,
                    source: r.source || form.source,
                    legalBasis: r.legalBasis || form.legalBasis,
                  }));
                  let created = 0,
                    dup = 0,
                    invalid = 0;
                  setBusy(true);
                  try {
                    for (let i = 0; i < all.length; i += 100) {
                      const r = await api.post('/api/leads', {
                        workspaceId: form.workspaceId,
                        items: all.slice(i, i + 100),
                      });
                      created += r.data.created;
                      dup += r.data.duplicate;
                      invalid += r.data.invalid;
                    }
                    await load();
                    setModal('');
                    alert(
                      'Importação: ' +
                        created +
                        ' criados, ' +
                        dup +
                        ' duplicados, ' +
                        invalid +
                        ' inválidos.'
                    );
                  } catch (e) {
                    alert(getError(e));
                  } finally {
                    setBusy(false);
                  }
                }
              }}
            >
              <div className="modal-content">
                {['lead', 'import', 'campaign', 'template'].includes(modal) && (
                  <Field label="Nicho / operação">
                    <select
                      required
                      value={form.workspaceId || ''}
                      onChange={e => set('workspaceId', e.target.value)}
                    >
                      <option value="">Selecione um nicho</option>
                      {data.workspaces.map(w => (
                        <option key={w.id} value={w.id}>
                          {w.name}
                        </option>
                      ))}
                    </select>
                    {!data.workspaces.length && (
                      <small>
                        Crie primeiro um nicho na área “Nichos e operações”.
                      </small>
                    )}
                  </Field>
                )}
                {modal === 'workspace' && (
                  <>
                    <Field label="Nome da operação">
                      <input
                        required
                        maxLength={80}
                        value={form.name || ''}
                        onChange={e => set('name', e.target.value)}
                        placeholder="Ex.: Imobiliário Joinville"
                      />
                    </Field>
                    <Field label="Segmento / nicho">
                      <input
                        required
                        value={form.niche || ''}
                        onChange={e => set('niche', e.target.value)}
                        placeholder="Ex.: Mercado imobiliário"
                      />
                    </Field>
                    <Field label="Descrição">
                      <textarea
                        rows={3}
                        value={form.description || ''}
                        onChange={e => set('description', e.target.value)}
                        placeholder="Oferta, perfil de clientes e objetivos"
                      />
                    </Field>
                  </>
                )}
                {modal === 'lead' && (
                  <>
                    <div className="fields-two">
                      <Field label="Nome completo">
                        <input
                          required
                          value={form.name || ''}
                          onChange={e => set('name', e.target.value)}
                        />
                      </Field>
                      <Field label="Empresa">
                        <input
                          value={form.company || ''}
                          onChange={e => set('company', e.target.value)}
                        />
                      </Field>
                    </div>
                    <div className="fields-two">
                      <Field label="E-mail">
                        <input
                          type="email"
                          value={form.email || ''}
                          onChange={e => set('email', e.target.value)}
                        />
                      </Field>
                      <Field label="Telefone com DDD">
                        <input
                          value={form.phone || ''}
                          onChange={e => set('phone', e.target.value)}
                          placeholder="5547999999999"
                        />
                      </Field>
                    </div>
                    <ComplianceFields form={form} set={set} />
                    <Field label="Observações">
                      <textarea
                        rows={2}
                        value={form.notes || ''}
                        onChange={e => set('notes', e.target.value)}
                      />
                    </Field>
                  </>
                )}
                {modal === 'leadEdit' && (
                  <>
                    <div className="hint">
                      {form.name} · {form.email || form.phone}
                    </div>
                    <Field label="Status comercial">
                      <select
                        value={form.status || 'Novo'}
                        onChange={e => set('status', e.target.value)}
                      >
                        {[
                          'Novo',
                          'Contato iniciado',
                          'Em negociação',
                          'Qualificado',
                          'Concluído',
                          'bloqueado',
                        ].map(s => (
                          <option key={s}>{s}</option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Notas">
                      <textarea
                        rows={4}
                        value={form.notes || ''}
                        onChange={e => set('notes', e.target.value)}
                      />
                    </Field>
                  </>
                )}
                {modal === 'campaign' && (
                  <>
                    <Field label="Nome da campanha">
                      <input
                        required
                        value={form.name || ''}
                        onChange={e => set('name', e.target.value)}
                        placeholder="Ex.: Captação B2B · Novembro"
                      />
                    </Field>
                    <Field label="Objetivo e proposta comercial">
                      <textarea
                        rows={2}
                        value={form.objective || ''}
                        onChange={e => set('objective', e.target.value)}
                        placeholder="Quem é o público e qual é a proposta?"
                      />
                    </Field>
                    <Field label="Canais da campanha">
                      <div className="checkgrid">
                        {['email', 'whatsapp', 'voice'].map(c => (
                          <label key={c} className="check-row">
                            <input
                              type="checkbox"
                              checked={(form.channels || []).includes(c)}
                              onChange={e =>
                                set(
                                  'channels',
                                  e.target.checked
                                    ? [...(form.channels || []), c]
                                    : (form.channels || []).filter(
                                        (x: string) => x !== c
                                      )
                                )
                              }
                            />
                            {channelLabel[c]}
                          </label>
                        ))}
                      </div>
                    </Field>
                    <Field label="Máximo de tentativas por dia (até 500)">
                      <input
                        type="number"
                        min="1"
                        max="500"
                        value={form.dailyLimit || 50}
                        onChange={e =>
                          set('dailyLimit', Number(e.target.value))
                        }
                      />
                    </Field>
                    <Field label="Texto de e-mail">
                      <textarea
                        rows={3}
                        value={form.emailText || ''}
                        onChange={e => set('emailText', e.target.value)}
                        placeholder="Assunto e corpo; personalize por nicho."
                      />
                    </Field>
                    <Field label="Nome exato do template WhatsApp aprovado">
                      <input value={form.whatsappTemplateName || ''} onChange={e => set('whatsappTemplateName', e.target.value)} placeholder="Ex.: apresentacao_empresa" />
                    </Field>
                    <Field label="Mensagem WhatsApp (template aprovado)">
                      <textarea
                        rows={3}
                        value={form.whatsappText || ''}
                        onChange={e => set('whatsappText', e.target.value)}
                      />
                    </Field>
                    <Field label="Roteiro do agente de voz IA">
                      <textarea
                        rows={3}
                        value={form.voiceScript || ''}
                        onChange={e => set('voiceScript', e.target.value)}
                        placeholder="Apresente-se como IA, pergunte se é um bom momento e respeite recusas."
                      />
                    </Field>
                    <div className="hint">
                      <ShieldCheck size={16} /> Campanhas começam como rascunho.
                      Apenas leads legalmente elegíveis poderão ser encaminhados
                      para o n8n.
                    </div>
                  </>
                )}
                {modal === 'template' && (
                  <>
                    <Field label="Título do script">
                      <input
                        required
                        value={form.title || ''}
                        onChange={e => set('title', e.target.value)}
                        placeholder="Ex.: Primeiro contato imobiliário"
                      />
                    </Field>
                    <Field label="Canal">
                      <select
                        required
                        value={form.channel || ''}
                        onChange={e => set('channel', e.target.value)}
                      >
                        <option value="">Selecione</option>
                        {Object.keys(channelLabel).map(c => (
                          <option key={c} value={c}>
                            {channelLabel[c]}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Conteúdo personalizado">
                      <textarea
                        required
                        rows={7}
                        value={form.content || ''}
                        onChange={e => set('content', e.target.value)}
                        placeholder="Olá, [nome]..."
                      />
                    </Field>
                  </>
                )}
                {modal === 'import' && (
                  <>
                    <div className="upload-zone">
                      <Upload size={27} />
                      <strong>Escolha uma planilha .CSV</strong>
                      <p>
                        Colunas: name, company, email, phone, source,
                        legalBasis, whatsappOptIn, voiceAllowed
                      </p>
                      <input
                        type="file"
                        accept=".csv,text/csv"
                        onChange={async e => {
                          const file = e.target.files?.[0];
                          if (file) {
                            if (file.size > 1024 * 1024) {
                              alert('Arquivo acima de 1 MB. Divida em partes.');
                              return;
                            }
                            const rows = parseCsv(await file.text());
                            setImportRows(rows);
                          }
                        }}
                      />
                    </div>
                    <div className="hint">
                      {importRows.length} linhas reconhecidas. Duplicidades são
                      bloqueadas por identificador do contato e nicho.
                    </div>
                    <ComplianceFields form={form} set={set} compact />
                  </>
                )}
              </div>
              <div className="modal-footer">
                <button
                  type="button"
                  className="secondary"
                  onClick={() => setModal('')}
                >
                  Cancelar
                </button>
                <button
                  className="primary"
                  type="submit"
                  disabled={
                    busy ||
                    (['lead', 'import', 'campaign', 'template'].includes(
                      modal
                    ) &&
                      !data.workspaces.length)
                  }
                >
                  {busy
                    ? 'Salvando...'
                    : modal === 'import'
                      ? 'Importar contatos'
                      : 'Salvar alterações'}{' '}
                  <ArrowUpRight size={16} />
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
function Stat({
  title,
  value,
  desc,
  icon,
  color,
}: {
  title: string;
  value: string;
  desc: string;
  icon: React.ReactNode;
  color: string;
}) {
  return (
    <div className="stat-card">
      <div className={'stat-icon ' + color}>{icon}</div>
      <div className="stat-title">{title}</div>
      <div className="stat-value">{value}</div>
      <div className="stat-desc">{desc}</div>
      <div className="stat-decor">
        <TrendingUp size={16} />
      </div>
    </div>
  );
}
function Empty({
  title,
  desc,
  icon,
}: {
  title: string;
  desc: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-icon">{icon}</div>
      <strong>{title}</strong>
      <p>{desc}</p>
    </div>
  );
}
function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}
function ComplianceFields({
  form,
  set,
  compact = false,
}: {
  form: Row;
  set: (s: string, v: any) => void;
  compact?: boolean;
}) {
  return (
    <>
      <Field
        label={
          compact ? 'Origem padrão do arquivo' : 'Origem documentada do contato'
        }
      >
        <input
          required
          value={form.source || ''}
          onChange={e => set('source', e.target.value)}
          placeholder="Ex.: Formulário com consentimento; relacionamento preexistente"
        />
      </Field>
      <Field label="Base legal documentada">
        <select
          required
          value={form.legalBasis || ''}
          onChange={e => set('legalBasis', e.target.value)}
        >
          <option value="">Selecione e documente</option>
          <option value="consent">Consentimento</option>
          <option value="legitimate_interest_assessed">
            Legítimo interesse avaliado
          </option>
          <option value="contractual">Execução contratual aplicável</option>
        </select>
      </Field>
      {!compact && (
        <div className="checkgrid">
          <label className="check-row">
            <input
              type="checkbox"
              checked={form.whatsappOptIn === true}
              onChange={e => set('whatsappOptIn', e.target.checked)}
            />{' '}
            Autorização WhatsApp documentada
          </label>
          <label className="check-row">
            <input
              type="checkbox"
              checked={form.voiceAllowed === true}
              onChange={e => set('voiceAllowed', e.target.checked)}
            />{' '}
            Chamada comercial permitida
          </label>
        </div>
      )}
      <div className="privacy-hint">
        <ShieldCheck size={15} /> A base legal e permissões devem refletir
        documentação real. Esta seleção não cria consentimento.
      </div>
    </>
  );
}
export { App as LegacySDRFlow };
export default function SalesOSRoot() {
  const [currentHash, setCurrentHash] = useState(window.location.hash);
  useEffect(() => {
    const onHashChange = () => setCurrentHash(window.location.hash);
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);
  return currentHash === '#legacy' ? <App /> : <SalesOSApp />;
}
