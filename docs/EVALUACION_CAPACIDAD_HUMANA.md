# Colas humanas nativas y comparación física — protocolo previo a resultados

Estado: implementación integrada; primaria de doce mundos cerrada, controles secundarios en ejecución. El protocolo y los smokes estructurales anteriores se conservan a continuación. [Resultados físicos actuales y sus límites](RESULTADOS_CAPACIDAD_HUMANA.md): 18,02% de mejora frente al flujo manual declarado, derrota frente a B5 y contraste mixto con B8. Esta familia no reemplaza los negativos ya cerrados del benchmark original ni los controles convencionales fuertes. Un resultado favorable aquí no demuestra productividad humana real, eficacia clínica ni realismo independiente del simulador.

## Qué cambia y qué conserva

El motor recibe comandos `human_work` para lectura, integración/decisión y comunicación. Cada propietario tiene pools finitos; el trabajo espera su turno y devuelve un snapshot factual sólo al terminar. Un relay sólo es utilizable después de trabajo y entrega real por el canal normal. El snapshot puede contener un post público o una necesidad ya observada por su dueño. El motor no interpreta textos, inventa necesidades, certifica seguridad, genera planes ni concede aprobación. Los valores son supuestos experimentales explícitos.

La revisión de acciones físicas sigue siendo una orden humana separada y consume el mismo pool nativo de decisión en TODOS los brazos. Un recibo de `human_work` jamás equivale a aprobación, reserva, despacho o entrega. La plataforma conserva sus validaciones de stock, permisos, turnos, transporte, cantidad y versiones. Los viajes, carga, descarga, consultas y servicio físico conservan los mismos tiempos y recursos por seed.

| Brazo | Procesamiento y coordinación | Autoridad y servicio |
|---|---|---|
| `C_manual` | Lectores distribuidos por hash del ID público: lectura terminada → triage competente. Sólo un lead accionable requiere integración y, si el lector es remoto, relay real hacia coordinador. Se integra la necesidad recibida y se comunica únicamente a los socios cuya capacidad selecciona el compilador común. | Mismo planificador competente después del trabajo humano; capacidad propia no exige handoff a socios; revisión humana independiente por dueño; ejecución física normal. |
| `C_decentralized` | Cada equipo integra su información y demanda recibida; remite necesidades, intenciones y estado operativo factual mediante trabajo y canales nativos. | Cada equipo compila sólo stock/flota propios y recibe exactamente las mismas revisiones/guardas físicas. Los recibos de estado de socios evitan trabajo redundante cuando llegan; se conserva la posibilidad real de snapshots desactualizados. |
| `B5` | Parsing explícito gratis, lectura humana nativa finita para el resto, consultas automáticas bajo política aprobada y planificador compartido. | Mismas revisiones y físicas. No se le impone integración o relay manual artificial. |
| `B8` | Cribado amplio gratuito por palabras y localización pública, consultas automáticas y planificador compartido. | Referencia automatizada fuerte que puede empatar o ganar; mismas revisiones y físicas. |
| `B6` | Percepción real del modelo en batches compactos de 30 fuentes; consultas automáticas acotadas de hipótesis recibidas y planificador común. | No se añade trámite humano antes de cada query. Mismas revisiones y físicas. Cálculo/logística deterministas no se atribuyen a GenAI. |

La distribución manual es una definición reproducible de este flujo: cuatro organizaciones, fuente asignada por `sha256(ID público) % 4`; owner0 conserva su integración local y los otros tres remiten su snapshot a owner0. No se usan IDs de necesidades verdaderas, etiquetas privadas, fuentes futuras ni resultados del scorer para asignar lecturas. La recepción de los bytes y su lectura terminada se registran por separado. Los datos oficiales recibidos también requieren integración nativa en `C_manual` antes del draft; en `B5/B8/B6` siguen siendo entradas estructuradas procesables gratuitamente.

## Condiciones predeclaradas

Cada condición usa exactamente la misma seed, corpus, informes formales, cuatro organizaciones, stock y flota en los cinco brazos. Los parámetros completos normalizados del motor se conservan en el manifiesto.

