# Checklist de cierre local del candidato congelado

Lectura de requisitos y evidencia al 13 de octubre de 2026, 02:08 UTC. Este documento complementa la especificación; no modifica `PLATAFORMA.md`, `SIMULADOR.md`, objetivos, protocolos ni resultados históricos. Una casilla pendiente requiere evidencia nueva o un límite explícito del claim, no elegir una corrida favorable.

## 1. Versión y gate técnico

| Componente | Huella exacta |
|---|---|
| Plataforma | `704c8ac21aba087f8732c5d9d6a413c50284c5caa5f573e24a2cc891d9450c1e` |
| Evaluador | `5e6a11ecae88648e491fe680fd7ae7407d00e12622b244c021dd5d9e661bbeab` |
| Motor | `2825f94dffbf6db2835c05170ea00d9225863e4955682debd6236c4c71454b4e` |

`reports/verification-latest.json` registra **448/448 pruebas de plataforma y 228/228 del motor**, sintaxis/contratos verdes y huellas finales sin cambios. `reports/ui-verification-snapshot.json`, cerrado a las 02:04:44 UTC, registra los siete recorridos de navegador verdes: **113 comprobaciones** en total, incluyendo finanzas, cobertura y descarga, con las mismas tres huellas. Esto cierra el gate técnico de esa versión, no los resultados de las campañas ni los gates humanos.

Se conserva el gate UI fallido por ausencia del runtime real de imagen en `reports/ui-review-journey-failures/1791856482625/`. El entorno aislado ahora comparte mediante junction el Python ya instalado en el checkout principal. La reparación fue de setup y del diagnóstico/preflight del script; no cambió privacidad, autoridad, servicio ni las huellas anteriores. Las fotos usan Pillow real; el recibo del recorrido de publicación sigue siendo un fixture UI explícito, no una entrega física nueva.

## 2. Ocho gates y los runners que los cubren

| Gate | Requisito | Runner/evidencia | Estado y condición de cierre |
|---|---|---|---|
| G01 | K26/K28: integridad, recuperación, permisos y UI | `scripts/verify.mjs`; `.local/run-ui-verification.mjs`; pruebas de crash real, ENOSPC, backup, lease, versión y separación de propietarios | **Gate técnico PASS** en las huellas §1. No heredar una campaña de otro build; conservar el UI fail anterior. |
| G02 | K01–K04/K15: ayuda física y comparación competente | `.local/stream-plan.mjs` con los planes original y carga informativa; B5/B6/B8; `.local/general-agent-reuse.mjs` para B9; S19 mediante `scripts/parallel-campaign.mjs` B5/B6/B7 | **Resultados frescos pendientes de lectura**. RMST hasta servicio suficiente a horizonte fijo es primario; primer servicio útil y tiempos sólo entre atendidos son secundarios. No sustituir original negativo por estrato informativo favorable. La comparación individual/red con dotación total controlada sigue siendo una evidencia distinta. |
| G03 | K07/K14: reparar y preguntar con beneficio físico | `.local/research-studies-controlled.mjs`: reparación S23, dos semillas, `full_refresh`/`selective`; consulta S06/S11/S18, `broad_refresh`/`active` | **Pendiente**. Comparar desde el cambio realmente recibido hasta draft válido y recuperación de la operación original; conservar carga, stock, tiempos hundidos, fallos y censura. Menos consultas sin mejor servicio no es éxito. |
| G04 | K11/K13/K16/K17/K22: fuentes, decisiones y recibos | `.local/recovery-series.mjs`; `scripts/source-recovery.mjs`; collector `evaluation/proposal-funnel.mjs` en episodios generales/discovery | **Pendiente**. Cohorte recibida ID+versión sellada al corte; pendientes e inconclusos no son interpretaciones. K16 exige vínculo exacto propuesta/revisión/acción/propietario/operación y recibo físico positivo con clocks finitos. No cerrar por verdad privada. Recibos semánticos no miden por sí solos precisión. |
| G05 | K22/K24/K27/T16/T24: carga con calidad | Recovery nominal 24/96 y burst 48/384; `.local/combined-100-controlled.mjs` parser/real 100 necesidades; `scripts/load.mjs` para capacidad de almacenamiento/transporte | **Pendiente**. Separar cola recibida, modelo, revisores finitos, servicio parcial/suficiente y censura por wall/horizonte. El runner acoplado de 100 no es comparación B5 ni prueba de 100 soluciones por minuto. La matriz 1/4/12×10/100/1000 estructural no acredita calidad semántica a esas escalas. |
| G06 | K05/K06/K08/K09/K10/K25: daño desplazado, recursos y costes | Lector offline `.local/read-fresh-evidence.mjs`, archivo inmutable `reports/measurement-runners/fresh-offline-readout-a6ae13d7db7d097d/` | **Pendiente** sobre TODOS los resultados nuevos. Déficit/exceso por unidad propia; silenciosos/remotos separados; km/fuel/horas comprometidas y de trabajo por separado; continuidad y costes conocidos/reservas desconocidas. Si el export no contiene K09/K16, informar `unknown`, no copiar otra campaña. |
| G07 | S01–S23: trazabilidad de comportamiento real y adversidad | Pruebas físicas/UI actuales, `reports/audits/requisitos-locales-actuales.json` y matriz §3; campañas S19/K07/K14 | **Pendiente de matriz final**. Ejecutar un catálogo sin invariantes no demuestra las 23 estrategias, ni sus variantes favorable/adversa/inviable. No se requieren 23 estudios pagados: sirven regresiones físicas gratuitas y límites expresos, con exacta evidencia. |
| G08 | K24/K27: velocidad del motor | Simulator `scripts/benchmark.mjs`, cinco perfiles por defecto, hardware/source bytes/ledger y huellas inicial/final | **Pendiente del benchmark fresco**. ×1000 sólo donde se mida y únicamente del motor. No transferirlo al navegador, proveedor, revisión humana o pipeline completo. |

