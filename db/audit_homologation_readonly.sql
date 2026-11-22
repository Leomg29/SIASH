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

-- 08. Estrutura JSONB do estado e cardinalidade dos arrays.
SELECT revision,
 jsonb_typeof(payload->'state'->'daily') AS tipo_daily,
 jsonb_typeof(payload->'state'->'beds') AS tipo_beds,
 jsonb_typeof(payload->'state'->'movements') AS tipo_movements,
 CASE WHEN jsonb_typeof(payload->'state'->'beds')='array'
 THEN jsonb_array_length(payload->'state'->'beds') END AS leitos_fisicos
FROM public.siash_state WHERE id=1;

-- 09. Leitos: preservar perfil, isolamento e status como dimensoes distintas.
WITH beds AS (
 SELECT b.value AS item FROM public.siash_state s
 CROSS JOIN LATERAL jsonb_array_elements(
 CASE WHEN jsonb_typeof(s.payload->'state'->'beds')='array'
 THEN s.payload->'state'->'beds' ELSE '[]'::jsonb END) b WHERE s.id=1
)
SELECT item->>'n' AS leito,item->>'status' AS status,
 item->>'profile' AS perfil,item->>'isolation' AS isolamento
FROM beds ORDER BY item->>'n';

-- 10. Leitos duplicados ou sem identificacao.
WITH beds AS (
 SELECT b.value AS item FROM public.siash_state s
 CROSS JOIN LATERAL jsonb_array_elements(
 CASE WHEN jsonb_typeof(s.payload->'state'->'beds')='array'
 THEN s.payload->'state'->'beds' ELSE '[]'::jsonb END) b WHERE s.id=1
)
SELECT item->>'n' AS leito,count(*) AS ocorrencias FROM beds
GROUP BY item->>'n'
HAVING count(*)>1 OR item->>'n' IS NULL;

-- 11. Datas duplicadas, ausentes ou estruturalmente invalidas.
WITH daily AS (
 SELECT d.value AS item FROM public.siash_state s
 CROSS JOIN LATERAL jsonb_array_elements(
 CASE WHEN jsonb_typeof(s.payload->'state'->'daily')='array'
 THEN s.payload->'state'->'daily' ELSE '[]'::jsonb END) d WHERE s.id=1
)
SELECT item->>'date' AS data,count(*) AS ocorrencias FROM daily
GROUP BY item->>'date'
HAVING count(*)>1 OR item->>'date' IS NULL
 OR item->>'date' !~ '^\\d{4}-\\d{2}-\\d{2}$';

-- 12. Contagens clinicas invalidas, sem coagir strings arbitrarias a numeros.
WITH daily AS (
 SELECT d.value AS item FROM public.siash_state s
 CROSS JOIN LATERAL jsonb_array_elements(
 CASE WHEN jsonb_typeof(s.payload->'state'->'daily')='array'
 THEN s.payload->'state'->'daily' ELSE '[]'::jsonb END) d WHERE s.id=1
), fields AS (
 SELECT item->>'date' AS data,f.campo,item->>f.campo AS valor
 FROM daily CROSS JOIN (VALUES ('internados'),('admissoes'),('altas'),
 ('transferencias'),('obitos')) f(campo)
)
SELECT data,campo,valor FROM fields
WHERE valor IS NULL OR valor !~ '^(0|[1-9][0-9]{0,14})$'
ORDER BY data,campo;

-- 13. Cobertura por competencia: contagem de registros versus datas distintas.
WITH daily AS (
 SELECT d.value->>'date' AS data FROM public.siash_state s
 CROSS JOIN LATERAL jsonb_array_elements(
 CASE WHEN jsonb_typeof(s.payload->'state'->'daily')='array'
 THEN s.payload->'state'->'daily' ELSE '[]'::jsonb END) d WHERE s.id=1
)
SELECT left(data,7) AS competencia,count(*) AS registros,
 count(DISTINCT data) AS datas_distintas,
 count(*)-count(DISTINCT data) AS duplicidades,
 10*count(*) AS leitos_dia_formula_atual,
 10*count(DISTINCT data) AS leitos_dia_datas_distintas
