# NEXO: diagnóstico y mejora del tiempo hasta ayuda útil

Este documento separa fallos del producto, límites del experimento y cuestiones todavía no demostradas. El objetivo de desarrollo autorizado es demostrar una mejora sustancial del tiempo hasta servicio útil en una comparación justa. Los porcentajes iniciales de [PLATAFORMA.md](PLATAFORMA.md) siguen como aspiraciones de diseño, no como resultados ya alcanzados. La simulación no acredita impacto de campo ni garantiza una posición en la competición.

## 1. Qué falló en la comparación anterior

Las ejecuciones anteriores se conservan. No se reemplazan sus números con resultados de otra versión.

| Evidencia | Resultado observado | Explicación respaldada por la traza |
|---|---|---|
| Campaña 36, S01 y S23, tres semillas | B5: 647.014 s hasta servicio suficiente; B6: 692.014 s. Las mismas tres entregas completan 600 L. | B6 pregunta al modelo cómo usar un plan determinista ya factible. Tres llamadas añaden 45 s modelados, sin mejorar las cantidades, rutas o recepción. |
| Campaña 36, S19 | B6 empeora la integral de déficit de agua un 2.30% y refugio un 1.52% frente a B5. Todos los brazos compartidos completan 600 L y 50 plazas ocupadas. | La composición reconocida se puede resolver con la misma receta y datos recibidos. El razonamiento adicional añade tiempo. No demuestra una capacidad exclusiva del LLM. |
| Carga física, semilla 01 | B5 y B6 completan 9 de 101 necesidades. B6 termina más tarde: p50 de completadas 45.29 min frente a 26.80 min. | B5 usa ocho vehículos en la primera ronda. B6 restringe la primera planificación a dos necesidades de agua y deja otros tipos para la segunda. |
| Carga física, semilla 02 | B5 completa 9; B6 completa 4. B6 deja todas las mantas sin atender y sobreprovee 23 porciones de comida. | La selección del foco reduce el lote a 2, 2 y 1 acciones por ronda. La necesidad entregada por un socio reaparece en el coordinador. B7 sí solicita el lote de ocho y completa 9: no es una falta inevitable de capacidad del modelo. |
| Carga física, ambos mundos | Solo tres rondas, después avance hasta cuatro horas; más de 90 necesidades siguen pendientes. | Es un experimento de atención limitada, no una demostración de despacho continuo a escala. Agregar necesidades sin mantener el ciclo de operación no crea una comparación útil del descubrimiento con GenAI. |

Fuentes de evidencia anteriores:

- [Campaña principal: summary.json](../reports/evaluations/1791810897832/summary.json) y [comparaciones](../reports/evaluations/1791810897832/contrasts.json).
- [Carga física: protocolo y seis resultados](../reports/physical-load/1791811244239/summary.json).
- Los detalles de acciones, llamadas, consultas, versiones y errores están en cada JSON de ejecución de esas carpetas; el resumen no sustituye las trazas.

## 2. Causas del producto que hay que corregir

### 2.1 No interponer inferencia en decisiones ya resueltas

Si cantidades, restricciones y capacidades recibidas soportan una asignación determinista, preparar el borrador sin llamadas adicionales al LLM. Mantener revisiones independientes de propietarios, validación de cantidades/rutas/compatibilidad y la distinción entre propuesta, orden y servicio. La velocidad de ese camino se atribuye a ingeniería del producto; no a razonamiento generativo.

Utilizar GenAI para interpretar lenguaje o medios, resolver ambigüedad con herramientas, identificar hipótesis operativas y escoger comprobaciones decisivas. Una solución híbrida puede ahorrar tiempo sin pedirle al modelo que invente un optimizador.

### 2.2 Un foco visual no debe convertirse en una cola operativa de una sola necesidad

La prioridad aprobada organiza el lote de necesidades compatibles. Buscar capacidad para todos los tipos relevantes y respetar mínimos, turnos y vehículos. Mantener visibles necesidades que no entraron en el lote, causa de aplazamiento y próximas condiciones que lo pueden desbloquear. No publicar «100 problemas resueltos» al recibir 100 problemas ni contar ocho propuestas como ocho servicios.

### 2.3 Descontar compromisos parciales y recibos de socios correctamente

Los borradores pendientes generan retenciones de planificación, no reservas externas ni ayuda entregada. Descontar la cantidad retenida, no excluir toda una necesidad cuando el borrador cubre solo una parte. Evitar asignar de nuevo sus vehículos y stock al formar otro borrador.

Un recibo de socio debe estar ligado a propietario autenticado, propuesta y paso autorizados, operación de la fuente, vehículo, recurso, necesidad/destino y cantidad. Una bandera `completed: true` no basta. Guardar progreso y recepción física en el coordinador. Descontar operaciones todavía en tránsito y servicio efectivamente recibido; deduplicar por propietario e identificador de operación.

La proyección de una necesidad suma al `served` de su snapshot solo los recibos físicos posteriores al tiempo de ese snapshot. Cuando llega un snapshot más reciente que ya incorpora esas entregas, no sumarlas de nuevo. La cantidad programada, la llegada al edificio y la confirmación de transporte no son servicio. Las entregas para aprovisionar un refugio completan ese paso de carga; no equivalen a personas refugiadas.

### 2.4 Operación continua después de nueva evidencia

Reanudar al cambiar una condición material: resultado de inspección, capacidad liberada, recibo, retirada, bloqueo o nueva necesidad. No cerrar definitivamente el ciclo porque se agotaron tres oportunidades de prueba. Mantener presupuestos finitos, prioridad aprobada y supresión de llamadas repetidas ante contexto material idéntico. El bucle no puede investigar cada minuto el mismo caso imposible.

