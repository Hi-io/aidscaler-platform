# S14: descarga recibida y recuperación del mismo cargamento

Fecha: 2026-10-13. Evidencia local de regresión funcional; no es una medición comparativa de tiempo, calidad del proveedor real o comprensión humana.

## Comportamiento verificado

Una llegada con `received=0` mantiene la ayuda pendiente. El receptor recibe una solicitud de descarga por el canal ordinario del simulador, con operación original, cantidad, dueño receptor, edificio, versiones, competencias y duración finita del trabajo. La plataforma conserva la solicitud recibida; ausencia en una lectura no equivale a cancelación y una versión antigua no borra una recepción posterior.

El compilador determinista `unloadingPlan` ofrece tres etapas, siempre como borradores sujetos a aprobación independiente del dueño:

1. Equipo cualificado ya presente: preparar trabajo de descarga de la operación original.
2. Equipo remoto: preparar primero un traslado físico de personal, respetando asientos, masa, volumen, disponibilidad del conductor, calendario, ruta, combustible, reservas y ventana de trabajo recibidos. Transportar personal no autoriza automáticamente la descarga.
3. Todos los vehículos propios retenidos por cargamentos ya llegados: devolver como máximo **un cargamento adicional propio**, conservando la operación original seleccionada y su demanda pendiente. Se espera una recepción real del retorno, inventario y vehículo libre antes de transportar el equipo. No se cancela un vehículo ajeno, no se libera capacidad por el mero ACK y no se inventa un transporte adicional.

La aprobación de cada etapa vuelve a comprobar los hechos materiales. La orden `unload` conserva los siete parámetros exactos recibidos y revisados: `operation`, `staff`, `quantity`, `targetVersion`, `requestVersion`, `sourceVersion` y `deliveryQuantity`. El dueño receptor controla su personal; un donante no obtiene esa autoridad. El modelo puede preparar la propuesta, pero no autorizarla. B5/B8 disponen del mismo compilador y del mismo proceso físico y humano.

El Worker reconoce `queued`/`working` como progreso pendiente. Sólo completa cuando la fuente confirma recepción positiva de toda la cantidad original después del trabajo finito. Cambio de turno, autoridad o condiciones deja el cargamento pendiente y exige una nueva revisión; no convierte trabajo inconcluso en servicio. La recepción final reutiliza la operación original y no despacha otra vez la misma ayuda.

Las solicitudes están vinculadas al `runId` de su fuente. Si una ejecución nueva reutiliza identificadores deterministas, la solicitud y el checkpoint anteriores dejan de ser utilizables. Una lectura sin identidad no puede reemplazar una solicitud previamente vinculada a una ejecución.

## Pruebas de mecanismo

```powershell
node --test tests/unloading.test.mjs tests/staff-calendar.test.mjs tests/proposal-funnel.test.mjs tests/case-context.test.mjs tests/planning-throughput.test.mjs
node --test tests/ui-unloading.test.mjs
node scripts/unloading-journey.mjs
```

El subconjunto de compatibilidad registra **36/36 PASS**. Incluye diez pruebas de descarga: versiones y ámbito, cambio de ejecución, checkpoint material, borrador sin autoridad, competencias y turno, transporte con asientos/masa, reservas sin doble conteo, herramientas con proveedor replay, recuperación por congestión de flota y dos casos HTTP físicos.

Los casos HTTP demuestran:

- Donante y receptor distintos: traslado real de equipo del receptor, aprobación independiente, descarga finita y recepción exacta de 300 unidades de la operación original. Un segundo trabajo interrumpido por un cambio declarado de turno permanece inconcluso y conserva su cargamento.
- Ambos camiones propios retenidos: cancelación revisada del cargamento adicional, retorno físico del vehículo y la carga, traslado del equipo con el vehículo realmente libre y recepción del primer cargamento. No se acredita ayuda por el cargamento devuelto.

Un negativo dirigido adicional conserva el rechazo de personal recibido como `expired`: `SUPPLY_EXPIRED`, sin propuesta factible. También se rechazan versiones/cantidades antiguas, personal ajeno o fuera del lugar, falta de competencias y trabajo que cruza descanso. El subconjunto dirigido de ese caso registra **1/1 PASS**.

Las dos regresiones anteriores de `staff-calendar` eran fixtures sin asientos de pasajero tras el nuevo contrato común de carga. El vehículo de prueba declara ahora sus dos asientos, 150 kg y 0,15 m³; se mantienen los rechazos de descanso y duración de trabajo. No se relaja el compilador ni la fuente para pasar esas pruebas.

K16 exige además `operation.createdAt` finito y no negativo, y que la recepción de servicio no lo preceda. El test negativo cubre la ausencia de ese dato. La descarga es una continuación intermedia: no crea un segundo crédito de ayuda separado de la recepción de la entrega original.

## Experiencia de operador comprobada en Chromium

`reports/ui-unloading-journeys.json` y `reports/unloading-journey/1791855337282/` registran **15 comprobaciones PASS**, cero errores de consola/página y cero llamadas de modelo. Son pruebas de escritorio a 1920 px, móvil a 390 px y navegación por teclado sobre HTTP local y física real del simulador:

- Vista inicial con 0/300 recibido, sin confundir llegada con ayuda entregada.
- Preparación de traslado, evidencia original y aprobación del receptor mediante teclado.
- Traslado físico de personal terminado mientras la ayuda original sigue en cero.
- Segunda propuesta y aprobación independiente de descarga; recepción final 300/300 sin nuevo despacho de agua.
- Auditor con acceso a cantidades/estado, sin controles de preparación o autorización.
- Solicitud expandida y plan comprobado conservados durante refrescos periódicos de 4,5 segundos, vinculados a sus versiones materiales. El servidor vuelve a validar antes de preparar; la memoria visual no concede autoridad.

Las solicitudes pendientes aparecen antes que las completadas, con contador pendiente/total, doce visibles inicialmente y botón para mostrar otras doce. Una regresión **1/1 PASS** comprueba que 24 recepciones recientes no ocultan una solicitud pendiente anterior. Se avisa del máximo de cien solicitudes recibido por este panel.

La primera ejecución del viaje de navegador falló porque la aclaración de la fuente fue realmente inconclusa y no existía un edificio recibido para planificar. Ese fallo se conserva. El flujo de prueba realiza ahora hasta tres aclaraciones reales con claves distintas y conserva sus resultados; no sustituye el resultado por verdad privada ni cambia la probabilidad de respuesta. Otro fallo de interacción se conserva: el test cerraba una solicitud que la interfaz ya mantenía abierta; el test actual sólo la abre cuando está cerrada.

Hashes de la ejecución de navegador anterior al cambio independiente del reloj de ingesta:

- Candidato: `df9c7de60e75a1637b090cafdbcf7b054cd0d0492c7fc2ab81d39dbc31711bd5`.
- Evaluador: `5e6a11ecae88648e491fe680fd7ae7407d00e12622b244c021dd5d9e661bbeab`.
- Simulador: `2825f94dffbf6db2835c05170ea00d9225863e4955682debd6236c4c71454b4e`.

La verificación global posterior debe ejecutar de nuevo los viajes de UI y conservar sus propios hashes. Este documento no atribuye el resultado de una verificación global todavía pendiente a estas fuentes, ni traslada mediciones pagadas históricas al candidato reparado. No demuestra ventaja causal de GenAI ni mejora de K01/K02; esas afirmaciones requieren campañas comparables nuevas con costes, fallos y censura completos.
