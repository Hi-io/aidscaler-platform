# Por qué interpretar antes no adelantó la ayuda en el primario original

Auditoría de lectura del expediente histórico `reports/discovery/1791842491166`. No se ejecutó ningún modelo ni se modificaron los episodios. Los cálculos por necesidad y las nueve referencias exactas están en [el artefacto de auditoría](../reports/audits/temporal-old-primary-1791842491166.json). Las fuentes posteriores requieren una comparación nueva: este documento no las acredita.

## Resultado que debe permanecer visible

Tres semillas independientes, 24 necesidades por mundo, 192 mensajes de ruido y dos republicaciones por petición. B5 y B6 atendieron **72/72 necesidades**, sin errores ni infracciones físicas registradas y con las tres huellas iniciales/finales iguales en cada episodio.

| Referencia | Tiempo medio restringido hasta ayuda suficiente | Lectura correcta |
|---|---:|---|
| B5, convencional competente | 32.070 min | Referencia más fuerte de este primario |
| B6, interpretación con el modelo configurado | 34.540 min | **7.704% más lento**, +2.471 min por necesidad |
| B8, detector de palabras/localizaciones | 35.948 min | B6 mejora 3.915% en promedio, pero pierde contra B8 en una semilla; no hay superioridad consistente |

El coste B6 de los tres mundos fue USD 0.01496978 y 23 llamadas. Es un piloto interno sintético; no mide productividad humana de campo, Gemini ni vidas salvadas. Los tres mundos negativos frente a B5 no se pueden sustituir por los recursos o semillas favorables.

## La percepción sí adelantó consultas; su conversión en servicio falló

La descomposición siguiente es aritmética de las operaciones físicas del scorer, utilizadas **sólo después** de ejecutar. Cada necesidad recibió una sola carga suficiente en este expediente: primer servicio útil y suficiente coinciden. No generalizar esa coincidencia a suministros parciales u otros escenarios.

| Tramo | Diferencia media B6 menos B5 |
|---|---:|
| Inicio de la necesidad → autorización física | +1.856 min |
| Autorización → salida cargada, incluyendo comando, pickup y carga | +0.301 min |
| Salida cargada → llegada | +0.314 min |
| Llegada → servicio recibido | 0.000 min |
| Total | +2.471 min |

El 75.1% de la diferencia aritmética aparece antes de la autorización. Ese tramo **no equivale a percepción**: incluye clarificación, disponibilidad de stock/flota, esperas de borradores, revisión del dueño y recepción de información. El expediente histórico no conserva todos los timestamps de esos subtramos. En el JSON son `null`; no se inventa una fecha de confirmación a partir del ACK de una consulta.

Sí hay evidencia de interpretación útil: para 25 de las 72 localizaciones, B6 obtuvo el recibo de una solicitud de clarificación antes que B5. El timestamp del lote devuelto es un límite superior/proxy del envío de esas consultas, **no una comprobación completada**. La ventaja de ese proxy fue ~14.14 min por localización adelantada, pero la ventaja media de servicio de ese grupo fue sólo **1.159 min**. Las otras 47 localizaciones tenían el mismo envío directo inicial en ambos brazos y acabaron **4.401 min más tarde** con B6. Los grupos son una atribución descriptiva posterior, no subgrupos confirmatorios predeclarados.

Todas las necesidades de comida pertenecen al grupo del mismo envío inicial: los patrones comunes ya encontraban sus localizaciones sin modelo. La exactitud de la resta de porciones no aceleraba ese paso, porque una clarificación ordinaria posterior entregaba la demanda actual completa a cualquier brazo.

## Tres mecanismos concretos que explican el problema

### 1. La información temprana llega a una cola que no es el camino crítico

En la primera semilla B6 reconoció los ocho nuevos destinos contextuales y solicitó sus comprobaciones entre ~2.28 y ~3.03 min. B5 acabó solicitando varios de ellos mucho después. Sin embargo, la flota seguía ocupada con las peticiones ya recibidas. Por ejemplo, `b37` se solicitó a ~2.53 min con B6 y ~15.58 min con B5; B6 autorizó la carga a 30.48 min frente a 17.13 min de B5 y la sirvió a 44.38 frente a 31.35 min. Encontrarlo antes no hizo disponible un camión.

