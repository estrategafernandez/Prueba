-- =============================================================================
--  ceballos.sync(jsonb, integer, numeric)
--
--  Toda la lógica del volcado en UNA llamada atómica. n8n solo tiene que hacer:
--      select * from ceballos.sync($1::jsonb, $2::int);
--  y mirar la columna `estado` del resultado.
--
--  Hace, en este orden:
--    1. valida el lote contra tres salvaguardas y aborta SIN TOCAR NADA si falla
--    2. registra los eventos (alta / reactivación / cambio de precio / de datos)
--    3. upsert del estado actual
--    4. da de baja (activo=false) lo que ya no aparece en la web
--
--  La salvaguarda del punto 1 es lo más importante del fichero: si la web cambia
--  de maquetación el parser devolverá 0 filas, y sin este control el paso 4
--  daría de baja el inventario entero en el primer scrape roto.
-- =============================================================================

-- Tabla de staging. Es real y no temporal a propósito: las tablas temporales
-- invalidan los planes cacheados de plpgsql entre llamadas de una misma sesión.
-- Al ser unlogged no genera WAL y queda legible para depurar el último lote.
create unlogged table if not exists ceballos.lote (
  id_ficha      bigint not null,
  operacion     text   not null,
  provincia     text,
  referencia    text,
  tipo          text,
  zona          text,
  titulo        text,
  precio        numeric(12,2),
  precio_texto  text,
  precio_a_consultar boolean,
  superficie_m2 integer,
  habitaciones  smallint,
  banos         smallint,
  url           text,
  huella        text,
  primary key (id_ficha, operacion)
);

create or replace function ceballos.sync(
  p_datos     jsonb,             -- array de inmuebles tal cual lo emite el parser
  p_total_web integer default null,  -- suma de control: los 4 contadores sTotInm
  p_ratio_min numeric default 0.5    -- aborta si el lote < 50% de lo activo
) returns ceballos.ejecucion
language plpgsql
as $$
declare
  v_lote          integer;
  v_activos_antes integer;
  v_activos_final integer;
  v_ej            ceballos.ejecucion;
  v_msg           text := null;
  v_altas         integer := 0;
  v_bajas         integer := 0;
  v_react         integer := 0;
  v_precio        integer := 0;
  v_datos         integer := 0;
