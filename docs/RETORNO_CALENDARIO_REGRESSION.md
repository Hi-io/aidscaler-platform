# Retorno vacío, ventanas recibidas y condiciones físicas de capacidad

Estado: cierre funcional local en el worktree candidato. No acredita por sí solo ventaja de un modelo ni mejora de un KPI. No incluye trabajo de GCP, Gemini ni validación de campo.

## Requisito y recorrido exacto

I11 exige vehículos y planes de retorno/compromisos, no sólo inventario actual. El caso S01 exige cubrir 600 L mediante dos contribuciones de 300 L, incluyendo el camión que tiene un retorno vacío preexistente. Las ventanas condicionales son metadata declarada del dueño, recibida por consultas normales o por compartición consentida. No son una predicción perfecta de disponibilidad física.

`tests/empty-return-window.test.mjs` prueba tres recorridos HTTP sin proveedor:

1. Favorable: la necesidad inicial se publica realmente a los 30 segundos; org0 recibe sus datos y envía exactamente 300 L con `v-org0-0`. El camión `v-org1-0` sigue ocupado hasta completar su retorno vacío real. Después de recibir su nueva posición/calendario y el consentimiento de compartición, se prepara la segunda contribución de 300 L. El socio recibe una propuesta pendiente y debe aprobarla por separado. Sólo dos operaciones físicas de entrega sirven exactamente 600 L; el camión del socio regresa al nodo de su próximo compromiso dentro de su ventana.
2. Adversa: una ventana recibida de 20 segundos impide el segundo trabajo. Se conserva el déficit de 300 L con motivo `VEHICLE_CALENDAR`. No se reserva ni carga stock del socio para una misión inviable.
3. Sin solución trivial: el dueño del socio rechaza la segunda misión para preservar su operación independiente. La aprobación del coordinador no sustituye a la del dueño; no se emite una segunda entrega y los 300 L pendientes siguen visibles.

Las tres variantes pasaron. Una falla inicial del ensayo no se ocultó: la fixture consultaba recursos a tiempo cero sin esperar la publicación física de la necesidad y obtenía un plan vacío. La reparación fue esperar el reporte real e ingerirlo por HTTP; no se añadió una necesidad directamente al almacén del candidato.

## Reglas comunes, autoridad y límites

- `receivedVehicleCalendar` usa el reloj y los horarios recibidos. Comprueba recogida, carga, comunicación nominal, entrega, descarga y retorno vacío al nodo del siguiente compromiso. El combustible incluye ese retorno. Una ventana declarada sin mapa o timing suficiente produce una negativa explícita.
- El asignador común sigue excluyendo vehículos ocupados. El calendario no crea una reserva futura ni autoriza a usar un camión que todavía está trabajando. Las ventanas se validan otra vez durante revisión/emisión y la fuente protege los cambios/retrasos físicos.
- `unserved[].blockingReasons` y los refusals conservan los déficits y sus responsables; filtrar una capacidad inviable no permite declarar que desapareció la necesidad.
- Los brazos convencionales y los modelos usan el mismo asignador, contratos, ventanas, herramientas y permisos. No se consulta el observador en el producto.
- Esta implementación reutiliza el camión **después** de regresar vacío a la base donde está el agua. No transporta agua en el segmento vacío previo ni demuestra ahorro de kilómetros por cargar durante ese segmento. Una oportunidad futura previa al retorno requeriría otra autorización/contrato y no se acredita aquí.
- La nota heterogénea de S01 se conserva como fuente recibida. Este ensayo funcional no demuestra que un LLM la haya interpretado mejor que una referencia competente; eso requiere la comparación predeclarada con un modelo real y todos sus costes.

## Masa, ubicación, congestión y conductor

`tests/reroute-mass.test.mjs` (8 pruebas) impide aprobar para un camión cargado una ruta que sólo soporta su masa vacía. Generadores, agua y pasajeros tienen unidades distintas; los recibos descargados y retornos finalizados no conservan masa fantasma. Un retorno de recuperación con la misma carga sí conserva su masa. Una fase de recogida debe seguir hacia el nodo recibido del stock y preservar el posterior destino de ayuda; una inspección/reparación no puede cambiar de sitio durante un reroute. La fuente exige colocación física antes de cargar.

`tests/vehicle-calendar.test.mjs` (6 pruebas) cubre ventanas after/before, retorno/próximo compromiso, combustible, reloj/timing incompleto, cambio de calendario antes de revisión y proyección consentida frente a un calendario privado más favorable. La ruta incorpora únicamente congestión ya recibida y redondea los tiempos como el motor; no predice futuras colas.

`tests/driver-availability.test.mjs` (4 pruebas) distingue la capacidad del vehículo de la disponibilidad del conductor. Un `driverAvailable:false` recibido bloquea el asignador, las condiciones del vehículo, dispatch, evacuación, inspección y reroute antes de emitir trabajo nuevo. El déficit tiene motivo `VEHICLE_DRIVER`; una carga ya presente no se borra ni se cuenta como recibida. La tarjeta de transporte muestra presencia, ausencia o desconocido. Compartir un flag no comparte identidad. La ausencia de un flag legado permanece desconocida y no afirma que exista un conductor; la fuente conserva la revalidación física.

## Personal y final del trabajo

`tests/staff-planning-calendar.test.mjs` (3 pruebas) comprueba el reloj fuente recibido, el inicio efectivo del trabajo y su final tras traslado/manipulación, inspección o setup. Una plantilla competente debe seguir respetando reservas y habilidades; la cantidad de personas no acredita que puedan trabajar fuera de su turno. El transporte pasivo puede ocurrir durante un descanso si la ventana declarada permite empezar y terminar el trabajo al llegar. Si falta tiempo/ruta necesario para una ventana declarada, el guard conserva una negativa `STAFF_CALENDAR`.

Los valores de carga/descarga, comunicación, inspección y setup proceden de la consulta recibida de policy. El producto no usa configuración privada del mundo para completar esos tiempos.

## Evidencia y crédito permitido

- Antes del cierre de driver/staff, la suite afectada pasó 34/34: tres S01, ocho masa/reroute, seis calendario y reglas/repair contextual B5/B6/B8/B9.
- Después de driver, pasó 30/30 en la suite de S01/calendario/masa/fleet/planning más sus tres pruebas de disponibilidad.
- El primer cierre de staff pasó 16/16 (staff-planning 3, mixed-staff 5, driver 3, planning 5). Los resultados finales del gate completo y de la fuente se registran por el controlador raíz después de que todos los agentes declaren HOLD.

Estos resultados acreditan mecanismos, no un primer puesto ni una mejora sustancial medida. La ganancia física debe medirse con las tres huellas estables, pares exactos, cohortes y costes declarados; no se atribuye al LLM un arreglo común que también recibe la referencia convencional.