No hay evidencia de que duplicar comprobaciones explique este negativo: ambos brazos completaron **24 verificaciones por mundo**, y el registro B6 muestra reutilización de comprobaciones pendientes entre lotes. Tampoco el wall de SQL/HTTP se convirtió por definición en horas virtuales: queda separado. Las 7–8 llamadas B6 por mundo se cargaron al reloj con el máximo de latencia declarada y wall real; los 15 s mínimos por llamada forman parte del coste temporal explícito.

La versión histórica de `evaluation/harness.mjs` adelantaba el mundo hasta completar cada revisión de la fuente dentro del `sourceFetcher`; `evaluation/discovery-benchmark.mjs` no desactivaba esa espera. Ambos brazos tenían ese mismo comportamiento, pero el orden de borradores/modelo podía cambiar las oportunidades de asignación mientras avanzaba el mundo. La versión nueva separa revisión pendiente, continuidad y recepción. Es una corrección compartida del workflow y del experimento, no una ventaja atribuible a GenAI.

**Cambio productivo legítimo:** mantener progreso físico, revisión y planificación por cambios materiales independientes de la interpretación de otra tanda. Publicar hipótesis accionables ya fundamentadas sin esperar a leer toda la cola; conservar las fuentes pendientes y la autorización exacta. No volver a preguntar al modelo por una espera cuya dependencia ya está registrada.

**Prueba justa si el candidato nuevo sigue negativo:** mismos bytes, colas de clarificación/revisión y cadencia en B5/B6/B8/B9; timestamps pasivos de recepción original, interpretación, solicitud, **recibo completo entregado**, borrador, autorización y servicio. Control con todas las necesidades estructuradas desde el comienzo. Si sólo cambia la espera de revisión, reportarlo como mejora común, no semántica. No aumentar el tiempo de lectura del convencional hasta obtener ventaja.

### 2. Una asignación irreversible por oleadas puede desperdiciar la ventaja de conocimiento

| Semilla y necesidad | Diferencia de servicio B6−B5 | Hasta autorización | Pickup/preparación posterior | Viaje cargado |
|---|---:|---:|---:|---:|
| 01, `b25`, 17 porciones | +22.13 min | +7.97 | +7.29 | +6.88 |
| 01, `b43`, 25 porciones | +15.93 min | +1.77 | +14.38 | −0.21 |
| 02, `b57`, 60 L | +39.77 min | +37.90 | +6.04 | −4.17 |
| 03, `b69`, 21 porciones | +29.79 min | +18.75 | +4.79 | +6.25 |

En `b43` el retraso no se explica por leer su publicación: ambos brazos dirigieron la consulta inicial a ~2.03 min. B5 usó `v-org1-1`; B6, `v-org3-1`. El pickup de ese segundo vehículo consumió **14.38 min adicionales**. La distancia total B6 frente a B5 fue 168/162 km, 178.5/175.5 km y 221.25/202.5 km en las tres semillas. Todos los recursos empeoraron en promedio: agua +1.914 min, comida +3.313 min, mantas +2.185 min.

El planificador común actual admite necesidades según la política aprobada y mejora mediante intercambios la asignación de la **tanda concurrente**. No es una optimización completa de la secuencia posterior de camiones, y no puede intercambiar una orden ya emitida como si nunca hubiera existido. Más información cambia qué trabajos están disponibles al admitir una tanda; con un algoritmo miope ese cambio puede empeorar el resultado físico.

**Cambio productivo legítimo:** comparar alternativas sobre demanda, recursos, posiciones, compromisos y ETA **recibidos**, incluyendo el coste de pickup y las siguientes necesidades ya conocidas. Una alternativa puede esperar una liberación próxima documentada en vez de emitir una ruta lejana, sólo si la política aprobada permite esa espera y mantiene las ventanas/prioridades. Revalidar y pedir revisión ante cambios de acciones; preservar cargas, reservas y costes ya emitidos. No usar necesidades futuras privadas ni liberar un vehículo ocupado para el solver.

