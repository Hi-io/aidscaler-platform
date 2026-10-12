# NEXO — Cierre de implementación local y evidencia por requisito

Actualizado el 13 de octubre de 2026 (Tokio). Este documento relaciona la [especificación de la plataforma](PLATAFORMA.md), el [simulador](SIMULADOR.md), el código ejecutable, las pruebas y lo que permiten afirmar los resultados. La matriz completa de entradas, salidas, pantallas y KPIs permanece en [ESTADO_IMPLEMENTACION.md](ESTADO_IMPLEMENTACION.md). Los resultados numéricos finales se registran en [VALIDACION.md](VALIDACION.md) y en los reportes originales enlazados allí.

## 1. Alcance de esta entrega

La implementación usa Gemma 4 31B mediante OpenRouter, datos y herramientas de origen recibidos por HTTP, cuatro instancias independientes de NEXO y un socio externo con gateway propio. El mundo del laboratorio, sus publicaciones y sus consecuencias físicas se ejecutan realmente. El visor 3D sirve para inspeccionar esas consecuencias; una animación no sustituye un recibo.

GCP queda excluido por instrucción del autor. Su diseño se mantiene en [ARQUITECTURA_GCP.md](ARQUITECTURA_GCP.md). Gemini necesita una evaluación posterior propia. No se presupone que dos modelos tengan idénticos resultados.

La familia de intervención inicial comprende entrega de agua, comida y mantas, traslado/evacuación, inspección, activación y uso ocupado de refugios, y activación de plantas de agua bajo contratos finitos comprobables. Las dependencias, unidades, calificaciones, equipos, evaluación de seguridad, capacidad, dueño, permiso y viaje son datos operativos. No se anuncia composición universal de servicios ni autonomía médica.

## 2. Qué se corrigió al revisar la especificación completa

No basta con una página por funcionalidad. Esta revisión recorrió las consecuencias que la especificación exige y encontró fallos que las pruebas anteriores no cubrían:

- Una oferta observada de otro dueño podía volver a compartirse como si fuera propia. Ahora solo se publican recursos/flota propios y cada referencia conserva su propietario.
- Una investigación automática podía volver repetidamente al caso imposible y dejar sin atender una necesidad factible. Ahora usa la política aprobada, una cola explícita, aplazamiento por firma de evidencia y planificación concurrente; los casos pendientes siguen visibles.
- La reparación podía enviar otra ayuda sin resolver el camión original bloqueado. Ahora exige modificar o cancelar la operación afectada, conserva su carga y no marca reparado por la llegada de otro envío.
- Descargar muchas publicaciones no probaba interpretarlas. Ahora existe un recorrido de interpretación por lotes con fuente y versión exactas, cobertura explícita y puntuación semántica separada.
- El corte entre persistir una fuente y acusar recepción al origen podía perder el acuse. Ahora existe una cola durable recuperable; volver a enviar un acuse no repite la inferencia.
- Las investigaciones largas podían superar la vigencia del job. Ahora las leases tienen renovación, fencing y checkpoints privados; un worker viejo no finaliza trabajo de otro.
- Un PDF largo podía dejar páginas sin recorrido de continuación. Ahora se indica qué falta y se continúa por páginas conservando la procedencia.
- La política de retención se quedaba en una explicación. Ahora hay vista previa, aprobación del dueño, comprobación del alcance/versión, redacción, tombstone e invalidación de trabajos en vuelo.
- Una navegación rápida podía mezclar título y contenido de páginas diferentes. Ahora el render se asocia a su versión; el shell offline incluye los módulos de respuesta.
- Un reset transitorio de lectura HTTP podía abortar toda una ingesta. Se permite un reintento acotado para lecturas y escrituras con clave idempotente; una escritura sin esa clave no se repite automáticamente.

Los ensayos fallidos y las campañas interrumpidas se conservan. Un arreglo posterior no convierte un resultado de la versión anterior en un resultado de esta versión.

## 3. Capacidades C1–C7: mecanismo, ejecución y contraste

