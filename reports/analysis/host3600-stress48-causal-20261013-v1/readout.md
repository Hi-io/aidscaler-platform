# HOST3600: control cerrado de 48 necesidades

Diagnóstico exclusivamente de los tres mundos cerrados C_manual, B8 y B6 del seed `native-human-capacity-control-stress48-01`, condición `moderate_48`. Los tres cubren 48/48 necesidades, con cero errores, invariantes, exceso y censura física. No se consultaron resultados de stress96 ni se lanzaron mundos/proveedores. Efectos y tiempos copiados del reader sellado: `reports/analysis/host3600-stress48-closed-20261013.json`; raws verificados por SHA en `readout.json` y manifiestos de esta carpeta.

## Resultado, sin sustituir la referencia fuerte

| Brazo | Media restringida hasta ayuda suficiente | p95 hasta ayuda suficiente | Trabajo de atención nativo | Km / combustible nativo |
|---|---:|---:|---:|---:|
| C_manual | 84,9301 min | 150,5086 min | 509,0 persona-min | 501,00 km / 90,180 L |
| B8, reglas y consultas | 66,4277 min | 122,3670 min | 38,5 persona-min | 489,75 km / 88,155 L |
| B6, percepción con modelo | 66,6128 min | 123,0670 min | 35,5 persona-min | 477,75 km / 85,995 L |

B6 logra **21,5676% menos tiempo que el manual** y **0,2786% más tiempo que B8**, es decir 11,1042 s más por necesidad en media. Aquí no hay victoria temporal del modelo sobre las reglas. Primera ayuda útil y suficiente coinciden: cada brazo emitió 48 operaciones, todas completadas con un recibo físico positivo por necesidad. Los 48 casos comparten flota y colas: constituyen un solo seed emparejado, no 48 experimentos independientes. No se ajustaron métricas ni se seleccionaron necesidades favorables.

La cohorte tiene 720 L de agua, 325 porciones y 319 mantas. Todas se reciben sin déficit residual ni exceso. Las integrales de déficit conservan sus unidades; no sumamos litros con porciones o mantas.

| Recurso | Ganancia B6/manual en tiempo suficiente | Ganancia B6/B8 en tiempo suficiente | Reducción B6/manual de integral de déficit | Reducción B6/B8 de integral de déficit |
|---|---:|---:|---:|---:|
| Agua | 14,7263% | −0,5599% | 11,3206% | 3,1749% |
| Comida | 28,1864% | −0,5410% | 30,7266% | 2,4098% |
| Mantas | 22,4795% | 0,2987% | 23,1401% | 1,6967% |

La integral de déficit pondera cada unidad durante su espera; el RMST suficiente pondera cada necesidad. Por eso unas integrales ligeramente mejores no convierten el tiempo suficiente global negativo frente a B8 en una victoria. Ambos estimadores se presentan con sus definiciones originales.

## Causa temporal

| B6 menos referencia, media emparejada | Antes de autorizar | Recogida y preparación | Viaje cargado | Total |
|---|---:|---:|---:|---:|
| C_manual | −17,5535 min | −0,3863 min | −0,3776 min | −18,3174 min |
| B8 | +0,5063 min | −0,1259 min | −0,1953 min | +0,1851 min |

La ganancia manual vuelve a concentrarse antes de autorizar. Esta etapa mezcla lectura, interpretación, confirmaciones, compilación, revisión y espera por flota; no se puede presentar como tiempo de razonamiento del modelo. B6 tiene 49,1274 min de preautorización media, 7,8439 min de recogida, 8,6415 min de viaje cargado y 1 min de descarga: el modelo no acelera las velocidades o la física.

B6 y B8 usan consultas recibidas y el mismo compilador/asignador determinista, con revisión del dueño. B8 no recibe una penalización manual artificial. El orden distinto de percepción/consultas cambia la asignación y disponibilidad de vehículos, pero no demuestra un nuevo optimizador aprendido. Frente a B8, 30,375 s de preautorización adicional sólo se compensan parcialmente con 19,2708 s menos en recogida y viaje.

## Atención humana, consultas y modelo

