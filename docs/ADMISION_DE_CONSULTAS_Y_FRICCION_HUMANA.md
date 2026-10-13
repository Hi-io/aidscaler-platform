# Consultas útiles y coordinación humana: mecanismo, límites y protocolo

Fecha: 2026-10-13. Cambios de producto en la rama aislada `human-capacity-development`; los nueve mundos de la primaria congelada conservan sus fuentes y resultados originales. Este documento no convierte una hipótesis de mejora en un resultado medido.

## Resultado que debe conservarse

La primaria `1791857386133-primary` completó 24 de 24 necesidades en cada brazo y semilla, sin censura ni infracciones físicas. Los nueve resultados y las 216 trayectorias por necesidad se conservan:

| Semilla | B5 RMST suficiente, minutos | B6 | B8 | Comprobaciones terminadas B5 / B6 / B8 |
|---|---:|---:|---:|---|
| 01 | 31.7819 | 38.3788 | 33.0635 | 24 / 50 / 41 |
| 02 | 30.0617 | 34.5975 | 33.7968 | 24 / 48 / 47 |
| 03 | 33.6628 | 36.6718 | 34.6565 | 24 / 45 / 44 |

B6 fue **14.8071% más lento que B5** y **8.0098% más lento que B8**, usando el cociente entre las medias de RMST de los tres pares. No demostró una mejora sustancial frente a las referencias convencionales fuertes. El fallo `EXTRACTION_SCHEMA` de la semilla 02 y su coste permanecen en el informe; no se elimina esa semilla por haber usado recuperación convencional. No hubo B9 en estos nueve mundos: no se presenta una superioridad frente al mismo modelo como agente general.

La evidencia sellada está en `reports/analysis/frozen-three-causal-1791857386133.{json,md}` de la rama histórica `candidate-development`, con su lector offline y manifest. El JSON conserva los hashes de los nueve resultados y distingue el cociente de medias de la media de porcentajes por semilla. Sus fuentes congeladas no se modifican con esta corrección.

Las tres parejas identifican un fallo productivo concreto: más comprobaciones, incluidas hipótesis vagas que ocuparon una cola finita antes de solicitudes explícitas posteriores. La misma necesidad en `b69` tuvo dos aclaraciones en 01; `b61` tuvo dos en 03. El carril gratuito no consultaba correctamente el trabajo que el carril semántico había solicitado. Los cambios siguientes corrigen ese trabajo redundante; todavía necesitan una comparación nueva, con otra huella de fuentes.

En promedio sobre las 72 necesidades emparejadas, B6 añadió 3.8227 minutos desde inicio de demanda hasta la autorización de la contribución suficiente, 0.6626 desde autorización hasta salida cargada y 0.2286 de trayecto cargado; total 4.7139 minutos. Aproximadamente el 81% del exceso aparece antes de autorizar. Esa etapa combina lectura, inferencia, cola de aclaraciones, evidencia, elaboración, revisión y disponibilidad de flota: no se atribuye toda a percepción. El trayecto cargado empeoró en 01 pero mejoró en 02 y 03; «malas rutas» no explica por sí solo la degradación consistente.

Las llamadas B6 fueron 7/8/7, con USD 0.01681876 de coste conocido total y 53.2458/69.4606/42.1714 segundos de HTTP del modelo por semilla. Se conserva ese coste, incluido el intento rechazado 02. No se equipara el wall de SQL/CPU con el HTTP del proveedor ni se atribuyen correcciones del compilador físico común al razonamiento del modelo.

## Cambio común de admisión de consultas

`src/received-inquiries.mjs` ofrece `requestReceivedInquiry(app, request, options)`. Todos los controladores pueden usar la misma capacidad: solicitud exacta de edificio, carretera o recurso propio, método y propósito; un objetivo debe existir en el directorio recibido. Otro dueño no concede acceso por aparecer en un texto público.