FROM daily WHERE data ~ '^\\d{4}-\\d{2}-\\d{2}$'
GROUP BY left(data,7) ORDER BY competencia;

-- 14. Reconciliação I(d) = I(d-1) + A(d) - H(d) - T(d) - O(d).
-- Nenhuma data duplicada (inclusive anterior) e comparavel.
-- Lacunas e valores invalidos nunca sao preenchidos automaticamente.
WITH raw AS (
 SELECT d.value AS item FROM public.siash_state s
 CROSS JOIN LATERAL jsonb_array_elements(
 CASE WHEN jsonb_typeof(s.payload->'state'->'daily')='array'
 THEN s.payload->'state'->'daily' ELSE '[]'::jsonb END) d WHERE s.id=1
), prepared AS (
 SELECT item,item->>'date' AS date_text,
 CASE WHEN item->>'date' ~ '^\\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$'
 THEN to_date(item->>'date','YYYY-MM-DD') END AS parsed_date
 FROM raw
), validated AS (
 SELECT *,
 CASE WHEN parsed_date IS NOT NULL AND to_char(parsed_date,'YYYY-MM-DD')=date_text
 THEN parsed_date END AS valid_date
 FROM prepared
), typed AS (
 SELECT *,
 CASE WHEN item->>'internados' ~ '^(0|[1-9][0-9]{0,14})$'
 THEN (item->>'internados')::numeric END AS internados,
 CASE WHEN item->>'admissoes' ~ '^(0|[1-9][0-9]{0,14})$'
 THEN (item->>'admissoes')::numeric END AS admissoes,
 CASE WHEN item->>'altas' ~ '^(0|[1-9][0-9]{0,14})$'
 THEN (item->>'altas')::numeric END AS altas,
 CASE WHEN item->>'transferencias' ~ '^(0|[1-9][0-9]{0,14})$'
 THEN (item->>'transferencias')::numeric END AS transferencias,
 CASE WHEN item->>'obitos' ~ '^(0|[1-9][0-9]{0,14})$'
 THEN (item->>'obitos')::numeric END AS obitos,
 count(*) OVER (PARTITION BY date_text) AS occurrences
 FROM validated
), sequenced AS (
 SELECT *,
 lag(valid_date) OVER (ORDER BY valid_date,date_text) AS prior_date,
 lag(internados) OVER (ORDER BY valid_date,date_text) AS prior_internados,
 lag(occurrences) OVER (ORDER BY valid_date,date_text) AS prior_occurrences
 FROM typed WHERE valid_date IS NOT NULL
), calculated AS (
 SELECT *,prior_internados+admissoes-altas-transferencias-obitos AS expected
 FROM sequenced
)
SELECT date_text AS data,prior_date,prior_internados,
 admissoes,altas,transferencias,obitos,
 internados AS internados_informados,
 CASE WHEN occurrences=1 AND coalesce(prior_occurrences,0)=1
 AND prior_date=valid_date-1 AND prior_internados IS NOT NULL
 AND internados IS NOT NULL AND admissoes IS NOT NULL
 AND altas IS NOT NULL AND transferencias IS NOT NULL AND obitos IS NOT NULL
 THEN expected END AS saldo_esperado,
 CASE WHEN occurrences=1 AND coalesce(prior_occurrences,0)=1
 AND prior_date=valid_date-1 AND prior_internados IS NOT NULL
 AND internados IS NOT NULL AND admissoes IS NOT NULL
 AND altas IS NOT NULL AND transferencias IS NOT NULL AND obitos IS NOT NULL
 THEN internados-expected END AS diferenca,
 CASE
 WHEN occurrences>1 THEN 'NAO COMPARAVEL: DATA DUPLICADA'
 WHEN prior_date IS NULL THEN 'NAO COMPARAVEL: SEM DIA ANTERIOR'
 WHEN coalesce(prior_occurrences,0)>1 THEN 'NAO COMPARAVEL: DIA ANTERIOR DUPLICADO'
 WHEN valid_date-prior_date<>1 THEN 'NAO COMPARAVEL: LACUNA ENTRE DIAS'
 WHEN internados IS NULL OR prior_internados IS NULL OR admissoes IS NULL
 OR altas IS NULL OR transferencias IS NULL OR obitos IS NULL
 THEN 'NAO COMPARAVEL: VALOR INVALIDO'
 WHEN expected<0 THEN 'DIVERGENCIA: SALDO NEGATIVO'
 WHEN internados<>expected THEN 'DIVERGENCIA: CONFERIR'
 ELSE 'CONSISTENTE MATEMATICAMENTE' END AS resultado
