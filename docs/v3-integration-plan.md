# v3 Agent Visual Identity System — Integration Plan

## Overview

AIL v3 is a separate RPG-style visual identity system for AI agents.
Goal: Bundle v2 (credential + NFT ID card) + v3 (visual avatar) as a premium paid service.

## Integration Architecture

```
┌─────────────────────────────────────────────────────┐
│                   AIL Platform                       │
│                                                      │
│   v2 Core (Free)              v3 Visual (Paid)       │
│   ┌──────────────┐           ┌──────────────────┐   │
│   │ EC P-256 Keys│           │ RPG Avatar Gen    │   │
│   │ JWT Credential│  ────►   │ Character Sheet   │   │
│   │ NFT ID Card  │  link     │ Animated Sprites  │   │
│   │ Signal Glyph │           │ Profile Banner    │   │
│   └──────────────┘           └──────────────────┘   │
│         │                           │                │
│         ▼                           ▼                │
│   ERC-721 NFT              ERC-721 Visual NFT       │
│   (identity)               (avatar, bundled)         │
└─────────────────────────────────────────────────────┘
```

## Integration Points

### 1. API Endpoint Extension

Add to v2 API server (or separate Workers):

```
POST /agents/:ail_id/visual      — Generate v3 visual identity (paid)
GET  /agents/:ail_id/avatar      — Serve avatar image
GET  /agents/:ail_id/avatar/metadata — ERC-721 metadata for visual NFT
```

### 2. Database Extension

```sql
ALTER TABLE agents ADD COLUMN visual_tier TEXT;        -- 'free' | 'pro' | 'enterprise'
ALTER TABLE agents ADD COLUMN visual_svg  TEXT;        -- v3 avatar SVG
ALTER TABLE agents ADD COLUMN visual_nft_token_id TEXT;
```

### 3. Pricing Tiers

| Tier | Price | Includes |
|---|---|---|
| Free | $0 | v2 ID card + JWT credential |
| Pro | $5/agent | v2 + v3 RPG avatar + animated sprite |
| Enterprise | $20/agent | Pro + custom theme + bulk API |

### 4. Payment Integration

- Stripe Checkout for one-time per-agent payment
- Or crypto payment (USDC on Base) for on-chain native experience

### 5. Technical Steps

1. Import v3 image generation module into v2 codebase
2. Add `/visual` routes that call v3 generator with agent data
3. Optional: Mint separate "Visual NFT" linked to the identity NFT
4. Add Stripe webhook handler for payment verification

## Timeline Estimate

- Phase 1: API integration + free preview (1 week)
- Phase 2: Payment + tier system (1 week)
- Phase 3: Visual NFT minting (3 days)

## Open Questions

- Should v3 visual be a separate NFT collection or same contract?
- Payment: Stripe only, crypto only, or both?
- v3 repo needs to be reviewed for Workers compatibility
