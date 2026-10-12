# Protocolo previo: evaluación física y servicio colectivo S19

Fecha de declaración: 2026-10-13. Esta declaración se escribe antes de iniciar la campaña de proveedor real. No se cambian escenarios ni métricas después de ver qué brazo obtiene mejores resultados.

## Pregunta

¿La plataforma puede transformar capacidad complementaria de organizaciones independientes en un refugio físicamente inspeccionado, abastecido, abierto y ocupado? ¿Cuánto tarda y qué coste tiene frente a una planificación convencional competente con los mismos permisos, herramientas, información recibida y posibilidades de delegación?

La prueba de mecanismo que ya funciona demuestra una coordinación sin personal propio que obtiene una inspección de otro dueño y sirve 50 plazas. La campaña siguiente es diferente: no fuerza el personal de la coordinación a cero ni entrega al modelo un plan correcto. Utiliza S19 tal como lo genera el simulador, incluyendo sus otras demandas. Una ocupación de 50 no demuestra, por sí misma, una ganancia atribuible al LLM.

## Diseño fijado antes de correr

| Parámetro | Valor |
| --- | --- |
| Escenario | S19, equipos independientes y capacidad conjunta |
| Variantes | `distributed`, `delayed` |
| Semillas | Una por variante: `delegated-final-2026-distributed-01`, `delegated-final-2026-delayed-01` |
| Brazos | B5 convencional compartido; B6 NEXO; B7 agente general compartido |
| Comparación | Cada variante y semilla idéntica entre los tres brazos |
| Organización | Cuatro dueños, coordinación de investigación e independientes aprobaciones de cada dueño |
| Rondas | 12, intervalo simulado de 300.000 ms (5 minutos) |
| Concurrencia | Dos mundos aislados; los brazos de cada mundo se ejecutan secuencialmente |
| Horizonte | Horizonte normal del escenario, no termina al recibir la primera propuesta |
| Presupuesto | $0,15 por episodio; $0,75 total como límite conservador de la campaña |
| Revisión | Operadores programados, con su coste y demora simulados |
| Reloj | Reloj simulado con las demoras declaradas; no representa latencia industrial de producción |
| Fuentes | El candidato recibe sólo APIs y mensajes autorizados, no el estado oculto del evaluador |
| Versiones | Huellas de candidato y evaluador registradas por el runner antes de iniciar; ninguna fuente cambia durante la campaña |

Las reservas del presupuesto se toman antes de cada episodio y se liquidan con el coste registrado. B5 no utiliza el proveedor. Si el presupuesto o un fallo del proveedor impide completar un episodio, se conserva el resultado incompleto. No se aumenta el límite para obtener una victoria.

## Resultados que se medirán

### Primarios

1. **K01 de refugio:** integral del déficit nativo de plazas de refugio (`uncoveredUnitMs`) y su conversión a plaza·hora. Menos déficit significa personas atendidas antes; nunca se agrega con litros, comida o unidades de otros recursos.
2. **Servicio físico colectivo:** ocupación real del refugio y cobertura de la necesidad de refugio. El objetivo funcional del caso es 50 personas efectivamente alojadas, no 50 plazas prometidas, un edificio abierto sin usuarios ni una propuesta terminada.
3. **K04:** plaza·horas efectivamente servidas (`collective.shelterPlaceHours`). Se separa de las horas de edificio abierto vacío y de la cantidad de propuestas.

### Secundarios

- **K02:** tiempo a primer servicio físico útil y tiempo a cobertura suficiente. Se conserva la censura de necesidades que no reciban servicio, evitando comparar únicamente los casos completados.
- Ciclo de inspección: dueño de personal y vehículo; aprobaciones de coordinación y dueño; salida, viaje real, llegada, trabajo de inspección, observación y entrega del recibo; método, competencia, versión objetivo y vigencia.
- Dependencias físicas del refugio: agua, energía compatible, saneamiento y personal cualificado realmente entregados por los dueños requeridos.
- Traslados y recepciones: operaciones por dueño, sus estados, distancias y tiempos disponibles; las recepciones de la coordinación se vinculan a la operación fuente, sin contarlas otra vez como otro viaje.
- Transporte y recursos: combustible, distancia, bloqueos, sobreabastecimiento por tipo nativo, fallos de operaciones y tiempo de revisión.
- Proveedor: llamadas, tokens, tiempo, coste conocido, reservas por coste desconocido y errores. Una llamada con coste desconocido no se trata como gratuita.
- Integridad: invariantes, ledger de conservación, cancelaciones, estados que requieren revisión y ausencia de doble utilización de la tripulación.

