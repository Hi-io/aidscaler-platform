# HOST3600: tres mundos cerrados del control descentralizado

Lectura autorizada de C_manual, C_decentralized y B6 del mismo seed `native-human-capacity-control-decentralized-01`. Los tres estados son `completed`, las huellas coinciden, cada mundo resolvió 24/24 necesidades y tiene cero errores, invariantes y casos físicos censurados. No se leyeron stress48/stress96. Fuente numérica: `reports/analysis/host3600-decentralized-closed-20261013.json`; cálculos y SHA de cada raw en `readout.json` de esta carpeta.

## Beneficio físico y cantidades

| Brazo | Tiempo medio restringido hasta ayuda suficiente | Operaciones emitidas / recibos físicos | Trabajo de atención simulado | Comunicaciones pendientes al corte de 3 h |
|---|---:|---:|---:|---:|
| C_manual | 43,9069 min | 24 / 24 | 308,5000 persona-min | 0 |
| C_decentralized | 72,7354 min | 64 / 62 | 1.001,3656 persona-min | 1.046 |
| B6 | 32,0222 min | 24 / 24 | 18,5000 persona-min | 0 |

B6 tarda **27,0680% menos que C_manual** y **55,9744% menos que este C_decentralized**. Es un único control emparejado, no una estimación poblacional: las 24 necesidades comparten flota, colas y datos; no son 24 réplicas independientes. El resultado no sustituye a la primaria de tres seeds ni demuestra superioridad sobre todas las ONG.

Todos cubren 340 L, 159 porciones y 168 mantas. C_manual y B6 no tienen exceso recibido; C_decentralized recibe además **530 L, 224 porciones y 296 mantas**. Son cantidades físicamente descargadas por órdenes autorizadas, no supuestos de probabilidad de duplicación. No sumamos litros, porciones y mantas en una falsa unidad común. Las 62 operaciones con recibo positivo tampoco equivalen a 62 beneficios útiles; las otras dos órdenes siguen despachadas al corte y no se acreditan como entregadas.

| Recurso | Mejora B6/C_manual en tiempo suficiente | Mejora B6/C_manual en integral de déficit nativo | Mejora B6/C_decentralized en tiempo suficiente |
|---|---:|---:|---:|
| Agua | 25,0758% | 23,4628% | 58,2076% |
| Comida | 50,3341% | 51,5341% | 65,3893% |
| Mantas | 2,8406% | 10,6184% | 44,1989% |

El resultado positivo de mantas aquí no elimina el resultado primario negativo de mantas. B6 recorre 185,25 km y consume 33,345 L de combustible frente a 177,75 km/31,995 L de C_manual: **4,2194% más** en ambos. Frente a C_decentralized, 712,50 km/128,25 L, es 74% menos. Son agregados nativos de todos los vehículos, no coste monetario ni una atribución por recurso.

## Causa temporal observada

Las diferencias se calcularon para la contribución que completa cada necesidad, con los timestamps físicos reales; no son diferencias de offsets acumulativos.

| B6 menos referencia, media por necesidad | Antes de autorización | Recogida y preparación | Viaje cargado | Total |
|---|---:|---:|---:|---:|
| C_manual | −12,3882 min | +0,4427 min | +0,0608 min | −11,8847 min |
| C_decentralized | −39,2896 min | −0,3385 min | −1,0851 min | −40,7132 min |

La mayor ventaja está **antes de autorizar**, no en vehículos artificialmente más rápidos. C_manual requiere lectura, integración y relevos finitos; B6 automatiza gran parte de ese flujo y conserva las revisiones del dueño. Ambos compilan con el mismo asignador determinista recibido. La reducción frente al control manual incluye automatización, disponibilidad de información y coordinación; no puede atribuirse íntegramente al razonamiento del modelo.

