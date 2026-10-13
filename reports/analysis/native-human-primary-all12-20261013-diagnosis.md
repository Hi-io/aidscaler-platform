# Primaria nativa cerrada: ventaja manual, referencia fuerte negativa

NEXO B6 entrega ayuda suficiente en **34,3053 minutos de media restringida**, frente a **41,8465** del flujo manual modelado: **18,0211 % menos tiempo**. Atiende 24/24 necesidades en cada una de las tres semillas. Frente a B5, tarda **7,7623 % más**; frente a B8, mejora **2,6643 %** de media con resultado mixto por semilla. Estas tres comparaciones permanecen separadas.

La mejora frente al flujo manual es sustancial dentro de este perfil experimental. No demuestra superioridad frente a la referencia convencional fuerte, una mejora consistente de todos los recursos ni que todo el beneficio sea exclusivo de GenAI. La coordinación automatizada común también aporta valor.

## Integridad y procedencia

- Carpeta inmutable de resultados: `reports/human-capacity/native-primary-20261013`; doce mundos moderate declarados, tres semillas, C_manual/B5/B8/B6.
- Lector sellado `f3256a5fd685b8411491d41d1c03cf257e0a058ec31a16582eea24a7d7ddd3e9`: **12 declarados, 12 raw, 12 válidos**; sin ausentes, duplicados, archivos ilegibles, errores ni invariantes incumplidos.
- Hash candidato `9b4de8…`, evaluador base `4b4d28…`, evaluador human-capacity `fb5b95…` y simulador `561e6a…` idénticos al inicio/final y al protocolo. El corpus exógeno, mapa, cohorte y protocolo coinciden dentro de cada par.
- El proceso terminó con exit1 porque el resumen del harness emite tres pares `C_decentralized: missing_pair` aunque ese brazo **no está declarado en esta primaria**. `scripts/human-capacity-campaign.mjs:165` convierte cualquier comparación no comparable en exit1. Los doce resultados físicos declarados están completed/valid; se conserva el fallo de reporte sin clasificarlo como fallo del producto ni repetir mundos.
- Este diagnóstico descriptivo se redactó después de cargar los resultados. No cambia el lector, los sellos, los estimadores, los umbrales, las fuentes o los criterios de elegibilidad. El companion K20/K22/K24 es post-baseline según su sello; su procedencia explícita no se sustituye por una afirmación de cegamiento total.

Salidas originales completas: [JSON all12](native-human-primary-all12-20261013-closed.json) y [Markdown del lector](native-human-primary-all12-20261013-closed.md). El [JSON de diagnóstico](native-human-primary-all12-20261013-diagnosis.json) conserva los 288 casos físicos y las 216 diferencias pareadas contra las tres referencias, con todas sus operaciones y clocks. La [atribución de solicitudes](native-human-primary-all12-20261013-inquiry-attribution.json) conserva las doce ejecuciones. El [companion agregado](../kpi-companion/native-primary-all12-summary-1791870506706/readout.md) enlaza sus doce resultados raw y sellos.

## Resultados de las doce ejecuciones

Todos los mundos: 24/24 casos alcanzados; cero censura, cero exceso, cero errores/invariantes. Primera ayuda útil y umbral suficiente coinciden porque cada caso recibió su cantidad completa en una operación, no porque se haya eliminado ayuda parcial del estimador.

| Semilla | Brazo | RMST primera/suficiente min | p95 restringido min | Trabajo nativo person-min | Consultas solicitadas | Llamadas modelo | USD proveedor |
|---|---|---:|---:|---:|---:|---:|---:|
| 01 | C_manual | 44,2791 | 71,7003 | 268,5 | 44 | 0 | 0 |
| 01 | B5 | 32,7131 | 60,8503 | 107,5 | 44 | 0 | 0 |
| 01 | B8 | 35,6527 | 69,3003 | 18,5 | 121 | 0 | 0 |
| 01 | B6 | 35,6503 | 64,6086 | 17 | 37 | 7 | 0,00754454 |
| 02 | C_manual | 39,1795 | 63,1253 | 287,5 | 46 | 0 | 0 |
| 02 | B5 | 30,8763 | 55,7003 | 113 | 46 | 0 | 0 |
| 02 | B8 | 37,2551 | 66,3503 | 18,5 | 139 | 0 | 0 |
| 02 | B6 | 32,0482 | 61,6086 | 17 | 43 | 7 | 0,00629630 |
| 03 | C_manual | 42,0808 | 68,1753 | 289 | 49 | 0 | 0 |
| 03 | B5 | 31,9131 | 60,7920 | 117 | 49 | 0 | 0 |
| 03 | B8 | 32,8249 | 59,8670 | 18,5 | 137 | 0 | 0 |
| 03 | B6 | 35,2173 | 65,9170 | 17,5 | 48 | 7 | 0,00608458 |