**Prueba justa:** primero snapshots recibidos con dos camiones y dos/tres demandas que revelen el cruce o pickup evitable; después mundos completos de semillas predeclaradas. El mismo algoritmo y reglas de admisión deben estar disponibles en todos los brazos. Registrar km, combustible, oportunidad perdida, ventana incumplida y déficit nativo. Un beneficio del solver compartido prueba ingeniería operativa; sólo la diferencia adicional de información útil acredita la interpretación.

Estos registros muestran consecuencias físicas y rutas diferentes, pero no identifican por sí solos una asignación alternativa causal única. No afirmar que un swap hipotético habría eliminado exactamente todo el retraso sin ejecutarlo bajo los mismos permisos y restricciones.

### 3. El benchmark evalúa principalmente «qué edificio consultar», no la complejidad prometida

`generators/response-benchmark.mjs` genera tres familias de demanda, IDs públicos literales, cantidades pequeñas y redacciones repetidas de resta. La clarificación devuelve toda la necesidad actual. Los rumores, archivos explícitos y contexto sin cantidad añaden lectura/consultas; no cambian compatibilidad, capacidad, siguiente compromiso o una decisión física viable. El primario tenía tráfico y pérdida de paquetes cero, cuatro organizaciones con capacidad consentida desde el inicio, reportes de demanda al principio y sin demanda recurrente. Las etiquetas audio/foto/video llevan texto/caption: este primario no acredita lectura de bytes multimedia.

El detector convencional competente puede dirigir una comprobación con una palabra de recurso y una localización sin resolver la aritmética. B6 procesa el significado, pero el compilador recibe después la misma respuesta formal. Más ruido del mismo tipo puede ensayar throughput; **no añade por sí solo razonamiento operacional complejo**. Mantener este primario como control, aunque sea negativo.

La plataforma aislada ya cuenta con un hook común `src/source-opportunities.mjs`: restricción/capacidad/corrección recibida → entidad en directorio recibido → consulta tipada normal → recibo → compilación/reparación del mismo cargo → dueño. No crea permisos o cierres desde texto y no acepta una historia antigua como estado actual. Eso hace posible evaluar un mecanismo más cercano al concepto, pero todavía necesita una comparación física que lo acredite.

**Siguiente familia mínima, sólo si los nuevos resultados justifican estudiarla:** un cargamento ya autorizado queda bloqueado; varios boletines actuales/antiguos, alias y límites de peso describen corredores distintos. La interpretación debe relacionar la restricción con **la masa real de ese cargo**, dirigir una consulta pertinente y recuperar la misma operación tras permiso. Variante de capacidad: retorno vacío, turno y permiso publicados por el dueño que requieren refrescar la ventana/capacidad recibida antes de reutilizar el camión; nunca autorizar un vehículo todavía ocupado basándose en un post.

**Controles indispensables:** hechos actuales estructurados; toda ruta inviable; corrección recibida tarde; permiso denegado; lector sin retraso; detector topológico fuerte B8 y agente general B9 con las mismas herramientas/modelo/caps. B8 puede consultar opciones plausibles y B5 comprender fechas/negaciones comunes, sin límites artificiales de incompetencia. El coste de cada pregunta proviene de una cola física compartida, no de una multa exclusiva al baseline. No colocar la solución en el prompt ni escoger un mundo ganador después.

## Decisión de desarrollo y evidencia

1. Cerrar y verificar los defectos de continuidad, holds, transporte, permisos y límites físicos comunes; conservar los expedientes de las versiones anteriores.
2. Leer el primario nuevo por etapas. Si la percepción adelanta un recibo útil pero sigue perdiendo después, priorizar workflow/asignación y no gastar en aumentar el ruido.
3. Sólo evaluar una familia contextual adicional cuando exista una consulta o combinación verificable que pueda cambiar una decisión **antes** de comprometer el recurso. Antes de pagar, el control B5/B8 debe mostrar una oportunidad física real; si ya recibe todo lo pertinente a tiempo, no hay margen semántico en ese caso.

No hay un cambio legítimo que garantice un KPI positivo. La meta es encontrar y corregir una pérdida operacional real, y medir una ventaja física sustancial donde la interpretación aporte información decisiva, preservando censura, denominadores, negativos y referencias competentes.
