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

## Enmienda previa al reinicio sobre el candidato reparado

Antes de iniciar S19 se registra una modificación de **orquestación del host**: la repetición utiliza `--workers=1` para no añadir dos campañas pagadas simultáneas al estudio de fuentes que root ya ejecuta. Esta cantidad limita mundos ejecutados en paralelo; no modifica personal, consultas físicas, revisión, recursos, comunicación ni ningún supuesto del mundo simulado. Las variantes `distributed`/`delayed`, sus semillas, los tres brazos, doce rondas, intervalo de cinco minutos y caps originales de $0,15 por episodio/$0,75 total se mantienen.

La congelación autorizada es `reports/frozen-candidate-repaired-1791842535794.json`, verificada con 274 pruebas de plataforma, 173 de simulador y 84 comprobaciones UI. El preflight exige los hashes completos de candidato, evaluador y simulador declarados en ese archivo; no utiliza sólo sus abreviaturas. El stop-file de esta repetición es **nuevo**: `.local/STOP_DELEGATED_REPAIRED`. No se borra el archivo de parada de campañas anteriores ni se reaprovechan sus resultados como baseline.

K07 y K14 quedan en cola. No se lanzan hasta que la campaña S19 cierre, escriba resultados/usage y se notifique a root. Un defecto nuevo se informa y conserva antes de cambiar fuentes; mientras haya campañas activas se mantiene la congelación.

```powershell
node --env-file-if-exists=.env.local scripts/parallel-campaign.mjs --scenarios=S19 --arms=B5,B6,B7 --seeds=1 --composition-variants=distributed,delayed --seed-prefix=delegated-final-2026- --rounds=12 --interval-ms=300000 --workers=1 --budget=0.75 --episode-budget=0.15 --stop-file=.local/STOP_DELEGATED_REPAIRED
```

## Diagnóstico parcial del reinicio: no equivale a cierre de KPIs

Carpeta de resultados: `reports/evaluations/1791842687348`. Al escribir este diagnóstico han cerrado los brazos B5 y B6 de `distributed`; los otros cuatro resultados permanecen pendientes. `native-guardrails-readout.json` conserva explícitamente esa incompletitud. No se copia un resultado anterior ni se selecciona una variante favorable.

| distributed | B5 | B6 |
| --- | --- | --- |
| Agua física | 600/600 L | 600/600 L |
| Refugio físico | 50/50 plazas | 50/50 plazas |
| Déficit de agua | 685.800.900 L·ms | 542.144.500 L·ms |
| Déficit de refugio | 125.760.170 plazas·ms | 158.550.160 plazas·ms |
| Cobertura suficiente de refugio | 50,3334 min | 61,3167 min |
| Estado de episodio | `completed` | `failed`: `PROVIDER_TIMEOUT` en ronda 11 |
| Llamadas de modelo | 0 | 34 |
| Coste conocido | $0 | $0,06558776 |
| Coste con reservas desconocidas | $0 | $0,09493652; tres llamadas desconocidas |
| Invariantes violados | 0 | 0 |

El agua mejora su déficit un 20,95%, pero el refugio empeora un 26,07% y se completa después de su ventana útil de una hora. Ambos brazos conservan una inspección física delegada y las dependencias reales del refugio. Esto demuestra el mecanismo compuesto; **no** demuestra una ventaja general de NEXO. El estado fallido del proveedor se conserva aunque los viajes físicos ya emitidos terminen sirviendo a las 50 personas.

En B6, 881,12 de los 938,34 segundos de ejecución real corresponden a llamadas al proveedor (93,9%). Las rondas 4 a 9 esperan recibos sin nuevas inferencias. La ronda 10 vuelve a consumir ocho llamadas sin producir un borrador: el planificador declara veinte plazas pendientes y diez retenidas pese a haber completado ya una primera evacuación de veinte personas. También se registran lecturas fallidas del ID de una propuesta como si fuese un `peer_offer` o `evidence_group`, por lo que no toda la espera se explica por latencia del proveedor.

La auditoría de sólo lectura identifica un recibo físico incompleto: `engine/tasks.mjs`, en `evacuation_receive`, sirve la necesidad y registra `times.service`, `times.received` y `state: completed`, pero no registra la cantidad numérica `operation.received`. Las tres evacuaciones propias del informe cerrado tienen ese campo ausente. `effectiveNeed` exige una cantidad física finita; por tanto no puede sumar esa recepción a un snapshot anterior de la necesidad. El mismo contrato estricto protege los recibos entre organizaciones, así que no debe sustituirse por una cantidad inventada en la plataforma.