begin
  -- Que dos scrapes solapados no se pisen el staging.
  perform pg_advisory_xact_lock(hashtext('ceballos.sync'));

  truncate ceballos.lote;
  insert into ceballos.lote
  select distinct on (x.id_ficha, x.operacion)
         x.id_ficha, x.operacion, x.provincia, x.referencia, x.tipo, x.zona,
         x.titulo, x.precio, x.precio_texto, coalesce(x.precio_a_consultar,false),
         x.superficie_m2, x.habitaciones, x.banos, x.url,
         md5(concat_ws('|', x.precio, x.precio_texto, x.superficie_m2, x.habitaciones,
                            x.banos, x.tipo, x.zona, x.titulo, x.referencia))
  from   jsonb_to_recordset(coalesce(p_datos, '[]'::jsonb)) as x(
           id_ficha bigint, operacion text, provincia text, referencia text,
           tipo text, zona text, titulo text, precio numeric, precio_texto text,
           precio_a_consultar boolean, superficie_m2 integer, habitaciones smallint,
           banos smallint, url text)
  where  x.id_ficha is not null
    and  x.operacion in ('COMPRA','ALQUILER')
  order  by x.id_ficha, x.operacion;

  select count(*) into v_lote from ceballos.lote;
  select count(*) into v_activos_antes from ceballos.inmueble where activo;

  -- ---- salvaguardas -------------------------------------------------------
  if v_lote = 0 then
    v_msg := 'Lote vacío: el parser no extrajo ninguna fila. No se toca nada '
          || '(web caída o cambio de maquetación).';

  elsif p_total_web is not null and v_lote <> p_total_web then
    v_msg := format('Descuadre: la web anuncia %s inmuebles y el parser extrajo %s. '
                 || 'No se toca nada.', p_total_web, v_lote);

  elsif v_activos_antes > 0 and v_lote < (v_activos_antes * p_ratio_min) then
    v_msg := format('Caída sospechosa: %s filas frente a %s activos (umbral %s%%). '
                 || 'No se toca nada.', v_lote, v_activos_antes, round(p_ratio_min * 100));
  end if;

  if v_msg is not null then
    insert into ceballos.ejecucion (estado, total_web, filas_recibidas, activos_final, mensaje)
    values ('ABORTADA', p_total_web, v_lote, v_activos_antes, v_msg)
    returning * into v_ej;
    return v_ej;
  end if;

  insert into ceballos.ejecucion (estado, total_web, filas_recibidas)
  values ('OK', p_total_web, v_lote)
  returning * into v_ej;

  -- ---- eventos (antes del upsert, que es lo que pisa el estado anterior) ---

  insert into ceballos.evento (id_ficha, operacion, tipo_evento, precio_nuevo, id_ejecucion)
  select l.id_ficha, l.operacion, 'ALTA', l.precio, v_ej.id
  from   ceballos.lote l
  left   join ceballos.inmueble i using (id_ficha, operacion)
  where  i.id_ficha is null;
  get diagnostics v_altas = row_count;

  insert into ceballos.evento (id_ficha, operacion, tipo_evento, precio_nuevo, id_ejecucion)
  select l.id_ficha, l.operacion, 'REACTIVACION', l.precio, v_ej.id
  from   ceballos.lote l
  join   ceballos.inmueble i using (id_ficha, operacion)
  where  not i.activo;
  get diagnostics v_react = row_count;

  insert into ceballos.evento (id_ficha, operacion, tipo_evento, precio_anterior, precio_nuevo, id_ejecucion)
  select l.id_ficha, l.operacion, 'PRECIO', i.precio, l.precio, v_ej.id
  from   ceballos.lote l
  join   ceballos.inmueble i using (id_ficha, operacion)
  where  i.activo
    and  i.precio is distinct from l.precio;
  get diagnostics v_precio = row_count;

  insert into ceballos.evento (id_ficha, operacion, tipo_evento, cambios, id_ejecucion)
  select l.id_ficha, l.operacion, 'DATOS',
         jsonb_strip_nulls(jsonb_build_object(
           'referencia',    case when i.referencia    is distinct from l.referencia
                                 then jsonb_build_array(i.referencia, l.referencia) end,
           'tipo',          case when i.tipo          is distinct from l.tipo
                                 then jsonb_build_array(i.tipo, l.tipo) end,
           'zona',          case when i.zona          is distinct from l.zona
                                 then jsonb_build_array(i.zona, l.zona) end,
           'titulo',        case when i.titulo        is distinct from l.titulo
                                 then jsonb_build_array(i.titulo, l.titulo) end,
           'superficie_m2', case when i.superficie_m2 is distinct from l.superficie_m2
                                 then jsonb_build_array(i.superficie_m2, l.superficie_m2) end,
           'habitaciones',  case when i.habitaciones  is distinct from l.habitaciones
                                 then jsonb_build_array(i.habitaciones, l.habitaciones) end,
           'banos',         case when i.banos         is distinct from l.banos
                                 then jsonb_build_array(i.banos, l.banos) end
         )), v_ej.id
  from   ceballos.lote l
  join   ceballos.inmueble i using (id_ficha, operacion)
  where  i.activo
    and  i.huella is distinct from l.huella
    and  i.precio is not distinct from l.precio;
  get diagnostics v_datos = row_count;

  -- ---- estado actual ------------------------------------------------------

  insert into ceballos.inmueble (
    id_ficha, operacion, referencia, provincia, tipo, zona, titulo, precio,
    precio_texto, precio_a_consultar, superficie_m2, habitaciones, banos, url, huella,
    activo, visto_primera, visto_ultima, baja_en)
  select l.id_ficha, l.operacion, l.referencia, l.provincia, l.tipo, l.zona,
         l.titulo, l.precio, l.precio_texto, l.precio_a_consultar, l.superficie_m2,
         l.habitaciones, l.banos, l.url, l.huella,
         true, now(), now(), null
  from   ceballos.lote l
  on conflict (id_ficha, operacion) do update set
         referencia    = excluded.referencia,
         provincia     = excluded.provincia,
         tipo          = excluded.tipo,
         zona          = excluded.zona,
         titulo        = excluded.titulo,
         precio        = excluded.precio,
         precio_texto  = excluded.precio_texto,
         precio_a_consultar = excluded.precio_a_consultar,
         superficie_m2 = excluded.superficie_m2,
         habitaciones  = excluded.habitaciones,
         banos         = excluded.banos,
         url           = excluded.url,
         huella        = excluded.huella,
         activo        = true,
         visto_ultima  = now(),
         baja_en       = null;

  -- ---- bajas: lo que estaba activo y ya no aparece -------------------------

  insert into ceballos.evento (id_ficha, operacion, tipo_evento, precio_anterior, id_ejecucion)
  select i.id_ficha, i.operacion, 'BAJA', i.precio, v_ej.id
  from   ceballos.inmueble i
  where  i.activo
    and  not exists (select 1 from ceballos.lote l
                     where l.id_ficha = i.id_ficha and l.operacion = i.operacion);
  get diagnostics v_bajas = row_count;

  update ceballos.inmueble i
  set    activo = false, baja_en = now()
  where  i.activo
    and  not exists (select 1 from ceballos.lote l
                     where l.id_ficha = i.id_ficha and l.operacion = i.operacion);

  select count(*) into v_activos_final from ceballos.inmueble where activo;

  update ceballos.ejecucion
  set    altas = v_altas, bajas = v_bajas, reactivaciones = v_react,
         cambios_precio = v_precio, cambios_datos = v_datos,
         activos_final = v_activos_final,
         mensaje = format('%s altas, %s bajas, %s reactivaciones, %s cambios de precio, %s de datos.',
                          v_altas, v_bajas, v_react, v_precio, v_datos)
  where  id = v_ej.id
  returning * into v_ej;

  return v_ej;
end;
$$;

comment on function ceballos.sync(jsonb, integer, numeric) is
  'Vuelca un lote del scraper: valida, registra histórico, hace upsert y da de baja lo ausente. Devuelve la fila de ceballos.ejecucion con estado OK o ABORTADA.';