### 2.5 Reducir errores y consultas que no cambian la acción

Las trazas muestran `plan_allocations` con argumentos vacíos que fallan con `Unexpected end of JSON input`. Un tool sin parámetros opcionales debe aceptar `{}` y no consumir una llamada de corrección evitable. Registrar fallos reales del proveedor, truncamiento y coste desconocido por separado. No recortar el espacio de respuesta hasta impedir razonar ni enviar inventarios, mapas o publicaciones completos cuando basta una selección relevante con acceso paginado al resto.

### 2.6 Cancelación, cambios y retención también afectan la continuidad

El nuevo recorrido de descubrimiento necesita las mismas garantías que una investigación: cancelar antes y durante comprobaciones, detener la creación de borradores después de una cancelación, impedir reanudaciones canceladas y bloquear fuentes cambiadas o borradas. La retención incluye el recibo de descubrimiento y sus trabajos. Un reinicio recupera la continuación y conserva el recibo de percepción para no repetir gasto.

La actualización de recibos físicos exige que el gateway de un contratista envíe propietario, operación, tipo físico, destino, necesidad, vehículo, recurso, cantidad recibida y tiempos. El formato antiguo dejaba la ejecución pendiente aunque la entrega ya hubiera terminado. Se corrige el productor del recibo; no se acepta un `completed` sin evidencia física.

## 3. Qué no estaba evaluando el simulador/protocolo

### Correcciones adicionales encontradas en el primer piloto completo

El piloto de la versión de descubrimiento v2 conserva **12/12** necesidades atendidas por B5 y B6, sin exceso ni violación física, pero B6 es **18,06% más lento** en tiempo medio restringido: 30,94 frente a 26,21 minutos. Superar B8 (30,91% menos tiempo, 12/12 frente a 11/12) no basta para superar la mejor referencia. Los controles de lectura cero y cuatro revisores rápidos también conservan empates/pérdidas. [Resultados originales](../reports/discovery/1791831327931/summary.json), [cero lectura](../reports/discovery/1791831824583/summary.json) y [cuatro revisores](../reports/discovery/1791831826513/summary.json).

La traza respalda tres nuevas causas, no una supuesta incapacidad universal del modelo:

- **Comprobaciones duplicadas entre tandas.** Tres tandas distintas vuelven a pedir la misma ubicación mientras la primera sigue pendiente. La idempotencia por episodio no basta: se reutiliza la consulta pendiente real del dueño para el mismo objetivo y canal. Cada testigo sigue teniendo su interpretación y procedencia propias.
- **Prioridad fragmentada.** La continuación de una tanda preparaba una respuesta solo para sus necesidades. Ahora la interpretación aporta evidencia; la asignación consulta todas las necesidades recibidas bajo la política aprobada. Un lote de fuentes no se convierte en un planificador que compite por el camión con otro lote.
- **Selección espacial insuficiente.** La asignación escogía el primer camión disponible y no comparaba el viaje hasta el stock. B6 recorrió 114 km frente a 95,25 km de B5. Se compara acceso y tiempo de viaje recibido para recogida y entrega, con combustible, turno, propiedad y carga. La misma mejora se aplica a todos los brazos. Un ETA estimado no es una promesa de recepción ni conocimiento de vías aún no observadas.

Los nueve lotes posteriores sin candidatos también consumieron tiempo/coste; una oportunidad de ahorrar inferencia no autoriza descartar publicaciones sin conservarlas. Los resultados de las correcciones requieren una nueva campaña: este párrafo no convierte el piloto fallido en un éxito.

La campaña de carga entrega las 100 necesidades como observaciones oficiales a todas las organizaciones antes de investigar. Sus publicaciones sociales repiten demanda ya estructurada. Ese caso mide asignación y batching; no mide cuánto tarda en entender información social desorganizada ni cuánto antes llega una comprobación útil.

Hace falta una familia complementaria donde una necesidad exista físicamente antes de estar formalmente reportada. Las publicaciones deben ser entradas observables con contexto, incertidumbre, duplicados y retrasos de publicación. La interpretación no concede automáticamente certeza: el sistema pide la comprobación o revisión pertinente y obtiene una observación operativa a través de los mismos canales que la referencia.

Si se añade latencia convencional de lectura/verificación, declararla antes del ensayo y hacer sensibilidad incluyendo cero. No atribuir a una medición humana un tiempo elegido por los desarrolladores. No hacer la referencia deliberadamente incompetente, darle menos fuentes, peor logística o una cadena de permisos innecesaria. Ambas políticas deben recibir el mismo mundo, fuentes accesibles, recursos, permisos y retrasos físicos.

La referencia de datos estructurados instantáneos permanece como control negativo: si ya conoce todo y planifica correctamente, NEXO debería empatar o exponer el coste de cualquier inferencia sobrante. La mejora esperada pertenece al trabajo de información antes de planificar y a la continuidad, no a cambiar las leyes físicas de transporte.

### 3.1 Disponibilidad terminal de la flota

El [primer piloto de descubrimiento](../reports/discovery/1791830054147/summary.json) atendió 8 de 12 necesidades con B5, exactamente una por vehículo, aunque sobraba stock y no hubo bloqueos ni fallos de viaje. El motor liberaba físicamente los vehículos al descargar, pero no emitía su telemetría terminal. La observación recibida quedaba para siempre `en_route`. No era una prueba válida de capacidad recurrente: el planificador rechazaba correctamente esos vehículos según los datos que tenía.

Se añade el reporte terminal por el canal ordinario, con la misma latencia, pérdida y desconexión. No se actualiza directamente la base del candidato desde el estado del evaluador. Los mensajes fuera de orden conservan timestamp y versión, evitando que un retry antiguo vuelva a marcar ocupado un vehículo libre. Se prueba reutilización en dos viajes, corte de conectividad y replay exacto. El cambio beneficia por igual a todos los brazos.

