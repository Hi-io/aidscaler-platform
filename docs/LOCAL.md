# Operar NEXO en local

## Requisitos y límites

- Node.js 24+, pnpm 11 y los repositorios privados `nexo-platform` y `disaster-response-simulator` en carpetas hermanas.
- La fase local utiliza Gemma 4 31B mediante OpenRouter desde el backend. Necesita internet para inferencia; la base de datos, la UI y el laboratorio son locales.
- GCP no se despliega en esta fase. `ARQUITECTURA_GCP.md` describe una migración posterior, no servicios ya activos.
- Las contraseñas, claves de origen/red y el API key se guardan únicamente en `.env.local` y `.local/`, ignorados por Git. AGENTS.md y artefactos de Codex también están ignorados.
- El proveedor de pagos es un sandbox local. Ningún botón cobra dinero real.

## Inicio del laboratorio

Instalar dependencias en ambos repositorios con `pnpm install --frozen-lockfile`. En la carpeta de la plataforma:

```powershell
if (!(Test-Path -LiteralPath '.env.local')) {
  Copy-Item -LiteralPath '.env.example' -Destination '.env.local'
}
# Configurar OPENROUTER_API_KEY en el archivo local, sin subirlo a Git.
pnpm lab
```

El launcher levanta cinco procesos de organizaciones independientes: cuatro instancias NEXO y un contratista externo sin modelo ni workspace NEXO. Cada uno conserva su almacenamiento y autoridad.

| Superficie          | URL                               | Para quién                  |
| ------------------- | --------------------------------- | --------------------------- |
| Relief North        | `http://127.0.0.1:4400/`          | Operadores de org0          |
| Community East      | `http://127.0.0.1:4401/`          | Operadores de org1          |
| Rescue South        | `http://127.0.0.1:4402/`          | Operadores de org2          |
| Medical West        | `http://127.0.0.1:4403/`          | Operadores de org3          |
| Socio externo       | `http://127.0.0.1:4404/`          | Propietario del contratista |
| Portal público      | `http://127.0.0.1:4400/public`    | Público/donantes de prueba  |
| Reportar necesidad  | `http://127.0.0.1:4400/community` | Comunidad, sin cuenta       |
| Observador 3D       | `http://127.0.0.1:4328/`          | Evaluador, nunca el modelo  |
| Red social ficticia | `http://127.0.0.1:4329/feed`      | Fuente HTTP consultable     |

El laboratorio usa puertos diferentes del simulador independiente en 4318/4319. Los procesos se vinculan a loopback. Compartir esta URL requiere una solución de acceso posterior; esta instancia no es pública.

Las cuentas de prueba tienen direcciones como `commander@org0.nexo.local`, `analyst@org0.nexo.local`, `field@org0.nexo.local`, `publisher@org0.nexo.local`, `finance@org0.nexo.local`, `admin@org0.nexo.local` y `auditor@org0.nexo.local`. La contraseña generada está en `.local/access-org0.json` y sus equivalentes. La cuenta del socio externo se provisiona por separado. No imprimir estos archivos en reportes, commits, demos o capturas.

Cada arranque crea `.local/labs/<sesión>/org*/pgdata`: un mundo nuevo no hereda operaciones ni versiones antiguas. Las sesiones anteriores se conservan. `.local/lab.json` identifica la sesión y superficies actuales. Para retomar una base operativa sin reiniciar el mundo, usar `pnpm start` con su configuración; no borrar bases para ocultar resultados anteriores.

## Modelo, presupuesto y reloj

`.env.example` enumera modelo, timeout, límite de llamadas y presupuesto por episodio. Cada organización tiene además una cuota por hora. La ingesta automática de investigaciones está pausada inicialmente; el operador la habilita desde Investigations. La recepción de publicaciones y sistemas sigue funcionando sin habilitar inferencia.

Las investigaciones tienen hasta ocho llamadas por defecto, herramientas acotadas y posibilidad de parar. Un error con coste desconocido mantiene una reserva conservadora; no se convierte en coste cero. Las trazas muestran llamadas, resultados y razones breves, sin inventar pensamiento privado del modelo.

En un incidente compartido, configurar una instancia coordinadora para la investigación y mantener la revisión/ejecución de aportes en cada propietario. Habilitar intake de ese mismo caso en todas las instancias puede duplicar consultas físicas y gastar cuotas. Cada instancia puede investigar sus casos locales; no existe todavía elección automática de líder o exclusión distribuida universal de casos. El evaluador posterior compara B5/B6 con la misma asignación de coordinación.

Si OpenRouter responde HTTP 402, la instancia pausa nuevas llamadas y la campaña se detiene, conservando fallos y costes desconocidos. Restaurar el crédito de la **cuenta**, no solo aumentar el límite de la clave, y reiniciar el backend de la instancia con su mismo directorio/credenciales. No resetear un mundo operativo ni abrir una DB activa en otro proceso para conseguir ese reinicio. La UI y las acciones humanas no dependen de que vuelva la inferencia. Las pruebas unitarias/contratos no necesitan saldo.

