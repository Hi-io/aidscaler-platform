# Conventional / NEXO + Gemma 4

Closed comparison · 13 October 2026 · same seed, resources and physical rules.

**20.591% faster physical aid, 9.117 minutes saved per need.**

| Metric | Conventional | NEXO + Gemma 4 |
|---|---:|---:|
| Sufficient physical service | 24/24 | 24/24 |
| Right-censored cases | 0 | 0 |
| Restricted mean, min | 44.279 | 35.162 |
| Distance, km | 216.000 | 209.250 |
| Fuel, L | 38.880 | 37.665 |
| Provider calls | 0 | 6 |
| Known provider cost, USD | 0.00000000 | 0.00613892 |
| Total provider cost, USD | 0.00000000 | 0.00613892 |
| Unknown billing records | 0 | 0 |
| Errors / invariants | 0 / 0 | 0 / 0 |

Distance and fuel decrease 3.125%. Actual model: **Gemma 4**, six real calls; Gemini was not used.

| Resource | Conventional | NEXO + Gemma 4 |
|---|---:|---:|
| water received / demand (L) | 440 / 440 | 440 / 440 |
| water mean sufficient, min | 45.607 | 43.214 |
| water deficit integral (L·min) | 21918.958 | 20432.875 |
| food received / demand (portions) | 164 / 164 | 164 / 164 |
| food mean sufficient, min | 51.165 | 17.586 |
| food deficit integral (portions·min) | 8555.905 | 2852.913 |
| blankets received / demand (unit) | 130 / 130 | 130 / 130 |
| blankets mean sufficient, min | 36.066 | 44.686 |
| blankets deficit integral (unit·min) | 4822.812 | 5768.637 |

The same unchanged definitions retain all24 cases. Quantities are never summed across resources. All raw traces, physical stages, fees and hashes are in readout.json. This is one paired simulation; it does not prove field effectiveness or isolate model necessity. The prior three-seed18.02% result remains separate.

Source: candidate `9b4de8b7769c69a3279067a8a093ef6d2392ec8a9728e704f871a184a69934e3`, evaluator `75c635a59eda752820aabef317a42799915a46a5fc7fba82ad9d0382d69ea29e`, simulator `4ea1bf884ea8d8d2282436aac53367f121fa3b0d308688957849a4774e34f1fa`.
