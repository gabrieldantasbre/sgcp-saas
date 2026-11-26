# SGCP — Sistema de Gestão para Clínica Podológica

Aplicação web para o site público, o portal do paciente e a operação da clínica. O servidor Express entrega as páginas e a API; os dados ficam no PostgreSQL.

## O que está incluído

- Site público com serviços e valores de referência.
- Acesso seguro para pacientes, podóloga e recepcionista, com permissões verificadas no servidor.
- Portal do paciente para cadastro, perfil, agendamento, consulta de horários, cancelamento e remarcação.
- Portal com resumo do agendamento, navegação semanal e horários separados por período, adaptado para celular.
- Sino com solicitações pendentes e acesso aos detalhes da consulta pelo calendário ou pela lista da agenda.
- Página 404 personalizada para endereços inexistentes; rotas desconhecidas da API continuam retornando JSON.
- Área interna com agenda, cadastro e busca de pacientes, anamnese, atendimento, receitas e despesas, estoque, relatórios e usuários.
- Registro de pagamentos, despesas recorrentes e auditagem das movimentações de estoque.
- Migração aditiva para preservar os cadastros que já existiam no banco.

## Identidade neutra e preparação para SaaS

As 11 páginas do site, portal, painel, ajuda, configuração e documentos usam uma identidade neutra. As fotos, os ícones e os links pessoais anteriores foram removidos da pasta pública; as ilustrações atuais são SVG locais, sem dependências externas. Nome, contato, localização e profissional não ficam mais fixos no código das páginas.

Configure estes campos no `.env` e reinicie o servidor:

| Campo | Uso | Padrão |
| --- | --- | --- |
| `APP_NAME` | Nome do produto | SGCP |
| `CLINIC_NAME` | Nome da clínica e títulos das páginas | Clínica Podológica |
| `CLINIC_PROFESSIONAL_NAME` | Rótulo da equipe no agendamento e no resumo | Equipe de podologia |
| `CLINIC_ADDRESS` | Informação de atendimento no rodapé | Consultar a equipe |
| `CLINIC_WHATSAPP` | Número com país e DDD | Vazio |
| `CLINIC_CONTACT_EMAIL` | Contato por e-mail quando não há WhatsApp | Vazio |

`/config.js` entrega somente esses campos públicos. Senhas, chave de sessão e configurações do banco não são incluídas. `public/branding.js` aplica os textos sem interpretar HTML. Sem contato configurado, os links levam às orientações em `/ajuda.html#contato`. O nome da clínica e um canal real de atendimento devem ser preenchidos para cada instalação. Os novos documentos usam Termos `2026-11-v2` e Aviso de Privacidade `2026-11-v4`; os aceites e históricos já existentes permanecem preservados.

### Limites desta etapa

Esta etapa prepara a identidade e a configuração por instalação. O sistema continua operando com **uma clínica por banco**. A revisão do esquema, autenticação, agenda e consultas identificou os seguintes pontos para a futura versão com várias clínicas:

- Criar o cadastro de clínicas, resolver a clínica de cada requisição e vincular contas, permissões e todos os registros a ela.
- Garantir isolamento no banco e em todas as APIs, inclusive catálogo público, busca, relatórios, logs, convites, cadastro e backups. Atualmente não existe `clinica_id` nem isolamento por clínica nas consultas.
- Trocar as restrições globais de CPF, e-mail, horário de agenda e podóloga única por regras compatíveis com cada clínica. O primeiro acesso também verifica uma única proprietária no banco inteiro.
- Tornar horários, profissionais, serviços, identidade e documentos configurações de cada clínica. O rótulo de profissional desta etapa representa a agenda única existente; não cria novas agendas.
- Implementar planos, assinatura, cobrança, limites de uso e administração da plataforma, além de testes que comprovem o isolamento entre clínicas.

