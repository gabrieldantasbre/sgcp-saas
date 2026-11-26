-- Evolui o esquema inicial do SGCP sem apagar os registros existentes.
-- Execute depois de sql/schema.sql. Pode ser executado novamente.

BEGIN;

-- Contas de acesso: acrescenta o perfil paciente e liga a conta ao cadastro.
ALTER TABLE usuarios
  ADD COLUMN IF NOT EXISTS paciente_id BIGINT REFERENCES pacientes(id) ON DELETE SET NULL;
ALTER TABLE usuarios
  DROP CONSTRAINT IF EXISTS usuarios_perfil_check;
ALTER TABLE usuarios
  ADD CONSTRAINT usuarios_perfil_check
  CHECK (perfil IN ('PODOLOGA', 'RECEPCIONISTA', 'PACIENTE'));
ALTER TABLE usuarios
  DROP CONSTRAINT IF EXISTS ck_usuario_paciente;
ALTER TABLE usuarios
  ADD CONSTRAINT ck_usuario_paciente
  CHECK ((perfil = 'PACIENTE') = (paciente_id IS NOT NULL));
CREATE UNIQUE INDEX IF NOT EXISTS ux_usuarios_email_lower ON usuarios (LOWER(email));
CREATE UNIQUE INDEX IF NOT EXISTS ux_usuarios_paciente ON usuarios (paciente_id) WHERE paciente_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_usuarios_podologa_unica ON usuarios (perfil) WHERE perfil = 'PODOLOGA';

-- A anamnese é histórica: cada novo preenchimento conserva o anterior.
ALTER TABLE fichas_anamnese
  DROP CONSTRAINT IF EXISTS fichas_anamnese_paciente_id_key;
ALTER TABLE fichas_anamnese
  ADD COLUMN IF NOT EXISTS podologa_id BIGINT REFERENCES usuarios(id);
ALTER TABLE fichas_anamnese
  ADD COLUMN IF NOT EXISTS hipertenso BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE fichas_anamnese
  ADD COLUMN IF NOT EXISTS problema_circulatorio BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE fichas_anamnese
  ADD COLUMN IF NOT EXISTS cirurgias_anteriores TEXT;
ALTER TABLE fichas_anamnese
  ADD COLUMN IF NOT EXISTS tipo_calcado VARCHAR(100);

-- O procedimento fica ligado à reserva; a duração informada não reduz o
-- bloco reservado, que continua sendo de uma hora (RN008).
ALTER TABLE procedimentos
  ADD COLUMN IF NOT EXISTS ativo BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE agendamentos
  ADD COLUMN IF NOT EXISTS procedimento_id BIGINT REFERENCES procedimentos(id);

-- Atendimentos sem agendamento também são aceitos para encaixes registrados
-- diretamente pela podóloga.
ALTER TABLE atendimentos
  ALTER COLUMN agendamento_id DROP NOT NULL;
ALTER TABLE atendimentos
  ADD COLUMN IF NOT EXISTS paciente_id BIGINT REFERENCES pacientes(id);
ALTER TABLE atendimentos
  ADD COLUMN IF NOT EXISTS queixa TEXT;
ALTER TABLE atendimentos
  ADD COLUMN IF NOT EXISTS evolucao TEXT;
ALTER TABLE atendimentos
  ADD COLUMN IF NOT EXISTS orientacoes TEXT;

-- Toda movimentação nova registra quem a lançou. O campo permanece anulável
-- para preservar eventuais movimentações antigas.
ALTER TABLE movimentacoes_estoque
  ADD COLUMN IF NOT EXISTS registrado_por BIGINT REFERENCES usuarios(id) ON DELETE SET NULL;

-- Conta a pagar e despesa permanecem no mesmo registro ao longo do ciclo.
ALTER TABLE contas_pagar
  ADD COLUMN IF NOT EXISTS categoria VARCHAR(40) NOT NULL DEFAULT 'Outras despesas';
ALTER TABLE contas_pagar
  ADD COLUMN IF NOT EXISTS fornecedor VARCHAR(120);
ALTER TABLE contas_pagar
  ADD COLUMN IF NOT EXISTS forma_pagamento VARCHAR(20);
ALTER TABLE contas_pagar
  ADD COLUMN IF NOT EXISTS recorrencia VARCHAR(10) NOT NULL DEFAULT 'nao';
ALTER TABLE contas_pagar
  ADD COLUMN IF NOT EXISTS serie VARCHAR(40);
ALTER TABLE contas_pagar
  ADD COLUMN IF NOT EXISTS parcela VARCHAR(7);
ALTER TABLE contas_pagar
  DROP CONSTRAINT IF EXISTS ck_contas_pagar_recorrencia;
ALTER TABLE contas_pagar
  ADD CONSTRAINT ck_contas_pagar_recorrencia
  CHECK (recorrencia IN ('nao', 'mensal', 'parcelado'));
ALTER TABLE contas_pagar
  DROP CONSTRAINT IF EXISTS ck_contas_pagar_forma_pagamento;
ALTER TABLE contas_pagar
  ADD CONSTRAINT ck_contas_pagar_forma_pagamento
  CHECK (forma_pagamento IS NULL OR forma_pagamento IN
    ('PIX', 'CARTAO_CREDITO', 'CARTAO_DEBITO', 'DINHEIRO', 'BOLETO', 'TRANSFERENCIA'));

