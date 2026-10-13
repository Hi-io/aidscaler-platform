# NEXO — Matriz de cobertura y cierre de evidencia local

Fecha de revisión: 13 de octubre de 2026, Tokio. Esta matriz complementa [PLATAFORMA.md](PLATAFORMA.md) y [SIMULADOR.md](SIMULADOR.md); no reemplaza sus requisitos ni borra resultados negativos. Separa una funcionalidad construida, una ejecución comprobada y una ventaja comparativa demostrada.

## 1. Cómo interpretar el estado

- **Mecanismo local:** existe código ejecutable y cobertura automática de su contrato. No significa que el modelo lo use correctamente en cualquier caso.
- **Recorrido local:** fuentes, herramientas, autorizaciones y consecuencias físicas recorren el sistema. Una propuesta, una animación o una llegada no sustituyen un recibo y un servicio útil.
- **Ventaja pendiente:** puede existir el mecanismo y un recorrido exitoso sin haber superado una referencia competente.
- **Externo:** requiere participantes, procedimientos de una institución, datos anotados independientemente, permisos adicionales o infraestructura excluida de esta fase.
- **Opcional:** H1/memoria no bloquea el cierre del núcleo C1–C7.

**Estado vigente:** capacidad humana nativa implementada; [483 pruebas de plataforma y 247 del motor](../reports/verifications/1791865074195.json), [113 checks UI](../reports/ui-verifications/1791865813182.json), [instalación limpia con entrega física](../reports/local-closure/1791870240228-clean/result.json) y [primaria íntegra de doce mundos](RESULTADOS_CAPACIDAD_HUMANA.md). NEXO mejora un 18,02% frente al flujo manual declarado; pierde frente a B5 y obtiene resultados mixtos frente a B8. Controles secundarios y estudios de claims amplios siguen abiertos. Las huellas vigentes y todos los límites están en el readout actual; los snapshots siguientes permanecen como historia de la evidencia.

**Estado del snapshot anterior, histórico:** la [verificación 1791841893496](../reports/verifications/1791841893496.json) pasó **274/274 pruebas de plataforma, 173/173 del simulador**, 197/79 módulos JS, contratos/higiene, cero skipped/cancelled y tres huellas iniciales/finales iguales. UI pasó 57+12+6+9 comprobaciones con cero errores. Los commits de esa entrega eran plataforma `f37d1325c7be639cbbe85d1d6231c3bb63133471` y simulador `237ac30dd1fb7277b2d847d898632c38dff83ed1`; los SHA anteriores registrados dentro del gate corresponden al HEAD antes de empaquetar las fuentes. Esas pruebas no acreditaban todavía una mejora comparativa ni estudios con personas.

Huellas de ese snapshot anterior verificado:

```text
candidato:  86481d81552e9ab052217dd6715f06ffbc2e8a1bc32e9412e8a7ef3e8ad4debc
evaluador:  9848357c9d8d756651b5463cda643ee828a4ca2aa739465bdf5163bad2c8341d
simulador:  bb307da98907240bf04aa7a9bcf6675efd74a7dac6b216cddc346b964b14680c
```

Se conserva el snapshot superado [1791837370142](../reports/verifications/1791837370142.json), **215/215 plataforma, 154/154 simulador**, con sus tres huellas iguales para los bytes probados. Quedó superado al descubrir fallos de acuse de pickup y stock de instalación. La reparación intermedia `c83c…` pasó 166/166; el motor actual `bb307…` además conserva competencias en transferencias/reexpediciones. Se conservan la verificación [1791834744553](../reports/verifications/1791834744553.json), con 193/193 y 154/154, y `1791833546380`, con 177/178 y 149/149; ninguno se reescribe como evidencia de fuentes posteriores.

Huellas del snapshot anterior verificado, **superado**:

```text
candidato:  d2a9932b684a1490907746f91bf6bcfd5a7b4de800179d0a56acbadce69ff800
evaluador:  0d201ba4a91efce0c31feb8748bdd6f4fcf501e54e26d77e7d0355bd23a43584
simulador:  aaec663a4bc2f51065ab021159dac481cb174b079b724bc89ed270cc66fd2cee
```

El snapshot previo se publicó en los repositorios privados como plataforma `7cc8fd1` y simulador `fafa7c8`. Los SHA registrados dentro del expediente de verificación describen el HEAD anterior al commit de esas fuentes; las huellas de contenido anteriores identifican lo efectivamente probado. Esos commits no contienen las reparaciones de pickup/instalación en curso. El commit de plataforma `9c0bf82` identifica una entrega aún anterior.

La revisión de las rutas habituales confirma `communication`/`bulletins`, conservación de cualificaciones, comprobaciones terminales, separación de aprobación/recibo/capacidad y evaluación física delegada. Permanece el límite conservador de automatización con personal mixto descrito en §2. Esto es una conclusión acotada a los contratos, código y pruebas inspeccionados; las matrices siguientes mantienen los gates de calidad todavía abiertos.

**Diagnóstico y reparación conservados:** después de la suite 193+154 se identificó amplificación de continuaciones y recibos redundantes. Esos envíos podían consumir demora virtual de red y hacer depender el laboratorio de CPU/polling. La versión actual usa una continuación durable por propuesta y recibos por cambio material/alcance/autoridad, conservando tiempos físicos y vigencia de assessments. `continuation-recovery`, `monitoring-review-recovery`, `network-receipt-volume` y `poll-clock` están incluidos en el nuevo gate 215+154. La regresión HTTP de cadencia compara diez sondeos a 0 y 1.100 ms: mismo reloj y tiempos físicos, un despacho/un viaje/300 L útiles, ninguna `peer_send` adicional sin cambio, una continuación activa por propuesta y ninguna al finalizar; cero LLM, acciones inválidas e invariantes. Esto cierra ese mecanismo en los casos probados, no la ventaja comparativa. Las campañas anteriores se interrumpieron y conservaron `invalidation.json`; sus tiempos no se reutilizan para comparar la nueva versión.

## 2. Artefactos de referencia de esta iteración

| Artefacto | Lo que demuestra y su límite |
|---|---|
| [ESTADO_IMPLEMENTACION.md](ESTADO_IMPLEMENTACION.md), [CIERRE_LOCAL.md](CIERRE_LOCAL.md), [VALIDACION.md](VALIDACION.md) | Estado y ejecuciones anteriores con sus límites. Los recuentos de una versión anterior no validan fuentes nuevas. |
| [MEJORA_RESPUESTA.md](MEJORA_RESPUESTA.md), [AUDITORIA_SIMULADOR.md](AUDITORIA_SIMULADOR.md) | Diagnósticos de pérdidas, causas corregidas y criterios para evaluar otra versión. |
| [Plan predeclarado](../reports/discovery-followup-plan.json) | Primario: 3 semillas, B5/B6/B8, 24 necesidades, 192 distractores, 2 reposts, lectura modelada de 30 s con 2 trabajadores, 2 trabajadores de aclaración, informes formales a 60 min y horizonte de 3 h. No es productividad humana medida. |
| [Verificación actual](../reports/verifications/1791841893496.json) | PASS 274/274 plataforma +173/173 simulador, sintaxis/higiene y tres huellas iguales; UI84 separado con cero errores. No demuestra ventaja comparativa o humana. |
| [Verificación previa superada](../reports/verifications/1791837370142.json) | PASS 215/215 plataforma +154/154 simulador, sintaxis/higiene y tres huellas iguales para sus bytes. No verifica los edits posteriores ni acredita ventaja. |
| [Primario pickup invalidado](../reports/discovery/1791837744022/protocol.json) | 2/9 mundos finalizados, 7 faltantes; conservar B5/B6 de primera semilla, con 23/24 suficientes en ambos. El fallo de pickup impide comparación; no completar ni emparejar con el build nuevo. |
| [Control de aclaración invalidado](../reports/discovery/1791837754844/protocol.json) | 2/2 mundos completos; la aparente mejora ~2% dependió de un pickup censurado del baseline. No constituye ventaja legítima ni se elimina ese caso. |
| [Invalidación pickup/stock](../reports/pickup-stock-invalidation.json) | Incluye los dos anteriores, control `1791839019386`, composición `1791837825645` y probes combinados históricos. B7 de composición cruzó la frontera de edición. Conserva costes conocidos, reserva desconocida, fallos y faltantes. |
| [Primario anterior invalidado](../reports/discovery/1791834746311/invalidation.json) | 9 mundos declarados, 0 finalizados; interrupción antes de comparación. No imputar desenlaces ni ventaja. |
| [Control anterior invalidado](../reports/discovery/1791834748353/invalidation.json), [formal a 30 min anterior](../reports/discovery/1791834988289/invalidation.json) | Se conservan protocolos/resultados disponibles para diagnóstico de amplificación. No son controles válidos de las fuentes actuales. |
| [Composición anterior invalidada](../reports/evaluations/1791834734815/invalidation.json) | B5 distribuido/demorado completo 50/50 con integridad aporta factibilidad del mecanismo, pero el contraste temporal fue invalidado. Las llamadas B6 interrumpidas no tienen desenlace ni uso final conocidos; reserva conservadora explícita, no factura ni ganancia. |
| [Motor anterior medido](../reports/benchmarks/engine-current-build-1791836997254.json) | Cinco perfiles headless sobre `aaec…`, hash inicial/final y SHA conservados, todos con ledger válido. Región ×256; otros ratios en §10.4. No mide el motor reparado `c83c…` ni inferencia/UI/productividad humana. |
| [Motor reparado medido](../reports/benchmarks/engine-current-build-1791840958602.json) | Cinco perfiles headless del motor `bb307…`, huellas inicial/final y SHA de scripts/manifests iguales, ledger válido. Región ×274,57, sin garantía de ×1000 universal; §10.5. |
| [Recuperación de fuentes: fixture pequeña](../reports/source-recovery/source-recovery-parser-1791841800942/report.json) | Cohorte HTTP sellada a 5 min: 9/9 ID+versión durables y dispuestas, colas locales a cero y 2/2 entregas físicas suficientes. Parser público sustituido, cero llamadas pagadas y tres huellas iguales; §10.6. No es el nominal de 24 casos ni calidad del modelo. |
| [Recuperación nominal sin pago](../reports/source-recovery/source-recovery-parser-1791842632387/report.json) | `recovered`: 214/214 ID+versión con disposición/retención durable; colas locales cerradas a79,15min y 24/24 ayudas suficientes. Parser sustituido, cuatro org, cutoff5min/horizonte3h/wall600s, huellas actuales iguales; §10.7. No es calidad GenAI o ventaja comparativa. |
| [UI general](../reports/ui-verification.json), [recorridos](../reports/ui-journeys.json), [revisión/publicación](../reports/ui-review-journeys.json), [respuesta](../reports/ui-response-journeys.json) | Últimas ejecuciones automáticas de 57, 12, 6 y 9 comprobaciones respectivamente. Verifican navegador y estados; no son estudios de comprensión con personas. |
| [Flujo entre procesos](../reports/flow/nominal-process-1791817861166.json) | 4 procesos/4 DB, 1.000 publicaciones y 4.000 pares de ingesta sin pérdida. Su latencia durable excluye el polling y no mide interpretación o decisión útil bajo la misma carga. |
| [Medios con bytes](../reports/media-byte-smoke.json) | Lectura de medios reales del fixture y procedencia; no precisión sobre un corpus independiente de desastres. |
| [Fuente real de lectura](../reports/sources/ifrc-go-1791815424508.json) | Dos registros de IFRC GO recibidos/persistidos; no inventario de una ONG, acuerdo de adopción ni revisión operacional. |

