# Personal mixto, consentimiento y recibos físicos: candidato aislado

Fecha: 2026-10-13. Esta implementación vive en el worktree de desarrollo aislado; no modifica ni acredita las campañas congeladas de `main`. Los resultados son regresiones locales sin proveedor de pago, no una mejora de GenAI ni una estimación de vidas salvadas.

## Defecto que se cierra

Un depósito puede contener personas con habilidades distintas después de una compra o transferencia. La lista universal `qualifications` describe únicamente las habilidades de todas las personas restantes; no basta para descubrir un evaluador disponible dentro de un grupo mixto. Tampoco es válido usar el mínimo de dos cuentas marginales como si esa misma persona tuviera ambas habilidades. El producto necesita capacidad cualificada recibida y una selección tipada que el dueño pueda aprobar y el motor pueda cumplir físicamente.

`receivedStaffCapacity` utiliza los perfiles anónimos recibidos cuando existen y comprueba que sus cantidades y cuentas por habilidad son coherentes. Si sólo hay cuentas marginales, utiliza la intersección garantizada. Resta reservas, mínimos protegidos y asignaciones prospectivas de manera conservadora; nunca inspecciona qué personas privadas reservó el dueño. Metadatos incoherentes no generan una capacidad positiva. Una oferta antigua de un grupo homogéneo sólo acredita sus cualificaciones universales explícitas.

## Contrato de ejecución

- Compartir personal requiere permiso explícito del dueño. Una oferta envía cantidades/perfiles agregados anónimos; no comparte nombres, registros privados de reserva o evaluaciones del observador.
- `plan_assessment` puede encontrar capacidad `field_assessment` dentro de un stock mixto recibido. El responsable del lugar y el dueño de personal/vehículo autorizan por separado. El viaje, trabajo de campo y entrega del informe siguen siendo físicos y finitos.
- `plan_service` usa las habilidades requeridas del lugar y añade `staffSkills` al `dispatch` compilado. `commitment` y `transfer` conservan ese selector. Cambiarlo requiere otra aprobación; no transforma una reserva genérica existente en una cualificada.
- El motor reserva perfiles concretos. Carga, entrega, consumo, pérdida y devolución conservan cantidades e intersecciones. Una devolución no duplica competencias. Un perfil comprado sin competencias declaradas no recibe certificaciones inventadas.
- Una oferta revocada o un cambio recibido de competencia invalida trabajo futuro; no borra un viaje ya emitido ni convierte una revisión en autoridad.
- El recibo de personal incluye el selector aprobado y el resumen físico `receivedStaff`. El coordinador comprueba propietario, destino, selector y cantidad/habilidades reales; un texto afirmando “personal cualificado” no basta.
- El resumen de autorización muestra las habilidades necesarias con lenguaje legible. El resumen narrativo no puede cambiar las acciones tipadas.

La falta de una dependencia devuelve diagnósticos acotados por propietario/recurso recibido: stock, competencia, compatibilidad, transporte o asignación prospectiva. Incluye reserva/mínimo protegido, cantidad cualificada y referencias; la ausencia de una oferta no afirma que otro dueño realmente carezca de recursos. Son pistas para una consulta/comprobación existente, no herramientas inventadas ni certificación de factibilidad de ruta.

## Compartir el vehículo con la evaluación

`responseQueue` conserva la asignación prospectiva de cada `verify` físico por propietario/propuesta/paso: una persona competente y su vehículo, sin atribuirles unidades de ayuda ni una necesidad satisfecha. Una comprobación ya reservada en el inventario recibido no resta el personal dos veces. El vehículo queda protegido hasta un recibo terminal. Rechazo antes de emitir libera únicamente la asignación prospectiva. `plan_service`, `plan_assessment` y el asignador convencional consumen la misma cola; ninguna rama recibe flota adicional.

## Evacuación: autorización no equivale a pasajeros recibidos

