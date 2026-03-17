# Deployment Guide

22B Labs AIL Issuance Server 배포 가이드입니다.

---

## 목차

1. [시스템 요구사항](#1-시스템-요구사항)
2. [로컬 개발 환경 설정](#2-로컬-개발-환경-설정)
3. [마스터 키 관리](#3-마스터-키-관리)
4. [환경변수 레퍼런스](#4-환경변수-레퍼런스)
5. [Fly.io 배포 (권장)](#5-flyio-배포-권장)
6. [Railway 배포](#6-railway-배포)
7. [VPS / EC2 배포 (Docker)](#7-vps--ec2-배포-docker)
8. [배포 후 체크리스트](#8-배포-후-체크리스트)
9. [SDK 기본 URL 업데이트](#9-sdk-기본-url-업데이트)
10. [보안 주의사항](#10-보안-주의사항)

---

## 1. 시스템 요구사항

| 항목 | 요구사항 |
|------|---------|
| Node.js | **22.5.0 이상** (내장 `node:sqlite` 사용) |
| 메모리 | 최소 256MB (512MB 권장) |
| 디스크 | SQLite DB용 퍼시스턴트 볼륨 필요 |
| HTTPS | 운영 환경에서 필수 (JWT 토큰 전송 보안) |

---

## 2. 로컬 개발 환경 설정

```bash
# 1. 의존성 설치
npm install

# 2. 마스터 서명 키 생성 (최초 1회)
npm run setup:master-key

# 3. 서버 실행 (기본 포트 3317)
npm run server

# 4. 전체 플로우 데모
npm run demo:register
```

서버가 뜨면:
- API: `http://127.0.0.1:3317`
- 대시보드: `http://127.0.0.1:3317/dashboard`
- 공개키: `http://127.0.0.1:3317/keys`

---

## 3. 마스터 키 관리

마스터 키는 **22B Labs가 발급하는 모든 JWT에 서명하는 EC P-256 비밀키**입니다.
이 키를 잃으면 기존에 발급된 모든 크리덴셜의 신뢰 사슬이 끊어집니다.

### 개발 환경 (파일 방식)

```bash
npm run setup:master-key
# → data/master-key.json 생성 (gitignored)
```

`data/master-key.json` 구조:

```json
{
  "kid": "22blabs-master-2026",
  "algorithm": "ES256",
  "curve": "P-256",
  "created_at": "2026-03-17T00:00:00.000Z",
  "private_key_jwk": { ... },
  "public_key_jwk": { ... }
}
```

### 운영 환경 (환경변수 방식)

운영 서버에는 파일을 올리지 않습니다.
`data/master-key.json` 내용을 **한 줄 JSON**으로 환경변수에 주입합니다.

```bash
# 로컬에서 환경변수 값 확인
cat data/master-key.json | python3 -m json.tool --compact
```

출력된 한 줄 JSON을 `MASTER_KEY_JSON` 환경변수로 설정합니다 (플랫폼별 방법은 아래 참조).

### 키 백업

마스터 키는 **반드시 별도의 안전한 저장소에 백업**해두어야 합니다.

권장 방법:
- 1Password / Bitwarden 보안 노트
- AWS Secrets Manager / GCP Secret Manager
- 팀 공유 볼트 (절대 Git, Slack, 이메일 금지)

### 키 교체 (로테이션)

키를 교체하면 이전 키로 서명된 모든 크리덴셜이 무효화됩니다.

```bash
# 기존 키 파일 이름 변경 후 새 키 생성
mv data/master-key.json data/master-key.2026.backup.json
npm run setup:master-key
```

기존 에이전트는 새 키로 재등록이 필요합니다.

---

## 4. 환경변수 레퍼런스

| 변수명 | 필수 | 기본값 | 설명 |
|--------|------|--------|------|
| `MASTER_KEY_JSON` | 운영 필수 | (파일에서 로드) | 마스터 서명 키 JSON (한 줄) |
| `ADMIN_API_KEY` | 권장 | 랜덤 생성 (매 시작마다 변경) | 대시보드 및 `/admin/*` 접근 키 |
| `PORT` | 선택 | `3317` | 리슨 포트 |
| `HOST` | 선택 | `127.0.0.1` | 리슨 주소 (`0.0.0.0` for Docker) |
| `AIL_DB_PATH` | 선택 | `data/ail.db` | SQLite 파일 경로 |

> **주의:** `ADMIN_API_KEY`를 설정하지 않으면 서버 시작 시 랜덤 키가 생성되어 콘솔에 출력됩니다. 재시작할 때마다 키가 바뀌므로 **운영 환경에서는 반드시 고정값을 설정**하세요.

---

## 5. Fly.io 배포 (권장)

Fly.io는 SQLite + Node.js 조합에 가장 적합합니다. 퍼시스턴트 볼륨을 지원하고 자동 HTTPS가 제공됩니다.

### 사전 준비

```bash
# Fly CLI 설치
curl -L https://fly.io/install.sh | sh

# 로그인
fly auth login
```

### 최초 배포

```bash
cd /path/to/Agent-Identity-Layer-v2

# 앱 생성 (fly.toml의 app명 확인)
fly apps create 22blabs-ail

# SQLite용 퍼시스턴트 볼륨 생성 (1GB)
fly volumes create ail_data --region nrt --size 1

# 마스터 키 시크릿 설정
MASTER_KEY=$(cat data/master-key.json | python3 -m json.tool --compact)
fly secrets set MASTER_KEY_JSON="$MASTER_KEY"

# 어드민 키 설정
fly secrets set ADMIN_API_KEY="your-strong-admin-key-here"

# 배포
fly deploy
```

### 배포 확인

```bash
# 로그 확인
fly logs

# 헬스체크
curl https://22blabs-ail.fly.dev/health

# 공개키 확인
curl https://22blabs-ail.fly.dev/keys
```

### 커스텀 도메인 연결 (선택)

```bash
# 도메인 추가
fly certs add api.22blabs.ai

# DNS에 CNAME 레코드 추가
# api.22blabs.ai → 22blabs-ail.fly.dev
```

### 재배포

코드 변경 후:

```bash
fly deploy
```

### fly.toml 주요 설정

프로젝트 루트의 `fly.toml`을 참고하세요. 리전 변경 시 `primary_region` 값을 수정합니다:

| 리전 코드 | 위치 |
|-----------|------|
| `nrt` | 도쿄 (기본값) |
| `sin` | 싱가포르 |
| `iad` | 버지니아 (미국 동부) |
| `lhr` | 런던 |

---

## 6. Railway 배포

Railway는 설정이 가장 간단합니다. SQLite 볼륨 설정에 주의가 필요합니다.

### 배포 절차

1. [railway.app](https://railway.app)에서 프로젝트 생성
2. GitHub 레포 연결 (`sinmb79/Agent_warrent`)
3. **Variables** 탭에서 환경변수 설정:

   ```
   MASTER_KEY_JSON  = <data/master-key.json 한 줄 JSON>
   ADMIN_API_KEY    = <강력한 랜덤 문자열>
   HOST             = 0.0.0.0
   AIL_DB_PATH      = /data/ail.db
   ```

4. **Volumes** 탭에서 퍼시스턴트 볼륨 마운트:
   - Mount path: `/data`
   - Size: 1GB

5. `package.json`의 start 스크립트 확인:

   ```json
   "start": "node server/index.mjs"
   ```

   Railway는 `npm start`를 자동 실행합니다. `package.json`에 추가:

   ```json
   "scripts": {
     "start": "node server/index.mjs"
   }
   ```

6. Deploy 버튼 클릭

### 주의사항

Railway의 무료 플랜은 볼륨 퍼시스턴스가 제한될 수 있습니다. 유료 플랜 사용을 권장합니다.

---

## 7. VPS / EC2 배포 (Docker)

### Docker 이미지 빌드

```bash
docker build -t 22blabs-ail .

# 로컬 테스트
docker run -p 8080:8080 \
  -e MASTER_KEY_JSON="$(cat data/master-key.json | python3 -m json.tool --compact)" \
  -e ADMIN_API_KEY="your-admin-key" \
  -v $(pwd)/data:/data \
  22blabs-ail
```

### EC2 / VPS 배포

```bash
# 서버에 도커 설치 (Ubuntu 기준)
sudo apt-get update && sudo apt-get install -y docker.io

# 이미지 전송 (Docker Hub 사용 시)
docker tag 22blabs-ail your-dockerhub/22blabs-ail
docker push your-dockerhub/22blabs-ail

# 서버에서 실행
ssh user@your-server

docker pull your-dockerhub/22blabs-ail

# 볼륨 디렉터리 생성
mkdir -p /srv/ail-data

# 실행
docker run -d \
  --name ail-server \
  --restart unless-stopped \
  -p 443:8080 \
  -e MASTER_KEY_JSON='{"kid":"22blabs-master-2026",...}' \
  -e ADMIN_API_KEY="your-admin-key" \
  -e AIL_DB_PATH="/data/ail.db" \
  -v /srv/ail-data:/data \
  your-dockerhub/22blabs-ail
```

### HTTPS 설정 (nginx + Certbot)

```nginx
# /etc/nginx/sites-available/ail
server {
    listen 443 ssl;
    server_name api.22blabs.ai;

    ssl_certificate     /etc/letsencrypt/live/api.22blabs.ai/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/api.22blabs.ai/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

```bash
# SSL 인증서 발급
certbot --nginx -d api.22blabs.ai
```

---

## 8. 배포 후 체크리스트

배포가 완료되면 아래 항목을 순서대로 확인합니다.

### 기본 동작 확인

```bash
BASE="https://api.22blabs.ai"   # 실제 배포 URL로 변경

# 1. 헬스체크
curl $BASE/health
# → {"status":"ok","service":"22blabs-ail-issuer"}

# 2. 공개키 (JWKS)
curl $BASE/keys
# → {"keys":[{"kid":"22blabs-master-2026","alg":"ES256",...}]}

# 3. 대시보드 접근
open $BASE/dashboard
```

### 오너 등록 → 에이전트 발급 → 검증 흐름 확인

```bash
# 오너 등록
curl -s -X POST $BASE/owners/register \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","org":"test_org"}' | jq .

# 이메일 인증 (콘솔 로그의 OTP 사용)
curl -s -X POST $BASE/owners/verify-email \
  -H "Content-Type: application/json" \
  -d '{"owner_key_id":"owk_...","otp":"123456"}' | jq .
```

또는 `scripts/demo-register.mjs`에서 `AIL_SERVER` 환경변수를 설정해 실행:

```bash
AIL_SERVER=https://api.22blabs.ai node scripts/demo-register.mjs
```

### 어드민 대시보드

`https://api.22blabs.ai/dashboard` 접속 후 `ADMIN_API_KEY` 입력.

---

## 9. SDK 기본 URL 업데이트

서버가 운영 주소로 배포된 후, SDK의 기본 `serverUrl`을 업데이트합니다.

### JavaScript SDK (`sdk/js/src/client.mjs`)

```js
// 변경 전
constructor({ serverUrl = "http://127.0.0.1:3317" } = {}) {

// 변경 후
constructor({ serverUrl = "https://api.22blabs.ai" } = {}) {
```

### Python SDK (`sdk/python/ail_sdk/client.py`)

```python
# 변경 전
def __init__(self, server_url: str = "http://127.0.0.1:3317"):

# 변경 후
def __init__(self, server_url: str = "https://api.22blabs.ai"):
```

URL 업데이트 후 버전 bump (`0.1.0` → `0.2.0`) 및 npm/PyPI 퍼블리시를 진행합니다.

---

## 10. 보안 주의사항

### 절대 금지

| 항목 | 이유 |
|------|------|
| `MASTER_KEY_JSON`을 Git에 커밋 | 전체 신뢰 사슬 붕괴 |
| `ADMIN_API_KEY`를 공개 채널(Slack, 이메일)에 공유 | 대시보드 무단 접근 |
| HTTP(비암호화)로 운영 | JWT 토큰 탈취 가능 |
| `data/master-key.json`을 서버에 그대로 복사 | 환경변수 방식 사용 |
| `ADMIN_API_KEY` 없이 운영 | 재시작마다 키가 바뀌어 대시보드 접근 불가 |

### 권장 사항

- **HTTPS 필수**: 모든 운영 엔드포인트에 TLS 적용
- **Rate limiting**: 등록 API에 IP당 요청 제한 추가 (추후 구현)
- **이메일 발송**: 현재 OTP가 콘솔에만 출력됨 — 운영 전 SMTP 또는 SendGrid 연동 필요
- **모니터링**: `/health` 엔드포인트를 UptimeRobot 등으로 모니터링
- **DB 백업**: SQLite 파일(`ail.db`)을 주기적으로 백업 (Fly.io: `fly ssh console`로 접근 후 복사)

### 이메일 발송 연동 (운영 필수)

현재 OTP 이메일은 서버 콘솔 로그로만 출력됩니다 (`[EMAIL STUB]`).
운영 환경에서는 `server/routes/owners.mjs`의 이메일 스텁 부분을 실제 발송 로직으로 교체해야 합니다.

권장 서비스:
- [Resend](https://resend.com) — API 기반, 무료 플랜 3,000건/월
- [SendGrid](https://sendgrid.com) — 무료 플랜 100건/일
- AWS SES — 저렴, AWS 인프라 사용 시 적합

교체 예시 (Resend):

```js
// npm install resend
import { Resend } from "resend";
const resend = new Resend(process.env.RESEND_API_KEY);

await resend.emails.send({
  from: "noreply@22blabs.ai",
  to: email,
  subject: "AIL 이메일 인증 코드",
  text: `인증 코드: ${otp}\n\n15분 내에 입력해주세요.`,
});
```
