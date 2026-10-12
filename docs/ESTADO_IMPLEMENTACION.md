# NEXO — Estado de implementación y puertas de aceptación

Actualizado el 13 de octubre de 2026 (Tokio). Complementa [la especificación](PLATAFORMA.md), [el laboratorio](SIMULADOR.md), [la operación local](LOCAL.md) y [la validación externa](VALIDACION_EXTERNA.md). Los objetivos de la especificación siguen vigentes: esta matriz no los rebaja para declarar terminado el proyecto.

> La matriz histórica siguiente conserva lo medido en cada fecha. La revisión completa de la versión actual está en [COBERTURA_REQUISITOS.md](COBERTURA_REQUISITOS.md): funcionalidades, 26 entradas, 23 salidas, 14 experiencias, 27 grupos de pruebas, 30 KPIs y 24 escenarios. La [verificación actual](../reports/verifications/1791841893496.json) pasó plataforma **274/274** y simulador **173/173**, con tres hashes estables; navegador pasó 84 comprobaciones. La recuperación nominal sin pago cerró 214 fuentes versionadas en cuatro bases y 24/24 necesidades físicas; es un mecanismo de integración con parser sustituido, no calidad GenAI ni ventaja. La mejora comparativa sigue evaluándose en [MEJORA_RESPUESTA.md](MEJORA_RESPUESTA.md).

## 1. Qué existe

Existe una plataforma local ejecutable, con UI por rol, bases independientes, ingesta HTTP, investigación mediante **Gemma 4 31B en OpenRouter**, propuestas versionadas, autorización humana, ejecución contra sistemas de origen, red entre organizaciones, portal público aprobado, fondos de prueba y laboratorio 3D separado. No se desplegó GCP. Gemini todavía no se ejecutó ni se evaluó.

La plataforma no recibe la verdad oculta del simulador. El evaluador y su observador sí acceden a ella para medir consecuencias. El modelo interpreta y solicita herramientas; no recibe credenciales humanas, autoridad para publicar o permiso implícito para utilizar recursos de un socio.

Hay pruebas de funcionamiento; **no se ha cerrado todavía la ventaja competitiva de GenAI frente a todas las referencias**. Una composición preparada que funciona no demuestra descubrimiento universal. Descargar mil publicaciones no demuestra interpretarlas correctamente: ahora se conserva también una prueba semántica separada y sus límites. Un porcentaje de la landing conceptual no constituye un resultado medido.

La revisión posterior a la recarga incorpora contexto centrado en el caso, recuperación paginada por permisos, contratos personalizados bajo demanda, razonamiento configurable, salida inicial de 8.192 tokens y protección contra respuestas incompletas. El modo de transcripción se separa de la investigación. Se comparan proveedores económicos bajo un techo de tarifa, con tiempos de espera compatibles con razonar. La asignación combina stock propio con ofertas consentidas vigentes, conserva sus referencias y exige revisión independiente; rechaza una dependencia de aprobación inventada. [CONTEXTO_MODELO.md](CONTEXTO_MODELO.md) documenta límites y pruebas; la verificación original registró **89 pruebas de plataforma y 117 del simulador**. El cierre posterior y sus huellas/resultados están en [CIERRE_LOCAL.md](CIERRE_LOCAL.md) y [VALIDACION.md](VALIDACION.md); los recuentos originales no se reutilizan como evidencia de la versión nueva.

### Leyenda

- **Implementado:** existe el recorrido y tiene pruebas de contrato o ejecución local.
- **Parcial:** hay un mecanismo operativo, pero falta una parte del alcance o evidencia necesaria.
- **Pendiente de validación:** existe el mecanismo; su calidad o mejora exigida no está acreditada.
- **Excluido:** GCP en esta fase, por instrucción del usuario.

Una prueba unitaria, una prueba con proveedor real, una simulación y una prueba con personas tienen alcances diferentes. Las referencias de pruebas son rutas relativas a este repositorio; las del motor se encuentran en el repositorio hermano del simulador.

## 2. Capacidades centrales C1–C7