También se conserva `qualifications` al verificar personal; perder ese campo al reemplazar un snapshot hacía desaparecer capacidades legítimas. No se asigna una cualificación a quien no la tiene.

### 3.2 Comprobaciones pendientes y atención simultánea

El protocolo anterior esperaba sincrónicamente a que terminara cada comprobación. En el nuevo ensayo, todos los controladores reciben primero el acuse pendiente y la misma cola finita de campo progresa mientras se revisan borradores y viajan vehículos. No hace falta terminar todas las consultas para empezar a ayudar a una necesidad ya recibida. No se elimina el tiempo de comprobación, no se regalan inspectores y una consulta pendiente no revela demanda.

El piloto se detuvo antes de completar sus tres brazos para reparar estos mecanismos. B5 se conserva con su resultado negativo; B6 queda abortado y su presupuesto completo de 0,12 USD se conserva como reserva de coste desconocido. B8 está ausente. Esa carpeta no soporta ninguna comparación positiva. Las nuevas campañas llevan otras huellas y no reemplazan la anterior.

### 3.3 Composición: distinguir información ausente y capacidad imposible

La variante distribuida anterior es viable globalmente, pero el responsable del refugio no tiene personal propio para inspeccionarlo y el sistema todavía no entrega una evaluación de campo delegada de otro propietario. No basta compartir inventario para acreditar seguridad. La exposición del canal de aclaración y reutilización de consultas pendientes reduce trabajo innecesario, pero no sustituye ese mecanismo de delegación. Esta variante sigue como límite explícito.

Los casos con energía incompatible, ninguna cualificación requerida, capacidad total cero o destino inseguro no deben convertirse en éxitos rebajando restricciones. La variante `occupied` anterior usa capacidad cero; para estudiar ocupación recuperable hace falta distinguir aforo total de plazas ocupadas y modelar su liberación. La variante con demora y personal cualificado era viable; preservar cualificaciones después de consultar/verificar corrige una pérdida de información, no aporta personal adicional.

La mejora de tiempo en necesidades de suministro no acredita automáticamente superioridad en composición de refugios, reparación de viajes, comprensión humana, fondos reales o todas las cargas. Cada afirmación conserva su prueba propia.

## 4. Protocolo de iteración económico y verificable

1. Tests deterministas sin coste de modelo: recibos, retenciones parciales, selección por lote, idempotencia, reanudación y cobertura censurada.
2. Un piloto pequeño con modelo real para comprobar fuente → interpretación → comprobación → necesidad recibida → borrador → aprobación → recepción física. Conservar cualquier fallo y su coste; corregir antes de multiplicar mundos.
3. Congelar código del producto, evaluador y motor, con hashes y configuración. No modificar fuentes mientras corre un brazo.
4. Ejecutar mundos emparejados y semillas predefinidas, con referencia competente y ablación del mismo modelo/herramientas. Mostrar casos con ganancia, empate y pérdida.
5. Variar carga informativa, demora de procesamiento convencional, silencio de una comunidad, proporción de rumores, red y disponibilidad. Cambiar un supuesto no equivale a descubrir una ventaja general.
6. Reportar por recurso: tiempo hasta primera ayuda útil y ayuda suficiente, integral de déficit, cobertura dentro de ventanas, pendientes/censurados, sobreprovisión, fallos y coste. La mediana de solo casos completados puede mejorar por abandonar los difíciles; por eso nunca se usa sola.
7. Repetir la comparación afectada al corregir un defecto del motor, para todos los brazos. Mantener la versión y resultados anteriores con su limitación.

## 5. Métricas y guardas para la nueva mejora

| Métrica | Qué debe demostrar |
|---|---|
| K01 déficit nativo integrado | Reducir necesidad sin cubrir en L·tiempo, porciones·tiempo o plazas·tiempo; no mezclar unidades en un score arbitrario. |
| K02 tiempo hasta servicio | Mejorar desde aparición física de necesidad hasta recepción/servicio, incluyendo interpretación, consultas, revisiones, comandos y viaje. Separar relojes modelados y latencia real. |
| K03 cobertura oportuna | La ganancia de tiempo no se logra atendiendo una fracción menor ni omitiendo casos no completados. |
| K04 capacidad colectiva | La red debe cambiar servicio físico posible o eficiencia; compartir mensajes por sí mismo no acredita multiplicación. |
| K05/K06 asignación | No duplicar cargas ya confirmadas/en camino ni consumir stock reservado/protegido. Exponer exceso real y conservación. |
| K07 reparación | Mantener mismo trabajo y carga en curso; comparar demora hasta restaurar servicio, no solo redactar un plan. |
| K08 cobertura silenciosa | Mostrar los subgrupos poco visibles y retrasos de verificación; no confundir viralidad con urgencia. |
| K14/K15 aporte GenAI | Aislar interpretación/investigación de mejoras deterministas. Comparar con extracción y con el mismo modelo usando herramientas genéricas. |
| K24/K25/K26 trazabilidad | Registrar latencias por etapa, calls, costes conocidos/reservados, fallos, recibos físicos y recuperación. |

Para este ciclo no se exige que un porcentaje fijo predeterminado sea alcanzado a cualquier coste. Sí se exige que una mejora sustancial esté respaldada por una comparación explícita, se mantenga sin reducir cobertura/calidad y no se presente fuera del rango ensayado.

## 6. Verificación de la versión previa a la corrección de continuaciones