Los planes se refrescan antes de observar resultados con `.local/refresh-measurement-plans.mjs`, que exige ambos gates completos e incrusta sus pruebas en `reports/measurement-freeze-current.json`. Los runners preparados y sus SHA deben archivarse antes de sus outcomes. El GO de una campaña no autoriza cambios de fuente durante su ejecución ni otros pagos concurrentes.

## 3. Escenarios: qué existe y qué falta demostrar

La auditoría histórica se usa como índice de rutas, no como prueba de que una función nueva siga faltando. S07 y S14 ya tienen mecanismo literal, fixtures físicos y recorrido UI en el gate §1. La tabla distingue evidencia de mecanismo de comparación causal/estadística.

| Escenario | Evidencia actual representativa | Pendiente para el claim completo |
|---|---|---|
| S01 · agua/regreso vacío | `empty-return-window.test.mjs`, calendarios físicos de vehículo | Trazar alternativas tardías/parciales y recibos reales en el caso elegido; no afirmar ventaja del modelo sólo por la factibilidad del regreso. |
| S02 · refugio compuesto | `service-composition`, `delegated-assessment`, `mixed-staff-physical` | Servicio sostenido y aportes exactos en nueva campaña; aislar coordinación de simple aumento de recursos. |
| S03 · planta/generador | `activation-assessment` y composición del motor | Enlace plataforma → producción real → agua efectivamente utilizada, con incompatibilidad/fracaso/recuperación. La seguridad de activación aislada no prueba ese final. |
| S04 · video antiguo | `route-context`, `casework`, `media-availability` | Preservar necesidad vigente y evidencia contradictoria; no premiar un descarte falso. Los vídeos descriptivos del simulador no prueban visión real. |
| S05 · incendio/acceso cambiante | `blocked-physical-integration`, tareas del motor | Cambio recibido → orden autorizada efectiva → misma evacuación/carga; distinguir fuego del escenario de reparación de ruta si la prueba sólo cubre éste. |
| S06 · réplica | `physical-recovery`, `activation-assessment`; K14 previsto | Comparación fresca y recuperación parcial de dependencias afectadas, sin borrar servicio útil anterior. |
| S07 · comunidad silenciosa | `coverage-physical`, directorio/contactos, UI de cobertura | Mecanismo literal **cubierto**; cobertura/demora por grupo siguen requiriendo outcomes del control silencioso. |
| S08 · duplicados | `source-attention`, `source-relevance`, `extraction` | Denominador de necesidades, falsas fusiones y decisiones/servicio, además del conteo de reposts. |
| S09 · recursos compartidos | `allocation-concurrency`, `assessment-allocation-holds`, composición | Carga acoplada 100 con todos los no atendidos y recursos finitos; nadie hereda capacidad adicional para ganar. |
| S10 · reserva disputada | `network-ownership`, `reservation-source` | Conflicto/vencimiento/recuperación y recibo de propietario; una prueba de denegación no acredita eficiencia global. |
| S11 · socio revoca | `network-recovery`, `physical-recovery`, `driver-availability`; K14 previsto | Costes irreversibles, acuerdos conservados y nuevo servicio; no sólo acción rechazada. |
| S12 · orden no llega | `poll-clock`, `network-transport`, driver físico | Viaje real y momento de la orden efectivamente recibida; retry no duplica trabajo ni fabrica demora por CPU. |
| S13 · ráfaga reconectada | `ingestion-batch`, `source-receipt-recovery`, batch del motor | Recovery burst nuevo: vigencia, pendientes, revisiones finitas y servicio; mensajes almacenados no son demandas entendidas. |
| S14 · falta equipo de descarga | `unloading.test.mjs`, `unloading-crew`, UI descarga | Mecanismo literal **cubierto**: crew propio real, aprobación receptora, finite work, misma entrega; incluye flota bloqueada/retorno real y negativos. Comparación de rapidez aún separada. |
| S15 · falta/exceso por tipo | `response-receipts`, `recurrent-policy`, `evacuation-progress-receipts` | Déficit y exceso por tipo/horizonte en nuevos resultados, sin mezclar litros, comidas, mantas y plazas. |
| S16 · autoridad falsa | `account-scope`, `network-ownership`, `investigation-safety` | Relacionar intentos/denegaciones/coste con las acciones realmente ejecutadas; cero violaciones de una suite no es garantía universal. |
| S17 · caída/almacenamiento | `process-crash-recovery`, `storage-full`, `connector-retry`, `continuation-recovery` | Recovery nuevo bajo carga con pendientes preservados. RPO/RTO técnico local no equivale a recuperación de una organización externa. |
| S18 · inviabilidad | `investigation-safety`, `investigation-tool-guidance`, regreso vacío; K14 previsto | Abstención/ayuda parcial/coste de preguntar en todas las corridas nuevas, conservando resultados desfavorables. |
| S19 · red y socio sin NEXO | Composición/delegación; `external-gateway.test.mjs` físico firmado | Distributed/delayed B5/B6/B7 fresco. El gateway de socio sin workspace tiene su fixture real separado; no atribuirlo a un episodio que sólo haya usado cuatro instancias. |
| S20 · compra parcial | `finance-purchases`, `purchase-receipts`, `purchase-partial`, UI finanzas | Mecanismo local **cubierto**: conversión humana explícita, gasto una vez, recibido 6/10→10/10 y público revisado. No banco/pago real ni donación = entrega. |
| S21 · API/borrados/esquema | `integrations`, `integration-continuation`, `retention`, `media-availability` | Estado de cobertura/cursor y recuperación actual, sin convertir un error externo en cero necesidades. |
| S22 · ambigüedad | `extraction`, `intake-moderation`, `investigation-safety` | Fixture semántico puntuado vigente y errores por idioma/unidad/lugar; transferencia externa independiente permanece abierta. |
| S23 · convencional suficiente | `received-allocation`, referencia B9, `response-comparison`; controles gratuitos/formales | Conservar cero ganancia y sobrecoste si ocurren. K07 S23 no sustituye el contraste de planificación convencional. |