| ID | Implementación local | Evidencia y puerta que sigue abierta |
|---|---|---|
| C1 | Planificador de dependencias para refugio y planta de agua; directorio recibido de instalaciones candidatas, inspección, equipos compatibles, transporte, permisos de cada propietario, evacuación y servicio ocupado | `src/services.mjs`, `tests/service-composition.test.mjs`, `facility-purpose.test.mjs`. La prueba final service-live-1791811631830, desde una necesidad sin ID de instalación ni solución, produjo 50 ocupantes con cinco llamadas reales. Las repeticiones estándar de la campaña final también prestan agua y refugio sin foco manual; la variación estructural y la ventaja frente a referencias siguen siendo evidencia separada. No acreditar generalización a composiciones arbitrarias. |
| C2 | Reservas y ofertas condicionadas, TTL, permisos, versión, aceptación/rechazo, préstamos, transferencias y devoluciones; cada propietario conserva autoridad | `tests/contracts-evidence.test.mjs`, `reservation-source.test.mjs`, `network-recovery.test.mjs`. Hay un protocolo acotado, no negociación libre infalible ni consenso mundial. Falta medir ventaja de selección de compromisos frente a coordinación competente. |
| C3 | Herramientas de búsqueda, consulta y comprobación con demora, coste, permisos y presupuesto; el modelo puede detenerse sin propuesta | `tests/investigation-safety.test.mjs`, `intake.test.mjs`; trazas reales en `reports/runs/`. Falta demostrar valor marginal de preguntas seleccionadas frente a consultas indiscriminadas en tareas independientes. |
| C4 | Asignador determinista de necesidades, stock protegido, capacidad, ayuda en camino, rutas y compatibilidad; incluye ofertas actuales consentidas sin darles autoridad | `tests/planning.test.mjs`, `allocation-concurrency.test.mjs`, `received-allocation.test.mjs`, escenarios S12/S20. Recomprueba versión/retirada antes de preparar y mantiene IDs separados por dueño. La carga de 1.000 necesidades prueba ingesta/persistencia. La prueba semántica final identifica los 100 tuples esperados por cada una de cuatro organizaciones en un corpus interno; la carga física de 100 necesidades conserva competencia, parcialidad y backlog. No demuestra 1.000 decisiones correctas ni un óptimo global. |
| C5 | Cambios invalidan autorizaciones dependientes; reparación conserva pasos completados y recibos; rechazo definitivo de origen vuelve a revisión | `tests/network-recovery.test.mjs`, `physical-recovery.test.mjs`. Cuatro ensayos reales resuelven la misma carga original de 300 L; la ablación mantiene todas las pérdidas. El objetivo K07 de ventaja en tiempo no se declara cumplido. |
| C6 | Colas, agrupación limitada, revisores finitos del laboratorio, decisiones exactas, delegación de una versión, relevos, evidencia progresiva | `tests/workforce.test.mjs`, recorridos de UI. La revisión del evaluador es un proxy programado; K20–K23 requieren personas y no se sustituyen por clicks automáticos. |
| C7 | Una instancia opera sola; cuatro instancias con bases/autoridad separadas intercambian proyecciones firmadas y compromisos; quinto socio externo con gateway propio | `tests/external-gateway.test.mjs`, `network-transport.test.mjs`, `operational-integration.test.mjs`. El piloto anterior completó 600 L en red frente a 500 L aislado; la red convencional también completó 600 L y fue más rápida. Colaboración funcional probada, ventaja incremental de GenAI no establecida. |
| H1 | Memoria opcional de resultados y condiciones que necesitan revalidación | Recuperación de precedentes operativa; no se ha probado mejora frente a recuperación simple ni ausencia de transferencia negativa. No es una condición para C1–C7. |

La campaña con cuatro investigadores redundantes conserva sus 48 outcomes y ocho fallos. El protocolo posterior usa un coordinador por incidente para ambos brazos compartidos. Su primer ensayo se interrumpió por falta de saldo y conserva 12 de 48 outcomes; después de la recarga se completó una campaña de 48 episodios con contexto enfocado y razonamiento. Encontró una mejora exploratoria en refugio y pérdidas en agua. Esas pérdidas motivaron una corrección del compilador de asignaciones compartidas, manteniendo permisos independientes y todos los negativos. Consultar `VALIDACION.md` para versiones, costes y alcance: completar una campaña no establece ventaja general.

## 3. Entradas I01–I26

