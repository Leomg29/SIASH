-- SIASH / PostgreSQL: auditoria somente leitura para homologação.
-- Não modifica tabelas, usuários, prontuários ou registros.
-- Executar em Supabase SQL Editor da HOMOLOGAÇÃO, após confirmar o projeto.
BEGIN READ ONLY;
SELECT current_database() AS banco, current_schema() AS esquema, current_timestamp AS verificado_em;
SELECT table_name FROM information_schema.tables
 WHERE table_schema='public' AND table_name LIKE 'siash_%' ORDER BY table_name;
SELECT column_name,data_type,is_nullable,column_default
 FROM information_schema.columns WHERE table_schema='public' AND table_name='siash_state'
 ORDER BY ordinal_position;
SELECT indexname,indexdef FROM pg_indexes WHERE schemaname='public'
 AND tablename IN ('siash_state','siash_state_history','siash_pending_tasks')
 ORDER BY tablename,indexname;
SELECT id,revision,updated_at,updated_by,pg_column_size(payload) AS payload_bytes
 FROM public.siash_state WHERE id=1;
SELECT count(*) AS total_versoes_historicas, max(saved_at) AS ultima_versao
 FROM public.siash_state_history;
SELECT count(*) AS pendencias, count(*) FILTER (WHERE status='Concluída') AS concluidas
 FROM public.siash_pending_tasks;
COMMIT;
