# NEXO — Contexto útil, razonamiento y control del gasto

Actualizado el 12 de octubre de 2026. Esta política aplica al proveedor local Gemma/OpenRouter. Cambiar a Gemini exige repetir la evaluación; no se asume equivalencia entre modelos.

## Qué recibe el modelo

Cada investigación empieza con las publicaciones del lote recibido y una vista relevante del caso: necesidades, inventario con reservas y mínimos, vehículos, evaluaciones recibidas, compromisos, operaciones recientes, correcciones humanas y fuentes. La selección usa ubicación, necesidad seleccionada, urgencia, tipos de recurso y relación explícita con las fuentes; no usa la verdad oculta del simulador.

No se envían todos los eventos de todas las operaciones, el grafo completo de carreteras o cientos de ubicaciones en cada turno. Tampoco se descarta una necesidad por no caber en la primera vista. Se presentan recuentos de registros incluidos/omitidos y un aviso explícito: **fuera del contexto inicial no significa inexistente, falso o sin necesidad**.

El agente dispone de `read_context`, una lectura paginada y acotada a la organización, para recuperar registros por ID, ubicación y tipo. `detail=true` recupera un registro más completo; las vistas anidadas mantienen avisos de omisión. `lookup` y `verify` consultan el sistema de origen para nuevas observaciones. La base recibida y una verificación nueva tienen significados diferentes.

Los resultados de asignación se presentan con índices y cantidades exactas. Se evita repetir el mismo plan como asignaciones, acciones y listas de referencias. `prepare_allocation` y `prepare_service` copian el plan calculado en el servidor; el modelo no necesita transcribirlo. La propuesta completa, su evidencia y el resultado de cada herramienta permanecen en el registro operacional.

Los contratos de acciones personalizadas se cargan con `read_action_contract` para los tipos necesarios. El catálogo inicial contiene el sobre común; la validación completa del servidor sigue aplicándose. Ahorrar descripción repetida no elimina restricciones físicas, permisos o validación de parámetros.

`plan_allocations` también compila las proyecciones vigentes que socios conectados compartieron expresamente. Usa disponibilidad que ya excluye sus reservas/mínimos y conserva IDs de oferta, versión y dueño; no consulta inventario privado. `prepare_allocation` comprueba de nuevo las ofertas elegidas. El dueño de cada paso sigue autorizando y validando la operación en su propio sistema. Una condición de aprobación solo puede referirse a otra propuesta existente; un texto como «org1_approval» no sustituye el flujo real de revisión.

## Espacio de respuesta y razonamiento

- `MODEL_MAX_OUTPUT_TOKENS=8192` es la configuración inicial, ajustable dentro del máximo publicado por el proveedor. Es un techo, no una cantidad que se consume obligatoriamente.
- `MODEL_REASONING=true` habilita el modo de razonamiento cuando el catálogo confirma soporte. La transcripción/percepción de bytes usa un perfil separado: extrae contenido y conserva revisión humana; el investigador razona posteriormente sobre esa evidencia.
- El razonamiento privado se excluye de la respuesta y no se almacena. La UI muestra herramientas realmente utilizadas, evidencia, restricciones comprobadas, incertidumbre y una justificación breve.
- Si `finish_reason=length`, el fragmento no se interpreta como una acción válida. El siguiente intento recibe más espacio, hasta el máximo publicado, y sigue contando dentro de los límites de coste/llamadas.
- No se reintenta por falta de saldo en cada caso: el circuito se pausa tras una negativa de financiación. Recargar y reiniciar el backend permite continuar; el trabajo manual permanece disponible.
- El timeout inicial por llamada es 120 segundos y la investigación tiene una ventana de 360 segundos, configurables. Un plazo de espera no es un presupuesto de pensamiento. Un timeout se registra como `PROVIDER_TIMEOUT`, mantiene su reserva y no produce una decisión ficticia.