En cada fila, identificar versiones favorable, adversa e inviable de la capacidad anunciada. Donde sólo exista una regresión parcial, marcar ese alcance. La lista de tests verdes no acredita una mejora temporal por sí sola.

## 4. Presupuesto, errores y coste desconocido

Valores predeclarados de los planes preparados; **no son permiso nuevo para lanzar**, gasto observado ni presupuesto total del proyecto. Un cambio exige amendment antes de resultados. Una corrida fallida no habilita ampliar el cap para buscar una respuesta favorable.

| Estudio | Episodios pagados previstos | Cap por episodio | Exposición máxima de esos episodios |
|---|---:|---:|---:|
| Original primario B6 (3 semillas) | 3 | $0.15 | $0.45 |
| Original sensibilidades B6 | 6 | $0.15 | $0.90 |
| Información 24/768, primario B6 | 3 | $0.20 | $0.60 |
| Información, sensibilidades B6 | 5 | $0.20 | $1.00 |
| B9 general, reutilizando B6 exacto ya cerrado | 1 | $0.15 | $0.15 |
| S19 distributed/delayed B6+B7 | 4 | $0.15 | $0.60 |
| K07, dos pares | 4 | $0.10 | $0.40 |
| K14, tres pares | 6 | $0.10 | $0.60 |
| K18, dos mapas internos B6 | 2 | $0.15 | $0.30 |
| K22 recovery nominal/burst real | 2 | $0.15/$0.20 | $0.35 |
| 100 necesidades, real | 1 | $0.30, máximo 64 llamadas | $0.30 |

