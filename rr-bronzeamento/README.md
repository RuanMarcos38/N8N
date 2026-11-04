# R&R Bronzeamento — automação de Instagram, 30 dias

## Status
**Preparo entregue; não publicado.** Acesso direto ao servidor n8n e token/ID de conta Meta R&R não estavam disponíveis nesta conversa. A integração Metricool identificou apenas a conta R2R, que NÃO deve ser reutilizada para publicar no Instagram R&R.

## Artefato importável
O pacote completo **RR_Bronzeamento_Skill_30_Dias_n8n.zip** foi entregue na conversa e contém:
- 30 PNG 1080×1350
- 30 JPEG para Meta
- 30 SVG com textos editáveis
- 30 legendas completas em CSV/JSON
- Skill SKILL.md
- workflow n8n JSON (inativo)
- instruções de importação

## Importação segura
1. Baixar o ZIP na conversa e importar o JSON em **workflow novo** no n8n.
2. Confirmar conta profissional exclusiva **R&R Bronzeamento** no Meta for Developers.
3. Validar Instagram Login e permissões `instagram_business_basic`, `instagram_business_content_publish`, ou a modalidade Facebook Login com permissões correspondentes.
4. Criar credencial n8n HTTP Header Auth **exclusiva** para a R&R; nunca inserir token no repositório.
5. Definir `RR_BRONZE_PUBLISH_ENABLED=false` até homologação; informar `RR_BRONZE_IG_ID` e versão compatível da API.
6. Hospedar JPEGs em URLs HTTPS públicas e mapear por ID no workflow.
7. Aprovar individualmente as 30 peças. Testar primeiro em modo sem publicação e validar um único post autorizado.
8. Monitorar resultado e tratar erros ambíguos antes de permitir qualquer retry.

## Atenção aos agendamentos
Datas previstas no plano original: 05/11/2026 a 04/12/2026; reagendar todas as datas se a homologação ocorrer depois.

## Segurança
Workflow **inativo** por padrão. O mecanismo local de estado no n8n não equivale a um ledger transacional; em ambiente de múltiplos workers, configurar deduplicação em banco isolado com UNIQUE(brand_id,post_id).

Nenhum workflow existente foi alterado por este pull request. Não realizar merge/deploy sem revisão.