| ID | Disponible | Límites de aceptación |
|---|---|---|
| I01 · Publicaciones | Scraping/HTTP paginado de red ficticia; autor, versión, fecha, original, republicaciones, ubicación y fragmentos | No incluye acceso autorizado a todas las redes comerciales. Un conector nuevo requiere registro y contrato. |
| I02 · Imágenes | Archivos reales privados, hashes, tamaño/tipo, inferencia visual y referencia al original | Smoke con bytes sintéticos autorizados; falta corpus independiente de fotos de desastres y precisión anotada. |
| I03 · Video | Bytes, extracción local de fotogramas muestreados e interpretación del modelo | Seis fotogramas no describen todo un video ni permiten certificar un evento. Registrar partes no observadas. |
| I04 · Audio | Archivos y transcripción ASR local, referencia al medio y estado no verificado | Falta calibrar acentos, ruido, idiomas y errores de cantidades con audio de campo permitido. |
| I05 · Noticias | Fuente HTTP/JSON registrada, texto, fecha, URL y condiciones de uso | No es licencia automática de medios ni acceso universal a contenido privado. |
| I06 · Fuentes oficiales | JSON/MCP registrados y lectura IFRC GO probada | Una lectura real no es acuerdo institucional ni validación del procedimiento. |
| I07 · Campo | Reportes por cuenta/operación, ubicación, fecha, adjuntos, acuses, cola local y conflictos | Un reporte no modifica por sí solo una recepción física en el sistema de origen. |
| I08 · Necesidades | Tipo, unidad, cantidad, fuente, lugar, servido, plazo, tránsito y recurrencia | Las necesidades ocultas solo aparecen por observación autorizada. La ausencia de reporte no significa ausencia de necesidad. |
| I09 · Inventario | Existencia, reservado, mínimo protegido, propietario y versión de origen | Lotes/caducidad modelados cuando el conector los aporta; no sustituye un WMS industrial completo. |
| I10 · Instalaciones | Ubicación, uso, capacidad, ocupación, evaluación, dependencias y compatibilidad | No convierte edificios residenciales en refugios mediante una frase del modelo; seguridad y utilidad necesitan comprobación de origen. |
| I11 · Vehículos | Capacidad, asientos, combustible, turno, ubicación y compromisos | Modelado de flota; no certifica restricciones de toda clase de vehículo real. |
| I12 · Accesos | Mapa conocido, cierres/reaperturas recibidos, observaciones y antigüedad | No usa carreteras privadas del observador ni un mapa de daño omnisciente. |
| I13 · Telemetría | Posición/estado recibidos, ETA y ausencia de actualización | La llegada no es descarga, recepción ni atención. |
| I14 · Comunicaciones | Acuses, pendientes, latencia y particiones de origen/red | El contenido offline conserva su hora y versión; no se ejecuta una orden todavía no recibida. |
| I15 · Personal | Stock de personal, disponibilidad, turnos, tareas y cuentas por rol | Personal genérico del modelo; acreditación profesional clínica/técnica específica necesita un catálogo y conector revisados. |
| I16 · Socios | Proyecciones consentidas de recursos/flota, condiciones, mínimos, versión y vigencia | No se puede consultar el inventario privado del socio. El socio externo actual aporta transporte. |
| I17 · Compromisos | Reservas, solicitudes, aceptación parcial, rechazo, expiración y retirada | No hay aprobación automática por silencio. |
| I18 · Documentos | PDF con texto, JSON/tablas/catálogos, hashes y fragmentos; PDFs escaneados renderizados y transcritos con el modelo | El primer análisis registra hasta 20 páginas y transcribe hasta cuatro escaneadas por lote. Existe continuación explícita por páginas, con registro de pendientes y procedencia; la prueba de 23 páginas recorre todos los lotes. Cada página conserva procedencia; toda transcripción requiere revisión. No equivale a precisión OCR certificada. |
| I19 · Política | Cuotas persistentes dentro de topes, preparación de organización, límites de aprobación y reserva | No hay un editor universal de legislación o procedimientos. La retención tiene vista previa, confirmación del dueño, comprobación de alcance/versiones, redacción local y tombstone; copias en proveedores, socios y backups requieren procedimientos separados. |
| I20 · Verificaciones | Respuestas completadas, pendientes, inconclusas y fallidas | Demora, personal y transporte tienen coste; no consulta instantánea de verdad. |
| I21 · Recepción/servicio | Recibos autorizados de origen, parcialidad, instalación, ocupación y continuidad | Separar observación humana de recibo transaccional de origen. |
| I22 · Finanzas | Promesa, liquidación, asignación, liberación, compra y reembolso | Proveedor local sandbox; no checkout real, moneda internacional ni conciliación bancaria. |
| I23 · Herramientas | Salud, cuota, permiso, errores, última sincronización y proyección perdida | Un fallo no se interpreta como existencia cero. |
| I24 · Riesgo/entorno | Alertas recibidas de incendio, sismo, inundación y acceso; fuentes registradas | No se implementó predicción meteorológica ni física de propagación científica. |
| I25 · Humanos | Actor, versión, alcance, evidencia, modificación/rechazo, razón y tiempo | El evaluador usa propietarios programados; usuarios de UI sí deben iniciar sesión. |
| I26 · Precedentes | Resultados auditados y contexto recuperable | Uso opcional sin asumir transferibilidad entre desastres. |

## 4. Salidas O01–O23

