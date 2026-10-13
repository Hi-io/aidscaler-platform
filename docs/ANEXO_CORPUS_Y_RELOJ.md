# Límites del corpus y del reloj antes de la comparación nueva

Auditoría previa a resultados, 13 de octubre de 2026. Complementa `DIAGNOSTICO_TEMPORAL_ORIGINAL.md`; no reemplaza sus negativos ni acredita una ventaja de la versión nueva. Se revisó código congelado y se ejecutó únicamente un ejemplo puro del parser: sin mundos, proveedor, pagos o modificaciones de fuentes. La comparación pendiente usa candidato `704c8ac21aba087f8732c5d9d6a413c50284c5caa5f573e24a2cc891d9450c1e`, evaluador `5e6a11ecae88648e491fe680fd7ae7407d00e12622b244c021dd5d9e661bbeab` y simulador `2825f94dffbf6db2835c05170ea00d9225863e4955682debd6236c4c71454b4e`.

## 1. Qué información adelanta de verdad cada referencia

`evaluation/conventional-source.mjs` consulta únicamente texto, metadatos recibidos y directorio público. No lee necesidades privadas, etiquetas de verdad, eventos futuros ni el manifiesto del scorer. Por tanto, el parsing gratuito **no es un oráculo de verdad física**. Sí es más amplio que «formulario estructurado» y el corpus hace muy fácil dirigir la misma comprobación sin resolver todo el significado.

Ejemplos derivados literalmente de `generators/response-benchmark.mjs:45–55`, usando una localización pública conocida y demanda contextual de 30 porciones o mantas, o 50 L:

| Mensaje recibido | Parser gratuito común | B5 tras lectura finita | B8 gratuito | Qué determina después la ayuda |
|---|---|---|---|---|
| Petición explícita de 30 porciones | Candidato de comida, 30 porciones | Mismo candidato | Candidato de comida | Clarificación de la localización y demanda recibida |
| 45 personas y **15 porciones disponibles**, petición del faltante | Candidato de comida con **15**, confundiendo stock con demanda | También retorna ese candidato | Candidato de comida sin cantidad | El runner usa la localización, no ese 15; la clarificación devuelve la demanda real de 30 |
| Siete recipientes de diez litros solicitados, dos ya recibidos | No cantidad explícita reconocida | Candidato de agua sin cantidad | Candidato de agua | No hace falta resolver 7−2 para pedir la comprobación |
| 42 personas y doce mantas, referencia a vídeo viejo de refugio vacío | No candidato explícito | Candidatos de mantas y refugio | Los mismos tipos como hipótesis | Deduplicación por edificio: una comprobación devuelve la demanda real |

El caso de comida revela un defecto semántico del helper: `quantityFor` encuentra el único número seguido de «meal portions» y `parseExplicitCurrentRequest` lo etiqueta como cantidad de necesidad. No es una extracción correcta del faltante. Hoy `confirmLocations` (`evaluation/discovery-benchmark.mjs:216`) sólo usa `location` y nunca autoriza suministros desde esa cantidad; `DiscoveryResponse` compila necesidades estructuradas recibidas (`src/discovery-response.mjs:456`). No hay evidencia de una entrega incorrecta por ese 15 en este runner. Antes de reutilizar el helper como cantidades operativas debe distinguir «pedido», «ya recibido» y «stock disponible», o dejar cantidad desconocida. La corrección tendría que ser compartida por todos los brazos y conservar la hipótesis pertinente de comida; no retrasar sólo al convencional para crear una ventaja.

La independencia de herramientas importa más que acertar la resta en este corpus: la clarificación ordinaria devuelve la necesidad actual completa. B8 puede dirigirla con una palabra de recurso y la localización. Encontrar antes una cifra que después todos reciben de la misma fuente puede no cambiar el servicio físico.

## 2. Lo que los formatos y el ruido todavía no representan

