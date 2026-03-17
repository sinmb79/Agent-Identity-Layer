# Minimal Publish Checklist

## Before making the repo public

- [ ] README explains the problem, thesis, target users, and non-goals
- [ ] one-pager exists and is understandable without prior context
- [ ] category wording is consistent: `Agent Identity Layer`
- [ ] no inflated claims about verification, security, or compliance
- [ ] no secrets, tokens, private paths, internal logs, or personal identifiers are committed
- [ ] license selected and added
- [ ] contribution expectations are minimally documented
- [ ] at least one concrete example of delegated-agent identity is planned

## Recommended first public files

- [ ] `README.md`
- [ ] `docs/thesis-one-pager.md`
- [ ] `docs/mvp-scope.md`
- [ ] `docs/repo-structure.md`
- [ ] `LICENSE`

## Messaging hygiene

- [ ] avoid buzzword-heavy language
- [ ] avoid claims that this proves agent truthfulness
- [ ] avoid references that imply legal identity, KYC, or personhood
- [ ] clearly separate current draft vs future roadmap

## Legal / reputational safety

- [ ] no copied proprietary spec text
- [ ] no vendor trademarks used in misleading ways
- [ ] no privacy-invasive example payloads
- [ ] examples use placeholder IDs and synthetic metadata
- [ ] disclaimers avoid giving security guarantees the project does not provide

## Nice-to-have before announcing

- [ ] `spec/README.md` placeholder describing upcoming schema work
- [ ] `docs/terminology.md`
- [ ] `docs/threat-model.md`
- [ ] simple issue template for feedback

## Publish sequence

1. commit docs-only initial structure
2. verify repo renders cleanly on GitHub
3. sanity-check wording for overclaiming
4. open initial issues for spec, examples, and threat model
5. then share publicly for feedback
