# NEXO — Resultados, fallos conservados y alcance de la evidencia

12 de octubre de 2026. Leer junto a [ESTADO_IMPLEMENTACION.md](ESTADO_IMPLEMENTACION.md). Este documento describe pruebas ejecutadas, no los números inventados de la landing ni una garantía de clasificación en una competición.

## 1. Resumen que se puede defender

- Plataforma local real, con proveedor **Gemma 4 31B mediante OpenRouter**. No hubo Gemini ni despliegue GCP.
- **89/89 pruebas de plataforma y 117/117 del simulador**, cero fallos, omitidas o canceladas en la última verificación conjunta.
- **57 verificaciones de render/navegación** en 1440, 1920 y 390 píxeles; **12 recorridos operativos y seis de corrección/publicación**, sin errores de página u overflow en esas pruebas.
- **Cuatro formatos de entrada con bytes reales** procesados: imagen, audio, video y PDF, más una foto pública derivada y revisada. Los conectores JSON se prueban por separado. Es funcionamiento, no precisión sobre un corpus de campo.
- **Nueve perfiles de carga**: 1/4/12 organizaciones y 10/100/1.000 necesidades. La ingesta/persistencia funciona; no se midió inferencia semántica a esa escala.
- Un ensayo dirigido desde una necesidad de refugio, sin indicar instalación o solución, produjo **50 ocupantes** después de aportes y aprobaciones de cuatro propietarios. Los primeros intentos fallidos se conservan.
- La ventaja general de GenAI sobre referencias competentes **todavía no está demostrada**. Las comparaciones incluyen pérdidas, errores de presupuesto y campañas interrumpidas.

## 2. Procedencia y reproducción

Los reportes tienen fecha, huella del candidato, modelo, seed/manifiesto del mundo, configuración, costes y resultados. Los comparativos también tienen huella del evaluador. El fingerprint de contenido identifica el código probado aunque la ejecución empezara antes del commit que lo publica. No mezclar huellas diferentes como si fueran réplicas del mismo candidato.

La verificación conjunta se conserva en [verification-latest.json](../reports/verification-latest.json), con copia fechada en `reports/verifications/`. Su comando es `node scripts/verify.mjs`: chequea sintaxis/contratos y las dos suites. Los logs completos quedan en `.local/verification/`, fuera de Git; no hay llamadas pagadas en este comando.

Los recibos físicos/modelo se conservan en `reports/runs/`; las campañas en `reports/evaluations/<fecha-numérica>/`. Los archivos `*-latest.json` son accesos al resultado más reciente; las copias fechadas permiten examinar fallos anteriores. Un archivo con estado `failed` no se elimina ni se convierte en éxito porque parte de la ayuda haya llegado.

Para probarlo de nuevo, utilizar [LOCAL.md](LOCAL.md). Cambiar modelo, prompt, algoritmo, contrato físico o presupuesto exige una nueva evaluación; no copiar un porcentaje de la versión anterior.

## 3. Integridad y flujo operacional

Las suites comprueban aislamiento de organización/rol, CSRF, fuentes maliciosas, referencias verificables, concurrencia de reservas/stock, mínimos protegidos, idempotencia, TTL y versión de autorizaciones, delegación finita, ownership de socios, retirada y reparación, recibos físicos, reinicio y backups.

Las pruebas nuevas cubren:

1. Moderación antes de activar un reporte comunitario o analizar su medio; retry con identidad estable.
2. Corrección/agrupación reversible de evidencia, con historial y alcance por organización.
3. Foto pública derivada solo después de revisión humana y recibo de origen; eliminación de metadatos, original privado, corrección/retiro trazables.
4. Revocación de cuentas y exports que no cruzan organizaciones.
5. Política persistente que puede reducir límites sin aumentar los topes del servidor ni conceder despacho.
6. Recuperación consistente sin sesiones/credenciales de origen en el bundle; restore solo en destino nuevo y validación de hashes.
7. Rechazos físicos definitivos que detienen el paso y exigen nueva revisión, conservando trabajo recibido; no repetir indefinidamente un vehículo ocupado.
8. Elegibilidad de instalación: un edificio residencial seguro con cero plazas no puede activarse como refugio por un título convincente del modelo.
9. Comparaciones con presupuesto distinto que se rechazan explícitamente sin perder outcomes ni romper el reporte final.
10. Medios inexistentes/descriptivos/de otro propietario que no crean uploads ficticios ni gastan inferencia; bytes alterados que fallan integridad.

