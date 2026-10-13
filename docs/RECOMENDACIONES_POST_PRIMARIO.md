# Propuesta posterior al primario: cantidades, concurrencia y contexto

Preparada antes de los resultados nuevos, 13 de octubre de 2026. **No autoriza modificar la versión congelada ni garantiza un KPI positivo.** Primero cerrar y publicar los resultados del primario nuevo junto al negativo original; después abrir una versión con cambios y protocolo propios. La base actual pasó 448 pruebas de plataforma, 228 de simulador y 113 comprobaciones UI, con huellas candidato `704c8ac21aba087f8732c5d9d6a413c50284c5caa5f573e24a2cc891d9450c1e`, evaluador `5e6a11ecae88648e491fe680fd7ae7407d00e12622b244c021dd5d9e661bbeab` y simulador `2825f94dffbf6db2835c05170ea00d9225863e4955682debd6236c4c71454b4e`. Esas pruebas acreditan sus comportamientos locales; no una ventaja física de GenAI.

El anexo `ANEXO_CORPUS_Y_RELOJ.md` conserva los ejemplos puros del parser y los límites de timestamps. Este documento propone decisiones de implementación y sus ensayos mínimos, sin cambiar código o mundos.

## A. Normalización gratuita: stock no equivale a demanda

**Problema confirmado.** `parseExplicitCurrentRequest` encuentra en «45 personas y sólo 15 meal portions left; cover the shortfall» una necesidad de 15 porciones. Es el stock disponible, no la demanda de 30. El runner sólo utiliza la localización para pedir una clarificación real; no despacha 15 desde el parser. Esta protección actual debe permanecer, pero no justifica conservar un dato semánticamente incorrecto para otros consumidores.

**Cambio mínimo compartido por todos los brazos:** separar tres resultados:

1. Petición literal inequívoca en unidad nativa: cantidad solicitada, estado no verificado y referencia exacta.
2. Pista operacional explícita con lugar y tipo, pero cantidad ambigua o correspondiente a inventario/entrega pasada: conservar una candidatura de comprobación con `quantity:null`, sin presentarla como petición cuantificada.
3. Contexto sin pedido actual: registro incierto visible. Una cantidad positiva, un lugar o una palabra de recurso por sí solos no prueban demanda.

No usar `style`, `truthCategory`, gold ni la familia del generador. La decisión debe poder hacerse sobre cualquier texto recibido y directorio público. «Only 15 portions left» no se convierte automáticamente en necesidad; la petición expresa del faltante es lo que justifica una pista de comprobación. Un nombre nuevo no presente en el directorio queda sin resolver. Cambios ambiguos no cancelan necesidades confirmadas.

Cuando el dato es una operación aritmética simple y verdaderamente estructurada —pedido, recepción y unidad explícitos del mismo lugar/periodo— el cálculo determinista puede ser común a B5/B6/B8/B9. Acertar una resta compartible no prueba una capacidad exclusiva del modelo.

**Regresiones mínimas antes de medir:**

- Pedido de 30 porciones ⇒ candidato de 30; stock de 15 sin pedido ⇒ ninguna cantidad demandada.
- 45 personas/15 disponibles/petición de faltante ⇒ pista pertinente conservada, cantidad de demanda desconocida hasta recibo o aritmética explícita validada.
- Números citados de otro lugar/fecha, entrega ya realizada, negación y varias alternativas ⇒ no adjudicar esa cifra al pedido actual.
- Error de extracción ⇒ no crear orden, necesidad confirmada ni falso cero; clarificación recibida aún conduce al mismo borrador físico.
- Fixture común con iguales bytes y parser para todos los brazos: no añadir lectura artificial al convencional al retirar el número erróneo.

**Medición:** precisión de la distinción pedido/stock sobre fixtures anotadas, llamadas/consultas, déficit y servicio físicos. Publicar separado el efecto de corregir el dato y el efecto del modelo. La corrección puede quitar o añadir margen semántico; ambas consecuencias son válidas.