El reporte conserva los snapshots de inspecciones, operaciones y refugios **recibidos por cada dueño** separados de las métricas del estado físico del evaluador. La existencia de una propuesta o un recibo de aprobación no se confunde con una prestación de ayuda.

## Resultados adversos que se conservarán

- B5 más rápido o eficiente que B6; B7 igual o superior a B6.
- Cero refugios ocupados; refugio abierto sin ocupar; ocupación menor de 50.
- Propuestas correctas que llegan demasiado tarde; rondas gastadas repitiendo o esperando tareas.
- Falta de personal competente, vehículo o permiso; viajes bloqueados; datos que se quedan sin recibir.
- Recepción vencida, versión antigua o método de aclaración/radio presentado como inspección física: nunca certifican seguridad.
- Menor déficit de un recurso pero peor déficit de otro, más combustible o mayor coste de atención.
- Respuesta del modelo fallida, errores de herramienta, presupuesto agotado, coste desconocido o ejecuciones censuradas.

No se omiten estos casos ni se compensa una derrota con una afirmación visual. Si el mecanismo funciona pero B6 no mejora frente a B5, la conclusión será funcionamiento del mecanismo sin evidencia de superioridad de NEXO en este contraste.

## Atribución y límites

La inspección competente, el despacho físico, las cantidades, los permisos y el ledger son mecanismos verificables del producto y del simulador. No son razonamiento generativo. La comparación B6–B7 investiga el valor de la política y herramientas de NEXO, mientras que B6–B5 compara la solución completa con un operador convencional competente. Ninguna de esas comparaciones aisla por sí sola cada componente de Gemini o Gemma.

Se usarán los modelos del proveedor realmente registrados por la ejecución; no se afirmará que se midió Gemini si se utilizó Gemma. Una semilla por dos variantes es un contraste interno de desarrollo, insuficiente para una conclusión estadística robusta, validación clínica, realismo externo de desastres o garantía de un premio. Se conservan todas las diferencias y se necesitan más semillas y supuestos de escenarios independientes para generalizar.

## Comando fijado

Se ejecutará únicamente después de la confirmación de congelamiento final de las fuentes por root. El archivo `.env.local` carga las credenciales y no forma parte del informe.

```powershell
node --env-file-if-exists=.env.local scripts/parallel-campaign.mjs --scenarios=S19 --arms=B5,B6,B7 --seeds=1 --composition-variants=distributed,delayed --rounds=12 --interval-ms=300000 --workers=2 --budget=0.75 --episode-budget=0.15 --seed-prefix=delegated-final-2026- --stop-file=.local/STOP_DELEGATED_CAMPAIGN
```

El runner guarda `protocol.json`, cada resultado individual y `summary.json` en su carpeta fechada de `reports/evaluations`. El cierre añade la ruta, huellas y tabla de resultados sin reescribir esta declaración para que parezca predecir el resultado.

## Cola posterior predeclarada: K07 reparación y K14 investigación

Estos contrastes se declaran mientras la campaña de composición todavía está en curso. Se iniciarán después de que cierre, de forma secuencial, con las mismas fuentes congeladas. No se añadirá otro lote de llamadas simultáneas a la composición.

### K07: reparar una operación físicamente bloqueada