11. Un coordinador de investigación por incidente compartido, sin perder las cuatro instancias ni sus aprobaciones individuales.
12. Falta de crédito del proveedor que pausa nuevas llamadas sin falsear coste cero ni eliminar trabajo previo; la prueba usa una respuesta HTTP controlada, no un nuevo gasto real.

Las siete pruebas añadidas después de la recarga comprueban contexto relevante entre miles de registros, recuperación paginada y aislada, conservación de mínimos/compatibilidad/descripciones/refutaciones, índices de asignación, contratos personalizados bajo demanda con validación estricta, espacio de salida/razonamiento privado y diagnóstico de timeout con coste desconocido reservado. La configuración de coste y contexto está documentada en [CONTEXTO_MODELO.md](CONTEXTO_MODELO.md).

La revisión siguiente añade seis regresiones sobre stock/flota con IDs repetidos entre propietarios, proyecciones consentidas y vigentes, retirada/cambio de versión, referencias reales de ofertas, condiciones de aprobación existentes y entrega física tras revisión independiente. Su replay comprueba el mecanismo; no se cuenta como inferencia real ni mejora del modelo.

El motor acumula plazas·hora **ocupadas**, no horas de apertura de un refugio vacío. Integra consumo fraccional sin redondear cada minuto hacia arriba, detiene acumulación al cerrar y conserva efectos físicos del tiempo. La aritmética no certifica necesidades sanitarias reales.

## 4. Proveedor y multimodalidad

[provider-smoke.json](../reports/provider-smoke.json) registra la disponibilidad/configuración del modelo; [media-byte-smoke.json](../reports/media-byte-smoke.json) registra cuatro entradas y una derivación pública. Imágenes y fotogramas usan inferencia real; audio usa ASR local; PDF usa extracción/render/transcripción y conserva originales. HTTP/JSON se comprueba con conectores, contratos e ingesta por separado.

El smoke anterior completó dos llamadas visuales con coste recibido de **USD 0,0018055**. Su primer intento encontró un fallo al serializar el reporte después de procesar medios; se corrigió el serializer y se repitió. La repetición con PDF escaneado, guardada en [media-byte-1791776581764.json](../reports/runs/media-byte-1791776581764.json), completó tres llamadas visuales, **USD 0,00155219**, y convirtió el texto de la página en una señal privada no verificada. El número de formatos de entrada no incluye la imagen pública derivada como una nueva modalidad. No se usa ese smoke como una medida de recall, lectura completa de videos o comprensión bajo ruido.

No se ha suministrado un corpus independiente permitido de desastres. Los videos del simulador son objetos descriptivos; no cuentan como percepción. El recorrido posterior renderiza PDFs escaneados con PDFium y pide transcripción visual al modelo: hasta cuatro páginas escaneadas por análisis, con texto embebido separado, pendientes explícitos y revisión humana. El smoke posterior incluye un PDF de imagen sin capa de texto. Los formatos, segmentos o páginas no observados conservan esa limitación.

Después de la recarga, el smoke [media-byte-1791796512126.json](../reports/runs/media-byte-1791796512126.json) conservó una transcripción de audio positiva y un timeout visual con coste desconocido, sin etiquetar el conjunto como éxito. La repetición con perfil de percepción separado de investigación, [media-byte-1791797444466.json](../reports/runs/media-byte-1791797444466.json), procesó los cuatro formatos: tres llamadas visuales reales por **USD 0,00052922**, más ASR local y derivación pública revisada. La huella es `611d328…`; la precisión independiente sigue pendiente.

La versión actual `c59fc605…` repitió el recorrido completo en [media-byte-1791799152025.json](../reports/runs/media-byte-1791799152025.json): cuatro formatos procesados, tres llamadas visuales por **USD 0,00052162**, ASR local y derivación pública revisada. Tampoco constituye un corpus de precisión.

## 5. Composición de refugio: positivo y negativos

Ensayo con selección de instalación, versión anterior: `service-live-1791769227292.json`. Cinco llamadas reales, USD 0,03361985, cuatro propietarios, 50 personas evacuadas/alojadas y seguimiento posterior. Demuestra ejecución para una instalación elegida por el operador; no elección autónoma del sitio.

Ensayo sin foco: `service-live-1791773661660.json`. Tres llamadas, USD 0,01890582. El modelo eligió una asignación de agua; **no abrió el refugio**. No se etiqueta como éxito de composición.

