# Disponibilidad física y medición de capacidad

Estos contratos completan el laboratorio local. No convierten una prueba unitaria en una mejora comparativa ni una hora de capacidad en una vida salvada. Todos los brazos reciben la misma física, las mismas proyecciones permitidas y los mismos límites.

## Vehículos y conductores

Una llegada no garantiza disponibilidad: el vehículo puede conservar carga, pasajeros, trabajo o un regreso comprometido. El planificador usa su estado recibido, capacidad, masa cargada, combustible, restricciones de la ruta y disponibilidad declarada del conductor. El origen vuelve a comprobar estas condiciones al ejecutar; una instantánea favorable no permite ignorar un cambio posterior.

El calendario del propietario puede declarar ventanas y un siguiente compromiso. Se comprueban carga, transporte, recepción y regreso físico antes de ese compromiso, con las estimaciones recibidas de tráfico y manejo. La estimación no conoce congestión futura. Un regreso planeado no libera un vehículo ocupado: necesita el recibo de llegada real. El caso de reutilización demuestra dos entregas parciales después de ese regreso; no demuestra aprovechar el tramo vacío para transportar agua.

El pickup exige estar en el depósito real. Reencaminar un viaje hacia otro lugar no teletransporta su stock. Las tareas de inspección y reparación tampoco cambian de sitio al cambiar una ruta.

## Personal cualificado y descansos

Una etiqueta de personal no acredita una competencia. Se conservan perfiles recibidos, cantidades, competencias y reservas al prestar, transportar, reexpedir, asignar y devolver equipos. Un mismo grupo no atiende simultáneamente dos tareas. Las intersecciones de competencias no se inventan tomando el mínimo de dos cuentas marginales.

Un calendario homogéneo declarado contiene versión, reloj observado, inicio, turno y descanso. El inicio y el final del trabajo deben encajar en la ventana aplicable; viajar como pasajero no equivale a trabajar. Activación, inspección, reparación y producción física respetan esas condiciones. El alcance es un modelo agregado de equipos, no un sistema completo de nómina o turnos individuales. Un origen sin calendario sigue marcado como desconocido; no se presume un historial de trabajo.

Los cambios materiales de conductor, calendario o ventana deben despertar una propuesta diferida. Una consulta repetida sin cambio no debe disparar otra investigación. La UI muestra disponibilidad y tiempo relativo al reloj de la simulación; no interpreta ese reloj como una fecha del calendario real.

## K09: horas con una definición verificable

El motor integra, por intervalos del reloj fuente, capacidad comprometida de vehículos, tiempo en movimiento, espera y bloqueo; y personas reservadas, en transporte y en trabajo de campo. El personal reservado que pasa a carga física se cuenta una vez. El tráfico de fondo no se atribuye a la organización. Un vehículo vacío, libre y llegado no sigue consumiendo capacidad comprometida.

Las horas de trabajo de campo se limitan a inspecciones y reparaciones con una asignación física en fase de trabajo. Las horas comprometidas incluyen tiempos de preparación, espera y regreso: no son horas productivas, costes salariales ni la suma de todo el esfuerzo de respuesta. Las categorías se solapan y no deben sumarse como si fueran independientes.

`evaluate(world).utilization` incluye valores nativos en milisegundos y horas. Un checkpoint anterior sin medición declara `available:false`; desconocido no es cero. Se conserva el contador al reiniciar y se integra también al reconstruir los límites de entradas sin eventos, para que el replay reproduzca exactamente el estado.

## Qué debe conservar cada comparación

Cada mundo identifica las tres huellas del producto, evaluador y motor; el protocolo previo, semilla, horizonte, recursos, permisos, presupuesto y latencias. Debe conservar demanda censurada, servicio parcial, déficit por unidad nativa, kilómetros, combustible, capacidad comprometida, fallos, coste conocido y reserva de coste desconocido. Un plazo futuro no se marca incumplido antes de tiempo.

La ventaja temporal requiere menos tiempo hasta atención física útil o suficiente frente a una referencia competente, con cobertura y calidad comparables. No se acredita con un borrador más rápido, menos consultas, más animaciones ni entregas que incumplen los contratos anteriores. Los resultados previos negativos siguen disponibles aunque otra versión mejore.
