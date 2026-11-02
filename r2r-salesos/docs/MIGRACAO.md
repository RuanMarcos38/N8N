# Preservação e migração

- Importação **aditiva** sob `r2r-salesos/`, sem sobrescrever `README.md`, `database/`, `docs/`, `env/`, `templates/` ou `workflows/` existentes na raiz.
- Captura: os 15 arquivos textuais do snapshot AppDeploy `1793623299507`.
- Não foram exportados dados reais de usuários, tabelas gerenciadas, gravações, contas, documentos internos ou segredos.
- O app no GitHub **não está automaticamente implantado**, nem é homologado para Docker/EasyPanel sem portar o SDK e serviços gerenciados da origem.
- Migração de banco exige backup, autorização, revisão de esquema, integridade, testes em staging e plano de rollback.
- Implantação comercial depende de integração dos provedores, idempotência robusta, isolamento de tokens por empresa, política LGPD, validação de tarifa Anatel, conciliação, observabilidade e teste de carga.