Primer ensayo seleccionando solo necesidad: `service-live-1791773816509.json`. Cuatro llamadas, USD 0,0249717. El modelo trató el edificio de la necesidad como instalación, con cero capacidad útil. No hubo ocupantes. Este fallo originó una corrección: directorio de candidatos recibido y validación de elegibilidad en plataforma y sistema físico.

Ensayo posterior: [service-live-1791774820679.json](../reports/runs/service-live-1791774820679.json). El operador selecciona una necesidad recibida de refugio, **sin darle al modelo instalación ni solución**. Cinco llamadas reales, USD 0,0340366, 50 ocupantes y **22,4254 plazas·hora** acumuladas hasta el horizonte del episodio, con diez minutos de seguimiento tras la fase de ejecución. Cero violaciones de invariantes; candidate sin cambios durante el ensayo.

Esta mejora entre versiones es una prueba dirigida de regresión/funcionamiento. No es un ensayo emparejado de eficacia, un holdout ni demostración de que el modelo descubrirá composiciones desconocidas en cualquier desastre. Las herramientas contienen recetas acotadas de refugio/planta; no se afirma síntesis arbitraria de infraestructura.

Con el contexto enfocado y el techo de tarifa, [service-live-1791797909175.json](../reports/runs/service-live-1791797909175.json), huella `611d328…`, volvió a obtener **50 ocupantes**, con siete llamadas reales, **USD 0,00806514** y unos 38,78 segundos de pared para todo el ensayo dirigido modelado. No implica 38,78 segundos de respuesta de terreno: las demoras físicas siguen el reloj declarado del laboratorio y el propietario es un proxy programado. La necesidad de agua independiente quedó sin resolver en este ensayo de refugio. No es un antes/después causal de ahorro frente al recibo anterior.

El recibo de la versión actual es [service-live-1791799154381.json](../reports/runs/service-live-1791799154381.json): **50 ocupantes, 22,4143 plazas·hora, seis llamadas, USD 0,00692284** y cero violaciones. El candidato permaneció congelado. El mundo avanzó unos 77,88 minutos modelados; los 37,15 segundos de pared incluyen trabajo acelerado del laboratorio y no son tiempo de rescate real. Se mantuvieron pendientes los 600 L de la necesidad de agua independiente. Esta composición dirigida por la necesidad no cierra la selección autónoma de prioridades de una emergencia completa.

## 6. Tiempo real ×1

`pnpm demo:live` ejecuta fuente HTTP, modelo real, aprobación del proxy identificado, carga/viaje/descarga y recibos con el mundo avanzando a ×1. Se reportan reloj físico y latencia de proveedor; no se multiplica inferencia por ×1000.

Ensayo anterior positivo: [live-response-1791771412685.json](../reports/runs/live-response-1791771412685.json). Dos llamadas reales, USD 0,01344325; alrededor de 254 segundos simulados y 256 segundos de pared; dos entregas que suman **500 L de 600 L necesarios**. Los 100 L pendientes permanecen como faltante. No prueba una mejora temporal frente a una referencia ni atención total.

También se conservan los intentos previos de quota/ventana insuficiente en `reports/runs/`. No contar una llegada sin recibo como entrega. El último ensayo de la versión actual se identifica en [live-response-latest.json](../reports/live-response-latest.json), cuya copia fechada es la evidencia a utilizar si se presenta esta versión.

La repetición en el build corregido es [live-response-1791774948996.json](../reports/runs/live-response-1791774948996.json): **257,32 segundos de pared, 255,233 segundos simulados, dos llamadas y USD 0,00551945**. Confirmó 500 de 600 L, sin exceso ni violaciones; mantuvo 100 L pendientes. No hubo cambios de candidato durante el episodio.

La repetición después de la recarga, [live-response-1791797905296.json](../reports/runs/live-response-1791797905296.json), huella `611d328…`, registra aproximadamente **265 segundos de pared, dos llamadas reales y USD 0,0018668**. El estado físico confirma 500 L y deja 100 L pendientes. Es una ejecución ×1, diferente de los comparativos modelados y del replay de regresión.

El recorrido ×1 del candidato actual está en [live-response-1791799152429.json](../reports/runs/live-response-1791799152429.json): **265,685 segundos de pared / 263,429 segundos del mundo, dos llamadas y USD 0,001835**. Entregó 500/600 L desde una instancia, conservó 100 L pendientes y no registró violaciones ni cambio de candidato. La colaboración de cuatro instancias y su cobertura completa pertenecen a otros episodios; no se trasladan a esta prueba aislada.

