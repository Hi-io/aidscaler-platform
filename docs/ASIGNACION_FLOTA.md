# Asignación concurrente de flota: ciclos de tres entregas

## Problema comprobado y cambio común

El diagnóstico del primario histórico encontró que una confirmación temprana no siempre se convertía en ayuda temprana. La elección de vehículo/stock podía imponer una recogida más larga. El compilador compartido admitía necesidades según prioridad/plazo y mejoraba la distribución mediante intercambios de dos asignaciones. Ese método puede quedar en un mínimo local.

Una matriz de viajes recibidos demuestra el defecto sin proveedor ni verdad oculta:

| Equipo / necesidad | n0 | n1 | n2 |
|---|---:|---:|---:|
| o0 | 18 s | 17 s | 4 s |
| o1 | 49 s | 14 s | 31 s |
| o2 | 28 s | 7 s | 28 s |

Admisión greedy: o0→n0, o2→n1, o1→n2 = 56 s. Ningún intercambio de dos mejora el total. Una rotación factible o2→n0, o1→n1, o0→n2 suma 46 s. La reducción de 17,9% describe **estimaciones de viaje de este componente**, no tiempo medido de servicio humanitario, mejora del modelo ni vidas salvadas.

`src/planning.mjs` conserva los intercambios previos y explora rotaciones entre tres asignaciones ya admitidas, con un máximo de 24 posiciones y cuatro pases. No admite nuevas necesidades, no modifica cantidades y no consulta futuro/observador. Conserva los propietarios por recurso/vehículo, el saldo neto de cada stock y todos los controles existentes de ruta recibida, combustible, calendario, carga, caducidad y plazo útil. Las referencias B5/B8 emplean exactamente el mismo compilador.

## Regresión y límites

`tests/fleet-cycles.test.mjs` prueba el contraejemplo, determinismo sin mutar inputs, restricción de plazo/ruta/flota ocupada/capacidad/conductor/lote/combustible, incompatibilidad de tipos y una rotación de cantidades distintas que excedería stock protegido. Una ventana de entrega exige tiempos recibidos finitos y no negativos de carga, descarga y transmisión de órdenes; no se convierte una duración desconocida en cero para aprobar una rotación. Pasaron las cinco pruebas nuevas y las 15 regresiones conjuntas de ciclos, asignación y planificación. La suite completa y la campaña posterior deben verificar esta versión junto con los demás cambios.

No es una optimización global ni una búsqueda de todas las rutas futuras. Sólo reduce un defecto comprobado en una tanda concurrente recibida. El resultado comparativo debe incluir los mismos recursos físicos, revisiones, tiempos y todas las semillas/censuras de ambos brazos; una mejora del compilador común no se atribuye a Gemma/Gemini.
