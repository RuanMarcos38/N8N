---
name: rr-bronzeamento-social-media
description: Produz e revisa 30 dias de conteúdo para a R&R Bronzeamento e prepara publicação oficial por n8n, com aprovação humana e isolamento de conta.
version: 1.0.0
---

# Skill — Social Media R&R Bronzeamento

## Escopo
Marca exclusiva: **R&R Bronzeamento**, atendimento de bronzeamento a jato a domicílio em Joinville/SC.
Não confundir com R2R Marketing Digital, R&R Estratégia e Performance ou outra empresa.

## Identidade
Usar apenas a identidade aprovada: fundo bege ou champagne, bronze #B8875B, espresso #30231E, marfim #F7F2EA, terracota #A56E58. Preservar a logo original; tipografia editorial legível, composição com respiro, sem recortes artificiais.

## Operação mensal
1. Criar 30 posts com títulos, subtítulos, legendas úteis, hashtags locais e CTA para contato no link da bio.
2. Priorizar pilares: marca, educação, segurança, preparo, cuidados pós-procedimento, atendimento domiciliar, perguntas frequentes e agendamento.
3. Revisar cada publicação: clareza, factualidade, legibilidade e coerência do conteúdo.
4. Salvar JPEG 1080×1350 em URL HTTPS pública, acessível pela Meta, antes de aprovar.
5. Publicar **somente** via Meta Instagram Content Publishing API, usando workflow exclusivo e conta oficial da R&R confirmada.
6. Registrar horários, IDs de post, ID de mídia, falhas e pendências.

## Regras obrigatórias
- Nenhuma publicação sem aprovação individual do post.
- Nunca publicar em conta de outra marca, mesmo que esteja conectada.
- Não criar ou reutilizar credenciais de outras empresas; usar credencial Meta exclusiva R&R em n8n.
- Não salvar tokens no GitHub, em imagens, em CSV ou no workflow.
- Não inventar depoimentos, descontos, resultados 'antes/depois' ou garantias de duração.
- Bronzeamento a jato **não** oferece proteção UV; não declarar que substitui protetor solar.
- Imagens de clientes requerem autorização prévia; seguir LGPD.
- Evitar afirmações clínicas não comprovadas.
- Deduplicar por ID e exigir reconciliação manual se a resposta da API for ambígua.
- Impedir publicação se conta, permissão, imagem pública ou aprovação não estiverem confirmadas.
- **Não alterar workflows, tenants, schemas ou serviços existentes.**

## Critério de homologação
Conta profissional Meta autorizada + permissões confirmadas + 1 teste de publicação acompanhado + retorno media_id confirmado + reconciliação de erros verificada. Antes disso, estado **PREPARADO, NÃO ATIVO**.