- Runner: `scripts/research-ablation.mjs --kind=repair --seeds=2 --budget=0.5 --episode-budget=0.1`.
- Escenario S23; semillas `research-ablation-01` y `research-ablation-02` idénticas dentro de cada par. Cuatro ejecuciones: dos semillas por `full_refresh` y `selective`.
- El evaluador crea el mismo preludio aprobado, con 300 L realmente cargados; bloquea las salidas del vehículo, recibe el bloqueo y después reabre una salida mediante una observación de campo. No entrega al candidato la ruta correcta ni el estado oculto.
- `full_refresh` vuelve a consultar inventario, vehículos, carreteras y mapa. `selective` usa las actualizaciones recibidas. Ambos conservan el mismo modelo, máximo de ocho llamadas, fuentes, permisos, revisión finita, física y presupuesto de $0,10 por episodio.
- Resultado funcional requerido: un borrador de reparación aprobado ejecuta el desvío y entrega **los 300 L originales**, con el mismo ID de operación y una sola operación de entrega. No se considera éxito una propuesta de reparación, un camión descargado en otro punto ni una segunda entrega que esconda el trabajo anterior.
- Medidas: demora simulada hasta el borrador y demora real del proveedor; consultas y sus clases; coste de herramientas y modelo; litros realmente recibidos; conservación del trabajo y del ledger; déficit nativo de agua; fallos, abstenciones, revisión rechazada y estados pendientes.
- El preludio lo construye el evaluador y no se atribuye al modelo. El contraste mide una política interna de actualización frente a otra, no demuestra superioridad frente a un equipo humano profesional ni que toda consulta omitida habría sido inútil.
- Un intento inexistente no se cuenta como reparación instantánea. Una reparación que termina sin prestación física falla aunque reduzca llamadas. Las excepciones del reporte individual (`error`, en singular, en esta prueba) se leen además del resumen para no perder fallos.

```powershell
node --env-file-if-exists=.env.local scripts/research-ablation.mjs --kind=repair --seeds=2 --budget=0.5 --episode-budget=0.1
```

### K14: consultar información de forma selectiva

- Runner: `scripts/research-ablation.mjs --kind=inquiry --seeds=1 --scenarios=S06,S11,S18 --budget=0.7 --episode-budget=0.1`.
- Seis ejecuciones: los tres escenarios, semilla `research-ablation-01`, tratamientos `broad_refresh` y `active` apareados por escenario.
- Ambos usan B6, tres rondas con intervalo simulado de 20 minutos, las mismas fuentes recibidas, permisos, recursos, revisión, modelo, máximo de llamadas y cap de $0,10 por episodio.
- `broad_refresh` actualiza inventario, vehículos, carreteras, documentos, mapa y capacidades antes de investigar. `active` permite solicitar los datos que faltan mediante las herramientas existentes, manteniendo las actualizaciones recibidas. No se cuenta como ahorro que un agente simplemente deje de resolver el problema.
- Medidas: consultas e inspecciones, clases consultadas, coste, demoras simuladas y reales, información obtenida, llamadas fallidas o abstenciones, servicio físico y déficit **por tipo nativo**, censura, integridad y estados pendientes.
- La pregunta es si la política de consulta selectiva preserva o mejora el servicio físico con menos atención y coste. Si hace menos consultas pero sirve menos o más tarde, se informa el intercambio desfavorable.
- Esta ablación no aporta anotación independiente de utilidad marginal de cada consulta. No se afirmará que el modelo descubrió la consulta óptima por observar una mejora agregada.

```powershell
node --env-file-if-exists=.env.local scripts/research-ablation.mjs --kind=inquiry --seeds=1 --scenarios=S06,S11,S18 --budget=0.7 --episode-budget=0.1
```

### Comparabilidad y cierre de las dos ablaciones

El runner fija antes de correr las huellas de candidato y evaluador, las semillas, presupuestos y tratamientos, y guarda cada resultado aunque falle. Las parejas deben coincidir en mundo, versión, horizonte, reloj, modelo, rondas y presupuesto; una pareja con huellas distintas se declara inválida, sin calcular una mejora. Se conservarán los datos si un error impide escribir el resumen y se calculará la lectura a partir de los resultados originales, sin repetir únicamente el caso que perdió.

Se informan costes conocidos y reservas desconocidas, errores individuales, walltime de proveedor y de herramientas cuando estén registrados y demora simulada por separado. Dos semillas de reparación y una semilla por escenario de investigación son evidencia exploratoria de mecanismo. No bastan para una estimación general robusta de porcentajes, eficiencia humana o vidas salvadas.

## Incidencia detectada durante la primera campaña

