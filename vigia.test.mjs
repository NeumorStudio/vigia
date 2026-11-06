import assert from "node:assert/strict";
import test from "node:test";
import { evaluar, marca, nuevoEstado, planificar } from "./vigia.mjs";

const bien = { ok: true };
const mal = { ok: false, detalle: "Responde HTTP 500" };

test("funciona desde fuera y desde España", () => {
  assert.equal(evaluar(bien, { total: 4, fallos: 0 }), "ok");
});

test("sin dato de España no hay alarma", () => {
  assert.equal(evaluar(bien, null), "ok");
});

test("un solo operador fallando no es un bloqueo", () => {
  assert.equal(evaluar(bien, { total: 4, fallos: 1 }), "ok");
});

test("dos operadores fallando con la web viva es un bloqueo", () => {
  assert.equal(evaluar(bien, { total: 4, fallos: 2 }), "bloqueo");
});

test("si falla desde fuera es una caída, aunque también falle en España", () => {
  assert.equal(evaluar(mal, { total: 4, fallos: 4 }), "caida");
  assert.equal(evaluar(mal, null), "caida");
});

test("abre incidencia si no hay una abierta", () => {
  const { crear, cerrar } = planificar([{ nombre: "A", estado: "caida" }], []);
  assert.deepEqual(crear.map((e) => e.nombre), ["A"]);
  assert.equal(cerrar.length, 0);
});

test("no repite una incidencia ya abierta", () => {
  const abierta = { number: 1, body: `texto ${marca("A", "caida")}` };
  const { crear, cerrar } = planificar([{ nombre: "A", estado: "caida" }], [abierta]);
  assert.equal(crear.length, 0);
  assert.equal(cerrar.length, 0);
});

test("cierra la incidencia cuando se recupera", () => {
  const abierta = { number: 1, body: marca("A", "caida") };
  const { crear, cerrar } = planificar([{ nombre: "A", estado: "ok" }], [abierta]);
  assert.equal(crear.length, 0);
  assert.deepEqual(cerrar.map((a) => a.number), [1]);
});

test("cierra la incidencia de un sitio que ya no se vigila", () => {
  const abierta = { number: 2, body: marca("Prueba simulada", "caida") };
  assert.equal(planificar([{ nombre: "A", estado: "ok" }], [abierta]).cerrar.length, 1);
});

test("si pasa de bloqueo a caída, cierra una y abre la otra", () => {
  const abierta = { number: 3, body: marca("A", "bloqueo") };
  const { crear, cerrar } = planificar([{ nombre: "A", estado: "caida" }], [abierta]);
  assert.equal(crear.length, 1);
  assert.equal(cerrar.length, 1);
});

test("no toca issues abiertas sin marca del vigía", () => {
  const manual = { number: 4, body: "Nota escrita a mano" };
  const { cerrar } = planificar([{ nombre: "A", estado: "ok" }], [manual]);
  assert.equal(cerrar.length, 0);
});

test("estado.json no cambia sin novedad en la misma semana", () => {
  const ahora = Date.parse("2026-11-06T20:00:00Z");
  const previo = { actualizado: "2026-11-05T20:00:00Z", sitios: { A: "ok" } };
  assert.equal(nuevoEstado(previo, [{ nombre: "A", estado: "ok" }], ahora), null);
});

test("estado.json se renueva cada semana para que GitHub no apague el cron", () => {
  const ahora = Date.parse("2026-11-20T20:00:00Z");
  const previo = { actualizado: "2026-11-05T20:00:00Z", sitios: { A: "ok" } };
  assert.ok(nuevoEstado(previo, [{ nombre: "A", estado: "ok" }], ahora));
});

test("estado.json cambia en cuanto cambia un estado", () => {
  const ahora = Date.parse("2026-11-06T20:00:00Z");
  const previo = { actualizado: "2026-11-05T20:00:00Z", sitios: { A: "ok" } };
  assert.equal(nuevoEstado(previo, [{ nombre: "A", estado: "caida" }], ahora).sitios.A, "caida");
});