El proveedor documenta que los tokens de razonamiento pueden compartir el presupuesto de salida. Por eso no se impone un máximo pequeño a una investigación compleja. [OpenRouter: reasoning tokens](https://openrouter.ai/docs/guides/best-practices/reasoning-tokens).

## Precio y recibos

La configuración inicial busca baja latencia **entre proveedores económicos** (`MODEL_PROVIDER_SORT=latency`) y permite proveedores hasta dos veces las tarifas de tokens publicadas del modelo (`MODEL_PRICE_MULTIPLIER=2`). Así puede haber alternativas de proveedor sin recurrir automáticamente al endpoint más caro. Se solicitan preferencias de latencia/throughput, sin confundirlas con garantías. Si no existe proveedor compatible bajo ese precio, se registra el fallo; no se amplía silenciosamente el gasto. Ambos valores son configurables.

La reserva usa ese techo de tarifas y una estimación conservadora del contexto. El recibo real tiene prioridad. Un intento sin coste conocido conserva la reserva; no se convierte en coste cero. Si solo se conocen tokens, se conserva una estimación al techo de precio y se identifica como estimación. Las preferencias de precio no garantizan latencia ni exactitud: ambas se miden. [OpenRouter: provider routing](https://openrouter.ai/docs/guides/routing/provider-selection).

La clave solo vive en la configuración privada del servidor. Las herramientas no pueden consultar cuentas, sesiones, credenciales, SQL arbitrario ni datos privados de otra organización. La red solo aporta proyecciones compartidas expresamente.

## Qué se comprueba

1. Una necesidad urgente y sus fuentes siguen visibles entre miles de registros irrelevantes.
2. Reservas, mínimos, unidades, compatibilidad, versiones y correcciones no desaparecen al compactar.
3. Los registros omitidos se pueden recuperar en páginas y permanecen aislados por organización.
4. La vista de asignaciones conserva los índices exactos necesarios para preparar la propuesta.
5. Un resultado cortado no ejecuta llamadas parciales; ampliar la salida no elude límites acumulados.
6. Los contratos se pueden cargar bajo demanda y los parámetros incorrectos siguen siendo rechazados.
7. El razonamiento privado no se guarda, y los recibos reflejan el intento real.
8. Las referencias comparativas reciben el mismo modelo, herramientas, configuración de razonamiento, presupuesto y número de oportunidades.

Se registra el tamaño del contexto original recibido y del presentado en `activity.inputSnapshot.context`, más tokens, precio, límite de salida y configuración del request en el recibo del proveedor. Los tamaños de caracteres no son tokens ni calidad semántica. Una reducción respecto del snapshot completo no equivale a una reducción respecto de una versión anterior que ya lo acotaba.

El resultado dirigido `service-live-1791795241572` conservado en `reports/runs/` mostró 50 ocupantes simulados con un contexto inicial de 10.959 caracteres frente a 35.180 del snapshot recibido. Fue una prueba de funcionamiento con una necesidad seleccionada, no una comparación causal de ahorro, un holdout ni evidencia de vidas salvadas reales. Los resultados posteriores y las comparaciones completas se documentan en [VALIDACION.md](VALIDACION.md).

La primera repetición con razonamiento y enrutamiento por precio encontró timeouts reales del proveedor bajo el plazo anterior de 60 segundos. El piloto `1791795781278` se detuvo en un checkpoint con nueve outcomes intactos y 39 faltantes para corregir ese plazo y revisar la conservación de descripciones, correcciones y relaciones entre fuentes. Esa campaña y el smoke multimodal fallido permanecen registrados. No se mezclan sus resultados con la versión revisada.


## Interpretación masiva, concurrencia y recuperación del cierre local

La interpretación de fuentes es una tarea distinta de la investigación operacional. Recibe lotes de hasta 35 fragmentos, referencias cortas S1…Sn y un directorio recibido de ubicaciones pertinentes. El servidor conserva el mapa a IDs/versiones originales. Valida citas, unidades, cantidad, ubicación y antigüedad; conserva resultados válidos y registra rechazos/cobertura, sin inventar una afirmación para cada fragmento. Una salida vacía puede ser correcta; una salida truncada o completamente inválida no se presenta como interpretación exitosa. El intérprete no tiene autoridad de despacho.

La política aprobada selecciona el siguiente caso revisable. Una investigación automática puede preparar asignaciones para necesidades concurrentes con la misma política, capacidad y ofertas vigentes. Una investigación dirigida mantiene el foco seleccionado por el operador. Una necesidad inconclusa queda visible y solo se aplaza automáticamente mientras la firma de la evidencia relevante no cambia; nueva información reabre el trabajo. Un retry manual explícito está permitido. No se vuelven a cobrar inferencias por reenviar un acuse ni por hacer polling de fuentes idénticas.

La reparación usa datos recibidos del viaje afectado, posición/flota y accesos actuales. El compilador preserva la misma carga y destino cuando una ruta válida existe; el modelo no vuelve a escribir un JSON de todos los vehículos ni transcribe un nuevo envío para aparentar reparación. La evidencia/versión se valida de nuevo antes de preparar y el dueño sigue aprobando.

Checkpoints privados conservan herramientas terminadas y offsets/idempotencia; leases renovables y fencing impiden finalizaciones desde un worker antiguo. El estado visible indica consulta, comprobación, preparación, inconcluso o error reales. No se almacena razonamiento privado ni se simula una cadena de pensamientos.

Los recibos de fuente y la calidad semántica tienen métricas diferentes. Ver [CIERRE_LOCAL.md](CIERRE_LOCAL.md) y [VALIDACION.md](VALIDACION.md) para el contraste y la carga real del build final.
