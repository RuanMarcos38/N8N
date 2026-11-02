# Integrações — guia de configuração sem substituir fluxos existentes

1. Faça backup do n8n e importe os JSONs de `integrations/n8n/` como **workflows novos e desativados**.
2. Configure Header Auth no webhook de despacho: `X-SDR-Token`. Salve URL HTTPS de produção e token nos segredos AppDeploy `N8N_WEBHOOK_URL` e `N8N_WEBHOOK_TOKEN`.
3. E-mail: forneça SMTP autorizado e substitua o remetente `contato@SEU-DOMINIO.com.br`. Implemente processamento de opt-out, bounces e verifique SPF/DKIM/DMARC.
4. WhatsApp: use Meta Cloud API oficial, token em cofre, `SEU_PHONE_NUMBER_ID` real, template aprovado e opt-in comprovado. Atualize a versão da Graph API conforme suporte do provedor.
5. Vapi: configure Header Auth `Authorization: Bearer <VAPI_API_KEY>`, `PREENCHA_ASSISTANT_ID_VAPI` e `PREENCHA_PHONE_NUMBER_ID_VAPI`. Validar suporte à telefonia brasileira.
6. Retell: escolha **Retell ou Vapi**, não os dois na mesma campanha. Configure número e credenciais exclusivos do provedor escolhido.
7. Eventos: workflow `callback-eventos.json` requer validação de assinatura dos webhooks brutos de cada provedor antes de enviar eventos normalizados ao SalesOS. No nó final configure `X-SalesOS-Token` como Header Auth, igual ao segredo `SALESOS_EVENT_TOKEN` no AppDeploy.
8. Teste com seus contatos autorizados; valide entrega, recebimento, oposição, custos, status e limites de horário por fuso.
9. Mantenha `SALESOS_LIVE_DISPATCH_APPROVED` **ausente** até a homologação; configurá-lo como `approved` poderá permitir ativação de envios.

A chamada inicial 200 do webhook significa **aceite pelo n8n**, nunca entrega confirmada. Workflows são modelos, não conexões homologadas. Os tokens não devem ser salvos no GitHub. Contatos públicos por si só não implicam permissão de abordagem automatizada.