| Condición | Pools por propietario | Lectura / decisión / relay | Carga de fondo por propietario/hora | Error intrínseco |
|---|---|---|---|---|
| `zero` | 2 / 2 / 1 | 0 / 0 / 0 | 0 / 0 / 0 | 0 |
| `moderate` | 2 / 2 / 1 | 30s / 60s / 90s | 0 / 0 / 0 | 0 |
| `burst` | 2 / 2 / 1 | 30s / 60s / 90s | 360 / 120 / 60 tareas | 0 |
| `moderate_error_1pct` | 2 / 2 / 1 | 30s / 60s / 90s | 0 / 0 / 0 | 100 puntos base = 1%, mismo mecanismo también en reviews humanas de NEXO |
| `fast_read_5s` | 2 / 2 / 1 | 5s / 60s / 90s | 0 / 0 / 0 | 0 |
| `readers8` | 8 / 2 / 1 | 30s / 60s / 90s | 0 / 0 / 0 | 0 |
| `moderate_48` | 2 / 2 / 1 | 30s / 60s / 90s | 0 / 0 / 0 | 0;48 demandas/384 fuentes de ruido |
| `moderate_96` | 2 / 2 / 1 | 30s / 60s / 90s | 0 / 0 / 0 | 0;96 demandas/768 fuentes de ruido |

Estas tasas NO son observaciones empíricas de trabajadores de emergencia. La sensibilidad del 1% se declara antes de resultados. El motor determina sus lapsos usando seed + propietario + etapa + referencia original + ordinal, sin nombres de brazo ni contadores globales influenciados por el orden de llamadas. Las tareas de fondo consumen su pool real y no crean comunicaciones falsas ni ayuda. El perfil cero mantiene la revisión física finita previa; sólo elimina el trabajo manual adicional.

Los casos fallidos o inconclusos permanecen visibles. Se permite como máximo un segundo intento de cada etapa inconclusa de lectura/integración/relay. No se interpreta el snapshot original del store para saltarse una tarea pendiente o perdida. Las consultas de necesidad usan `requestReceivedInquiry` compartido como foreground, igual que la referencia `B8` existente; las consultas de fondo, si las hay, tienen un máximo2. Una comprobación pendiente de igual alcance se reutiliza; la capacidad física de consulta no aumenta para el modelo.

## Escenario, límites y relojes

Plan inicial: 24 necesidades heterogéneas y 192 fuentes de ruido, dos reposts por publicación, directorio público, informes formales a los 30 minutos, cuadrícula9/extensión6km, horizonte fijo3h, dos clarificadores, pump común60s con despertar anterior por `readyAt` nativo propio recibido. La seed inicial es `native-human-capacity-01`. Antes de resultados se declaran además48/384 y96/768 como estrés, manteniendo cuatro organizaciones y los recursos físicos del preset sin topups. El96 usa cuadrícula13 para contar con suficientes edificios residenciales distintos; la misma geometría se aplica a todos sus brazos y se compara sólo dentro de esa condición. No se declaran cientos de problemas arbitrarios complejos ni se regalan recursos para servirlos. Los controles de lectura5s y8lectores prueban si una diferencia dependía del supuesto de30s o de la capacidad de lectura. El burst con carga de fondo adicional es estrés separado, no el primario representativo.

Hay cuatro relojes distintos: publicación; recepción HTTP y trabajo humano nativo; disponibilidad del modelo; servicio físico confirmado. El `providerWallMs` real se cobra como mínimo por encima de la latencia modelada declarada. SQL, serialización y renderizado permanecen tiempos wall del host, nunca multiplicados por la escala de simulación. La espera por colas se deriva del motor, no de una suma evaluadora fija por consulta.

El controlador puede despertar antes del pump cuando un ACK o snapshot propio recibido declara el `readyAt` del trabajo humano. No lee el calendario privado de eventos para acelerar un brazo. El compilador y la previsualización de handoff se reutilizan mientras la firma material recibida y los IDs integrados no cambian; ingesta, revisión, ejecución y tareas desconocidas siguen recibiendo atención en cada pump. El triage no etiqueta como falsa una fuente ambigua: retiene el recibo y sólo evita un trámite adicional cuando la interpretación competente no encuentra una pista de necesidad actual localizada.

La versión3, predeclarada antes de campañas, evita descargar cuatro veces un mismo feed que sólo consume el store del coordinador. Los lectores distribuidos siguen obteniendo su snapshot auténtico de la fuente mediante su propio comando nativo; la recepción de operaciones, trabajo humano y permisos por cada dueño se mantiene. El profiler informa llamadas/tiempo total/máximo por fase, ruta HTTP y consultas instrumentadas del store; no convierte host wall en tiempo físico y advierte que no cuenta queries internas del cliente transaccional. Los pumps15s de los smokes previos se conservan y no se usan como un benchmark contra la versión3. La disponibilidad efectiva del controlador de modelo se registra aparte del `availableAt` nativo declarado, que no incorpora toda latencia HTTP real; no se transforma ese timestamp nominal en prueba de disponibilidad causal exacta.

