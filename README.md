# Vigía de NeumorStudio

Comprueba las webs de los clientes. Si algo falla, abre una incidencia y avisa a Stark y Carlos. Cuando se recupera, la cierra sola.

**Aún no corre solo cada 10 minutos.** Falta el paso de [Cómo se lanza](#cómo-se-lanza).

Las [incidencias abiertas](../../issues?q=is%3Aopen+label%3Avigia) son el estado de hoy, y `estado.json` guarda el último resultado.

## Qué distingue

| Estado | Qué significa | Cómo se detecta |
| --- | --- | --- |
| Caída | La web no funciona para nadie | Falla dos veces seguidas desde fuera de España |
| Bloqueo | Funciona, pero no llega desde España | Va bien desde fuera y fallan al menos 2 operadores españoles |

Una web también cuenta como caída si responde bien pero no contiene el texto esperado.

Desde España se mide con sondas domésticas de [Globalping](https://globalping.io) en Movistar, Vodafone, Orange y Digi. Solo se usa en los puntos marcados con `desdeEspana`, porque el plan gratuito da 250 mediciones por hora y cada comprobación gasta 4. Todas las webs entran por Vercel, así que dos puntos bastan para verlo.

**Supabase** es una señal, no una web de cliente. Está detrás de Cloudflare, así que su incidencia dice que hay bloqueo activo, y no avisa a nadie. Sirve para saber cuándo comprobar que las reservas aguantan.

## Cómo se lanza

El cron de GitHub no sirve para esto. En `tinafusion-vigia`, un cron de 30 minutos corre de media cada 6 horas (entre 3 y 11, medido en 30 ejecuciones). Aquí se queda solo como respaldo.

El disparador bueno es `pg_cron` en Supabase, que ya lanza los recordatorios de Salonio sin fallos. Es un paso único:

1. Crea un token de GitHub *fine-grained*, solo para este repo, con permiso `Actions: Read and write`.
2. En el editor SQL de Supabase, sustituye el token y ejecuta:

```sql
select vault.create_secret('TOKEN_DE_GITHUB', 'vigia_github');

select cron.schedule('vigia', '*/10 * * * *', $$
  select net.http_post(
    url := 'https://api.github.com/repos/NeumorStudio/vigia/actions/workflows/vigia.yml/dispatches',
    body := '{"ref":"main"}'::jsonb,
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'vigia_github'),
      'Accept', 'application/vnd.github+json',
      'User-Agent', 'neumor-vigia',
      'Content-Type', 'application/json'
    )
  )
$$);
```

Si Supabase cae, esto se para. Por eso hace falta además UptimeRobot, que vigila desde fuera.

## Tareas habituales

**Añadir una web:** una entrada en `sitios.json` con `nombre`, `url` y `contiene`, un texto que siempre esté en la página.

**Probar el aviso:** pestaña Actions, Vigía, *Run workflow*, y marcar «Simular una caída». Abre una incidencia `[PRUEBA]` que avisa solo a quien la lanza. La siguiente comprobación la cierra.

**Probar en local, sin abrir nada:**

```bash
node vigia.mjs --seco
```

**Pruebas:**

```bash
node --test
```

## Límites

- Si Globalping no responde o se agota el cupo, esa medición se queda sin dato y no salta alarma.
- GitHub apaga el cron de un repo público tras 60 días sin actividad. Por eso `estado.json` se actualiza al menos una vez por semana.
- El repo es público para no gastar minutos de Actions. Por eso `SUPABASE_URL` va en una variable del repositorio.