Las carpetas nuevas deben conservar protocolos, huellas, costes, errores, resultados censurados y recibos físicos completos. Una llamada de Gemma no se atribuye a Gemini. Los resultados son de un laboratorio interno, no de intervención en desastres reales.

**Personal transferido y reexpedido:** la suite actual incluye siete regresiones de `staff-transport`: consentimiento bilateral y viajes físicos hasta depósito, evaluación con ese equipo, reexpedición e instalación; mezcla con personal sin competencias, reservas simultáneas y carga en distinto orden; perfiles multi-skill y cuentas nativas parciales; consumo parcial, pérdida, pickup fallido y devolución. Las competencias se conservan por personas/grupos, no por la etiqueta del último envío; el personal ya asignado o consumido no duplica capacidad. Inventarios y recibos incluyen cuentas/perfiles autorizados y comunicación real. Esta evidencia mejora consistencia del laboratorio, sin acreditar aún calidad del modelo ni ganancia temporal.

**Límite conservador de automatización con personal mixto:** `assessmentPlan` y `servicePlan` aún exigen competencias universales en el stock recibido. Si un depósito mezcla un assessor cualificado con personas sin esa competencia, el motor puede seleccionar físicamente al assessor, pero el helper automático puede decir que falta equipo. Las ofertas compartidas actuales tampoco incluyen cuentas/perfiles parciales. Esto no invalida S23 ni los recorridos con personal homogéneo y está compartido por B5/B6. Queda como mejora local de aprovechamiento: usar un límite inferior de capacidad cualificada recibida/autorizada, descontar reservas/holds, probar viaje/evaluación real y preservar versiones/consentimiento. Un envío de personal cualificado desde stock mixto requiere además selección tipada explícita de la crew; un despacho genérico no debe asumir qué personas carga. La propuesta de evaluación, todavía no implementada, está fuera de las fuentes en `.local/assessment-skill-proposal.md`.

## 3. C1–C7: capacidades del proyecto

| ID | Implementación local y evidencia | Qué falta medir o limitar |
|---|---|---|
| C1 · Composición | Catálogo finito de refugios y plantas, dependencias de agua/energía/personal, permisos por dueño, evaluación actual competente, entrega/instalación y ocupación. `service-composition`, `activation-assessment`, `delegated-assessment` y pruebas del motor. Recorrido delegado STAFF0→equipo socio→viaje/trabajo→recibo→4 dueños→50 plazas ocupado comprobado. | Completar campaña B5/B6 de la misma versión. La capacidad funcional no demuestra que NEXO descubra cualquier servicio desconocido ni que supere coordinación convencional con los mismos recursos. Probar una variación estructural interna nueva sin dar la respuesta en el prompt. El holdout independiente sigue externo. |
| C2 · Compromisos | Ofertas explícitas, mínimos, versión, TTL, reservas, confirmación, liberación, aceptación parcial, retirada y transferencias/préstamos/devolución. Cada dueño autoriza. Pruebas `contracts-evidence`, `reservation-source`, `network-ownership`, `network-recovery`, `external-gateway`. | La consistencia transaccional está cubierta; la mejor selección de compromisos y el ahorro operativo necesitan comparación causal. No llamar «reservado» a un hold local de planificación. |
| C3 · Investigación | Consultas autorizadas, aclaraciones pendientes, inspección con traslado/trabajo, presupuesto, checkpoints, cancelación y revisión de fallos/inconclusos. `investigation-safety`, `investigation-checkpoint`, `investigation-assessment`, `discovery-lifecycle`. | K14: una ablación activa vs. indiscriminada, mismo candidato/evaluador/corpus/presupuesto, que mida cambio útil y servicio. Los resultados corregidos anteriores con huellas distintas no permiten estimar ventaja. |
| C4 · Competencia global | Compilador determinista sobre necesidades recibidas, política aprobada, holds/reservas/tránsito, recursos y flota finitos, prioridades sin depender del orden de las tandas. `received-allocation`, `allocation-concurrency`, `allocation-travel`, `planning-throughput`. | Actualizar carga combinada y comparación física después de la reparación. Semántica 100×4 y transporte masivo separados no demuestran 100 decisiones útiles concurrentes. |
| C5 · Reparación | Dependencias por evidencia/versión, invalidación selectiva, nueva revisión, operaciones y carga original preservadas, reintentos idempotentes. `physical-recovery`, `repair-addressing`, `network-recovery`, `blocked-response`. | K07: tiempo hasta propuesta reparada y hasta servicio, bajo la misma perturbación y referencia. Cuatro recorridos anteriores preservan 300 L, pero no sostienen una reducción estable del 30%. |
| C6 · Atención finita | Roles, turnos, tareas, delegación de alcance, revisión exacta, colas y política de intake aprobada. Duración/plantilla de lectura y confirmación son parámetros iguales de la evaluación. `workforce`, `organization-policy`, `response-policy`, `discovery-queue`. El helper `source-recovery` sella una cohorte HTTP por ID+versión y no usa truth para detenerse; fixture pequeña en §10.6 con recibos, retención durable y colas cerradas. Los nominal/burst de §10.3 siguen históricos invalidados. | K22: recuperación nominal completa con percepción real y revisión concurrente saturada sigue pendiente. La fixture pequeña usa un parser sustituido y revisión fuente secuencial; no demuestra calidad del modelo ni carga humana. K20/K21: minutos reales, errores y comprensión con personas son externos. No vender los 30 s modelados como dato humano. |
| C7 · Autonomía/red | Organización local útil, 4 DB independientes, HTTP firmado, proyecciones consentidas, revocación/versiones, operación parcial y socio externo sin NEXO. `network-transport`, `network-recovery`, `operational-integration`, `external-gateway`. | Completar contraste local/red con la misma dotación agregada y referencia que también comparte datos. Una mejora frente a equipos aislados no acredita el aporte incremental de GenAI. |
| H1 · Memoria | Precedentes opcionales con referencias y revalidación; nunca existencia actual asumida. | Ventaja y transferencia negativa no demostradas. No bloquea el núcleo ni debe convertirse en requisito nuevo para esta entrega. |

## 4. Cobertura completa de entradas I01–I26

Se usan los IDs de PLATAFORMA, no las etiquetas abreviadas de versiones antiguas de otros documentos. Toda entrada requiere origen, hora accesible, versión, alcance y estado de recepción cuando corresponde.

