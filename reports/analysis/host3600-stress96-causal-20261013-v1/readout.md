# HOST3600: diagnóstico cerrado de 96 necesidades

Tres mundos cerrados, mismo seed `native-human-capacity-control-stress96-01`, condición `moderate_96`. Lectura exclusivamente del grupo stress96 del bridge cerrado; ninguna medición nueva ni lectura de otros estudios parciales. Endpoint y comparaciones copiados del reader sellado f325 dentro de `reports/sequential-local-finish/current-v4-20261013/bridge-readout.json`, SHA `26452ff2dc22373f1140b310ac4e3b1ba645349f8918cf51139fcfeacc8beeb3`. Las huellas de los tres raws y el helper exacto están en esta carpeta.

## Beneficio con censura conservada

| Brazo | Suficientes / elegibles | Censurados al corte de 3 h | RMST de los 96 casos | Trabajo de atención nativo | Km / combustible nativo |
|---|---:|---:|---:|---:|---:|
| C_manual | 53 / 96 | 43 | 140,7707 min | 968,0 persona-min | 520,50 km / 93,690 L |
| B8, reglas y consultas | 66 / 96 | 30 | 119,2490 min | 53,0 persona-min | 687,50 km / 123,750 L |
| B6, percepción con modelo | 66 / 96 | 30 | 117,9395 min | 53,5 persona-min | 697,50 km / 125,550 L |

B6 obtiene **16,2187% menos tiempo restringido que el manual** y **1,0981% menos que B8**, conservando en el denominador los 43/30/30 casos censurados. No se usa una media de los atendidos para presentar éxito. Primera ayuda útil y suficiente coinciden en esta cohorte; no hubo contribuciones parciales que pudieran ocultar la falta de completitud.

La cobertura B6 es 68,75%, no 100%. B8 y B6 completan 62 necesidades comunes y cuatro diferentes cada uno; dejan 26 pendientes comunes. Frente al manual hay 51 completadas comunes, 15 sólo atendidas por B6 y dos sólo por el manual. El conteo global no significa que todos los edificios mejoraran. Los p95 restringidos son **180 min en los tres brazos**, con censura: no se sustituyen por los p95 de sólo atendidos.

## Cantidades, sin sumar unidades distintas

| Recurso | Demanda | Manual recibido / pendiente | B8 recibido / pendiente | B6 recibido / pendiente |
|---|---:|---:|---:|---:|
| Agua | 1.700 L | 860 / 840 L | 1.040 / 660 L | 1.090 / 610 L |
| Comida | 625 porciones | 320 / 305 | 457 / 168 | 464 / 161 |
| Mantas | 624 unidades | 390 / 234 | 463 / 161 | 444 / 180 |

Todos tienen cero exceso recibido. B6 cubre 21 necesidades de agua, 23 de comida y 22 de mantas; B8 20/23/23. No convertimos 50 L adicionales, siete porciones y 19 mantas menos en un falso balance común.

| Recurso | Ganancia B6/manual en RMST suficiente | Ganancia B6/B8 en RMST suficiente | Reducción B6/manual de integral de déficit | Reducción B6/B8 de integral de déficit |
|---|---:|---:|---:|---:|
| Agua | 11,6836% | −1,4325% | 9,2995% | −3,6869% |
| Comida | 21,5739% | 6,7983% | 22,8818% | 8,3305% |
| Mantas | 15,5599% | −2,1134% | 16,2544% | −0,7716% |

La ventaja pequeña global sobre B8 está acompañada de empeoramiento en agua y mantas. Mantener estos resultados evita presentar sólo el recurso favorable. Las integrales están en L·ms, porción·ms y manta·ms, nunca sumadas entre tipos.

## Etapas temporales: denominadores diferentes

El efecto principal anterior usa los **96** casos. Las siguientes diferencias de etapas sólo existen para los casos físicamente completados por ambos brazos: 51 frente al manual y 62 frente a B8. No imputan etapas a un censurado y no explican por sí solas la diferencia de RMST de toda la cohorte.

| B6 menos referencia, media condicional de completados comunes | Casos observados | Antes de autorizar | Recogida/preparación | Viaje cargado | Total condicional |
|---|---:|---:|---:|---:|---:|
| C_manual | 51 de 96 | −35,3037 min | +0,3350 min | +0,2751 min | −34,6937 min |
| B8 | 62 de 96 | −4,6443 min | +0,0099 min | +0,0470 min | −4,5874 min |

La preautorización mezcla lectura, consultas, interpretación, revisión y espera de disponibilidad de flota. No es tiempo puro del modelo. El patrón es compatible con automatización que adelanta trabajo frente al manual; la comparación con reglas es pequeña y cambia qué necesidades alcanzan el corte. No hay ablación que atribuya 16,22% o 1,10% exclusivamente a GenAI.

## Qué falta físicamente para atender los 30 restantes

B6 emitió 69 órdenes de entrega: 66 con recibo físico completo y tres todavía en curso al horizonte. Dos siguen despachadas, una descargando; **no se acreditan como atendidas**. Son:

- `operation-64`: 20 porciones, vehículo `v-org2-1`, salida cargada a 169,1360 min, sin recibo al corte.
- `operation-66`: 60 L, `v-org3-0`, salida cargada a 168,9749 min, sin recibo al corte.
- `operation-68`: 11 porciones, `v-org1-0`, llegó a 179,0860 min y empezó a descargar; falta el minuto físico de descarga, que termina después de 180 min.

Los otros **27 casos censurados no tienen orden física emitida** en el raw. Se mantienen sin servicio ni tiempos de etapa inferidos. Para 29 de los 30 pendientes existe una actividad de primera consulta registrada; eso es una solicitud, no necesariamente una confirmación actual ni una explicación completa de su falta de orden. El caso restante conserva atribución desconocida.

