# NEXO: menos espera antes de activar la ayuda

Comparación registrada del 13 de octubre de 2026. Misma semilla, recursos y reglas físicas; 24 necesidades por método. Modelo realmente utilizado: **Gemma 4 31B**.

**Preparar y autorizar la respuesta: 28,28 → 19,66 min, 30,49% menos.** Son 8,62 minutos menos de espera antes de autorizar la ayuda, en promedio por necesidad.

**Ayuda suficiente recibida: 44,28 → 35,16 min, 20,59% menos.** Este segundo indicador incluye el recorrido físico. Ambos cubrieron 24/24 necesidades.

## Dos relojes que responden preguntas diferentes

El primero pregunta cuánto tardamos en preparar y autorizar una respuesta. El segundo pregunta cuánto espera el punto afectado hasta recibir ayuda suficiente. Mostrar los dos hace visible el ahorro de coordinación aunque un trayecto largo domine la espera total.

Ejemplo ilustrativo, **no resultado del ensayo**: con un viaje fijo de 20 h, pasar de 2 h de coordinación a 5 min supone **95,83% menos coordinación** y **1 h 55 min de espera evitada**. El total pasa de 22 h a 20 h 05 min: **8,71% menos tiempo total**. Ambos porcentajes son correctos y describen cosas distintas.

## Operaciones excluyendo ambos trayectos del envío

**30,29 → 21,67 minutos: 28,46% menos.** Esta lectura auxiliar usa los timestamps ya registrados de los 24 envíos por método.

| Métrica | Convencional | NEXO + Gemma 4 | Cambio | Qué representa para la respuesta y las personas que esperan |
|---|---:|---:|---|---|
| Tiempo operativo sin trayectos del envío (min) | 30,295 | 21,673 | 28,46% menos | Menos es mejor. Conserva preparación/autorización, transmisión, carga y descarga; excluye desplazamiento a recogida y viaje cargado. La espera previa por flota ocupada sigue dentro: no es sólo tiempo de pensar. |

Se descuenta el desplazamiento a recogida (pickupDispatched → pickupArrived, o 0 si el vehículo ya estaba allí) y el viaje con carga (dispatched → arrived). La transmisión, carga y descarga permanecen dentro, igual que cualquier espera previa por flota ocupada. No sustituye el KPI original de recepción ni mide exclusivamente trabajo intelectual.

## Desglose de tiempos registrados

Todos los tiempos de esta tabla son medias en minutos, con 24/24 etapas observadas por método.

| Métrica | Convencional | NEXO + Gemma 4 | Cambio | Qué representa para la respuesta y las personas que esperan |
|---|---:|---:|---|---|
| Preparar y autorizar la respuesta | 28,278 | 19,656 | 30,49% menos | Menos es mejor. Desde que aparece la necesidad hasta autorizar la ayuda: menos espera antes de activar el envío. Incluye disponibilidad de información, lectura, comprobación, coordinación, revisión y espera de flota; termina antes de recogida y viaje del envío. |
| Recogida y preparación | 6,668 | 6,251 | 6,25% menos | Menos es mejor si conserva las comprobaciones. Autorización → salida con carga; incluye comunicación de la orden, desplazamiento para recoger y carga. No es una fase exclusivamente administrativa. |
| Viaje con la ayuda | 8,333 | 8,255 | 0,94% menos | Menos significa que la carga llega antes. Salida con carga → llegada al destino; este trayecto se presenta por separado de la coordinación. |
| Llegada → recepción útil | 1,000 | 1,000 | Igual | Menos es mejor. Tiempo para descargar y registrar la recepción física; un camión que llega todavía no cuenta como ayuda recibida. |
| Espera total hasta recibir ayuda suficiente | 44,279 | 35,162 | 20,59% menos | Menos es mejor. Aparición de la necesidad → recepción de la cantidad requerida. Incluye coordinación, recogida, viaje y descarga. |

La primera fase no mide únicamente cuánto piensa el modelo o cuánto tarda el clic humano: también incluye cuándo se dispone de información, consultas, coordinación, revisión y espera de disponibilidad de flota. La fase de recogida contiene desplazamiento; restar sólo el viaje cargado del total **no** elimina todos los trayectos.

## Qué significa “food mean sufficient, min”