El controlador termina sólo por horizonte fijo, límite wall, stop explícito o error. No observa la verdad global de necesidades para decidir que ya ganó. El scorer usa esa verdad sólo después de ejecución. Si se detiene el controlador, las órdenes ya emitidas pueden completar físicamente hasta el horizonte, y ese estado se diferencia del cumplimiento del controlador.

El primario se declara separado:24 demandas/192 fuentes de ruido, condición moderate, tres seeds nuevas `native-human-capacity-primary-01/02/03`, cuatro brazos `C_manual/B5/B8/B6`,12 mundos. No reutiliza la seed del smoke mecánico para escoger un caso favorable. Cada seed conserva todos sus brazos, fallos y censurados. Las ocho condiciones de sensibilidad y `C_decentralized` forman otro plan predeclarado de40 slots con una seed, solicitado mediante `--family=sensitivity`; no se añaden después para sustituir un primario negativo.

Presupuesto: máximo16 llamadas primarias,24 en48/384 y32 en96/768; USD0.15 por episodio de modelo y USD0.50 total inicial, orquestación pagada secuencial. Cada episodio reserva su cap completo antes de iniciarse; el uso conocido se reconcilia y los costes desconocidos conservan reserva. Un fallo no se convierte en0 llamadas/coste. No se eleva el cap para una respuesta favorable ni se reduce el último cap para entrar en el presupuesto. Los controles sin modelo tienen un proveedor que rechaza cualquier inferencia accidental. Los12/40 slots predeclarados no son autorización para lanzar mundos: primero se revisan preflights gratuitos y root coordina cualquier estudio pagado.

## Qué medimos

Primario: tiempo fuente hasta servicio suficiente, RMST al horizonte, incluyendo todas las necesidades censuradas. Secundario: primer servicio útil, backlog/espera/trabajo completado por etapa y propietario, tiempo entre datos recibidos e interpretación utilizable, consultas pendientes/reutilizadas, recepción real de relays, faltantes por recurso, sobreabastecimiento real, distancia/combustible y utilización nativa disponible. Litros, porciones, unidades y plazas permanecen separados; ninguna unidad se convierte en vidas salvadas.

El funnel K16 usa propuestas/reviews/órdenes/recibos físicos exactos en todos los propietarios después de ejecución. La aprobación no suma servicio. El log completo de colas y relays, uso del proveedor, errores, invariantes, propuestas pendientes y operaciones físicas quedan en cada outcome. La duplicación sólo se informa si ocurrió realmente en las órdenes/recibos/stock; dos entregas parciales a la misma necesidad no se etiquetan automáticamente como duplicación. `C_manual` conserva el coordinador competente. En el control adicional `C_decentralized`, los estados de operación son snapshots source-owned exactos, recibidos realmente, versionados y namespaced por dueño; sólo estos pueden ajustar pendientes/recibos del planificador. Las intenciones se muestran como información, sin inventar reservas, entrega ni autoridad. Cero duplicados observado sigue siendo cero, no una prueba de que toda comunicación distribuida sea perfecta.

Sólo se compara un par completo con mismos corpus, protocolo, candidato/evaluador/motor, invariantes vacíos y final de fuentes sin cambios. Los errores recuperados y resultados de fallback permanecen dentro de la comparación; no se seleccionan sólo llamadas exitosas. Se bloquean comparaciones de mundos fallidos/interrumpidos, faltantes, builds distintos o invariantes rotas. Se conservan NEXO más lento que `B5/B8`, controles cero y toda tasa de censura. Un efecto frente a `C_manual` puede atribuirse al flujo automatizado completo bajo estos supuestos; el aporte generativo requiere el contraste separado contra `B8`, no basta demostrar que el flujo manual tarda más.

Cada outcome guarda además los bytes públicos exógenos de la familia y su hash exacto, obtenido únicamente en el scorer posterior. La selección privada de autoría separa el corpus inicial de los posts de progreso que legítimamente dependen de las acciones; ni esa selección ni su hash se envían al controlador/modelo. Un manifiesto igual sin los bytes/hash o sin los tres hashes finales exactos no basta para habilitar comparación. Las diferencias reales de feedback y comunicación posterior se mantienen como resultado del brazo.