| Requisito | Implementación y prueba de mecanismo | Demostración que debe leerse aparte |
|---|---|---|
| C1 · Componer una capacidad | `src/services.mjs`, `service-composition.test.mjs`, `facility-purpose.test.mjs`, `network-ownership.test.mjs`; capacidades complementarias por dueño, evaluación, compatibilidad, calificación y ocupación | Investigación desde una necesidad sin dar ID de instalación; variantes distribuida, incompatible, insegura, personal insuficiente, ocupada y tardía. Medir servicio ocupado, no edificio activado. |
| C2 · Compromisos compatibles | `reservation-source.test.mjs`, `contracts-evidence.test.mjs`, `network-recovery.test.mjs`, `external-gateway.test.mjs`; condiciones, TTL, revisión independiente y retirada | Comparar compromisos de las mismas organizaciones y recursos; una firma de NEXO no equivale a aceptación por el socio. |
| C3 · Averiguar qué cambia la respuesta | `src/investigation.mjs`, `investigation-safety.test.mjs`, `investigation-checkpoint.test.mjs`; lectura relevante, consulta, verificación, incertidumbre y parada | Ablación de investigación activa frente a refresco amplio, con mismo presupuesto/herramientas. Un menor número de consultas no demuestra por sí solo mayor utilidad. |
| C4 · Competencia entre necesidades | `src/response-policy.mjs`, `src/received-allocation.mjs`, `response-policy.test.mjs`, `recurrent-policy.test.mjs`, `allocation-concurrency.test.mjs` | Escenario con 100 necesidades simultáneas y stock/flota finitos. Separar entradas, planes, necesidades servidas, backlog y unidades útiles. |
| C5 · Reparación | `src/response-repair.mjs`, `repair-addressing.test.mjs`, `blocked-physical-integration.test.mjs`, `physical-recovery.test.mjs` | Bloquear una operación ya cargada, investigar con modelo real, rerutear la misma carga y observar su recepción. Contrastar con refresco completo. |
| C6 · Atención humana limitada | `workforce.test.mjs`, `decision-page.test.mjs`; cola finita, autorización exacta, relevos, delegación y evidencia bajo demanda | El evaluador usa revisores programados. Comprensión, esfuerzo y errores reales requieren participantes; no se sustituyen por Playwright. |
| C7 · Instancia útil y red adicional | Bases separadas, proyecciones firmadas/consentidas, gateway externo, operaciones autorizadas por dueño; `network-transport.test.mjs`, `operational-integration.test.mjs` | B4 aislado frente a B6 en red; B5 convencional y B7 con el mismo modelo/datos/herramientas evitan atribuir toda ganancia de red a GenAI. |

H1, memoria de precedentes, es opcional según la especificación. Su recuperación existe; no se presenta como mejora causal medida.

## 4. Entradas y salidas completas del alcance local

| Grupo de la especificación | Recorrido disponible y control imprescindible |
|---|---|
| I01/I05/I06 · Social, noticias y canales oficiales | HTTP/scraping paginado, registro de conector, permiso, licencia declarada, cuota, salud, fecha, original/repost, versión, revisión/corrección; no acceso automático a todas las redes comerciales. |
| I02–I04/I18 · Medios/documentos | Bytes privados con hash, tamaño/tipo, ASR local, fotogramas muestreados, texto embebido/PDF escaneado y continuación. Registrar partes no leídas; captions sintéticos no cuentan como percepción de bytes. |
| I07/I20/I25 · Campo, verificación y personas | Cuenta por tarea, cola IndexedDB, ID estable, acuse, conflicto visible, verificación con demora y actor/versión/razón. Reportar recepción no modifica mágicamente el ledger del origen. |
| I08–I13/I15 · Necesidad y capacidad | Necesidad/unidad/cantidad/plazo; stock/reserva/mínimo; instalación/capacidad/ocupación; flota/carga/asientos/turno/fuel; accesos recibidos; telemetría y personal/equipos. Ausencia de observación sigue siendo incertidumbre. |
| I14/I16/I17/I23 · Comunicación/red | Latencia, particiones, acuses perdidos, oferta consentida vigente, compromiso condicional y error de fuente. Silencio no implica autorización ni stock cero. |
| I19/I24/I26 · Política/entorno/memoria | Política de respuesta versionada y aprobada, cuotas, alertas recibidas de peligro, precedentes opcionales. No predicción meteorológica/clínica certificada. |
| I21/I22 · Resultado y fondos | Recibo físico, descarga, uso/ocupación/continuidad separados; promesa/liquidación/asignación/compra/reembolso sandbox separados. |
| O01–O06/O18/O21/O22 | Caso, interpretación, agrupación/split/restore, contexto antiguo/contradicho, consultas y propuestas; corrección/abstención/parcialidad sin borrar la necesidad. |
| O07–O10/O17 | Revisar/modificar/autorizar/rechazar una versión; consultar proyección, reservar/confirmar/liberar/prestar/transferir/devolver, compartir/revocar actualización con dueño explícito. |
| O11–O16/O19 | Preparar/despachar, rerutear, inspeccionar/reparar, activar servicio, evacuar/distribuir y comprar; el origen aplica límites físicos y produce acuses/recibos. |
| O20/O23 | Publicación agregada aprobada con derivado visual revisado; corrección/retiro e historial; resultado/precedente opcional. |