La primera ejecución utiliza la carpeta `reports/evaluations/1791834734815`, candidato `af94176a69fa9adf92b6f3db52d20c23ab7db39773c6b3f3de3e8b3d1e815384` y evaluador `0d201ba4a91efce0c31feb8748bdd6f4fcf501e54e26d77e7d0355bd23a43584`.

Antes de que termine, la auditoría detecta una amplificación de continuaciones y recibos: una ejecución incompleta crea un nuevo job; la repetición de un recibo incluye `observedAt` actualizado aunque no cambie la prestación física; ese cambio genera otro envío y el adaptador simulado cobra otro segundo. El vencimiento de jobs con reloj real y su drenado puede influir en cuántos segundos simulados se consumen. Por ello esta campaña **queda invalidada como comparación de tiempos**, incluso si todos los servicios llegan.

Se crea primero el stop-file acordado para no iniciar B7. Los dos B6 activos siguen ejecutándose porque el runner sólo comprueba ese archivo entre episodios. Después, por indicación de root, se termina inmediatamente la sesión con Ctrl-C para evitar seguir gastando inferencia en una corrida inválida. En Windows el proceso termina con código 1 **sin guardar el outcome ni el usage final de los episodios activos**.

Los resultados y costes existentes se conservan como diagnóstico; no se calculan ni se publican porcentajes de superioridad a partir de ellos. Persisten solamente las dos baselines B5. Los dos B6 se registran como `aborted_invalid_clock`, con llamadas y coste desconocidos (`null`, nunca cero), y se reserva conservadoramente su cap completo: $0,15 cada uno, $0,30 total. Esta reserva es un límite contable conservador, no un coste observado ni una factura. B7 nunca se inicia. El resumen se marca incompleto, inválido y sin comparaciones.

Las dos baselines ya completas ofrecen evidencia de mecanismo: cada una aloja físicamente a 50 personas con conservación válida; `distributed` además contiene la visita de una tripulación org3 y su recibo recibido por org0. Estas observaciones no rehabilitan la medición de tiempos.

K07 y K14 quedan en cola y no se lanzan todavía. Después de reparar la amplificación, verificar el código y congelar nuevas huellas, se necesitará volver a correr ambos brazos de cada comparación. No se combinarán baselines de estas huellas con candidatos de las siguientes.

## Reinicio autorizado tras reparación y verificación

Root autoriza repetir íntegramente el protocolo después de reparar las continuaciones/recibos, el polling de activación y las condiciones de autorización. Verificación registrada en `reports/verifications/1791837370142.json`: plataforma 215/215 y simulador 154/154; revisión UI 84 casos. Commit de fuentes `7cc8fd1`.

- Candidato: `d2a9932b684a1490907746f91bf6bcfd5a7b4de800179d0a56acbadce69ff800`.
- Evaluador: `0d201ba4a91efce0c31feb8748bdd6f4fcf501e54e26d77e7d0355bd23a43584`.
- Motor: `aaec663a4bc2f51065ab021159dac481cb174b079b724bc89ed270cc66fd2cee`.

Se repiten las seis ejecuciones, incluyendo ambas B5; mismas semillas, variantes, doce rondas, intervalo de cinco minutos, dos workers, cap $0,15 y presupuesto $0,75. La campaña anterior permanece invalidada y no aporta baselines a esta repetición. Se verifica la ruta absoluta del stop-file anterior antes de eliminar únicamente ese archivo. K07 y K14 siguen después de la composición, secuencialmente, con los protocolos declarados. Una desviación, fallo o nueva modificación de fuentes requiere registrar la incidencia antes de realizar otra corrección.

## Diagnóstico adverso del segundo build, antes de cualquier reparación

Carpeta del reinicio: `reports/evaluations/1791837825645`. Ambos B5 y ambos B6 ya han escrito su resultado. Por indicación de root se vuelve a crear el stop-file para evitar nuevos episodios: los dos B7 ya iniciados pueden terminar y conservar sus recibos. K07 y K14 permanecen pausados. No se edita ninguna fuente mientras los episodios están activos.