La versión congelada pasó la [verificación completa](../reports/verifications/1791834744553.json): **193/193 pruebas de plataforma y 154/154 del simulador**, sin fallos, canceladas, saltadas ni pendientes. Las cuatro suites de navegador pasan **57 + 12 + 6 + 9 = 84 comprobaciones**. Los hashes de candidato, evaluador y simulador coinciden antes y después; no se reutilizó la suite de una versión anterior.

| Componente congelado | SHA-256 |
|---|---|
| Candidato | `af94176a69fa9adf92b6f3db52d20c23ab7db39773c6b3f3de3e8b3d1e815384` |
| Evaluador | `0d201ba4a91efce0c31feb8748bdd6f4fcf501e54e26d77e7d0355bd23a43584` |
| Simulador | `aaec663a4bc2f51065ab021159dac481cb174b079b724bc89ed270cc66fd2cee` |

El código verificado está guardado en los commits privados `9c0bf82` (plataforma) y `fafa7c8` (simulador). El recibo de verificación conserva los commits anteriores al guardado, además de los hashes exactos de los bytes verificados; crear el commit no modifica esos bytes.

La [campaña principal](../reports/discovery/1791834746311/protocol.json), los controles de [aclarador único](../reports/discovery/1791834748353/protocol.json) y [reporte formal a treinta minutos](../reports/discovery/1791834988289/protocol.json), y la [composición delegada](../reports/evaluations/1791834734815/protocol.json) se interrumpieron al descubrir la amplificación de continuaciones descrita en §8. El [plan completo](../reports/discovery-followup-plan.json) conserva todos los controles declarados. Sus resultados no se consideran una comparación válida. Aquí se añadirán las repeticiones con nuevas huellas, efectos, incertidumbre, costes y negativos cuando cierre cada comparación. Los tests funcionales no reemplazan este apartado.

Las revisiones con operadores y público, calibración externa y evaluación final independiente siguen fuera de lo que una implementación local o simulación interna puede demostrar por sí sola. Gemini se volverá a medir al sustituir el modelo de desarrollo Gemma; sus resultados no se presuponen idénticos.

## 7. Segundo piloto diagnóstico y correcciones posteriores

[Piloto 12 necesidades / 48 mensajes de ruido](../reports/discovery/1791833617596/summary.json): B5 completa 12/12 en 18,01 minutos RMST, B6 12/12 en 19,51 y B8 12/12 en 25,57. B6 mejora 23,70% frente a B8, pero pierde 8,30% frente a B5. Trece llamadas reales, 0,00198 USD, cero errores o violaciones. Este piloto no se usa como prueba positiva contra la referencia competente.

La reutilización de consultas tenía un defecto de integración: el simulador sólo exponía inspecciones terminales al actor. La búsqueda de una consulta pendiente nunca podía encontrarla y tres tandas volvieron a preguntar por b53. El contrato corregido expone al dueño únicamente metadata de sus solicitudes pendientes, sin hechos aún no recibidos ni trabajo ajeno. Un test debe cruzar plataforma y fuente real; un mock que incluya pendientes no detectaba este fallo.

Las trazas también muestran decisiones de flota distintas: una solicitud de mantas acabó usando un camión más lejano y llegó 15,76 minutos después de la referencia; otra entrega ganó 9,02. Acelerar hipótesis cambia la cola y no asegura mejorar cada entrega. Se conserva el comparador físico por necesidad, no sólo un promedio favorable.

Diez llamadas no encontraron candidatos y once presentaron tres fuentes o menos. Son coste y demora válidos, no llamadas gratuitas. La automatización de descubrimiento puede reunir hasta 35 grupos distintos en una sola tanda; la investigación ordinaria conserva su límite por defecto de tres grupos. No se recorta agresivamente la salida del modelo ni se ocultan fuentes rechazadas. La nueva familia con carga informativa mayor permite medir el valor del batching, manteniendo los controles de baja carga y lectura cero.

La contabilidad ahora liquida una llamada semántica exactamente una vez. Un fallo del proveedor conserva su espera real; una salida truncada conserva sus tokens/coste conocidos y se marca incompleta sin aceptar claims parciales. Los errores de parsing posteriores no crean otro recibo de modelo. La misma corrección se aplica al brazo de extracción B2.

También se corrige el botón Stop en estados de espera de revisión y recibo físico: el servidor debe aceptar los estados que muestra la UI. Nueve recorridos de navegador verifican política, descubrimiento, ambas esperas, cancelación, retención, navegación tardía y móvil; los estados insertados para verificar UI se identifican como fixtures, no entregas físicas.

La evaluación delegada cierra la limitación funcional descrita en §3.3: en un recorrido íntegro, el coordinador sin personal solicita evaluación de otro dueño, ambos responsables aprueban, la cuadrilla viaja y trabaja y comunica un recibo vigente. Cuatro organizaciones aportan servicio y 50 personas llegan y ocupan el refugio. Esto acredita composición física dentro del catálogo; no acredita por sí solo una ventaja temporal frente a un coordinador convencional con la misma capacidad.

El refresh de inventario conserva las cualificaciones reales del personal. Una evaluación vencida o una cuadrilla físicamente bloqueada vuelve a revisión y conserva su operación/evidencia; no queda eternamente en ejecución ni inventa una certificación. La comparación posterior incorpora los mismos arreglos para todas las políticas.

## 8. Amplificación de continuaciones y mensajes: nuevo defecto del producto

La ejecución convencional del control de aclarador único terminó físicamente 24/24 necesidades, pero produjo **1.732 transportes entre organizaciones**, 396 turnos de planificación y 16,83 minutos reales de ejecución. El adaptador cobra un segundo virtual por transporte: el conjunto de mensajes serializó **28,87 minutos virtuales**. El total incluye permisos y actualizaciones legítimos; no todos los mensajes se atribuyen al defecto.