**“Tiempo medio hasta recibir toda la comida requerida, en minutos”. Menos es mejor.** En los ocho puntos con necesidad de comida, la espera pasó de **51,16 a 17,59 minutos**. Se cuenta desde que aparece la necesidad; no desde que sale el camión. Se recibió la misma cantidad útil en ambos: 164 porciones. Las solicitudes de comida quedaron cubiertas **33,58 minutos antes en promedio**.

Si un punto pide 20 porciones y otro pide 40, cada punto tiene un tiempo de suficiencia. La media de tiempos pesa ambos puntos por igual. El faltante acumulado sí refleja tanto la cantidad que falta como su duración.

| Métrica | Convencional | NEXO + Gemma 4 | Cambio | Qué representa para la respuesta y las personas que esperan |
|---|---:|---:|---|---|
| Agua: cantidad recibida / requerida (L) | 440 / 440 | 440 / 440 | Igual cobertura | Ideal: cubrir la demanda sin exceso. Cantidad útil recibida físicamente, no stock prometido. Una unidad representa un litro de agua; no determina por sí sola cuántas personas o familias quedaron atendidas. |
| Agua: espera media hasta cantidad suficiente (min) | 45,607 | 43,214 | 5,25% menos | Menos es mejor. Espera promedio de los 8 puntos con necesidad de agua, desde aparición hasta recibir toda la cantidad requerida. Cada necesidad pesa igual, aunque pida cantidades distintas. |
| Agua: faltante acumulado (L·min) | 21.918,958 | 20.432,875 | 6,78% menos | Menos es mejor. Combina cuánto falta y durante cuánto tiempo: 10 L faltantes durante 30 min = 300 L·min. No mide personas, familias ni daños médicos. |
| Comida: cantidad recibida / requerida (porciones) | 164 / 164 | 164 / 164 | Igual cobertura | Ideal: cubrir la demanda sin exceso. Cantidad útil recibida físicamente, no stock prometido. Una unidad representa una porción de comida; no determina por sí sola cuántas personas o familias quedaron atendidas. |
| Comida: espera media hasta cantidad suficiente (min) | 51,165 | 17,586 | 65,63% menos | Menos es mejor. Espera promedio de los 8 puntos con necesidad de comida, desde aparición hasta recibir toda la cantidad requerida. Cada necesidad pesa igual, aunque pida cantidades distintas. |
| Comida: faltante acumulado (porciones·min) | 8555,905 | 2852,913 | 66,66% menos | Menos es mejor. Combina cuánto falta y durante cuánto tiempo: 10 porciones faltantes durante 30 min = 300 porciones·min. No mide personas, familias ni daños médicos. |
| Mantas: cantidad recibida / requerida (mantas) | 130 / 130 | 130 / 130 | Igual cobertura | Ideal: cubrir la demanda sin exceso. Cantidad útil recibida físicamente, no stock prometido. Una unidad representa una manta; no determina por sí sola cuántas personas o familias quedaron atendidas. |
| Mantas: espera media hasta cantidad suficiente (min) | 36,066 | 44,686 | 23,90% más | Menos es mejor. Espera promedio de los 8 puntos con necesidad de mantas, desde aparición hasta recibir toda la cantidad requerida. Cada necesidad pesa igual, aunque pida cantidades distintas. |
| Mantas: faltante acumulado (mantas·min) | 4822,812 | 5768,637 | 19,61% más | Menos es mejor. Combina cuánto falta y durante cuánto tiempo: 10 mantas faltantes durante 30 min = 300 mantas·min. No mide personas, familias ni daños médicos. |

Las mantas tardaron más con NEXO; esa diferencia se conserva aunque agua, comida y el promedio total mejoraron.

## Unidades que se pueden explicar sin inventar beneficiarios

| Unidad registrada | Significado concreto | Qué no se puede deducir sólo con esa unidad |
|---|---|---|
| 1 L de agua | Un litro requerido o recibido | Personas hidratadas o días cubiertos sin una demanda por persona definida |
| 1 porción de comida | Una porción requerida o recibida; el modelo poblacional supone 700 kcal por porción | Una familia alimentada o un día sin hambre: no hay seguimiento de consumo por persona ni composición familiar |
| 1 unidad de blankets | Una manta requerida o recibida | Una familia sin frío o hipotermia evitada sin población, condiciones y asignación definidas |
| 1 porción·min | Una porción faltante durante un minuto | Un minuto de hambre de una persona: son dimensiones distintas |
| 1 manta·min | Una manta faltante durante un minuto | Un minuto de frío de una familia |
| 1 persona·min de trabajo | Un minuto de ocupación de un puesto humano registrado | Un minuto de espera de beneficiarios o un minuto de calendario si trabajan varios en paralelo |

