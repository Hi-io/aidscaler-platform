# Capacidad humana nativa: resultados físicos y alcance de la mejora

Estado al 13 de octubre de 2026: comparación primaria cerrada, doce mundos válidos. Los controles secundarios siguen en ejecución. Este documento acredita el resultado de esta versión y este protocolo; no convierte una hipótesis del simulador en productividad humana medida en campo.

## Resultado principal

NEXO con Gemma redujo **18,02%** el tiempo medio hasta recibir ayuda suficiente frente al flujo manual competente: **41,85 → 34,31 minutos**, una diferencia de **7,54 minutos por necesidad** en esta cohorte. Cada brazo atendió físicamente 24/24 necesidades en cada una de tres semillas. No hubo necesidades censuradas, exceso de recursos, errores de ejecución ni invariantes violadas.

| Referencia | Tiempo a ayuda suficiente | NEXO | Diferencia de NEXO |
|---|---:|---:|---|
| `C_manual`: lectura, integración y comunicación con pools humanos finitos | 41,85 min | 34,31 min | 18,02% más rápido |
| `B5`: parser explícito, consultas automáticas y compilador común | 31,83 min | 34,31 min | 7,76% más lento |
| `B8`: palabras/lugares públicos, comprobaciones automáticas y compilador común | 35,24 min | 34,31 min | 2,66% más rápido en el agregado; resultados mixtos por semilla |

El contraste con `B8` va de una mejora del 13,98% a un empeoramiento del 7,29%. No se acredita una superioridad robusta frente a ese control. `B5` ganó en las tres semillas. La mejora frente a trabajo manual acredita el flujo automatizado bajo estos supuestos; su totalidad no puede atribuirse exclusivamente al LLM.

Los endpoints de primera ayuda útil y ayuda suficiente coinciden en esta cohorte: cada necesidad se cubrió mediante un recibo suficiente. No se generaliza esa coincidencia a entregas parciales, evacuaciones, refugios ni otros escenarios.

## Qué produjo la diferencia

Las colas están dentro del motor: leer, integrar/decidir y transmitir son trabajos nativos, con inicio, espera, finalización y snapshot recibido. Un relay exige además entrega efectiva por el canal. El controlador no añade una penalización artificial al score final. Ambos métodos necesitan la misma revisión por el dueño, stock, flota, capacidades de comprobación y ejecución física.

En los 72 pares de necesidades contra `C_manual`, la diferencia media de NEXO se descompone en:

| Fase física comparable | NEXO menos manual |
|---|---:|
| Aparición de la necesidad → autorización | −8,41 min |
| Autorización → salida con carga | +0,44 min |
| Salida con carga → llegada | +0,43 min |
| Llegada → recepción útil | 0,00 min |
| Total hasta recepción | −7,54 min |

La ganancia ocurre antes de autorizar, con costes posteriores que compensan parte de ella. Esta descomposición ubica el cuello de botella; por sí sola no separa causalmente cada comprobación, la lectura, el modelo y la revisión dentro de la fase previa.

Contra `B5`, NEXO tarda 2,47 minutos adicionales: aproximadamente 2,10 antes de autorizar, 0,47 en preparación/recogida y −0,10 en viaje cargado. Los HTTP del modelo fueron inferiores a los 15 segundos mínimos modelados en los 21 intentos registrados. No corresponde explicar toda la desventaja simplemente por un proveedor lento.

## Costes y regresiones que permanecen visibles

| Recurso | Reducción del tiempo de NEXO frente al manual | Reducción del déficit acumulado en su propia unidad |
|---|---:|---:|
| Agua | 10,99% | 9,64% |
| Comida | 52,38% | 53,04% |
| Mantas | −12,49% | −9,71% |

Las mantas empeoran. NEXO recorrió y consumió aproximadamente 7,31% más que el manual, 2,64% más que `B5` y 4,77% menos que `B8`. Se conservan esos tradeoffs; no se presenta la mejora del promedio como mejora de todos los recursos ni de combustible. No se suman litros, porciones y mantas en un índice de bienes intercambiables.

Cada brazo sirvió en total 1.150 litros, 460 porciones y 429 mantas a través de 72 recibos. El servicio, stock, autoridades y operaciones quedan ligados a evidencia nativa exacta. Una propuesta aprobada o un recibo positivo redundante no incrementa automáticamente el beneficio útil.

## Trabajo, colas e intervención del modelo

La atención nativa modelada media por mundo fue: `C_manual` 281,67 persona-minutos; `B5` 112,50; `B8` 18,50; NEXO 17,17. NEXO reduce ese trabajo modelado un 93,91% frente al manual. La revisión ya está incluida en la etapa de decisión y no se suma dos veces. Las esperas acumuladas entre tareas se informan aparte: no son trabajo ni tiempo transcurrido del mundo. Estos valores no acreditan horas reales ahorradas por profesionales ni una reducción de plantilla.

