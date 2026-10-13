// Offline presentation of recorded evidence. No simulator, provider or scorer is run.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, relative, dirname } from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).map(arg => {
  const i = arg.indexOf('=');
  if (!arg.startsWith('--') || i < 0) throw Error('Use --input=path --output=folder');
  return [arg.slice(2, i), arg.slice(i + 1)];
}));
const input = resolve(args.input ?? 'reports/analysis/final-two-response-closed-20261013/readout.json');
const output = resolve(args.output ?? `reports/analysis/response-explained-${Date.now()}`);
if (dirname(input) === output) throw Error('Keep the original evidence unchanged; use a new output folder.');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const bytes = await readFile(input), report = JSON.parse(bytes), inputSha256 = sha(bytes);
if (report.schema !== 'closed-current-two-extremes-readout-v1') throw Error('Unsupported recorded readout schema.');
const conventional = report.columns.find(c => c.arm === 'C_manual');
const nexo = report.columns.find(c => c.arm === 'B6');
if (!conventional || !nexo || report.columns.length !== 2) throw Error('Expected the two recorded methods.');
const columns = [conventional, nexo];
if (!report.source.stable || columns.some(c => c.status !== 'completed' || !c.source.stable)) throw Error('Recorded comparison is not closed and source-stable.');
const unit = { water: 'L', food: 'portions', blankets: 'unit' };
for (const column of columns) {
  const rawPath = resolve(column.raw.path), rawBytes = await readFile(rawPath);
  if (sha(rawBytes) !== column.raw.sha256) throw Error(`Raw evidence hash mismatch: ${column.arm}`);
  const stages = column.physical.stages.thresholdContribution;
  if (Object.values(stages).some(s => s.observed !== s.eligible || s.eligible !== column.physical.needs.length)) throw Error('Do not present incomplete stages as complete means.');
  const phaseSum = ['preAuthorizationMs', 'pickupAndPreparationMs', 'loadedTravelMs', 'arrivalToServiceMs'].reduce((sum, key) => sum + stages[key].meanMs, 0);
  if (Math.abs(phaseSum - stages.totalMs.meanMs) > 0.0001) throw Error('Recorded phases do not reconcile.');
  for (const resource of column.physical.byResource) {
    if (unit[resource.type] !== resource.unit) throw Error('Unexpected resource units.');
  }
}
const number = (value, digits = 3) => Number.isFinite(value)
  ? value.toLocaleString('es-ES', { minimumFractionDigits: digits, maximumFractionDigits: digits }) : 'Sin dato';
const minutes = ms => number(ms / 60000);
const delta = (a, b) => a === b ? 'Igual' : a === 0 ? 'Aumenta desde 0'
  : `${number(Math.abs(b / a - 1) * 100, 2)}% ${b < a ? 'menos' : 'más'}`;