| ID | Entrada y mecanismo local | Límite / comprobación de cierre |
|---|---|---|
| I01 | Publicaciones originales: HTTP/scraping paginado de la red ficticia y conectores registrados; fecha, autor, texto, ubicación, permiso y salud. | No acceso universal a redes comerciales. Cobertura de consumo distinta de comprensión. |
| I02 | Reposts, comentarios, ediciones y retiradas: linaje/versiones, corrección, grouping/split/restore y tombstones. | No multiplicar demanda o testigos por copias; pruebas de copias declaradas comparan contenido, formato y ubicación. |
| I03 | Imagen/video: bytes privados, hash/MIME/tamaño, muestras de fotogramas, referencia al original y pendientes no leídos. | Los captions del generador no son prueba visual; precisión independiente pendiente. |
| I04 | Notas de voz/canales de equipo: ASR local y medio privado con procedencia. | Ruido/acento/idioma y cantidades requieren corpus permitido; una transcripción no certifica verdad. |
| I05 | Noticias/radio: fuente registrada, origen/fecha, revisiones y contexto histórico. | No licencia automática ni autenticidad certificada por la etiqueta del modelo. |
| I06 | Comunicados oficiales/boletines: fuente autorizada y `forecasts`/`bulletins` con demora y corte por hora accesible. | No boletines futuros. Dos registros reales IFRC no equivalen a proceso operativo institucional. |
| I07 | Inspección de campo: tarea, viaje/trabajo, competencia, propósito, versión, vigencia; recibo delegado a solicitante con consentimiento de ambos dueños. | Una aclaración por otro canal no se reutiliza como certificación física de instalación. Réplica/TTL invalida. |
| I08 | Necesidades: tipo/unidad/cantidad, población contextual, plazo, servido, tránsito y episodios de demanda. | No leer necesidades privadas antes de observarlas. No sumar población de sector repetida como personas únicas ayudadas. |
| I09 | Inventario: existencia/reservado/mínimo protegido, lotes/expiración, dueño y versión. | Proyección recibida no es acceso privado ni reserva firme. Conservar cualificaciones al refrescar personal. |
| I10 | Instalaciones: propósito, dependencias, capacidad/ocupación, seguridad operacional y evaluación. | Catálogo acotado; no convertir cualquier edificio en refugio por texto del modelo. |
| I11 | Vehículos: capacidad/carga/asientos, combustible, turno, ubicación, compromisos y viaje de retorno. | No certificación de toda clase real de transporte. Flota finita y reutilización tras telemetría terminal. |
| I12 | Accesos: mapa, restricciones/cierres/reaperturas recibidos, vehículo compatible, fuente/antigüedad. | El planificador no recibe carreteras dañadas del observador antes de comunicarlas. |
| I13 | Telemetría: posición/estado/ETA recibidos, pérdida/desorden, versión y terminal con conectividad real. | Llegada no es descarga, recibo o servicio; retries viejos no regresan estado nuevo. |
| I14 | Comunicación: último contacto propio, conectividad propia y órdenes pendientes actor-scoped. `lookup communication` habilitado y probado con demora. | No conectividad privada de sectores ajenos; ausencia de contacto no implica inexistencia de necesidad. |
| I15 | Personal: cualificaciones, turnos/descanso, disponibilidad, tareas y permisos. | Competencia modelada explícita; no equivalencia con acreditación clínica/estructural profesional real. |
| I16 | Socios: capacidades y ofertas consentidas por dueño, TTL, límites, mínimos y condición. | Sin lectura irrestricta de inventario del socio; probar revocación y aislamiento. |
| I17 | Compromisos: reserva/solicitud, aceptación parcial, rechazo, expiración y retirada versionada. | Silencio no autoriza. El hold de un draft no modifica el ledger del origen. |
| I18 | Documentos: JSON/tablas/PDF con texto, escaneados, páginas/fragmentos y continuación. | Fixture de 23 páginas recorre lotes; no OCR certificado ni «todo leído» si quedó pendiente. |
| I19 | Política: prioridades/versiones aprobadas, límites, cuotas, alcance de autorización y retención. | El LLM no inventa legislación ni quién tiene prioridad; guardar dueño de cambios. |
| I20 | Verificaciones: pendiente/completada/fallida/cancelada/timeout/inconclusa, coste y evidencia. | Terminal deja revisión explícita, sin espera infinita ni reintento ilimitado. |
| I21 | Resultados: recibo fuente parcial/total, instalación, ocupación, continuidad y servicio. | Reporte de usuario distinto de recibo transaccional; guardar primera ayuda positiva y ayuda suficiente. |
| I22 | Finanzas: promesa/liquidación/asignación/compra/liberación/reembolso, proveedor y plazo. | Todo sandbox local; no dinero real ni conciliación bancaria internacional. |
| I23 | Herramientas: salud/permiso/cuota/schema, errores, última sincronización y fuente perdida. | Error no significa stock cero; registrar fallos y costes desconocidos. |
| I24 | Entorno: alertas accesibles de incendio/sismo/inundación/acceso, fecha/uncertidumbre. | Desastres discretos funcionales, sin predicción científica certificada. |
| I25 | Decisiones: identidad, versión/hash, alcance, razón, modificación/rechazo y tiempo. | Evaluador usa propietarios programados; no estudio de comportamiento humano. |
| I26 | Precedentes: contexto/resultado auditado y fuente autorizada. | Opcional; revalidación obligatoria y transferencia negativa visible. |

## 5. Cobertura completa de salidas O01–O23

| ID | Salida / consecuencia implementada | Gate o límite |
|---|---|---|
| O01 | Crear afirmación/caso con referencias y estado de interpretación. | Claim no es necesidad física confirmada. |
| O02 | Agrupar/separar/restaurar con partición exacta, dueño e historial. | No fusionar comunidades distintas ni borrar fuentes por popularidad. |
| O03 | Señalar antiguo/contradictorio/sospechoso y mostrar evidencia. | No descartar necesidad actual por un video viejo; semántica independiente pendiente. |
| O04 | Consulta autorizada a inventario, flota, rutas, documentos, instalaciones, personal, comunicación y otros contratos. | Tool scope/quota/latencia aplicados fuera del modelo. |
| O05 | Solicitar aclaración/inspección propia o delegada. | Pendiente real, recursos/coste; no lectura de verdad privada instantánea. |
| O06 | Preparar alternativas parciales/condicionadas con verificaciones y plan de acciones. | Validez formal distinta de autorización y utilidad. |
| O07 | Revisar/modificar/autorizar/rechazar versión exacta. | Scope, hash/TTL y condiciones; cambios materiales vuelven a revisión. |
| O08 | Consultar capacidades compartidas y actuales del dueño correcto. | Consentimiento/revocación; no mezclar consultas a organizaciones distintas. |
| O09 | Ofertar/reservar/confirmar/liberar/retirar con versión, condición y TTL. | Reserva fuente y hold local son estados diferentes; deduplicación al reconectar. |
| O10 | Transferir/prestar/devolver con aceptación independiente y movimiento físico. | El socio no autoriza por una firma ajena; préstamo no regala stock. |
| O11 | Cargar/despachar/distribuir con propietario, permisos y límites físicos. | Tiempos de carga/viaje/descarga y recepciones causales. |
| O12 | Pedir cambio de recorrido/destino con autorización. | Vehículo sigue la orden recibida, no la intención todavía offline. |
| O13 | Inspeccionar/reparar con equipo competente, acceso y duración. | Acción de campo no equivale a certificación profesional externa. |
| O14 | Activar servicio cuando evaluación vigente y dependencias estén satisfechas. | Refugio/planta del catálogo; sin servicio virtual por tener un draft. |
| O15 | Evacuar personas/distribuir ayuda con plazas, viajes y destino utilizable. | Pickup, llegada, instalación y ocupación separados; no duplicar cohortes. |
| O16 | Comprar/reponer con fondos liquidados, stock del proveedor, demora y recibo. | Sandbox; promesa de dinero no es saldo gastable. |
| O17 | Compartir/corregir/revocar actualización consentida y versionada. | Ningún mensaje compartido traslada autoridad del dueño. |
| O18 | Corregir/retirar interpretación/recomendación con historial. | Acción física irreversible no desaparece por retractar texto. |
| O19 | Reparar/cancelar plan conservando trabajo válido y costes hundidos. | Ventaja temporal K07 pendiente. |
| O20 | Publicar proyección agregada y medios derivados revisados; corregir/retirar. | Sin adjuntos privados ni recepción declarada sólo por despacho. |
| O21 | Mostrar vacío de cobertura y solicitar comprobación pertinente. | Hipótesis visible; no inventar cantidad/población de zona silenciosa. |
| O22 | Abstención, parcialidad y modo manual/degradado con estado conservado. | No cerrar pendientes como resueltos cuando falla el modelo/herramienta. |
| O23 | Guardar resultado/precedente revalidable y con procedencia. | Opcional, sin claim de aprendizaje efectivo. |

## 6. Experiencia por rol UX01–UX14

| ID / usuario | Recorrido construido | Evidencia / lo que falta |
|---|---|---|
| UX01 · Instalador/dueño | Configurar organización, fuentes, roles, política, presupuesto, backup y retención. | Pruebas de organización/integración/backup/retención y UI. Instalación limpia reproducible; producción GCP excluida. |
| UX02 · Coordinador | Resumen de necesidades conocidas, propuestas/ayuda en curso, prioridad aprobada y actividad. | Intake sin prompt por post; respuestas separan aprobación, recibo, capacidad, inconcluso y detenido. Comprensión bajo carga con personas pendiente. |
| UX03 · Analista | Dossier de evidencia, originales/versiones, medios privados, grouping/split/correcciones. | `casework`, `decision-page`, recorridos de revisión. Precisión semántica sobre anotación independiente pendiente. |
| UX04 · Investigación | Estado real de agente/herramienta, hallazgos, consultas, condiciones, coste, cancelar/reintentar. | `investigation-*`, `discovery-lifecycle`, recorrido de respuesta. Mostrar resumen verificable; nunca una cadena privada de pensamiento fabricada. |
| UX05 · Dueño de decisión | Comparar, revisar, modificar, aprobar/rechazar alcance exacto. | Roles/hash/versiones, revocación y grupos permitidos. Estudio de error/tiempo humano pendiente. |
| UX06 · Operaciones | Orden, acuse, movimiento, llegada, recibo, uso e incidencia; reparación autorizada. | Recibos de origen y UI; seguir estado conocido no omnisciente. |
| UX07 · Recursos | Stock/reservas/mínimos, flota/turnos, cualificaciones, instalaciones/dependencias. | Contratos de fuente, asignación concurrente y assessment. No presentar disponibilidad compartida como reserva. |
| UX08 · Red | Compartir/retirar datos, ofertas/TTL, compromisos y aprobaciones independientes, socio externo. | HTTP firmado/4 DB/gateway. Uso real entre instituciones pendiente. |
| UX09 · Publicador/finanzas | Revisar progreso público y derivado visual; fondos colectivos y compras sandbox. | `public-workflow`, `contracts-evidence`, recorrido de revisión. No checkout real. |
| UX10 · Administrador | Salud de conectores, permisos/cuotas, auditoría, backups y borrado por alcance. | Recuperación/retención probadas. Copias de proveedores/socios/backups requieren su propio procedimiento. |
| UX11 · Equipo de campo | Tareas asignadas, móvil, cola IndexedDB offline, idempotencia, acuse y conflicto visible. | `workforce`, `offline-shell`, recorridos. Prueba de dispositivo/operación humana de campo pendiente. |
| UX12 · Comunidad | Envío anónimo de reporte/medio, límite y moderación; no autoriza operaciones. | `intake`, `intake-moderation`, `public-workflow`. Offline anónimo universal no es garantía del alcance. |
| UX13 · Público | Necesidad/en camino/confirmado agregado con evidencia pública aprobada y privacidad. | Navegador y gates de publicación. Comprensión K23 por personas pendiente. |
| UX14 · Donante | Contribución colectiva de prueba y seguimiento de fondos/progreso, sin promesa de un objeto por persona. | Ledger sandbox; dinero real y comprensión/confianza/adopción son externos. |

