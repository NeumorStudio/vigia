// Vigía de NeumorStudio: comprueba las webs y abre una incidencia si algo falla.
// Sin dependencias. Las reglas están en `evaluar` y `planificar`, que son puras
// y tienen sus pruebas en vigia.test.mjs.
import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const USER_AGENT = "neumor-vigia";
const TIEMPO_LIMITE_MS = 15_000;
const ESPERA_REINTENTO_MS = 15_000;
const SEMANA_MS = 7 * 24 * 3600 * 1000;
const ETIQUETA = "vigia";

// Operadores españoles que aplican los bloqueos de LaLiga.
const OPERADORES = [
  { country: "ES", asn: 3352, limit: 1 }, // Movistar
  { country: "ES", asn: 12430, limit: 1 }, // Vodafone
  { country: "ES", asn: 12479, limit: 1 }, // Orange
  { country: "ES", asn: 57269, limit: 1 }, // Digi
];

const espera = (ms) => new Promise((ok) => setTimeout(ok, ms));

/**
 * Decide el estado de un sitio.
 *
 * Una caída es que falle también desde fuera de España. Un bloqueo es que
 * funcione desde fuera y no llegue desde al menos dos operadores españoles:
 * con uno solo podría ser un fallo de esa sonda.
 */
export function evaluar(directo, espana) {
  if (!directo.ok) return "caida";
  if (espana && espana.fallos >= 2) return "bloqueo";
  return "ok";
}

/** Clave que identifica una incidencia. Va oculta en el cuerpo de la issue. */
export const marca = (nombre, estado) => `<!-- vigia:${nombre}:${estado} -->`;

/**
 * Compara lo que pasa ahora con las incidencias abiertas.
 * Una incidencia abierta no se repite, y se cierra cuando deja de ser cierta.
 */
export function planificar(estados, abiertas) {
  const vigentes = estados.filter((e) => e.estado !== "ok");
  return {
    crear: vigentes.filter((e) => !abiertas.some((a) => a.body?.includes(marca(e.nombre, e.estado)))),
    // Solo las suyas: una issue escrita a mano con la etiqueta no se toca.
    cerrar: abiertas.filter(
      (a) =>
        a.body?.includes("<!-- vigia:") &&
        !vigentes.some((e) => a.body.includes(marca(e.nombre, e.estado)))
    ),
  };
}

/** Lo que se guarda en estado.json. Solo cambia si hay novedad o pasó una semana. */
export function nuevoEstado(previo, estados, ahora) {
  const sitios = Object.fromEntries(estados.map((e) => [e.nombre, e.estado]));
  const igual = JSON.stringify(previo?.sitios) === JSON.stringify(sitios);
  const reciente = previo?.actualizado && ahora - Date.parse(previo.actualizado) < SEMANA_MS;
  return igual && reciente ? null : { actualizado: new Date(ahora).toISOString(), sitios };
}

async function comprobarDirecto(sitio) {
  let detalle = "";
  for (let intento = 0; intento < 2; intento++) {
    if (intento > 0) await espera(ESPERA_REINTENTO_MS);
    try {
      const res = await fetch(sitio.url, {
        redirect: "follow",
        headers: { "user-agent": USER_AGENT },
        signal: AbortSignal.timeout(TIEMPO_LIMITE_MS),
      });
      const texto = await res.text();
      if (sitio.cualquierRespuesta) return { ok: true };
      if (!res.ok) detalle = `Responde HTTP ${res.status}`;
      else if (sitio.contiene && !texto.toLowerCase().includes(sitio.contiene.toLowerCase())) {
        detalle = `La página no contiene «${sitio.contiene}»`;
      } else return { ok: true };
    } catch (e) {
      detalle = `Sin respuesta: ${e.cause?.code ?? e.name}`;
    }
  }
  return { ok: false, detalle };
}

/** Devuelve null si no se pudo medir: sin dato no hay alarma. */
async function comprobarEspana(sitio) {
  const url = new URL(sitio.url);
  try {
    const crear = await fetch("https://api.globalping.io/v1/measurements", {
      method: "POST",
      headers: { "content-type": "application/json", "user-agent": USER_AGENT },
      body: JSON.stringify({
        type: "http",
        target: url.hostname,
        locations: OPERADORES,
        measurementOptions: { protocol: "HTTPS", request: { method: "HEAD", path: "/" } },
      }),
    });
    if (crear.status !== 202) {
      console.log(`Globalping ${crear.status} para ${sitio.nombre}: sin dato`);
      return null;
    }
    const { id } = await crear.json();
    for (let i = 0; i < 45; i++) {
      await espera(1000);
      const m = await (await fetch(`https://api.globalping.io/v1/measurements/${id}`)).json();
      if (m.status !== "finished") continue;
      const validas = m.results.filter((r) => r.result.status !== "offline");
      const malas = validas.filter((r) => r.result.status !== "finished");
      return {
        total: validas.length,
        fallos: malas.length,
        operadores: malas.map((r) => r.probe.network),
      };
    }
  } catch (e) {
    console.log(`Globalping falló para ${sitio.nombre}: ${e.message}`);
  }
  return null;
}

