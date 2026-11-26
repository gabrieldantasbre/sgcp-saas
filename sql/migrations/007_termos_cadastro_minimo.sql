BEGIN;

ALTER TABLE pacientes ADD COLUMN IF NOT EXISTS cadastro_completo BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE pacientes ADD COLUMN IF NOT EXISTS menor_declarado BOOLEAN;

CREATE TABLE IF NOT EXISTS aceites_termos (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  paciente_id BIGINT NOT NULL REFERENCES pacientes(id) ON DELETE RESTRICT,
  usuario_id BIGINT REFERENCES usuarios(id) ON DELETE SET NULL,
  versao VARCHAR(40) NOT NULL,
  origem VARCHAR(24) NOT NULL CHECK (origem IN ('PORTAL', 'AGENDAMENTO_PUBLICO')),
  aceito_em TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS ix_aceites_termos_paciente ON aceites_termos (paciente_id, aceito_em DESC);

ALTER TABLE consentimentos_responsaveis ADD COLUMN IF NOT EXISTS vinculo VARCHAR(3) CHECK (vinculo IN ('MAE', 'PAI'));
ALTER TABLE consentimentos_responsaveis ADD COLUMN IF NOT EXISTS versao VARCHAR(40);
ALTER TABLE consentimentos_responsaveis ADD COLUMN IF NOT EXISTS finalidade TEXT;

COMMIT;
