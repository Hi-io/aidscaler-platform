# Cadencia operativa y coste local: diagnóstico previo al cierre del primario

Fecha: 2026-10-13. Auditoría de lectura, sin ejecutar nuevos mundos, sin llamadas al proveedor y sin cambiar fuentes congeladas.

## Alcance de la evidencia

Seis referencias gratuitas están cerradas en `reports/comparisons/1791857386133-primary/primary`. Los tres B6 siguen pendientes en este corte: no hay conclusión comparativa de GenAI. Los seis controles alcanzaron 24/24 necesidades, sin censura física, errores o invariantes. Las tres huellas iniciales/finales coinciden con el freeze declarado `704c8ac… / 5e6a11e… / 2825f94…`.

El lector independiente `.local/read-physical-components.mjs` no importa controlador, harness ni proveedor. El corte `.local/readouts/primary-1791857386133-free-six-closed.json` conserva los nueve resultados declarados, incluidos tres ausentes, y las 24 necesidades de cada mundo cerrado. La primera contribución útil y la última suficiente se vinculan a recibos físicos separados. Los tiempos exactos de confirmación recibida que el informe no exporta permanecen `null`; el ACK de solicitar una comprobación no se presenta como confirmación.

| Mundo | Llamadas al planificador | Revisiones humanas terminadas | Iteraciones exteriores derivadas | Syncs mínimos de cuatro propietarios | Wall del mundo |
|---|---:|---:|---:|---:|---:|
| B5 / 01 | 379 | 176 | 203 | 812 | 8.739 min |
| B8 / 01 | 62 | 0 | 62 | 248 | 3.128 min |
| B5 / 02 | 351 | 167 | 184 | 736 | 7.844 min |
| B8 / 02 | 62 | 0 | 62 | 248 | 3.194 min |
| B5 / 03 | 385 | 181 | 204 | 816 | 7.900 min |
| B8 / 03 | 69 | 0 | 69 | 276 | 2.927 min |

En el runner, cada iteración exterior incrementa `planningTurns` una vez; cada revisión humana terminada incrementa otra vez, incluso si su interpretación no produce una ubicación nueva. Por eso la diferencia permite derivar las iteraciones exteriores en estos mundos completados. Son cotas estructurales: no hay profiler ni contadores SQL por función. La suma de wall de los seis mundos es 33.732 min; no es el wall de campaña, porque dos mundos gratuitos se ejecutaron a la vez.

Los transportes entre socios fueron 337/333/382 en B5 y 350/355/325 en B8. La diferencia grande de wall no corresponde a más entregas materiales entre socios. Hay considerable trabajo local repetido de lectura, reconciliación, serialización y planificación; su proporción exacta requiere instrumentación posterior.

## Trabajo repetido observable en código

1. `evaluation/discovery-benchmark.mjs`, `propagate`, ejecuta sync de cada propietario, lista todas las propuestas, relee cada fila, consulta ejecución para activas, refresca permisos y drena trabajos. Una revisión humana también llama `confirmLocations`; esta función hace sync aun si no emitió una nueva comprobación. Después vuelve a compilar un borrador.
2. `src/ingestion.mjs`, `sync`, ya evita reescribir recursos, operaciones y verificaciones materialmente idénticos. Sin embargo, actualiza el registro de conexión y registra auditoría de sync en cada llamada. Si existe una consulta de mapa ready, hace upsert de geografía aunque su contenido no cambie. El snapshot operacional incluye tiempo y estado amplio: comparar/canonizarlo exige recorrer bastante información recibida.
3. `src/worker.mjs`, `execute`, consulta varios snapshots de fuente y escribe estado/resultados/auditoría de progreso aunque el progreso recibido sea idéntico. La ejecución directa del runner puede coincidir con una continuación ya elegible en el drain. La coalescencia durable actual evita amplificar consecuencias físicas, pero no elimina todo el trabajo repetido de observación.
4. `src/discovery-response.mjs`, `draftReceivedResponse`, recompila allocation y responseQueue; si hay propuesta nueva, repite la compilación y la validación dentro de la transacción. `responseQueue` vuelve a leer necesidades, operaciones, verificaciones, propuestas y seis clases de capacidad/evidencia para formar la firma.
5. `src/planning.mjs`, `allocationPlan`, conserva caché de rutas sólo dentro de una llamada. `shortestRoute` reconstruye adyacencia y ordena su cola para cada ruta nueva. Los swaps y ciclos de asignación son acotados y compartidos por todos los brazos, pero el mismo estado recibido puede volver a provocar la misma compilación en la siguiente revisión vacía.

