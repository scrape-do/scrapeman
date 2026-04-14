<!--
Thanks for the PR. Keep descriptions in Turkish (body) and English (title)
per scrape-do convention.
-->

## Özet

<!-- 1-3 bullet neden + ne değişti. Postman/Bruno davranışından farklılık varsa belirt. -->

-
-

## İlgili milestone / task

<!-- planning/milestones.yaml veya planning/tasks.yaml içindeki ID. Yoksa neden yeni task gerekmediğini açıkla. -->

- Milestone: M?
- Task(s): T???

## Değişikliklerin kapsamı

- [ ] HTTP engine (undici executor, proxy, HTTP/2)
- [ ] File format (serialize / parse / round-trip)
- [ ] Environment variables / resolver
- [ ] Auth helpers (Basic / Bearer / OAuth2 / SigV4)
- [ ] Cookies / history / workspace FS
- [ ] Response viewer / JSON tree / preview modes
- [ ] Code generation
- [ ] Load runner
- [ ] Import (curl / Postman / etc.)
- [ ] UI / keyboard / theme
- [ ] Planning docs / roadmap
- [ ] Infra (CI / build / release)

## Test plan

- [ ] `pnpm -r typecheck` temiz
- [ ] `pnpm -r test` 125+ passing (yeni test eklendi mi?)
- [ ] `pnpm -r build` mac/linux/win matrisinde yeşil (CI)
- [ ] Elle test edildi: `pnpm dev` ile …
- [ ] Dogfood: gerçek scrape-do endpoint'ine karşı …

## Curl örnekleri (HTTP endpoint davranışı değiştiyse)

```bash
# Baseline (eskiden böyleydi)
curl ...

# Yeni davranış
curl ...
```

## Screenshots (UI değişikliği varsa)

<!-- Before / after görüntüler veya kısa video. -->

## Breaking changes

- [ ] Yok
- [ ] Var — açıkla:

## Notlar

<!-- Reviewer için özel dikkat edilmesi gereken yerler, follow-up issue'lar, vs. -->