La traza y el código sí identifican la amplificación: cada ejecución incompleta creaba otra tarea `continue_proposal` con ID nuevo. El bucle ejecutaba propuestas directamente y también drenaba sus tareas; cada sondeo podía producir sucesores adicionales. A su vez, el ID de `response_receipt` incorporaba `observedAt = current.now`: consultar un estado físico sin cambios generaba otro mensaje, y enviar ese mensaje avanzaba otra vez el reloj. Esto podía hacer variar la demora simulada según cuántas tareas alcanzara a drenar la CPU. No es una demora humanitaria real ni una prueba válida de ventaja del modelo.

Se implementa una continuación durable por organización/propuesta, con reprogramación protegida por lease. Una comprobación exitosa todavía pendiente vuelve a programar esa misma fila; los errores reales conservan su backoff y presupuesto de cinco intentos. Una observación terminal o necesidad de revisión cierra el trabajo pendiente sin robar el lease de otro worker. Reiniciar el proceso no multiplica órdenes ni carga.

El recibo usa identidad por origen, paso, alcance autorizado, autoridad y cambio material de la operación. Un timestamp de sondeo de transporte no crea otra evidencia; se conserva el payload del primer recibo. Cantidad recibida, estado, tiempos físicos y destino sí cambian su identidad. Las evaluaciones conservan íntegros observación, vigencia, versión del objetivo y cualificaciones: deduplicar sondeos no permite rejuvenecer una evaluación caducada.

Los tres ensayos de descubrimiento interrumpidos y la composición anterior conservan protocolos, resultados disponibles y archivos de invalidación. El control B6 detenido sin recibo final de proveedor mantiene **0,15 USD como reserva de coste desconocido**, y los dos B6 de composición **0,30 USD**. No son facturas observadas, no se convierten en gasto cero y no se imputan outcomes faltantes. La transferencia en cola se canceló antes de iniciar llamadas. [Registro de invalidación](../reports/continuation-invalidation.json).

El nuevo gate exige pruebas de coalescencia, recuperación/fencing, cambio físico final y estabilidad frente a distintas cadencias reales de sondeo. Tras verificarlo se congelan nuevas huellas y se repiten los mismos perfiles y semillas completos, con la corrección común a todas las referencias.

## 9. Versión congelada anterior, superada por las reparaciones de §10

La [verificación 1791837370142](../reports/verifications/1791837370142.json) pasó **215/215 pruebas de plataforma y 154/154 de simulador**, con cero fallos, cancelaciones, omisiones o cambios de huella. Las cuatro suites de navegador repitieron **84 comprobaciones**. El [sello de la versión](../reports/frozen-candidate-final.json) vincula sus recibos, hashes de tests y el commit `7cc8fd1` con los bytes probados. La revisión de credenciales/artefactos privados y comparación de bytes staged también pasó; los secretos permanecen fuera de Git.

| Capa | Huella congelada |
|---|---|
| Candidato | `d2a9932b684a1490907746f91bf6bcfd5a7b4de800179d0a56acbadce69ff800` |
| Evaluador | `0d201ba4a91efce0c31feb8748bdd6f4fcf501e54e26d77e7d0355bd23a43584` |
| Simulador | `aaec663a4bc2f51065ab021159dac481cb174b079b724bc89ed270cc66fd2cee` |

El nuevo primario vive en [1791837744022](../reports/discovery/1791837744022/protocol.json): tres mundos independientes, B5 convencional competente, B6 con percepción real de Gemma y B8 automático por keywords/ubicación. Recursos, compilador, ventanas de revisión y herramientas de comprobación son iguales. El primario declara 24 necesidades, 192 distractores y republicaciones, dos lectores de 30 s y dos aclaradores, horizonte de 3 h y un reporte formal a 60 min. Son supuestos modelados, no mediciones de operadores ni de una catástrofe real. Se conserva además información endógena que producen consultas y operaciones; el número efectivo de fuentes se informa en cada outcome.

Los [cinco controles predeclarados](../reports/discovery-followup-plan.json) incluyen un aclarador, lectura cero, reporte formal inmediato, silencio/pérdida y reporte formal a 30 min. La [transferencia interna](../reports/internal-transfer-plan.json) cambia mapa, distancias, tráfico, pérdida y semillas; espera a que terminen los cinco controles. Todas las campañas escriben protocolo/huellas antes de sus primeros outcomes. No editar prompts, código, física o evaluación durante esas comparaciones.

El [rendimiento del motor actual](../reports/benchmarks/engine-current-build-1791836997254.json) completó cinco perfiles con la misma huella e integridad del ledger. Las velocidades observadas fueron ×7445 unidad, ×1363 ciudad, ×256 región, ×1218 para 48 h y ×2310 para 10.000 publicaciones. Región no alcanza ×1000. Estas velocidades excluyen UI, inferencia, hashing final y exportación; no demuestran ese rendimiento del producto completo.

**Estado al congelar:** el mecanismo está verificado; la ganancia comparativa de esta versión todavía debe salir de las campañas completas. Los resultados negativos anteriores permanecen en este documento y sus reportes.

## 10. El aparente avance todavía no era una mejora legítima

Los ensayos de esa versión se detuvieron tras cerrar las llamadas activas. El primario cerró B5 y B6 del primer mundo: ambos atendieron 23/24 necesidades. El control de un aclarador dio 23/24 para B5 y 24/24 para B6, con una reducción aparente del 2,07% en tiempo medio censurado. **No se puede usar esa cifra como mejora**: el envío B5 que no llegó caducó durante un traslado legítimo hacia el almacén. En las 23 necesidades atendidas por ambos, B6 tardó más en promedio. [Invalidación y costes conservados](../reports/pickup-stock-invalidation.json).