| Referencia para B6 | Ganancia semilla 01 | Ganancia semilla 02 | Ganancia semilla 03 | Razón de medias, tres semillas |
|---|---:|---:|---:|---:|
| C_manual | +19,4873 % | +18,2015 % | +16,3103 % | **+18,0211 %** |
| B5 | −8,9785 % | −3,7954 % | −10,3537 % | **−7,7623 %** |
| B8 | +0,0068 % | +13,9764 % | −7,2883 % | **+2,6643 %** |

Signo positivo significa menos tiempo para B6. Son tres mundos independientes por brazo, con 72 casos pareados por contraste; los 72 casos no equivalen a 72 semillas independientes. No se produce significación estadística, intervalo inferencial ni estimación de vidas salvadas.

## Recursos nativos: beneficio desigual que no debe ocultarse

Cada brazo, al sumar sus tres escenarios, entrega exactamente **1150 L de agua, 460 porciones de comida y 429 mantas**: 72 operaciones positivas, cero déficit final y cero exceso. El déficit acumulado mide cantidad pendiente × tiempo de fuente. Se conserva cada unidad; no se suman litros, porciones y mantas.

| Brazo | Déficit acumulado L·min | Déficit porciones·min | Déficit mantas·min |
|---|---:|---:|---:|
| C_manual | 53 967,9925 | 20 103,7803 | 16 789,2466 |
| B5 | 48 435,9092 | 8 079,8553 | 16 717,9466 |
| B8 | 38 934,3258 | 16 658,7720 | 14 910,9716 |
| B6 | 48 764,2490 | 9 441,2316 | 18 419,7070 |

| Referencia | Recurso | Reducción de RMST B6 | Reducción de déficit unidad-tiempo B6 |
|---|---|---:|---:|
| C_manual | Agua | +10,9912 % | +9,6423 % |
| C_manual | Comida | +52,3768 % | +53,0375 % |
| C_manual | Mantas | **−12,4910 %** | **−9,7113 %** |
| B5 | Agua | −1,1893 % | −0,6779 % |
| B5 | Comida | −16,4489 % | −16,8490 % |
| B5 | Mantas | −10,5031 % | −10,1792 % |
| B8 | Agua | −13,2767 % | −25,2474 % |
| B8 | Comida | +43,5214 % | +43,3258 % |
| B8 | Mantas | −23,9528 % | −23,5312 % |

La ventaja manual media está concentrada en comida y algo de agua; las mantas llegan más tarde. El resultado no permite afirmar que NEXO acelera todas las clases de ayuda. B8 es mejor en agua/mantas y B6 en comida: hace falta mejorar asignación y orden global de compromisos, sin escoger pesos del scorer después del resultado.

## Descomposición temporal física

Cada etapa tiene clocks observados en 72/72 casos por brazo. Son etapas del aporte físico suficiente, no tiempos inferidos del ACK de consulta. La etapa previa a autorización mezcla lectura/inferencia, aclaraciones, borrador, revisión y espera por flota; no se atribuye toda ella a percepción.

| Brazo | Antes de autorización min | Pickup/preparación min | Salida cargada→llegada min | Llegada→recibo min | Total min |
|---|---:|---:|---:|---:|---:|
| C_manual | 27,9692 | 5,5421 | 7,3351 | 1 | 41,8465 |
| B5 | 17,4535 | 5,5132 | 7,8675 | 1 | 31,8342 |
| B8 | 20,0778 | 5,9415 | 8,2250 | 1 | 35,2443 |
| B6 | 19,5551 | 5,9849 | 7,7653 | 1 | 34,3053 |

