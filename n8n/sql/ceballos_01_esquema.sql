-- =============================================================================
--  Inventario de inmobiliariaceballos.com  ·  esquema
--  Postgres 12+
--
--  Todo vive en su propio schema para no chocar con las tablas que ya usa n8n
--  (n8n_chat_histories_franquicias y compañía) en la misma base.
--
--  Ejecutar una sola vez:  psql "$DSN" -f ceballos_01_esquema.sql
-- =============================================================================

create schema if not exists ceballos;

-- -----------------------------------------------------------------------------
--  inmueble — estado ACTUAL. Una fila por (ficha, operación).
--
--  La clave es compuesta y no solo id_ficha porque hay 11 inmuebles publicados
--  a la vez en venta y en alquiler, con precio distinto en cada operación.
-- -----------------------------------------------------------------------------
create table if not exists ceballos.inmueble (
  id_ficha       bigint      not null,
  operacion      text        not null check (operacion in ('COMPRA','ALQUILER')),

  referencia     text,                    -- referencia comercial, p.ej. 'P-1644'
  provincia      text,
  tipo           text,                    -- PISO / APARTAMENTO, CHALET, LOCAL...
  zona           text,
  titulo         text,
  precio         numeric(12,2),           -- € — de venta o mensual según operacion
  precio_texto   text,                    -- tal cual sale en la web: '665.000 €'
  precio_a_consultar boolean not null default false,  -- la web publicaba el centinela 99.999.999 €
  superficie_m2  integer,
  habitaciones   smallint,
  banos          smallint,
  url            text        not null,

  activo         boolean     not null default true,   -- false = ya no está en la web
  visto_primera  timestamptz not null default now(),
  visto_ultima   timestamptz not null default now(),  -- último scrape que lo vio
  baja_en        timestamptz,                         -- cuándo dejó de aparecer
  huella         text        not null,                -- md5 de los campos mutables

  primary key (id_ficha, operacion)
);

comment on table  ceballos.inmueble is 'Estado actual del inventario publicado en inmobiliariaceballos.com';
comment on column ceballos.inmueble.activo is 'false cuando el inmueble deja de aparecer en la web (vendido, alquilado o retirado)';
comment on column ceballos.inmueble.huella is 'md5 de los campos mutables; sirve para detectar cambios sin comparar columna a columna';

create index if not exists ix_inmueble_activo    on ceballos.inmueble (activo) where activo;
create index if not exists ix_inmueble_operacion on ceballos.inmueble (operacion, activo);
create index if not exists ix_inmueble_provincia on ceballos.inmueble (provincia, operacion);
create index if not exists ix_inmueble_precio    on ceballos.inmueble (operacion, precio);
create index if not exists ix_inmueble_ref       on ceballos.inmueble (referencia);

-- -----------------------------------------------------------------------------
--  evento — histórico. Aquí está el valor de consultar cada hora:
--  altas, bajas y sobre todo bajadas de precio.
-- -----------------------------------------------------------------------------
create table if not exists ceballos.evento (
  id              bigserial   primary key,
  id_ficha        bigint      not null,
  operacion       text        not null,
  tipo_evento     text        not null
                  check (tipo_evento in ('ALTA','BAJA','REACTIVACION','PRECIO','DATOS')),
  precio_anterior numeric(12,2),
  precio_nuevo    numeric(12,2),
  cambios         jsonb,                  -- detalle campo a campo en los 'DATOS'
  ocurrido_en     timestamptz not null default now(),
  id_ejecucion    bigint
);

create index if not exists ix_evento_ficha on ceballos.evento (id_ficha, operacion, ocurrido_en desc);
create index if not exists ix_evento_tipo  on ceballos.evento (tipo_evento, ocurrido_en desc);

-- -----------------------------------------------------------------------------
--  ejecucion — bitácora de cada scrape. Sirve para dos cosas: auditar que el
--  sistema sigue vivo, y diagnosticar cuándo la web cambió de maquetación.
-- -----------------------------------------------------------------------------
create table if not exists ceballos.ejecucion (
  id              bigserial   primary key,
  iniciado_en     timestamptz not null default now(),
  estado          text        not null check (estado in ('OK','ABORTADA')),
  total_web       integer,                -- lo que decía el contador de la web
  filas_recibidas integer,                -- lo que el parser consiguió extraer
  altas           integer     not null default 0,
  bajas           integer     not null default 0,
  reactivaciones  integer     not null default 0,
  cambios_precio  integer     not null default 0,
  cambios_datos   integer     not null default 0,
  activos_final   integer,
  mensaje         text
);

create index if not exists ix_ejecucion_fecha on ceballos.ejecucion (iniciado_en desc);

-- -----------------------------------------------------------------------------
--  Vistas de conveniencia para consumir desde n8n o desde donde sea.
-- -----------------------------------------------------------------------------

-- Lo que hay publicado ahora mismo.
create or replace view ceballos.v_publicado as
select id_ficha, operacion, referencia, provincia, tipo, zona, titulo,
       precio, precio_texto, precio_a_consultar, superficie_m2, habitaciones, banos, url,
       visto_primera, visto_ultima
from   ceballos.inmueble
where  activo;

-- Los que están a la vez en venta y en alquiler.
create or replace view ceballos.v_venta_y_alquiler as
select id_ficha, min(referencia) as referencia,
       max(precio) filter (where operacion = 'COMPRA')   as precio_venta,
       max(precio) filter (where operacion = 'ALQUILER') as precio_alquiler,
       min(url) as url
from   ceballos.inmueble
where  activo
group  by id_ficha
having count(distinct operacion) = 2;

-- Bajadas de precio de los últimos 30 días, la más reciente primero.
create or replace view ceballos.v_bajadas_precio as
select e.ocurrido_en, e.id_ficha, e.operacion, i.referencia, i.tipo, i.zona,
       e.precio_anterior, e.precio_nuevo,
       round((e.precio_nuevo - e.precio_anterior) / nullif(e.precio_anterior,0) * 100, 1) as variacion_pct,
       i.url
from   ceballos.evento e
join   ceballos.inmueble i using (id_ficha, operacion)
where  e.tipo_evento = 'PRECIO'
  and  e.precio_nuevo < e.precio_anterior
  and  e.ocurrido_en > now() - interval '30 days'
order  by e.ocurrido_en desc;