## 7. UI, privacidad y comprensión

[ui-verification.json](../reports/ui-verification.json) contiene 57 checks; [ui-journeys.json](../reports/ui-journeys.json), 12; [ui-review-journeys.json](../reports/ui-review-journeys.json), seis. Cubren pantallas por rol, teclado/móvil, cola offline, conflicto de versión, reintentos, moderación, foto pública, corrección y retirada.

El recorrido de foto pública utiliza un recibo sintético explícito para probar la UI; **no es evidencia de una entrega física**. La prueba de recepción física pertenece a otros episodios. La revisión de privacidad es humana; quitar metadatos no garantiza anonimizar personas visibles.

Estos tests no prueban minutos ahorrados, comprensión ≥90%, confianza del público ni accesibilidad certificada. Faltan ejercicios con personas independientes y condiciones de uso reales.

## 8. Carga y límites

[load-latest.json](../reports/load-latest.json) contiene hardware, huella y los nueve perfiles. El mayor —12 organizaciones y 1.000 necesidades— tardó aproximadamente **765 segundos** y alcanzó alrededor de **3,1 GB de RSS** en el proceso de prueba. Recibió/persistió **1.564 de 1.564 señales por organización** en ese perfil, sin inferencia ni violaciones de invariantes.

No equivale a resolver 12.000 necesidades ni interpretar cada publicación. El sistema usa contexto acotado, intake de hasta 35 señales/grupo y tres grupos por batch, cuotas y backpressure. La escala semántica y la calidad bajo carga aún deben medirse. ×1000 solicitado es control de reloj, no garantía de throughput físico ×1000 con todas las herramientas.

El benchmark del motor anterior conserva su hardware/build y alcance en `disaster-response-simulator/docs/PERFORMANCE.md`. No atribuir rendimiento headless del motor a toda la plataforma.

## 9. Comparaciones y campañas incompletas

Los brazos son B1 reglas; B2 extracción real seguida por planificador; B3 investigador general con mismo modelo/herramientas; B4 NEXO aislado; B5 coordinación compartida convencional; B6 NEXO en red. El recurso físico y el mundo siguen existiendo en todos los brazos. Se compara K01 por unidad nativa, no un score combinado de litros/plazas.

En campañas antiguas, el presupuesto de inferencia de la red se dividía en cuartos. En las posteriores se comparte un solo cap total de dinero y llamadas entre propietarios. No mezclar esos evaluadores. Los límites locales por organización siguen siendo obligatorios.

Registro de fallos conservados:

- `1791770328001`: diez de 24 episodios, 14 faltantes; bug de snapshot/ingesta. Coste conocido USD 0,0920594.
- `1791773011769`: cinco de 48; detenido después de finalizar el episodio con repetición de rechazos `VEHICLE_BUSY`. Su B5 atendió 600 L, pero acumuló 228 errores y unos 402 segundos de pared. Se corrigió la revisión/reintento y se añadió una regresión: el nuevo caso termina en unos 26 segundos sin esa repetición. No vender ese cambio como mejora humanitaria.
- `1791773644230`: 40 de 48, ocho faltantes; coste USD 1,28876127. La campaña redujo el budget del último episodio a USD 0,23973783 frente a USD 0,25 de su par. El comparador rechazó esa configuración. Se preservó el summary previo, se recuperó desde los outcomes intactos y se marcan los contrastes no comparables sin mejora asignada.

El runner corregido no reduce un cap para completar artificialmente la campaña: termina y conserva faltantes si no puede financiar otro episodio con el cap preregistrado. El summary nunca pierde outcomes porque una comparación sea inválida.

`scripts/compare-campaign.mjs reports/evaluations/<run>` genera `contrasts.json`. Resalta B4/B3 y B6/B5, además de la ganancia convencional de compartir. Conserva resultados negativos y presupuesto, sin presentar un bootstrap de dos mundos como evidencia confirmatoria.

La campaña `1791774855620` completó los 48 episodios, con coste conocido USD 1,47281355 y cero violaciones físicas. La variante B6 dejaba investigar el mismo caso a las cuatro instancias; consumió su cap compartido en comprobaciones repetidas y registra fallos, aunque en algún episodio llegó ayuda. Una entrega parcial no borra un fallo de planificación. Los resultados no establecen una ventaja general del LLM.