| ID | Recorrido | Estado / prueba |
|---|---|---|
| O01 | Registrar caso/afirmación con referencia | Implementado; `domain.test.mjs`, `intake.test.mjs`. |
| O02 | Agrupar, separar y restaurar interpretación | Implementado con partición exacta, historial y dueño; `casework.test.mjs`. |
| O03 | Marcar contexto antiguo/contradicho sin borrar necesidad | Implementado; extracción, corrección humana y T07. Precisión semántica pendiente. |
| O04 | Consultar conector | Implementado, acotado por permiso/cuota/presupuesto; `integrations.test.mjs`. |
| O05 | Solicitar comprobación | Implementado contra origen con demora y estado; `investigation-safety.test.mjs`. |
| O06 | Preparar alternativas | Implementado con referencias, restricciones y validadores; calidad comparativa pendiente. |
| O07 | Revisar, modificar, autorizar o rechazar | Implementado por versión/hash/TTL y rol; `decision-page.test.mjs`, `workforce.test.mjs`. |
| O08 | Consultar capacidades consentidas | Implementado mediante proyecciones/consultas limitadas; `network-transport.test.mjs`. |
| O09 | Ofertar, reservar, confirmar y liberar | Implementado; `reservation-source.test.mjs`, `contracts-evidence.test.mjs`. |
| O10 | Transferir/prestar/devolver | Implementado en contrato físico acotado; `operational-integration.test.mjs`. |
| O11 | Preparar/despachar | Implementado; origen conserva propiedad, cantidad y acuse; `physical-recovery.test.mjs`. |
| O12 | Cambiar recorrido | Implementado con autoridad y orden realmente recibida; tests del motor y operaciones. |
| O13 | Inspección/reparación | Implementado en acciones de origen; no implica personal profesional calibrado. |
| O14 | Activar servicio | Implementado para recetas finitas de refugio/planta; `service-composition.test.mjs`. Composición desconocida autónoma pendiente. |
| O15 | Evacuación/distribución | Implementado con plazas, viajes finitos, recepción y destino utilizable; motor + composición. |
| O16 | Compra/reposición | Implementado con fondos liquidados, proveedor/plazo y recibo del sandbox; `contracts-evidence.test.mjs`. |
| O17 | Compartir/revocar actualización | Implementado, versionado y firmado; `network-recovery.test.mjs`. |
| O18 | Corregir/retirar conclusión | Implementado, historial y nueva revisión; `casework.test.mjs`. |
| O19 | Reparar/cancelar | Implementado conservando recibos y trabajo; `physical-recovery.test.mjs`. Mejora K07 pendiente. |
| O20 | Publicar transparencia | Implementado, borrador aprobado, privacidad, recibos, foto derivada y corrección/retiro; `public-workflow.test.mjs`. |
| O21 | Señalar cobertura insuficiente | Fuentes silenciosas/error/incertidumbre visibles; el modelo puede solicitar verificación. Ventaja/equidad K08 pendiente. |
| O22 | Abstenerse/degradarse/ayuda parcial | Implementado; sin modelo siguen disponibles datos, acciones humanas y planes verificables. Calidad frente a esperar pendiente. |
| O23 | Registrar resultado/precedente | Implementado, opcional; mejora H1 pendiente. |

## 5. UX01–UX14 y usuarios