Para uma instalação nova, use banco vazio, credenciais próprias e uma chave de sessão própria, seguindo a configuração inicial abaixo. O banco atual e seus backups conservam os cadastros e históricos originais; a limpeza visual não os anonimiza. Não distribua `.env`, `.jwt-secret`, `.git`, backups ou dados reais junto da base do produto.

### Cópia original desta revisão

Antes das alterações de 26/11/2026, foi criado `../Projeto Sistema_clinica_podologica_ORIGINAL_2026-11-26_09-42-51.zip`, fora da pasta do projeto. O arquivo inclui os 1.322 arquivos originais e um dump adicional do PostgreSQL feito antes das alterações. A integridade das entradas ZIP foi verificada; o SHA-256 está no arquivo `.zip.sha256` ao lado. Esse arquivo de restauração preserva a identidade e os dados originais e não é um pacote de distribuição do SaaS.

## Requisitos

- Node.js 18 ou superior.
- PostgreSQL em execução e um banco chamado `sgcp`.
- `pg_dump` disponível no `PATH` para usar o comando de backup.

O WAMP/Apache não é necessário para executar a aplicação. O próprio Node entrega o site e a API na porta 3000.

## Configuração inicial

1. Instale as dependências:

   ```powershell
   npm install
   ```

2. Copie `.env.example` para `.env` e preencha os dados do PostgreSQL. Em ambiente local, o sistema cria uma chave de sessão em `.jwt-secret`; em produção, configure `JWT_SECRET` com pelo menos 32 caracteres aleatórios e use HTTPS.

3. Para um banco novo, crie o banco `sgcp` e execute o esquema-base uma única vez:

   ```powershell
   psql -U postgres -d sgcp -f sql/schema.sql
   ```

   Se as tabelas já existem, não execute o esquema-base novamente. Faça primeiro um backup e aplique apenas as migrações:

   ```powershell
   npm run db:backup
   npm run db:migrate
   ```

   O comando `db:migrate` registra as versões aplicadas na tabela `schema_migrations` e evolui o esquema sem apagar pacientes ou históricos existentes.

4. Inicie o sistema:

   ```powershell
   npm start
   ```

5. Abra `http://localhost:3000`. O primeiro acesso de configuração deve ser feito em `/setup.html` para criar a conta da podóloga. Não há senha padrão.

6. Confira a conexão em `http://localhost:3000/api/health`; a resposta deve conter `"ok": true`.

## Backup

Execute `npm run db:backup` para gerar um arquivo PostgreSQL no diretório `backups/`. Para automatizar a cópia periódica no Windows, agende esse comando no Agendador de Tarefas e mantenha os arquivos de backup em local protegido, com cópias fora do computador da clínica. Configure `PG_DUMP_PATH` no `.env` se `pg_dump.exe` não estiver no `PATH`.

Para restaurar, use `pg_restore` em um banco de destino apropriado. A restauração pode substituir dados; confira o destino e mantenha o backup original antes de executá-la.

## Perfis e privacidade

- **PODOLOGA:** acesso ao prontuário, financeiro, relatórios financeiros, usuários e módulos clínicos.
- **RECEPCIONISTA:** agenda, pacientes, recebimentos e funções operacionais liberadas.
- **PACIENTE:** acesso ao próprio perfil e às próprias consultas.

As sessões duram 8 horas ou 30 dias quando o paciente escolhe “manter conectado”. O cookie é HttpOnly. As informações clínicas e financeiras são protegidas por autorização no servidor.

## Módulos da API

`/api/auth`, `/api/pacientes`, `/api/procedimentos`, `/api/agendamentos`, `/api/anamneses`, `/api/atendimentos`, `/api/financeiro`, `/api/estoque`, `/api/relatorios`, `/api/dashboard` e `/api/usuarios`.

## Regras de agenda

A agenda funciona de segunda a sexta, das 8h às 12h e das 13h às 18h, e aos sábados, das 8h às 12h. Cada consulta reserva um bloco de uma hora, com antecedência mínima de 30 minutos. Solicitações feitas pelo portal aguardam confirmação da clínica. O paciente pode cancelar ou remarcar até duas horas antes.

