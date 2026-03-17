# 22B Labs — Agent Identity Layer (AIL) 완전 가이드

> **버전:** v1.0 · 2026-03-17
> **서버:** Base Sepolia 배포 완료 · `0x4eeAD61dF800fcfA7a9F698f811a855389F74b6C`

---

## 목차

1. [AIL이란?](#1-ail이란)
2. [아키텍처 개요](#2-아키텍처-개요)
3. [빠른 시작 (5분)](#3-빠른-시작-5분)
4. [오너 등록](#4-오너-등록)
5. [에이전트 등록](#5-에이전트-등록)
6. [신원 검증](#6-신원-검증)
7. [NFT ID 카드](#7-nft-id-카드)
8. [SDK 사용법](#8-sdk-사용법)
9. [스마트 컨트랙트](#9-스마트-컨트랙트)
10. [API 전체 레퍼런스](#10-api-전체-레퍼런스)
11. [프로덕션 배포](#11-프로덕션-배포)
12. [보안 가이드](#12-보안-가이드)
13. [외부 플랫폼 연동 (v3 Visual Identity)](#13-외부-플랫폼-연동-v3-visual-identity)
14. [사용 사례](#14-사용-사례)

---

## 1. AIL이란?

**Agent Identity Layer (AIL)** 은 AI 에이전트에게 공식 신원을 발급하는 서비스입니다.

사람에게 주민등록증이 있듯이, AI 에이전트에게도 공식 신원이 필요합니다.

| 주민등록 시스템 | AIL 시스템 |
|---|---|
| 주민등록번호 | **AIL ID** (`AIL-2026-00001`) |
| 주민등록증 (실물) | **NFT** (블록체인에 발행된 토큰) |
| 진위 확인 | **JWT 크리덴셜** (공개키로 검증) |
| 주민센터 (발급 기관) | **22B Labs 서버** (마스터 키 서명) |
| 주소지 · 보호자 | **오너 지갑주소** (에이전트 소유자) |

### 핵심 가치

- **신뢰**: 22B Labs 마스터 키로 서명 → 위조 불가
- **책임**: 에이전트는 반드시 오너(인간/조직)에 귀속
- **검증**: 누구나 `POST /verify`로 실시간 검증
- **영속성**: NFT로 온체인 저장 → 소유권 영구 기록

---

## 2. 아키텍처 개요

```
┌─────────────────────────────────────────────────────────┐
│                      클라이언트 / 오너                    │
│  (개발자, 기업, RPG 게임, 커뮤니티 플랫폼 등)              │
└──────────────┬──────────────────────────┬───────────────┘
               │ REST API                  │ SDK
               ▼                          ▼
┌──────────────────────────────────────────────────────────┐
│                  AIL 이슈어 서버                          │
│                                                          │
│  POST /owners/register   → EC P-256 키 페어 발급         │
│  POST /owners/verify-email → 이메일 OTP 인증             │
│  POST /agents/register   → AIL ID + JWT + NFT 이미지    │
│  POST /verify            → 크리덴셜 검증                 │
│  GET  /agents/:id/image  → SVG ID 카드                  │
│  GET  /agents/:id/metadata → ERC-721 JSON              │
│  GET  /keys              → JWKS 공개키                   │
└──────────────┬───────────────────────────────────────────┘
               │ mint / revoke
               ▼
┌──────────────────────────────────────────────────────────┐
│              스마트 컨트랙트 (AILIdentity.sol)            │
│                                                          │
│  Base · Ethereum · BNB · Polygon · World Chain          │
│  ERC-721 · onlyMinter 제어 · Revoke = Burn              │
└──────────────────────────────────────────────────────────┘
```

### 신뢰 체인 (Trust Chain)

```
22B Labs 마스터 키 (EC P-256)
    └── 오너 키 (EC P-256, 서버가 발급)
            └── 에이전트 크리덴셜 (JWT ES256)
                    └── NFT (온체인 소유권)
```

### 서명 프로토콜

1. **서버 → 오너**: 서버가 오너 EC P-256 키 페어 생성 후 반환
2. **오너 → 에이전트**: 오너가 에이전트 등록 페이로드에 서명
3. **서버 → 크리덴셜**: 서버 마스터 키로 JWT ES256 서명

---

## 3. 빠른 시작 (5분)

### 서버 실행

```bash
# 1. 레포지토리 클론
git clone https://github.com/sinmb79/Agent-Identity-Layer.git
cd Agent-Identity-Layer

# 2. 의존성 설치
npm install

# 3. 마스터 키 생성 (최초 1회)
npm run setup:master-key

# 4. 서버 실행
npm run server
# → http://127.0.0.1:3317
```

### 엔드-투-엔드 데모 실행

```bash
# 서버가 실행 중인 상태에서 별도 터미널에서:
npm run demo:register
```

출력 예시:
```
=== AIL Registration Demo ===

1. Registering owner...
   owner_key_id: owk_c8fb4212a6864297f9b17146

2. Verifying email with OTP...
   verified: true

3. Signing registration payload...
   signature: kSDs4PE_IQOQqk...

4. Registering agent...
   ail_id: AIL-2026-00001
   expires_at: 2027-03-17T11:22:02.550Z

5. Verifying credential...
   valid: true
   display_name: ClaudeCoder

=== Demo complete ===
```

---

## 4. 오너 등록

오너(인간 또는 조직)는 에이전트를 등록하기 전에 먼저 등록해야 합니다.

### Step 1: 오너 등록

```http
POST /owners/register
Content-Type: application/json

{
  "email": "you@company.com",
  "org": "your_org"
}
```

**응답:**
```json
{
  "owner_key_id": "owk_c8fb4212...",
  "public_key_jwk": { "kty": "EC", "crv": "P-256", ... },
  "private_key_jwk": { "kty": "EC", "crv": "P-256", "d": "...", ... },
  "_dev_otp": "241795"
}
```

> ⚠️ `private_key_jwk`는 **서버에 저장되지 않습니다**. 반드시 안전하게 보관하세요.
> 분실 시 이메일 재인증으로 키 재발급이 가능하지만, 기존 키로 서명된 에이전트는 재등록이 필요합니다.

### Step 2: 이메일 인증

```http
POST /owners/verify-email
Content-Type: application/json

{
  "owner_key_id": "owk_c8fb4212...",
  "otp": "241795"
}
```

**응답:**
```json
{ "verified": true }
```

> 프로덕션에서는 OTP가 이메일로 전송됩니다 (현재 콘솔 출력).

---

## 5. 에이전트 등록

### Step 1: 등록 페이로드 작성

```javascript
const payload = {
  display_name: "ClaudeCoder",       // 표시 이름
  role: "review_engineer",           // 역할
  provider: "anthropic",             // AI 제공자
  model: "claude-sonnet-4-6",        // 모델명 (선택)
  scope: {
    workspace: ["/workspace/myproject"],  // 접근 허용 워크스페이스
    repos: ["my-repo"],                   // 접근 허용 레포지토리
    network: "none",                      // "none" | "restricted" | "allowed"
    secrets: "none",                      // "none" | "indirect" | "direct"
    write_access: false,                  // 쓰기 권한 여부
    approval_policy: {
      irreversible_actions: "not_allowed",     // 비가역 작업 정책
      external_posting: "not_allowed",         // 외부 포스팅 정책
      destructive_file_ops: "human_required",  // 파일 삭제 정책
    }
  }
};
```

### Step 2: 오너 키로 서명

```javascript
import { signPayload } from "@22blabs/ail-sdk";

const owner_signature = await signPayload(payload, private_key_jwk);
```

### Step 3: 등록 요청

```http
POST /agents/register
Content-Type: application/json

{
  "owner_key_id": "owk_c8fb4212...",
  "payload": { ...위의 payload... },
  "owner_signature": "kSDs4PE_IQOQqk..."
}
```

**응답 (201 Created):**
```json
{
  "ail_id": "AIL-2026-00001",
  "credential": {
    "type": "AIL.SignedCredential.v1",
    "issuer": "22blabs.ai",
    "issuer_key_id": "22blabs-master-2026",
    "issued_at": "2026-03-17T11:22:02.550Z",
    "expires_at": "2027-03-17T11:22:02.550Z",
    "token": "eyJhbGciOiJFUzI1NiJ9..."
  },
  "signal_glyph": {
    "seed": "AIL-2026-00001:ClaudeCoder:owk_c8fb..."
  },
  "behavior_fingerprint": {
    "hash": "sha256:ad49092053384ff5..."
  },
  "nft_image_url": "/agents/AIL-2026-00001/image",
  "nft_metadata_url": "/agents/AIL-2026-00001/metadata"
}
```

### 에이전트 역할 목록 (ROLE_MAP)

| 역할 | personality 점수 |
|------|-----------------|
| `ceo` | 88 |
| `cto` | 78 |
| `cmo` | 68 |
| `implementation_engineer` | 66 |
| `engineer` | 64 |
| `researcher` | 52 |
| `data_analyst` | 54 |
| `operations_assistant` | 58 |
| `review_engineer` | 46 |
| `assistant` | 50 |

### Scope 옵션

| 필드 | 값 | 의미 |
|------|-----|------|
| `network` | `"none"` | 외부 네트워크 접근 불가 |
| `network` | `"restricted"` | 허용된 도메인만 접근 |
| `network` | `"allowed"` | 모든 네트워크 접근 가능 |
| `secrets` | `"none"` | 시크릿 접근 불가 |
| `secrets` | `"indirect"` | 환경변수를 통한 간접 접근 |
| `secrets` | `"direct"` | 시크릿 값 직접 접근 |
| `write_access` | `boolean` | 파일 시스템 쓰기 권한 |

---

## 6. 신원 검증

### 온라인 검증 (API)

```http
POST /verify
Content-Type: application/json

{
  "token": "eyJhbGciOiJFUzI1NiJ9..."
}
```

**응답:**
```json
{
  "valid": true,
  "ail_id": "AIL-2026-00001",
  "display_name": "ClaudeCoder",
  "owner_org": "22b_labs",
  "issued": "2026-03-17",
  "expires": "2027-03-17",
  "revoked": false
}
```

**invalid 응답 예시:**
```json
{
  "valid": false,
  "reason": "token_expired"
}
```
```json
{
  "valid": false,
  "reason": "revoked"
}
```

### 오프라인 검증 (공개키 사용)

네트워크 호출 없이 로컬에서 JWT를 검증합니다.

```javascript
import { verifyOffline } from "@22blabs/ail-sdk";

// 공개키 가져오기 (최초 1회 또는 주기적으로)
const res = await fetch("https://api.22blabs.ai/keys");
const { keys } = await res.json();
const publicKeyJwk = keys[0];

// 오프라인 검증
const result = await verifyOffline(token, publicKeyJwk);
console.log(result.valid); // true
```

```python
from ail_sdk import verify_offline

result = verify_offline(token, public_key_jwk)
print(result["valid"])  # True
```

### 크리덴셜 폐기 (Revoke)

```http
DELETE /agents/AIL-2026-00001/revoke
Content-Type: application/json

{
  "owner_key_id": "owk_c8fb4212...",
  "owner_signature": "<{ action: 'revoke', ail_id: 'AIL-2026-00001' } 서명>"
}
```

폐기 즉시:
1. DB에서 `revoked = 1` 설정
2. NFT 자동 소각 (burn)
3. `POST /verify` → `{ valid: false, reason: "revoked" }`

---

## 7. NFT ID 카드

### ID 카드 이미지 (SVG)

```
GET /agents/AIL-2026-00001/image
```

- 600×600 SVG
- Face / Fingerprint / Palmline 세 가지 signal glyph 포함
- AIL ID를 시드로 한 결정론적 고유 패턴
- 홀로그램 그라디언트 보더 (에이전트마다 다른 색상)
- 브라우저에서 직접 열기 가능

### ERC-721 메타데이터

```
GET /agents/AIL-2026-00001/metadata
```

```json
{
  "name": "ClaudeCoder · AIL-2026-00001",
  "description": "22B Labs Agent Identity Credential. Role: review_engineer.",
  "image": "data:image/svg+xml;base64,PD94bWwg...",
  "external_url": "https://22blabs.ai/agents/AIL-2026-00001",
  "attributes": [
    { "trait_type": "AIL ID",       "value": "AIL-2026-00001" },
    { "trait_type": "Role",         "value": "review_engineer" },
    { "trait_type": "Provider",     "value": "anthropic" },
    { "trait_type": "Risk Level",   "value": "LOW" },
    { "trait_type": "Authority",    "value": 50 },
    { "trait_type": "Provenance",   "value": 96 }
  ]
}
```

### Signal Glyph 구성

| Glyph | 생성 데이터 | 의미 |
|-------|-----------|------|
| **Face** | role, personality, risk | 에이전트의 "성격" |
| **Fingerprint** | ail_id (seed) | 고유 식별자, 절대 중복 없음 |
| **Palmline** | scope, authority, delegation | 권한과 이력 |

Fingerprint 타입 (seed 기반 결정):
- **Whorl** (35%) — 동심원 타원 능선
- **Loop** (37%) — U자형 곡선 능선
- **Arch** (28%) — 아치형 곡선 (일반/텐트형)

---

## 8. SDK 사용법

### JavaScript / Node.js

```bash
npm install @22blabs/ail-sdk
```

#### 에이전트 등록 (전체 플로우)

```javascript
import { AilClient } from "@22blabs/ail-sdk";

const client = new AilClient("https://api.22blabs.ai");

// 1. 오너 등록
const owner = await client.registerOwner({
  email: "you@company.com",
  org: "your_org"
});

// 2. 이메일 인증
await client.verifyEmail({
  owner_key_id: owner.owner_key_id,
  otp: "241795"
});

// 3. 에이전트 등록
const agent = await client.registerAgent({
  owner_key_id: owner.owner_key_id,
  private_key_jwk: owner.private_key_jwk,
  payload: {
    display_name: "MyAgent",
    role: "assistant",
    scope: {
      network: "none",
      secrets: "none",
      write_access: false,
      approval_policy: {}
    }
  }
});

console.log(agent.ail_id);       // AIL-2026-00001
console.log(agent.credential.token);  // eyJhbGci...

// 4. 검증
const result = await client.verify(agent.credential.token);
console.log(result.valid);  // true
```

#### 오프라인 검증

```javascript
import { verifyOffline } from "@22blabs/ail-sdk";

const result = await verifyOffline(token, publicKeyJwk);
// → { valid, ail_id, display_name, owner_org, ... }
```

#### 유틸리티 함수

```javascript
import {
  generateOwnerKeypair,   // EC P-256 키 페어 생성
  signPayload,            // 페이로드 서명 (ECDSA/SHA-256)
  verifyOwnerSignature,   // 서명 검증
  computeBehaviorFingerprint, // 행동 핑거프린트 계산
  canonicalJson,          // 정규화 JSON (키 정렬)
  sha256hex,              // SHA-256 해시
} from "@22blabs/ail-sdk";
```

### Python

```bash
pip install ail-sdk
```

```python
from ail_sdk import AilClient, verify_offline

client = AilClient("https://api.22blabs.ai")

# 오너 등록
owner = client.register_owner(email="you@company.com", org="your_org")

# 이메일 인증
client.verify_email(owner_key_id=owner["owner_key_id"], otp="241795")

# 에이전트 등록
agent = client.register_agent(
    owner_key_id=owner["owner_key_id"],
    private_key_jwk=owner["private_key_jwk"],
    payload={
        "display_name": "MyAgent",
        "role": "assistant",
        "scope": {
            "network": "none",
            "secrets": "none",
            "write_access": False,
            "approval_policy": {}
        }
    }
)

print(agent["ail_id"])  # AIL-2026-00001

# 검증
result = client.verify(agent["credential"]["token"])
print(result["valid"])  # True

# 오프라인 검증
result = verify_offline(token, public_key_jwk)
```

---

## 9. 스마트 컨트랙트

### 배포 주소

| 체인 | 네트워크 | 컨트랙트 주소 |
|------|---------|-------------|
| Base Sepolia | 테스트넷 | `0x4eeAD61dF800fcfA7a9F698f811a855389F74b6C` |
| Base Mainnet | 메인넷 | 배포 예정 |
| Polygon | 메인넷 | 배포 예정 |
| BNB Chain | 메인넷 | 배포 예정 |
| World Chain | 메인넷 | 배포 예정 |

### 직접 배포

```bash
cd nft
npm install

# 테스트넷 배포 (무료)
npm run deploy:testnet

# 메인넷 배포
npm run deploy:base
npm run deploy:polygon
npm run deploy:bnb
npm run deploy:world

# 컨트랙트 검증 (Basescan)
npx hardhat verify --network base <contract_address> <minter_address>
```

### 컨트랙트 주요 함수

```solidity
// 에이전트 NFT 발행 (서버 지갑만 호출 가능)
function mint(address to, string calldata ailId, string calldata uri)
    external onlyMinter returns (uint256 tokenId)

// 에이전트 NFT 소각 (크리덴셜 폐기 시)
function revoke(uint256 tokenId) external onlyMinter

// AIL ID → 토큰 ID 조회
function getTokenId(string calldata ailId) external view returns (uint256)

// 토큰 ID → AIL ID 조회
function getAilId(uint256 tokenId) external view returns (string memory)

// 등록 여부 확인
function isRegistered(string calldata ailId) external view returns (bool)

// 민터 주소 변경 (서버 지갑 교체 시)
function setMinter(address newMinter) external onlyOwner
```

### .env 설정 (nft/.env)

```bash
ALCHEMY_API_KEY=<your_alchemy_api_key>
DEPLOYER_PRIVATE_KEY=0x<64자리_16진수>
SERVER_WALLET=0x<서버_지갑_주소>
BASESCAN_API_KEY=<basescan_api_key>
```

---

## 10. API 전체 레퍼런스

### 오너 API

| 메서드 | 경로 | 설명 |
|-------|------|------|
| `POST` | `/owners/register` | 오너 등록 + EC P-256 키 페어 발급 |
| `POST` | `/owners/verify-email` | 이메일 OTP 인증 |

### 에이전트 API

| 메서드 | 경로 | 설명 |
|-------|------|------|
| `POST` | `/agents/register` | 에이전트 등록 + AIL ID + JWT 발급 |
| `DELETE` | `/agents/:ail_id/revoke` | 에이전트 크리덴셜 폐기 |
| `GET` | `/agents/:ail_id/image` | SVG ID 카드 이미지 |
| `GET` | `/agents/:ail_id/metadata` | ERC-721 JSON 메타데이터 |

### 검증 API

| 메서드 | 경로 | 설명 |
|-------|------|------|
| `POST` | `/verify` | 크리덴셜 JWT 검증 |
| `GET` | `/keys` | JWKS 공개키 목록 |
| `GET` | `/keys/:kid` | 특정 키 조회 |

### 관리자 API

| 메서드 | 경로 | 설명 | 인증 |
|-------|------|------|------|
| `GET` | `/admin/agents` | 전체 에이전트 목록 | `X-Admin-Key` |
| `GET` | `/admin/owners` | 전체 오너 목록 | `X-Admin-Key` |
| `GET` | `/admin/stats` | 통계 | `X-Admin-Key` |
| `DELETE` | `/admin/agents/:ail_id/revoke` | 관리자 강제 폐기 | `X-Admin-Key` |

---

## 11. 프로덕션 배포

### 환경 변수

```bash
# 필수
MASTER_KEY_JSON={"kty":"EC","crv":"P-256",...}  # 마스터 서명 키 (JSON)
ADMIN_API_KEY=<32자_이상_무작위_문자열>            # 관리자 API 키

# 선택
PORT=8080
AIL_DB_PATH=/data/ail.db                          # SQLite 경로 (볼륨 마운트)
```

> ⚠️ `MASTER_KEY_JSON`은 절대 GitHub에 커밋하지 마세요.
> Fly.io secrets, AWS Secrets Manager, Vault 등을 사용하세요.

### Fly.io 배포 (권장)

```bash
# 1. flyctl 설치 및 로그인
brew install flyctl
fly auth login

# 2. 마스터 키 생성
npm run setup:master-key
# → data/master-key.json 생성됨

# 3. secrets 설정
fly secrets set MASTER_KEY_JSON="$(cat data/master-key.json)"
fly secrets set ADMIN_API_KEY="$(openssl rand -hex 32)"

# 4. 배포
fly deploy

# 5. 볼륨 확인 (SQLite 영속 저장)
fly volumes list
```

### Docker

```bash
docker build -t ail-server .
docker run -p 8080:8080 \
  -e MASTER_KEY_JSON='{"kty":"EC",...}' \
  -e ADMIN_API_KEY='your_admin_key' \
  -v /data/ail:/data \
  ail-server
```

### 마스터 키 백업

```bash
# 마스터 키 생성 (최초 1회)
npm run setup:master-key

# 백업 (안전한 저장소에 보관)
cat data/master-key.json | base64 > master-key-backup.b64

# 프로덕션 서버에 적용
fly secrets set MASTER_KEY_JSON="$(cat data/master-key.json)"
```

> ⚠️ 마스터 키를 분실하면 기존에 발급된 **모든 크리덴셜의 검증이 불가능**해집니다.
> 3곳 이상 백업을 권장합니다 (예: 금고, 암호화된 USB, 신뢰할 수 있는 서버).

---

## 12. 보안 가이드

### 오너 프라이빗 키 보호

```
✅ 해야 할 것
  - 키를 환경변수나 Vault에 저장
  - 에이전트마다 최소 권한 scope 설정
  - 주기적 크리덴셜 갱신 (expires_at 관리)
  - 에이전트 이상 행동 시 즉시 Revoke

❌ 하지 말 것
  - 프라이빗 키를 코드/Git에 커밋
  - write_access: true를 불필요하게 허용
  - network: "allowed"를 불필요하게 허용
  - 만료된 크리덴셜 재사용
```

### Scope 최소 권한 원칙

```javascript
// ✅ 권장 — 필요한 것만 허용
scope: {
  workspace: ["/workspace/specific-project"],
  repos: ["only-this-repo"],
  network: "none",
  secrets: "none",
  write_access: false,
}

// ⚠️ 주의 필요
scope: {
  workspace: ["/"],
  network: "allowed",
  secrets: "direct",
  write_access: true,
}
```

### 검증 통합 시 주의사항

```javascript
// ✅ 올바른 검증 방법
const result = await client.verify(token);
if (!result.valid) {
  throw new Error("Unauthorized agent");
}
if (result.revoked) {
  throw new Error("Agent credential revoked");
}
// result.display_name, result.owner_org 신뢰 가능

// ❌ 토큰을 파싱만 하는 것은 불충분
// JWT 디코드만으로는 revocation 상태를 확인할 수 없음
```

---

## 13. 외부 플랫폼 연동 (v3 Visual Identity)

**Agent Visual Identity System (v3)** 은 AIL v2와 완벽한 보완 관계입니다.

```
AIL v2 = 여권 (공식 신원, 신뢰 체인, 소유권 증명)
AIL v3 = 아바타 (플랫폼별 시각적 표현, 이름, 바이오)
```

### 연동 아키텍처

```
에이전트 등록 (AIL v2)
    │
    ├── JWT 크리덴셜 발급
    ├── NFT ID 카드 생성 (signal glyph)
    │
    └── v3 Visual Identity API 호출 ──→ display_name, bio, SVG 생성
            │
            ▼
      RPG 게임 / 커뮤니티 / 대시보드
          - 고유 아바타 (face/fingerprint/palmline)
          - 읽기 좋은 이름 (예: "Precise Architect-8b3f")
          - 자동 생성 바이오
          - AIL 검증 배지 표시
```

### v3 API 호출 예시

```javascript
// AIL v2로 에이전트 등록 후
const ailAgent = await ailClient.registerAgent({ ... });

// v3으로 플랫폼용 시각적 정체성 생성
const visualIdentity = await fetch("http://v3-api/generate", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    id:          ailAgent.ail_id,
    role:        "review_engineer",
    personality: ["logical", "precise"],
    platform:    "openclaw",
    created_at:  new Date().toISOString(),
    activity_log: {
      taskCount:     42,
      taskTypes:     ["code_review", "analysis"],
      totalDuration: 1800,
      successRate:   0.94,
    }
  })
}).then(r => r.json());

// 결과: 플랫폼에 표시할 완전한 프로필
console.log(visualIdentity.display_name);   // "Precise Architect-8b3f"
console.log(visualIdentity.bio);            // 자동 생성 바이오
// visualIdentity.face       → SVG 얼굴 이미지
// visualIdentity.fingerprint → SVG 지문 이미지
// visualIdentity.palmline   → SVG 손금 이미지
```

### RPG 게임 통합 예시

```javascript
// 게임 서버에서 에이전트 신원 확인
async function onAgentJoin(token, agentConfig) {
  // 1. AIL v2로 공식 신원 검증
  const credential = await ailClient.verify(token);
  if (!credential.valid) throw new Error("Invalid agent");

  // 2. v3으로 게임 내 캐릭터 프로필 생성
  const profile = await generateVisualIdentity({
    id:          credential.ail_id,
    role:        agentConfig.role,
    personality: agentConfig.traits,
    platform:    "your_game",
    created_at:  credential.issued,
    activity_log: agentConfig.stats,
  });

  return {
    // AIL v2 데이터 (공식 신원)
    ail_id:      credential.ail_id,
    owner:       credential.owner_org,
    verified:    true,
    // v3 데이터 (게임 내 표현)
    name:        profile.display_name,
    bio:         profile.bio,
    avatar_face: profile.face,
    avatar_fp:   profile.fingerprint,
    avatar_palm: profile.palmline,
  };
}
```

### 유료 서비스 통합 제안

| 플랜 | AIL v2 | v3 Visual Identity | 대상 |
|------|--------|-------------------|------|
| **Free** | JWT 크리덴셜 | 기본 glyph (AIL 내장) | 개인 개발자 |
| **Pro** | JWT + NFT | v3 full (display_name, bio, SVG) | 팀, 게임 개발사 |
| **Platform** | 화이트라벨 | 커스텀 플랫폼 스타일 | RPG 게임, 커뮤니티 |

---

## 14. 사용 사례

### AI 에이전트 서비스 제공자

```
시나리오: Claude 기반 코딩 에이전트를 고객에게 제공
1. 에이전트 등록 → AIL ID 발급
2. 고객에게 JWT 토큰 제공
3. 고객 시스템이 POST /verify로 실시간 검증
4. 에이전트 문제 발생 시 즉시 Revoke
```

### RPG / 게임 플랫폼

```
시나리오: AI 플레이어가 게임에 참가
1. 게임 서버가 POST /verify로 에이전트 신원 확인
2. v3 API로 게임 내 캐릭터 시트 자동 생성
3. 에이전트 활동 기록이 palmline에 반영
4. NFT = 게임 캐릭터 소유권 증명
```

### 멀티 에이전트 시스템

```
시나리오: 여러 에이전트가 협업하는 파이프라인
1. 각 에이전트가 자신의 AIL 토큰 제시
2. 오케스트레이터가 모든 에이전트 검증
3. scope 기반으로 권한 자동 적용
4. 감사 로그: ail_id 기반 행동 추적
```

### 기업 내부 에이전트 관리

```
시나리오: 기업이 내부 AI 에이전트 관리
1. 부서별 오너 등록 (HR팀, 개발팀, 영업팀)
2. 각 팀이 자신의 에이전트 등록 및 관리
3. IT 관리자가 관리자 API로 전체 현황 모니터링
4. 이상 에이전트 발견 시 즉시 폐기
```

---

## 부록: 주요 에러 코드

| HTTP | error 코드 | 의미 |
|------|-----------|------|
| 400 | `missing_field` | 필수 필드 누락 |
| 401 | `invalid_signature` | 오너 서명 검증 실패 |
| 403 | `email_not_verified` | 이메일 미인증 |
| 403 | `not_agent_owner` | 에이전트 소유자가 아님 |
| 404 | `owner_not_found` | 오너 미존재 |
| 404 | `agent_not_found` | 에이전트 미존재 |
| 409 | `email_already_registered` | 이미 등록된 이메일 |

## 부록: 개발 명령어 모음

```bash
# 서버
npm run server          # 서버 실행 (포트 3317)
npm run setup:master-key # 마스터 키 생성

# 데모
npm run demo:register   # 엔드-투-엔드 데모

# 컨트랙트 (nft/ 디렉토리)
npm run compile         # Solidity 컴파일
npm run test            # 컨트랙트 테스트
npm run deploy:testnet  # Base Sepolia 배포
npm run deploy:base     # Base Mainnet 배포

# SDK 검증
npm run validate:examples  # 예제 JSON 검증
```

---

*© 2026 22B Labs. MIT License.*
*GitHub: [sinmb79/Agent-Identity-Layer](https://github.com/sinmb79/Agent-Identity-Layer)*
