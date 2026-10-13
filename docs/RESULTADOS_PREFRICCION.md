# Resultado conservado antes de incorporar capacidad humana al simulador

## Qué se ejecutó

Se cerraron los nueve mundos predeclarados de tres semillas, con las mismas fuentes y recursos, para B5 (planificador convencional competente), B8 (referencia con señales tempranas) y B6 (NEXO con Gemma vía OpenRouter). Se conservaron todos los resultados, incluido un error de esquema recuperado en B6/02. Las 24 necesidades de cada mundo recibieron servicio físico suficiente; no hubo censura ni violación de invariantes. No se eliminó un mundo porque una llamada del modelo fallara.

El informe completo está en [lectura de los nueve mundos](../reports/analysis/frozen-primary-all-closed-1791857386133.md), con los JSON de fuente y las etapas físicas en [descomposición causal](../reports/analysis/frozen-physical-primary-all-closed-1791857386133.md). El [índice original](../reports/comparisons/1791857386133-primary/index.json) conserva el protocolo y las rutas de cada ejecución.

## El resultado es negativo y sigue siendo válido

| Semilla | B5: servicio suficiente | B8: servicio suficiente | B6: servicio suficiente |
|---|---:|---:|---:|
| response-burst-2026-01 | 31,7819 min | 33,0635 min | 38,3788 min |
| response-burst-2026-02 | 30,0617 min | 33,7968 min | 34,5975 min |
| response-burst-2026-03 | 33,6628 min | 34,6565 min | 36,6718 min |

Son medias restringidas de tiempo hasta servicio físico suficiente, con denominador de 24 necesidades por mundo, no latencia de una pantalla ni tiempo hasta una propuesta. B6 fue un 14,8071 % más lento que B5 y un 8,0098 % más lento que B8 en este piloto. Los déficits de agua, comida y mantas también fueron peores frente a B5. No se acreditó mejora de impacto en este protocolo.

Las 22 llamadas reales de B6 costaron 0,01681876 USD conocidos; no hubo coste de proveedor desconocido. Este importe no incluye salarios, infraestructura ni costes operativos sin precio declarado. Gemma no demuestra resultados de Gemini.

La descomposición de las **216 trayectorias** de los nueve mundos sitúa la demora adicional media B6−B5 en 4,7139 minutos: 3,8227 antes de autorización, 0,6626 en preparación/recogida y 0,2286 durante transporte cargado. Aproximadamente el 81 % del incremento aparece antes de autorizar. B6 emitió 50/48/45 inspecciones frente a 24/24/24 en B5; dos trazas muestran consultas equivalentes mientras la primera seguía pendiente. Esto identifica un problema del producto —admisión/reutilización de comprobaciones— además de la falta de representación humana. No se corrige una pérdida de producto exclusivamente haciendo más lento al convencional. [Análisis causal de las tres semillas](../reports/analysis/frozen-three-causal-1791857386133.md).

## Qué debe cambiar en el producto

1. Las hipótesis vagas o sin relación con una operación actual no deben ocupar toda la capacidad finita de comprobación. Deben conservarse en una cola durable de atención, con investigación de fondo acotada y reactivación ante información nueva.
2. Una comprobación ya pendiente debe reutilizarse entre el descubrimiento semántico y el planificador. Dos flujos no deben enviar dos equipos a comprobar exactamente el mismo lugar y campo.
3. Una existencia de comida no debe interpretarse como una solicitud de comida. El parser común de todas las referencias debe distinguir cantidad disponible de demanda.
4. Un fallo de esquema debe conservar el error y admitir, como máximo, una reparación limitada, con coste y demora reales; nunca aceptar referencias inexistentes ni relajar autoridad para conseguir una respuesta.
5. Más hipótesis extraídas no significan mejor ayuda. Hay que seguir la cadena hasta autorización, carga, desplazamiento y servicio físico. La secuencia disponible de vehículos puede convertir un buen descubrimiento en una ruta peor.

## Qué debe cambiar en la representación del trabajo humano

La referencia anterior automatiza de forma competente la lectura, organización y planificación. Sigue siendo un control fuerte útil; no representa por sí sola una ONG que recibe, interpreta y comunica información con personal finito. Añadir retrasos al resultado final sería una comparación inválida.

El nuevo simulador debe generar causalmente tareas de lectura, integración/decisión, retransmisión y revisión del propietario. Cada tarea ocupa un puesto real durante un tiempo declarado, espera si el puesto está ocupado y sólo entrega información al terminar y transmitirse. Los mensajes conservan su versión y antigüedad. La acumulación, la desconexión y los errores inconclusos deben retrasar acciones del mundo, no sólo un contador del informe.

El flujo manual central competente y una sensibilidad descentralizada deben coexistir con B5/B8. NEXO sigue pagando sus llamadas y mantiene la misma capacidad humana de aprobación, los mismos permisos, inventarios, carreteras, vehículos y recibos físicos. El modelo no dispone de velocidad ni concurrencia infinitas.

Los tiempos y tasas iniciales son supuestos experimentales no calibrados. Deben declararse antes del ensayo y acompañarse de controles con demora cero, lectura rápida, más operadores, información oficial temprana y escenarios sin ventaja. Los duplicados sólo cuentan cuando dos acciones reales sobre información atrasada provocan exceso físico; nunca se fabrican penalizaciones para el convencional.

## Límites de la siguiente iteración

Una mejora bajo colas simuladas demostrará una ventaja bajo esos mecanismos y rangos, no una magnitud universal en desastres reales, vidas salvadas ni posición garantizada en una competición. Los negativos anteriores no se invalidan porque cambie el simulador. Cada nueva versión necesita nuevas huellas, pruebas y comparaciones; no puede heredar resultados físicos de estos nueve mundos.
