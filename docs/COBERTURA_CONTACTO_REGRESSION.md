# S07 / O21: comprobación de lugares sin contacto

Implementación local funcional, sin inferencia pagada, sin afirmación de una mejora temporal de GenAI.

## Qué hace

`src/coverage.mjs` calcula brechas usando exclusivamente el directorio estático recibido y contactos de la organización. Una fila representa un edificio concreto. Los contactos de un sector se conservan como información separada: no confirman el contacto de todos los edificios del sector. Ni una consulta de inventario ni el timestamp de metadatos de un edificio establecen contacto.

El operador ve una sola tarjeta compacta en el resumen. El diálogo muestra lugares desconocidos, contactos antiguos, comprobaciones en cola y resultados. La tarjeta declara si sus números pertenecen al directorio recibido o al ámbito aprobado por el responsable; no presenta un ámbito parcial como cobertura de toda la región.

El coordinador aprueba los lugares permitidos, antigüedad máxima, canales, concurrencia y espera máxima. El coordinador o despachador autoriza después un lote exacto de objetivos y métodos contra las versiones actuales del directorio, política y cobertura. La interfaz permite una comprobación concreta por aprobación. La API admite hasta cinco por lote, un máximo de veinte pendientes y de uno a cinco activos, según la política aprobada.

La aclaración usa la cola de contacto limitada del simulador. La comprobación por radio requiere una tripulación y un vehículo propios elegidos explícitamente. El origen vuelve a validar disponibilidad, permisos y restricciones físicas; una negativa no se transforma en confirmación. La fuente y esas mismas comprobaciones son accesibles a los métodos convencionales.

## Continuidad y autoridad

Las solicitudes, versiones, autorización, límites y estados se guardan en la base durable antes de emitir la consulta. Cada comprobación mantiene una clave de idempotencia ligada a organización, solicitud, lugar y método. Tras una respuesta ambigua se busca primero una comprobación propia ya recibida. No se crea otra orden para recuperar el mismo trabajo.

Los fallos transitorios de verificación permiten como máximo tres intentos, separados por sesenta segundos o el cooldown aprobado, medidos con reloj recibido. Veinte sondeos al mismo tiempo no generan veinte consultas. Al agotar intentos o espera se requiere revisión; no se autoriza automáticamente un nuevo lote.

Cambiar directorio o política, revocar al responsable, reducir su rol, vencer la autorización o cambiar el identificador de simulación impide emitir las comprobaciones todavía en cola. Las comprobaciones ya emitidas conservan sus operaciones y sus recibos. Detener el seguimiento local tampoco cancela ni borra retroactivamente trabajo físico.

Sólo un recibo completado, entregado, con objetivo, organización, método, propósito, hora y versión correctos puede completar una comprobación. Un ACK, una respuesta inconclusa o una respuesta antigua no bastan. La metadata de cobertura requiere esquema, timestamps y versiones coherentes; un rechazo mantiene atención explícita y conserva el último contacto válido.

La normal ingestión procesa las observaciones reales de necesidades que retorna la fuente. Coverage nunca crea una necesidad, certifica seguridad, activa un edificio ni despacha ayuda. Que un contacto exista tampoco significa que el lugar no necesite ayuda.

## Pruebas y evidencia

- `tests/coverage.test.mjs`: diez regresiones de alcance, permisos, versiones, contacto exacto frente a sector, cola limitada, ACK, resultados negativos, agotamiento, idempotencia con reinicio durable, esquema/timestamps y cancelación/revocación. Diez pasan en el conjunto focalizado.
- `tests/coverage-physical.test.mjs`: recorrido HTTP de S07, con un barrido finito de todos los lugares del directorio recibido. El controlador no consulta necesidades ocultas para elegir un objetivo. Las aclaraciones consumen la cola real; aparece una necesidad silenciosa de 200 litros mediante un recibo recibido. Después se prepara un despacho común, se aprueba por separado y la fuente verifica 200 litros realmente servidos, una inspección por objetivo y cero invariantes. Pasa contra la fuente `e995c77f13cf4bf601cea10b80a573cca3f8c7424f496addc9a3dc02291fa753` de esta iteración; el gate completo vuelve a ejecutar contra la siguiente fuente final.
- `scripts/coverage-journey.mjs`: navegador real a 1920×1080 y 390×844, tarjeta, diálogo, aprobación de política y objetivo exacto, ACK sin crédito, confirmación posterior por reloj y cola del simulador, teclado dentro del diálogo y cero desbordamiento horizontal. Primer recorrido corregido pasó dos de dos. El reporte reproducible es `reports/ui-coverage-journeys.json`; screenshots ignorados en `.local/screenshots/coverage-1920.png` y `coverage-390.png`.
- `tests/offline-shell.test.mjs`: los módulos de cobertura y descarga están precacheados; las APIs operativas no se cachean como contenido público. El cache del shell avanza a v12.
- Las fixtures de `delegated-assessment.test.mjs` e `investigation-assessment.test.mjs` declararon un asiento recibido para su tripulación. Las aserciones de competencia, consentimiento, recibos, cambios del sitio y ocupación permanecen iguales. Diez regresiones de esos archivos pasan.

Conjunto focalizado: 22/22 pruebas pasan. Fallos anteriores del helper de pruebas —clave de comando reutilizada y limpieza de PGlite antes de cerrar— y del selector accesible del navegador se conservaron en las salidas de sesión y se repararon sin reducir las exigencias físicas.

Repetición tras el último cierre de atomicidad de descarga: fuente `2825f94dffbf6db2835c05170ea00d9225863e4955682debd6236c4c71454b4e`, S07 física 1/1 y navegador 2/2 pasan. El reporte de navegador conserva `candidateChanged:false`, candidato `3c1a6057f33d6b394a3f5fc52c7e509ba31c570da52221997c5da603e46679ff`. Estas comprobaciones funcionales no son una comparación de políticas ni una medición pagada del modelo.

## Límites

Esto demuestra una comprobación funcional de cobertura y recuperación de información silenciosa. No prueba comprensión humana, validación de campo ni una ventaja temporal del modelo. No descubre una necesidad sólo porque un lugar esté silencioso. El barrido de la prueba es explícito y pequeño; la política y la cola no equivalen a una capacidad ilimitada para inspeccionar toda una región. La fuente puede ser inconclusa, inaccesible o rechazar una comprobación: ese lugar sigue desconocido y el operador debe decidir otro canal o una nueva comprobación.