El generador actual reproduce siempre el ID literal del edificio dentro del texto, incluso cuando quita la etiqueta geográfica. Todos los mensajes están en inglés. `tweet/text/audio/photo/video` son formatos de publicación, pero el texto de la petición está reproducido en el post y `mediaDescription` declara que no hay bytes multimedia. Este benchmark no demuestra ASR, OCR, comprensión de vídeo ni lectura multilingüe; esos mecanismos deben acreditarse con sus fixtures independientes y sus costes reales.

El ruido procede de cuatro plantillas repetidas:

- `ARCHIVE` contiene una etiqueta histórica inequívoca. El runner común lo mantiene fuera de la lectura semántica automática antes de B5/B6/B8/B9.
- Apoyo sin contenido operacional puede pasar por el filtro común estricto si no tiene adjuntos. Lo ambiguo o multimodal sigue en la cola.
- El rumor de «every family ... evacuated» no activa los patrones del detector de recurso y no elimina ninguna necesidad. En la prueba pura B5 lo conservó como incertidumbre, no como corrección confirmada.
- «Supplies and transport ... no quantity ...» sí produce un candidato B8 de transporte. La comprobación extra puede consumir una cola real; no es una multa añadida al baseline.

Las fuentes originales de las 24 necesidades se publican entre 15 y 61 segundos. El runner avanza inicialmente a 60 segundos y después hace las consultas iniciales. La mayor parte del conjunto ya ha llegado antes de la primera percepción. Hay información desorganizada en volumen, pero poca dependencia temporal entre fuentes o nuevas decisiones durante la llegada.

Más mensajes de esas mismas plantillas evalúan throughput y atención. Por sí solos no representan la decisión compleja prometida: compatibilidad, rutas del cargo actual, turnos, consentimiento, vencimiento, compromisos próximos o combinación entre organizaciones. No debemos presentar 768 mensajes como una prueba de esas capacidades.

## 3. Dónde todavía puede perder tiempo el producto

El negativo original no fue falta de detección: algunas consultas se adelantaron unos 14 minutos, pero la ventaja media de servicio de ese grupo fue sólo 1,16 minutos. Para necesidades con la misma consulta inicial, B6 fue unos 4,40 minutos más lento. La descomposición completa y los límites del proxy están en el diagnóstico original.

Tres mecanismos siguen siendo candidatos legítimos, no causas demostradas de la próxima campaña:

1. **La tanda de percepción ocupa el controlador.** El runner hace `propagate` y un borrador común antes de `await app.discovery.run`, pero durante esa espera no vuelve a ingerir recibos, continuar revisiones ni emitir nuevas acciones. Al finalizar el modelo el mundo alcanza su disponibilidad actual y recupera la física pendiente; que un camión avance no significa que el controlador haya reaccionado a un recibo intermedio. `Worker.drain` también procesa secuencialmente los jobs dentro de un proceso. Falta medir cuánto tiempo físicamente útil se pierde por esta dependencia, con revisión y autoridad intactas.
2. **La información cambia oleadas irreversibles de flota.** El allocator común mejora intercambios de dos/tres asignaciones en la tanda recibida, pero no optimiza una secuencia completa de próximos viajes. Una necesidad detectada antes puede ocupar un camión cuyo pickup es lejano o desplazar una asignación mejor. Sólo usar liberaciones, ubicaciones, demanda y ventanas ya recibidas; ninguna necesidad futura privada ni camión ocupado ficticiamente libre. Cualquier mejora del solver debe estar disponible en B5/B6/B8/B9 y no cuenta por sí sola como ventaja semántica.
3. **Trabajo semántico sin una decisión disponible.** Una cola cronológica de hasta 30 fuentes puede incluir nuevas incertidumbres mientras todas las capacidades pertinentes están comprometidas. El filtrado de recibos correlacionados ya evita parte del trabajo repetido, pero no equivale a resolver la saturación. Priorización por cambios recibidos que puedan abrir una comprobación/decisión, con backlog y antigüedad visibles; no descartar fuentes desconocidas ni cobrarles cero. Debe medirse coste por recibo útil y servicio, no sólo llamadas o propuestas.

