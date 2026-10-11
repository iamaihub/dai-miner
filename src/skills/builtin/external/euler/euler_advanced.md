---
id: euler_advanced
version: 1.1.0
description: Euler V2 hooks, flash loans, debt transfer, fee flow and EUL rewards. Knowledge only, MIT, from Euler Labs. No API key. Moving funds still needs the user's wallet.
triggers:
  - euler hooks
  - euler flash loan
  - fee flow
  - eul rewards
  - pulldebt
---

## Context

# Euler Advanced Features Agent Skill

**Version 1.1.0**

Euler Labs

September 2026

> Generated from SKILL.md, metadata.json, and rules/. Edit those sources and run pnpm build.

Advanced features guide for Euler Finance V2 protocol. Covers vault hooks for custom logic, flash loans and debt transfer, fee flow controller mechanics, and EUL reward token distribution. For power users building sophisticated integrations.

## Table of Contents

- [Advanced Features](#1-advanced-features)
  - [Fee Flow Controller Mechanics](#adv-fee-flow-fee-flow-controller-mechanics)
  - [Flash Loans and Debt Transfer](#adv-flashloan-pulldebt-flash-loans-and-debt-transfer)
  - [Vault Hooks and Use Cases](#adv-hooks-vault-hooks-and-use-cases)
  - [EUL Reward Token Distribution](#adv-rewards-eul-eul-reward-token-distribution)

## 1. Advanced Features

**Impact: MEDIUM**

Advanced protocol features for power users and integrators. Covers vault hooks for custom logic, flash loans with pull-debt patterns, fee flow and revenue distribution, and EUL token rewards/staking. These features enable sophisticated DeFi strategies and protocol integrations.

### adv-fee-flow Fee Flow Controller Mechanics

**Impact: MEDIUM (Understanding protocol revenue and fee distribution)**

FeeFlowController implements continuous Dutch auctions to sell accumulated protocol fees. It sells any assets it holds (typically vault shares from interest fees) in exchange for payment tokens sent to the DAO.

**Incorrect (expecting direct fee claiming):**

```solidity
// WRONG: Fees are not claimed directly from vaults
IEVault vault = IEVault(vaultAddress);
vault.claimFees(); // This doesn't exist!
```

**Correct (understanding fee flow architecture):**

```solidity
import {IEVault} from "evk/EVault/IEVault.sol";

IEVault vault = IEVault(vaultAddress);

// Interest fees accumulate in the vault as shares
// interestFee is the percentage of interest that goes to protocol
uint16 interestFee = vault.interestFee(); // e.g., 0.1e4 = 10%

// Accumulated fees are in vault shares
uint256 accumulatedFees = vault.accumulatedFees();

// The fee receiver is typically the FeeFlowController
address feeReceiver = vault.feeReceiver();

// convertFees() converts accumulated shares to the fee receiver
// Anyone can call this to trigger the conversion
// This must be called BEFORE buying from FeeFlowController
vault.convertFees();
```

**Correct (interacting with FeeFlowController):**

```solidity
import {FeeFlowController} from "fee-flow/FeeFlowController.sol";

FeeFlowController feeFlow = FeeFlowController(feeFlowAddress);

// Get current auction state
uint256 currentPrice = feeFlow.getPrice();
FeeFlowController.Slot0 memory slot0 = feeFlow.getSlot0();

// Auction parameters (immutable)
uint256 epochPeriod = feeFlow.epochPeriod();         // Auction duration
uint256 priceMultiplier = feeFlow.priceMultiplier(); // Price scaling (1.1e18 - 3e18)
uint256 minInitPrice = feeFlow.minInitPrice();       // Minimum starting price

// Payment token (what buyer pays)
address paymentToken = address(feeFlow.paymentToken());

// Payment receiver (where payment goes - DAO treasury)
address paymentReceiver = feeFlow.paymentReceiver();
```

**Correct (buying from the auction):**

```solidity
import {IERC20} from "openzeppelin-contracts/token/ERC20/IERC20.sol";

// Dutch auction: price starts high and decreases over epoch
// Anyone can buy all assets held by FeeFlowController at current price

// Step 1: Ensure fees have been converted to FeeFlowController
// (convertFees must be called on vaults separately)
vault.convertFees();

// Step 2: Check current price and epoch
FeeFlowController.Slot0 memory slot0 = feeFlow.getSlot0();
uint256 price = feeFlow.getPrice();

// Step 3: Specify which assets to receive (vault shares held by FeeFlowController)
address[] memory assets = new address[](2);
assets[0] = vault1Address;  // Vault 1 shares
assets[1] = vault2Address;  // Vault 2 shares

// Step 4: Approve payment token
IERC20(paymentToken).approve(address(feeFlow), price);

// Step 5: Buy all assets
// Transfers payment to paymentReceiver, sends assets to buyer
feeFlow.buy(
    assets,                    // Asset addresses to receive
    msg.sender,                // Receiver of assets
    slot0.epochId,             // Current epoch ID (prevents front-running)
    block.timestamp + 1 hours, // Deadline
    price * 101 / 100          // Max payment (with 1% slippage)
);
```

**Key FeeFlow Concepts:**

1. **Dutch Auction**: Price decreases linearly over epoch period (price = initPrice - initPrice * timePassed / epochPeriod)
2. **Epoch Reset**: After each buy, new auction starts with adjusted initial price
3. **Price Adaptation**: New initPrice = settlementPrice * priceMultiplier (clamped to min/max)
4. **Price at Epoch End**: If no one buys, price reaches 0 (assets are free)
5. **Manual Fee Conversion**: `convertFees()` must be called on vaults separately before buying

Reference: [FeeFlowController.sol](https://github.com/euler-xyz/fee-flow/blob/master/src/FeeFlowController.sol)

### adv-flashloan-pulldebt Flash Loans and Debt Transfer

**Impact: HIGH (Advanced borrowing operations for arbitrage and debt management)**

Euler vaults support flash loans (borrow and repay in same transaction) and debt transfer (pullDebt to take on another account's debt).

**Incorrect (not repaying flash loan in same transaction):**

```solidity
// WRONG: Flash loan MUST be repaid in same transaction
contract BadFlashBorrower {
    function attemptFlashLoan(address vault, uint256 amount) external {
        IEVault(vault).flashLoan(amount, "");
        // Missing repayment! This will revert with E_FlashLoanNotRepaid
    }

    function onFlashLoan(bytes memory) external {
        // Trying to keep the funds - WILL FAIL
        // Vault checks balance after callback returns
    }
}
```

**Correct (flash loan with proper repayment):**

```solidity
import {IFlashLoan} from "evk/interfaces/IFlashLoan.sol";

// Flash loans on Euler are FREE (no fee)
// Must implement IFlashLoan interface and repay in same tx

contract MyFlashBorrower is IFlashLoan {
    function executeFlashLoan(address vault, uint256 amount) external {
        // Request flash loan - vault transfers assets to this contract
        IEVault(vault).flashLoan(amount, abi.encode(/* your data */));
    }

    // Vault calls this after transferring assets
    function onFlashLoan(bytes memory data) external override {
        // Decode your data
        // ... do arbitrage, liquidation, etc ...

        // MUST return assets to vault before function ends
        // Vault checks: balanceOf(vault) >= originalBalance
        IERC20(asset).transfer(msg.sender, amount);
    }
}
```

**TypeScript: Flash loan via EVC batch:**

```typescript
// Flash loans can also be done via EVC batch with borrow/repay
// This doesn't require implementing IFlashLoan interface

const batchItems: BatchItem[] = [
  // 1. Borrow from a vault where you have credit
  {
    onBehalfOfAccount: myAccount,
    targetContract: sourceVault,
    value: 0n,
    data: encodeFunctionData({
      abi: evaultABI,
      functionName: 'borrow',
      args: [borrowAmount, myAccount],
    }),
  },
  // 2. Do your operation (swap, liquidate, etc.)
  {
    onBehalfOfAccount: myAccount,
    targetContract: swapRouter,
    value: 0n,
    data: swapCalldata,
  },
  // 3. Repay the borrow
  {
    onBehalfOfAccount: myAccount,
    targetContract: sourceVault,
    value: 0n,
    data: encodeFunctionData({
      abi: evaultABI,
      functionName: 'repay',
      args: [borrowAmount, myAccount],
    }),
  },
];

// Health check at end ensures you're solvent
await evc.batch(batchItems);
```

**Pull Debt (take on another account's debt):**

```solidity
// pullDebt transfers debt FROM another account TO you
// Useful for debt consolidation, account migration, or helping friends

// Requirements:
// 1. You must be authenticated (or operator for the account)
// 2. You must have the vault as controller
// 3. You must have sufficient collateral
// 4. Cannot pull from yourself (use repay instead)

// Pull all debt from another account
uint256 theirDebt = IEVault(vault).debtOf(fromAccount);

IEVault(vault).pullDebt(
    type(uint256).max,  // or specific amount
    fromAccount         // whose debt to take
);

// After: your debt increased, their debt decreased
// The debt + interest is transferred, not principal
```

**Use Case: Account Migration:**

```typescript
// Move debt from old sub-account to new one

const oldSubAccount = getSubAccountAddress(mainAccount, 1);
const newSubAccount = getSubAccountAddress(mainAccount, 2);

const batchItems: BatchItem[] = [
  // Setup new account with collateral
  {
    onBehalfOfAccount: newSubAccount,
    targetContract: collateralVault,
    value: 0n,
    data: encodeFunctionData({
      abi: evaultABI,
      functionName: 'deposit',
      args: [collateralAmount, newSubAccount],
    }),
  },
  // Enable collateral on new account
  {
    onBehalfOfAccount: zeroAddress,
    targetContract: evcAddress,
    value: 0n,
    data: encodeFunctionData({
      abi: evcABI,
      functionName: 'enableCollateral',
      args: [newSubAccount, collateralVault],
    }),
  },
  // Enable controller on new account
  {
    onBehalfOfAccount: zeroAddress,
    targetContract: evcAddress,
    value: 0n,
    data: encodeFunctionData({
      abi: evcABI,
      functionName: 'enableController',
      args: [newSubAccount, debtVault],
    }),
  },
  // Pull debt from old account to new account
  {
    onBehalfOfAccount: newSubAccount,
    targetContract: debtVault,
    value: 0n,
    data: encodeFunctionData({
      abi: evaultABI,
      functionName: 'pullDebt',
      args: [MaxUint256, oldSubAccount],
    }),
  },
];

await evc.batch(batchItems);
// Old account now has 0 debt, can withdraw collateral
```

Reference: [EVault Borrowing Module](https://github.com/euler-xyz/euler-vault-kit/blob/master/src/EVault/modules/Borrowing.sol)


The rest of this guide is in the upstream MIT repo: https://github.com/euler-xyz/agent-skills — this pack keeps the opening rules so a local model can hold them.

Source: https://github.com/euler-xyz/agent-skills (MIT). Vendored for DAI Miner 0.4.40.