## Estrutura

```text
server.js             servidor Express e montagem das rotas
db.js                  pool PostgreSQL
lib/                   autenticação e regras de domínio
routes/                API organizada por módulo
public/                páginas, estilos e JavaScript do site e dos portais
sql/schema.sql         esquema-base para banco novo
sql/migrations/        atualizações aditivas do banco
scripts/migrate.js     controle das migrações
scripts/backup.js      backup em formato PostgreSQL customizado
```


## Agenda pública e privacidade

- Em **Agenda**, copie o link de `/agendar.html` para o paciente solicitar um horário sem criar uma conta. O serviço, a data, o horário e a identificação são preenchidos por etapas. O pedido aguarda confirmação da clínica.
- O link usa o endereço pelo qual o painel foi acessado. Para compartilhar pela internet, acesse o painel pelo domínio público da aplicação.
- Os bloqueios reservam um intervalo em um único dia e são respeitados pela recepção, portal, remarcação e página pública. Um bloqueio não pode sobrepor uma consulta existente. Use **Liberar** para removê-lo.
- O menu **Serviços** gerencia procedimentos. Produtos não são publicados no site; materiais continuam no estoque.
- O cadastro de acesso pede somente e-mail, CPF e senha. A faixa etária declarada serve para exigir autorização dos pais, sem coletar nascimento nessa etapa. Nome e nascimento são pedidos no perfil antes do primeiro agendamento; telefone e endereço são opcionais no perfil. Os dados adicionais enviados ao endpoint de criação de acesso são ignorados. O agendamento público continua pedindo os dados necessários ao atendimento e contato.
- É possível entrar com e-mail ou CPF e senha. CPF e e-mail sozinhos não autenticam o paciente. Para cadastros clínicos existentes, a proprietária abre a ficha do paciente em **Pacientes → Ver perfil → Gerar convite de acesso**, após conferir a identidade e a autorização dos pais quando necessária. O link vale por 24 horas, só pode ser usado uma vez e não é enviado automaticamente. Um novo convite invalida o anterior. Somente o hash do token fica no banco (`convites_portal`, migração `008_convites_portal.sql`). O cadastro com convite mantém o prontuário e exige os mesmos aceites; a faixa etária declarada não pode dispensar autorização quando o nascimento registrado indica menor de idade.
- O cadastro e o agendamento público exigem uma caixa separada e inicialmente desmarcada para os **Termos de Uso**, em `/termos.html`. A API exige aceite booleano e a versão vigente. `aceites_termos` registra paciente, usuário quando houver, versão, data/hora do servidor e origem, na mesma transação do cadastro/agendamento. A ciência do aviso de privacidade é registrada separadamente em `aceites_privacidade_paciente`, preservando a primeira data de cada versão.
- Para menores de 18 anos, o serviço exige nome, CPF próprio e vínculo da mãe ou do pai, além de autorização específica, gravada em `consentimentos_responsaveis` com data, origem, versão e finalidade. CPF igual ao do menor e vínculo diferente de mãe/pai são rejeitados. A declaração não comprova filiação; a clínica deve confirmar a responsabilidade antes do atendimento.
- No perfil do paciente, **Descadastrar minha conta** desativa o acesso e encerra a sessão. Consultas existentes e registros clínicos/financeiros são preservados. Solicitações de eliminação de dados seguem o canal indicado no aviso de privacidade.
- O banner permite **RECUSAR opcionais**, aceitar e reabrir a escolha pelo botão **Cookies**, com acesso por teclado. A preferência, versão e data ficam no navegador em `sgcp_cookie_preferences_v1`; a recusa não impede o login. O cookie de sessão é necessário para autenticação. Atualmente não há cookies opcionais, de análise ou publicidade; futuras integrações opcionais devem consultar `window.sgcpCookies.allowsOptional()` antes de carregar.
- O botão **Alto contraste** funciona em todas as páginas e preserva a preferência. Há atalhos para o conteúdo, foco visível, imagens informativas com texto alternativo, respeito à preferência de movimento reduzido e skeletons nas consultas de serviços, agenda, indicadores e ficha.
- A migração `007_termos_cadastro_minimo.sql` é aditiva e preserva o histórico existente; cadastros anteriores são considerados completos e não recebem aceites retroativos.