La UI no debe pedir al usuario que lea toda la actividad para actuar. Resumen → condición crítica → siguiente acción → evidencia bajo demanda. Movimiento/color no pueden ser el único indicador. Las pruebas de móvil/teclado/movimiento reducido ayudan a validar el mecanismo; no prueban que un operador comprenda el sistema.

## 7. Pruebas de aceptación T01–T27

| ID | Estado del mecanismo / ejecución | Cierre aún requerido |
|---|---|---|
| T01 · Recorrido completo | HTTP→evidencia→modelo→propuesta→dueños→órdenes→recibos físicos existe; mecanismos también con modelo reproducido. | Conservar las campañas finales completas y distinguir parcial/imposible del éxito. |
| T02 · Aislamiento | Tests de tenant/rol/consentimiento, datos recibidos sin observador privado; suite congelada PASS. | Mantener frontera en cada conector/campaña posterior. |
| T03 · Fuente hostil | Texto malicioso no autoriza herramientas/escrituras ni borra necesidad. | Counterejemplos locales cubiertos; eficacia sobre ataques reales no certificada. |
| T04 · Concurrencia | Stock, camas, vehículos, personal, dinero e idempotencia en origen. | Cero invariantes en cada campaña, no sólo en unit tests. |
| T05 · Autorización caduca | Versiones/TTL/cambio material, evaluaciones expiradas y réplica invalidan. | Revisión visible y conservación de operaciones ya hechas. |
| T06 · Offline/desorden | Orden recibida distinta de pretendida, telemetría terminal y retry viejo. | Suites causales y control silent/loss final. |
| T07 · Video antiguo | Corrección conserva necesidad vigente. | Recuento de falsos descartes/confusiones en corpus independiente externo. |
| T08 · Reparación | Dependencia afectada, trabajo/carga válidos preservados. | Ventaja comparativa K07 todavía no probada. |
| T09 · Servicio causal | Arrival≠receipt≠service; parcial, cero cantidad, demanda recurrente y censura. | Recibos de campañas y unidades nativas. |
| T10 · Reinicio | Leases/fencing, outbox, backup/restauración, no duplicación de comandos; suite congelada PASS. | Fallos históricos retenidos; repetir si cambia candidato/motor. |
| T11 · Publicación | Gate de envío/recepción y medios derivados privados/revisión/retiro. | Recorrido UI final; comprensión pública externa. |
| T12 · Medición | Fórmulas pequeñas, plazos futuros/censura/cero denominador/unidades/pareado. | Resumir sólo protocolos y builds iguales. |
| T13 · Composición | Recetas finitas, competencia/delegación y servicio real comprobados. | Nueva variación interna sin respuesta en entrada; no equivale a holdout independiente. |
| T14 · Compromisos | TTL, aceptación parcial, retirada, autorización bilateral y conflicto. | Ventaja de selección pendiente, mecanismo cubierto. |
| T15 · Investigación útil | Presupuesto/consulta/abstención/parcialidad implementados. | Ablación de preguntas decisivas vs indiscriminadas de la misma versión. |
| T16 · Competencia 100 necesidades | Ingesta semántica y carga física separadas; compilador global/holds cubiertos. | Una carga combinada actual con calidad, revisión finita, servicio y backlog. |
| T17 · Reparación comparada | Cuatro ensayos físicos anteriores; ambos enfoques y costes preservados. | Mismo build y perturbación, tiempo hasta recuperación; limitar claim si empata/pierde. |
| T18 · Atención humana | Plantilla/lectura/cola finitas modeladas; agrupación y alcance. | Ejercicio con personas para esfuerzo/error; no suplir con simulación. |
| T19 · Local/red | Instancia, red 4 DB, socio externo, partición/reconciliación implementados. | Comparar también referencia compartida competente; no reclamar efecto LLM por sumar stock. |
| T20 · Generalización | Variantes internas y mapas/idiomas parametrizables. | Transferencia interna automática adicional; holdout sellado independiente externo. |
| T21 · Multimodal | Bytes, ASR/fotogramas/PDF y continuación implementados. | Anotación independiente por formato/ruido/idioma externa. |
| T22 · Baselines | Referencias/ablaciones anteriores y B5/B6/B8/B0 del descubrimiento. | Completar primario/controles. B8 no sustituye al agente general B7 exigido para K15. |
| T23 · Equidad | Silencio/rumor/canal caído configurables; necesidad no borrada. | Final silent/loss y resultados por grupo con denominadores/censura; potencia insuficiente = inconcluso. |
| T24 · Economía/escala | Presupuesto persistente, fallos/tokens/coste, manual/degradación. | Carga combinada actual y coste por resultado útil, no por draft. |
| T25 · UX por rol | Rutas automáticas de navegador por rol/tamaño/teclado/movimiento. | Personas para comprensión/error/tiempo; externo. |
| T26 · Fuente real | Lectura IFRC y conectores con procedencia/permiso. | Revisión del procedimiento con operador/institución, externa. |
| T27 · Local/cloud | Stack local y contratos portables implementados. | GCP y Gemini deliberadamente excluidos; volver a medir al migrar. |

## 8. KPIs K01–K30: instrumento distinto de objetivo logrado

Los porcentajes de PLATAFORMA siguen como objetivos orientativos registrados. La petición de esta iteración pide una **mejora sustancial de tiempo**, no elegir de antemano un porcentaje fijo. Si un objetivo no tiene headroom, no se perjudica a la referencia para crearlo. Si un resultado es negativo, se conserva. No se declara 100/100 o primer puesto garantizado por pasar estas pruebas.

| KPI | Disponible localmente | Evidencia/gate pendiente |
|---|---|---|
| K01 · Déficit integral | Integral por unidad nativa y comunidad, físicos/censurados. | Primario nuevo y déficit water/food/blankets separado. Orientativo −20%/IC inferior +10%; no acreditado globalmente por pilotos. |
| K02 · Respuesta física | Primera ayuda positiva, ayuda suficiente, horizonte fijo, mediana/p95/RMST. | Completar pareado primario/controles y cobertura. Respuesta desde necesidad física, no desde draft. Orientativo mediana −25% sin peor cola/cobertura; no ocultar no atendidos. |
| K03 · Dentro de ventana | Elegibles con ventana observable; onTime de servicio. | Informar denominador/plazo. Si B5 ya atiende 100%, +10 pp no es posible ni requerido artificialmente. |
| K04 · Servicio colectivo | Plazas ocupadas/producción útil y dependencias físicas; composición distribuida factible para B5. | Comparación final B5/B6, mismos recursos/autoridad. Ganancia contra aislado no demuestra innovación incremental. |
| K05 · Exceso/desperdicio | Nativos served/pending/overprovided, retorno/reserva diferenciados. | Sólo reclamar reducción si hay exceso material legítimo en referencia. Exceso cero es guardrail, no «25% mejor». |
| K06 · Duplicación | Invariantes de ledger/reservas/recepción; retries idempotentes. | Cero observado en suites/campañas, no cero riesgo universal. No cancelar ayuda por incertidumbre para mejorar el contador. |
| K07 · Reparación | Tiempos de cambio/propuesta/operación, carga original/coste hundido. | Ablación actual mismo build hasta servicio restaurado. El objetivo −30% no está demostrado por los cuatro ensayos mixtos previos. |
| K08 · Cobertura poco visible | Etiquetas sólo evaluador, tiempos/déficit/coverage por comunidad, controles silencio/pérdida. | Tablas por grupo y diferencias/censura; margen −5 pp necesita precisión. Dos semillas pequeñas no garantizan no inferioridad. |
| K09 · Recursos por ayuda | Km/fuel/horas vehículo-personal y unidades útiles. | Tabla pareada de trade-offs. Departure route es recorrido previsto, no km efectivamente recorridos si hubo bloqueo/reroute. |
| K10 · Continuidad | Servicio/ocupación/consumo, interrupción y nueva demanda por episodio. | Evaluar ventana comprometida y no contar instante de apertura como continuidad. Calibración de consumo/procedimiento externa. |
| K11 · Detección | Fuente disponible/recibida, inferencia, necesidad operacional comprobada y latencia. | 100×4 sintético anterior no es recall independiente ≥90%; medir necesidades accesibles, no posts repetidos. |
| K12 · Evidencia vigente | Referencias/versiones/hash y enlaces exactos. | Precisión semántica ≥95% necesita revisión independiente; contrato de procedencia no certifica verdad. |
| K13 · Errores de interpretación | Corrección/restauración, fixtures de falso descarte/confirmación/fusión. | Contadores por gravedad/ambigüedad y anotación independiente; ambas clases importan. |
| K14 · Valor de consultas | Consultas/coste/demora/recibo y cambios de propuesta observables. | Ablación causal actual activa vs amplia, mismo presupuesto; las versiones corregidas distintas no se emparejan. |
| K15 · Aporte incremental | B5 competente, B8 keywords fuerte y B7 general en campaña anterior. | Discovery B8 no es B7. Comparación actual con agente general mismo modelo/tools/budget si se anuncia superioridad de diseño; objetivos sellados externos. |
| K16 · Embudo útil | Draft/validación/revisión/aprobación/orden/acuse/recibo/servicio parcial y fallos. | Publicar todo el embudo, rechazo por motivo; nunca propuestas/minuto = personas ayudadas. |
| K17 · Ingesta efectiva | Recibos versionados de disponible→descargado→aceptado/vinculado. | La aceptación de bytes no prueba interpretación correcta. Combinar tasas con una tarea semántica definida. |
| K18 · Transferencia | Generador/mapas/idiomas/recursos y variantes internas. | Añadir variación nueva interna sólo acredita transferencia interna; holdout independiente sellado externo. |
| K19 · Medios reales | Smoke bytes de imagen/video/audio/PDF, pendientes no leídos. | Corpus de ruido/idioma/ambigüedad autorizado e independiente; no reemplazar por descripciones perfectas. |
| K20 · Minutos humanos | Proxy modelado de lectura/verificación/revisión separado. | Minutos por necesidad correcta con personas, todos los roles y errores no inferiores: externo. |
| K21 · Comprensión operador | Automatización verifica rutas/alcance/estados. | ≥90% tareas/comprensión requiere ejercicio con personas; click test no es comprensión. |
| K22 · Cola de decisiones | Colas y revisores finitos, expiración/backlog. Control nominal combinado con backlog máximo 141, física y cutoff; §10.3. | Percepción real y revisión concurrente saturada pendientes. La autorización local de 0 ms en el nominal no es espera humana; conservar fuentes/decisiones pendientes al cutoff. |
| K23 · Comprensión pública | Portal/finanzas sandbox/progreso agregado aprobados. | Identificar receptor del dinero/confirmado/pendiente ≥90% con personas, externo. |
| K24 · Latencias | Simulación, recepción, tool, modelo real wall, revisión y consecuencias separadas. | Tabla de percentiles/fallos actual. No sumar ramas concurrentes como secuencia ni omitir provider failures. |
| K25 · Coste | Tokens/tarifa/modelo, coste/reserva desconocida/fallida, presupuesto y coste por episodio. | Coste por ayuda útil junto a ganancia. Infra/humano real no se inventan; presupuesto aceptable institucional externo. |
| K26 · Integridad | Invariantes, tenancy, leases/fencing, restart/outbox, sourceversion y física. Snapshot actual PASS 274+173 y UI84 con tres huellas iguales; los snapshots anteriores se conservan separados. | Mantener cero invariantes en campañas. La auditoría posterior detectó un recibo de evacuación incompleto: una corrección requiere otro gate y otra versión, sin atribuirle resultados del snapshot actual. |
| K27 · Escala con calidad | 1/4 DB y transporte 1.000, semántica 100×4 y física 101 anteriores; cinco perfiles del motor actual y control nominal combinado 24 necesidades; §10.3–10.4. | Nominal con percepción sustituida y cutoff no mide inferencia en vivo ni cierre total del pipeline. Burst actual y curvas 12 org/1.000 necesidades sólo cuando se ejecuten y hardware permita. No afirmar esa calidad por ingest throughput. |
| K28 · UI estable/accesible | Recorridos críticos desktop/móvil, contexto/borradores, teclado/movimiento reducido. | Últimas 84 comprobaciones de cuatro suites; evaluación integral de accesibilidad/comprensión externa. |
| K29 · Adopción/acceso | Conector IFRC real probado, registro de permiso/cobertura. | Operadores/institución, acceso a inventarios, revisión de procedimientos y objeciones: externo. |
| K30 · Memoria opcional | Registro/recuperación/revalidación de precedentes. | Ventaja vs recuperación simple y transferencia negativa pendientes; no gate del núcleo. |

