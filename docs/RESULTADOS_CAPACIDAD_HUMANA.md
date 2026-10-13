# Coordinación convencional frente a NEXO con Gemma

## Comparación actual

La comprobación más reciente, con el simulador actualizado y una pareja de la misma semilla, redujo **30,49% la preparación y autorización de la respuesta** y **20,59% el tiempo total hasta ayuda suficiente**. Son indicadores diferentes: el primero hace visible la espera operativa previa al envío; el segundo incluye el viaje físico hasta recibir la cantidad requerida.

| Métrica registrada | Convencional | NEXO + Gemma 4 | Qué representa |
|---|---:|---:|---|
| Preparar y autorizar la ayuda | 28,278 min | 19,656 min | 30,49% menos: 8,622 min de espera evitada antes de autorizar el envío. Incluye información disponible, comprobaciones, coordinación, revisión y espera de flota. |
| Operaciones sin trayectos del envío | 30,295 min | 21,673 min | 28,46% menos. Excluye desplazamiento a recogida y viaje cargado; conserva coordinación, transmisión, carga y descarga. |
| Espera total hasta ayuda suficiente | 44,279 min | 35,162 min | 20,59% menos: 9,117 min antes de recibir físicamente toda la cantidad requerida. Incluye los trayectos. |
| Necesidades cubiertas | 24/24 | 24/24 | Todas las cantidades requeridas llegaron. Una necesidad puede agrupar varias personas; no cuenta vidas salvadas. |

La lectura sin trayectos es una descomposición descriptiva de timestamps existentes, no un nuevo ensayo ni un cambio al KPI. Se conservaron los 24 casos por método y sus reglas físicas. La recogida incluye desplazamiento; restar únicamente el viaje cargado del total no habría eliminado todos los trayectos. La espera previa por vehículos ocupados sigue incluida en la fase operativa.

Ambos métodos cerraron sin casos censurados, exceso, errores ni invariantes rotos. NEXO recorrió 209,25 km frente a 216 km y consumió 37,665 L frente a 38,880 L: **3,125% menos**. Seis llamadas reales a Gemma 4 costaron **USD 0,00613892**. Agua y comida llegaron antes en promedio; las mantas tardaron más.

[Informe explicado: cada métrica, unidades, sentido de mejora y perspectiva de quienes esperan ayuda](../reports/analysis/final-two-response-explained-20261013/readout.md). La [evidencia cerrada original](../reports/analysis/final-two-response-closed-20261013/readout.json) conserva sus bytes y cálculos. Es una pareja simulada, no evidencia de campo. Su motor es `4ea1bf88…`; la primaria de tres semillas que sigue conserva su versión original y se presenta por separado.

### Comida, mantas y cantidades pendientes

**Food mean sufficient, min** significa **tiempo medio hasta recibir toda la comida requerida, en minutos; menos es mejor**. Se promedian ocho necesidades de comida, cada una con igual peso, desde su aparición hasta la recepción física suficiente. En esta pareja: **51,165 → 17,586 min**, con las mismas **164 porciones** recibidas. No representa minutos por persona ni tiempo de viaje solamente.

Una unidad de comida es una porción (el modelo poblacional supone 700 kcal); una unidad de mantas es una manta; el agua se registra en litros. No hay seguimiento individual que permita convertir esos artículos en familias alimentadas o personas sin frío.

El déficit acumulado combina **cantidad todavía faltante × tiempo**: 10 porciones faltantes durante 30 min equivalen a 300 porciones·min. Menos es mejor; una entrega parcial reduce el déficit aunque no complete toda la solicitud. No equivale a 300 minutos de hambre de personas identificadas, y no se suman litros·min, porciones·min y mantas·min. El informe explicado añade esa interpretación al lado de cada valor.

## Primaria anterior: tres semillas


La comparación primaria cerrada del 13 de octubre de 2026 muestra una reducción del **18,02% en el tiempo medio hasta recibir ayuda física suficiente**: **41,846 → 34,305 minutos**, aproximadamente 7,54 minutos menos por necesidad. Se midieron tres semillas, con 24 necesidades por método en cada una. Ambos atendieron las 72 necesidades; ninguna quedó sin atender o censurada al horizonte de tres horas.

| Resultado | Coordinación convencional manual | NEXO + Gemma |
|---|---:|---:|
| Tiempo medio hasta ayuda suficiente | 41,846 min | 34,305 min |
| Necesidades atendidas suficientemente | 72/72 | 72/72 |
| Necesidades sin atender / censuradas | 0 / 0 | 0 / 0 |
| Llamadas al modelo | 0 | 21 |
| Costo del modelo | USD 0 | USD 0,01992542 |

Se cuenta la recepción física útil, no una recomendación, aprobación o camión despachado. En esta cohorte, primera ayuda útil y suficiencia coinciden porque cada necesidad se cubrió con un recibo suficiente; esa coincidencia no se extiende automáticamente a entregas parciales, refugios o evacuaciones.

## Qué se comparó

El flujo convencional (C_manual) lee reportes recibidos, integra una decisión y comunica la información mediante tareas nativas del simulador. Cada tarea espera capacidad, ocupa una plaza y produce un recibo; un relay sólo llega cuando lo permite el canal de comunicación. NEXO usa Gemma para interpretar e investigar, junto con su compilador de acciones y sus conectores operacionales.

Ambos tienen las mismas cuatro organizaciones, dotación física, fuentes accesibles, comprobaciones y autoridad. Las acciones físicas requieren la misma revisión finita de sus propietarios. Ninguno recibe acceso al evaluador privado, necesidades ocultas o eventos futuros. La demora humana ocurre causalmente dentro del motor, no mediante una penalización añadida al KPI después del ensayo.