## Ejecución y reproducción

Sin lanzar mundos ni proveedor:

```
node --test tests/human-capacity-benchmark.test.mjs
node scripts/human-capacity-campaign.mjs --plan
```

Sólo tras GO explícito del root y nueva congelación verificada:

```
node scripts/human-capacity-campaign.mjs --run=ROOT_GO_HUMAN_CAPACITY --freeze=reports/measurement-freeze-current.json --stop-file=.local/STOP_HUMAN_CAPACITY
```

El runner exige full suite y UI sellados con las tres huellas actuales, un lock compartido con las campañas anteriores, guarda protocolo y bytes de runner/evaluador ANTES del primer outcome y procesa un solo episodio a la vez. Usa huella combinada de evaluador y archivos nuevos, además de huella base del gate. Todos los slots previstos se conservan como faltantes si se aborta o acaba el presupuesto. No borrar stopfiles ni sustituir fallos por nuevas seeds. La ejecución o un modelo posterior requieren nuevas mediciones; este documento no contiene resultados comparativos.

## Diagnóstico estructural previo, conservado

`reports/human-capacity-smoke/1791862245383` conserva sin editar el primer smoke de cuatro demandas, ocho fuentes de ruido, informe formal a5min y horizonte30min. Los controles manuales fallaron antes de crear trabajo humano; `B8` recibió físicamente4/4 demandas pero llegó al límite wall90s del host. Se detectaron dos defectos del evaluador nuevo: enviaba `ttlMs` también en read/decide, rechazado por el contrato nativo, y el spread de integridad final podía borrar errores runtime. El JSON anterior no conserva la excepción y no se rellena retrospectivamente con una causa inventada. El guard del contrato y un test de preservación de errores confirman ambos defectos de código por separado.

La versión2 predeclaró una repetición con igual seed/horizonte/recursos en los tres brazos y cap común180s; añadió triage competente de ruido y handoff sólo a dueños seleccionados por el planificador recibido. `reports/human-capacity-smoke/1791862573655` conserva los tres outcomes: los dos manuales completaron4/4; `B8` completó físicamente4/4 pero el guard final detectó cambio del motor durante su ejecución y lo marca `invalid_simulator_changed`. No se habilita una comparación de ese conjunto.

La versión3 se declaró antes de su último smoke, con pump común60s, despertar por recibos propios `readyAt`, un único feed consumido y profiler; horizonte/seed/stock/flota y cap180s se conservaron. `reports/human-capacity-smoke/1791863540413` cerró los tres controles: todos `completed`,4/4 demandas con servicio físico, cero errores/invariantes/inferencia/coste, sin trabajo humano pendiente. Mantuvieron el mismo candidato `9b4de8b…34e3`, evaluador combinado `b050d21e…fe4f` y motor `561e6a02…e94b`, iniciales y finales. Los20 posts públicos exógenos tienen el mismo hash `e19d00ee…c8515` en los tres brazos.

| Smoke estructural v3 | Host wall | Lecturas / decisiones / relays terminados | Servicio físico | Exceso nativo |
|---|---:|---:|---:|---|
| C_manual |41.53s|19 /13 /8|4/4|0|
| C_decentralized |67.22s|22 /25 /174|4/4|40L de agua y34 porciones; ocho órdenes recibidas realmente|
| B8 |32.19s|0 /0 /0 tareas manuales adicionales; reviews físicas conservadas|4/4|0|

El coste host dominante es refrescar recibos/revisar/ejecutar por dueño:22.4s en C_manual y38.6s en C_decentralized. El cambio de cadence reduce wall frente a los smokes anteriores, pero cambia también tiempos de reacción; no se presenta como una ganancia física ni generativa. Los174 relays del control descentralizado proceden de broadcasts de necesidades/intenciones/hitos; su carga futura a90s por relay es una hipótesis secundaria explícita y no una medición de prácticas reales. El coordinador central competente evita ese multicast innecesario.

El funnel K16 actual vincula todo recibo físico positivo y puede llamar “useful” a un recibo redundante después de ayuda previa. En estos readouts se interpreta únicamente como linkage físico positivo y se acompaña del exceso/deficiencia por unidad; ocho recibos positivos no significan ocho asignaciones necesarias ni calidad semántica. El smoke prueba el mecanismo de colas, autoridad y servicio; sigue pendiente la campaña primaria de12 mundos y todos sus controles de impacto.