-- Receitas podem nascer como "a receber" no encerramento do atendimento.
-- Lançamentos antigos são considerados pagos na data original.
ALTER TABLE movimentacoes_financeiras
  ADD COLUMN IF NOT EXISTS paciente_id BIGINT REFERENCES pacientes(id);
ALTER TABLE movimentacoes_financeiras
  ADD COLUMN IF NOT EXISTS categoria VARCHAR(30);
ALTER TABLE movimentacoes_financeiras
  ADD COLUMN IF NOT EXISTS status VARCHAR(10) NOT NULL DEFAULT 'PAGO';
ALTER TABLE movimentacoes_financeiras
  ADD COLUMN IF NOT EXISTS data_pagamento DATE;
ALTER TABLE movimentacoes_financeiras
  DROP CONSTRAINT IF EXISTS movimentacoes_financeiras_forma_pagamento_check;
ALTER TABLE movimentacoes_financeiras
  DROP CONSTRAINT IF EXISTS ck_movimentacao_financeira_forma_pagamento;
ALTER TABLE movimentacoes_financeiras
  ADD CONSTRAINT ck_movimentacao_financeira_forma_pagamento
  CHECK (forma_pagamento IS NULL OR forma_pagamento IN
    ('PIX', 'CARTAO', 'CARTAO_CREDITO', 'CARTAO_DEBITO', 'DINHEIRO', 'BOLETO', 'TRANSFERENCIA'));
UPDATE movimentacoes_financeiras
   SET data_pagamento = data
 WHERE status = 'PAGO' AND data_pagamento IS NULL;
ALTER TABLE movimentacoes_financeiras
  DROP CONSTRAINT IF EXISTS ck_movimentacao_financeira_status;
ALTER TABLE movimentacoes_financeiras
  ADD CONSTRAINT ck_movimentacao_financeira_status
  CHECK (status IN ('PENDENTE', 'PAGO'));
ALTER TABLE movimentacoes_financeiras
  DROP CONSTRAINT IF EXISTS ck_movimentacao_financeira_pagamento;
ALTER TABLE movimentacoes_financeiras
  ADD CONSTRAINT ck_movimentacao_financeira_pagamento
  CHECK (status <> 'PAGO' OR data_pagamento IS NOT NULL);

CREATE INDEX IF NOT EXISTS ix_agendamentos_paciente_data
  ON agendamentos (paciente_id, data_hora);
CREATE INDEX IF NOT EXISTS ix_movimentacoes_financeiras_status_data
  ON movimentacoes_financeiras (tipo, status, data_pagamento);
CREATE INDEX IF NOT EXISTS ix_movimentacoes_estoque_data
  ON movimentacoes_estoque (data_hora, produto_id);

-- Serviços exibidos no site. Valores usados abaixo constam nas telas da
-- documentação; a avaliação é gratuita.
INSERT INTO procedimentos (nome, descricao, valor_referencia, duracao_media_min, ativo)
VALUES
  ('Avaliação Podológica', 'Avaliação inicial dos pés. Serviço gratuito.', 0, 60, TRUE),
  ('Tratamento de Micose Ungueal (Convencional)', 'Tratamento podológico para micose ungueal.', 120, 60, TRUE),
  ('Reflexologia Podal', 'Sessão de reflexologia podal.', 80, 30, TRUE)
ON CONFLICT (nome) DO NOTHING;

-- Relatório financeiro em regime de caixa: só considera valores recebidos
-- ou pagos e agrupa pela data efetiva da movimentação.
CREATE OR REPLACE VIEW vw_resumo_financeiro_mensal AS
WITH receitas AS (
  SELECT date_trunc('month', data_pagamento)::date AS mes, SUM(valor) AS total
    FROM movimentacoes_financeiras
   WHERE tipo = 'RECEITA' AND status = 'PAGO'
   GROUP BY 1
), despesas AS (
  SELECT date_trunc('month', data_pagamento)::date AS mes, SUM(valor) AS total
    FROM movimentacoes_financeiras
   WHERE tipo = 'DESPESA' AND status = 'PAGO'
   GROUP BY 1
)
SELECT COALESCE(r.mes, d.mes) AS mes,
       COALESCE(r.total, 0) AS receitas,
       COALESCE(d.total, 0) AS despesas,
       COALESCE(r.total, 0) - COALESCE(d.total, 0) AS saldo
  FROM receitas r
  FULL JOIN despesas d ON d.mes = r.mes
 ORDER BY 1;

CREATE OR REPLACE VIEW vw_estoque_baixo AS
SELECT id, nome, quantidade_atual, estoque_minimo, unidade_medida
  FROM produtos
 WHERE ativo AND quantidade_atual <= estoque_minimo;

CREATE OR REPLACE VIEW vw_relatorio_estoque AS
SELECT p.id AS produto_id,
       p.nome,
       p.unidade_medida,
       p.quantidade_atual,
       p.estoque_minimo,
       CASE WHEN p.quantidade_atual <= p.estoque_minimo THEN 'Repor' ELSE 'OK' END AS situacao,
       COALESCE(SUM(m.quantidade) FILTER (WHERE m.tipo = 'ENTRADA'), 0) AS entradas_30_dias,
       COALESCE(SUM(m.quantidade) FILTER (WHERE m.tipo = 'SAIDA'), 0) AS saidas_30_dias
  FROM produtos p
  LEFT JOIN movimentacoes_estoque m
    ON m.produto_id = p.id
   AND m.data_hora >= CURRENT_DATE - INTERVAL '30 days'
 WHERE p.ativo
 GROUP BY p.id
 ORDER BY situacao DESC, p.nome;

COMMIT;