Por mundo se declararon 24 necesidades, 192 distractores, dos reposts, informe formal a los 30 minutos, mapa grid9/6 km y horizonte de tres horas. Cada organización tiene dos lectores, dos decisores y un relayer, con duraciones de lectura/decisión/preparación de comunicación de 30/60/90 segundos. Se utilizó error humano cero. Las tres parejas tienen packetLoss:0 y silentFraction:0; esta cifra no demuestra robustez ante desconexión o comunidades sin publicaciones.

Los tiempos y pools humanos son **supuestos de simulación**, no mediciones de una ONG. El 18,02% corresponde al flujo completo frente al proceso manual descrito; no atribuye toda la diferencia exclusivamente al modelo ni demuestra ahorro de tiempo de trabajadores reales.

## Dónde mejoró y dónde empeoró

| Recurso | Cambio del tiempo de NEXO frente al convencional |
|---|---:|
| Agua | 10,99% más rápido |
| Comida | 52,38% más rápido |
| Mantas | 12,49% más lento |

NEXO consumió **7,31% más combustible**. La mejora del promedio no representa mejora en todos los recursos o costos. Litros, porciones y mantas conservan sus unidades; no se suman como bienes intercambiables.

En los 72 pares de necesidades, la fase aparición → autorización fue aproximadamente 8,41 minutos más corta con NEXO. Preparación/recogida y viaje cargado añadieron aproximadamente 0,44 y 0,43 minutos, respectivamente; llegada → recepción no cambió. La diferencia final fue de 7,54 minutos. Esto localiza el cuello de botella previo a la autorización, sin separar por sí solo cada efecto de lectura, comprobación, modelo y revisión.

Se registraron 21 llamadas reales a google/gemma-4-31b-it, con 79.113 tokens de entrada, 22.124 de salida y **USD 0,01992542**, sin facturación desconocida en esos intentos. El costo corresponde únicamente al proveedor del modelo; no incluye salarios, combustible, infraestructura ni tarifas reales de emergencia.

## Plataforma y visor actuales

La plataforma conserva el candidato 9b4de8b7769c69a3279067a8a093ef6d2392ec8a9728e704f871a184a69934e3, con [486 comprobaciones de núcleo selladas anteriormente](../reports/verifications/1791875155549.json). Tras actualizar los requisitos de personal de las instalaciones y los controles del visor, pasaron 249 comprobaciones del simulador, [31 integraciones afectadas](../reports/verifications/affected-facility-integration-20261013.json) y [7 comprobaciones reales de navegador](../reports/human-profile-ui/1791891190000/result.json). No se presenta esa revisión enfocada como repetición completa de todas las pruebas de plataforma. Las [113 comprobaciones anteriores de UI](../reports/ui-verifications/1791876005595.json) conservan su versión.

El visor permite seleccionar zero/moderate/burst y ajustar tiempos, lectores, decisores, relayers, carga de fondo y errores mediante JSON avanzado. La prueba actual confirma que el selector conserva el manifiesto tras reset/reload, que dos lecturas con una sola plaza producen una trabajando y otra esperando, y que cada organización conserva su privacidad. Completar una lectura no mueve stock ni entrega ayuda.

El selector de políticas de referencia del visor ejecuta código de referencia. Elegir un perfil de atención no convierte esa política en el flujo manual medido ni conecta Gemma. La comparación con el modelo necesita el controlador real y sus recibos, no contadores visuales.

Estas actualizaciones del simulador y visor tienen huella 4ea1bf884ea8d8d2282436aac53367f121fa3b0d308688957849a4774e34f1fa. Las cifras primarias de tiempo provienen del build de comparación siguiente; no se atribuyen retroactivamente al visor actualizado.

## Evidencia y alcance

| Componente de la comparación primaria | SHA256 |
|---|---|
| Plataforma | 9b4de8b7769c69a3279067a8a093ef6d2392ec8a9728e704f871a184a69934e3 |
| Evaluador base | 4b4d289e387b49da8d79fdccb260a67919b74339432731373204d96aee6668b3 |
| Evaluador humano | fb5b95f31ce62b7287c20cf0a9ff01480a37158ba0aae8a17b765bebf538944a |
| Simulador | 561e6a02fbde1d047f999c4f077cbff83c438ba5c508c4d8d18bbf59ff78e94b |

- [Recibos primarios y métricas físicas](../reports/analysis/native-human-primary-all12-20261013-closed.json).
- [Etapas físicas y diagnóstico](../reports/analysis/native-human-primary-all12-20261013-diagnosis.json).
- [Protocolo y parámetros efectivos](../reports/human-capacity/native-primary-20261013/protocol.json).
- [Definiciones de atención, colas y utilización](../reports/kpi-companion/native-primary-all12-summary-1791870506706/readout.md).
- [Instalación limpia y arranque físico local](../reports/local-closure/1791876153508-clean/result.json), correspondiente a su build registrado.

Los informes originales, costos, fallos y resultados anteriores se conservan con su identidad y fecha. No se mezclan versiones o condiciones para producir un efecto nuevo. Tres semillas no establecen una garantía universal: falta calibrar con organizaciones y usuarios reales, volver a medir con Gemini y validar el impacto en campo. Esta etapa utiliza Gemma y despliegue local; **GCP está excluido**. No se afirma una reducción demostrada de mortalidad ni una victoria garantizada en una competencia.