El diagnóstico distingue cuatro causas:

1. **Producto y contrato de ejecución:** el plan no tenía en cuenta que una reserva implícita de 15 minutos podía caducar antes de una recogida de 18 minutos. Se necesita una ventana explícita revisada por el dueño, calculada con ETA y política de ejecución recibidas. Mantener el default, el máximo de 24 horas y la expiración de compromisos ya acordados; no prolongarlos por detrás del operador.
2. **Simulador y observabilidad:** una carga fallida por esa caducidad dejaba al actor con el último estado `arrived`. Toda transición material, incluidos fallo, espera por seguridad, cancelación y reparación, debe salir por el canal normal con demora, pérdida y desconexión. Una versión monotónica material impide que un recibo viejo del mismo timestamp sustituya un fallo o finalización nuevos. Repetir un sondeo no crea otra versión.
3. **Simulador y servicio compuesto:** una entrega correctamente recibida se guardaba en un stock con sufijo de dueño, pero la instalación buscaba sólo el ID base, que pertenecía a otra organización y estaba consumido. El servicio debe usar el stock real de su propietario y dejar trazabilidad del ledger; no sumar stock ajeno ni inventar disponibilidad.
4. **Producto y presupuesto de razonamiento:** planes de servicio basados en un snapshot anterior al aprovisionamiento volvían a proponer dependencias y evacuaciones ya pendientes/completadas. Una publicación de progreso también podía reiniciar investigación. Respetar holds, servicio efectivo y recibos; refrescar la instalación si falta una observación actual. La coincidencia estrecha entre un mensaje de progreso y un recibo físico recibido puede reconciliarse sin LLM, conservando el mensaje como no verificado. Cualquier necesidad, contradicción o peligro adicional mantiene su revisión.

El embudo temporal detectó además que descubrir una ubicación antes no basta: confirmaciones finitas y selección de flota pueden absorber el tiempo ganado. La misma asignación por información recibida y restricciones físicas se mejora para todas las referencias. El crédito incremental del modelo sólo podrá afirmarse si, con ese compilador común, su percepción/investigación produce ayuda física antes, sin empeorar cobertura, seguridad, exceso ni déficit nativo.

Las fuentes del motor empezaron a cambiar el 12 de octubre de 2026 a las 21:09:30 UTC durante el cierre de B7. Esos outcomes conservan recibos/costes, pero su huella ya no acredita la versión posterior. Ningún resultado faltante se convierte en cero. La transferencia en cola se canceló antes de efectuar llamadas. Se requiere otra verificación y congelación, seguida de un diagnóstico pequeño y después comparaciones completas. Los arreglos comunes de reserva, ledger y comunicaciones **no se presentan como mérito exclusivo de la IA**.

### 10.1 Ahorrar inferencia sin ocultar información operacional

La versión siguiente retiene mensajes estrictamente de apoyo/administración sin otra lectura automática y correlaciona publicaciones de progreso sólo cuando ya existe un recibo físico recibido independiente que coincide inequívocamente en destino, tipo, unidad y cantidad. Esta correlación no confirma el post, cambia autoridad, elimina demanda ni verifica medios que no se leyeron. Textos ampliados, peligros, correcciones, nuevas cantidades, medios sin interpretar y coincidencias ambiguas conservan revisión semántica/manual. Las mismas reglas gratuitas se aplican antes de la cola humana B5 y del filtro B8. Registrar cuántas fuentes recibió, reconcilió, interpretó y dejó pendientes cada brazo; no atribuir llamadas evitadas a inteligencia generativa.

### 10.2 Segundo perfil de volumen, separado del original

[El plan de carga informativa](../reports/information-load-plan.json) predeclara 24 necesidades y 768 distractores, con la misma física y capacidad del perfil original. Antes de gastar inferencia se inspeccionarán B5/B8 gratuitos. Sólo se admite el contraste si hay un cuello causal de información, manteniendo los resultados originales y controles de lectura de 0/5/15/30 segundos, reportes inmediatos, silencio y pérdida. El porcentaje de ruido y la productividad de lectura son hipótesis internas no calibradas. Aumentar ruido no demuestra por sí solo innovación semántica ni superioridad sobre un filtro barato; B8 y los controles pueden refutar la afirmación. El endpoint sigue siendo ayuda suficiente física con censura al horizonte fijo, acompañado de primera ayuda, cobertura y déficit por unidad nativa.

## 11. Nuevo snapshot verificado: mecanismos cerrados, comparación en curso

La [verificación 1791841893496](../reports/verifications/1791841893496.json) pasó **274/274 pruebas de plataforma y 173/173 del simulador**, sin fallos, omisiones ni cancelaciones. Las tres huellas de contenido iniciales y finales son iguales. [El recorrido de navegador actual](../reports/ui-verifications/1791841913671.json) pasó **84 comprobaciones** en las cuatro suites y mantuvo esas mismas huellas. [El nuevo sello](../reports/frozen-candidate-repaired-1791842535794.json) vincula los recibos y hashes de tests al commit privado `f37d1325c7be639cbbe85d1d6231c3bb63133471`. El motor está guardado en `237ac30dd1fb7277b2d847d898632c38dff83ed1`.

| Capa | Huella de contenido del snapshot nuevo |
|---|---|
| Candidato | `86481d81552e9ab052217dd6715f06ffbc2e8a1bc32e9412e8a7ef3e8ad4debc` |
| Evaluador | `9848357c9d8d756651b5463cda643ee828a4ca2aa739465bdf5163bad2c8341d` |
| Simulador | `bb307da98907240bf04aa7a9bcf6675efd74a7dac6b216cddc346b964b14680c` |

