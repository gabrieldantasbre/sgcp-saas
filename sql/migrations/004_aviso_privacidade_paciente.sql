CREATE TABLE IF NOT EXISTS aceites_privacidade_paciente (
  paciente_id BIGINT NOT NULL REFERENCES pacientes(id) ON DELETE CASCADE,
  versao VARCHAR(40) NOT NULL,
  aceito_em TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (paciente_id, versao)
);
