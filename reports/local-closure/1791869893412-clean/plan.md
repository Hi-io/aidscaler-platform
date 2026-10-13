# T27 clean checkout — v2 profile-preserving amendment

Preparation only. No package installation, world, model call or startup is performed before a separate `ROOT_GO_CLEAN_CHECKOUT` from the parent. The original helper, original tests, first failed LF/CRLF run, corrected LF v1 preparation and all previous archives are preserved. Production source and test trees remain frozen.

The v1 helper replaced HOME and Windows profile paths to create a fresh user-profile environment. The developer instruction prohibits repurposing HOME/home/CODEX_HOME. This **new ignored v2 copy** removes that behavior and narrows its isolation claim. It does not modify the old artifact or make the old run valid.

## Real isolation

- HOME/home/CODEX_HOME are not assigned or copied into the child environment. Parent environment is not changed.
- Existing USERPROFILE/APPDATA/LOCALAPPDATA and required OS variables are retained exactly when present; absent profile paths remain absent. These are original Windows OS paths, not synthetic task paths. The original user profile is still accessible, so this is not whole-profile or filesystem sandbox isolation.
- PATH contains only the declared Node runtime directory and Windows System32. Private provider/database/tokens/proxies/NODE_OPTIONS/NEXO configuration and arbitrary parent variables are excluded by an exact whitelist.
- A new task directory under ignored `.local/T27-private-builds-v2/NEW-ID` contains fresh sibling checkouts, a fresh explicit pnpm `--store-dir`, empty task-specific npm **user and global** configuration files and a task-specific npm cache. It contains no fake HOME. Incidental OS-level caches are not claimed fresh or disabled.
- Git archive explicitly forces LF bytes using `-c core.autocrlf=false -c core.eol=lf`. No repository Git configuration or original source bytes change. Dependency install uses the declared pnpm11.25.0 lockfile and no copied node_modules/junction, environment file, local database or bootstrap key.
- Actual copied local startup uses a new memory database and ordinary scoped HTTP input/review/physical delivery. The provider refuses completion and the smoke refuses external fetches. A300L receipt is real source service, not model or field-efficacy evidence.
- Node-stack install/startup only. Python/ASR/ffmpeg/model assets, Chromium installation, cloud deployment and independently realistic disaster performance remain separate. Existing process-crash/ENOSPC/backup/export artifacts are not replaced.

## Prepare and verify (zero startup / zero model)

```text
node --test .local/local-clean-checkout-profile-v2.test.mjs
node .local/local-clean-checkout-profile-v2.mjs --kind=clean
```

This creates a new protocol/result-preparation directory under `reports/local-closure/NEW-ID-clean`; no source archive extraction, package installation or world is executed. Preserve the exact v2 helper/test/guide and their hashes beside that preparation.

## Execute only after named parent GO and primary has settled

```text
node .local/local-clean-checkout-profile-v2.mjs --kind=clean --execute --authorization=ROOT_GO_CLEAN_CHECKOUT --seal=reports/federation-structural/seal-1791865906344/seal.json
```

Run from `.human-capacity-development/nexo-platform` using the declared Node24 runtime. The command makes a NEW evidence directory and checks the existing full/UI/five-profile source seal and current runtime fingerprints before installing. Both copied committed repositories must match the sealed tested bytes afterward. Two installs have240s child timeout each, physical startup120s and whole helper600s; it is scheduled exclusively to avoid perturbing provider-timed studies. Expected provider spend$0. No inherited provider key is needed or logged.

A timeout, install failure, nonmatching commit bytes, secret/dependency tracked path or absent physical receipt remains an explicit incomplete/failed result, with logs and immutable tar hashes. Do not delete generated dependencies or retry a failure to select a favorable result without retaining an amendment. No GCP deployment or fresh HOME claim is allowed from a pass.