La siguiente versión asigna un coordinador de investigación a cada incidente compartido, tanto en B5 como en B6. Los socios siguen usando bases, recursos, autoridad y recibos independientes. Es una política de despliegue explícita para este experimento, no una elección distribuida de líder ni una solución universal a duplicación de casos. Los dos protocolos no se combinan como réplicas. La prueba de regresión conserva cuatro instancias y exige dos investigaciones del coordinador en dos rondas, en lugar de ocho investigaciones duplicadas.

La campaña posterior, [1791776579865](../reports/evaluations/1791776579865/summary.json), conserva **12 de 48 episodios**, cuatro con fallos, **36 pendientes**, USD 0,17714365 de coste conocido y siete intentos con coste desconocido conservadoramente reservado. Se detuvo después de respuestas HTTP 402 y un chequeo de cuenta de solo lectura que confirmó falta de saldo; el summary previo y los outcomes se conservaron intactos. No se imputan resultados a los mundos que faltan.

En el primer mundo S19 de ese protocolo, B6 investigó sin instalación predeterminada, coordinó cuatro propietarios y alojó 50 personas; B5 también alojó 50. B6 acumuló 120.036.590 plazas·ms de déficit frente a 199.956.130 de B5 en ese episodio, aproximadamente **40% menos**. Es un resultado de un solo mundo de desarrollo, dentro de una campaña incompleta; **no es una ventaja general acreditada ni un intervalo confirmatorio**. La segunda seed B6 quedó afectada por el rechazo del proveedor y registra cero atención, sin ser eliminada del contraste.

La repetición dirigida `service-live-1791776847917.json` también quedó sin proveedor durante la búsqueda: dos intentos, USD 0,0114431 conocido, sin propuesta ni ocupación. Se conserva junto a los positivos anteriores. El backend posterior pausa la inferencia de esa instancia ante HTTP 402 y el runner detiene la campaña: no fabricar nuevas respuestas ni repetir llamadas en cada caso mientras falte saldo. El operador restaura crédito y reinicia el backend para volver a probar. Trabajos/recibos y acciones manuales permanecen disponibles.

### 9.1 Recarga, contexto útil y campaña completa

El primer piloto posterior, [1791795781278](../reports/evaluations/1791795781278/summary.json), se detuvo en un checkpoint de nueve outcomes, con 39 faltantes y **USD 0,03311543** conocido. Se encontraron timeouts reales bajo el plazo anterior de 60 segundos y campos relevantes que faltaban en el contexto inicial. El summary previo y los outcomes se preservaron; no se mezclan sus réplicas con la revisión siguiente.

La campaña [1791797597750](../reports/evaluations/1791797597750/summary.json), huella `611d328…`, completó **48/48 episodios**, cuatro escenarios, dos mundos por escenario y seis brazos. Registró **222 llamadas, USD 0,3153094, cero intentos de coste desconocido y cero violaciones físicas**. Todos los episodios terminaron, lo que no significa que todas las necesidades fueran atendidas. El ejecutor usó tres mundos aislados en paralelo; los brazos dentro de un mundo fueron secuenciales. El reloj principal es modelado; CPU compartida y colas del proveedor impiden usar esa campaña como benchmark de tiempo real industrial.

Resultados que deben acompañar cualquier positivo:

| Contraste | Resultado exploratorio de esa versión |
|---|---|
| S19, refugio, B6 vs B5 | Ambos alojaron 50 personas en cada mundo. Déficit medio: 55,77 frente a 34,81 plazas·hora; **37,59% menos** en B6. No demuestra ventaja general ni supervivencia. |
| S19, agua, B6 vs B5 | Ambos atendieron cero agua en su política de composición de refugio. Ninguna mejora en esa necesidad. |
| S01/S23, agua, B6 vs B5 | B6 atendió 500/600 L y B5, 600/600 L; B6 perdió en cobertura y déficit acumulado. |
| S19, agua, B4 vs B3 | B4 atendió 500 L en un mundo y 300 L en otro; B3, 500 L en ambos. El déficit medio de B4 fue **85,64% mayor**. No ocultar esta pérdida. |
| S09, carga heterogénea | No se resolvieron las demandas adicionales de alimento/refugio/mantas/rescate; el piloto no acreditó escala semántica ni solución masiva. |