La sesión interactiva arranca a ×10 para que el mundo no termine antes de abrir el workspace. Cambiar velocidad/pausa desde el observador o configurar `NEXO_LAB_RATE` entre un valor positivo y 1000. Esta velocidad de presentación no convierte el recorrido en medición live ×1 ni permite comparar inferencia acelerada con inferencia en tiempo real.

Tres modos de prueba son diferentes:

- **Fixtures/replay:** no generan una nueva inferencia ni demuestran capacidad del modelo.
- **Modelado:** el evaluador cobra demoras de consultas, comunicación, revisión y modelo en el reloj del mundo. Guarda por separado la latencia real del proveedor.
- **Live ×1:** el mundo avanza por tiempo real, incluidas llamadas reales. No cobra la inferencia multiplicándola por una velocidad de simulación.

## Recorrido por rol

### Coordinación y despacho

1. Abrir Overview: necesidad conocida, fuente de esa observación, ayuda recibida y operaciones pendientes.
2. Abrir un caso o una publicación en Signals. Consultar originales, contradicciones y versiones antes de tomar una afirmación como hecho.
3. Solicitar una investigación dirigida o habilitar intake automático con presupuesto. No hay un chatbot que necesite recibir una orden escrita por cada publicación.
4. Revisar en Decisions las acciones y cantidades actuales, condiciones pendientes, evidencia, alternativa y propietario. Editar, aclarar, rechazar o autorizar esa versión concreta.
5. Si interviene un socio, este revisa su contribución en su propia instancia. El coordinador no obtiene su autoridad.
6. Seguir Operations. Autorizado, orden recibido, en tránsito, llegada, recepción y servicio son hitos distintos.
7. Asignar una operación existente a un equipo de campo. Delegar una sola decisión a un analista con vigencia limitada, o transferir pendientes a otro responsable. Un relevo no transfiere automáticamente una aprobación.
8. Si cambia una dependencia, revisar el cambio y preparar una reparación. Lo ejecutado queda en el historial y no se vuelve a despachar como parte de la reparación.

### Analista y verificación

Revisar fuentes y medios reales, consultar conectores autorizados, pedir comprobaciones de campo, investigar opciones y preparar propuestas. Interpretación no es certificación de seguridad. La autoridad normal no incluye despachar; una delegación solo cubre la versión y alcance explícitos.

### Campo

La cuenta de campo accede a sus tareas asignadas, reportes y medios autorizados. Puede confirmar lectura, informar salida/llegada/problema y adjuntar evidencia. El estado de una tarea y un reporte de recepción no fabrican una recepción física en el simulador.

Los updates se guardan en IndexedDB con identificador estable y dueño. El service worker conserva el shell para recargar offline; no conserva respuestas API privadas en la caché compartida. Al reconectar, el servidor debe acusar recepción antes de quitar un elemento de la cola. Si cambió la versión, resolver el conflicto de forma explícita; no sobrescribir una instrucción nueva.

### Recursos e instalaciones

Inventario, vehículos y evaluaciones conservan propietario y sistema de origen. Un dato del sistema externo no se edita como si fuera stock libre local. Reservas tienen mínimos retenidos, cantidad y TTL. Ofertas compartidas pueden retirarse; el estado de red no implica aceptación. Los servicios requieren equipos compatibles, acceso, evaluación y permiso actual.

En esta fase recursos/instalaciones están bajo las cuentas operativas commander/dispatcher. No existe una certificación de todas las profesiones clínicas o técnicas por registrar un rol genérico.

### Comunicación y finanzas

Preparar una actualización pública agregada, revisar su estado y referencias y aprobarla. Una recepción pública requiere comprobante operativo confirmado. Las evidencias visuales requieren revisión humana de privacidad; no se exponen automáticamente todos los adjuntos.

El responsable financiero concilia liquidaciones, asignaciones, liberaciones y reembolsos del sandbox. Promesa, checkout iniciado y fondos liquidados son distintos. El apoyo se agrupa para necesidades cambiantes; no promete entregar un artículo por aportación.

### Público, comunidad y socio externo

El público consulta únicamente actualizaciones aprobadas y finanzas agregadas. La comunidad puede enviar una descripción o un adjunto de foto/audio con lugar aproximado; ingresa a moderación, no directamente a la cola del modelo ni a una operación.

El socio externo conserva un acceso y ledger separados: oferta limitada, solicitud, aceptación/rechazo por su dueño y confirmación de su operación. No necesita instalar NEXO ni usar su modelo. El gateway de esta fase cubre transporte; ampliar a otras contribuciones requiere ampliar y probar el contrato.

### Administración y auditoría

Administración crea/revoca cuentas y registra conectores. No obtiene autoridad operacional. Auditoría conserva actor, versión, evidencia y cambios; una corrección no borra la decisión anterior. Exportaciones y backups contienen datos privados y se mantienen fuera de Git.