const sourceLink = relative(output, input).replaceAll('\\', '/');
const paired = (read, metric, meaning, display = number) => {
  const a = read(conventional), b = read(nexo);
  return { metric, conventional: a, nexo: b, displayConventional: display(a), displayNexo: display(b), change: delta(a, b), meaning };
};
const travelBreakdown = columns.map(column => {
  const cases = column.physical.needs.map(need => {
    if (need.censored || need.contributions.length !== 1 || need.positivePhysicalReceipts !== 1 || !need.thresholdContribution.known) throw Error('Travel-excluded presentation requires one complete contribution per need.');
    const times = need.contributions[0].times;
    const keys = ['authorized', 'orderReceived', 'accepted', 'dispatched', 'arrived', 'service'];
    if (keys.some(key => !Number.isFinite(times[key]))) throw Error('Missing timestamp in travel decomposition.');
    let pickupTravelMs = 0;
    if (times.pickupDispatched != null || times.pickupArrived != null) {
      if (![times.pickupDispatched, times.pickupArrived].every(Number.isFinite)) throw Error('Incomplete pickup timestamps.');
      pickupTravelMs = times.pickupArrived - times.pickupDispatched;
      keys.splice(3, 0, 'pickupDispatched', 'pickupArrived');
    }
    if (keys.some((key, i) => i > 0 && times[key] < times[keys[i - 1]])) throw Error('Non-monotonic operation timestamps.');
    const loadedTravelMs = times.arrived - times.dispatched;
    const totalMs = need.thresholdContribution.totalMs;
    const withoutShipmentTravelMs = totalMs - pickupTravelMs - loadedTravelMs;
    if (pickupTravelMs < 0 || loadedTravelMs < 0 || withoutShipmentTravelMs < 0 || Math.abs(loadedTravelMs - need.thresholdContribution.loadedTravelMs) > 0.0001) throw Error('Travel decomposition does not reconcile.');
    return { need: need.id, pickupTravelMs, loadedTravelMs, withoutShipmentTravelMs, totalMs };
  });
  const mean = key => cases.reduce((sum, item) => sum + item[key], 0) / cases.length;
  return { arm: column.arm, observed: cases.length, pickupTravelMeanMs: mean('pickupTravelMs'), loadedTravelMeanMs: mean('loadedTravelMs'), withoutShipmentTravelMeanMs: mean('withoutShipmentTravelMs'), cases };
});
const travelExcludedRows = [paired(c => travelBreakdown.find(t => t.arm === c.arm).withoutShipmentTravelMeanMs, 'Tiempo operativo sin trayectos del envío (min)', 'Menos es mejor. Conserva preparación/autorización, transmisión, carga y descarga; excluye desplazamiento a recogida y viaje cargado. La espera previa por flota ocupada sigue dentro: no es sólo tiempo de pensar.', minutes)];
const phaseRows = [
  paired(c => c.physical.stages.thresholdContribution.preAuthorizationMs.meanMs, 'Preparar y autorizar la respuesta', 'Menos es mejor. Desde que aparece la necesidad hasta autorizar la ayuda: menos espera antes de activar el envío. Incluye disponibilidad de información, lectura, comprobación, coordinación, revisión y espera de flota; termina antes de recogida y viaje del envío.', minutes),
  paired(c => c.physical.stages.thresholdContribution.pickupAndPreparationMs.meanMs, 'Recogida y preparación', 'Menos es mejor si conserva las comprobaciones. Autorización → salida con carga; incluye comunicación de la orden, desplazamiento para recoger y carga. No es una fase exclusivamente administrativa.', minutes),
  paired(c => c.physical.stages.thresholdContribution.loadedTravelMs.meanMs, 'Viaje con la ayuda', 'Menos significa que la carga llega antes. Salida con carga → llegada al destino; este trayecto se presenta por separado de la coordinación.', minutes),
  paired(c => c.physical.stages.thresholdContribution.arrivalToServiceMs.meanMs, 'Llegada → recepción útil', 'Menos es mejor. Tiempo para descargar y registrar la recepción física; un camión que llega todavía no cuenta como ayuda recibida.', minutes),
  paired(c => c.physical.sufficient.restrictedMeanMs, 'Espera total hasta recibir ayuda suficiente', 'Menos es mejor. Aparición de la necesidad → recepción de la cantidad requerida. Incluye coordinación, recogida, viaje y descarga.', minutes),
];
const names = { water: 'Agua', food: 'Comida', blankets: 'Mantas' };
const resourceRows = [];
for (const type of ['water', 'food', 'blankets']) {
  const read = c => c.physical.byResource.find(r => r.type === type);
  const labelUnit = type === 'water' ? 'L' : type === 'food' ? 'porciones' : 'mantas';
  const a = read(conventional), b = read(nexo);
  resourceRows.push({ metric: `${names[type]}: cantidad recibida / requerida (${labelUnit})`, conventional: { received: a.usefulServed, demand: a.demand }, nexo: { received: b.usefulServed, demand: b.demand }, displayConventional: `${number(a.usefulServed, 0)} / ${number(a.demand, 0)}`, displayNexo: `${number(b.usefulServed, 0)} / ${number(b.demand, 0)}`, change: a.usefulServed === b.usefulServed && a.demand === b.demand ? 'Igual cobertura' : 'Ver cantidades', meaning: `Ideal: cubrir la demanda sin exceso. Cantidad útil recibida físicamente, no stock prometido. Una unidad representa ${type === 'water' ? 'un litro de agua' : type === 'food' ? 'una porción de comida' : 'una manta'}; no determina por sí sola cuántas personas o familias quedaron atendidas.` });
  resourceRows.push(paired(c => read(c).sufficient.restrictedMeanMs, `${names[type]}: espera media hasta cantidad suficiente (min)`, `Menos es mejor. Espera promedio de los ${a.eligible} puntos con necesidad de ${names[type].toLowerCase()}, desde aparición hasta recibir toda la cantidad requerida. Cada necesidad pesa igual, aunque pida cantidades distintas.`, minutes));
  resourceRows.push(paired(c => read(c).uncoveredUnitMs / 60000, `${names[type]}: faltante acumulado (${labelUnit}·min)`, `Menos es mejor. Combina cuánto falta y durante cuánto tiempo: 10 ${labelUnit} faltantes durante 30 min = 300 ${labelUnit}·min. No mide personas, familias ni daños médicos.`));
}
const totalRows = [
  paired(c => c.physical.sufficient.reached, 'Necesidades cubiertas suficientemente', 'Más, hasta cubrir todas, es mejor. Se completó la entrega física requerida en ese punto; una necesidad puede reunir a varias personas. Nunca equivale automáticamente a una vida salvada.', value => `${value}/${conventional.physical.sufficient.eligible}`),
  paired(c => c.physical.sufficient.rightCensored, 'Necesidades sin suficiencia al cerrar la observación', 'Menos es mejor. Todavía no se había registrado ayuda suficiente al horizonte. Permanecen en el cálculo del tiempo hasta su límite de observación.', value => number(value, 0)),
  paired(c => c.distanceM / 1000, 'Distancia recorrida (km)', 'Menos, con igual cobertura, significa menos recorrido físico para prestar ayuda. Cuenta los desplazamientos de los vehículos, no distancia a pie de beneficiarios.'),
  paired(c => c.fuelMl / 1000, 'Combustible consumido (L)', 'Menos, con igual cobertura, significa menos combustible utilizado por los vehículos. Es consumo del modelo físico, no ahorro monetario medido.'),
  paired(c => c.attentionWorkPersonMinutes, 'Trabajo humano registrado (persona·min)', 'Menos, con igual cobertura, implica menos ocupación de los puestos de atención simulados. Suma duraciones de trabajo registrado; dos personas trabajando 5 min = 10 persona·min. No es tiempo de reloj ni todas las horas laborales de una ONG.'),
  paired(c => c.cost.providerCalls, 'Llamadas reales al modelo', 'Número de solicitudes al proveedor. No es un resultado humanitario; se interpreta junto con cobertura, calidad y costo, no como “menos siempre es mejor”.', value => number(value, 0)),
  paired(c => c.cost.knownCostSubtotalUsd, 'Costo conocido del modelo (USD)', 'Gasto registrado únicamente por inferencia. No incluye combustible, salarios, infraestructura ni costo por vida salvada.', value => number(value, 8)),
  paired(c => c.cost.totalProviderCostUsd, 'Costo total del modelo (USD)', 'Coincide con el conocido porque no hay facturación desconocida en esta pareja. Menos es conveniente sólo conservando calidad y atención.', value => number(value, 8)),
  paired(c => c.cost.unknownCostCalls, 'Llamadas con facturación desconocida', 'Ideal: 0. Indica si el costo total puede afirmarse; no es una medida de ayuda recibida.', value => number(value, 0)),
  paired(c => c.errors.length, 'Errores registrados en el ensayo', 'Ideal: 0. Fallos observados al ejecutar el flujo; ausencia de errores no demuestra seguridad universal.', value => number(value, 0)),
  paired(c => c.invariants.length, 'Reglas de integridad incumplidas', 'Ideal: 0. Reglas de conservación, permisos y estado que el motor detectó como rotas; no reemplaza evaluación en campo.', value => number(value, 0)),
];
const table = rows => '| Métrica | Convencional | NEXO + Gemma 4 | Cambio | Qué representa para la respuesta y las personas que esperan |\n|---|---:|---:|---|---|\n' + rows.map(row => `| ${row.metric} | ${row.displayConventional} | ${row.displayNexo} | ${row.change} | ${row.meaning} |`).join('\n') + '\n';
const coordination = phaseRows[0], overall = phaseRows.at(-1);
let md = `# NEXO: menos espera antes de activar la ayuda

Comparación registrada del 13 de octubre de 2026. Misma semilla, recursos y reglas físicas; 24 necesidades por método. Modelo realmente utilizado: **Gemma 4 31B**.

**Preparar y autorizar la respuesta: ${number(coordination.conventional / 60000, 2)} → ${number(coordination.nexo / 60000, 2)} min, ${number((1 - coordination.nexo / coordination.conventional) * 100, 2)}% menos.** Son ${number((coordination.conventional - coordination.nexo) / 60000, 2)} minutos menos de espera antes de autorizar la ayuda, en promedio por necesidad.

**Ayuda suficiente recibida: ${number(overall.conventional / 60000, 2)} → ${number(overall.nexo / 60000, 2)} min, ${number((1 - overall.nexo / overall.conventional) * 100, 2)}% menos.** Este segundo indicador incluye el recorrido físico. Ambos cubrieron 24/24 necesidades.

## Dos relojes que responden preguntas diferentes

El primero pregunta cuánto tardamos en preparar y autorizar una respuesta. El segundo pregunta cuánto espera el punto afectado hasta recibir ayuda suficiente. Mostrar los dos hace visible el ahorro de coordinación aunque un trayecto largo domine la espera total.

Ejemplo ilustrativo, **no resultado del ensayo**: con un viaje fijo de 20 h, pasar de 2 h de coordinación a 5 min supone **95,83% menos coordinación** y **1 h 55 min de espera evitada**. El total pasa de 22 h a 20 h 05 min: **8,71% menos tiempo total**. Ambos porcentajes son correctos y describen cosas distintas.

## Desglose de tiempos registrados

Todos los tiempos de esta tabla son medias en minutos, con 24/24 etapas observadas por método.

${table(phaseRows)}
La primera fase no mide únicamente cuánto piensa el modelo o cuánto tarda el clic humano: también incluye cuándo se dispone de información, consultas, coordinación, revisión y espera de disponibilidad de flota. La fase de recogida contiene desplazamiento; restar sólo el viaje cargado del total **no** elimina todos los trayectos.

## Qué significa “food mean sufficient, min”

**“Tiempo medio hasta recibir toda la comida requerida, en minutos”. Menos es mejor.** En los ocho puntos con necesidad de comida, la espera pasó de **${number(conventional.physical.byResource.find(r => r.type === 'food').sufficient.restrictedMeanMs / 60000, 2)} a ${number(nexo.physical.byResource.find(r => r.type === 'food').sufficient.restrictedMeanMs / 60000, 2)} minutos**. Se cuenta desde que aparece la necesidad; no desde que sale el camión. Se recibió la misma cantidad útil en ambos: 164 porciones. Las solicitudes de comida quedaron cubiertas **33,58 minutos antes en promedio**.

Si un punto pide 20 porciones y otro pide 40, cada punto tiene un tiempo de suficiencia. La media de tiempos pesa ambos puntos por igual. El faltante acumulado sí refleja tanto la cantidad que falta como su duración.

${table(resourceRows)}
Las mantas tardaron más con NEXO; esa diferencia se conserva aunque agua, comida y el promedio total mejoraron.

## Unidades que se pueden explicar sin inventar beneficiarios

| Unidad registrada | Significado concreto | Qué no se puede deducir sólo con esa unidad |
|---|---|---|
| 1 L de agua | Un litro requerido o recibido | Personas hidratadas o días cubiertos sin una demanda por persona definida |
| 1 porción de comida | Una porción requerida o recibida | Una familia alimentada, un día sin hambre o una persona nutrida sin definir tamaño, nutrición y consumo |
| 1 unidad de blankets | Una manta requerida o recibida | Una familia sin frío o hipotermia evitada sin población, condiciones y asignación definidas |
| 1 porción·min | Una porción faltante durante un minuto | Un minuto de hambre de una persona: son dimensiones distintas |
| 1 manta·min | Una manta faltante durante un minuto | Un minuto de frío de una familia |
| 1 persona·min de trabajo | Un minuto de ocupación de un puesto humano registrado | Un minuto de espera de beneficiarios o un minuto de calendario si trabajan varios en paralelo |

Por ejemplo, si faltan 10 porciones durante 30 min y luego sólo faltan 4 durante 15 min, el faltante acumulado es **10 × 30 + 4 × 15 = 360 porciones·min**. Una entrega parcial reduce el ritmo al que se acumula el déficit, aunque aún no complete la necesidad. No se suman litros·min, porciones·min y mantas·min como si fueran intercambiables.

## Cobertura, recursos y costo

${table(totalRows)}
## Evidencia y alcance

Esta vista se calcula **sin nuevas simulaciones ni llamadas al modelo**, usando los datos ya registrados y sus unidades originales. Cambian títulos, conversiones de ms a minutos/L/km, porcentajes descriptivos y explicaciones; no las decisiones, reglas físicas ni KPIs originales.

Fuente: [lectura cerrada con trazas por necesidad](${sourceLink}), SHA256 \`${inputSha256}\`. Las trazas incluyen autorización, recogida, salida cargada, llegada y recepción. El promedio temporal original conserva necesidades no completas hasta su horizonte; en esta pareja no hay ninguna censurada.

Es una pareja de simulaciones con parámetros humanos declarados; no una medición de una ONG real. No establece cuántas vidas se salvaron. Gemini y el efecto en campo requieren sus propias mediciones. Los resultados históricos de otras versiones permanecen separados.
`;
const travelExcluded = travelExcludedRows[0];
md = md.replace('## Desglose de tiempos registrados', `## Operaciones excluyendo ambos trayectos del envío\n\n**${number(travelExcluded.conventional / 60000, 2)} → ${number(travelExcluded.nexo / 60000, 2)} minutos: ${number((1 - travelExcluded.nexo / travelExcluded.conventional) * 100, 2)}% menos.** Esta lectura auxiliar usa los timestamps ya registrados de los 24 envíos por método.\n\n${table(travelExcludedRows)}\nSe descuenta el desplazamiento a recogida (pickupDispatched → pickupArrived, o 0 si el vehículo ya estaba allí) y el viaje con carga (dispatched → arrived). La transmisión, carga y descarga permanecen dentro, igual que cualquier espera previa por flota ocupada. No sustituye el KPI original de recepción ni mide exclusivamente trabajo intelectual.\n\n## Desglose de tiempos registrados`);
md = md.replace('Una porción requerida o recibida | Una familia alimentada, un día sin hambre o una persona nutrida sin definir tamaño, nutrición y consumo', 'Una porción requerida o recibida; el modelo poblacional supone 700 kcal por porción | Una familia alimentada o un día sin hambre: no hay seguimiento de consumo por persona ni composición familiar');
const presentation = { schema: 'recorded-response-explained-v1', recordedDate: report.date, seed: report.seed, actualModel: report.model.actual, rendererSha256: sha(await readFile(new URL(import.meta.url))), input: { path: relative(process.cwd(), input).replaceAll('\\', '/'), sha256: inputSha256 }, source: report.source, definitions: report.definitions, scope: 'Offline presentation; original measurements and logic unchanged.', travelExcludedRows, travelBreakdown, phaseRows, resourceRows, totalRows };
if (sha(await readFile(input)) !== inputSha256) throw Error('Source changed while rendering.');
await mkdir(output, { recursive: false });
await writeFile(resolve(output, 'readout.json'), JSON.stringify(presentation, null, 2) + '\n', { flag: 'wx' });
await writeFile(resolve(output, 'readout.md'), md, { flag: 'wx' });
console.log(JSON.stringify({ output, sourceSha256: inputSha256, metricsExplained: phaseRows.length + resourceRows.length + totalRows.length + travelExcludedRows.length, coordinationReductionPct: (1 - coordination.nexo / coordination.conventional) * 100, operationsExcludingShipmentTravelReductionPct: (1 - travelExcluded.nexo / travelExcluded.conventional) * 100, totalWaitReductionPct: (1 - overall.nexo / overall.conventional) * 100, providerCallsMade: 0, simulationsRun: 0 }));