| Variante | Brazo | Refugio físico | Déficit de refugio (plaza·h) | Cobertura suficiente | Llamadas | Coste conocido |
| --- | --- | --- | --- | --- | --- | --- |
| distributed | B5 | 50/50 | 35,7195 | 51,3834 min | 0 | $0 |
| distributed | B6 | 0/50 | 200 | Censurado | 40 | $0,10111206 |
| delayed | B5 | 50/50 | 36,5695 | 52,1834 min | 0 | $0 |
| delayed | B6 | 50/50 | 67,1251 | 111,3501 min | 40 | $0,08527074 |

Los dos B6 tienen `status: failed` por alcanzar el límite de 40 llamadas de la organización, no por agotar el cap monetario de $0,15. En `delayed` esto **no** significa que el refugio quede sin servicio: las 50 personas sí llegan. Ambos sirven los 600 L de la necesidad ordinaria de agua, conservan los recibos de sus inspecciones físicas y no registran invariantes violados. Aun así, este build no demuestra una ventaja de NEXO sobre B5. La diferencia desfavorable y los costes se conservan.

La extracción reproducible está en `service-diagnosis.mjs` y `service-diagnosis.json`, dentro de la carpeta de la campaña; `physical-readout.json` conserva además la lectura física por dueño. La extracción evita copiar el estado privado del mundo al candidato: lee sólo el informe ya cerrado.

### Contradicción de almacenamiento físico en distributed

1. La ronda 1 prepara la entrega ordinaria de 600 L a `need-water-main`, situada en `b13`. El depósito de destino inicial pertenece a un dueño donante y esos litros se consumen al servir la necesidad.
2. La ronda 2 recibe una inspección física competente de org3, calcula correctamente las cuatro dependencias del refugio y prepara el plan compilado: personal, 162 L, energía compatible y saneamiento; después activación y tres traslados.
3. Las cuatro entregas de servicio llegan físicamente. La operación 5 lleva los 162 L del dueño org0 a **`stock-n13-water-org0`**, porque el ID base `stock-n13-water` ya pertenece a otro dueño. Los recibos de personal, energía y saneamiento también completan. Los tiempos recibidos son 1.430.016, 1.541.683, 1.460.683 y 1.978.669 ms, respectivamente.
4. `engine/operations.mjs` selecciona ese sufijo para separar la propiedad, pero `engine/facilities.mjs` busca sólo el ID base para comprobar dependencias, reservar equipo y consumir agua. El rechazo de activación queda registrado como `DEPENDENCY`. La búsqueda puede leer el depósito ordinario vacío de otro dueño en vez de las provisiones del refugio.

La corrección necesaria es una resolución consistente del depósito del **dueño de la instalación** en activación, reservas, compatibilidad, cualificaciones y consumo. No autoriza apropiarse del stock de otra organización. Debe probarse con una entrega ordinaria al mismo nodo antes de abastecer el refugio, además de los órdenes inverso y con depósitos ajenos presentes. Una inspección vigente y permiso siguen siendo obligatorios.

### Estado recibido y planificador de servicio

`servicePlan` resta únicamente el snapshot `facility.provisioned`, que en `distributed` permanece en cero desde la inspección de 1.005.013 ms. No descuenta entregas fuente confirmadas ni las reservas prospectivas que `responseQueue.planningHolds` ya conoce. Por eso las rondas 5 y 8 vuelven a calcular las cuatro entregas y las herramientas rechazan duplicar vehículos o pasos físicos ya completados. `delayed` también repite un servicio pendiente y más tarde traslados ya programados; el refugio llega a funcionar, pero el modelo consume otras rondas en errores `INSUFFICIENT_RESOURCE`, `VEHICLE_CONFLICT`, tipado y plazas.

Reparaciones de producto que se deben verificar antes del próximo build:

- Separar entrega destinada a una necesidad (consumida al recibirla) de provisión física de un servicio. No sumar sus litros entre sí.
- Utilizar recepciones fuente vinculadas a acción, destino y dueño exactos para identificar trabajo completado y consultar estado actual cuando haga falta. Una entrega pasada no garantiza que el stock siga disponible si hubo consumo, daño o retirada posterior.
- Descontar reservas de borradores, operaciones en tránsito y traslados pendientes. Cuando el trabajo necesario ya tiene dueños y autorización, devolver `wait_receipt` y los pendientes; no un nuevo plan duplicado.
- Usar la necesidad efectiva con recibos de evacuación, manteniendo censura y población restante; las plazas futuras de un traslado aprobado no son plazas ya servidas.
- Permitir reanudar los pasos futuros de un plan de servicio conservando todas las entregas completadas por dueños independientes. No volver a despachar lo ya recibido.
- Evitar una nueva inferencia automática sólo por mensajes de progreso del trabajo ya asignado. Un nuevo requisito, contradicción material, rechazo, permiso cambiado o petición manual sí debe poder reabrir el análisis.
- Probar los mismos casos con B5, B6 y B7 después de corregir el motor; estas reparaciones deterministas no se atribuyen a la capacidad generativa del modelo.