## Fuentes y medios

El conector del simulador ingiere por HTTP la red social ficticia, revisiones y canales del equipo. Es separado de las consultas a inventario, flota, mapa y recibos. Solo usa una clave de organización; no puede consultar el observador omnisciente.

Los conectores JSON y MCP se registran con origen permitido, licencia, frecuencia, esquema, herramienta y credenciales del backend de alcance mínimo. Una nueva fuente desconocida permanece sin habilitar. Las caídas y cuotas se muestran como fallos, no como inventario vacío.

Para analizar bytes de audio, video y documentos:

```powershell
pnpm setup:media
```

La primera transcripción descarga pesos locales de ASR. Imágenes y fotogramas muestreados usan el modelo configurado. Para PDF se extraen hasta 20 páginas de texto; se renderizan hasta cuatro páginas escaneadas y el modelo propone su transcripción. Cada página distingue texto embebido de transcripción visual no verificada; las páginas restantes quedan pendientes. Registrar tipos no admitidos y partes no observadas. No llamar «percepción probada» a las descripciones sintéticas del laboratorio. Un medio sin archivo o con hash distinto no entra a inferencia ni publicación.

## Ejecutar pruebas y recoger evidencia

```powershell
pnpm check
pnpm test
node scripts/verify.mjs # plataforma + simulador, huellas y reporte conjunto
pnpm hygiene
pnpm test:live       # smoke del proveedor, no entrega física
pnpm demo            # composición y servicio con proveedor real, reloj modelado
pnpm demo:live       # entrega física ×1; hasta diez minutos de observación
pnpm test:journeys   # harness aislado de UI/offline/roles
# Con pnpm lab activo:
pnpm test:ui
pnpm test:sources    # lectura real externa, no acuerdo institucional
pnpm test:media      # bytes sintéticos autorizados, no corpus de campo
pnpm test:load       # nueve perfiles; el mayor puede tardar unos trece minutos
```

En el simulador ejecutar por separado `pnpm test` y `pnpm check`. Las pruebas automáticas no realizan llamadas pagadas salvo los comandos que indican proveedor/medios reales. `pnpm demo -- --autonomous` retira la selección de instalación del operador para un episodio exploratorio; no lo transforma en un holdout independiente. `node --env-file-if-exists=.env.local scripts/service-demo.mjs --from-need` selecciona solo una necesidad recibida, sin indicar instalación o solución.

Para el piloto comparativo:

```powershell
node --env-file-if-exists=.env.local scripts/campaign.mjs --scenarios=S23,S01,S09,S19 --arms=B1,B2,B3,B4,B5,B6 --seeds=1 --budget=1.5 --episode-budget=0.25 --rounds=1
```

El protocolo se guarda antes de llamar al modelo. `--rounds` habilita hasta 24 oportunidades finitas con `--interval-ms`; el presupuesto es acumulativo. El candidato debe permanecer congelado durante la campaña. Los reportes guardan semillas, código, evaluador, configuración, fallos y costes. Un resultado con un mundo es piloto; pérdidas e incompletos se conservan. Leer `VALIDACION_EXTERNA.md` antes de acreditar mejoras confirmatorias.

## Backup y recuperación local

Detener los workers/servidor de la instancia antes de abrir su DB desde el comando de recuperación; esperar operaciones SQL confirmadas. El bundle contiene evidencia privada y hashes de contraseña, pero excluye sesiones, API key y claves de los servicios.

```powershell
$env:NEXO_LOCAL_DIR = '.local/org0'
node scripts/backup.mjs export .local/backups/org0.json.gz
node scripts/backup.mjs restore .local/backups/org0.json.gz .local/restored-org0
```

El backup no sobrescribe un archivo existente; restore exige una carpeta nueva. Conserva IDs de comandos, jobs pendientes, ledger y cadena de auditoría. Reconfigurar credenciales de origen/red en el backend de la instancia recuperada y autenticar de nuevo. No operar a la vez la copia recuperada y la original contra el mismo mundo físico: esa sería una recuperación equivocada, no una nueva organización.

RPO local esperado: cero transacciones confirmadas desde la instantánea consistente; cambios posteriores necesitan otro backup. RTO inicial: cinco minutos en el hardware declarado, medido por el ensayo pequeño de recuperación. Ese resultado no garantiza el mismo tiempo para una base de datos o almacén de medios mucho mayor. La recuperación física después de una escritura incierta consulta la fuente con la misma clave antes de repetirla.

## Cambiar de modelo o migrar

Cambiar `MODEL_ID` configura otro modelo disponible; no garantiza el mismo soporte de herramientas, visión o precisión. Conservar y repetir tests de proveedor, multimodalidad, investigación y comparación. Gemini requiere su adaptador/configuración y una nueva campaña. La migración posterior a GCP debe repetir conformidad de DB, autenticación, cola, almacenamiento, contratos, despliegue y latencias; los servicios locales no heredan automáticamente las propiedades cloud.