En B6 la primera consulta de 12 de los 24 edificios está asociada a un recibo real del modelo y la de otros 12 al parser explícito común. Esa asociación no demuestra necesidad del modelo ni precisión semántica. Hubo **7 llamadas reales a Gemma**, USD **0,00803654**, cero uso desconocido y 55,0180 s de HTTP de proveedor acumulados. Los 23 batches de percepción no son 23 llamadas. Las respuestas llegaron antes del mínimo declarado de 15 s por llamada; su disponibilidad virtual respeta el máximo entre ese mínimo y el HTTP real. No hubo ablación que aislara el beneficio incremental de esas siete llamadas.

## Qué explica y limita el control descentralizado

`evaluation/human-capacity-benchmark.mjs:385–435` manda la demanda integrada a todos los socios y comunica cambios materiales de cada operación a otros tres dueños. Cada organización planifica su capacidad propia. Los intentos recibidos quedan registrados, pero no se convierten en un acuerdo que evite otra orden antes de conocer la entrega. La desactualización de ese flujo sí produjo entregas duplicadas físicas.

La fuente usa mensajes acotados de hechos propios, no snapshots completos de toda la organización (`engine/human-capacity.mjs:65–91`). El problema aquí es frecuencia, volumen y coordinación del flujo, no un payload mágico deliberadamente gigante. No está medido como la mejor coordinación convencional posible: coalescer estados pendientes, compartir hitos útiles o negociar intención antes de ejecutar podría mejorar este control sin necesitar GenAI.

Al corte físico de 3 h, C_decentralized registra **1.506 tareas de relevo**, 460 completadas, 1.042 en cola y 4 trabajando. La cobertura de ayuda completa no implica recuperación de la cola. La espera p95 al **iniciar** los relevos es 139,8667 min sobre 464 iniciados; el turnaround p95 de los **460 completados** es 140,4000 min. Los 1.046 pendientes siguen censurados: no se les atribuye un tiempo de finalización ni un incumplimiento de deadline inexistente. Máximo backlog individual de una organización: 319, frente a 53 manual y 1 B6.

El trabajo de atención baja 94,0032% frente al manual y 98,1525% frente al descentralizado, bajo las duraciones y dotaciones declaradas del simulador. Se suma trabajo realizado una vez, incluyendo revisión dentro de `decide`; no se añade revisión de nuevo, ni se convierte espera en trabajo, ahorro salarial o productividad humana real. Tampoco se equipara resolución física con interpretación independientemente correcta.

**Aclaración de un nombre del helper auxiliar:** `readout.json.actualNativeStages.*.completedQueueP95Ms` copió el campo nativo `startedQueueMs.p95`. Su nombre auxiliar es inexacto y no debe presentarse como p95 sólo de completados. Los denominadores correctos se detallan arriba y en los raws inmutables. `finishedP95Ms` sí corresponde al turnaround de completados. El reader y companion sellados no se modificaron.

## Host, histórico y referencias que se conservan

C_decentralized usó 1.042,04 s de host, 19.716 HTTP y 180.965 SQL; el tramo de ingestión/revisión/ejecución sumó 781,05 s. Los tiempos de fases, HTTP y SQL están anidados o solapados y no se suman como CPU exclusivo ni como tiempo físico. La duración de host sólo es una limitación operativa adicional; la comparación física usa el reloj fuente.

HOST900 queda conservado con su `wall_limit`, no convertido retrospectivamente a éxito. Su C_manual tiene el mismo vector físico y RMST que el actual; C_decentralized tiene el mismo RMST suficiente, pero el controlador nuevo alcanzó cuatro órdenes adicionales y 70 L/28 mantas más de exceso después: no son raws idénticos. B6 actual hizo una llamada más y su RMST es 15 s mayor. No se mezclan las dos versiones de host como seeds adicionales ni se estima un efecto causal del límite de host con dos ejecuciones del modelo.

La primaria de tres seeds se conserva: **18,0211% de mejora frente al manual, 7,7623% más lento que B5 y resultados mixtos frente a B8**, con mayor combustible frente al manual. Este control complementa esa evidencia; no la borra. Las tasas/duraciones humanas son supuestos experimentales, no mediciones de ONG; el dato físico es una simulación, no vidas salvadas. Faltan validación de campo y una comparación que aísle necesidad semántica para afirmar una ventaja específica de GenAI.
