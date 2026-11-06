# Vigía de NeumorStudio

Comprueba cada 10 minutos las webs de los clientes. Si algo falla, abre una incidencia y avisa a Stark y Carlos. Cuando se recupera, la cierra sola.

Las [incidencias abiertas](../../issues?q=is%3Aopen+label%3Avigia) son el estado de hoy, y `estado.json` guarda el último resultado.

## Qué distingue

| Estado | Qué significa | Cómo se detecta |
| --- | --- | --- |
| Caída | La web no funciona para nadie | Falla dos veces seguidas desde fuera de España |
| Bloqueo | Funciona, pero no llega desde España | Va bien desde fuera y fallan al menos 2 operadores españoles |

Una web también cuenta como caída si responde bien pero no contiene el texto esperado.

Desde España se mide con sondas domésticas de [Globalping](https://globalping.io) en Movistar, Vodafone, Orange y Digi. Solo se usa en los puntos marcados con `desdeEspana`, porque el plan gratuito da 250 mediciones por hora y cada comprobación gasta 4. Todas las webs entran por Vercel, así que dos puntos bastan para verlo.

**Supabase** es una señal, no una web de cliente. Está detrás de Cloudflare, así que su incidencia dice que hay bloqueo activo, y no avisa a nadie. Sirve para saber cuándo comprobar que las reservas aguantan.

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

- GitHub no garantiza la hora del cron, y en momentos de carga puede retrasarlo. Para un aviso rápido seguro hace falta además UptimeRobot, que comprueba cada 5 minutos.
- Si Globalping no responde o se agota el cupo, esa medición se queda sin dato y no salta alarma.
- GitHub apaga el cron de un repo público tras 60 días sin actividad. Por eso `estado.json` se actualiza al menos una vez por semana.
- El repo es público para no gastar minutos de Actions. Por eso `SUPABASE_URL` va en una variable del repositorio.