El flujo nuevo ya corrige continuidad, reservas, revisión pendiente, holds, masa/cabina, turnos y varias rutas físicas. Eso puede mejorar la ingeniería común frente al histórico. No garantiza una ventaja adicional de B6 frente a referencias igual de corregidas.

## 4. Qué reloj es canónico y qué timestamp es sólo nominal

`SemanticIngestion` usa `response.usage.wallMs` finito y no negativo cuando el proveedor lo declara; conserva por separado el elapsed de `provider.complete` y su overhead. En `OpenRouterProvider` el wall de éxito cubre el HTTP real y termina antes del bookkeeping de uso completado. Si el proveedor no declara una duración válida —incluidos errores sin ese dato— usa elapsed observado conservador, explícitamente rotulado como fallback; no inventa cero ni una separación HTTP/SQL que no conoce.

El wrapper de `evaluation/discovery-benchmark.mjs:151–164` adelanta el mundo al máximo entre latencia nominal de 15 s y duración declarada/observada. Esta corrección ocurre **antes** de devolver control a interpretación, consultas y borradores. La comparación física conserva ese coste. Sin embargo, devuelve también el receipt nominal anterior, cuyo `availableAt` fue creado por el simulador al programar el resultado nominal.

| Campo | Alcance correcto |
|---|---|
| `semantic_receipt.interpretedAtSourceClock` | `modelReceipt.availableAt` nominal. Cuando HTTP >15 s, puede preceder a la disponibilidad actual. No usarlo solo como timestamp exacto de interpretación disponible |
| Actividad `model-discovery.availableAt` / `general-agent-discovery.availableAt` | `w.now` después de completar el lote y sus pasos; límite superior real del lote, no fin exacto del HTTP ni confirmación independiente |
| Evento `benchmark_model_wall_charged.worldAvailableAt` | Mundo al terminar la carga temporal del modelo; límite por request HTTP/nominal, puede ser posterior si otro trabajo ya avanzó el mundo |
| `verification.receivedAtSourceClock` | Momento de ingestión del cambio material realmente recibido; no ACK ni fecha de trabajo final en la fuente |
| Operación física `createdAt`, `times.authorized/received/service` | Reloj real del mundo cuando la fuente crea la operación o aplica esos eventos |
| Auditoría, creación y autorización local de propuesta | Wall local de DB/aplicación. Mantener separado del reloj físico; no restarlos |

**K16 no consume `interpretedAtSourceClock`.** `evaluation/proposal-funnel.mjs:46` toma `createdAtSourceClock` de `operation.createdAt` autoritativo, no de la semántica o de la creación local. La fuente fija creación/autorización de dispatch con `w.now` y registra servicio al aplicar el evento físico. El collector vincula dueño, acción, ID, cantidades y recibo independiente; exige creación finita y servicio posterior, y no confunde aprovisionamiento/evaluación/pago con ayuda útil. Las revisiones locales quedan como `atWallClock` y las físicas como `*SourceClock`.

Por tanto, el límite nominal afecta la atribución de etapas de `evaluation/route-context.mjs:475`, no los resultados físicos ni el embudo K16 actual. En el readout conservar el campo nominal y su etiqueta; no atribuirle una ventaja de interpretación ni reconstruir confirmación desde ACK. No se justifica repetir un gate por cambiar esa presentación si las fuentes permanecen congeladas.

## 5. Bombeo concurrente: diseño posterior, no cambio de esta campaña

En producción viva, percepción e investigación deben tener una cola distinta de ingestión/ejecución. Un worker de modelo puede esperar HTTP mientras otro atiende recibos y revisiones ya autorizadas. Ambos necesitan leases, transacciones cortas, mismo límite de jobs, revalidación de versiones y autoridad, y un único cargo del request de modelo. Ninguna continuación puede aprobar una acción porque el modelo esté ocupado.

