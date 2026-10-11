---
id: euler_vaults
version: 1.1.0
description: Euler V2 vaults: deposit, borrow, repay, EVC batching, health and liquidations. Knowledge only, MIT, from Euler Labs. No API key. Moving funds still needs the user's wallet.
triggers:
  - euler
  - euler vault
  - euler v2
  - evc
  - evk
  - euler borrow
  - euler lending
---

## Context

# Euler Finance Agent Skill

**Version 1.1.0**

Euler Labs

September 2026

> Generated from SKILL.md, metadata.json, and rules/. Edit those sources and run pnpm build.

Core guide for interacting with Euler Finance V2 protocol. Covers vault operations (deposit, borrow, repay), EVC orchestration (batching, sub-accounts, operators), risk management (health factors, liquidation), architecture concepts (vault types, market design), interest rate models, security practices, and developer tools. For specialized topics, see companion skills: euler-irm-oracles, euler-earn, euler-advanced.

## Table of Contents

- [Vault Operations](#1-vault-operations)
  - [Borrow Assets from a Vault](#vault-borrow-borrow-assets-from-a-vault)
  - [Create a New Vault/Market](#vault-create-market-create-a-new-vaultmarket)
  - [Deposit Assets into a Vault](#vault-deposit-deposit-assets-into-a-vault)
  - [Get Vault APY and Interest Rates](#vault-get-apy-get-vault-apy-and-interest-rates)
  - [Repay Borrowed Debt](#vault-repay-repay-borrowed-debt)
- [EVC Operations](#2-evc-operations)
  - [Batch Multiple Operations Atomically](#evc-batch-batch-multiple-operations-atomically)
  - [Enable Vault as Collateral](#evc-enable-collateral-enable-vault-as-collateral)
  - [Delegate Control via Operators](#evc-operators-delegate-control-via-operators)
  - [Use Sub-Accounts for Isolated Positions](#evc-sub-accounts-use-sub-accounts-for-isolated-positions)
- [Risk Management](#3-risk-management)
  - [Check Account Health Factor](#risk-check-health-check-account-health-factor)
  - [How Liquidation Works on Euler](#risk-liquidation-how-liquidation-works-on-euler)
  - [Understanding Risk Managers and Vault Governance](#risk-managers-understanding-risk-managers-and-vault-governance)
- [Architecture](#4-architecture)
  - [Understanding Euler Market Design](#arch-market-design-understanding-euler-market-design)
  - [Understanding Vault Types (Governed, Ungoverned, Escrowed Collateral)](#arch-vault-types-understanding-vault-types-governed-ungoverned-escrowed-collateral)
- [Security](#5-security)
  - [Security and Audits](#sec-audits-security-and-audits)

## 1. Vault Operations

**Impact: CRITICAL**

Core lending and borrowing operations on Euler V2 vaults. These are the fundamental building blocks for interacting with Euler - depositing collateral, borrowing assets, and managing positions. Understanding these operations is essential for any integration.

### vault-borrow Borrow Assets from a Vault

**Impact: CRITICAL (Core lending operation with liquidation risk)**

Borrowing on Euler requires enabling the vault as your controller and having sufficient collateral enabled. This creates a debt position that accrues interest.

**Incorrect (borrowing without enabling controller):**

```solidity
// This will revert - vault is not enabled as controller
IEVault(vault).borrow(amount, receiver);
// Error: E_ControllerDisabled
```

**Incorrect (borrowing without collateral):**

```solidity
// Enable controller but forget collateral
IEVC(evc).enableController(account, vault);
IEVault(vault).borrow(amount, receiver);
// Error: E_AccountLiquidity - no collateral to back the loan
```

**Correct (full borrow flow):**

```solidity
// Step 1: Deposit collateral into a collateral vault
IERC20(collateralAsset).approve(collateralVault, collateralAmount);
IEVault(collateralVault).deposit(collateralAmount, account);

// Step 2: Enable the collateral vault for your account
IEVC(evc).enableCollateral(account, collateralVault);

// Step 3: Enable the borrow vault as your controller
// This gives the vault authority to check your account status
IEVC(evc).enableController(account, borrowVault);

// Step 4: Borrow assets
// - amount: how much to borrow
// - receiver: who receives the borrowed assets
uint256 borrowed = IEVault(borrowVault).borrow(amount, receiver);
```

**Correct (batched borrow via EVC for atomicity):**

```typescript
// Batch all operations for gas efficiency and atomicity
const batchItems = [
  // Deposit collateral
  {
    targetContract: collateralVault,
    onBehalfOfAccount: account,
    value: 0n,
    data: encodeFunctionData({
      abi: eVaultABI,
      functionName: 'deposit',
      args: [collateralAmount, account],
    }),
  },
  // Enable collateral (EVC call - onBehalfOfAccount must be address(0))
  {
    targetContract: evcAddress,
    onBehalfOfAccount: '0x0000000000000000000000000000000000000000',
    value: 0n,
    data: encodeFunctionData({
      abi: evcABI,
      functionName: 'enableCollateral',
      args: [account, collateralVault],
    }),
  },
  // Enable controller (EVC call - onBehalfOfAccount must be address(0))
  {
    targetContract: evcAddress,
    onBehalfOfAccount: '0x0000000000000000000000000000000000000000',
    value: 0n,
    data: encodeFunctionData({
      abi: evcABI,
      functionName: 'enableController',
      args: [account, borrowVault],
    }),
  },
  // Borrow
  {
    targetContract: borrowVault,
    onBehalfOfAccount: account,
    value: 0n,
    data: encodeFunctionData({
      abi: eVaultABI,
      functionName: 'borrow',
      args: [borrowAmount, account],
    }),
  },
];

await evc.batch(batchItems);
```

Important considerations:
- You can only have ONE controller per account (for single-liability)
- Use sub-accounts to hold multiple different borrows
- Monitor your health factor to avoid liquidation
- The borrow LTV must be satisfied at all times

Reference: [EVC Whitepaper - Controller](https://github.com/euler-xyz/ethereum-vault-connector/blob/master/docs/whitepaper.md#controller)

### vault-create-market Create a New Vault/Market

**Impact: HIGH (Deploy new lending markets for any asset)**

Creating new Euler vaults allows you to establish lending markets for ERC-20 tokens. Use [euler-vault-scripts](https://github.com/euler-xyz/euler-vault-scripts) for deployment and management.

**Using euler-vault-scripts for cluster deployment:**

A cluster is a collection of vaults that accept each other as collateral and share a common governor. The scripts handle both initial deployment and ongoing management.

```bash
# Clone euler-vault-scripts repository
git clone https://github.com/euler-xyz/euler-vault-scripts
cd euler-vault-scripts

# Install dependencies
./install.sh
forge clean && forge compile

# Edit cluster configuration (copy and modify Cluster.s.sol)
# Define assets, LTVs, oracle providers, caps, IRM parameters, etc.

# Dry run first (always!)
./script/ExecuteSolidityScript.sh ./script/clusters/Cluster.s.sol --dry-run --rpc-url 1

# Deploy (initial deployment)
./script/ExecuteSolidityScript.sh ./script/clusters/Cluster.s.sol --account DEPLOYER --rpc-url 1

# Management after governance transfer (via Safe + Timelock)
./script/ExecuteSolidityScript.sh ./script/clusters/Cluster.s.sol \
  --batch-via-safe --safe-address DAO --timelock-address wildcard --rpc-url 1
```

The cluster script (Cluster.s.sol) defines:
- Assets and their vaults
- LTV ratios between collateral/borrow pairs
- Oracle providers for each asset
- Supply and borrow caps
- Interest rate model parameters
- Hooks and flags

The scripts apply deltas - if vaults already exist, only the difference between configuration and current state is applied.

Key parameters to configure:

| Parameter | Description |
|-----------|-------------|
| Asset | Underlying ERC-20 token |
| Oracle | EulerRouter configured for price feeds |
| Unit of Account | Common denomination (USD, ETH, etc.) |
| LTV (borrow/liquidation) | Collateral requirements |
| Caps (supply/borrow) | Exposure limits |
| IRM | Interest rate model parameters |
| Governor | Address controlling vault parameters |

Important considerations:
- Always use `--dry-run` first to simulate transactions
- Configure appropriate LTV ratios for risk management
- Set reasonable caps to limit protocol exposure
- Consider using governance contracts (GovernorAccessControl + TimelockController + Safe)
- Governor can be set to address(0) for immutability (ungoverned vault)

References:
- [euler-vault-scripts](https://github.com/euler-xyz/euler-vault-scripts)
- [EVK Whitepaper](https://docs.euler.finance/euler-vault-kit-white-paper/)

### vault-deposit Deposit Assets into a Vault

**Impact: CRITICAL (Fundamental operation for supplying liquidity)**

Depositing assets into an Euler vault is the first step to earning yield or using assets as collateral. Euler vaults are ERC-4626 compliant.

**Incorrect (forgetting to approve tokens first):**

```solidity
// This will revert - vault cannot pull tokens without approval
IEVault(vault).deposit(amount, receiver);
```

**Correct (approve then deposit):**

```solidity
// Step 1: Approve the vault to spend your tokens
IERC20(asset).approve(vault, amount);

// Step 2: Deposit assets and receive vault shares
// - amount: the amount of underlying assets to deposit
// - receiver: address that will receive the vault shares
uint256 shares = IEVault(vault).deposit(amount, receiver);
```

Euler vaults also support [Permit2](https://github.com/Uniswap/permit2) for gasless approvals.

**Correct (using mint instead of deposit):**

```solidity
// Alternative: specify exact shares you want to receive
// Useful when you need a precise share amount
uint256 assetsRequired = IEVault(vault).previewMint(sharesWanted);
IERC20(asset).approve(vault, assetsRequired);
uint256 assets = IEVault(vault).mint(sharesWanted, receiver);
```

After depositing, you can enable the vault as collateral via EVC to borrow from other vaults:

```solidity
// Enable this vault as collateral for your account
IEVC(evc).enableCollateral(account, vault);
```

Reference: [ERC-4626 Standard](https://eips.ethereum.org/EIPS/eip-4626)


The rest of this guide is in the upstream MIT repo: https://github.com/euler-xyz/agent-skills — this pack keeps the opening rules so a local model can hold them.

Source: https://github.com/euler-xyz/agent-skills (MIT). Vendored for DAI Miner 0.4.40.
