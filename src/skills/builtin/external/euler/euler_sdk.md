---
id: euler_sdk
version: 1.6.0
description: TypeScript guide for @eulerxyz/euler-v2-sdk: reads, simulation and execution. Knowledge only, MIT, from Euler Labs. No API key. Moving funds still needs the user's wallet.
triggers:
  - euler sdk
  - euler-v2-sdk
  - buildeulersdk
  - euler typescript
---

## Context

# Euler SDK Agent Skill

**Version 1.6.0**

Euler Labs

September 2026

> Generated from SKILL.md, metadata.json, and rules/. Edit those sources and run pnpm build.

Euler V2 SDK integration guide for building production UIs, automation scripts, and developer tooling on top of @eulerxyz/euler-v2-sdk.

## Table of Contents

- [SDK Foundations](#1-sdk-foundations)
  - [SDK Architecture and Service Boundaries](#sdk-architecture-sdk-architecture-and-service-boundaries)
  - [UI Data Layer with Fetch Options and Population](#sdk-ui-data-layer-ui-data-layer-with-fetch-options-and-population)
- [Execution Safety](#2-execution-safety)
  - [Transaction Planning and Execution](#sdk-execution-flow-transaction-planning-and-execution)
  - [Pre-Execution Simulation and Safety Gates](#sdk-simulation-safety-pre-execution-simulation-and-safety-gates)
- [Runtime Performance](#3-runtime-performance)
  - [Query Decoration and Caching with buildQuery](#sdk-caching-buildquery-query-decoration-and-caching-with-buildquery)
  - [Fallback Adapter for V3 / Onchain Routing](#sdk-fallback-adapter-fallback-adapter-for-v3--onchain-routing)
  - [Plugin Integration for Read and Write Preconditions](#sdk-plugins-plugin-integration-for-read-and-write-preconditions)
- [Integration Patterns](#4-integration-patterns)
  - [Cross-Protocol Position Migration](#sdk-migrations-cross-protocol-position-migration)
  - [Script and Tooling Workflows from SDK Examples](#sdk-scripts-script-and-tooling-workflows-from-sdk-examples)
  - [Swap Quotes and Swap-Driven Execution Flows](#sdk-swaps-swap-quotes-and-swap-driven-execution-flows)

## 1. SDK Foundations

**Impact: HIGH**

Core architecture, service selection, and fetch option strategy for correct SDK usage in UIs and tools.

### sdk-architecture SDK Architecture and Service Boundaries

**Impact: HIGH (Prevents incorrect service usage and missing data in app state)**

Initialize the SDK once, treat services as layered APIs, and pick the right service boundary for each task.

**Incorrect (using typed vault service when vault type is unknown):**

```typescript
// WRONG: Fails for non-EVault addresses
const vault = await sdk.eVaultService.fetchVault(chainId, maybeAnyVault);
```

**Correct (route by type with vaultMetaService):**

```typescript
const { result: vault, errors } = await sdk.vaultMetaService.fetchVault(chainId, maybeAnyVault, {
  populateMarketPrices: true,
  populateRewards: true,
  populateIntrinsicApy: true,
  populateLabels: true,
});

if (!vault) throw new Error(errors[0]?.message ?? "Vault could not be resolved");
```

**Correct build pattern (single composition root):**

<!-- checked-example: sdk-build -->
```typescript
import { buildEulerSDK } from "@eulerxyz/euler-v2-sdk";

// Set EULER_SDK_RPC_URL_<chainId> in the environment for on-chain reads.
const sdk = await buildEulerSDK({
  config: {
    v3ApiUrl: process.env.EULER_SDK_V3_API_URL,
    v3ApiKey: process.env.EULER_SDK_V3_API_KEY,
  },
});
```

Built-in scalar config resolves as `config` prop, explicit SDK option, `EULER_SDK_*` env var, then default. Use [packages/euler-v2-sdk/docs/config-through-env.md](https://github.com/euler-xyz/euler-sdks/blob/ff224741c251cae7673c5f835dcf3bbccd9d6605/packages/euler-v2-sdk/docs/config-through-env.md) when adding runtime config.

Use these default boundaries:

- `accountService`: account/sub-account portfolio state
- `vaultMetaService`: mixed/unknown vault types
- `walletService`: native/ERC20 wallet balances and direct/Permit2 allowance state
- `executionService`: transaction planning, approvals, batch encoding, execution, and post-state preview
- `swapService`: quotes and providers
- `rewardsService`: reward reads and provider-specific claim planning
- `reulLockService`: rEUL vesting lock reads and unlock transaction plans
- `safeAccountService`: Safe smart-account detection and signer configuration (threshold/owners) reads
- `eulerLabelsService`: normalized off-chain labels metadata; use exported helpers from `utils/eulerLabels` for product/vault flags, notices, and restrictions
- `oracleAdapterService`: Data V3 oracle adapter recognition and health assessments plus indexed router state; assessment maps use normalized adapter addresses

Most service `fetch*` methods return `{ result, errors }`; keep diagnostics with the fetched entity when rendering warnings or enforcing data-quality policy. `oracleAdapterService` returns assessments and routers directly, while `safeAccountService.fetchSafeAccount()` returns `SafeAccountInfo | null` directly.

Reference: [packages/euler-v2-sdk/docs/services.md](https://github.com/euler-xyz/euler-sdks/blob/ff224741c251cae7673c5f835dcf3bbccd9d6605/packages/euler-v2-sdk/docs/services.md), [packages/euler-v2-sdk/docs/config-through-env.md](https://github.com/euler-xyz/euler-sdks/blob/ff224741c251cae7673c5f835dcf3bbccd9d6605/packages/euler-v2-sdk/docs/config-through-env.md), [packages/euler-v2-sdk/docs/wallet-service.md](https://github.com/euler-xyz/euler-sdks/blob/ff224741c251cae7673c5f835dcf3bbccd9d6605/packages/euler-v2-sdk/docs/wallet-service.md), [packages/euler-v2-sdk/docs/reul-lock-service.md](https://github.com/euler-xyz/euler-sdks/blob/ff224741c251cae7673c5f835dcf3bbccd9d6605/packages/euler-v2-sdk/docs/reul-lock-service.md), [packages/euler-v2-sdk/docs/entity-diagnostics.md](https://github.com/euler-xyz/euler-sdks/blob/ff224741c251cae7673c5f835dcf3bbccd9d6605/packages/euler-v2-sdk/docs/entity-diagnostics.md), [docs/data-architecture.md](https://github.com/euler-xyz/euler-sdks/blob/ff224741c251cae7673c5f835dcf3bbccd9d6605/packages/euler-v2-sdk/docs/data-architecture.md), [src/sdk/buildSDK.ts](https://github.com/euler-xyz/euler-sdks/blob/ff224741c251cae7673c5f835dcf3bbccd9d6605/packages/euler-v2-sdk/src/sdk/buildSDK.ts)


The rest of this guide is in the upstream MIT repo: https://github.com/euler-xyz/agent-skills — this pack keeps the opening rules so a local model can hold them.

Source: https://github.com/euler-xyz/agent-skills (MIT). Vendored for DAI Miner 0.4.40.
