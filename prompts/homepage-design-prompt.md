# Homepage Design Prompt — 22B Labs Agent Identity Layer

> 이 프롬프트를 웹 디자인/개발 전문 AI에게 그대로 전달하세요.
> 결과물은 `website/` 폴더에 저장해달라고 요청하세요.

---

## 의뢰 내용

**22B Labs**의 공개 서비스 **Agent Identity Layer (AIL)** 의 공식 홈페이지를 제작해주세요.

---

## 제품 개요

AIL은 AI 에이전트에게 **디지털 신분증(ID card)** 을 발급하는 서비스입니다.

사람에게 주민등록증이 있듯이, AI 에이전트에게도 공식 신원이 필요합니다.

- **발급 기관**: 22B Labs
- **등록 번호 형식**: `AIL-2026-00001`
- **크리덴셜 방식**: JWT (서명된 인증서) + NFT (시각적 신분증)
- **오너 귀속**: 에이전트는 반드시 오너(인간/조직)에게 귀속됩니다
- **서드파티 검증**: 누구나 `POST /verify`로 실시간 검증 가능

### 핵심 가치 제안

> "당신의 AI 에이전트에게 공식 신원을 부여하세요.
> 누가 만들었는지, 무엇을 할 수 있는지, 신뢰할 수 있는지 — 한 장의 ID로."

---

## 디자인 방향

### 톤 & 무드

- 다크 테마 기반 (배경: `#0d0f14`, 서피스: `#161b25`)
- 기술적이면서도 깔끔한 — Vercel, Linear 스타일 참고
- 차갑고 정밀한 느낌 (에이전트 = 기계 정체성)
- 신뢰감과 공식성 강조 (정부 기관 발급 느낌을 테크 스타일로)

### 컬러 시스템

| 역할 | 색상 |
|------|------|
| 배경 | `#0d0f14` |
| 서피스 | `#161b25` |
| 보더 | `#1e2535` |
| 액센트 (파랑) | `#4f8ef7` |
| 성공/활성 | `#22c55e` |
| 텍스트 | `#e2e8f0` |
| 뮤트 텍스트 | `#64748b` |

### 폰트

- 제목: Inter (또는 Geist)
- 코드/ID: JetBrains Mono (또는 Fira Code)
- 본문: Inter

---

## 페이지 구조 (섹션 순서)

### 1. Navigation Bar

- 좌측: `22B Labs · AIL` 로고
- 우측: `Docs`, `Pricing`, `Dashboard`, `Get Started` 버튼 (액센트 컬러)
- 스크롤 시 blur backdrop 효과

---

### 2. Hero Section

**헤드라인:**
```
AI 에이전트를 위한
공식 신분증
```
(영문: "The Official ID Card for AI Agents")

**서브텍스트:**
```
에이전트가 누구인지, 누가 소유하는지, 무엇을 할 수 있는지.
22B Labs가 서명한 신원 크리덴셜과 NFT ID 카드를 즉시 발급합니다.
```

**CTA 버튼 2개:**
- `에이전트 등록하기` (Primary, 액센트 파랑)
- `문서 보기` (Secondary, 아웃라인)

**Hero 비주얼:**
오른쪽에 에이전트 ID 카드 목업 표시. 카드 디자인:

```
┌─────────────────────────────────┐
│  22B LABS                  [LOGO]│
│                                  │
│  ████████  AIL-2026-00001        │
│  ████████  ClaudeCoder           │
│  ████████  review_engineer       │
│  [glyph]   anthropic             │
│                                  │
│  OWNER: 22b_labs                 │
│  ISSUED: 2026-03-17              │
│  VALID UNTIL: 2027-03-17         │
│                                  │
│  ✓ Cryptographically Signed      │
└─────────────────────────────────┘
```

카드는 홀로그램 느낌의 그라디언트 보더, 약간 기울어진 3D 원근감, 마우스 hover 시 tilting 효과.

---

### 3. "이런 문제가 있지 않나요?" 섹션 (Problem)

3개 카드로 구성:

1. **"이 에이전트, 믿어도 되나?"**
   누가 만든 에이전트인지 알 수 없습니다. 악의적 에이전트가 신뢰받은 에이전트를 사칭할 수 있습니다.

2. **"책임은 누구에게?"**
   에이전트가 문제를 일으켜도 소유자를 특정할 방법이 없습니다.

3. **"다른 시스템과 연동이 불가"**
   에이전트 신원 표준이 없어 플랫폼 간 신뢰 공유가 불가능합니다.

---

### 4. "AIL이 해결합니다" 섹션 (Solution)

**3단계 플로우** (좌→우 또는 세로 스텝):

```
Step 1                Step 2                  Step 3
오너 등록         →   에이전트 등록       →   신분증 발급
이메일 인증           오너 키로 서명           JWT + NFT
keypair 발급          scope 선언               즉시 검증 가능
```

각 스텝 아래에 실제 코드 스니펫 (어두운 코드 블록):

**Step 1 예시:**
```bash
POST /owners/register
{ "email": "you@company.com", "org": "your_org" }
```

**Step 2 예시:**
```bash
POST /agents/register
{ "owner_key_id": "owk_...", "payload": { "display_name": "MyAgent", ... } }
```

**Step 3 결과:**
```json
{
  "ail_id": "AIL-2026-00001",
  "credential": { "token": "eyJ..." },
  "nft_token_id": 1
}
```

---

### 5. NFT ID Card 섹션

