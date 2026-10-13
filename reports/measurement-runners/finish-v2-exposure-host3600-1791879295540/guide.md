# Preparación final con host compartido y exposición conservadora

Estado: PREPARADO, ninguna ejecución autorizada por este documento. Las fuentes de producto, evaluación y motor siguen congeladas. Se exige un GO explícito de root para cada etapa.

## Antecedentes conservados

- Primaria histórica: doce mundos, protocolo anterior. No se vuelve a etiquetar ni se mezcla con la versión actual.
- Controles históricos: diecisiete declarados, once observados, ocho en grupos cerrados válidos; grupo de tres con un fallo de longitud de clave y seis no lanzados.
- Bridge actual con host900s: nueve declarados, tres observados, seis no lanzados; C_decentralized alcanzó wall_limit, sin cambio de fuentes o invariantes rotas. Es un límite de ejecución del host y no una ventaja física demostrada. Se conservan los tres raws, su protocolo, index, resumen y costes por SHA.
- Preparación finish anterior bb0a344c se conserva como supersedida antes de cualquier ejecución. Una prueba offline mostró que una factura cero antigua podía ocultar otra positiva posterior. El nuevo guard considera ambas y conserva el máximo acumulado explícito.

## Bridge con host3600s

Plan `.local/version-bridge-host3600-v2-prepared-1791879051048/plan.json`, SHA `abb8e33896598c7f6808236cc1811f4c7ba702d77aa606e30192afdbeec663dd`.

La CLI congelada acepta `--wall-ms=3600000`. `--wall-limit=3600` sería ignorado: una prueba usa la función campaignPlan real para comprobarlo. La modificación es común a los nueve mundos: mismos seeds, posts, recursos, física, atención y aprobación humanas, horizonte físico de tres horas y presupuesto de proveedor. Se repite el grupo completo de tres descentralizados; se ejecutan los seis de estrés ya declarados. Reserva máxima USD0.45, máximo72 calls, ejecución secuencial.

```powershell
node --env-file-if-exists=../../nexo-platform/.env.local .local/compact-human-controls-bridge-host3600-v2.mjs --run=ROOT_GO_COMPACT_BRIDGE_HOST3600_V2 --plan=.local/version-bridge-host3600-v2-prepared-1791879051048/plan.json --plan-sha=abb8e33896598c7f6808236cc1811f4c7ba702d77aa606e30192afdbeec663dd --folder=reports/human-capacity-controls-bridge/native-bridge-host3600-v2-20261013
```

El STOP nuevo es `.local/STOP_COMPACT_BRIDGE_HOST3600_V2`. El coordinador espera el cierre del hijo y de sus llamadas. No mata procesos ni aumenta el reloj físico a causa del host. Un resultado negativo completo permanece válido; una ejecución incompleta impide los estudios siguientes.

## Finish posterior al bridge

Plan `.local/finish-local-studies-v2-exposure-prepared-1791879206223/plan.json`, SHA `7af37cdf378199fa0a443a67b838f5bcd604ac9523e2ba80c64ef811fe885920`.

El runner exige los nueve raws del bridge con host3600 cerrados, las tres fuentes y el evaluador humano exactos, full486/sim247/UI113 y T27 vigente. El bridge fallido9/3/6 no puede habilitarlo. No vuelve a ejecutar el bridge.

```powershell
node --env-file-if-exists=../../nexo-platform/.env.local .local/finish-local-studies-v2-exposure.mjs --run=ROOT_GO_FINISH_LOCAL_STUDIES_V2 --plan=.local/finish-local-studies-v2-exposure-prepared-1791879206223/plan.json --plan-sha=7af37cdf378199fa0a443a67b838f5bcd604ac9523e2ba80c64ef811fe885920 --completed-bridge=reports/human-capacity-controls-bridge/native-bridge-host3600-v2-20261013 --stage=human --folder=reports/finish-local-studies-v2-exposure/human-current
```

Después de cerrar la etapa humana, la etapa evidence usa el mismo comando y plan, con `--stage=evidence`, `--completed-human=reports/finish-local-studies-v2-exposure/human-current` y una carpeta nueva. No se ejecuta aquí ni se promete que cerrará.

Se mantienen catorce entradas: bridge externo, formal/burst, read/relay, K11/K13, K07, K14,100 acoplados,S03/S05,S19,K15,K22,K18,federación12 y latencia local. Medios reales es un estudio adicional standalone y no se agrega silenciosamente a este plan.

Formal/burst corrige sólo la expectativa de packetLoss a0: PILOT_CONFIG real y los doce manifests históricos confirman0. Todos los kwargs nativos permanecen iguales. La preparación antigua .02 se conserva; silent/loss.25/.05 sigue bloqueado hasta un cambio de API futuro con nuevos gates. Decisión/review1% sigue bloqueado; read/relay1% es un estudio separado, simétrico y con review0.

## Contabilidad

El padre separa la suma nominal de slots de pago del techo de admisión declarado del hijo: additional.45, K07.50, K14.70, S19.75, K15.40, K22.45, K18.40. No aumenta los presupuestos ni calls de los hijos.

Se consideran summary,index,progress y attempts conjuntamente. Un checkpoint antiguo de cero no oculta una reserva activa o una factura acumulada posterior. Ante cierre incompleto o factura faltante, el padre conserva el techo completo como exposición; subtotal conocido y factura total permanecen separados. Nunca recorta gasto real por encima de un techo y nunca traduce unknown a0. Los costes históricos, el intento host900 y el bridge nuevo son particiones distintas, contadas una vez.

## Alcance de las pruebas

Dieciocho pruebas puras: seis de host/ancestría y doce de exposición/native0/K18. No contienen episodios de simulación, providers ni asserts de beneficio positivo. Ningún promedio puede combinar protocolos/versiones/host allowances; sólo el inventario de cobertura puede referenciar sus particiones explícitas.