La tabla I01–I26/O01–O23 de ESTADO_IMPLEMENTACION conserva el desglose uno por uno y los límites de cada conector. Una entrada descargada, una afirmación interpretada, una necesidad corroborada y una orden ejecutada nunca se cuentan como la misma cosa.

## 5. Usuarios y aceptación de la experiencia

| Usuario / pantallas | Resultado que puede conseguir | Cómo se comprueba |
|---|---|---|
| Administrador · UX01/UX10 | Preparar organización, registrar fuentes, cuentas/cuotas, revisar salud, exportar/backup, ejecutar retención aprobada | Pruebas de roles/alcance, organización, backup, lease y retención; recorrido de navegador. No recibe autoridad de despacho por ser administrador. |
| Coordinador · UX02/UX04 | Comprender necesidad y ayuda en curso, aprobar política de prioridades, enfocar una investigación o habilitar intake acotado | Cola visible, actividad real, opciones factibles/pedidos pendientes; `response-journey.mjs`. No requiere escribir prompts por cada publicación. |
| Analista · UX03/UX04 | Dossier, fuentes originales, contradicciones, agrupación/split, medios, verificaciones y propuesta | `casework.test.mjs`, revisión en navegador; source/version y cobertura/rechazos visibles. |
| Dueño/dispatcher · UX05/UX06/UX07/UX08 | Revisar versión exacta, modificar/rechazar, autorizar contribución propia, seguir operación, asignar campo y reparar | Decisiones/versiones/TTL, recursos/red y recorrido de extremo a extremo; nunca autoriza inventario de otro dueño. |
| Equipo de campo · UX11 | Leer tarea asignada, informar problema/avance y adjunto offline, recuperar acuse y resolver conflicto | Shell offline, IndexedDB, scope por cuenta, recorrido móvil; no fabrica un recibo transaccional físico. |
| Publicador y finanzas · UX09 | Moderar, aprobar actualización/derivado, corregir/retirar y conciliar fondos sandbox | Privacidad, publicación y finanzas; se muestran fondos colectivos y estados autorizados. |
| Comunidad · UX12 | Reportar ubicación aproximada/necesidad y adjunto permitido sin acceder al workspace | Cuota, idempotencia y moderación antes del modelo/operación. No se promete cola anónima offline garantizada. |
| Público/donante · UX13/UX14 | Ver apoyo pendiente/en camino/recibido aprobado y contribuir/seguir fondos colectivos de prueba | Portal, checkout sandbox y navegador; sin datos personales/adjuntos privados ni promesa de un artículo individual. |
| Socio externo | Revisar contribución limitada en su portal y confirmar/rechazar con ledger propio | `external-gateway.test.mjs`; no necesita instalar NEXO, ni adopta su autoridad por conectarse. |