| B6 menos referencia | Antes de autorización min | Pickup min | Viaje cargado min | Total min |
|---|---:|---:|---:|---:|
| C_manual | **−8,4141** | +0,4427 | +0,4302 | −7,5412 |
| B5 | **+2,1016** | +0,4716 | −0,1022 | +2,4711 |
| B8 | −0,5227 | +0,0434 | −0,4597 | −0,9390 |

La ventaja frente a manual procede de trabajo/espera antes de autorización, pese a un pequeño empeoramiento físico posterior. Frente a B5, el 85 % aproximado de la diferencia media está antes de autorización. Esto identifica dónde investigar; por sí solo no separa inferencia, decisión y disponibilidad de flota.

Ejemplo adverso conservado, semilla 01, mantas b74: B6 tarda **39,725 minutos más** que B5. De ellos, 23,2667 son previos a autorización, 3,3333 pickup y 13,125 viaje cargado. B6 asigna org1/v-org1-0; B5 org2/v-org2-0. Los dos recibos físicos tienen la misma cantidad. Las rutas/flota concretas cambian con la secuencia de compromisos; eso da una regresión útil para un futuro planner común, pero no prueba que el camión alternativo estuviera disponible en el mismo instante para B6. El JSON conserva todos los casos y sus operaciones, no sólo este ejemplo.

## Consultas, modelo y colas humanas

| Brazo, suma tres mundos | Solicitudes de consulta | Reutilizaciones | Inspecciones ID distintas por mundo, sumadas | Solicitudes fuera de cohorte física |
|---|---:|---:|---:|---:|
| C_manual | 139 | 29 | 110 | 0 |
| B5 | 139 | 49 | 90 | 0 |
| B8 | 397 | 218 | 179 | 137 |
| B6 | 128 | 53 | 75 | 0 |

Estas son actividades de solicitud/reutilización, **no recibos de verificación completados**. No llamar a cada solicitud una inspección física nueva. B6 reduce solicitudes y destinos ajenos a la cohorte frente al detector amplio; el ahorro de cola no se transforma automáticamente en superioridad física frente a una referencia fuerte.

En los 72 casos B6, la primera solicitud registrada proviene del modelo en 35, del parser explícito común en 36, y falta actividad atribuible en uno. El modelo sí genera primeras pistas útiles en este corpus; eso no prueba necesidad exclusiva, porque B8 tiene las mismas herramientas para aclarar un lugar y descubrir su necesidad real. B5/B8/B6 comparten 69 actividades del parser explícito. Las solicitudes del modelo se conservan aunque posteriormente se reutilice una comprobación pendiente de otra vía.

B6: **21 llamadas reales**, siete por semilla, `google/gemma-4-31b-it`, **79 113 tokens de entrada**, **22 124 de salida**, **USD 0,01992542** conocidos; cero coste desconocido, fallo o reparación en esta primaria. HTTP proveedor total **125,6063 s**, separado de CPU/SQL. Las 60 actividades de percepción no son 60 llamadas pagadas: deduplicación/caché y extracción libre existen dentro del flujo común.

Todos los HTTP duran menos que los 15 s nominales nativos por llamada (máximos por semilla 12,736/8,063/7,057 s). La última disponibilidad de resultado de modelo es a 8,2836/8,5169/7,4503 min de fuente. No se observa inferencia pagada tardía después de las últimas entregas. No atribuir aquí toda la demora de varias decenas de minutos al HTTP del modelo. El loop sí espera `semantic.process` antes de atender consultas/compilar ese turno; bombeo concurrente sigue siendo una hipótesis funcional comprobable para otro estudio, no una mejora ya demostrada.

| Brazo, suma tres mundos | Trabajo read person-min | Trabajo decide person-min | Trabajo relay person-min | Total person-min | Espera de cola person-min |
|---|---:|---:|---:|---:|---:|
| C_manual | 325 | 266,5 | 253,5 | 845 | 4 387,8833 |
| B5 | 285 | 52,5 | 0 | 337,5 | 12 391,5 |
| B8 | 0 | 55,5 | 0 | 55,5 | 0 |
| B6 | 0 | 51,5 | 0 | 51,5 | 0 |

