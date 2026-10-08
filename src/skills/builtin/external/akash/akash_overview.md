---
id: akash_overview
version: 1.0.0
description: Akash Network — the decentralized, permissionless cloud compute marketplace (GPU/CPU) and its MCP server for AI agents. Use when a task wants to deploy, lease, or manage compute on Akash, or needs AKT/SDL/provider concepts.
triggers:
  - akash
  - akash network
  - akt
  - akash deploy
  - akash mcp
  - sdl deployment
  - decentralized gpu marketplace
  - akash provider
  - akash lease
---

## Context

# Akash Network — Overview for AI Agents

## What Is Akash Network?

Akash is a decentralized, permissionless marketplace for cloud compute (CPU, GPU, storage, bandwidth) built on the Cosmos SDK. Instead of renting from a single centralized cloud, a tenant publishes a deployment spec and independent providers compete for it with bids; the tenant accepts a bid and the workload runs on that provider's hardware. Payment and the deployment lifecycle are tracked on-chain in AKT.

Core lifecycle:

| Step | Action |
|------|--------|
| 1. Write an SDL | A YAML "Stack Definition Language" file describing the workload (image, resources, expose ports, placement/pricing) |
| 2. Create Deployment | Broadcast the SDL on-chain; this opens an on-chain order |
| 3. Bids | Providers watching the order submit price bids |
| 4. Create Lease | Tenant accepts a bid, creating a lease with that provider |
| 5. Send Manifest | Tenant pushes the actual manifest to the provider's endpoint so it starts the containers |
| 6. Running | Provider exposes the service; tenant can query status, add escrow funds, or close the deployment |

This is conceptually close to DAI's own job-board model (open → claimed/bid → result) but Akash's unit is a whole workload/container lease, not a single compute job, and the market clears in AKT rather than DAI.

## MCP Server — `akash-network/mcp`

Akash ships an official Model Context Protocol server (`https://github.com/akash-network/mcp`) that exposes the deployment lifecycle as typed tools, so an agent can drive it directly instead of shelling out to the `akash`/`provider-services` CLIs.

**Start it:**
- `akt mcp` — read-only mode (query tools only)
- `akt mcp --enable-writes` — also enables mutating tools (create/close deployment, send manifest, etc.)
- `akt mcp --console-api-key <key>` — managed mode via Akash Console, no local wallet needed

**Auth (self-hosted mode):** the server needs an Akash wallet to sign anything mutating — set `AKASH_MNEMONIC` or `AKASH_PRIVATE_KEY` (64-char hex) plus `AKASH_RPC_URL` (e.g. `https://rpc.akashnet.net:443`) as env vars when launching it. There is no way to use the write tools without a funded Akash account behind them — this is **not** a no-auth endpoint, so it does not belong in DAI's default no-auth MCP server list; it is credential-gated by design.

**Tools (13):**

| Tool | Purpose |
|------|---------|
| `GetAccountAddrTool` | Read the configured account's address |
| `GetBalancesTool` | Check AKT/uakt balances |
| `GetBidsTool` | List bids on an open deployment order |
| `CreateDeploymentTool` | Broadcast a new deployment from an SDL |
| `GetDeploymentTool` | Fetch deployment status/details |
| `CloseDeploymentTool` | Terminate a deployment |
| `AddFundsTool` | Deposit AKT into a deployment's escrow |
| `GetSDLsTool` | Browse available SDL templates |
| `GetSDLTool` | Fetch one SDL template by name |
| `SendManifestTool` | Push the manifest to the winning provider so it starts the service |
| `CreateLeaseTool` | Accept a bid, creating the lease |
| `GetServicesTool` | View running service details for a lease |
| `UpdateDeploymentTool` | Modify an existing deployment's SDL |

Read tools are annotated read-only; write tools are annotated destructive — an agent client should surface that distinction to a human before calling a write tool.

## When To Use This

- A request to deploy, price, or manage a workload "on Akash" or "on AKT".
- A request to compare Akash's bid/lease model against DAI's own job-board auction.
- A request to wire up or reason about the `akash-network/mcp` server's tool surface.

Not a fit for: general cloud-deployment questions with no Akash/AKT/SDL mention, or anything needing Akash write access when no Akash wallet credential is configured — surface that gap instead of guessing at a mnemonic.

---
Sources: `https://akash.network/docs/getting-started/ai-agents/` (Akash docs — not reachable from this node's fetch tooling at import time) and `https://github.com/akash-network/mcp` (README, fetched directly). Verify specifics against the live getting-started/ai-agents page when it's reachable.