| Pantalla / rol | Qué puede hacer hoy | Evidencia y alcance |
|---|---|---|
| UX01 · Administrador / preparación | Configurar organización, zonas, responsable, cuota/intake, conectores y cuentas; retomar preparación; exportar con permiso | `organization-policy.test.mjs`, `account-scope.test.mjs`, `ui/organization.mjs`. Retención/redacción local con preview y confirmación versionada; obligaciones externas/backups separadas. |
| UX02 · Coordinación / Overview | Ver necesidades conocidas, ayuda recibida, operaciones pendientes y accesos prioritarios | Render y navegación en tres tamaños; no usar número de posts como número de víctimas. |
| UX03 · Analista / dossier | Fuentes, versiones, contradicciones, original/media, corrección de claim, agrupación/split/restore | `casework.test.mjs`, `ui-review-journeys.json`; detalle bajo demanda. |
| UX04 · Investigación | Seleccionar caso/necesidad o dejar intake acotado, ver consultas reales y resultados, presupuesto, error y parada | No chatbot ni pensamiento privado inventado. Autonomía y calidad todavía deben acreditarse. |
| UX05 · Propietario / Decisions | Ver acciones exactas actuales, cantidades, límites y evidencia; editar, aclarar, rechazar y autorizar | `decision-page.test.mjs`, `ui-journeys.json`; versión vieja no se autoriza silenciosamente. |
| UX06 · Despacho / Operations | Seguir orden, acuse, tránsito, llegada, recepción, servicio, asignación de campo, problema y reparación | No sustituir recibos de origen por animación o reporte. |
| UX07 · Recursos/instalaciones | Inventario propio, mínimos, flota, evaluaciones, capacidad y reservas | El origen es dueño; no edición local de stock externo como si fuera libre. |
| UX08 · Propietario / Network | Compartir proyecciones, retirar, revisar solicitudes, autorizar parte propia y seguir compromisos | Cuatro cuentas/DB separadas. El contratista usa un portal y ledger independientes. |
| UX09 · Publicador/finanzas | Moderar reportes, revisar foto privada, aprobar derivado, publicar/corregir/retirar; conciliar sandbox | Original privado, controles de privacidad explícitos, sin promesa individual de un artículo por donación. |
| UX10 · Administración/auditor | Salud, cuota, conectores, cuentas, auditoría, exportación privada y backups | Cadena/historia conservada; no se comunica certificación regulatoria. |
| UX11 · Campo móvil | Solo tareas asignadas; actualizar/readback/reportar y adjuntar; cola IndexedDB offline; conflictos explícitos | `ui-journeys.json`; resolver conflicto como observación nueva, no sobrescribir orden cambiada. |
| UX12 · Comunidad sin cuenta | Reportar texto/lugar y opcional foto/audio, retry estable; moderación antes de inferencia | `intake-moderation.test.mjs`, `public-workflow.test.mjs`; cuota y tamaño. No se implementó cola anónima offline garantizada. |
| UX13 · Público | Necesidades/avances agregados aprobados, estados entendibles, foto de recepción revisada, fuente/alcance y correcciones | `ui-review-journeys.json`; no acceso a víctimas, adjuntos privados o datos operativos completos. |
| UX14 · Contribución | Checkout de prueba, fondos agrupados, estado liquidado/asignado y seguimiento colectivo | Sandbox probado; proveedor financiero real y comprensión con donantes pendientes. |

La UI tiene jerarquía de resumen → acción → detalle, estados textuales, teclado, móvil y movimiento reducido. Los recorridos automáticos son necesarios, pero no prueban K21/K23 ni sustituyen usuarios reales bajo presión.

## 6. T01–T27: implementación y aceptación

| Test de especificación | Estado de evidencia |
|---|---|
| T01 | Cadena HTTP → evidencia → proveedor real → propuesta → revisión → origen → recibo ejecutada. Episodio ×1 entregó 500 de 600 L; no completo ni prueba de mejora. |
| T02 | Suite de tenant/roles/observer/archivos. Agente y público no obtienen autoridad o verdad oculta. |
| T03 | Fuentes maliciosas y permisos de herramientas probados; no acreditado contra todo ataque posible ni corpus adversario externo. |
| T04 | Concurrencia/reservas/stock/camas/pagos e idempotencia probados en plataforma y motor. |
| T05 | Cambios de plan, versión, delegación y TTL fuerzan nueva revisión. |
| T06 | Desconexión/retraso/cola/recibo/orden modelados; camino de campo offline probado con navegador. |
| T07 | Corrección de evidencia conserva necesidad; precisión sobre fuentes independientes todavía abierta. |
| T08 | Reparación selectiva conserva ejecución; falla definitiva no se reintenta sin nueva revisión. Falta comparación de mejora. |
| T09 | Ocupación, recepción, parcialidad y continuidad verificadas; instalación vacía no suma beneficio. |
| T10 | Persistencia, jobs idempotentes, restart/backup y restauración verificados. La escala del RTO no está acreditada. |
| T11 | Borrador, fuente de recepción, privacidad, foto, corrección y retiro probados. |
| T12 | Fórmulas, unidades, censura, ventanas futuras, cero denominador y comparación emparejada probados; falta revisión científica externa. |
| T13 | Ejecución C1 funciona con instalación seleccionada y, tras la corrección, con necesidad seleccionada sin indicar el destino. Generalización sin receta en holdout no cerrada. |
| T14 | Contratos/TTL/rechazo/devolución y versiones funcionan; selección/negociación óptima no probada. |
| T15 | Herramientas e interrupción funcionan; consultas decisivas vs distractores sin instrucciones del evaluador no cerradas. |
| T16 | Competencia física y allocator; no ventaja GenAI sobre 100 decisiones heterogéneas probada. |
| T17 | Mecanismo de reparación funciona; K07 frente a referencia competente no cerrado. |
| T18 | Revisión finita modelada y UI; reducción de esfuerzo humano/errores necesita personas. |
| T19 | Local/red/socio externo/fallos HTTP funcionan. Piloto incluye casos sin ganancia; no atribuir red a LLM. |
| T20 | Se puede ejecutar split/seed/variantes y replay; holdout independiente sellado y ventaja aún pendientes. |
| T21 | Cuatro formatos con bytes reales procesados, más una foto pública derivada; independencia/etiquetas/ruido/idiomas todavía pendientes. |
| T22 | B1–B6 ejecutables, costes y fallos guardados. B0 profesional y competencia de las referencias necesitan validación externa. |
| T23 | Fuentes silenciosas y comunidades ocultas del modelo se preservan; equidad/no inferioridad no demostrada. |
| T24 | Presupuesto/cuota, nueve perfiles de ingesta y modo manual probados. Carga semántica con calidad no demostrada. |
| T25 | Recorridos automáticos por rol; estudio con personas pendiente. |
| T26 | Lectura IFRC GO ejecutada; procedimiento revisado e institución participante pendientes. |
| T27 | Contratos locales/adaptador DB operativos. GCP explícitamente excluido de esta fase. |

