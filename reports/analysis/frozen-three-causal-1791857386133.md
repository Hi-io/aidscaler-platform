# Primaria congelada: diagnóstico temporal de los tres pares

Se conservan los nueve mundos declarados: tres semillas, B5/B6/B8, 24 necesidades físicas por mundo, 24/24 suficientemente atendidas, cero censura y cero invariantes. La semilla B6/02 conserva su error `EXTRACTION_SCHEMA` y el coste de su intento. El [JSON completo](frozen-three-causal-1791857386133.json) incluye las 216 trayectorias por necesidad, sus contribuciones físicas y el SHA256 de cada resultado original. El [manifest](frozen-three-causal-manifest-1791857386133.json) sella el lector offline y su salida; no se ejecutó una simulación ni un proveedor para obtener este análisis.

| Semilla | B5 RMST suficiente, min | B6 | B8 | Verificaciones terminadas B5/B6/B8 | HTTP del modelo B6, s |
|---|---:|---:|---:|---|---:|
| 01 | 31.7819 | 38.3788 | 33.0635 | 24 / 50 / 41 | 53.2458 |
| 02 | 30.0617 | 34.5975 | 33.7968 | 24 / 48 / 47 | 69.4606 |
| 03 | 33.6628 | 36.6718 | 34.6565 | 24 / 45 / 44 | 42.1714 |

B6 resulta **14.8071% más lento que B5** y **8.0098% más lento que B8**, utilizando el cociente entre las medias de RMST de los tres pares. El JSON distingue ese estimador de la media de porcentajes individuales (-14.9279% y -8.0867% de reducción, respectivamente); no son dos resultados contradictorios. Primer servicio útil y suficiente coinciden en esta cohorte, porque cada necesidad queda cubierta con su primera recepción positiva. El gasto real conocido de B6 suma USD 0.01681876, con 7/8/7 llamadas.

## Dónde aparece la demora

Promedio de B6 menos B5 sobre las 72 necesidades emparejadas:

| Componente físico de la contribución suficiente | Tiempo adicional medio, min |
|---|---:|
| Inicio de demanda → autorización de esa contribución | +3.8227 |
| Autorización → salida cargada, incl. recogida y preparación | +0.6626 |
| Salida cargada → llegada | +0.2286 |
| Llegada → servicio útil | 0 |
| Total | **+4.7139** |

El componente previo a autorizar representa aproximadamente el 81% del tiempo adicional medio. Combina adquisición de evidencia, espera de cola, selección, elaboración, revisión humana y espera por flota: **no se etiqueta todo como percepción**. Los timestamps de confirmación recibida ausentes siguen nulos; la respuesta de una aclaración encolada no se convierte en observación terminada.

El mayor tiempo cargado de la semilla 01 (+1.5799 min) no es un efecto uniforme: en 02 y 03 es menor que B5 (-0.4340 y -0.4601 min). La degradación consistente está antes de la autorización (+3.7757, +4.4924 y +3.2000 min). Por ello no basta atribuir el resultado completo a «malas rutas».

## Mecanismos observados y correcciones que requieren nueva medida

- B6 terminó 50/48/45 comprobaciones frente a las 24/24/24 de B5. Sus consultas registradas fuera de la cohorte fueron 25/26/20; esa clasificación offline no implica que cada informe fuese falso o inútil. La cola de aclaraciones era finita y el contexto sin dependencia operativa ocupó plazas antes de pistas posteriores. La admisión limitada por relevancia recibida debe reducir ese trabajo sin borrar incertidumbres ni afirmar ausencia de necesidad.
- Hay duplicados reales de consulta sobre el mismo lugar: `b69` con `inspection-25` y `inspection-49` en 01; `b61` con `inspection-21` y `inspection-42` en 03. Se comparten futuras consultas por dueño/objetivo/método/propósito y una identidad durable. No se fusionan observación ordinaria y evaluación de seguridad.
- La inferencia añade 53.25/69.46/42.17 segundos de HTTP real. Ese coste se conserva separado del wall de SQL/CPU y de la latencia mínima declarada del modelo. Menos llamadas no demuestra servicio más rápido; tampoco se resta latencia del fallo 02.
- La asignación física continúa siendo un compilador común. Una corrección compartida de recogida, peso, calendario o flota no se acredita como razonamiento GenAI. Cambiar el orden de confirmaciones puede alterar la asignación de vehículos; comprobarlo mediante los recibos de salida/carga/servicio y controles equivalentes.

Las correcciones implementadas en otra rama no modifican estas fuentes ni convierten esta campaña en positiva. Necesitan nuevos hashes, gate completo y nuevos pares. La ventaja frente a una operación manual fragmentada, si aparece, debe distinguirse de la ventaja incremental frente a B5/B8.

## Límites de la información disponible

Las solicitudes sintéticas incluyen un identificador público literal `bN`, incluso cuando no llevan location tag. Una referencia B8 puede resolver ese lugar, detectar el recurso y pedir una aclaración que devuelve el déficit real; no necesita la aritmética de contenedores/personas del modelo para completar el despacho. La cohorte permite medir adquisición temprana y ejecución, pero no demuestra que la IA sea necesaria para resolver relaciones semánticas complejas. Se conserva como control válido, incluido su resultado negativo.

En S07 la detección de cobertura desconocida es una política de directorio recibida, no una inferencia de necesidades ocultas. En C1/S19 las dependencias y la compatibilidad verificadas son datos tipados del catálogo; el compilador común puede ensamblarlas. K14 actual compara estrategias internas de refresco, no una referencia humana universal ni interpretación multimodal de archivos reales. Cada mecanismo necesita su atribución específica.

No se infieren vidas salvadas, tasas históricas de error humano, calibración externa, comprensión de personas reales o rendimiento de Gemini a partir de estos mundos Gemma.