La siguiente versión debe registrar en el motor la cantidad de pasajeros efectivamente alojados antes de vaciar el vehículo. La regresión necesaria combina una necesidad de 50 plazas, un snapshot atrasado, veinte plazas ya recibidas, veinte en tránsito y diez retenidas por pasos futuros del mismo plan: el planificador debe declarar cero cantidad disponible para otro plan, esperar los recibos y evitar nuevas inferencias automáticas. Deben comprobarse tanto el dueño local como un recibo de otro dueño, deduplicación, fallo o redirección de viaje y ausencia de doble servicio. Se conserva este diagnóstico antes de cualquier cambio; las fuentes de la campaña continúan congeladas.

## Cierre del reinicio y siguiente reparación aislada

La carpeta `1791842687348` cierra sus **seis resultados completos**, sin episodios faltantes ni llamadas activas. Los tres hashes se mantienen durante toda esta campaña. `native-guardrails-readout.json` y `source-receipt-diagnosis.json` se actualizan con los seis brazos; los fallos de proveedor no se eliminan de las parejas.

| Variante | Brazo | Agua suficiente | Refugio suficiente | Déficit de refugio, plazas·h | Llamadas | Estado |
| --- | --- | --- | --- | --- | --- | --- |
| distributed | B5 | 19,5223 min | 50,3334 min | 34,9334 | 0 | completed |
| distributed | B6 | 15,6225 min | 61,3167 min | 44,0417 | 34 | failed, timeout ronda 11 |
| distributed | B7 | 14,8725 min | 59,4834 min | 43,1250 | 24 | completed |
| delayed | B5 | 19,1223 min | 52,1834 min | 36,5362 | 0 | completed |
| delayed | B6 | 12,3056 min | 53,2334 min | 40,1445 | 16 | completed |
| delayed | B7 | 20,9392 min | 52,1167 min | 37,0750 | 27 | failed, timeout ronda 8 |

Todos sirven físicamente 600 L y alojan a 50 personas; ninguno viola invariantes. Los dos B6 mejoran el déficit de agua un 20,95% y 37,87%, respectivamente, pero empeoran el de refugio un 26,07% y 9,88%. El B7 distributed mejora agua un 24,88% y empeora refugio un 23,45%; delayed empeora ambos déficits, agua un 9,61% y refugio un 1,47%. La finalización suficiente por sí sola tampoco describe todo el recorrido: delayed B7 termina el refugio ligeramente antes, pero su déficit acumulado sigue siendo peor. No se mezclan litros con plazas ni se presenta uno de estos tradeoffs como una superioridad general.

Coste total conservado: **101 llamadas, $0,20712080 conocido y $0,25660852 cargado con reservas de cinco costes desconocidos**. Los dos timeouts terminales permanecen como resultados fallidos, aunque el trabajo físico emitido llegue a terminar. Este piloto explora dos mundos predeclarados; no mide efectividad de campo, vidas salvadas ni confianza humana.

Una segunda causa de la demora precede a los recibos ausentes. `responseQueue` de este build sólo crea reservas prospectivas para `dispatch` y `evacuate`; la evaluación física `verify` queda fuera. En distributed B6, el borrador de evaluación usa `v-org3-0` en ronda 0 y la entrega ordinaria vuelve a asignar ese mismo vehículo en ronda 1. La entrega sirve su carga a 937.352 ms; la inspección física empieza a 953.017 ms y termina a 1.013.017 ms. La ronda 2 no consigue un servicio listo y consume ocho llamadas; el servicio se prepara recién en ronda 3. B5 lo prepara en ronda 1. Corregir el recibo de evacuación elimina sondeos tardíos, pero no puede borrar retroactivamente esta demora inicial.

La reparación determinista compartida debe extender las reservas prospectivas al vehículo y un miembro de personal de una evaluación física, en el ámbito exacto del dueño. Una persona reservada para inspeccionar no se contabiliza como ayuda servida. Si el snapshot del dueño ya incluye una reserva física, no se resta dos veces al personal; el vehículo sigue ocupado hasta una recepción terminal. Rechazar una propuesta todavía no emitida libera sólo su asignación prospectiva. La misma protección debe aplicarse a los compiladores utilizados por las referencias convencionales y el modelo.