No se ha medido cuántas transacciones o consultas SQL de cada clase ocurrieron. No se debe convertir este diagnóstico estructural en una cifra inventada de CPU. Los datos de proveedor no incluyen estas repeticiones locales como latencia de inferencia.

## Correcciones comunes candidatas después de cerrar la campaña

- Separar liveness/último sync del estado material. Guardar geografía sólo cuando cambie el mapa recibido; evitar actualizar versiones materiales por un sondeo idéntico. Mantener visibles reloj recibido, cambios de turno/calendario, retiradas, correcciones y permiso caducado.
- Coalescer observación de propuestas por evidencia, revisión y autoridad actuales. Una observación idéntica puede actualizar liveness sin nuevo progress record/material version. Una cancelación, recibo terminal, cargo cambiado, revisión o vencimiento siempre obliga a reevaluar. Preservar lease fencing y recuperación tras reinicio.
- Reusar un snapshot inmutable y una compilación pura dentro de un ciclo; cachear topología/rutas por material recibido de mapa, carreteras, capacidades y peso. Antes de persistir un nuevo borrador o emitir una orden siguen siendo obligatorias la relectura transaccional de versiones, permisos, holds y autoridad.
- Procesar cada revisión humana y cada solicitud de verificación a su tiempo real. Si no cambia ningún lead, recibo, estado operativo, permiso o ventana temporal, omitir únicamente la recompilación redundante. No omitir informes desconocidos ni retrasar comprobaciones de B5/B8 para abaratar la referencia.

Prueba justa posterior: mismos seeds/corpus/física, contador de HTTP/SQL/material writes y wall por clase, ejecución con y sin la optimización común. Comprobar igualdad de órdenes/recibos cuando el estado es igual, recuperación, cancelación, permiso revocado y transición de turno. Acelerar CPU no se presenta como reducción causal de tiempo físico ni como mérito del modelo.

## Si el primario vuelve a ser negativo

La siguiente versión debe separar dos hipótesis. Primero, comprobar el carril operativo concurrente sin cambiar el corpus: mientras el modelo espera HTTP, recibos, revisiones y órdenes ya fundamentadas pueden progresar. Ninguna hipótesis ni acción dependiente del resultado del modelo aparece antes de `max(latencia nominal, HTTP real)`. El `modelBarrier` global exige un protocolo de disponibilidad y watermark correcto; `Promise.race` sin ese cambio no basta. Una fixture de inferencia de 45 s, revisión de 30 s y llegada de un camión existente a los 10 s debe conservar cada disponibilidad, idempotencia, cancelación y reinicio. El mismo carril se ofrece a B5/B6/B8/B9.

Segundo, predeclarar una familia semántica separada utilizando la complejidad existente:

- S01 aporta retorno/calendario/permiso, S03 dependencias de una planta, S19 capacidades y habilidades de propietarios distintos, S04/S22 contexto temporal y unidades. Sus mecanismos son pruebas funcionales de producto; por sí solos no acreditan ventaja del modelo. El texto actual de S01 dice literalmente camión, 300 L, minuto 10 y permiso. S19 estructurado puede resolverlo el compilador común.
- El camino mínimo ya implementable es el de `route-context`: una carga real bloqueada, notas actuales e históricas sobre varias rutas, límites de masa y ventanas recibidos, comprobaciones tipadas y reparación de la misma carga. `source-opportunities` conduce a una comprobación ordinaria, luego su recibo a `checkedRepairPlan`, después a revisión del propietario y servicio físico. El texto no concede disponibilidad, demanda ni autoridad.
- B5 interpreta los mismos mensajes con atención finita y puede consultar cualquier lead grounded; B8 mantiene detección amplia y puede comprobar todas las rutas; B9 tiene el mismo modelo y herramientas. Todos reciben las mismas consultas, colas, calendario, consentimiento y compilador. Si comprobar todo gana, el resultado adverso se conserva.
- Incluir apertura real, rumor falso de apertura, histórico sólo, ventana corta y caso sencillo sin ventaja. Fijar antes de medir variantes, orden, paráfrasis, alias, idiomas, seeds, cuotas y horizonte. No revelar la solución en el prompt ni ocultar informes formales a un brazo. Cuantificar todos los censurados y cada etapa solicitada/recibida/aprobada/servida.

El evaluador `route-context` actual utiliza elapsed de `provider.complete`, incluido bookkeeping, y no el reloj `max(nominal, HTTP real)` del primario. Antes de compararlo en una campaña nueva debe compartir el mismo contrato de reloj. No es una comparación equivalente lista para lanzar durante este freeze.

La familia nueva no sustituye el resultado original ni permite afirmar que la mejora está demostrada. Es una hipótesis posterior distinguible, con baseline competente y controles negativos.