### 8.1 Reglas de medición que no deben perderse

1. Cohorte primaria fija: todos los `gold.needId` se eligen por el evaluador antes del resultado; el controlador no recibe gold. No puntuar sólo lo que el modelo detectó o entregó.
2. Primera ayuda útil exige cantidad positiva realmente servida. Llegada, descarga pendiente, exceso sin utilidad y cantidad cero no crean esa fecha.
3. Demanda dinámica: un déficit nuevo tras cierre/retiro abre episodio con nuevo inicio. Conservar historial y servicio acumulado; crecimiento aún pendiente amplía el mismo episodio. Retiro de demanda no simula servicio. La campaña de descubrimiento actual es una cohorte fija; no trasladar su fórmula sin adaptar a episodios dinámicos.
4. Agua, comida, mantas y plazas mantienen unidades separadas. No sumar L·h con plazas·h ni tratar población sectorial repetida como personas únicas salvadas.
5. Resumir todas las semillas, fallos/costes y censurados al horizonte. Remuestrear mundos independientes; tweets del mismo mundo no son réplicas estadísticas.
6. Mostrar mediana, p95, primera ayuda, suficiencia, cobertura, déficit, sobreprovisión y coste. Una RMST mejor no oculta menos cobertura o daño a un grupo.
7. La ruta al salir es información de atribución del evaluador; el combustible/km del motor es el resultado físico. No derivar km realizados de una ruta que pudo cambiar.
8. Antes de comparar, iguales protocolo/corpus/mapa/seed, fuente del motor, candidato y evaluador. Un fix crea otra versión y conserva la campaña vieja.

## 9. Simulador: cobertura funcional y límites

| Componente | Construido/pruebas | Límite del claim |
|---|---|---|
| F0 · Contratos | 26 entradas/23 acciones, unidades, actores, permisos y fronteras público/privado. | Contrato local, no compatibilidad con todos los sistemas institucionales. |
| F1 · Motor | Reloj discreto, streams keyed, eventos, hash, checkpoints/fork/replay e invariantes. | Exacta repetición del mundo con manifiesto/acciones iguales; respuesta nueva del proveedor no es determinista. |
| F2 · Geografía/física | Regiones procedurales, grafo, clases de vehículo, rutas/tráfico, combustible, carga/descarga, capacidades/ocupación. | Realismo de interacciones relevantes; no simulador vial/estructural científico certificado. |
| F3 · Desastre/comunicación | Sismo/réplica, incendio, inundación y restricciones funcionales; canales/upload/index/radio/retry/out-of-order. | Parámetros requieren sensibilidad; no se hace real un tiempo por animarlo. |
| F4 · Información | Red social HTML/JSON scrapeable, eventos→posts/medios, originales/copies/edits/delete, 360 presets y variantes. | Corpus authored interno. Descripción de video no prueba percepción de video real. |
| F5 · Visor | 3D básico, cámara isométrica/zoom, selección/capas, seguimiento, feed virtualizado de realidad/comunicación/consumo. | Observador con verdad privada separado del actor. Render no altera física ni revela verdad al modelo. |
| F6 · Actores/red | Operadores/turnos/revisión finita, prioridades, permisos, ofertas/compromisos, socio externo, fondos/proveedores sandbox. | Autorizadores programados no validan experiencia o cooperación humana real. |
| F7 · Integración | HTTP/MCP scoped, recibos, query/action delays, ingesta real y plataforma llama proveedor real. | Gemma local; Gemini/GCP posterior. El simulador no toma decisiones LLM por su cuenta. |
| F8 · Evaluación | Baselines competentes, cohorts, métricas nativas, censura, trazas física/semántica, campañas y comparabilidad por hash. | Ventaja específica necesita finalizar el protocolo; holdout independiente fuera del generador. |
| F9 · Escala | Headless, batching, archived traces y perfiles motor regional/publicaciones hasta un millón históricos. | ×1000 está limitado al workload/hardware probado; no inferencia en vivo ×1000 ni calidad de 1.000 decisiones. |

### 9.1 Escenarios S01–S24

Todos tienen representación/fixture y mecanismos causales dentro del laboratorio. Esto no significa 24 victorias del modelo en campañas reales. H1/S24 es opcional.

| Escenario | Mecanismo que se puede comprobar | Evidencia competitiva todavía relevante |
|---|---|---|
| S01 · Retorno vacío | Flota, capacidad/turno/permiso, dos entregas físicas y uso de retorno. | Tiempo útil incremental vs. referencia; no inferir ventaja por reconocer una frase. |
| S02 · Refugio | Evaluación actual, agua/energía/personal/camas/evacuación, ocupación física. | Campaña composición final y mantenimiento del servicio. |
| S03 · Planta | Generador compatible, entrega/instalación y producción. | No contar stock de agua como producción; comparar utilidad real. |
| S04 · Video antiguo | Original/fecha, copias dependientes, necesidad actual preservada. | Falsos descartes/fusiones con denominadores. |
| S05 · Incendio | Amenaza/acceso cambiante, evacuación, órdenes demoradas, destino utilizable. | Resultado de adaptación hasta destino seguro modelado, no forecast científico. |
| S06 · Réplica | Invalida evaluación previa y acciones dependientes; nuevo trabajo/recibo. | Recuperación selectiva y coste físico, no reuse de autorización caduca. |
| S07 · Comunidad silenciosa | No publica, observación alternativa demorada, cobertura incompleta visible. | Control silent/loss por grupo sin oracle. |
| S08 · Reposts | Linaje/no duplicación, corrección, ubicación/medio preservados. | Dedup no borra dos incidentes genuinamente distintos. |
| S09 · Competencia masiva | Necesidades heterogéneas, mínimos/turnos/holds/revisores. | Carga combinada nominal y backlog, no tres smokes separados. |
| S10 · Partición/reserva | TTL, reservas/concurrencia, pérdida de acuse y reconciliación. | No doble consumo ni consentimiento por silencio. |
| S11 · Retirada tras salida | Compromiso invalidado con operación/carga en curso. | Trabajo/coste irreversible preservado y permiso nuevo. |
| S12 · Conductor offline | Pedido de ruta distinto de orden recibida, cola y acuse. | Medir cambio accesible→orden recibida→efecto físico. |
| S13 · Reconexión | Burst de informes antiguos y nuevos, versiones/cola/dedup. | Reacción/recuperación con capacidad finita, no sobrescritura vieja. |
| S14 · Llegada sin servicio | Descarga/instalación/personal/recepción pendiente. | Sólo servicio útil reduce déficit y marca tiempo. |
| S15 · Desequilibrio | Reservas/envíos/consumo y demanda creciente/retiro por episodios. | Sobreprovisión/deficit juntos; no favorecer referencia derrochadora. |
| S16 · Fuente hostil | Inyección, identidad falsa, datos que no otorgan autoridad. | Aislamiento fuera del modelo y casos retenidos. |
| S17 · Herramienta/proveedor cae | Fallo/cuota/timeout, presupuestos, parcial/manual, estado preservado. | Coste/walltime del fallo y censura; no llamada «gratis» temporal. |
| S18 · Imposible | Restricción insatisfecha, parcialidad y parada explícita. | No fabricar recursos/servicio ni atascar trabajos factibles. |
| S19 · Red+externo | 4 dueños y gateway del quinto actor con permisos físicos. | Referencia shared también factible, comparación igual dotación. |
| S20 · Fondos/publicación | Sandbox promesa→liquidación→compra→recibo y público agregado aprobado. | Nada de dinero real, confianza o incremento de donaciones demostrado. |
| S21 · Fuente cambia | Schema/error/HTML, revocación/borrado, retry y versión. | Cobertura y pendientes explicados; no tratar fallo como dato vacío. |
| S22 · Ambigüedad | Lugar/unidad/fecha/idioma confusos y consulta dirigida. | No ubicación precisa inventada; idioma nuevo interno ≠ prueba independiente. |
| S23 · Información suficiente | Datos formales inmediatos y referencia competente. | Control negativo válido: empate/pérdida se conserva, no exigir ventaja donde LLM no agrega valor. |
| S24 · Memoria | Precedente engañosamente similar y revalidación. | Opcional; transferencia negativa debe reportarse si se anuncia beneficio. |