async function github(ruta, opciones = {}) {
  const res = await fetch(`https://api.github.com/repos/${process.env.GITHUB_REPOSITORY}${ruta}`, {
    ...opciones,
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${process.env.GH_TOKEN}`,
      "user-agent": USER_AGENT,
    },
  });
  if (!res.ok) throw new Error(`GitHub ${res.status} en ${ruta}: ${await res.text()}`);
  return res.json();
}

function textoIncidencia(e, responsables) {
  const hora = new Date().toLocaleString("es-ES", { timeZone: "Europe/Madrid" });
  const titulo = e.estado === "caida" ? `Caída: ${e.nombre}` : `Bloqueo en España: ${e.nombre}`;
  const que =
    e.estado === "caida"
      ? e.directo.detalle
      : `Funciona desde fuera, pero no llega desde: ${e.espana.operadores.join(", ")}.`;
  const siguiente =
    e.estado === "caida"
      ? "Comprobar el despliegue en Vercel o Cloudflare y avisar al cliente si va para largo."
      : "Mirar [hayahora.futbol](https://hayahora.futbol) para ver si hay bloqueo de LaLiga activo.";
  const ejecucion = `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`;
  const aviso = responsables.length ? `\n\nAviso a ${responsables.map((r) => `@${r}`).join(" ")}.` : "";
  return {
    titulo,
    cuerpo:
      `**${que}**\n\nDetectado el ${hora}. [Ver la comprobación](${ejecucion}).\n\n` +
      `Siguiente paso: ${siguiente}\n\nEsta incidencia se cierra sola cuando se recupere.${aviso}\n\n` +
      marca(e.nombre, e.estado),
  };
}

async function main() {
  const config = JSON.parse(await readFile("sitios.json", "utf8"));
  const seco = process.argv.includes("--seco");
  const simular = process.env.SIMULAR === "true";

  const sitios = config.sitios
    .map((s) => (s.urlDesdeVariable ? { ...s, url: process.env[s.urlDesdeVariable] } : s))
    .filter((s) => s.url);
  if (simular) {
    sitios.push({ nombre: "Prueba simulada", url: "https://vigia-prueba.invalid", simulada: true });
  }

  const estados = await Promise.all(
    sitios.map(async (s) => {
      const [directo, espana] = await Promise.all([
        comprobarDirecto(s),
        s.desdeEspana ? comprobarEspana(s) : null,
      ]);
      const estado = evaluar(directo, espana);
      console.log(
        `${estado.padEnd(8)} ${s.nombre}`,
        directo.detalle ?? "",
        espana ? `(España: ${espana.total - espana.fallos}/${espana.total})` : ""
      );
      return { ...s, estado, directo, espana };
    })
  );

  if (seco) return;

  const abiertas = await github(`/issues?state=open&labels=${ETIQUETA}&per_page=100`);
  const { crear, cerrar } = planificar(estados, abiertas);

  for (const e of crear) {
    // Una prueba solo avisa a quien la lanza. La señal de Supabase no avisa a nadie.
    const responsables = e.simulada
      ? [process.env.GITHUB_ACTOR]
      : e.tipo === "senal"
        ? []
        : config.responsables;
    const { titulo, cuerpo } = textoIncidencia(e, responsables);
    await github("/issues", {
      method: "POST",
      body: JSON.stringify({
        title: e.simulada ? `[PRUEBA] ${titulo}` : titulo,
        body: cuerpo,
        labels: [ETIQUETA, e.estado],
        assignees: responsables,
      }),
    });
    console.log(`Abierta: ${titulo}`);
  }

  for (const a of cerrar) {
    const hora = new Date().toLocaleString("es-ES", { timeZone: "Europe/Madrid" });
    await github(`/issues/${a.number}/comments`, {
      method: "POST",
      body: JSON.stringify({ body: `Recuperado el ${hora}.` }),
    });
    await github(`/issues/${a.number}`, {
      method: "PATCH",
      body: JSON.stringify({ state: "closed", state_reason: "completed" }),
    });
    console.log(`Cerrada: ${a.title}`);
  }

  const previo = JSON.parse(await readFile("estado.json", "utf8").catch(() => "null"));
  const reales = estados.filter((e) => !e.simulada);
  const siguiente = nuevoEstado(previo, reales, Date.now());
  if (siguiente) await writeFile("estado.json", JSON.stringify(siguiente, null, 2) + "\n");
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) await main();