[contrasts.json](../reports/evaluations/1791797597750/contrasts.json) conserva todos los contrastes por unidad nativa. Dos mundos por escenario son un piloto de desarrollo: repetir miles de eventos no aumenta ese tamaño muestral.

La traza de agua permitió diagnosticar un defecto del producto: `plan_allocations` solo compilaba stock propio, aunque el modelo veía ofertas de socios. Para completar los 100 L, el modelo intentó una propuesta personalizada con un ID de aprobación inventado y quedó pendiente. El commit `3b2aa2a` incluye proyecciones actuales consentidas en el mismo compilador, copia referencias de oferta exactas, vuelve a comprobar vigencia/versiones antes de preparar y rechaza condiciones de aprobación sin propuesta existente. Cada propietario sigue autorizando y validando sus pasos. Esto es una **corrección de ingeniería**, no evidencia independiente del poder del LLM. La nueva campaña se declara por separado y vuelve a ejecutar las referencias afectadas.

La verificación [1791798901091.json](../reports/verifications/1791798901091.json), huella `c59fc605…`, pasa las 206 pruebas conjuntas sin omitidas, canceladas o cambios del candidato. Durante una prueba de desarrollo anterior se editó el contrato de herramientas: el guard detectó el cambio y rechazó ese resultado como `invalid_candidate_changed`. La repetición congelada pasó; no se presenta la ejecución invalidada como evidencia favorable.

### 9.2 Versión actual: colaboración ejecutable y selección todavía insuficiente

[1791798902847](../reports/evaluations/1791798902847/summary.json) repite tres escenarios, dos mundos por escenario y los cuatro brazos B3/B4/B5/B6 afectados por el cambio, con el mismo cap por episodio de USD 0,25, dos oportunidades programadas, proveedor y herramientas. Huella `c59fc605…`; **24/24 outcomes conservados, 22 completados y dos fallidos**, 145 llamadas, **USD 0,19191844 conocido / USD 0,20702046 cargado al presupuesto con reservas desconocidas**. Las dos respuestas de proveedor sin estructura válida (`PROVIDER_SCHEMA`) permanecen en S19 B3 y B4: no se fabricó mensaje ni se reasignó coste cero. Cero violaciones físicas.

| Pregunta | Resultado actual del piloto |
|---|---|
| ¿La red puede ejecutar ayuda combinada? | En S01 y S23, B6 entregó 600/600 L en ambos mundos; B5 también. En B4 aislado llegaron 500/600 L. Las trazas de B6 registran revisión independiente y recibos. |
| ¿Ese resultado es una ventaja del LLM frente a una red competente? | No. En S01/S23 el déficit de B6 fue 150,37 L·hora frente a 145,37 L·hora de B5, **3,44% mayor**: misma cobertura final con demora adicional de inferencia. Compartir capacidad explica la cobertura, no un logro exclusivo de GenAI. |
| ¿NEXO gana al investigador con el mismo modelo? | En S01 B4 reduce el déficit 67,48%, pero la comparación depende de un mundo en que B3 atendió cero; son dos mundos de desarrollo. En S23 empatan y en S19 agua la diferencia es 0,027%, con un fallo de proveedor en cada brazo. No acredita generalidad. |
| ¿La nueva asignación conserva el positivo de refugio anterior? | No en el ensayo sin foco. En S19 B6 priorizó agua (600 L en un mundo, 300 L en otro) y alojó cero; B5 alojó 50 en ambos y atendió cero agua. Es una competencia entre necesidades, no un resultado que se pueda sumar en unidades incompatibles. El déficit de refugio de B6 fue 200 frente a 55,37 plazas·hora. |
| ¿La composición funciona cuando el operador selecciona la necesidad? | Sí, el ensayo dirigido actual alojó 50 personas sin indicar instalación ni solución. Esto no equivale a descubrir y priorizar todos los casos automáticamente. |

Todos los contrastes están en [contrasts.json](../reports/evaluations/1791798902847/contrasts.json). No combinar las dos huellas como réplicas ni presentar el 37,59% de refugio de la versión anterior como rendimiento del candidato actual. Dos semillas tampoco acreditan variación estructural suficiente: muchas cantidades y restricciones de estos presets son idénticas entre mundos. Hace falta ampliar familias/perturbaciones y sellar un conjunto externo.