### 9.2 Condiciones de justicia de la nueva campaña

El generador informacional `response-benchmark` crea necesidad física y publica señales antes del reporte formal. Los brazos tienen el mismo directorio público, originales/formatos/linaje, demora formal, stock/flota consentidos, consultas y física. Las etiquetas de falsedad, silencio y `gold` se quedan en el evaluador.

B5 recibe gratuitamente extracción de solicitudes explícitas y deduplicación de reposts; el resto pasa por lectura finita. B8 incorpora además discovery por keywords/ubicación gratuito. B6 usa el proveedor real para interpretar tandas, después pide la misma aclaración operacional. La cantidad inferida no escribe necesidad física. La aclaración devuelve pendiente y compite por recursos finitos, mientras revisión/viajes avanzan. El compilador y los dueños programados son iguales entre brazos.

El tiempo de disponibilidad del modelo se carga como `max(latencia declarada, tiempo real de proveedor)`, también en fallos. SQL/HTTP wall overhead se reporta por separado. Reordenar una cola para ejecutar más eficientemente no puede darle prioridad distinta sólo a B6. La evaluación de instalaciones usa viaje/trabajo/competencia propia o delegada; no usar un canal de aclaración como oracle de seguridad.

El escenario de 24 necesidades/192 distractores y reporte a 60 min es una familia informacional predeclarada, no calibración de un terremoto o incendio real. El mapa primario de 6 km con tráfico/pérdida cero aísla la oportunidad informacional; no demuestra robustez a toda geografía y desastre.

## 10. Pendientes automáticos ejecutables en esta fase

### 10.1 Gates para cerrar la iteración principal

1. **Nueva verificación completa y freeze:** el PASS previo [1791837370142](../reports/verifications/1791837370142.json) identifica únicamente su snapshot 215+154/UI84. El motor reparado ya pasa 166/166; confirmar plataforma, UI, sintaxis/higiene y tres huellas conjuntas antes del nuevo sello. No convertir ese gate en ventaja de tiempo.
2. **Campaña primaria nueva:** declarar y completar todos los mundos B5/B6/B8 sobre ese sello, sin elegir respuestas/semillas favorables. Resumen pareado de suficiencia y primera ayuda con incertidumbre, cobertura/censura, déficit nativo, exceso, consulta/coste, combustible/km/horas y errores/invariantes. Los primarios `1791834746311` y `1791837744022` quedan invalidos; no se terminan ni combinan con el nuevo.
3. **Completar controles declarados:** trabajador de aclaración único, lectura cero, reporte formal inmediato, silencio+5% pérdida. Heredan todas las demás variables del primario y congelan protocolo antes de correr. Mostrar exactamente dónde desaparece la ventaja o aparece daño.
4. **Completar composición final:** resultados de B5/B6 actuales bajo assessment delegado, ambos con la misma competencia/herramienta/autoridad. Recibo de inspección, aprobaciones, traslados/dependencias, ocupación/continuidad. El B5 distribuido ya demuestra factibilidad; no volver a comparar contra la versión que carecía de competencia.
5. **Publicar límites de la afirmación:** si sólo hay ventaja en review informacional denso, afirmar esa familia y sus parámetros. Un empate frente a B8/B7 no se borra. No extender una mejora interna a mortalidad, vidas salvadas, productividad humana o Gemini.

La revisión acotada inicial no encontró otra ruta funcional obligatoria ausente. La campaña posterior descubrió dos defectos fuente que esa suite no cubría: `load` marcaba fallo por compromiso expirado sin publicar estado terminal; y la instalación buscaba el stock base ignorando stock propio con sufijo. La nueva suite del motor prueba acuse terminal con outage/replay y consumo/reserva de stock propio tras entrega ajena previa, agotamiento y reposición bilateral. Son reparaciones de simulador/canal, no una ventaja del modelo. El TTL implícito de 15 min se mantiene; una ventana mayor requiere petición concreta y autorización del owner. Falta el gate conjunto del candidato reparado antes de otra comparación.

El defecto de amplificación se corrigió y se volvió a verificar; su efecto sobre ventajas comparativas todavía exige campañas nuevas. Los puntos siguientes son gates adicionales de evidencia para afirmar todas las ventajas del diseño, no excusas para reemplazar los gates anteriores ni demanda de hacer todas las llamadas pagadas de inmediato.

### 10.2 Para extender el claim más allá del descubrimiento

| Pendiente | Prueba/corrección concreta que lo cierra | Qué permite afirmar |
|---|---|---|
| Amplificación de continuaciones/recibos — mecanismo verificado | Corrección/regresiones incluidas en gate 215+154: una continuación por propuesta; estados equivalentes conservan primer payload/recibo; alcance, autoridad, progreso real y assessment vigente permanecen materiales. Cadencia HTTP 0/1.100 ms con física idéntica PASS. Mantener control de tamaño de drain/cadencia y campañas nuevas antes de cerrar ventajas. | Invariancia causal en los casos ensayados; no una garantía de todo patrón concurrente ni superioridad. |
| Carga combinada K22/K27 | Un perfil nominal/burst actual mantiene ingesta, interpretación, revisión finita y servicio simultáneos; inicialmente se puede probar estructura con salidas reproducidas, separado de la corrida real del modelo. Registrar backlog máximo/recuperación, tiempos/coste y casos no atendidos. | Calidad a esa carga concreta. Ni fixture model replay ni transport throughput por sí solos prueban calidad de inferencia en vivo. |
| K14 activo vs. amplio | Mismo build/corpus/timing/budget y perturbar incógnita decisiva/distractores/imposible. Medir preguntas, coste y service effect, incluyendo consultas inútiles y respuesta inconclusa. | Ventaja de elegir la pregunta, si existe; no sólo menos tool calls. |
| K07 reparación | Repetir perturbación idéntica para repair selectivo vs. replan completo, preservando misma carga/posiciones/permiso/sunk costs. Cronometrar propuesta válida y ayuda restaurada, no sólo respuesta del modelo. | Menor demora de recuperación en el rango observado, si existe. |
| K15 vs agente general | Misma información autorizada, modelo, tools y presupuesto; agente general competente en la misma familia nueva. Prohibido sustituirlo por keywords B8 o un agente sin herramientas. | Diferenciación del diseño NEXO frente a acceso al modelo. |
| K18 transferencia interna | Variación nueva estructural/idioma/mapa sin solución en prompt y sin tuning posterior sobre ese resultado. Registrar caída de calidad y todos los fallos. | Transferencia interna limitada. Un tercero y sellado independiente siguen externos. |
| KPIs de trade-off/embudo | Derivar tablas de recibos ya existentes: native deficits, suficiente/primera ayuda, cobertura/grupos, combustible/km/horas, draft→auth→service, coste/fallos. Conservar ceros e imposibles. | Qué mejoró, cuánto costó y a quién no atendió. No requiere modificar fuente/physics para fabricar ventaja. |
| Rendimiento motor de versión actual — medido | Cinco perfiles default del benchmark, artefacto inmutable con ENGINE_BUILD inicial/final, scripts/manifests SHA256 y hardware; §10.4. Región observada ×256, sin garantía universal de ×1000. | Rendimiento del motor en esos perfiles/host; no inferencia en vivo ni calibración de realidad. |

Los objetivos de ventaja K04/K07/K14/K15/K18 no se convierten en «cumplidos» porque se decidió limitar el claim. La implementación puede estar cerrada con esos beneficios no acreditados, y el registro debe decirlo. Para cerrar la ambición completa sin límites haría falta aportar esa evidencia y, después, los gates externos.

### 10.3 Controles combinados históricos sin llamadas pagadas

**Snapshot superado:** ambos probes de esta sección usaron `d2a…/aaec…` antes de la reparación de pickup/stock. [pickup-stock-invalidation](../reports/pickup-stock-invalidation.json) los conserva como diagnóstico de transporte/colas. No validan el candidato reparado ni una ventaja; repetir un perfil predeclarado sobre el nuevo freeze antes de cerrar K22/K27.

Se preparó un probe privado fuera de las fuentes congeladas, `.local/combined-load-probe.mjs`. La primera ejecución se pospuso a solicitud del coordinador ante el diagnóstico de amplificación. Después del nuevo freeze se ejecutó el nominal [local-combined-load-1791837802363](../reports/combined/local-combined-load-1791837802363.json), con [código exacto archivado](../reports/combined/local-combined-load-1791837802363.probe.mjs). Su estado es **`aborted_wall_limit`**, no PASS del pipeline completo: el controlador se detuvo a los 55,70 min virtuales, al alcanzar el presupuesto de 420 s wall entre ciclos; el total con scoring/cierre fue 423,57 s. Se conservó la continuación física hasta el horizonte fijo de 3 h sin emitir nuevas decisiones.