Las colas nativas terminaron sin pendientes al horizonte de tres horas en los doce mundos. Eso no prueba recuperación completa de todas las fuentes: el gate `K22` utiliza una cohorte recibida ID+versión y sus disposiciones, atención, consultas, jobs y reviews; tiene su propio protocolo.

De las 72 primeras pistas de NEXO para esta cohorte, 35 tienen un recibo real de percepción del modelo como origen, 36 proceden del parser explícito común y una no tiene actividad causal recuperable. Se mantiene ese caso desconocido. Esta atribución demuestra uso real del modelo; no demuestra que ninguna regla o profesional pueda interpretar las mismas pistas.

Se registraron **21 llamadas** a `google/gemma-4-31b-it`: 79.113 tokens de entrada, 22.124 de salida, **USD 0,01992542** y 125,61 segundos HTTP en total. No hubo facturación desconocida. No se hicieron llamadas tardías para consultar repetidamente viajes ya en marcha: la última disponibilidad de interpretación quedó antes de 8,6 minutos fuente en las tres semillas.

## Supuestos y controles

El primario conserva cuatro organizaciones, 24 necesidades, 192 distractores, dos reposts, informe formal a 30 minutos, mapa grid9/6km y horizonte de tres horas. Por organización se declararon dos lectores, dos decidores y un relayer; duraciones de 30/60/90 segundos para esas etapas. Las reviews físicas finitas son comunes a todos los brazos. El primario usa error humano cero: el volumen y los pools producen demoras sin exigir incompetencia.

Esas duraciones y pools son hipótesis explícitas, no calibración de una ONG. Los controles de trabajo adicional cero, lectura de cinco segundos, ocho lectores, coordinación descentralizada y cargas de 48/96 necesidades se conservan por separado. No se elige una semilla favorable ni se agrega una entrega duplicada mediante un contador impuesto. Cuando termine esa tanda se añadirá su resultado completo.

El runner primario devolvió exit1 por solicitar además comparaciones con `C_decentralized`, que no pertenecía a sus doce mundos predeclarados. Los doce outcomes se cerraron y los tres contrastes planificados son íntegros. Ese error de presentación del harness permanece registrado; no fue usado para repetir una corrida favorable ni se interpreta como fallo del producto.

## Identidad y evidencia revisable

| Componente | SHA256 |
|---|---|
| Plataforma | `9b4de8b7769c69a3279067a8a093ef6d2392ec8a9728e704f871a184a69934e3` |
| Evaluador base | `4b4d289e387b49da8d79fdccb260a67919b74339432731373204d96aee6668b3` |
| Evaluador de capacidad humana | `fb5b95f31ce62b7287c20cf0a9ff01480a37158ba0aae8a17b765bebf538944a` |
| Simulador | `561e6a02fbde1d047f999c4f077cbff83c438ba5c508c4d8d18bbf59ff78e94b` |

- [Readout sellado all12](../reports/analysis/native-human-primary-all12-20261013-closed.md) y [JSON completo](../reports/analysis/native-human-primary-all12-20261013-closed.json).
- [Diagnóstico con todos los casos y etapas](../reports/analysis/native-human-primary-all12-20261013-diagnosis.md), [atribución de consultas](../reports/analysis/native-human-primary-all12-20261013-inquiry-attribution.json) y [manifest de soporte](../reports/analysis/native-human-primary-all12-20261013-support/manifest.json).
- [K20/K22/K24/K09 descriptivos](../reports/kpi-companion/native-primary-all12-summary-1791870506706/readout.md). Sus definiciones se sellaron después de leer dos baselines anteriores; esa procedencia no se presenta como totalmente ciega.
- [Protocolo de los doce mundos](../reports/human-capacity/native-primary-20261013/protocol.json) y [resumen íntegro](../reports/human-capacity/native-primary-20261013/summary.json).
- [Instalación limpia y arranque físico actual](../reports/local-closure/1791870240228-clean/result.json): pnpm11.25/frozen-lockfile/store nuevo/configuración de paquetes aislada, mismas tres huellas y recibo de 300L, cero modelo. Conserva las rutas originales de Windows; no afirma un perfil de usuario nuevo ni instalación de Python/ASR/Chromium.

Los resultados negativos de versiones anteriores permanecen válidos para sus propias huellas. No se mezclan con esta cohorte para fabricar un efecto. Gemma, un mundo sintético y sus parámetros no prueban rendimiento de Gemini, campo, vidas salvadas, confianza pública ni calibración de tiempos humanos. GCP continúa fuera del alcance de esta fase.