C_manual completó 401 lecturas, 208 tareas de decisión y 93 relevos. Al corte fuente de 3 h no queda ninguna tarea pendiente; máximo backlog individual por organización: 73. Espera p95 al iniciar: lectura 16 min, decisión 10,3833 min y relevo 12,8667 min. Turnaround p95 de completados: lectura 16,5 min, decisión 11 min y relevo 14,3834 min. Son estadísticas de colas finitas simuladas, no mediciones de personal real.

B8 completó 77 revisiones y B6 71, cada una de 30 s, sin cola pendiente ni espera de revisión; ambos máximos de backlog son 1. El trabajo contabiliza las revisiones dentro de `decide` una sola vez y separa espera de trabajo: B6 reduce el trabajo de atención declarado 93,0255% frente al manual y 7,7922% frente a B8. No equivale a salario ahorrado ni a precisión independiente.

Los tres recibieron 639 fuentes originales según el contador común. B8 emitió 238 consultas y B6 73, mientras el manual emitió 82. Esta economía de consultas es una diferencia observada, no una puntuación de precisión: una consulta que confirma que no hay necesidad no es automáticamente un falso positivo perjudicial. En este caso las consultas adicionales de B8 no impidieron completar la misma cohorte con un tiempo levemente mejor.

Para la primera consulta registrada por edificio de la cohorte, B8 tiene 19 asociaciones al parser explícito y 29 a reglas de palabras/ubicación. B6 tiene 27 al parser explícito, 18 a un recibo real del modelo y **3 edificios sin esa actividad registrada**. Esos tres se conservan como ausencia de atribución; no se imputan al modelo ni a las reglas. La asociación no demuestra necesidad semántica, verdad de cada afirmación ni causalidad incremental. Una solicitud/ACK tampoco sustituye un recibo de verificación completada.

B6 hizo **13 llamadas reales a Gemma**, coste conocido **USD 0,01193348**, sin uso desconocido; HTTP del proveedor acumulado **76,1020 s**. Los 36 batches de percepción incluyen pasos sin llamada y no son 36 llamadas pagadas. Todas las duraciones HTTP fueron menores de 15 s; cada disponibilidad respetó el mínimo común declarado de 15 s. El coste y la latencia no se ocultan pese al empate físico con reglas. B8 no usó proveedor.

## Límites que acompañan cualquier presentación

1. **Automatización frente a flujo manual:** el 21,57% sí es una mejora física en este perfil hipotético; no demuestra que una red neuronal sea su causa necesaria. B8 automatiza consultas y alcanza prácticamente el mismo resultado sin inferencia.
2. **El cuello de botella físico permanece:** la misma flota sirve 48 demandas con inventario, tiempos y revisión iguales. Un descubrimiento más selectivo no garantiza menor RMST si la disponibilidad/orden de vehículos absorbe esa ventaja. No se penalizará B8 para crear margen.
3. **Recursos y gasto:** B6 usa 4,6407% menos distancia/combustible que el manual y 2,4502% menos que B8 en este seed; no es una estimación de ahorro económico ni una ventaja universal de rutas. Métricas K09 son agregados nativos de todos los vehículos.
4. **Representación:** 48 necesidades, 384 posts de ruido, dos reposts, reporte formal a 30 min, mapa de 9×9/6 km, dos clarificadores, perfiles de 2 lectores/2 decisores/1 relayer por organización y cero errores humanos son parámetros declarados, no una calibración empírica. No se alega sensibilidad nativa a pérdida/silencio a partir de este estudio.
5. **Generalización y atribución:** un seed, corpus propio, interpretación simulada/recibos y Gemma no acreditan precisión independiente, capacidad en cualquier idioma, ventaja de Gemini, ni resultado de campo. Las comparaciones primarias previas y este resultado negativo contra B8 siguen visibles; no se promedian perfiles o seeds distintos para fabricar un efecto de escala.

Fuente de protocolo: `native-human-capacity-physical-response-v4`, same-seed/corpus/permisos/recursos/física común. Corpus SHA `466e07e7a919d2e2c1ab4a572c8d3efa1cddea920163c5e536cbd54e453beafc`; cohorte SHA `554b10acea65bf7e50a29f9feff63d9ada06063b7259e3446f15da6b4982fdb5`. Las huellas de candidato, evaluadores y simulador están en los manifiestos. SQL/HTTP/fases de host están separados del reloj fuente y no se suman como CPU exclusivo o demora física adicional.