Por ejemplo, si faltan 10 porciones durante 30 min y luego sólo faltan 4 durante 15 min, el faltante acumulado es **10 × 30 + 4 × 15 = 360 porciones·min**. Una entrega parcial reduce el ritmo al que se acumula el déficit, aunque aún no complete la necesidad. No se suman litros·min, porciones·min y mantas·min como si fueran intercambiables.

## Cobertura, recursos y costo

| Métrica | Convencional | NEXO + Gemma 4 | Cambio | Qué representa para la respuesta y las personas que esperan |
|---|---:|---:|---|---|
| Necesidades cubiertas suficientemente | 24/24 | 24/24 | Igual | Más, hasta cubrir todas, es mejor. Se completó la entrega física requerida en ese punto; una necesidad puede reunir a varias personas. Nunca equivale automáticamente a una vida salvada. |
| Necesidades sin suficiencia al cerrar la observación | 0 | 0 | Igual | Menos es mejor. Todavía no se había registrado ayuda suficiente al horizonte. Permanecen en el cálculo del tiempo hasta su límite de observación. |
| Distancia recorrida (km) | 216,000 | 209,250 | 3,13% menos | Menos, con igual cobertura, significa menos recorrido físico para prestar ayuda. Cuenta los desplazamientos de los vehículos, no distancia a pie de beneficiarios. |
| Combustible consumido (L) | 38,880 | 37,665 | 3,13% menos | Menos, con igual cobertura, significa menos combustible utilizado por los vehículos. Es consumo del modelo físico, no ahorro monetario medido. |
| Trabajo humano registrado (persona·min) | 268,500 | 17,500 | 93,48% menos | Menos, con igual cobertura, implica menos ocupación de los puestos de atención simulados. Suma duraciones de trabajo registrado; dos personas trabajando 5 min = 10 persona·min. No es tiempo de reloj ni todas las horas laborales de una ONG. |
| Llamadas reales al modelo | 0 | 6 | Aumenta desde 0 | Número de solicitudes al proveedor. No es un resultado humanitario; se interpreta junto con cobertura, calidad y costo, no como “menos siempre es mejor”. |
| Costo conocido del modelo (USD) | 0,00000000 | 0,00613892 | Aumenta desde 0 | Gasto registrado únicamente por inferencia. No incluye combustible, salarios, infraestructura ni costo por vida salvada. |
| Costo total del modelo (USD) | 0,00000000 | 0,00613892 | Aumenta desde 0 | Coincide con el conocido porque no hay facturación desconocida en esta pareja. Menos es conveniente sólo conservando calidad y atención. |
| Llamadas con facturación desconocida | 0 | 0 | Igual | Ideal: 0. Indica si el costo total puede afirmarse; no es una medida de ayuda recibida. |
| Errores registrados en el ensayo | 0 | 0 | Igual | Ideal: 0. Fallos observados al ejecutar el flujo; ausencia de errores no demuestra seguridad universal. |
| Reglas de integridad incumplidas | 0 | 0 | Igual | Ideal: 0. Reglas de conservación, permisos y estado que el motor detectó como rotas; no reemplaza evaluación en campo. |

## Evidencia y alcance

Esta vista se calcula **sin nuevas simulaciones ni llamadas al modelo**, usando los datos ya registrados y sus unidades originales. Cambian títulos, conversiones de ms a minutos/L/km, porcentajes descriptivos y explicaciones; no las decisiones, reglas físicas ni KPIs originales.

Fuente: [lectura cerrada con trazas por necesidad](../final-two-response-closed-20261013/readout.json), SHA256 `6233dca81e0dac987f1eb12b8d01d0eb0119dd8a5d624173753cca0c546ba2bf`. Las trazas incluyen autorización, recogida, salida cargada, llegada y recepción. El promedio temporal original conserva necesidades no completas hasta su horizonte; en esta pareja no hay ninguna censurada.

Es una pareja de simulaciones con parámetros humanos declarados; no una medición de una ONG real. No establece cuántas vidas se salvaron. Gemini y el efecto en campo requieren sus propias mediciones. Los resultados históricos de otras versiones permanecen separados.