## Central de ajuda e aparência

- A central em `/ajuda.html` reúne oito guias e perguntas frequentes para pacientes e equipe, com busca sem distinção de acentos ou maiúsculas, filtros por público e navegação por teclado. Ela pode ser acessada sem login. Os links do cabeçalho abrem o conteúdo correspondente a cada público; os módulos continuam protegidos pelas permissões da API.
- Os ícones **?** e **lua/sol** aparecem no cabeçalho do painel e do portal, nas páginas públicas e nos formulários. O modo escuro cobre o site, os portais, formulários, diálogos, documentos e página de erro.
- O primeiro acesso acompanha `prefers-color-scheme`. A escolha manual de claro/escuro fica em `sgcp_theme`, no armazenamento local do navegador, e acompanha a navegação entre páginas. O alto contraste tem prioridade visual. Não é necessária migração de banco para a central ou o tema.

## Visual dos módulos internos

- Pacientes usa uma lista ampla com busca sem acentos, filtros de menores e cadastros sem contato, contadores da listagem e cartões no celular. **Novo paciente** e **Editar** abrem um diálogo com o mesmo formulário e validações da API, incluindo autorização dos pais. Escape fecha o diálogo e devolve o foco ao botão de origem.
- Serviços tem catálogo separado do formulário, busca local, contagem de resultados e atalho para novo procedimento. Atendimento, Financeiro, Estoque, Relatórios, Usuários e Logs compartilham a organização de cartões, formulários e tabelas, com links para os guias de uso.
- As mudanças ficam em `public/module-views.js` e `public/module-views.css`, limitadas aos módulos selecionados. Barra lateral, Dashboard e Agenda são preservados. O tema escuro e o alto contraste continuam disponíveis.
- `npm run verify:browser -- --modules-only` verifica os novos módulos com dados temporários: criação/edição de paciente, filtros, catálogo, teclado, 48 combinações de módulo/tema/largura e comparação dos estilos das áreas preservadas.

## Verificação de fluxos

Execute `npm run verify`. O comando cria um banco temporário `sgcp_verify_*`, aplica o esquema e as migrações, verifica as APIs e remove o banco ao terminar. O usuário PostgreSQL configurado precisa poder criar bancos. Os cadastros da clínica não são usados nos testes.

Execute `npm run verify:browser` para incluir a validação em Chrome ou Edge headless, usando um perfil temporário e o mesmo banco de testes. Esse teste opcional exige Node.js 22 ou superior e Chrome/Edge instalado no Windows (ou `CHROME_PATH`). Verifica páginas de 360 a 1440 pixels, teclado, cookies, contraste, autorização dos pais, cadastro mínimo, busca e filtros da central de ajuda, FAQ por teclado e temas claro/escuro. Inclui preferência do aparelho, persistência entre páginas, prioridade do alto contraste e funcionamento com armazenamento local indisponível. As capturas ficam em `artifacts/verification/`, ignoradas pelo Git. No PowerShell com execução de scripts desabilitada, use `npm.cmd` no lugar de `npm`.

Referências usadas para as escolhas de privacidade: [orientações da ANPD sobre cookies](https://www.gov.br/anpd/pt-br/assuntos/noticias/anpd-emite-recomendacoes-para-adequacao-da-pratica-de-coleta-de-cookies-do-portal-gov.br) e [art. 14 da LGPD](https://normas.leg.br/?urn=urn%3Abr%3Afederal%3Alei%3A2018-08-14%3B13709%21art14). A exigência de mãe/pai para todos os menores é uma regra deste projeto, conforme solicitado; a implementação não equivale a uma certificação jurídica de conformidade.