No se eleva el presupuesto para ocultar este bucle. El fallo exige corregir la causalidad y repetir pares completos bajo huellas nuevas, reteniendo esta etapa de diagnóstico. La evidencia anterior de un mecanismo que aloja 50 personas sigue siendo válida como fixture funcional, pero no cubría el orden adverso de entregas que aparece aquí.

## Cierre conservado de la segunda campaña

Las seis ejecuciones cerraron y escribieron sus resultados; no quedan episodios ni llamadas activas de este runner. La invalidación de la carpeta se aplica a **todas** las comparaciones de este build. Los B7 que estaban activos durante la modificación del motor conservan explícitamente `invalid_candidate_changed`. No se utilizan sus métricas para escoger un ganador ni se combinan con otras versiones.

| Variante | Brazo | Refugio físico | Llamadas | Coste conocido | Coste cargado con reservas desconocidas | Llamadas con coste desconocido |
| --- | --- | --- | --- | --- | --- | --- |
| distributed | B7 | 0/50 | 40 | $0,09789868 | $0,10761788 | 1 |
| delayed | B7 | 50/50 | 38 | $0,07789286 | $0,12424300 | 5 |

Total de la campaña: **$0,36217434 conocido; $0,41824368 cargado conservadoramente; seis costes de llamada desconocidos retenidos**. El coste desconocido nunca se transforma en cero. `physical-readout.json` deja las parejas como inválidas y sus mejoras porcentuales como `null`; los servicios físicos, estados negativos y recibos originales permanecen disponibles para diagnóstico.

## Reparaciones de producto verificadas antes de repetir la medición

Se implementan mecanismos deterministas, separados de cualquier beneficio generativo:

- `servicePlan` reconoce los planes de servicio pendientes, los vehículos y recursos reservados, y las cantidades restantes de necesidades con recibos físicos. No vuelve a abastecer un servicio operativo ni duplica traslados servidos o aprobados.
- Una provisión fuente-confirmada posterior al snapshot de una instalación solicita una consulta actual de esa instalación. La recepción identifica trabajo pasado; la disponibilidad procede del nuevo estado autorizado, por lo que consumo o daño posterior no se ocultan sumando entregas históricas. Una entrega consumida por una necesidad ordinaria no se reutiliza como provisión de refugio.
- La consulta de refresco está disponible igualmente en el adaptador convencional B5. No se cobra al modelo por sumar cantidades estructuradas ni se concede a NEXO un acceso exclusivo a recibos o estado actual.
- La investigación automática puede esperar recibos de trabajo ya asignado sin otra inferencia cuando no ha cambiado la información relevante. Un mensaje público de progreso sólo se reconoce sin inferencia si su texto, lugar, tipo y cantidad coinciden de forma inequívoca con una recepción física independiente. El post permanece sin verificar. Una nueva petición, contradicción, versión corregida, mensaje ambiguo o ausencia de recibo sigue llegando al modelo; la petición manual y reparación permanecen disponibles.
- Las inspecciones estructurales conservan sus requisitos de método físico, competencia, dueño, versión y vigencia. Ningún refresco de provisiones sustituye esos requisitos.

Verificación dirigida: **24/24** pruebas de recibos y progreso, inspección delegada física, recuperación convencional y composición de cuatro dueños; **14/14** pruebas de compatibilidad de seguridad, recuperación de checkpoints, política y capacidad concurrente. Son pruebas funcionales de regresión con proveedor registrado, no una nueva comparación pagada ni evidencia de ventaja en K01/K02. La mejora de KPIs queda pendiente de repetir los pares completos con las fuentes nuevas congeladas y conservar también los resultados desfavorables.