Las herramientas también ofrecen instrucciones ambiguas que consumen llamadas sin mejorar el plan: `verify` no explicita en su descripción que no confirma directamente un recurso privado de otro dueño; `lookup` de capacidades necesita `org`; `read_context` de `peer_offer` filtra `type` por el tipo de recurso proyectado, no por el valor `resource` del campo `kind`. Además `compose_service` revisa una plantilla genérica, mientras `plan_service` comprueba la instalación, flota y cantidades concretas. Indicar una fuente real, dueño, motivo de carencia y próximo acceso permitido puede evitar intentos `ACCESS`/`NOT_FOUND`; no autoriza consultar inventarios privados ni presume capacidad futura disponible.

En la copia de desarrollo aislada se añaden regresiones de producto, sin modificar las fuentes main de esta campaña: tres pruebas de recibos propios/peer y cola serial; seis pruebas de reservas de evaluaciones propias/peer, liberación y ausencia de doble reserva; y una prueba física de evaluación y entrega concurrentes con **la flota original**, sin dotación añadida ni llamadas pagadas. La prueba física obtiene directorio, metadata, cantidades y permisos mediante las fuentes; utiliza una inspección competente y entrega agua en otro vehículo real, conservando invariantes. Estos PASS acreditan mecanismo y prevención de colisiones. La ventaja de KPIs de la versión aislada exige otra congelación y medición; no se transfiere ningún porcentaje de esta campaña al candidato corregido.

## Preparación de las ablaciones de reparación y consulta, todavía sin pago

Se prepara `.candidate-development/nexo-platform/.local/research-studies-controlled.mjs`, fuera de las fuentes del producto. No se ha lanzado ninguna de estas mediciones nuevas. El runner exige un GO explícito del coordinador y un freeze verificado con los tres hashes; mantiene **un único episodio activo** y un lock propio. Sus tratamientos, semillas, física y revisión no cambian respecto del protocolo registrado: K07 usa S23, dos semillas, `full_refresh/selective`, cuatro episodios, presupuesto total de $0,50 y tope de $0,10 por episodio; K14 usa S06/S11/S18, una semilla, `broad_refresh/active`, seis episodios, $0,70 total y $0,10 por episodio. No se heredan resultados de versiones anteriores para ahorrar un brazo.

Antes de iniciar cada episodio guarda la reserva y la identidad del trabajo activo. Conservará fallos, coste conocido, costes desconocidos reservados, censura, casos no intentados y cualquier interrupción. K14 utiliza la parada segura del evaluador tras terminar el trabajo de proveedor activo; K07 termina primero su episodio finito. Los archivos `STOP_RESEARCH_K07_CANDIDATE` y `STOP_RESEARCH_K14_CANDIDATE` son nuevos: los stopfiles históricos no se borran. Los readouts conservan unidades nativas y rechazan comparar builds, modelos, seeds, clocks o presupuestos diferentes.

La instrumentación K07 de la copia aislada registra la primera recepción operacional del bloqueo, recepción de la alternativa, comienzo de investigación, borrador, autorización, emisión, reroute recibido y servicio del **mismo ID de operación original**. Llegada o 300 L autorizados no equivalen a 300 L recibidos. Un recibo parcial registra primera ayuda, pero conserva censura de recuperación suficiente. Los stages ausentes, incluso por fallo del modelo, quedan censurados al horizonte fijo; no se presentan como reparación instantánea. El controlador posterior al borrador termina por propuesta y recibo de origen recibidos, en vez de mirar la demanda privada para decidir cuándo parar; la perturbación y el scoring privados permanecen sólo en el evaluador.

El subset aislado de recibos/holds pasó **17/17**. Las cuatro pruebas puras nuevas de tiempos K07 y las seis de orientación por bloqueo exacto, junto con cinco previas de herramientas, pasaron **15/15**; ninguno hizo inferencia pagada. Las herramientas distinguen stock, transporte, cualificación, compatibilidad, expiración y holds; no envían siempre al modelo a consultar otro inventario. Sólo un workflow activo del mismo sitio puede recomendar espera. Estos resultados acreditan contratos y mecanismos: no acreditan aún K07/K14 ni una ventaja temporal del build nuevo.

### Inventario de evidencia local que sigue pendiente