**Puerta técnica aún abierta:** seleccionar prioridades y oportunidades de investigación ante necesidades heterogéneas con recursos compartidos, conservar capacidad para dependencias de servicios, evitar que una respuesta parcial monopolice los vehículos y reparar decisiones cuando cambia la situación. Verificarlo con más oportunidades de planificación y políticas de referencia igualmente recurrentes, límites de atención/coste comunes y pérdidas por cada recurso/comunidad. Las prioridades deben provenir de una política revisada y del operador; no ajustar pesos después de ver un resultado ni inventar una equivalencia clínica de litros a camas para declarar victoria.

## 10. Recuperación y operación

`tests/backup.test.mjs` conserva SQL, IDs de comandos, jobs pendientes, finanzas, auditoría y archivos privados/derivados con checksum. No exporta sesiones ni claves de origen/modelo. Rechaza destino ya existente, bundle alterado y restauración sobre la instancia activa.

El RTO pequeño bajo cinco minutos cubre un fixture local, no una base industrial completa ni pérdida de toda la infraestructura. El launcher crea una sesión nueva al reiniciar un mundo y conserva DBs antiguas. Una recuperación operativa retoma la misma fuente/identidad; no lanzar dos copias activas que ejecuten los mismos compromisos.

## 11. Lo que ninguna simulación propia puede cerrar por sí sola

Independencia del corpus/holdout, competencia de B0/B1–B6, precisión multimodal real, comprensión/tiempo humano, validez de parámetros clínicos, adopción institucional, permisos de redes reales y confianza del público necesitan evidencia externa. [VALIDACION_EXTERNA.md](VALIDACION_EXTERNA.md) define cómo obtenerla.

Gemma puede producir una mejora o una pérdida. Cambiar a Gemini obliga a repetir y no garantiza corregir las pérdidas. No se acredita supervivencia, vidas salvadas, despliegue de campo, top 1 ni 100/100 mediante un simulador propio o una presentación.

## 12. Cierre local: pruebas estables del candidato — 12 de octubre de 2026

El candidato de esta fase tiene huella `27a5b6437385b528870809d8a3d080ca5a3e010fe60b7e69b48ea657ee10b94f` y commits de plataforma hasta `a99bf8f`; el simulador está en `6c75ae5`. La huella del evaluador para estas ejecuciones es `0ad639ae5bf32d0e5dbc9c209425c77dc952d876de7b856299de913b95e5c717`. Los documentos y reportes no alteran la huella del candidato. GCP está excluido y el modelo configurado es Gemma 4 31B/OpenRouter. Consultar [CIERRE_LOCAL.md](CIERRE_LOCAL.md) para cada mecanismo.

| Prueba | Resultado medido | Artefacto y límite |
|---|---|---|
| Verificación completa | 116 pruebas de plataforma + 120 del simulador, sin fallo, huella estable | [Reporte](../reports/verifications/1791810895999.json); prueba local de mecanismos/invariantes, no certificación clínica/industrial. |
| Navegador | 57 checks de escritorio/móvil + 12 recorridos interactivos + 6 de evidencia/público/admin + 5 de respuesta/retención | [UI](../reports/ui-verification.json), [recorridos](../reports/ui-journeys.json), [revisión](../reports/ui-review-journeys.json), [respuesta](../reports/ui-response-journeys.json); automatización, no comprensión de personas. |
| Observador 3D | Canvas WebGL de 1920×702, cambio de organización y panel de medidas, sin errores JS | [Reporte](../reports/observer-ui.json); screenshot inspeccionado localmente, sin extrapolar fidelidad operativa de la imagen. |
| C1 desde una necesidad | 50 personas ocupan el refugio, 22,37 plazas·hora, cinco llamadas, USD 0,006189 y cero violaciones | [Ejecución](../reports/runs/service-live-1791811631830.json); necesidad seleccionada, sin ID de instalación/solución. Catálogo finito; no descubrimiento universal. |
| Reparación física | 4/4 tratamientos completados: mismos 300 L cargados y misma operación resueltos; cero violaciones | [Ablación](../reports/ablations/repair-1791811333136/summary.json); dos seeds, cuatro ejecuciones, USD 0,017433. |
| Episodio ×1 | 500/600 L recibidos, 100 L pendientes, 367 s reales/366 s del mundo, cuatro llamadas, USD 0,007200, cero violaciones | [Ejecución](../reports/runs/live-response-1791811661272.json); reloj real, revisión programada, entrega parcial y plazo incumplido incluidos. No claim de respuesta en milisegundos. |
| Interpretación semántica | Cada una de cuatro organizaciones recuperó las 100 necesidades objetivo; precisión y recall 1,0 en el corpus interno; 40 llamadas, USD 0,026134 y huella estable | [Reporte](../reports/semantic/semantic-load-1791811089756.json); 3.444 publicaciones al final, idiomas, republicaciones, archivo e inyección. Gold del evaluador separado. No precisión sobre redes/fotos reales ni 100 entregas/min. |
| Bytes reales | Audio, imagen, video muestreado y PDF, más derivado visual público revisado | [Reporte](../reports/runs/media-byte-1791812083731.json); fixtures internos permitidos, no dataset multimodal independiente. |
| PDF escaneado largo | 23 páginas recorridas mediante continuación, seis llamadas, USD 0,001537, huella estable | [Reporte](../reports/runs/pdf-bytes-1791812095305.json); procedencia y pendientes por lote, no exactitud OCR certificada. |
| Transporte/UX nominal | 1.000 publicaciones emitidas en bursts finitos, 3.200 versiones durables observadas, cero pérdidas entre publicaciones medidas, cero violaciones | [Reporte](../reports/flow/nominal-flow-1791810599616.json); equivalencia de llegada 10.000/h, cuatro workers concurrentes en un host con cuatro bases embebidas en el mismo proceso. El polling se informa aparte. |