Su diseño combina 4 DB independientes en un proceso, 24 necesidades, 96 distractores y 2 reposts; ingesta multiformato HTTP real; interpretación sustituida por el parser convencional que sólo recibe el payload público de `SemanticIngestion`; aclaraciones pendientes con 2 trabajadores; revisión fuente finita de 30 s; transporte/recibos/servicio físicos. Carga 15 s modelados por percepción, declara un límite wall de 7 min y conserva cualquier interrupción/censura. El proveedor inyectado rechaza tareas distintas de percepción y el proceso rechaza cualquier destino HTTP externo; no tiene llamadas pagadas. Captura protocolo, huellas inicial/final, hash del propio probe, hardware/contención, fuentes procesadas/pendientes, backlog, revisiones, costes cero y recibos físicos.

Resultado nominal conservado:

| Indicador | Observado | Interpretación |
|---|---:|---|
| Fuentes durables | 236 por cada una de 4 DB | Recepción; no comprensión ni decisión de todas ellas. |
| Originales procesados / recibidos | 177 / 180 | 3 quedaron pendientes tras la recepción final del horizonte. |
| Backlog máximo de interpretación | 141 | Llegó a cero durante la operación; la recepción final volvió a agregar pendientes. |
| Necesidades con primera ayuda y servicio suficiente al cutoff | 22 de 24 | Dos entregas estaban físicamente en curso; conservarlas, no fingir finalización temprana. |
| Necesidades con primera ayuda y servicio suficiente al horizonte de 3 h | 24 de 24 | Las órdenes ya emitidas completaron servicio físicamente después de parar el controlador. |
| Operaciones físicas | 24 entregas completadas | Un servicio se cuenta por descarga/recepción, no sólo por draft o salida. |
| Revisiones fuente / trabajo modelado | 33 / 990 s | Duración fuente finita; no tiempo de una persona real. |
| Interpretaciones sustituidas | 30 llamadas locales | Parser público determinista, no proveedor real ni respuestas tomadas del gold. |
| Sync durable wall p95 | 828,13 ms | Sobre este host/proceso con contención, no SLA ni latencia de comprensión. |
| Error / invariantes / HTTP externo / paid | 0 / 0 / 0 / 0 | Integridad y barrera de coste en esta ejecución. |
| Huellas inicial/final | Idénticas a las de §1 | Ningún cambio de candidato/evaluador/simulador durante el control. |

Los campos nominales `modeledWaitIncludingReviewP50Ms/P95Ms = 0` tienen un límite de instrumentación: registran `domain.review`, la autorización local, **no** la espera/revisión finita del motor ejecutada después por el worker. No se usan como espera humana ni cierre del KPI K22. Las propuestas de UI aún `executing` al corte se conservan como tales aunque el scorer físico vea servicio posterior; el control no propagó recibos después de detenerse. Se acredita combinación de mecanismos con consecuencias físicas en esa carga, con interrupción explícita, sin acreditar recuperación completa del pipeline ni throughput del LLM.

Se predeclaró después un burst de **100 necesidades / 192 distractores**, misma dotación finita de organizaciones/stock/flota, demoras, 2 trabajadores de aclaración, horizonte de 3 h y límite wall de 420 s. Usa **grid 13** y la misma extensión de 6 km: el generador exige un edificio residencial distinto por necesidad, y grid 9 sólo tiene 81 edificios totales. Aumentar ubicaciones evita un input inválido; no regala recursos ni demuestra mejora frente al mapa nominal. El scratch sólo agrega instrumentación de revisión fuente (`requestedAt`, `readyAt`, `createdAt`, `reviewedAt`) y distingue esa medición de la autorización local. El perfil burst se conserva por separado, incluyendo cualquier falta de capacidad, error, pendiente o interrupción; no se combina como muestra del nominal.

El burst [local-combined-load-1791838300733](../reports/combined/local-combined-load-1791838300733.json), con [instrumento exacto archivado](../reports/combined/local-combined-load-1791838300733.probe.mjs), terminó en **`aborted_wall_limit`**. El controlador avanzó 20,03 min virtuales antes del límite wall; luego sólo continuaron las órdenes físicas ya emitidas hasta el horizonte fijo de 3 h. Conserva 14/100 necesidades con primera ayuda y suficiencia, **86 censuradas**, 250/464 originales procesados y **214 pendientes**. Recibió 676 publicaciones durables por cada una de las cuatro DB, con backlog máximo de 288. Hubo 20 revisiones fuente completadas: p50/p95 de solicitud→completado de 30 s, 600 s de trabajo finito modelado y máximo una revisión abierta simultánea. La cola de revisión fuente observada de cero no demuestra capacidad concurrente de revisores: el runner solicita las autorizaciones secuencialmente.

El sync durable wall p95 fue 2.655,79 ms en el host con contención; se conservaron cero errores, cero invariantes incumplidas, cero HTTP externo y cero llamadas pagadas. Las huellas inicial/final fueron idénticas a las de §1. No se alcanzó procesamiento completo ni servicio para las 100 ubicaciones. Las 14 entregas no son throughput de 100 decisiones, y los 86 casos censurados no desaparecen del denominador. El presupuesto wall y el coste SQL/HTTP del runner limitaron cuántos minutos virtuales pudo controlar; el resultado no permite separar ese cuello de botella de la capacidad operativa física sin otro perfil instrumentado.

Ambos son controles de integración y carga de los mecanismos sobre un snapshot concreto. No miden calidad, precio o rendimiento semántico de Gemma/Gemini, comprensión humana ni una ganancia frente a baseline. Se preservan las interrupciones y no se regalaron recursos para forzar atención completa.

### 10.4 Rendimiento observado del motor anterior

[engine-current-build-1791836997254](../reports/benchmarks/engine-current-build-1791836997254.json) ejecutó `scripts/benchmark.mjs` sin `--full`, con cinco workers sucesivos. **PASS para su build anterior**, ENGINE_BUILD inicial/final `aaec663a4bc2f51065ab021159dac481cb174b079b724bc89ed270cc66fd2cee` y SHA256 de scripts/manifests sin cambios; ledger válido en los cinco perfiles. No mide el motor reparado `c83c…`. Hardware: Intel Core i5-10400, 12 CPU lógicas, 63,93 GiB RAM, Windows 10.0.26200, Node v24.19.0. Se intentó prioridad menor; otras verificaciones/desarrollo pudieron competir por CPU. El resultado bruto también se conserva en `disaster-response-simulator/runs/benchmarks/latest.json`.

| Perfil | Tiempo simulado | Construcción + eventos wall | Eventos / publicaciones | Ratio simulado / wall |
|---|---:|---:|---:|---:|
| unit, S01, seed `hand-verifiable` | 30 min | 0,242 s | 518 / 4 | ×7445 |
| city, S09, seed `city-development` | 2 h | 5,283 s | 49.911 / 8.076 | ×1363 |
| region, S19, seed `regional-development` | 4 h | 56,321 s | 247.410 / 55.055 | **×256** |
| default-48h, S01, seed `response-lab-2026` | 48 h | 141,823 s | 1.282.175 / 12.493 | ×1218 |
| information-10000, S23, seed `response-lab-2026` | 1 h | 1,559 s | 32.652 / 10.000 | ×2310 |

El perfil regional **no alcanza ×1000**. No se optimizó ni se cambió su configuración después de observarlo; se conserva ese límite. El default de 48 h alcanzó ×1218 y un pico RSS muestreado de 476,8 MiB; el total del wrapper fue 220,8 s. Los ratios excluyen hashing final, exportación, rendering, inferencia externa y tiempo humano. No se ejecutaron perfiles de 100.000/1.000.000 publicaciones en esta medición. Por tanto, el motor admite iteración acelerada en los perfiles observados, con velocidad dependiente de carga; no se promete ×1000 universal ni decisiones/modelos ×1000.

### 10.5 Rendimiento observado del motor reparado

El [benchmark 1791840958602](../reports/benchmarks/engine-current-build-1791840958602.json) repitió los cinco perfiles default sin `--full`. Conserva ENGINE_BUILD inicial/final `bb307da98907240bf04aa7a9bcf6675efd74a7dac6b216cddc346b964b14680c`, SHA256 de scripts/manifests sin cambios y ledger válido en los cinco. Hardware: Intel Core i5-10400, 12 CPU lógicas, 63,93 GiB RAM, Windows 10.0.26200, Node v24.19.0. Se intentó prioridad menor; puede existir contención con otras verificaciones. El artefacto anterior de §10.4 permanece histórico.

| Perfil | Tiempo simulado | Eventos wall, sin hash final | Eventos / publicaciones | Ratio simulado / wall |
|---|---:|---:|---:|---:|
| unit | 30 min | 0,262 s | 522 / 4 | ×6879,47 |
| city | 2 h | 5,127 s | 49.915 / 8.076 | ×1404,24 |
| region | 4 h | 52,445 s | 247.410 / 55.055 | **×274,57** |
| default-48h | 48 h | 142,215 s | 1.282.177 / 12.493 | ×1215,06 |
| information-10000 | 1 h | 1,669 s | 32.652 / 10.000 | ×2156,84 |

La ejecución regional continúa por debajo de ×1000; no se cambió su carga ni se ajustó el motor para esconderlo. El perfil de 48 h tuvo RSS pico muestreado de 479,55 MiB. El wrapper completo duró 217,85 s. Son ratios del motor headless en este host: excluyen hash final, exportación, rendering, modelo remoto y tiempo humano; no permiten afirmar inferencia o decisiones útiles ×1000. No se ejecutó el perfil de un millón de publicaciones.

