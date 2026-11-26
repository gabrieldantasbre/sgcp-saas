-- Perfis configuráveis para usuários internos. As permissões são carregadas a
-- cada requisição para que alterações do perfil tenham efeito imediatamente.
BEGIN;

CREATE TABLE IF NOT EXISTS perfis_acesso (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  nome VARCHAR(60) NOT NULL UNIQUE,
  permissoes JSONB NOT NULL DEFAULT '[]'::jsonb,
  sistema BOOLEAN NOT NULL DEFAULT FALSE,
  criado_por BIGINT REFERENCES usuarios(id) ON DELETE SET NULL,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT ck_perfis_acesso_permissoes CHECK (jsonb_typeof(permissoes) = 'array')
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_perfis_acesso_nome_lower ON perfis_acesso (LOWER(nome));

INSERT INTO perfis_acesso (nome, permissoes, sistema)
VALUES (
  'Recepcionista',
  '["dashboard", "agenda", "pacientes", "receitas", "estoque", "relatorio_estoque"]'::jsonb,
  TRUE
)
ON CONFLICT (nome) DO NOTHING;

ALTER TABLE usuarios
  ADD COLUMN IF NOT EXISTS perfil_acesso_id BIGINT REFERENCES perfis_acesso(id) ON DELETE RESTRICT;

UPDATE usuarios
   SET perfil_acesso_id = (SELECT id FROM perfis_acesso WHERE nome = 'Recepcionista')
 WHERE perfil = 'RECEPCIONISTA' AND perfil_acesso_id IS NULL;

CREATE INDEX IF NOT EXISTS ix_usuarios_perfil_acesso ON usuarios (perfil_acesso_id);

COMMIT;