Antes de crear trabajo, el helper consulta las solicitudes pendientes del actor autenticado. Reutiliza únicamente mismo dueño, objetivo, método y propósito; una observación ordinaria no reemplaza una evaluación de seguridad. Persiste una identidad de comando derivada del run y alcance recibido. Reinicio o pérdida del ACK nunca genera una identidad nueva para la misma emisión. Una salida ambigua queda `requires_review`; no declara que la fuente falló físicamente ni repite con otra clave.

El intento durable se reserva bajo bloqueo del dueño. La emisión HTTP ocurre fuera de la transacción SQL para que cancelación y escrituras del operador puedan avanzar. Las llamadas concurrentes del mismo proceso comparten la petición en vuelo; la identidad fuente protege las repeticiones entre procesos. Los intentos que aún no recibieron ACK también cuentan al limitar consultas de fondo.

`src/source-opportunities.mjs` conserva todas las observaciones. Su admisión usa exclusivamente necesidades, operaciones, propuestas y mapa ya recibidos:

1. Una restricción o corrección vinculada con trabajo o demanda actuales puede dirigir una consulta prioritaria. El texto no cambia una carretera ni cancela una necesidad.
2. Una hipótesis concreta de capacidad puede dirigir una consulta cuando podría cubrir un déficit recibido aún no cubierto por operaciones o propuestas pendientes. La disponibilidad, compatibilidad y autorización siguen sin confirmar.
3. Contexto vago o incertidumbre sin dependencia actual queda visible. Hay como máximo dos comprobaciones de fondo por dueño; no se admiten nuevas mientras existan consultas explícitas o de seguridad pendientes.
4. El cambio de una necesidad, operación, recibo, capacidad consentida o ventana de disponibilidad puede reactivar contexto diferido. Un timestamp de sondeo idéntico no basta. Los originales y motivos siguen disponibles en el detalle de actividad.

`waiting_context` significa «hipótesis no verificada esperando contexto operativo o revisión». No significa falso, seguro, necesidad inexistente, fuente consumida con éxito ni ayuda prestada. El operador puede detener el seguimiento. Las órdenes ya emitidas y sus recibos se conservan.

La implementación existente de B5/B8 usa el mismo helper para sus aclaraciones; el nuevo evaluador humano lo reutiliza. El acceso no es exclusivo de B6 ni depende del conjunto de necesidades del scorer.

## Cantidad disponible no es cantidad solicitada

El parser gratuito compartido deja de interpretar «only 15 meal portions left» como una demanda de 15 comidas. También respeta ese stock si la misma frase comienza «we need help at b1»: una petición genérica de ayuda no cambia el significado de «15 comidas restantes». Una escasez actual y un lugar recibido todavía justifican la misma consulta gratuita; su cantidad queda nula. «Needs 15 meals», «needs only 15 meals» y «only 15 meals are needed» conservan 15 como hipótesis literal. Dos cantidades alternativas o una unidad ambigua no se suman ni se convierten mediante una respuesta privada del generador. La aclaración responsable establece la demanda física.

Este cambio beneficia todos los brazos. No se retira una pista legítima de B5/B8 para mejorar la posición de B6.

## Recuperación de formato semántico

`src/semantic-validation.mjs` produce diagnósticos acotados de `issue.path` y `issue.code`, sin registrar el prompt o salida textual íntegros. Los enums, límite de observaciones y proveniencia siguen estrictos. Referencias, lugares o entidades no presentados, o afirmaciones de autoridad, no reciben una corrección automática.

Sólo si ninguna observación supera un fallo puramente estructural puede haber una segunda extracción: máximo una reparación por batch. Recibe los mismos 35 registros como máximo, el directorio acotado original, un borrador no confiable truncado y los diagnósticos estructurales. No recibe estado privado del mundo. Ambas llamadas usan el mismo episodio, proveedor, pool, límite de llamadas y presupuesto; cada intento conserva precio, tokens y su recibo de tiempo HTTP.

El primer intento rechazado permanece en `semantic_receipt`, atención de fuentes y actividad. Si el segundo falla, no hay claims aceptados y la revisión queda pendiente. Reiniciar la misma identidad de batch no abre un tercer intento; una recuperación explícita posterior necesita otra identidad de episodio y sigue limitada por el presupuesto. Cancelación o retirada de las fuentes evita una reparación y bloquea aceptación posterior de claims.