Jerarquía de UI: resumen breve, acción principal y detalle opcional. Actividad del modelo: estado y herramientas realmente utilizadas, evidencia consultada, condiciones y justificación breve. No se inventa ni expone una cadena de pensamiento privada. Error/pending/partial no se ocultan detrás de un brillo o un contador de éxito.

## 6. Persistencia, recuperación y borrado

- Un job tiene lease renovable y token de fencing. Su checkpoint conserva herramientas completadas, IDs/versions e idempotencia. Retomar no vuelve a cobrar consultas ya completadas porque el proceso murió.
- Persistir una página de fuentes y encolar su acuse es una transacción. El acuse puede recuperarse después de perder conexión; no afirma interpretación ni entrega.
- Un retry de HTTP es acotado, conserva exactamente el body y solo repite lecturas o escrituras con clave idempotente. Tras agotar el retry el error sigue visible.
- La erasure aprobada usa una vista previa con firma de alcance/versiones. Redacta copias locales de fuente, medios y resultados que correspondan, conserva tombstone y evita resurrección por download/inferencia en vuelo. El ledger físico y la responsabilidad decisoria no se borran para alterar resultados.
- Correcciones, retirada pública y cambios de plan son eventos auditados. Si la redacción afecta el contenido de la cadena de auditoría, queda una migración con el head anterior; no se anuncia integridad histórica idéntica después de cambiar bytes.
- Borrar una copia local no borra backups, proveedores ni copias consentidas en otras organizaciones. El procedimiento de retención distingue esas obligaciones y no anuncia borrado mundial.

## 7. Simulador y visor: requisitos implementados

El motor mantiene verdad oculta, información publicada y observaciones recibidas separadas. Simula necesidades, recursos, instalaciones, personal, flota, viajes/carga/descarga, tráfico, cierres/reaperturas, daños, comunicaciones, revisores, posts/correcciones/reposts, ruido y compromisos. Los efectos de terremoto, incendio e inundación se modelan por sus consecuencias operativas; no se anunció un simulador físico certificado de fuego, agua o estructuras.

Mapas procedurales parametrizados, geometría 3D simple, cámara isométrica desplazable, capas, nivel de detalle, seguimiento del vehículo y tres columnas enlazadas permiten inspeccionar la brecha entre lo que ocurre, se comunica y se consume. Las etiquetas de verdad/fake del observador no están disponibles para el candidato.

Seeds, flujos aleatorios por subsistema, manifiesto, comandos, versiones y replay permiten repetir el mundo exógeno. Una llamada nueva al modelo no tiene que devolver exactamente la misma respuesta; replay reproduce una traza concreta. Velocidad ×1000 sirve para modelos/fixtures: no vuelve una llamada real al proveedor mil veces más rápida.

Las variantes de capacidad complementaria no añaden recursos solo para el brazo candidato. La misma semilla/variante, propietarios y recursos se aplican a las referencias. Las pruebas de reparación mantienen la misma carga original; una nueva entrega no se cuenta como reparación.

## 8. Validación ejecutada y cómo interpretar sus resultados

1. Sintaxis, contratos e invariantes de plataforma y simulador; huellas del candidato y evaluador iguales al inicio/final.
2. Recorridos por rol, tres tamaños, teclado, reduced motion, shell/campo offline, conflictos, publicación, retención, política y actividad real.
3. Proveedor real con investigación de servicio desde una necesidad, reparación de carga bloqueada, episodio ×1, cuatro formatos de bytes y PDF con continuación.
4. Campaña emparejada recurrente: B4 aislado, B5 red convencional, B6 NEXO en red y B7 mismo modelo/herramientas/red. Resultados por agua/refugio, fuentes recibidas y recursos finitos; todos los fallos incluidos.
5. Variaciones estructurales de C1 con distractores/imposibles y condiciones de seguridad/personal/ocupación/demora. Es variación interna declarada; no holdout independiente sellado.
6. Ablaciones de consulta activa/refresco amplio y reparación selectiva/refresco completo. Inferencia, queries, costes y respuesta física separados.
7. Carga física de 100 necesidades simultáneas y carga semántica de 100 necesidades, formatos/idiomas/reposts/contexto antiguo/inyección, cuatro organizaciones. El corpus gold lo conserva el evaluador, no el modelo.
8. Probe de transporte y UI con 10.000 publicaciones/h equivalentes, latencia real hasta persistencia, comandos, navegación e interacción; registrar hardware, polling, pérdidas y errores. No extrapolar a escala industrial.
9. Hygiene/secrets/artefactos, enlaces de documentación, repos privados con commits publicados y laboratorio local con el código final.