Las reparaciones preservan ventanas de pickup revisadas, versiones materiales de operaciones, stock real por dueño, cualificaciones transportadas, holds de servicio y refresh de instalaciones. Las propuestas guardan comparaciones que realmente se hicieron y sus checkpoints; los cambios de hechos/permiso/vigencia invalidan esa comparación. Un fallo de almacenamiento comprobado revierte propuesta, auditoría, job e idempotencia como una única transacción. Estos contratos hacen confiable el recorrido local; no acreditan todavía que el modelo lo utilice mejor que las referencias.

La [repetición del primario original](../reports/discovery/1791842491166/protocol.json) conserva las tres semillas y B5/B6/B8 declarados. [Los cinco controles](../reports/discovery-controls-1791842989724/index.json) conservan sus mismas semillas, física, capacidades y parámetros: la enmienda sólo paraleliza dos mundos gratuitos en el host y deja una fase de inferencia secuencial. Cada carpeta declara B5/B6 antes de ejecutar cualquiera de ellos; un resultado ausente permanece ausente. El [contraste de composición](../reports/evaluations/1791842687348/protocol.json) conserva seis episodios, ambos tipos de variación y B5/B6/B7. Ningún protocolo iniciado se presenta como resultado final.

### 11.1 Recuperar la información no es terminar de ayudar

[El nominal de recuperación sin pago](../reports/source-recovery/source-recovery-parser-1791842632387/report.json) cerró una cohorte sellada de **214 IDs+versiones recibidos por HTTP**. Todas las versiones fueron durables en cada una de cuatro bases independientes; al detener el controlador no quedaban disposiciones de fuentes, trabajos, consultas, inspecciones, propuestas, operaciones, descubrimientos o necesidades recibidas pendientes. Cerró a los **79,15 minutos virtuales**, 74,15 minutos después del cutoff de 5 minutos; el runner tardó 227,18 segundos reales. El scorer al horizonte confirmó **24/24 necesidades físicas suficientes**, sin errores, invariantes ni coste de proveedor. Las 36 versiones recibidas después del cutoff se conservan separadas, sin contarlas como éxito de la cohorte original.

Este control sustituye la percepción por un parser público, bloquea HTTP externo y no hace llamadas pagadas. Las disposiciones de todas las fuentes cerraron a los 5,75 minutos modelados; campo, revisión, transporte y recibos continuaron después. **No demuestra que un LLM entregue ayuda en 45 segundos**, precisión semántica independiente ni una ventaja temporal. Las 35 revisiones de origen duraron 30 segundos modelados y se solicitaron secuencialmente; su backlog final cero tampoco mide capacidad humana concurrente. El ensayo con el modelo real debe usar el mismo perfil y declarar sus fallos, costes y diferencias, sin sustituirlo por este control.

### 11.2 Qué puede y qué no puede demostrar el corpus actual

La familia original tiene ubicaciones literales y peticiones/contextos generados a partir de pocas estructuras conocidas. En esta ruta el modelo propone un lugar que comprobar; la cantidad planificada procede de la observación operacional recibida después. B8 puede detectar muchos lugares con keywords y pedir la misma comprobación. Una mejora frente a lectura humana modelada puede acreditar ahorro en búsqueda/interpretación a esa carga, pero **no razonamiento logístico abierto ni superioridad sobre un filtro competente**.

Para extender la afirmación, harían falta problemas en los que información accesible sobre horario, unidad, compatibilidad, ubicación, disponibilidad o permiso cambie una opción factible. Todos los brazos deben tener las mismas fuentes, herramientas, verificaciones finitas, políticas y recursos. El resultado debe cerrar desde interpretación hasta acción autorizada y servicio físico, sin entregar la respuesta ni leer la verdad oculta. Añadir cientos de distractores es un control de carga, no reemplaza esa extensión semántica.

### 11.3 Primer mundo corregido: aún no supera a la referencia competente

El [primer par cerrado](../reports/repaired-primary-readout-partial-1791842491166.json), **todavía 2/9 outcomes del primario**, da 24/24 necesidades suficientes tanto para B5 como B6. RMST físico: **31,0100 min convencional frente a 32,8659 min con percepción de Gemma**; B6 tarda 5,98% más. Ocho llamadas, 0,0052796 USD, cero errores/invariantes y las tres huellas iniciales/finales iguales. B8 después cerró 24/24 a 35,2274 min; vencer esa referencia en esta semilla no compensa perder frente a B5 ni constituye el resultado de tres mundos.

[El diagnóstico por necesidad](../reports/repaired-primary-first-world-diagnosis.json) conserva las 24 filas y separa autorización de servicio. La media de comida tarda 6,58 min más con B6: 2,15 min adicionales hasta autorización y 4,43 min después. Agua y mantas adelantan sólo 0,43/0,58 min de media. Dos casos de comida cambian de decisión de flota y su tramo autorización→servicio tarda 14,17 min más. Ambos brazos completan exactamente 24 comprobaciones; no se identifica aquí una cascada de falsos positivos ni un fallo de pickup. La secuencia de información cambia la asignación sucesiva de vehículos: descubrir antes no garantiza optimizar la consecuencia global.

Los timestamps de solicitud y ACK no se presentan como recepción de la comprobación. El reporte actual no expone una fecha de recepción final para cada check en ese embudo; esa etapa permanece sin imputar. La campaña original sigue con todas sus semillas, y el preflight de carga informativa conserva B5/B8 gratuitos antes de admitir pago. No modificar el mundo, la referencia o el objetivo para borrar este resultado.

### 11.4 Fallos nuevos encontrados después de congelar, con reparación aislada

Los cambios siguientes se desarrollan en un checkout separado; no alteran los bytes de las campañas abiertas. Necesitan otra verificación y otra medición antes de anunciar resultados de la versión reparada.