B6 reduce trabajo nativo modelado 93,9053 % frente a manual, 84,7407 % frente a B5 y 7,2072 % frente a B8. `operatorReviewMs` ya ocupa decide: no se añade dos veces. Se reconcilia el trabajo por timestamps con el resumen nativo en las doce ejecuciones. La espera no es trabajo ni salario; los person-min de varios trabajadores concurrentes no son tiempo de reloj de ayuda.

El perfil moderate declara dos lectores, dos decisores y un relay por organización; read 30 s, decisión 60 s, relay 90 s. No hay errores humanos latentes ni carga humana exógena en esta primaria. Son supuestos experimentales, no tasas medidas de ONG. Todos los trabajos read/decide/relay están terminados al cutoff fijo de 3 h; pendiente cero no demuestra recuperación completa de cada versión de fuentes. Backlog máximo individual por organización, entre los tres mundos: manual52/B5175/B81/B61. No es una suma simultánea de picos de organizaciones.

K24 conserva diferencias reales por operación y la unión de intervalos para no sumar concurrencia. K09 mantiene combustible/distancia de todos los vehículos nativos: B6 consume aproximadamente +7,31 % frente a manual, +2,64 % frente a B5 y −4,77 % frente a B8. No asignar ese combustible por recurso sin ledger de costes y no inferir ahorro económico neto de la pequeña factura del modelo.

## Diagnóstico: producto y representación

**Producto.** La selección semántica evita muchas consultas amplias, pero la ventaja se pierde parcialmente en cuándo se autorizan cargas y qué camiones se comprometen. Recomendación mínima: estudiar el orden global de compromisos y una asignación conjunta de pickups basada sólo en posiciones/stock/rutas/calendarios recibidos, aplicada al mismo planner de B5/B6/B8. La regresión debe controlar propiedad, conductor, carga, calendario y reserva; no puede usar futuras posiciones reales ni degradar B5. Medir RMST total y déficits por las tres unidades para evitar mejorar comida a costa de ocultar mantas.

**Producto, hipótesis pendiente.** Separar la vía de inferencia de la de acciones/recibos ya disponibles permite seguir consultas, revisión y ejecución mientras el proveedor procesa. Los resultados del modelo sólo pueden usarse a su disponibilidad real, con el mismo reloj de HTTP/errores y límites de autoridad. Probar una respuesta lenta y operaciones ya autorizadas en paralelo, conservando idempotencia y clocks. Este estudio no demuestra cuánto mejoraría esa corrección, porque los HTTP actuales son cortos y el déficit frente a B5 mezcla espera por flota.

**Representación.** Las solicitudes públicas del corpus son patrones sintéticos con lugares bN reconocibles. La aclaración tipada revela la necesidad real cuando cualquier referencia competente selecciona el lugar. Las notas audiovisuales se presentan como captions/transcripciones, no como prueba de comprensión de bytes de audio/vídeo. El corpus sirve para medir coordinación, atención finita y utilidad física de descubrir pistas; no representa por sí solo toda la complejidad de retorno condicionado, restricciones temporales multifuente, consentimiento, conflictos de identidad y cambios de ruta. Una familia contextual nueva debe preregistrarse, preservar acceso de B5/B8/B9 y no diseñarse para romper únicamente un parser competente.

**Medición pendiente.** Controles de carga/lectores/error simétrico y fuente silenciosa, K15 mismo modelo/B9, K22 recuperación versionada, K11/K13 semántica, K07/K14 y S19/federación conservan estudios separados. La primaria no los acredita automáticamente. Precisión independiente, personas reales, Gemini y GCP siguen fuera de este resultado local.

Puede afirmarse: **en el perfil manual finito declarado, NEXO reduce 18,02 % el tiempo físico medio hasta ayuda suficiente y atiende todas las necesidades, con integridad física intacta**. Debe añadirse: **la referencia B5 sigue siendo 7,76 % más rápida; B8 tiene resultado mixto y las mantas empeoran frente a manual**. La evidencia sostiene utilidad de automatización/coordinación en este escenario, sin sostener favoritismo universal, salvamento real de vidas o superioridad exclusiva de GenAI.