## B. Continuar la respuesta durante una inferencia

**Limitación actual.** `runDiscoveryEpisode` hace progreso y borrador antes del modelo, pero queda dentro de `await app.discovery.run` hasta terminar el lote. Camiones/revisiones programados avanzan al cargar el tiempo del modelo; el controlador no reacciona a sus recibos intermedios. El worker secuencial también puede poner ejecución detrás de percepción. No asumir cuánto afecta esto hasta leer etapas del primario.

**Producto:** lane operativa acotada para ingestión, recibos, revisiones pendientes, peer transport y continuación de órdenes; lane de percepción para HTTP y normalización. Usar jobs durables con leases separados, una continuación por propuesta, versiones revalidadas y transacciones cortas. La lane operativa sólo actúa sobre datos ya recibidos y autorización vigente. Percepción publica hipótesis una vez después de disponibilidad, sin aprobar ni ejecutar automáticamente un plan nuevo. Cancelación/revocación durante la llamada impide publicar una nueva propuesta, conservando el coste y las órdenes previas.

**Evaluador:** no resolverlo con un timer que quite la barrera actual. El modo modelado bloquea `World.advance` con un modelo pendiente y el transporte entre socios puede devolver `MODEL_CLOCK_PENDING`. Se necesita un protocolo temporal explícito, común a todos los brazos:

- Driver serializado que avanza eventos físicos y entrega recibos por intervalos/eventos acotados, no un `advance` gigante seguido de procesamiento retrospectivo.
- Watermark de inferencia basada en HTTP realmente iniciado/en vuelo, separado de SQL previo y posterior. No entregar observaciones posteriores a ese límite ni esperar por una query forzando el mundo más allá del límite.
- Disponibilidad final al máximo de latencia nominal, duración HTTP real y tiempo actual; el resultado no se inserta en el pasado. El driver no conoce tokens, respuesta ni acciones del modelo antes de recibirlas.
- Igual cadencia de progreso y mismas colas/capacidades para B5/B6/B8/B9. B5 mantiene lectura humana paralela finita; B8 sus hipótesis gratuitas. Aprobar sigue requiriendo al dueño y su cola; no poner review=0.
- Coste y fracaso de HTTP conservados. Si no se conoce duración HTTP separable, elapsed conservador explícito; nunca un cero inventado. SQL sólo modifica tiempo wall económico de la corrida, como en el protocolo actual.

**Prueba causal sin pagos:** una respuesta HTTP registrada tarda 45 s y existe una revisión independiente de 30 s/recibo de camión ya autorizado. Con el pipeline, la lane debe recibir y continuar esa respuesta antes de la disponibilidad del modelo, utilizando sólo evidencia previa. Confirmar mismo cargo/ID, cero órdenes duplicadas, versión actual y revisión humana. Controles: HTTP <15 s nominal sin oportunidad intermedia, latencia cero, SQL lento, error, cancelación, reinicio y replay. No esperar ventaja en un caso sin camino crítico intermedio.

**Comparación posterior:** misma versión del solver, corpus y permisos, pipeline activado/desactivado por protocolo común; reporte de service/RMST/censura, recibos intermedios, revisiones, km y coste. El efecto de concurrencia es ingeniería del producto; sólo su interacción adicional con información interpretada puede atribuirse a GenAI. La primera campaña nueva se conserva aunque vuelva a ser negativa.

## C. Familias semánticas que puedan cambiar una decisión

El corpus actual da un ID literal, vocabulario de recurso y una clarificación que entrega toda la demanda. B8 no necesita resolver la resta para obtener la misma respuesta. Añadir ruido idéntico no representa compatibilidad, tiempo o cooperación; tampoco llamar «audio» a una transcripción acredita comprender audio.

Propuesta mínima, manteniendo ese corpus como control:

| Familia | Información recibida que debe relacionarse | Decisión física verificable | Negativos imprescindibles |
|---|---|---|---|
| Recuperar el mismo cargo bloqueado | Boletín con alias público/fecha, peso permitido, corrección actual, masa/carga del vehículo recibido y destino | Consulta normal de corredor pertinente → recibo → reparación de la operación existente → dueño → ayuda recibida | Todas las rutas inviables, boletín antiguo, corrección tardía, permiso denegado, cambio de fase/cargo |
| Reutilizar una capacidad condicional | Nota de retorno vacío, vehículo del dueño, ubicación/horario, siguiente compromiso y ventana recibida | Consulta de flota/calendario → esperar regreso real → pickup/entrega compatibles con ventana | Camión aún ocupado, ventana demasiado corta, conductor ausente, turno insuficiente, consentimiento revocado |
| Resolver demanda revisada entre fuentes | Stock y pedido separados, población actual, unidades, publicación frente a observación y dos lugares con alias | Comprobación dirigida al lugar/periodo correcto → cantidad nativa recibida → propuesta proporcional | Publicación histórica, cantidad de otro lugar, conflicto no resuelto, nueva necesidad adicional conservada |

Ningún prompt contiene «la solución es ruta X». Las variantes deben surgir de relaciones físicas/temporales y boletines disponibles, con directorio compartido y sin esconder facts al baseline. Las observaciones no conceden inventario ni permisos. Un ACK no es comprobación completada; una disponibilidad de calendario no libera un camión ocupado.

**Referencias competentes:** B5 interpreta el mismo texto como lector multilingüe capaz, incluyendo fechas/negaciones habituales; su duración/workers son parámetros sintéticos declarados, no productividad humana calibrada. Si se automatiza esa lectura con reglas, un fallo por idioma debe declararse como límite del emulador, no como ventaja de IA frente a personas. B8 dispone de detector de entidad/topología/recursos robusto y puede comprobar varias opciones plausibles. B9 conserva el mismo modelo, tools, permisos y caps como agente general. Las consultas de todos comparten el coste físico de la fuente.

Antes de usar idiomas o bytes multimedia: proveer extracción/traducción equivalente común con su coste o lector multilingüe reproducible competente. Comparar también fuentes normalizadas estructuradas. No dejar a B5/B8 con regex sólo inglesa mientras B6 recibe la traducción; no regalar al modelo una transcripción que los otros no ven.

**Predeclaración y disciplina de coste:**

1. Especificar seeds, variantes favorables/adversas, bytes/formatos, tiempos, colas, reporte formal, arms, caps y criterios físicos antes de pagar. Conservar todos los intentos, incluidos ausencia de margen y fallos.
2. Preflight gratuito valida que cada brazo puede obtener las evidencias y que existe una respuesta físicamente viable; no selecciona semillas por un contraste B6 favorable ni elimina controles negativos.
3. Probar una sola familia útil y su control estructurado antes de multiplicar ruido o volumen. No medir mejoras del corpus y del pipeline como si fueran una única causalidad.
4. Medir servicio físico suficiente y primer aporte, RMST con censura, déficit nativo, consultas/calls, coste conocido/reserva desconocida, km y ventanas infringidas. Nunca litros+porciones+personas en un score inventado.
5. Si el convencional obtiene la evidencia antes de liberar la flota, reconocer que no hay margen informacional en esa escena. Mejorar el producto físico compartido o cambiar de hipótesis con una nueva predeclaración; no empeorar al convencional.

## Orden recomendado después de cerrar resultados

Cerrar primero la comparación exacta y leer fuente→comprobación recibida→borrador→autorización→pickup→servicio. Corregir A por integridad del dato. Si se observa head-of-line con oportunidad real, implementar B y demostrarlo sin pagos antes de repetir. Si todos los brazos tienen la misma evidencia a tiempo y la flota domina, ensayar C sólo cuando una relación contextual cambie una decisión antes de comprometer recursos. Nada de esto sustituye la publicación del negativo original o del primario nuevo.