### 10.6 Recuperación de la cohorte de fuentes, separada de servicio físico

Se añadió `scripts/source-recovery.mjs` porque finalizar un escenario cuando el observer ve todas las necesidades servidas no demuestra que se hayan procesado las fuentes públicas pendientes. El nuevo control sella los registros realmente recibidos por HTTP a los 5 min, con ID, versión y hash de contenido. Su controlador sólo inspecciona esas fuentes y las colas/recibos locales: no consulta `corpus.gold` ni necesidades privadas para decidir cuándo cerrar. El scorer físico lee truth después y se conserva separado.

Cada registro mantiene su versión durable. Las disposiciones distinguen parsing explícito, copias con linaje público, comentario rutinario, progreso con recibo y lectura semántica válida; estas últimas siguen **unverified**, no se convierten en verdad comprobada. Truncamiento, observación rechazada, versión revisada/retirada, falta de retención y ausencia de recibo permanecen como atención pendiente. Avanzar un cursor o haber presentado una tanda no se cuenta como recuperación. Un recibo posterior válido sólo puede cerrar la misma versión exacta; no valida una revisión nueva. Las fuentes posteriores al cutoff se reciben y conservan fuera del denominador fijo.

La [fixture 1791841800942](../reports/source-recovery/source-recovery-parser-1791841800942/report.json), con [protocolo](../reports/source-recovery/source-recovery-parser-1791841800942/protocol.json), usó 2 necesidades, 4 distractores, 1 repost, cuatro DB, mapa grid 5/2 km, dos trabajadores de aclaración, revisión fuente de 30 s, formal a 30 min y horizonte de 1 h. Estado **`recovered`**: 9/9 ID+versión durables en cada DB y dispuestos; cero atención pendiente, jobs, propuestas, consultas, inspecciones, operaciones recibidas o necesidades recibidas sin cubrir al corte. El cierre fue a 14,5 min virtuales, 9,5 min después del intake, con 19,0 s wall. Se conservaron 1 lectura sustituida, 1 aclaración explícita, 4 revisiones fuente, 426 HTTP locales y 2/2 servicios físicos suficientes. Las tres huellas iniciales/finales son iguales; cero errores/invariantes/HTTP externo/pago. Después del corte se conservaron tres versiones adicionales por DB, sin acreditarlas como recuperadas dentro de la cohorte original.

Cuatro pruebas automáticas cubren conservación del cohort, recibo/retención requerida, rechazo de revisión o contenido cambiado sin versión, truncamiento/rechazo y recorrido HTTP con física. La barrera sin pago rechaza HTTP externo y sustituye sólo la percepción a partir del payload público real; no accede a gold. El modo real usa el proveedor configurado con máximo 32 llamadas y presupuesto de $0,15, y debe ejecutarse sólo cuando se autorice esa campaña. El nominal predeclarado es 24 necesidades/96 distractores, cutoff 5 min/horizonte 3 h. **Ese nominal con percepción real todavía no se ha completado**. La fixture acredita un mecanismo integrado pequeño, no precisión semántica, fake-news accuracy, rendimiento humano, throughput de 100 decisiones ni una mejora frente a planificación convencional.

### 10.7 Recuperación nominal integrada con percepción sustituida

El [nominal 1791842632387](../reports/source-recovery/source-recovery-parser-1791842632387/report.json), con [protocolo previo](../reports/source-recovery/source-recovery-parser-1791842632387/protocol.json), ejecutó el perfil 24 necesidades/96 distractores/2 reposts, cuatro DB, mapa grid9/6km, dos trabajadores de aclaración, reviews fuente de30s, formal a60min, cutoff de5min, horizonte3h y límite wall600s. Utilizó exactamente las tres huellas actuales de §1. Estado **`recovered`**, cero errores/invariantes/HTTP externo/pago y tres huellas finales iguales. El protocolo y todos los pendientes intermedios se conservan; no se alteraron carga, física, controlador o parámetros para forzar el cierre.

| Indicador | Observado | Límite |
|---|---:|---|
| Cohorte recibida ID+versión | 214 | Incluye publicaciones ambientales del escenario, además del corpus instalado; no se reduce al parámetro de96 distractores. |
| Disposiciones / atención pendiente al cierre | 214 /0 | 49 copias con linaje público, 90 recibos semánticos válidos **unverified**, 25 comentarios rutinarios, 24 parsing explícito **unverified**, 26 etiquetas históricas explícitas. No es verificación de verdad de214 publicaciones. |
| Retención de cada versión original | 214 por cada una de4 DB | Registros posteriores quedan separados del denominador. |
| Primera muestra con toda la cohorte dispuesta | 5,75min, 45s tras intake | Tres lecturas públicas sustituidas×15s modelados; no es tiempo de un modelo remoto ni servicio físico. |
| Cierre de fuentes y todas las colas locales | 79,15min, 74,15min tras intake | Espera campo, autorización, flota finita, viajes, descarga, recibos y jobs. No se detiene por gold. |
| Wall total / límite | 227,18s /600s | Host con otros procesos; no SLA ni curva de escalabilidad. |
| Aclaraciones explícitas / revisiones fuente completadas | 13 /35 | Las demás comprobaciones de percepción siguen el pipeline ordinary; no se llaman verdad las fuentes iniciales. |
| Review solicitud→reviewedAt p50/p95 | 30s /30s | Revisión modelada secuencial; no productividad humana ni saturación concurrente de revisores. |
| Máximo muestreado tras primera tanda | 118 fuentes pendientes | No mide el pico inicial anterior a la primera muestra. |
| Otros máximos muestreados | 24 inspecciones,13 propuestas,16 jobs,8 operaciones activas | Todos quedan a cero al cierre; no significa100 problemas físicos por minuto. |
| Ayudas físicas suficientes | 24/24 | Consecuencias físicas separadas del reconocimiento de fuentes; no comparación con una referencia. |
| HTTP locales / modelos pagados | 3.781 /0 | Provider substitute sólo recibe el payload público; HTTP externo se rechaza. |
| Versiones posteriores retenidas | 36 por DB | No reciben crédito de recuperación dentro de la cohorte sellada. |

K22 tiene así evidencia nominal de **combinación de mecanismos y cierre local** con percepción sustituida. Continúan pendientes la misma ejecución con proveedor real, calidad semántica independiente, carga concurrente de revisores y la ventaja causal frente a planificación convencional. El nominal no convierte45s de lectura sustituida en45s de entrega, ni sus35 reviews secuenciales en capacidad humana demostrada.

## 11. Gates externos o deliberadamente fuera de fase

- Operadores y público: K20/K21/K23, comprensión/errores/minutos, accesibilidad aplicada, revisores bajo carga y voluntad real de compartir información.
- Especialistas/institución: calibración de tiempos, protocolos, cualificaciones, reservas y restricciones. Un parámetro plausible o un simulador complejo no es revisión independiente.
- Corpus autorizado anotado y holdout sellado independiente: K11–13/K18–19, medios/idiomas/ruido, lugares ambiguos y transferencia fuera de templates.
- Integraciones con inventario/procedimientos reales, permisos de redes comerciales y pagos reales: el sandbox y IFRC de lectura no los acreditan.
- Gemini y GCP: sustitución posterior exige repetir mediciones, latencia/coste/seguridad e instalación; no presumir igual resultado entre modelos. Cloud Run, Cloud SQL/Firebase u otros servicios son arquitectura posterior, no entrega local realizada.
- Efectividad de campo, causalidad sobre rescates/mortalidad y cifras de vidas salvadas: no derivables del laboratorio. El propósito humanitario se comunica como objetivo, no resultado medido.

La definición de terminado distingue producto local, evidencia comparativa y validación externa. Esta distinción permite avanzar sin ocultar pendientes y sin exigir al simulador que certifique aquello que sólo puede comprobar una intervención real.
## Anexo: capacidad humana dentro del mundo, no como penalización del evaluador

La versión nueva implementa `human_work` en el motor para lectura, integración/decisión y comunicación. Las solicitudes compiten por pools finitos, conservan su referencia y versión, entregan un snapshot al terminar y pueden esperar, fallar o quedar inconclusas. Un relay requiere además entrega efectiva por el canal nativo; completar el trabajo de comunicación no equivale a recibir la información. La revisión humana de una acción física sigue siendo independiente y comparte el pool de decisión en todos los brazos.

El [protocolo de capacidad humana](EVALUACION_CAPACIDAD_HUMANA.md) declara `C_manual`, `C_decentralized`, `B5`, `B8` y `B6`. El flujo manual central conserva triage competente y el mismo compilador operativo después de recibir la información. Los controles automáticos fuertes conservan sus capacidades anteriores. No se inyecta un porcentaje de duplicados ni se añade un retraso fijo a una puntuación: el exceso debe provenir de órdenes, stock, carga y recibos realmente ejecutados. Las tasas humanas son hipótesis de laboratorio, con controles de lectura rápida, más lectores y cero demora adicional; no representan calibración con profesionales.

La campaña principal pendiente de esta versión comprende tres semillas nuevas y cuatro brazos, doce mundos. Debe registrar primer servicio útil, suficiencia al horizonte, censura, déficit por unidad, exceso, cola por etapa, trabajo y relays, todos los errores recuperados y costes conocidos/desconocidos. Un resultado favorable frente a `C_manual` demuestra el efecto del flujo automatizado bajo esos supuestos. El incremento atribuible al modelo necesita el contraste separado con `B5/B8`, que también pueden ganar. Los resultados negativos previos permanecen válidos para sus propias huellas.

Los gates mecánicos de colas, visor, recuperación y recibos no sustituyen la campaña física comparativa ni los requisitos externos de comprensión humana, corpus independiente, Gemini o campo. Al cerrar las campañas se añadirá el readout íntegro, sin borrar fallos, limitar el denominador a los éxitos o convertir litros/minutos en vidas salvadas.