## 7. K01–K30: no confundir instrumento con resultado

| KPI | Instrumento disponible | Puerta de evidencia |
|---|---|---|
| K01 | Integral de demanda no atendida por unidad física y mundo emparejado | No cerrada; comparar B4/B3 y B6/B5, conservar pérdidas y fracaso, no mezclar litros y plazas. |
| K02 | Timestamps físicos y censura del no atendido | No cerrada; medir cola/origen/recibo/servicio y p95, no solo latencia del modelo. |
| K03 | Cobertura por cohortes/plazos elegibles | No cerrada; no contar ventana futura ni instalación vacía. |
| K04 | L producidos y plazas·hora ocupadas, entregas por propietario | Ejecución funcional positiva; ventaja frente a red convencional no cerrada. |
| K05 | Exceso, déficit, entrega y reserva aprobada | No cerrada; reserva protegida no se etiqueta desperdicio y no se oculta pérdida de cobertura. |
| K06 | Ledger, reservas, reintentos y dobles consumos | Cero violaciones en suites ejecutadas; no certificación de toda combinación operativa. |
| K07 | Tiempo/coste de reparación y pasos conservados | Mecanismo probado, objetivo de mejora pendiente. |
| K08 | Resultados por comunidad silenciosa/remota y conectividad | Instrumentado, no inferioridad estadística pendiente. |
| K09 | Km/fuel/horas/coste por unidad útil | Instrumentado; informar trade-offs sin presentar rapidez como ahorro de todo recurso. |
| K10 | Continuidad/consumo/ocupación | Aritmética y seguimiento físico probados; horizonte operacional y calibración pendientes. |
| K11 | Descargado → caso/claim → necesidad accesible | Recall independiente ≥90% pendiente. Acknowledgement no cuenta como comprensión. |
| K12 | Referencia/fecha/claim y corrección | Precisión anotada ≥95% pendiente; no autoevaluación del modelo. |
| K13 | Linaje, contradicción, errores semánticos del corpus | Instrumentos/modelo físico; conjunto humano de errores graves pendiente. |
| K14 | Trace de preguntas, demora/coste y viabilidad posterior | Atribución de utilidad marginal pendiente. |
| K15 | Baselines B2/B3 y candidate B4; red B5/B6 | Pilotos disponibles; ventaja ≥10% con IC favorable aún no establecida. |
| K16 | Embudo propuesto → revisado → aprobado → orden → recibido → servicio | Instrumentado, incluidos fallos y parciales; tasa generalizable pendiente. |
| K17 | Fuente/versiones/recibos/pérdidas | Cobertura HTTP y persistencia medidas; interpretación semántica independiente pendiente. |
| K18 | Manifiestos, seeds, hash, splits y replay | Holdout externo no visto no realizado. Cambiar nombre o seed no basta. |
| K19 | Bytes/ASR/fotogramas/PDF/hashes | Smoke positivo; corpus anotado multimodal de campo pendiente. |
| K20 | Tiempo de revisores/cola y registros de UI | Proxy simulado; reducción real de minutos humanos pendiente. |
| K21 | Tasks de UI/versiones/condiciones | Automatización positiva; comprensión y ≥90% con usuarios pendiente. |
| K22 | Colas finitas/turnos/backlog/timeouts | Mecánica probada; calidad en carga semántica y calibración de revisores pendiente. |
| K23 | Portal/fondos/estados/recibos | UI funciona; comprensión ≥90% del público pendiente. |
| K24 | Modelo/consulta/revisión/orden/recibo por reloj declarado | Medido en episodios; live ×1 distinto de aceleración modelada. |
| K25 | Tokens, coste recibido, coste desconocido reservado y fallos | Medido por episodio; tiempo humano e infraestructura total requieren estudio adicional. |
| K26 | Integridad/reinicio/aislamiento/recovery | Suites positivas y backups probados; límites del fixture/hardware documentados. |
| K27 | 1/4/12 organizaciones × 10/100/1000 necesidades | Nueve perfiles de ingesta; además 100 necesidades semánticas por cada una de cuatro organizaciones y seis ensayos físicos con 101 necesidades. No son 1.000 decisiones correctas ni calidad independiente de campo. Ver VALIDACION §13. |
| K28 | 1440/1920/390, teclado, offline, conflictos, privacidad | Recorridos automáticos positivos; auditoría integral de accesibilidad y personas pendiente. |
| K29 | Registro de conectores/licencia y IFRC GO | Acceso real de lectura probado; cooperación/adopción institucional pendiente. |
| K30 | Precedente recuperable | Mejora/transferencia negativa no evaluadas; opcional. |