Los informes tienen huellas, protocolo, gasto recibido y reservas de coste desconocido. Una campaña detenida no se completa con ceros. Un resultado donde cambió el candidato es histórico/diagnóstico, no evidencia de la versión final.

## 9. Qué no se puede declarar terminado con código

La especificación contiene metas científicas, de personas y de adopción además de funciones. Implementar los instrumentos y ejecutar comparaciones puede refutar una meta. Se mantienen visibles K01/K03/K07/K15 cuando no superan el objetivo y su incertidumbre. El gate §38.2 permite limitar expresamente el claim; no permite inventar una mejora.

Faltan datos anotados/calibrados independientemente, revisión de procedimientos por una organización, prueba con operadores y público, baseline profesional y holdout externo sellado. No se enviaron mensajes a terceros sin autorización. El protocolo de esas pruebas está en [VALIDACION_EXTERNA.md](VALIDACION_EXTERNA.md).

Los ensayos internos pueden demostrar ayuda física en el laboratorio, corrección de mecanismos y calidad en un corpus sintético. No demuestran vidas salvadas reales, precisión clínica, utilidad con toda red comercial, fondos reales ni favoritismo garantizado en la competición. La siguiente evaluación con Gemini/GCP conserva contratos y repite resultados; no cambia las etiquetas para heredar éxitos de Gemma.

## 10. Cómo reproducir y revisar

Seguir [LOCAL.md](LOCAL.md) para arrancar las instancias y sus cuentas privadas. `node scripts/verify.mjs` guarda la verificación completa. Los scripts de investigación, semántica, reparación, flujo y campañas guardan sus reportes en `reports/` con presupuesto explícito. La configuración privada y claves no se suben a Git; `.gitignore` excluye también archivos propios de Codex.

La especificación sigue definiendo los objetivos. Este documento informa implementación y evidencia sin reescribirlos retroactivamente para que cualquier resultado parezca suficiente.

## 11. Estado final de la entrega local

[Verificación final](../reports/verifications/1791818045802.json): **120 pruebas de plataforma y 120 del simulador aprobadas**, sin omitir fallos ni cambiar el candidato. [Resultados completos](VALIDACION.md#13-resultados-finales-de-la-entrega-local--13-de-octubre-de-2026-tokio) incluyen campaña principal de 36 outcomes, variación estructural, reparación física, carga concurrente/semántica, bytes, UI, fuente real y transporte.

El transporte medido en la topología de cuatro procesos conserva las **4.000 versiones esperadas** y alcanza p95 **3,33 s** hasta persistencia. Es una prueba sin inferencia que excluye polling; el resultado anterior de 7,877 s permanece como incumplimiento de aquella topología.

La campaña física confirma los mecanismos y también refuta parte de la ambición inicial: B6 no supera B5/B7 de manera robusta; la mejora K07 de reparación tampoco queda acreditada. Las variantes imposibles conservan su servicio faltante y la carga de 101 necesidades conserva backlog. Implementación cerrada del alcance finito local, objetivos científicos no aprobados automáticamente.

El laboratorio está disponible en los puertos de [LOCAL.md](LOCAL.md), con mundo de presentación en pausa, ingesta activa y modelo sin gasto automático. Existe una propuesta de Gemma pendiente de revisión y trazas anteriores inconclusas. Los tres repositorios permanecen privados; las credenciales y artefactos de Codex quedan fuera de Git. La prueba con participantes/organizaciones y la posterior evaluación de Gemini/GCP no se inventan ni se presentan como terminadas.