| Frente | Qué debe cerrarse en la nueva versión | Métricas y límites |
| --- | --- | --- |
| Integridad de la versión | Fullgate, UI y regresiones de acuse, dotación mixta, cola, inventario utilizable, caída de proceso y almacenamiento lleno; repetir viajes afectados | T01–T06/T09–T14/T19, K06/K26/K28. Tres hashes estables y cero pérdidas/dobles consumos observados; la prueba de error DB simulada no reemplaza crash/ENOSPC. |
| Tiempo útil frente a referencia | Primario y todos los controles declarados, conservando la familia original negativa | K01/K02/K03/K08/K15: déficit nativo, primera ayuda/suficiencia, RMST/cola, cobertura/plazos y censura por mundo y grupo; no regalar recursos o penalizar el baseline para conseguir mejora. |
| Servicio colectivo | Repetir distributed/delayed con recibos de evacuación, crew holds y competencias corregidos | C1/C2/C7, K04/K10: aporte de cada dueño, evaluación física vigente, stock/trabajo/permiso y ocupación/continuidad. Separar capacidad funcional de superioridad del modelo. |
| Investigación y reparación | Ejecutar K07 y K14 recién congelados, incluyendo imposibles y fallos | K07/K14/K16: embudo completo, preguntas, demora/coste, preservación de carga y recuperación útil. Menos queries sin servicio no es ganancia. |
| Diferenciación y transferencia | Agente general del mismo modelo/herramientas/presupuesto y variación interna estructural/semántica no usada para ajustar después del resultado | K11–K13/K15/K18: detección por necesidad accesible, errores/links vigentes y caída de calidad; no llamar independiente al corpus interno ni B8 al agente general. |
| Recuperación y escala combinadas | Nominal con proveedor real, versiones durables, fuentes rechazadas/pendientes, revisiones concurrentes finitas y burst acotado | T16/K17/K22/K24/K27: backlog máximo/cierre/censura, colas, latencias por stage y resultados físicos. La curva de ingesta 1/4/12×10/100/1000 no acredita esa misma curva de decisiones útiles. |
| Costes y tradeoffs | Readouts actuales de todas las campañas, incluidos negativos y desconocidos | K05/K08/K09/K10/K16/K24/K25: exceso y faltantes juntos, km/fuel/horas reales, tiempos por stage y coste por ayuda útil. Si la referencia no tiene exceso, no inventar reducción porcentual. |

La fase local no puede cerrar con automatización los estudios de operadores/público K20/K21/K23, calibración/etiquetado/holdout independiente K11–K13/K18/K19, adopción y permisos institucionales K29, Gemini ni GCP. H1/K30 sigue opcional; no se añade como condición nueva. Medios con bytes, UI por roles, fondos sandbox, backups y conectores ya tienen mecanismos y evidencia local de sus versiones: mantener sus límites y repetir el subconjunto afectado cuando cambie su código, sin convertirlos en precisión de campo, fondos reales o comprensión humana demostrada.

## Ensayo de contexto y transferencia preparados, todavía sin campaña nueva

La revisión de negativos concluye que cantidades mejor interpretadas no adelantan por sí mismas una entrega cuando el detector convencional ya identifica el lugar y la misma comprobación devuelve la demanda autorizada. La evidencia debe mostrar una consulta o elección diferente que reduzca el camino crítico físico. Una flota compartida puede absorber la ventaja informativa o perjudicar otro servicio; los déficits de agua y refugio permanecen separados.

El evaluator aislado de contexto de rutas corrige tres defectos metodológicos: B5 lee en slots finitos paralelos y empieza las comprobaciones al terminar cada lectura, no después de todo el lote; todos los brazos reciben comprobaciones asíncronas y continúan sin reinterpretar versiones idénticas; la parada del controlador exige el recibo auténtico y suficiente de su operación original, o un horizonte fijo. La cadencia física común es de 10 segundos y no depende de una consulta al observador sobre `need.served`. La primera suite de siete casos tuvo cinco PASS y dos `invalid_candidate_changed` durante cambios concurrentes: esos dos resultados se conservan invalidados y esperan la repetición del gate global. Los fixtures grabados no son resultados de un proveedor real ni ganancia temporal.

Se prepara también K18 con dos mundos modestos, 12 necesidades y 96 posts de ruido: mapa compacto 9/6 km y regional 13/12 km, semillas nuevas fijadas, B5/B6/B8, 25% de comunidades silenciosas, tráfico y pérdida de paquetes iguales por par. El runner ignorado exige tres huellas de la nueva versión y GO explícito, mantiene un episodio host por vez, cap de USD 0.15 por episodio pagado y USD 0.40 total, y conserva fallos/censura/uso desconocido. `--plan` y la comprobación de sintaxis pasaron; **no se ha ejecutado**. Esto es transferencia geométrica interna: el generador actual conserva los mismos textos ingleses y la mezcla water/food/blankets, por lo que no acredita idiomas, servicios nuevos ni validación independiente.