FROM calculated ORDER BY valid_date,date_text;

-- 15. Conferencias manuais: apenas inventario, nao autoriza fechamento.
WITH daily AS (
 SELECT d.value AS item FROM public.siash_state s
 CROSS JOIN LATERAL jsonb_array_elements(
 CASE WHEN jsonb_typeof(s.payload->'state'->'daily')='array'
 THEN s.payload->'state'->'daily' ELSE '[]'::jsonb END) d WHERE s.id=1
)
SELECT item->>'date' AS data,item->>'internados' AS internados,
 item->'censusConference' AS conferencia,
 CASE WHEN jsonb_typeof(item->'censusConferenceHistory')='array'
 THEN jsonb_array_length(item->'censusConferenceHistory') ELSE 0 END AS historico
FROM daily WHERE item ? 'censusConference' OR item ? 'censusConferenceHistory';

-- 16. Conferencias com data, contagem ou responsavel divergente.
WITH daily AS (
 SELECT d.value AS item FROM public.siash_state s
 CROSS JOIN LATERAL jsonb_array_elements(
 CASE WHEN jsonb_typeof(s.payload->'state'->'daily')='array'
 THEN s.payload->'state'->'daily' ELSE '[]'::jsonb END) d WHERE s.id=1
)
SELECT item->>'date' AS data,item->'censusConference' AS conferencia
FROM daily WHERE jsonb_typeof(item->'censusConference')='object'
 AND (item->'censusConference'->>'referenceDate' IS DISTINCT FROM item->>'date'
 OR item->'censusConference'->>'count' IS DISTINCT FROM item->>'internados'
 OR nullif(trim(item->'censusConference'->>'responsible'),'') IS NULL);

-- 17. Sobreposicao legado Canguru e contagens maiores que altas.
WITH daily AS (
 SELECT d.value AS item FROM public.siash_state s
 CROSS JOIN LATERAL jsonb_array_elements(
 CASE WHEN jsonb_typeof(s.payload->'state'->'daily')='array'
 THEN s.payload->'state'->'daily' ELSE '[]'::jsonb END) d WHERE s.id=1
), counts AS (
 SELECT item->>'date' AS data,
 CASE WHEN item->>'altas' ~ '^[0-9]{1,15}$' THEN (item->>'altas')::numeric END AS altas,
 CASE WHEN item->>'canguru' ~ '^[0-9]{1,15}$' THEN (item->>'canguru')::numeric END AS legado,
 CASE WHEN item->>'altaCanguru' ~ '^[0-9]{1,15}$' THEN (item->>'altaCanguru')::numeric END AS atual
 FROM daily
)
SELECT *,coalesce(legado,0)+coalesce(atual,0) AS total_canguru
FROM counts WHERE (legado>0 AND atual>0)
 OR (altas IS NOT NULL AND coalesce(legado,0)+coalesce(atual,0)>altas);

-- 18. Inventario de movimentacoes.
WITH movements AS (
 SELECT m.value AS item FROM public.siash_state s
 CROSS JOIN LATERAL jsonb_array_elements(
 CASE WHEN jsonb_typeof(s.payload->'state'->'movements')='array'
 THEN s.payload->'state'->'movements' ELSE '[]'::jsonb END) m WHERE s.id=1
)
SELECT item->>'type' AS tipo,count(*) AS registros,
 count(*) FILTER (WHERE nullif(item->>'when','') IS NULL) AS sem_horario
FROM movements GROUP BY item->>'type';

-- 19. Legado de fechamentos automaticos: SOMENTE LEITURA.
SELECT reference_date,midnight_at,census_count,note,state_revision
FROM public.siash_census_auto_closures
ORDER BY reference_date DESC LIMIT 100;

COMMIT;