## Comparaciones persistidas y fallo transaccional: evidencia funcional adicional

Antes de la siguiente congelación se cierra un hueco de trazabilidad de las propuestas compiladas. Cuando el agente utiliza realmente `compare_responses`, la plataforma conserva un recibo privado y acotado de las opciones que devolvió esa herramienta. `prepare_allocation`, `prepare_service` y `prepare_repair` incorporan ese recibo y sus fuentes accesibles a la propuesta, además de hasta cuatro alternativas breves compatibles con la interfaz existente. El operador puede revisar lo que se comparó sin recibir todo el contexto de investigación en cada propuesta.

El recibo no lo inventa el modelo ni se admite como un nuevo campo público de su contrato de propuesta. Es metadato producido por el servidor en el ámbito de la organización. Contiene como máximo cinco opciones, cantidades acotadas, opciones omitidas y hasta sesenta dependencias de fuente. Una instalación conocida sólo por el directorio continúa como `pending_checks`; no se transforma en alternativa ejecutable, seguridad certificada o permiso del dueño. Si no se realizó una comparación, las alternativas compiladas permanecen vacías: no se exige otra llamada ni se crea una comparación ficticia.

La comparación se guarda en el checkpoint de investigación y se revalida antes de preparar una elección. Se comprueban las opciones materiales, los hechos recibidos, la versión de fuente o de objetivo, los permisos y la vigencia real. Una inspección física caducada se detecta con el reloj de su fuente. También se conserva la ausencia de una evaluación de instalación: recibir después una evaluación nueva exige revisar la comparación anterior. Las lecturas idénticas de mapa, inspección u operación pueden aumentar una revisión interna de base de datos sin cambiar los hechos; ese refresco, `capturedAt` o un timestamp de lectura no invalida por sí solo la comparación.

La aprobación humana vuelve a comprobar las dependencias del recibo. Si cambian una alternativa, el permiso o la política, no se aprueba silenciosamente la elección antigua; rechazar o pedir aclaración sigue siendo posible. Una revisión manual invalida la comparación vigente y conserva su historial. Las alternativas de una reparación dejan explícito que una nueva entrega no recupera un viaje ya cargado; las cantidades parciales tampoco se presentan como si se hubiese elegido toda la capacidad disponible. Cada dueño mantiene su autorización independiente.

Se añade además una inyección acotada de fallo de escritura de base de datos, con código `08006`, después de escribir entidad, job y auditoría y antes de persistir el recibo idempotente final. La transacción revierte esos cuatro efectos conjuntamente, mantiene un comando anterior confirmado y permite reintentar la misma clave. El reintento confirma una sola propuesta, una sola notificación y una sola entrada de auditoría; una tercera solicitud idéntica recupera el resultado sin ejecutar de nuevo el callback. Esta prueba utiliza PGlite local e inyección en la llamada de escritura: **no** representa una caída real de PostgreSQL remoto ni una prueba destructiva de disco lleno.

Comando de verificación dirigido:

```powershell
node --test --test-concurrency=1 tests/response-comparison.test.mjs tests/storage-fault.test.mjs tests/received-allocation.test.mjs tests/investigation-checkpoint.test.mjs
```

Resultado: **18/18 PASS**. El subconjunto incluye preparación compilada de asignación y servicio con comparación real, rechazo de evidencia o permisos cambiados, vigencia física, refrescos equivalentes, separación de organizaciones, ausencia honesta de alternativas, reparación física del mismo cargamento y entrega multiowner, recuperación de checkpoint y rollback/reintento transaccional. Los proveedores de estas pruebas son fixtures registrados o replay, sin nuevas llamadas pagadas.

Esta evidencia acredita **mecanismo funcional y protección de trazabilidad**. No mide calidad semántica del proveedor real, comprensión humana de las alternativas, mejora de tiempo de respuesta ni superioridad frente a B5/B7. Tampoco traslada los resultados de campañas anteriores al candidato nuevo. K01/K02 y los contrastes S19, K07 y K14 requieren nuevas ejecuciones completas con los tres hashes congelados, sus controles, resultados negativos, censura y costes conservados.