El código genérico del fallo histórico 02 no identifica qué campo falló. Por eso no se atribuye retrospectivamente una causa concreta ni se introduce una coerción especulativa para hacer desaparecer ese fallo.

## Por qué añadir una referencia convencional de operación fragmentada

Las demoras de coordinación son mecanismos plausibles que requieren pruebas propias. La guía de evaluación en tiempo real de IFRC pregunta por la oportunidad de la ayuda, factores internos y externos que afectan la rapidez, solapamientos, coordinación entre actores e intercambio de información. Sirve para seleccionar dimensiones de simulación; no proporciona aquí una tasa universal de error ni una duración medida. [IFRC, Real Time Evaluation Guide and Procedures, actualizado 2 septiembre 2022, p.30, 4.8–4.15](https://www.ifrc.org/sites/default/files/2025-07/IFRC%20Real_time%20Evaluation%20Guide%20and%20Procedures.pdf).

IFRC recomienda coordinar planes, presupuestos y compromisos, acordar cómo compartir información y contrastar los planes con comunidades. Esto fundamenta representar comunicación y conciliación como trabajo finito. La simulación debe mantener esas herramientas disponibles también para la referencia manual competente. [IFRC Red Solutions Hub, Engage and be accountable to communities during emergencies](https://solutions.ifrc.org/national-society-capabilitiesbuild-community-engagement-and-accountability/engage-and-be).

El informe DREF `MDRIR014fr` mencionado durante la investigación no se utiliza como prueba de un desastre, lugar, fecha o tasa: no se pudo leer su documento completo en esta revisión.

## Referencias que no se deben reemplazar

Conservar B5, el planificador convencional fuerte con carril gratuito, lectura finita y compilación compartida; conservar B8, detector amplio automático que puede consultar todas las pistas públicas pertinentes. Pueden empatar o superar a NEXO. Agregar `C_manual` representa otro flujo operativo declarado, con organizaciones independientes, lectura/integración/relé humanos finitos. Ganar contra C_manual y perder contra B5 no demuestra que GenAI supere al mejor planificador convencional probado.

Para separar mecanismos, medir:

- C_manual frente a B5/B8: posible efecto de integración y automatización de coordinación.
- B6 frente a B5 y B8: aporte o coste incremental de interpretación semántica.
- B6 frente a un agente general con mismas herramientas/modelo cuando esa comparación esté predeclarada: alcance específico de esta implementación, no superioridad sobre todos los agentes.

## Reglas para fricción humana sin fabricar una ventaja

Las organizaciones, sus stocks, vehículos y autoridad permanecen separados. Las propuestas de varios dueños deben obtener sus aprobaciones reales. La tarea humana `decide` no autoriza, el relé no crea demanda y un ACK no confirma entrega.

La misma configuración y semilla física alimentan todos los brazos. Las colas humanas nativas tienen trabajadores y tiempos explícitos; sus errores latentes se derivan de dueño, evento y ordinal estable, nunca del nombre del brazo, `Date.now()` o un objetivo de mejora. Un operador de NEXO también puede estar ocupado, decidir tarde o devolver una respuesta inconclusa. La plataforma puede detectar contradicciones o versiones obsoletas y exigir nueva revisión; ese control cuesta tiempo y no es infalibilidad humana.

Los valores de sensibilidad —por ejemplo, 0/5/15 minutos de retraso o 0/1% de intentos inconclusos— son supuestos de laboratorio predeclarados. No proceden de las fuentes IFRC y no deben presentarse como datos históricos de ONG. Una condición sin errores y otra sin congestión humana son controles necesarios.

Un error convencional debe ocurrir por un flujo ejecutable y observable, no por sumar una penalización final: lectura que aún no termina, decisión que espera un trabajador, imagen operativa que no ha recibido un relé, dos dueños que actúan con información desfasada. El manual conserva consultas, coordinación y reconciliación; puede corregirse tras recibir información nueva. No se induce «probabilidad de duplicados» exclusiva del brazo manual.

Una entrega duplicada sólo cuenta si hubo dos decisiones y órdenes autorizadas sobre stocks independientes, viajes reales y recepción física real. El mismo motor aplica límites de carga, reservas, calendarios, conductor, fondos y verificación a todos. Si un guard común impide el duplicado, registrar el intento rechazado y su coste, no inventar una entrega duplicada. Tampoco neutralizar deliberadamente la comprobación común para que el manual parezca peor.

Errores comparables pueden exponer rutas distintas después de que los brazos diverjan. Declarar esa limitación del emparejamiento; no afirmar que cada decisión divergente tuvo una realización humana idéntica. Los controles sin error permiten observar la diferencia de arquitectura sin ese problema.

## Métricas y lectura causal predeclarables

El objetivo es reducir demora hasta ayuda física útil y suficiente manteniendo cobertura y seguridad. Usar horizonte fijo, todas las necesidades elegibles y censura a la derecha; cantidades por recurso en su unidad nativa. Mantener RMST, primer servicio, suficiente, p95, déficits acumulados, oversupply útil/no útil, errores, carga de consultas, combustible, distancia y utilización de flota. Una propuesta aceptada, un texto interpretado o una tarea humana terminada no es ayuda prestada.

Funnel con timestamps realmente recibidos: publicación → HTTP recibido → lectura/modelo disponible → integración/decisión/relé completados → consulta solicitada → observación recibida → propuesta → aprobación → carga → llegada → recepción útil. No llamar «confirmación terminada» a la respuesta inicial de una consulta encolada. Donde falte un timestamp exacto, mostrar desconocido.

Cada mundo conserva hashes iniciales/finales de plataforma, evaluador y simulador, todos los intentos, fallos y cobros desconocidos. Terminar el servicio físico de la cohorte no implica recuperar todas las fuentes pendientes: K02 y K22 son estudios distintos.

Primero demostrar las colas y guardas sin proveedor pagado; luego predeclarar condiciones, brazos, semillas y coste máximo antes de abrir nuevas comparaciones. Conservar siempre la primaria negativa original y las referencias fuertes en el mismo reporte. No repetir una semilla pagada sólo porque su resultado sea desfavorable.

## Regresiones incluidas en este cambio

- Dos carriles y reinicio reutilizan una consulta responsable; veinte sondeos no crean trabajo adicional.
- Métodos/propósitos y dueños distintos no se confunden; un objetivo fuera del directorio se rechaza.
- Pérdida de ACK después de emisión conserva revisión durable y recupera la solicitud fuente pendiente sin repetirla.
- Treinta incertidumbres permanecen visibles y difieren sus comprobaciones mientras hay una necesidad explícita pendiente; al liberarse la cola entran como máximo dos.
- Los intentos concurrentes previos al ACK también consumen esos dos slots.
- Dos observaciones contradictorias sobre una misma entidad conservan texto y referencias por separado; comparten una sola consulta física, sin crear demanda.
- Una nueva necesidad recibida reactiva capacidad concreta pertinente; necesidad cubierta por una propuesta no justifica capacidad adicional.
- La corrección de carretera aún permite reparar la misma carga con recibo real y revisión del dueño; no crea un camión ni borra ayuda previa.
- Reparación de esquema: dos tiempos/costes conservados, primer fallo visible, sin tercer intento automático; referencias desconocidas/autoridad rechazan sin reparación.
- Cancelación durante consulta o modelo impide consultas posteriores y nuevos drafts; recibos físicos anteriores se preservan.

Estas pruebas demuestran mecanismos locales. No sustituyen la nueva medición comparativa ni una calibración de campo.

## Qué puede atribuirse a la nueva familia de colas nativas

`evaluation/human-capacity-benchmark.mjs` es una comparación nueva, con protocolo y fuentes propios. La demora procede de tareas nativas recibidas de lectura, decisión y relé, no de una penalización sumada al resultado manual. Las revisiones del dueño usan la misma piscina finita de decisión en todos los brazos. Una tarea humana completada entrega un snapshot del que ese actor podía disponer; nunca sustituye una aprobación o un recibo físico.

El control `C_manual` utiliza integración y transmisión entre dueños; `C_decentralized` conserva planes propios y recibe intenciones/operaciones mediante relés reales. La referencia puede conciliarse al recibir nuevos datos y un guard común puede evitar duplicados. Estos son flujos hipotéticos reproducibles, no descripciones calibradas de toda ONG.

El parser exacto y las aclaraciones automáticas permanecen disponibles en B5/B8/B6. B8 no recibe una demora ficticia de lectura, decisión o relé para sus candidatos automáticos. B5 conserva lectura nativa finita para fuentes que el carril gratuito no interpreta. B6 utiliza percepción real acotada para esos registros y conserva todos sus intentos y latencias. Los controles sin congestión y de lectura rápida/más lectores deben acompañar cualquier mejora contra el flujo manual.

| Comparación | Qué podría demostrar si mejora el servicio físico | Qué no demuestra por sí sola |
|---|---|---|
| B5/B8 frente a C_manual/C_decentralized | Valor de integración, deduplicación y automatización de coordinación | Necesidad del modelo generativo |
| B6 frente a C_manual/C_decentralized | Valor del producto completo bajo esas colas declaradas | Superioridad frente a B5/B8 o aporte aislado de GenAI |
| B6 frente a B5 y B8 | Aporte o coste incremental de la interpretación semántica con el compilador común | Generalización a toda emergencia o impacto clínico real |
| B6 frente a B9, con mismo proveedor, información, permisos y presupuesto | Diferencia frente a esa implementación explícita de agente general | Superioridad sobre todos los agentes posibles |

La comparación B9 y una atribución semántica positiva permanecen pendientes hasta tener ensayos predeclarados completos con proveedor real. Un smoke grabado o una prueba funcional de herramientas sólo verifica contratos. No hay un nuevo resultado positivo autorizado por este documento.

## Límite semántico del corpus actual

`generators/response-benchmark.mjs` produce solicitudes con cuatro formulaciones inglesas fijas y un identificador público literal `bN`, incluso cuando omite el location tag. B8 puede detectar lugar/recurso y pedir la misma aclaración responsable, cuyo recibo proporciona el déficit real. No necesita resolver la aritmética de personas, contenedores o mantas para que el compilador reciba una demanda correcta. Es un control válido de adquisición y coordinación; no debe desaparecer cuando favorece la automatización convencional.

Los formatos de esa familia son texto, caption o transcript. No demuestran que el modelo haya interpretado bytes originales de imágenes o voz. Las pruebas independientes de ASR/media no cambian el alcance del corpus comparativo.

S07 utiliza una política común de cobertura basada en directorio y contactos recibidos; no adivina una necesidad escondida. C1/S19 usa un catálogo tipado de dependencias, compatibilidad y calificaciones que el compilador convencional también puede procesar. K14 compara políticas acotadas de refresco. S01 verifica calendario, regreso vacío y reutilización posterior con entrega 300+300; no demuestra transportar agua durante ese regreso ni preautorizar un vehículo ocupado. No se agrupan esos mecanismos bajo una afirmación única de «GenAI indispensable».

## Familia temporal y de corredores: propuesta pendiente

No se añade una familia nueva durante el gate o después de observar un resultado para sustituirlo. Una expansión posterior podría medir una hipótesis distinta: varias fuentes recibidas cambian qué consulta concreta conviene realizar para una **misma carga ya bloqueada**. La interpretación propone una pregunta; la carretera, compatibilidad, calendario y permiso se confirman mediante recibos normales.

El mínimo técnico utilizaría los hooks existentes: mapa público con nombres/aliases unívocos, extracción de restricción/corrección grounded, consulta tipada compartida, cola finita, observación de carretera, reparación de la operación original y revisión del dueño. El motor programa primero la física y después los mensajes de varias perspectivas: comunicado de reapertura, restricción de peso, nota reciente que nombra un tramo y archivo histórico. El prompt no recibe carretera ganadora, etiqueta de verdad, orden correcta ni necesidades privadas.

La nueva familia de colas hoy consume observaciones `need` para dirigir aclaraciones de edificio. No se debe afirmar que ya evalúa selección multifuente de corredores o aprovechamiento de capacidad condicional. Ese futuro controlador tendría que consumir restricciones y correcciones recibidas mediante el mismo camino operacional, conservando las incertidumbres, antes de declarar esa cobertura.

Fijar antes de ensayar las variantes favorable, reapertura sólo para vehículos ligeros, boletín corregido, conexión tardía, ventana insuficiente, ninguna ruta factible y control sencillo estructurado. No aumentar alternativas hasta obtener una derrota convencional. El detector B8 conserva acceso a todas las pistas y prioridad por operación recibida; B5 puede interpretar fecha/negación/unidad/alias con lectura finita; B9 recibe las mismas herramientas y presupuesto. Si todas las alternativas pueden comprobarse en paralelo más rápido que el modelo, el empate o la derrota de B6 es válido.

Para una referencia indirecta o alias ambiguo hace falta un recibo común de resolución que devuelva candidatos, o mantener el caso desconocido. El extractor actual no puede inventar una entidad que no se le presentó. Cambiar a un idioma que una regex inglesa desconoce no es una prueba contra un operador competente: necesita normalización común, lectura competente del mismo idioma y validación independiente. Un holdout sintético redactado por el equipo sigue siendo validación interna; revisión bilingüe y datos de emergencias externas quedan pendientes.

Pruebas gratuitas previas: fuente → hipótesis → consulta real → recibo → propuesta que conserva cargo/destino → aprobación → servicio original. Negativos deben rechazar o requerir revisión sin crear un vehículo, borrar demanda o adelantar salida. Una comparación pagada posterior tendría semillas/config/corpus/hashes y cap económico predeclarados, todos los intentos conservados. No promete una ganancia antes de medirla.

## Disponibilidad del modelo y concurrencia pendiente

El wrapper del nuevo evaluador permite consumir una respuesta sólo después de `requestedAt + max(latencia nativa, HTTP real medido)`, avanzando al objetivo absoluto y nunca sumando ese intervalo dos veces. El tiempo de servicio y los eventos físicos usan el reloj real del mundo de esa corrida. La duración de SQL se reporta aparte.

El recibo nativo `availableAt` puede conservar su latencia nominal aunque el controlador espere más por HTTP. Por tanto, `interpretedAtSourceClock` derivado de ese recibo no se presenta como timestamp exacto de finalización del proveedor. Para un funnel preciso se utiliza el evento `model-controller-availability.controllerObservedAt`; cuando no hay evidencia exacta, el campo sigue desconocido. No se resta el tiempo de una inferencia fallida.

El loop actual espera `app.semantic.process` antes de volver a bombear revisiones, consultas y ejecución del controlador. El motor puede terminar eventos anteriores durante ese intervalo, pero eso no equivale a que el controlador haya atendido nuevos recibos. Una futura concurrencia legítima separaría percepción de continuaciones ya autorizadas; ninguna acción dependiente de la salida existiría antes de su disponibilidad real. Al terminar debe revalidar cancelación, erasure, versiones, permisos y cola actuales. Infraestructura y reloj comunes para todos los brazos, más un control de percepción grabada con igual demora, separarían ganancia de scheduling de ganancia semántica. Es una propuesta pendiente, no una capacidad ya medida.

Finalmente, fuentes leídas/dispuestas y seguimiento operacional terminado son denominadores distintos. Una hipótesis irrelevante conservada en `waiting_context` puede seguir pendiente de contexto o revisión sin justificar más consultas. K22 debe mostrar por separado disposición durable de fuentes y esa atención operacional; no borrar la hipótesis ni declarar recuperado todo el sistema sólo porque terminó la cohorte física.