En el benchmark modelado **no basta con añadir `Promise.race`**: `engine/models.mjs` bloquea `World.advance` mientras existe un modelo esperando; el transporte entre socios puede devolver `MODEL_CLOCK_PENDING`. La barrera evita adelantarse a una disponibilidad aún desconocida. Quitársela sin un protocolo temporal común permitiría leer futuro o insertar resultados retroactivamente.

Un diseño posterior verificable necesita:

1. Driver serializado del mundo y dos lanes acotadas: percepción, y progreso recibido/revisión/ejecución. La lane operativa no ejecuta modelo ni autoriza de nuevo una propuesta.
2. Watermark temporal de HTTP realmente en vuelo, separado del SQL previo/posterior. Sólo avanzar física y entregar mensajes hasta un tiempo autorizado por elapsed HTTP y latencia nominal; consultas pendientes no fuerzan un avance más allá del watermark.
3. Disponibilidad del resultado publicada una vez al `max(requestedAt + nominal, requestedAt + HTTP real, currentWorldTime)`, sin retroceder. Error/cancelación conserva coste, historia y fuentes pendientes.
4. El mismo driver y cadencia para B5/B6/B8/B9; B5 mantiene su atención finita paralela y B8 sus consultas automáticas. La aprobación independiente sigue costando su cola física.
5. Fixture sin proveedor pagado: HTTP lento y un camión/revisión ya en curso. Demostrar progreso antes del resultado del modelo, ausencia de doble comando/recibo, cancelación durante HTTP, error, reinicio y replay. Comparar también latencia cero/nominal y SQL lento: overhead SQL no debe convertirse en tiempo virtual del proveedor.

Después medir el primario nuevo con y sin ese pipeline, conservando todos los resultados. No atribuir al texto contextual un beneficio que provenga sólo de corregir concurrencia.

## 6. Familia contextual mínima si el primario sigue sin margen

Separar cambios de producto y de generador en protocolos distintos. Conservar el primario original y los controles cero lectura/informe formal inmediato. No aumentar lectura humana para forzar una ventaja ni retirar el reporte formal.

Familia sugerida: un **cargo existente** tiene varias alternativas de corredor; boletines actuales/históricos y un reporte de comunidad con nombres públicos relacionan restricciones de peso/horario con el destino y el cargo recibido. El siguiente paso útil es resolver entidad/fecha, dirigir una comprobación normal, recibir el estado y reparar la misma operación con revisión del dueño. Otra variante puede publicar un retorno vacío y su próxima ventana/compromiso: consultar calendario real y esperar/reutilizar sólo después del regreso. Ambas tienen caminos inviables/permiso denegado y nunca dan la solución en el prompt.

Representar primero relaciones genuinas: pedido frente a stock, tiempo de observación frente a republicación, alias de lugares del directorio, dos informes que se refieren al mismo vehículo/corredor, restricción que aplica sólo al cargo actual, corrección vigente y consentimiento. Idioma/adjuntos son variaciones posteriores con extracción común equivalente, no una manera de dejar ciego al baseline.

B5 debe reconocer negaciones y fechas comunes y poder inspeccionar candidatos; B8 debe ser detector sólido de ubicación/tipo/topología y poder preguntar por opciones plausibles; B9 conserva el mismo modelo, tools, permisos y cap. Las consultas consumen la misma cola limitada de fuente. OCR/ASR/traducción disponibles deben estar igualmente disponibles y contabilizados si se usan; etiquetas públicas de formato no acreditan lectura de bytes.

Predeclarar semillas, distribución de casos, todos los brazos, tiempos/formalidad, caps, criterio físico y controles antes de llamadas reales. Primero comprobar sin pagos que existe una decisión útil antes de comprometer recursos y que el convencional puede físicamente cumplir. Mantener todos los casos intentados, incluidas ausencia de margen, censura e imposibilidad. Una ventaja confirmada tendría que aparecer en servicio nativo, tiempo suficiente/restringido, coste y guardrails; no en la selección posterior de una escena vistosa.
