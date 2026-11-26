BEGIN;
CREATE TABLE IF NOT EXISTS bloqueios_agenda (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  inicio TIMESTAMP NOT NULL,
  fim TIMESTAMP NOT NULL,
  motivo VARCHAR(160),
  registrado_por BIGINT REFERENCES usuarios(id) ON DELETE SET NULL,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT ck_bloqueios_agenda_periodo CHECK (fim > inicio)
);

CREATE INDEX IF NOT EXISTS ix_bloqueios_agenda_periodo
  ON bloqueios_agenda (inicio, fim);

ALTER TABLE usuarios
  ADD COLUMN IF NOT EXISTS descadastrado_em TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS consentimentos_responsaveis (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  paciente_id BIGINT NOT NULL REFERENCES pacientes(id) ON DELETE CASCADE,
  responsavel_nome VARCHAR(120) NOT NULL,
  responsavel_cpf CHAR(11) NOT NULL CHECK (responsavel_cpf ~ '^[0-9]{11}$'),
  consentido_em TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  origem VARCHAR(24) NOT NULL CHECK (origem IN ('PORTAL', 'AGENDAMENTO_PUBLICO', 'CLINICA')),
  registrado_por BIGINT REFERENCES usuarios(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS ix_consentimentos_responsaveis_paciente
  ON consentimentos_responsaveis (paciente_id, consentido_em DESC);

DROP INDEX IF EXISTS ux_agendamento_horario_ativo;
CREATE UNIQUE INDEX ux_agendamento_horario_ativo ON agendamentos (data_hora) WHERE status NOT IN ('CANCELADO', 'FALTOU') AND encaixe_urgencia = FALSE;
COMMIT;