## 8. Auditoría del simulador: seguimiento A01–A18

La [auditoría original](AUDITORIA_SIMULADOR.md) se conserva como registro fechado del commit `6980dda`, con 108 tests. El motor posterior tenía 117 pruebas. La revisión de capacidades complementarias y reparación física añade pruebas: consultar la verificación final enlazada en VALIDACION.md. No alterar retrospectivamente el diagnóstico original para ocultar cambios.

| Brecha | Cambio / situación actual |
|---|---|
| A01 · Plazos futuros | Denominadores excluyen plazos todavía no observables; métricas con censura y tests de aritmética. |
| A02 · Latencia hasta ayudar | Timestamps de orden, acuse, carga, llegada, recepción y servicio; ocupación/consumo integrados. Episodios modelados y ×1 separados. |
| A03 · Competencia de referencias | B1–B6 ejecutables; B3 usa mismo modelo y herramientas. Se registra presupuesto total común y, en el protocolo posterior, un coordinador de investigación por incidente para ambos brazos compartidos. Revisión profesional/B0 sigue pendiente. |
| A04 · Prueba de NEXO con Gemini | Plataforma real con Gemma y recibos de proveedor; Gemini no se ha ejecutado. Cambio de modelo requiere repetir mediciones. |
| A05 · Autorización externa | Propietarios autenticados, versiones/hash/TTL, cuenta de campo y delegado finito; proxy programado acotado en evaluaciones. |
| A06 · Percepción multimodal | Plataforma procesa bytes verdaderos; captions del simulador siguen siendo descripciones. Falta corpus real independiente. |
| A07 · Holdout sellado | Configuración/split/replay y huellas; independencia y secreto externos todavía pendientes. |
| A08 · Interpretación declarada | Acuses/versiones exactos; se señala explícitamente que aceptación no prueba comprensión. |
| A09 · Semántica de información | Claims/correcciones/linaje separados; precisión/recall/errores graves requieren etiquetas independientes. |
| A10 · Coste/budget real | Tokens, recibos, fallos, costes desconocidos reservados, topes por episodio/hora y presupuesto acumulado. |
| A11 · Innovación/reparación | Servicio ocupado, pasos conservados, métricas por comunidad y reparación; utilidad marginal de consulta/negociación aún no acreditada. |
| A12 · Comprensión humana | Slots/turnos/colas y UI funcional; pruebas con profesionales y público pendientes. |
| A13 · Calibración operativa/sanitaria | Supuestos explícitos en `CALIBRATION.md`; curvas clínicas no certificadas ni vidas salvadas reales medidas. |
| A14 · Red entre procesos | Instancias/DB independientes, HTTP firmado, bytes/fallos cobrados; quinto socio externo con ledger propio sin NEXO. |
| A15 · Reportes / coste | Protocolo previo, dos huellas, coste/fallos/incompletos y paired bootstrap; pilotos pequeños no confirmatorios. |
| A16 · Oráculos / escenarios | Suites de invariantes y escenarios adversos; universo de estrategias/desastres reales no certificado. |
| A17 · Portal / pagos / adopción | Portal/fotos/moderación/sandbox y conector real funcionan; dinero real y adopción pendientes. |
| A18 · Escala NEXO | Nueve perfiles de transporte; 40 llamadas para 100 necesidades semánticas por cada una de cuatro organizaciones; carga física 101 necesidades y backlog medidos por separado. Corpus interno, sin ventaja física generalizada demostrada. |

Prevalece el texto preciso de cada Axx en la auditoría original. Si cambia el motor, repetir las pruebas pertinentes y registrar su build.

## 9. Qué hace falta para declarar completada la especificación

