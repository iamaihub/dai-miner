---
id: euler_irm_oracles
version: 1.1.0
description: Euler V2 oracles and interest-rate models: Chainlink, Pyth, EulerRouter, kink IRMs. Knowledge only, MIT, from Euler Labs. No API key. Moving funds still needs the user's wallet.
triggers:
  - euler oracle
  - euler irm
  - eulerrouter
  - kink irm
  - euler price feed
---

## Context

# Euler IRM & Oracles Agent Skill

**Version 1.1.0**

Euler Labs

September 2026

> Generated from SKILL.md, metadata.json, and rules/. Edit those sources and run pnpm build.

Oracle and Interest Rate Model guide for Euler Finance V2 protocol. Covers deploying oracle adapters (Chainlink, Pyth, Chronicle, RedStone, Pendle), configuring EulerRouter for price resolution, querying asset prices, and understanding IRM types (Linear Kink, Linear Kinky, Adaptive Curve, Fixed Cyclical Binary).

## Table of Contents

- [Oracle Integration](#1-oracle-integration)
  - [Configure EulerRouter for Price Resolution](#oracle-configure-router-configure-eulerrouter-for-price-resolution)
  - [Deploy an Oracle Adapter](#oracle-deploy-deploy-an-oracle-adapter)
  - [Get Asset Prices from Oracles](#oracle-get-price-get-asset-prices-from-oracles)
- [Interest Rate Models](#2-interest-rate-models)
  - [Interest Rate Model Types and Configuration](#irm-models-interest-rate-model-types-and-configuration)

## 1. Oracle Integration

**Impact: HIGH**

Oracle integration guide for Euler Finance V2 protocol. Covers deploying oracle adapters (Chainlink, Pyth, Chronicle, RedStone, Cross, Fixed Rate), configuring EulerRouter for price resolution, and querying asset prices. Essential for vault creation and price feed management.

### oracle-configure-router Configure EulerRouter for Price Resolution

**Impact: HIGH (Central oracle routing for vault pricing)**

EulerRouter is the central price resolution contract that routes price queries to appropriate oracle adapters. It supports direct pricing and ERC-4626 vault share pricing via `convertToAssets`.

**Incorrect (hardcoding oracle in vault):**

```solidity
// Don't hardcode individual oracles in vaults
// This makes upgrades and fixes impossible
IEVault(vault).setOracle(specificOracleAdapter);
// If oracle has issues, vault is stuck
```

**Correct (deploy and configure EulerRouter):**

```solidity
import {EulerRouter} from "euler-price-oracle/EulerRouter.sol";
import {EulerRouterFactory} from "evk-periphery/EulerRouterFactory/EulerRouterFactory.sol";

// Deploy router via factory
// Note: Factory was initialized with EVC address in its constructor
address router = EulerRouterFactory(factory).deploy(governor);

// Configure pricing for asset pairs
EulerRouter eulerRouter = EulerRouter(router);

// Set direct oracle for ETH/USD
// Note: Assets are lexicographically sorted internally
eulerRouter.govSetConfig(
    weth,                    // Base asset
    usd,                     // Quote asset
    chainlinkEthUsdOracle    // Oracle adapter address
);

// Set direct oracle for BTC/USD
eulerRouter.govSetConfig(
    wbtc,
    usd,
    chainlinkBtcUsdOracle
);
```

**Correct (understanding resolution - NO automatic cross-pricing):**

```solidity
// IMPORTANT: EulerRouter does NOT automatically chain oracles!
// For TOKEN/USD pricing, you must EITHER:
// 1. Configure a direct TOKEN/USD oracle, OR
// 2. Use a CrossAdapter that handles the cross-pricing internally

// Resolution order in resolveOracle():
// 1. base == quote? Return inAmount (same asset)
// 2. Direct oracle configured for base/quote? Use it
// 3. Base is a resolved ERC4626 vault? Convert via convertToAssets, recurse
// 4. Fallback oracle set? Use it
// 5. Revert with PriceOracle_NotSupported

// Example: If you need TOKEN/USD via TOKEN/ETH and ETH/USD,
// use a CrossAdapter, not multiple govSetConfig calls
import {CrossAdapter} from "euler-price-oracle/adapter/CrossAdapter.sol";

// Deploy cross adapter that chains TOKEN/ETH -> ETH/USD
// Constructor: (base, cross, quote, oracleBaseCross, oracleCrossQuote)
// Note: Both cross oracles MUST be bidirectional. Does not support bid/ask pricing.
CrossAdapter crossAdapter = new CrossAdapter(
    tokenAddress,     // base: the asset you want to price
    weth,             // cross: intermediate asset (e.g., WETH)
    usd,              // quote: the unit of account
    tokenEthOracle,   // oracleBaseCross: TOKEN/ETH oracle (must be bidirectional)
    ethUsdOracle      // oracleCrossQuote: ETH/USD oracle (must be bidirectional)
);

// Configure router with the cross adapter
eulerRouter.govSetConfig(tokenAddress, usd, crossAdapter);
```

**Correct (ERC-4626 vault share pricing):**

```solidity
// For pricing vault shares in terms of underlying
// Router uses convertToAssets() for automatic share->asset conversion

// Configure underlying asset pricing first
eulerRouter.govSetConfig(
    underlyingAsset,
    usd,
    underlyingOracle
);

// Enable vault share resolution
// Router will call vault.convertToAssets() and recurse
eulerRouter.govSetResolvedVault(
    vaultAddress,
    true  // Enable automatic share->asset conversion
);

// To disable later:
eulerRouter.govSetResolvedVault(vaultAddress, false);

// Now queries for vault shares work:
// vaultShares -> convertToAssets -> underlying -> USD
uint256 shareValueUsd = eulerRouter.getQuote(1e18, vaultAddress, usd);

// IMPORTANT: Verify vault's convertToAssets is secure before configuring!
// Per ERC4626 spec, convert* ignores liquidity, fees, slippage
// The reported price may not be realizable through redeem/withdraw
```

**Example: Pricing sUSDS (ERC4626 vault for USDS) as collateral**

For yield-bearing tokens like sUSDS used as collateral in an Euler vault, you need to configure the full pricing chain:

```solidity
// sUSDS is an ERC4626 vault wrapping USDS
// To use sUSDS as collateral and price the Euler vault shares, the router needs:
// 1. USDS/USD pricing (the base asset)
// 2. sUSDS registered as a resolved vault (for pricing sUSDS)
// 3. The Euler vault registered as a resolved vault (for pricing vault shares)

// Step 1: Configure USDS/USD pricing
eulerRouter.govSetConfig(
    usds,                  // base: USDS token
    usd,                   // quote: USD reference
    usdsUsdOracle          // oracle: e.g., Chainlink USDS/USD feed
);

// Step 2: Register sUSDS as a resolved vault
// This allows pricing sUSDS collateral via convertToAssets → USDS → USD
eulerRouter.govSetResolvedVault(
    susds,                 // sUSDS vault address
    true                   // enable resolution
);

// Step 3: Register the Euler vault as a resolved vault
// This allows pricing the Euler vault's shares (e.g., for use as collateral elsewhere)
eulerRouter.govSetResolvedVault(
    eulerVaultSUSDS,       // Euler vault that accepts sUSDS deposits
    true                   // enable resolution
);

// Now the router can price at each level:

// Price sUSDS directly:
// Query: getQuote(1e18, sUSDS, USD)
// Path: sUSDS → convertToAssets → USDS → USDS/USD oracle → USD
uint256 susdsValueInUsd = eulerRouter.getQuote(1e18, susds, usd);

// Price Euler vault shares:
// Query: getQuote(1e18, eulerVaultSUSDS, USD)
// Path: eVault → convertToAssets → sUSDS → convertToAssets → USDS → USD
uint256 eVaultShareValueInUsd = eulerRouter.getQuote(1e18, eulerVaultSUSDS, usd);
```

**Correct (TypeScript router configuration):**

```typescript
import { encodeFunctionData, getContract } from 'viem';

const eulerRouter = getContract({
  address: routerAddress,
  abi: eulerRouterABI,
  client: walletClient
});

// Configure oracle for asset pair
// Note: gov functions require being called by governor via EVC context
await eulerRouter.write.govSetConfig([
  wethAddress,        // base
  usdAddress,         // quote
  chainlinkOracle     // oracle adapter
]);

// Configure resolved vault for share pricing
await eulerRouter.write.govSetResolvedVault([
  vaultAddress,
  true  // set = true to enable, false to disable
]);

// Query prices
const quote = await eulerRouter.read.getQuote([
  parseEther('1'),    // inAmount
  wethAddress,        // base
  usdAddress          // quote
]);

// Get bid/ask quotes
const [bid, ask] = await eulerRouter.read.getQuotes([
  parseEther('1'),
  wethAddress,
  usdAddress
]);

// Check configured oracle for a pair
const oracle = await eulerRouter.read.getConfiguredOracle([
  wethAddress,
  usdAddress
]);
```

**Correct (fallback configuration):**

```solidity
// Set fallback oracle for pairs without direct config
// Called when no direct oracle AND base is not a resolved vault
eulerRouter.govSetFallbackOracle(fallbackOracleAddress);

// To remove fallback:
eulerRouter.govSetFallbackOracle(address(0));

// Resolution order:
// 1. base == quote → return inAmount
// 2. Direct config for base/quote → use configured oracle
// 3. Base is resolved vault → convertToAssets, recurse with asset
// 4. Fallback oracle exists → use fallback
// 5. No fallback → revert PriceOracle_NotSupported(base, quote)
```

**Correct (querying existing configuration):**

```solidity
// Get configured oracle for a pair
// Returns address(0) if not configured
address oracle = eulerRouter.getConfiguredOracle(base, quote);

// Check if vault is configured for resolved pricing
address asset = eulerRouter.resolvedVaults(vaultAddress);
bool isResolved = asset != address(0);

// Get current fallback oracle
address fallback = eulerRouter.fallbackOracle();

// Simulate full resolution path
(uint256 resolvedAmount, address resolvedBase, address resolvedQuote, address resolvedOracle) =
    eulerRouter.resolveOracle(inAmount, base, quote);
```

**Important considerations:**

```solidity
// Gov functions have onlyEVCAccountOwner and onlyGovernor modifiers
// Must be called by governor, typically via EVC context

// Finalize router to make immutable (optional)
eulerRouter.transferGovernance(address(0));
// WARNING: No more configuration changes possible after this!

// For upgradeable setups, use a timelock or multisig as governor
// This allows fixing oracle issues without vault redeployment

// Assets are lexicographically sorted internally in the mapping
// govSetConfig(A, B, oracle) and govSetConfig(B, A, oracle)
// configure the same pair - order doesn't matter for callers
```

Reference: [EulerRouter Source](https://github.com/euler-xyz/euler-price-oracle/blob/master/src/EulerRouter.sol)


The rest of this guide is in the upstream MIT repo: https://github.com/euler-xyz/agent-skills — this pack keeps the opening rules so a local model can hold them.

Source: https://github.com/euler-xyz/agent-skills (MIT). Vendored for DAI Miner 0.4.40.