**헤드라인:** `신분증은 당신의 지갑에`

**설명:**
에이전트가 등록되면 고유한 signal glyph가 생성되고, 이를 이미지로 한 NFT가 Base 네트워크에 발행됩니다. NFT를 보유한 지갑 = 에이전트의 법적 소유자.

**비주얼:**
- 왼쪽: 여러 개의 NFT 카드가 쌓인 갤러리 형태
- 각 카드마다 다른 signal glyph (기하학적 패턴)
- OpenSea 스타일의 카드 그리드

**특징 3가지 (아이콘 + 텍스트):**
- `🔐` 양도 가능 — 에이전트 소유권을 NFT 전송으로 이전
- `⛓` Base 네트워크 — 저렴한 gas, 이더리움 보안
- `🔥` Revoke = Burn — 크리덴셜 폐기 시 NFT 소각

---

### 6. 검증 섹션 (Verification)

**헤드라인:** `누구나 즉시 검증`

서드파티 관점의 검증 플로우 시각화:

```
에이전트가 토큰 제시  →  POST /verify  →  응답
                          22B Labs API
```

실제 응답 예시 (코드 블록):
```json
{
  "valid": true,
  "ail_id": "AIL-2026-00001",
  "display_name": "ClaudeCoder",
  "owner_org": "22b_labs",
  "issued": "2026-03-17",
  "revoked": false
}
```

또는 공개키로 오프라인 검증 가능:
```js
import { verifyOffline } from "@agentidcard/sdk"
const result = await verifyOffline(token, publicKeyJwk)
```

---

### 7. SDK 섹션

**헤드라인:** `5분 안에 연동`

탭 UI — JavaScript / Python:

**JavaScript:**
```bash
npm install @agentidcard/sdk
```
```js
import { AilClient } from "@agentidcard/sdk"
const client = new AilClient()
const result = await client.verify(token)
```

**Python:**
```bash
pip install ail-sdk
```
```python
from agentidcard import AilClient
client = AilClient()
result = client.verify(token)
```

---

### 8. Pricing 섹션

**헤드라인:** `심플한 가격`

3가지 플랜 카드:

| Free | Pro | Enterprise |
|------|-----|------------|
| 에이전트 1개 | 에이전트 20개 | 무제한 |
| JWT 크리덴셜 | JWT + NFT 발급 | 커스텀 설정 |
| 기본 검증 | 검증 API 10,000회/월 | 전용 지원 |
| **$0** | **$29/월** | **문의** |

중간 플랜(Pro)에 `Most Popular` 배지.

**결제 방법:**
- 카드 (Stripe)
- USDC / ETH (Base 네트워크)

---

### 9. FAQ 섹션

아코디언 형식, 최소 5개:

1. **NFT는 어떤 체인에 발행되나요?**
   Base 네트워크 (이더리움 L2). gas비가 매우 저렴합니다.

2. **크리덴셜을 잃어버리면?**
   오너 키로 재발급 가능합니다. NFT 소유권은 지갑에 유지됩니다.

3. **에이전트가 악용되면 어떻게 되나요?**
   오너는 언제든 Revoke할 수 있습니다. Revoke 즉시 NFT가 소각되고 검증 API에서 invalid를 반환합니다.

4. **블록체인 지갑이 없어도 사용할 수 있나요?**
   JWT 크리덴셜만 사용할 경우 지갑 불필요. NFT 발급 시에만 EVM 지갑 필요.

5. **자체 서버에 직접 배포할 수 있나요?**
   오픈소스이므로 직접 배포 가능합니다. 단, 22B Labs 서명 신뢰 사슬은 직접 운영 시 적용되지 않습니다.

---

### 10. Footer

- 좌측: `22B Labs · Agent Identity Layer`
- 링크: GitHub, Docs, Dashboard, Pricing
- `© 2026 22B Labs. Open source under MIT License.`

---

## 기술 요구사항

- **프레임워크**: Next.js 14+ (App Router) 또는 순수 HTML/CSS/JS 단일 파일도 가능
- **스타일링**: Tailwind CSS 또는 인라인 CSS (외부 UI 라이브러리 최소화)
- **애니메이션**: Framer Motion 또는 CSS animation (과하지 않게)
- **반응형**: 모바일 우선 (breakpoint: 768px)
- **다국어**: 한국어 기본, 영어 전환 버튼 (선택)
- **폰트**: Google Fonts (Inter + JetBrains Mono)

---

## 산출물 요구사항

다음 파일을 `website/` 폴더에 저장:

```
website/
  index.html        (또는 Next.js 프로젝트 전체)
  styles.css        (별도 CSS 파일 사용 시)
  assets/
    card-mockup.svg   (ID 카드 목업 SVG)
    glyph-*.svg       (signal glyph 예시 3~5개)
```

---

## 참고 레퍼런스 사이트 (디자인 방향)

- https://vercel.com (다크 + 미니멀 + 코드 중심)
- https://linear.app (깔끔한 제품 랜딩)
- https://clerk.com (개발자 대상 ID 서비스)

---

## 최종 목표

이 홈페이지를 본 개발자가:
1. "아, AI 에이전트 신분증 서비스구나" — 3초 안에 이해
2. "나도 내 에이전트에 달고 싶다" — 흥미 유발
3. `Get Started` 버튼 클릭 → 에이전트 등록 시작

이 세 가지 반응을 이끌어내는 것이 목표입니다.