1. Generalizar C1/T13 fuera del catálogo y de las variantes internas: ya se ejecutaron necesidad sin ID/receta y siete variantes con distractores, incompatibilidad, personal, seguridad, ocupación y demora. Las variantes distribuidas no produjeron refugio ocupado; necesitan un método más fuerte y validación independiente, no renombrarlas como éxito.
2. Conseguir ventaja atribuible a NEXO/GenAI frente a las mismas herramientas y red convencional. Si empata o pierde, mejorar el sistema y medir otra versión, conservando el ensayo anterior.
3. Ejecutar evaluación sellada e independiente con tamaño decidido por potencia/variación, no por escoger las dos semillas favorables.
4. Etiquetar externamente fuentes y medios reales permitidos; medir recall, precisión, fusiones graves, preguntas útiles y daños de falso descarte.
5. Hacer ejercicios con operadores y público. Medir tareas/tiempo/errores, no preguntar solo si el producto gusta.
6. Extender la carga semántica y física medidas a datos/condiciones independientes y más oportunidades de planificación. Ya se ejecutaron 100 necesidades semánticas por cuatro organizaciones, 101 necesidades físicas y 4.000 pares de transporte, con costes, pendientes y pérdidas; no trasladar almacenamiento a decisiones ni esconder la derrota de B6 en semilla física 02.
7. Revisar parámetros, procedimientos, permisos de fuentes y adopción con organizaciones. No se han enviado contactos ni solicitudes a terceros.
8. Repetir con Gemini cuando se habilite; este cambio no hereda automáticamente los resultados de Gemma.
9. Extender únicamente los límites que estén dentro de un despliegue posterior acordado: composición fuera del catálogo, acreditación técnica/clínica, pagos reales y fuentes comerciales autorizadas. La continuación OCR de 23 páginas y retención/redacción local con tombstones ya están implementadas y probadas; borrar copias de proveedores/otras organizaciones exige su propio procedimiento. No etiquetar un mecanismo acotado como cobertura universal.
10. Mejorar la selección recurrente entre necesidades competidoras antes de atribuir impacto a escala. La versión anterior podía completar agua en red o un refugio dirigido; aquel piloto sin foco no consiguió ambos. La planificación/política corregidas ya producen ambos en casos estándar de la campaña final, sin garantizar ventaja ante la referencia. Probar investigación, reservas de capacidad, prioridades del operador y reparación contra referencias igualmente recurrentes. No heredar un positivo de una huella anterior.

GCP queda fuera de esta entrega. El resto de puertas abiertas se registra porque no sería honesto cerrar objetivos científicos o de personas solo por implementar una pantalla.


## 10. Revisión de cierre local — 12 de octubre de 2026

[CIERRE_LOCAL.md](CIERRE_LOCAL.md) relaciona cada grupo I/O, C1–C7, UX y recuperación con su código y pruebas. El registro anterior conserva la situación de sus campañas; no describe automáticamente el código corregido.

Implementado después de aquella revisión: política aprobada y versionada de prioridades, planificación concurrente, aplazamiento de investigaciones automáticas sin evidencia nueva, ofertas limitadas a registros propios, repair sobre la operación original cargada, ingestión semántica por lotes, acuses durables recuperables, leases/checkpoints, continuación de PDF y retención/redacción local. Se mantiene el recorrido manual y una investigación dirigida puede reintentarse explícitamente.

Los reportes finales separan cuatro niveles: funcionamiento, resultado físico interno, contraste causal interno y evidencia externa. Los targets de ventaja estadística, comprensión humana y calibración independiente no se declaran satisfechos por el número de tests. El alcance finito local no exige todos los países/conectores/profesiones (§37 de PLATAFORMA); ampliar a ellos necesita contratos y pruebas propios.

## 11. Resultado histórico del cierre anterior — 13 de octubre de 2026, Tokio

La verificación final pasa **120+120 pruebas** con candidato estable. El código local incluye los mecanismos y recorridos por rol descritos en [CIERRE_LOCAL.md](CIERRE_LOCAL.md); [VALIDACION §13](VALIDACION.md#13-resultados-finales-de-la-entrega-local--13-de-octubre-de-2026-tokio) conserva el resultado completo y sus huellas.

Se ejecutaron 36 outcomes principales, 21 estructurales con el abort original conservado, siete referencias corregidas, seis ensayos físicos, ablaciones, bytes reales, semántica, UI y transporte. El transporte final alcanza 4.000/4.000 versiones durables y p95 3,33 s desde disponibilidad, sin inferir ni incluir polling. El refugio dirigido y la variante estándar consiguen ocupación física; la reparación conserva la misma carga.

Las comparaciones no sostienen todavía ventaja primaria de B6 sobre B5/B7. K01/K03/K07/K15 no se marcan cumplidos por tener funciones. La investigación activa corregida mezcla huellas declaradas y rechaza inferir un intervalo entre ellas. Se aplica el claim limitado permitido por §38.2. Los estudios de personas, calibración/holdout independientes y Gemini/GCP permanecen separados; no se simularon como si hubieran ocurrido.