El probe nominal registró p95 de disponibilidad a persistencia **7.877 ms**, frente al objetivo de 5.000 ms: **no cumplido** en esa topología/hardware. Comando durable 9,85 ms, navegación a contenido visible 101,24 ms y filtro a dos frames 33,5 ms sí cumplen sus objetivos locales. No extrapolar esos tres éxitos a inferencia, plataforma industrial ni comprensión humana. Las versiones durables no equivalen a comprensión: esa se puntúa en el ensayo semántico separado.

En repair, refresco completo usó ocho consultas frente a cuatro en selectivo. Los drafts modelados fueron 38.004/53.004 ms frente a 45.000/45.000 ms: la mejora de tiempo del 30% (K07) **no está demostrada**. Una seed perdió tiempo y coste; otra mejoró. Se conservan las latencias reales 18,2/157,4 s frente a 29,7/39,5 s, que tampoco acreditan robustez con dos seeds. La conservación física es un resultado diferente de la ventaja de rendimiento.

### 12.1 Fallos anteriores conservados

Los ensayos interrumpidos por cambios de código en `1791804389075`, `1791805164090`, `1791807577489` y `1791808563331` se conservan en reports/evaluations/. La verificación `1791809841431` pasó 114+120 tests, pero cambió el candidato durante ella: su gate global es falso. No usarla como verificación estable de esta versión.

Los probes de flujo previos registraron latencias superiores al objetivo y resets de transporte. La recuperación acotada corrige el corte funcional; no se borra el resultado de rendimiento ni se convierte automáticamente en un p95 menor de 5 s. La ablación de reparación anterior que llegó otro camión mientras quedaba bloqueada la carga original se mantiene como regresión: no fue una reparación válida.

### 12.2 Referencias defectuosas y recuperación diagnóstica

La campaña estructural inicial [protocol](../reports/evaluations/1791811091548/protocol.json) conserva cuatro outcomes y una interrupción no clasificada. Una repetición independiente del caso distribuido terminó, pero no se reemplaza silenciosamente la ejecución fallida por ese éxito. La continuación registra la reserva conservadora de coste desconocido del abort y su alcance diagnóstico.

La referencia convencional de aquella variante abortó con FACILITY al no tener evaluación recibida del sitio; una referencia competente debe conservarlo pendiente y seguir preparando ayuda factible. La ablación de consulta [informe inicial](../reports/ablations/inquiry-1791811331183/summary.json) completó 12 outcomes, pero broad_refresh omitía el org requerido en la consulta capabilities y falló con NOT_FOUND. **Sus mejoras numéricas frente a ese error no prueban utilidad marginal de GenAI.** La corrección y repetición del evaluador se documentan separadamente cuando concluyan.

Los contrastes finales tienen que conservar pérdidas, inconclusos, timeouts, coste desconocido y referencias con debilidades. La regla del producto es preparar ayuda verificable, no elegir un subconjunto de gráficos favorables. Los gates estadísticos, independientes y humanos permanecen separados de los mecanismos implementados.