La suma de esta exposición de episodios es **$5.65**, condicionada a ejecutar exactamente estos planes; no cuenta históricos, experimentos diferentes, herramientas, infraestructura o tiempo humano. Los caps de campaña pueden reservar margen superior sin gastar ese margen. Si el B6 no es elegible para reutilización, el plan B9 debe registrar el cambio/paro, no cobrarlo ocultamente dos veces ni sustituirlo por otra semilla.

Registrar todos los mundos declarados, parámetros, tres huellas inicial/final, proveedor/modelo, tokens, wall HTTP, errores, estado terminal, censoring y reservas. `costUsd:null`/calls desconocidas no significan cero. Un proceso interrumpido sin recibo final conserva la reserva del cap. El cierre de la campaña incluye incomplete/missing; la lectura no filtra únicamente episodios completados favorables.

## 5. Evidencia automática aún no cubierta completamente por los planes

1. **Margen individual/red con recursos iguales.** S19 prueba capacidad conjunta, pero sus brazos son B5/B6/B7 multiorganización. No compara por sí solo una instancia y la misma dotación total repartida en varias. Para un claim cuantitativo de multiplicación, añadir contraste predeclarado con idénticos recursos o limitarlo a mecanismo de cooperación demostrado.
2. **G07 completo, especialmente S03 y S05.** Localizar o producir evidencia gratuita de producción de planta realmente utilizada y de evacuación ante peligro recibido, más variantes adversas/inviables. No declarar vacío todo el producto por tener sólo evidencia parcial: falta la trazabilidad exacta para esos claims.
3. **K11/K13 con scoring local vigente.** El cierre de acknowledgements de recovery no es recall/precisión. `scripts/semantic-load.mjs` tiene fixture sintético puntuado útil, pero requiere gate de huellas finales y separar ese resultado de anotación independiente/K12. Si no se mide de nuevo, no anunciar metas de exactitud cumplidas.
4. **Presupuestos de latencia §30.2 bajo carga declarada.** Falta vincular p95 UI no bloqueante <200 ms, comando durable <2 s, estado procesado visible <2 s e ingesta durable <5 s a una carga real de cuatro organizaciones/100 necesidades/10k publicaciones por hora. Un click de navegador exitoso, benchmark del motor o persistir filas no acredita esos cuatro presupuestos. Separar polling y proveedor del tiempo interno; preservar saturación.
5. **K27 completo.** El 100 acoplado cubre sólo cuatro owner stores en un proceso y necesidades de agua/comidas/mantas. La matriz 12/1000 puede verificarse como transporte/almacenamiento cuando hardware lo permita; no hay calidad generativa/servicio físico medida automáticamente en todas sus celdas. Informar el alcance medido y el punto de degradación; no inventar soporte.
6. **Campos realmente exportados.** En `runSourceRecovery`, K09 y el embudo K16 completo no están en el mismo export que en discovery/harness. El lector deja esos campos desconocidos. No hace falta otra inferencia para rellenarlos retrospectivamente; no inventar la medida ausente ni reutilizar un registro de otra fuente.

Estos puntos no autorizan tocar fuentes durante campañas. Primero cerrar los estudios ya acordados y analizar causalmente sus resultados; después decidir un cambio común o limitar el claim. Evitar añadir complejidad visual o cientos de inferencias que no resuelvan una brecha de evidencia.

## 6. Gates que esta fase no puede cerrar automáticamente

- Gemini y GCP: repetir con Gemini y desplegar después; esta fase usa Gemma y excluye cloud por petición expresa.
- K12/K19: anotación multimodal independiente y autorizada; la biblioteca sintética y Pillow real no sustituyen ese estudio.
- K18: los dos mapas internos son transferencia de geometría limitada, con los mismos idiomas/servicios/templates. No holdout estructural o lingüístico independiente.
- K20/K21/K23/K28: tiempo, errores y comprensión de operadores/público reales. Revisores scriptados finitos y teclado/móvil comprueban funcionamiento, no comprensión humana.
- K29: permisos, licencias, adopción/procedimientos y baseline revisado por responsables externos. Un conector IFRC GO de lectura no es una colaboración institucional.
- Pagos bancarios/retención externa: el puente sandbox local no mueve dinero real; tombstones locales no borran copias de proveedores, socios o backups externos.

La meta inmediata del autor es una mejora física sustancial honesta, sin porcentajes fijos nuevos. No convertir ese criterio en victoria garantizada, 100/100, vidas salvadas ni superioridad universal. El cierre técnico se conserva; los resultados comparativos y sus limitaciones siguen pendientes hasta analizar los artefactos frescos completos.