La escasez global de stock no explica por sí sola el corte: el manifiesto y `engine/world.mjs:147–169` declaran 2.400 L, cuatro pisos de 100 L (2.000 L globalmente utilizables), 800 porciones y 800 mantas, frente a demanda 1.700/625/624. La suma de órdenes B6 es 1.150 L, 495 porciones y 444 mantas. Esto prueba suficiencia inicial agregada, **no** disponibilidad libre del stock de cada dueño en cada instante ni permiso para usarlo sin aprobación.

La limitación dominante observada es completar viajes consecutivos con la misma flota dentro de tres horas. Los ocho camiones B6 realizaron 8–10 órdenes cada uno; comprometieron 20,5752 vehículo-horas y estuvieron moviéndose 18,2908 h, frente a un máximo nominal de 24 vehículo-horas (8×3 h). No hubo viajes fallidos, bloqueo físico ni espera por revisión humana al cierre. Recogida, reposicionamiento, retorno y descarga ocupan al vehículo; tener más litros en un depósito no elimina esas duraciones. B8 tiene un patrón similar: 20,1291 h comprometidas y tres órdenes en curso.

**No se demostró una cota de optimalidad:** 85,73% de compromiso agregado no prueba que cubrir los 30 fuese físicamente imposible con una secuencia mejor. Las trazas no exportan un motivo individual de última compilación para los 27 sin orden, por lo que no se les etiqueta arbitrariamente como falta de stock o de vehículo. Un próximo ensayo legítimo sería planificación compartida de secuencia/reposición con datos recibidos, para todos los brazos. Consolidar múltiples destinos por viaje requeriría un contrato físico común nuevo; no puede inventarse sólo para NEXO ni atribuirse aquí al modelo. Aumentar horizonte o recursos tendría que hacerse igual para las referencias y declararse como otro estudio.

## Atención, inferencia y atribución

El manual completó 779 lecturas, 366 decisiones y 173 relevos, sin tareas pendientes al corte pero con colas previas: p95 al inicio de lectura 31 min, decisión 33,4333 min y relevo 30,4333 min. Los turnaround p95 de completados son 31,5/34,4333/31,9500 min. Máximo backlog individual: 138. B8 y B6 completaron 106 y 107 revisiones respectivamente, a 30 s, sin espera ni tareas pendientes. Revisión ya está dentro de `decide`; no se suma dos veces. El trabajo de atención B6 baja 94,4731% frente al manual y **sube 0,9434% frente a B8**. Son duraciones nativas supuestas, no medidas de empleados, salario o exactitud semántica.

Las primeras solicitudes de la cohorte se asocian así, incluyendo censurados:

| Brazo y origen asociado a primera consulta | Completados | Censurados | Total |
|---|---:|---:|---:|
| B6 parser explícito común | 38 | 15 | 53 |
| B6 recibo real de modelo | 26 | 14 | 40 |
| B6 sin actividad registrada | 2 | 1 | 3 |
| B8 parser explícito común | 17 | 13 | 30 |
| B8 palabras/ubicación y consulta | 49 | 17 | 66 |

Esto describe procedencia de solicitudes, no necesidad del modelo, verdad de las publicaciones o precisión independiente. B6 emitió 164 consultas y B8 456; la consulta adicional de B8 no se etiqueta automáticamente como un falso positivo. El corpus permite a las reglas consultar ubicaciones y obtener confirmación bajo la misma cola finita. El compilador, stock, permisos, vehículos y física son comunes.

B6 utilizó **25 llamadas reales**, coste conocido **USD 0,02180722**, uso desconocido cero y **211,0407 s de HTTP de proveedor**. Hubo tres llamadas superiores al mínimo nominal de 15 s; la mayor fue 18,9787 s y su disponibilidad conserva esa duración real. Los 54 batches de percepción no son 54 llamadas pagadas. No agotó el cap de 32 llamadas o USD 0,15. Se conserva **un error `EXTRACTION_SCHEMA`, batch de 30 fuentes**; los 25 HTTP figuraron completados, lo cual no elimina el error de esquema ni acredita precisión semántica. Invariantes cero.

B6 consume **34,0058% más combustible/distancia que el manual**, que también entrega menos casos, y **1,4545% más que B8** con igual conteo suficiente. No se presenta el mayor combustible como ahorro ni se inventa un coste por una unidad que mezcle recursos.

## Alcance de la afirmación

El resultado respalda una mejora física frente a este flujo manual con capacidad humana hipotética. La ventaja sobre reglas es sólo 1,10% en un seed y no aumenta la cobertura de 66/96: no demuestra mejora sustancial de red neuronal ni capacidad de completar todo a esta carga. No se promedian los grupos 24/48/96, que usan seeds diferentes, para atribuir causalidad a la escala. Se conservan los resultados negativos anteriores y todos los censurados.

Parámetros comunes: 96 necesidades, 768 posts de ruido, dos reposts, reporte formal a 30 min, mapa 13×13 de 6 km, cuatro organizaciones, ocho vehículos, dos clarificadores, 2 lectores/2 decisores/1 relayer por dueño, errores humanos cero y horizonte 3 h. No son tasas calibradas de ONG ni una prueba de pérdidas/silencio nativas. Corpus SHA `1372d7154f03ba2d67c8252d6eb9c753d91335f516dd5ad13ae5572013b6d1dd`; cohorte SHA `e2c8fcd3c7c35aeaff0233e247babafc9cf03cd86beb22af3e66072831be35d8`. SQL/CPU y host se registran aparte del reloj fuente; ninguna suma anidada se convierte en tiempo físico.