| Causa comprobable | Consecuencia | Cambio necesario y prueba de cierre |
|---|---|---|
| La ruta activa de recepción de evacuación marca `completed` y servicio, pero no registra el número de pasajeros realmente recibidos. | `effectiveNeed` no puede actualizar un snapshot de población atrasado. La composición vuelve a investigar o propone otra evacuación de personas ya alojadas. El motor rechaza exceso, pero persiste trabajo evitable. | Guardar la recepción física antes de vaciar pasajeros; propagarla por el canal consentido sin sustituirla por cantidad autorizada. Probar evacuaciones seriales, pérdida/retraso de recibo, replay y mezcla de completado/tránsito/hold: 20+20+10 cubre 50 sin nueva propuesta ni llamada. |
| Los holds globales no protegen un vehículo reservado por una evaluación de seguridad todavía sin emitir. | La asignación de otra ayuda puede usar ese mismo vehículo, retrasando inspección y apertura del refugio. En S19 B6 la evaluación de org3 y el envío de agua compiten por el mismo vehículo. | Proteger prospectivamente vehículo y crew cualificada de assessments, igual para todas las referencias. No sumar ese personal como ayuda servida. Liberar por emisión/recibo/retirada exactos y verificar stock/flota físicos. |
| La automatización exige habilidades universales aunque un depósito contenga una crew cualificada y otras personas sin esas habilidades. | Pierde capacidad utilizable o considera imposible una evaluación/servicio que sí es físicamente factible. | Selección tipada `staffSkills`, perfiles conservados, límites inferiores de capacidad recibida, mínimos/reservas descontados, permisos/versiones revalidados. No inferir intersección de habilidades con el mínimo de cuentas marginales. |
| Un rechazo parcial semántico sin atribución fina deja toda su tanda en atención pendiente; el runner original no vuelve sobre esa atención. | En [el nominal con Gemma](../reports/source-recovery/source-recovery-real-1791843532906/report.json), las 214 versiones son durables y las 24 entregas son suficientes, pero quedan 30 fuentes sin cerrar aunque el resto de colas esté a cero. | Atribuir sólo referencias presentadas exactas, conservar el batch si el rechazo no puede atribuirse, reintentos finitos registrados con todos sus costes y recuperación por recibo posterior de la misma versión. Nunca convertir silencio/rechazo en lectura aceptada. |
| Polling reconsulta individualmente cientos de registros y reescribe recibos idénticos. | Aumenta CPU/SQL y churn de versiones; no corresponde a una demora física nueva. | Lecturas por IDs dentro del alcance y transacción; revalidar erasure/versiones después de HTTP, conservar primera recepción material y no reescribir un recibo idéntico. Las mismas optimizaciones se usan en todos los brazos. No atribuir ahorro de SQL al razonamiento del modelo. |

El nominal con Gemma conserva **184/214 disposiciones**, 30 en atención, **3 llamadas / 0,00238686 USD**, cero errores/invariantes y estado `incomplete_wall_limit`: 604,96 s reales, cutoff de control a170,15 min virtuales. Entregar todo no reemplaza cerrar correctamente la atención pendiente. Tampoco se descarta un resultado parcial para repetir hasta escoger uno favorable: una corrección crea un candidato nuevo y conserva el anterior.

El [preflight informativo gratuito](../reports/information-load-admission-1791843358195.json) cerró ambos brazos 24/24: B5 a40,7485 min y B8 a36,8704 min. B5 pidió 21 confirmaciones y B8 64. Hay un cuello informativo plausible para probar percepción, junto a costes reales de campo que una búsqueda indiscriminada puede aumentar. La decisión de admitir el ensayo está escrita antes del pago; no garantiza ganancia, no reemplaza el primario negativo y no acredita productividad humana medida.


### 11.5 Primario original completamente cerrado: resultado negativo conservado

El [primario reparado](../reports/discovery/1791842491166/summary.json) cerró **9/9 mundos**, tres semillas pareadas y B5/B6/B8, sin invariantes ni errores. Las tres huellas de su protocolo coinciden con el snapshot 274+173. Todos los brazos alcanzaron 24/24 necesidades suficientes por semilla. B6 usó 23 llamadas reales con coste conocido total **USD 0.01496978**; esto no incluye otros experimentos.

| Semilla | B5 convencional, min | B6 NEXO, min | B8 automático fuerte, min |
|---|---:|---:|---:|
| 1 | 31.010 | 32.866 | 35.227 |
| 2 | 31.206 | 33.392 | 39.048 |
| 3 | 33.993 | 37.363 | 33.568 |

En suficiencia física con horizonte fijo, B6 tarda **34.540 min** frente a **32.070 min** de B5: **7,70% más lento**, no una mejora. Contra B8 el promedio es sólo 3,92% mejor, con una semilla peor y rango de remuestreo que incluye empeoramiento: no se acepta como mejora sustancial estable. El déficit de agua/comida/mantas se conserva por unidad nativa; no se suma como personas salvadas.

El corpus de información secundaria de 768 distractores sigue siendo una sensibilidad distinta, con otras semillas. Aunque permita un resultado favorable, no reemplaza estos nueve mundos ni acredita que aumentar ruido de 192 a 768 sea causalmente la única diferencia. Sus plantillas/lecturas humanas siguen siendo supuestos internos.

Las correcciones aisladas posteriores crean otra versión: recibos de personas admitidas, holds de evaluación/flota, cualificación de personal, contexto de herramientas, oportunidades verificables, atención por fuente, lectura por lotes y revisión operacional concurrente. Hay que volver a pasar el gate conjunto y medir; **no se les asigna retrospectivamente el resultado anterior**.