`evacuation_receive` registra `op.received` con los pasajeros que efectivamente ingresaron, antes de liberar el vehículo. El wrapper de recibos reenvía ese dato; no sustituye un dato ausente por el número autorizado. Una llegada, una orden, un asiento disponible o un recibo antiguo no son una admisión nueva. Una interrupción de comunicación retrasa la observación, aunque el ingreso físico ya haya ocurrido.

Los recibos propios/consentidos permiten descontar, sin duplicar, la ayuda física posterior a una fotografía antigua de necesidades. En una evacuación serial, 20 recibidos + 20 en tránsito + 10 prospectivos no crea otros 20 pasajeros por inferencia repetida. Un nuevo peligro sí puede volver a abrir una investigación; el progreso anterior permanece histórico.

## Evidencia local disponible

| Regresión | Qué comprueba | Resultado observado |
|---|---|---|
| `tests/mixed-staff.test.mjs` | Capacidad conservadora, intersecciones, reservas, versiones, consentimiento, revocación, recibo tipado, resumen humano y diagnóstico de carencias | 5/5 PASS |
| `tests/mixed-staff-physical.test.mjs` | Compra y traslado reales crean stock mixto; cuatro apps por HTTP; ambas aprobaciones; evaluación cualificada; provisiones físicas y refugio con 50 ocupantes | 1/1 PASS |
| `tests/evacuation-progress-receipts.test.mjs` | Propio/peer, cantidad efectiva, fotografías antiguas, deduplicación, recibos tardíos y ausencia de nueva inferencia sin cambios | 3/3 PASS |
| `tests/assessment-allocation-holds.test.mjs` | Holds propios/peer, stock reservado sin doble resta, liberación tras recibo/rechazo; evaluación y ayuda viajan en móviles distintos de la flota original | 7/7 PASS, incluida la regresión física |
| Motor `tests/staff-selection.test.mjs` | Selección física exacta, propietarios, habilidades disjuntas, reservas concurrentes, retorno y replay | 3/3 PASS |
| Motor `tests/evacuation-service-receipt.test.mjs` | Tres viajes seriales reales 17+20+13, ingreso 50, interrupción de destino, recibo tardío y checkpoint/replay | 2/2 PASS |

La suite completa del motor aislado pasó **178/178** pruebas, sin skips, cancelaciones o fallos, con `ENGINE_BUILD 9675beeef4ccf2dc2230b25505297d65ce7ce8db1ceb416798b8b02bcd3f9062`. Las pruebas focalizadas de plataforma pasaron antes del cierre conjunto; las ediciones concurrentes de raíz/otros agentes requieren un nuevo gate completo de plataforma/UI/huellas antes de integrar o comparar.

La prueba del refugio usa una selección explícita de ofertas para ejercer el depósito mixto en lugar de un depósito homogéneo alternativo. No mide cuánto elegiría el modelo ese depósito. La puntualidad de evaluaciones, vigencia, cualificaciones y productividad siguen siendo supuestos operacionales que necesitan revisión externa. Aún faltan medidas congeladas de eficacia, latencia/coste del proveedor real y cualquier demostración específica con Gemini.

## Rendimiento headless de este motor

El protocolo `../disaster-response-simulator/runs/benchmarks/candidate-1791845276669-protocol.json` se guardó antes de ejecutar cinco perfiles sin proveedor. El reporte homónimo `.json` conserva hardware, parámetros, hashes por archivo y huellas inicial/final idénticas al build del motor indicado arriba. Los cinco perfiles terminaron con ledger válido: unit ×4444,74; city ×1129,71; region ×221,12; default-48h ×1118,64; information-10000 ×1744,24. El escenario de 48 horas procesó 1.282.177 eventos en 154,474 segundos de ejecución.

Es una corrida en una máquina compartida con otros laboratorios. La velocidad excluye hash final, exportación, rendering e inferencia externa; la memoria RSS corresponde al proceso, no únicamente al último worker. El caso regional no alcanza ×1000. No se anuncia velocidad universal ni recuperación del pipeline modelo/operador a esa escala.
