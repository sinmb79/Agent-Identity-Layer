# Fly.io → Cloudflare Workers Migration Guide

## Architecture Changes

| Component | Fly.io (Before) | Cloudflare (After) |
|---|---|---|
| Framework | Fastify v4 | Hono v4 |
| Database | node:sqlite (DatabaseSync) | Cloudflare D1 |
| Email | nodemailer (SMTP) | Resend fetch API |
| Crypto | node:crypto | Web Crypto API |
| Hosting | Fly.io VM (nrt region) | Cloudflare Edge (global) |
| Static | Cloudflare Pages | Cloudflare Pages (unchanged) |

## Migration Steps

### 1. Install dependencies

```bash
npm install hono wrangler
```

### 2. Create D1 database

```bash
npx wrangler d1 create ail-db
```

Copy the `database_id` from the output into `wrangler.toml`:

```toml
[[d1_databases]]
binding = "DB"
database_name = "ail-db"
database_id = "YOUR_DATABASE_ID_HERE"
```

### 3. Set secrets

```bash
# Required
npx wrangler secret put MASTER_KEY_JSON    # paste JSON content of data/master-key.json
npx wrangler secret put ADMIN_API_KEY      # your admin key

# Optional — on-chain NFT
npx wrangler secret put CHAIN_RPC_URL
npx wrangler secret put CHAIN_PRIVATE_KEY
npx wrangler secret put NFT_CONTRACT_ADDRESS

# Optional — email
npx wrangler secret put RESEND_API_KEY
```

### 4. Local development

```bash
npx wrangler dev
```

### 5. Deploy

```bash
npx wrangler deploy
```

### 6. Custom domain

In Cloudflare dashboard:
1. Workers & Pages → ail-api → Settings → Domains & Routes
2. Add custom domain: `api.agentidcard.org`
3. Cloudflare handles DNS + SSL automatically (no need for separate CNAME)

### 7. Migrate existing data (if needed)

Export from Fly.io SQLite:
```bash
# On Fly.io
fly ssh console -a 22blabs-ail
sqlite3 /data/ail.db .dump > /tmp/dump.sql
# Download the dump
fly sftp get /tmp/dump.sql ./dump.sql -a 22blabs-ail
```

Import to D1:
```bash
npx wrangler d1 execute ail-db --file=./dump.sql
```

### 8. Decommission Fly.io

After verifying Cloudflare Workers is stable:
```bash
fly apps destroy 22blabs-ail
```

## API Compatibility

All endpoints remain identical:
- `POST /owners/register`
- `POST /owners/verify-email`
- `POST /agents/register`
- `DELETE /agents/:ail_id/revoke`
- `GET /agents/:ail_id/image`
- `GET /agents/:ail_id/metadata`
- `POST /verify`
- `GET /keys`, `GET /keys/:kid`
- `GET /dashboard`
- `GET /admin/agents`, `GET /admin/owners`, `GET /admin/stats`

No SDK or client changes required.

## Cost Comparison

| | Fly.io | Cloudflare Workers (Free) |
|---|---|---|
| Requests | Shared VM | 100,000/day |
| Database | 1GB volume | D1: 5M reads, 100K writes/day |
| Bandwidth | 100GB/mo | Unlimited |
| Regions | 1 (nrt) | 300+ edge locations |
| Monthly cost | $0 (hobby) → paid | $0 |
