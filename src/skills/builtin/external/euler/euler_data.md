---
id: euler_data
version: 1.1.0
description: Euler V2 reads: Lens contracts, the subgraph, ABIs and vault creation. Knowledge only, MIT, from Euler Labs. No API key. Moving funds still needs the user's wallet.
triggers:
  - euler lens
  - euler subgraph
  - vaultlens
  - euler abi
  - euler data
---

## Context

# Euler Lens & Data Agent Skill

**Version 1.1.0**

Euler Labs

September 2026

> Generated from SKILL.md, metadata.json, and rules/. Edit those sources and run pnpm build.

Developer tools and data access guide for Euler Finance V2. Covers Lens contracts for querying vault data, subgraph queries for historical data, contract interfaces and ABIs, and no-code vault deployment via Euler Creator.

## Table of Contents

- [Developer Tools](#1-developer-tools)
  - [Contract Addresses and ABIs](#tools-interfaces-contract-addresses-and-abis)
  - [Lens Contracts and SDK Data Reads](#tools-lens-lens-contracts-and-sdk-data-reads)
  - [Data Querying with Subgraphs](#tools-subgraphs-data-querying-with-subgraphs)

## 1. Developer Tools

**Impact: MEDIUM**

Tools and resources for developers including Lens contracts for querying vault and account data, subgraph for tracking active accounts, and contract addresses and ABIs. Essential for efficient Euler development and integration.

### tools-interfaces Contract Addresses and ABIs

**Impact: HIGH (Resolve chain-specific deployments and matching contract interfaces)**

Use the SDK deployment and ABI services for application integrations, or the canonical [euler-interfaces repository](https://github.com/euler-xyz/euler-interfaces) for source artifacts. Check the selected chain and deployment before encoding a transaction.

**Correct (SDK 3.4.0 deployment and ABI access):**

<!-- checked-example: interface-services -->
```typescript
import { buildEulerSDK } from "@eulerxyz/euler-v2-sdk";

const sdk = await buildEulerSDK();
const chainId = 1;
const deployment = sdk.deploymentService.getDeployment(chainId);
const evcAddress = deployment.addresses.coreAddrs.evc;
const vaultLensAddress = deployment.addresses.lensAddrs.vaultLens;
const evcAbi = await sdk.abiService.fetchABI(chainId, "EthereumVaultConnector");

console.log({ evcAddress, vaultLensAddress, evcAbi });
```

The SDK uses live upstream sources by default. Dynamic ABIs have runtime types; use the SDK's typed services for entity reads, or generate typed bindings from a reviewed ABI snapshot. The constructor option `abiServiceConfig.eulerInterfacesBranch` selects a branch, not a commit SHA. For reproducible source artifacts, check out a specific revision:

**Correct (reviewed source checkout):**

```bash
git clone https://github.com/euler-xyz/euler-interfaces.git
git -C euler-interfaces checkout d0e9a428523b3de6cb3e6c7a06ad55b6e59223f3
```

The checkout contains:

- `addresses/<chainId>/CoreAddresses.json`, `LensAddresses.json`, and `PeripheryAddresses.json`
- `abis/<Contract>.json`
- `interfaces/I<Contract>.sol`
- `verify/manifest.json` and per-chain bytecode verification reports

When consuming a fixed snapshot, reconcile its deployment addresses and implementation revision with the target chain before use. Review the verification reports for source/audit provenance; factory membership alone does not establish economic safety.

For Solidity EVC integration, import `IEVC` from `ethereum-vault-connector/interfaces/IEthereumVaultConnector.sol` in the EVC source dependency. Foundry remappings should point to the checked-out dependencies' `src/` directories.

Reference: [Canonical interfaces and verification](https://github.com/euler-xyz/euler-interfaces/tree/d0e9a428523b3de6cb3e6c7a06ad55b6e59223f3), [SDK ABI service](https://github.com/euler-xyz/euler-sdks/blob/ff224741c251cae7673c5f835dcf3bbccd9d6605/packages/euler-v2-sdk/src/services/abiService/abiService.ts)

### tools-lens Lens Contracts and SDK Data Reads

**Impact: HIGH (Read typed vault and account state with explicit diagnostics)**

Use the SDK's typed services for application state. Data V3 supplies indexed data; on-chain adapters read current contract state through Lens contracts. Choose adapter/fallback policy explicitly for the application's latency and freshness requirements. Historical activity is a separate indexed-data concern.

**Correct (typed account read with diagnostics):**

<!-- checked-example: account-read -->
```typescript
import type { Address } from "viem";
import type { EulerSDK } from "@eulerxyz/euler-v2-sdk";

export async function readPortfolio(sdk: EulerSDK, chainId: number, owner: Address) {
  const { result: account, errors } = await sdk.accountService.fetchAccount(chainId, owner, {
    populateVaults: true,
    populateMarketPrices: true,
    populateUserRewards: true,
    vaultFetchOptions: {
      populateMarketPrices: true,
      populateCollaterals: true,
      populateRewards: true,
      populateIntrinsicApy: true,
    },
  });
  if (!account) throw new Error(errors[0]?.message ?? "Account unavailable");
  return { account, errors };
}
```

Keep diagnostics beside the entity; missing/failed data is not a zero balance. Populate only the data needed for the screen, and check the entity's population flags before using dependent computed metrics.

| Lens | Purpose |
|------|---------|
| AccountLens | Account/vault positions, EVC state, liquidity and time to liquidation |
| VaultLens | EVK configuration, LTVs, cash, debt and IRM data |
| OracleLens | Oracle configuration and adapter metadata |
| IRMLens | Interest-rate-model configuration |
| UtilsLens | APYs, token balances, allowances and price utilities |
| EulerEarnVaultLens | Earn configuration, strategies and allocations |

**Correct (low-level Lens eth_call):**

Obtain `deployment` and `vaultLensAbi` through the services in the interfaces rule. Some Lens entrypoints are non-view because they simulate updates; `simulateContract` uses `eth_call` without submitting a transaction.

```typescript
const { result } = await publicClient.simulateContract({
  address: deployment.addresses.lensAddrs.vaultLens,
  abi: vaultLensAbi,
  functionName: "getVaultInfoFull",
  args: [vaultAddress],
});
console.log(result);
```

For Pyth/other read preconditions, use SDK plugins and the SDK's Lens batch-simulation path. A direct Lens call does not add price updates for you. For on-chain contracts, use specific vault methods such as `accountLiquidity(account, true)` rather than gas-heavy Lens aggregation.

Health is liquidation-adjusted collateral value divided by liability value. Use bigint/fixed-point arithmetic and check query-failure diagnostics. Time-to-liquidation is a model under fixed prices/rates, not a safety guarantee; preserve its special infinity/error/liquidatable values.

Use `rewardsService` for provider-aware claims and rewards. AccountLens on-chain reward streams do not cover every off-chain provider.

Reference: [SDK services](https://github.com/euler-xyz/euler-sdks/blob/ff224741c251cae7673c5f835dcf3bbccd9d6605/packages/euler-v2-sdk/docs/services.md), [Lens read simulation](https://github.com/euler-xyz/euler-sdks/blob/ff224741c251cae7673c5f835dcf3bbccd9d6605/packages/euler-v2-sdk/docs/simulations-and-state-overrides.md), [Lens contracts](https://github.com/euler-xyz/evk-periphery/tree/26e5b883d42a08e8a0b6b63c72a28050c40bbfdd/src/Lens)


The rest of this guide is in the upstream MIT repo: https://github.com/euler-xyz/agent-skills — this pack keeps the opening rules so a local model can hold them.

Source: https://github.com/euler-xyz/agent-skills (MIT). Vendored for DAI Miner 0.4.40.
