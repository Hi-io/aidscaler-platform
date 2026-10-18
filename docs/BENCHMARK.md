# AidScaler + Gemini: measured response outcomes

[Overview](../README.md) · [Machine-readable results](assets/gemini-benchmark.json) · [Simulator repository](https://github.com/Hi-io/disaster-response-simulator)

**Less waiting. Less coordination work. All 24 needs served.**

On 18 October 2026, AidScaler was evaluated with **Gemini 3.8 Flash on Vertex AI** against a conventional response workflow in a paired disaster simulation. Both methods faced the same needs, resources, source corpus and human-work parameters.

## Results

| Metric                            |   Conventional | AidScaler + Gemini |                            Change |
| --------------------------------- | -------------: | -----------------: | --------------------------------: |
| Mean time until sufficient aid    |     45.223 min |         33.985 min |           **24.85% less waiting** |
| Mean time until authorization     |     28.603 min |         18.923 min |              **33.84% less time** |
| Modeled human coordination effort | 263 person-min |      16 person-min |              **93.92% less work** |
| Fully served needs                |        24 / 24 |            24 / 24 | **Full coverage in both methods** |
| Fleet distance                    |     214.938 km |         192.158 km |             22.780 km less travel |
| Fuel consumed                     |       39.473 L |           35.296 L |                 4.177 L less fuel |

The food-response subset reached its eight needs in **19.30 minutes on average**, compared with **46.85 minutes** conventionally: **58.81% less waiting**, with the same **173 portions** delivered.

| Delivered resource |       Conventional | AidScaler + Gemini |
| ------------------ | -----------------: | -----------------: |
| Water              |        420 / 420 L |        420 / 420 L |
| Food               | 173 / 173 portions | 173 / 173 portions |
| Blankets           |    184 / 184 units |    184 / 184 units |

## What the scenario represents

| Scenario property      | Configuration                                                                                      |
| ---------------------- | -------------------------------------------------------------------------------------------------- |
| Location               | Takamatsu, Japan; mapped 10 × 10 km road network                                                   |
| Organizations          | Four response organizations                                                                        |
| Demand                 | 24 needs: eight each for water, food and blankets                                                  |
| Information load       | 192 distractor records and two reposts alongside relevant information                              |
| Formal reporting delay | 30 minutes                                                                                         |
| Evaluation horizon     | Three simulated hours                                                                              |
| Pairing                | One fixed-seed comparison; matching corpus, fleet, supplies, permissions and human-work parameters |
| Seed                   | `native-human-capacity-primary-01`                                                                 |
| Model                  | Gemini 3.8 Flash, Vertex AI global endpoint                                                        |

The conventional controller models report reading, decisions and transmission through finite human-work queues. The AidScaler controller uses Gemini to interpret received signals and the platform's checked response logic to act on the resulting operational information. The paired comparison keeps the physical world and response constraints aligned.

Gemini requests were made to the live provider. The simulation accounts for provider latency when making interpreted information available. Both methods completed all needs with **zero recorded invariant violations**.

## What each metric measures

**Wait for sufficient aid** starts when a need appears and ends when enough aid is physically received. It includes travel, unloading and receipt. Each need contributes once to the reported average.

**Time to authorization** runs from the appearance of the need to authorization of the shipment that completes its coverage.

**Human coordination effort** sums modeled person-minutes in finite reading, decision and transmission queues. It measures staff work separately from elapsed delivery time.

**Distance and fuel** come from the simulated fleet's physical execution records. The received-resource totals are recorded outcomes of those operations.

Percentage reductions use the unrounded measurements: `(conventional − AidScaler) / conventional × 100`. The displayed values are rounded for readability.

## Why use a separate simulator?

The [disaster-response simulator](https://github.com/Hi-io/disaster-response-simulator) models the interaction between information and physical response: when a need appears, when reports become available, how finite staff process work, which resources can be committed, and when vehicles and supplies actually arrive.

The evaluator can inspect world truth and physical receipts. AidScaler receives scoped source information and operational queries. This separation lets the evaluation connect an earlier decision with a later delivery under the same scenario conditions.

The interactive demonstration and the fixed-seed benchmark are separate uses of the simulator. The table above refers to the recorded **18 October Gemini comparison**.

## Inspect the measurements

The [published result extract](assets/gemini-benchmark.json) includes unrounded values, scenario settings, resource totals and SHA-256 references to the recorded comparison and readout. It contains the conventional and Gemini arms used in this presentation.

Relevant implementation entry points:

- [Human-capacity benchmark](../evaluation/human-capacity-benchmark.mjs): finite human-work queues and scenario comparison.
- [Conventional source workflow](../evaluation/conventional-source.mjs): baseline information handling.
- [Physical trace](../evaluation/physical-trace.mjs): receipt and travel measurements.
- [Vertex adapter](../src/vertex-provider.mjs): model requests, function calls and usage conversion.
- [Evaluation build checks](../tests/evaluation-build-integrity.test.mjs): scenario/build integrity checks.

Read the [development guide](LOCAL.md) to set up the platform and simulator together.
