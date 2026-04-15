---
doc: landing-page
owner: product-manager
status: draft
updated: 2026-04-14
---

# Scrapeman Landing Page — Tasarım Analizi & Roadmap

## Genel Konsept

**Slogan:** *The HTTP client built for scraping engineers.*

Scrapeman'i diğerlerinden ayıran tek bir cümle: Postman'ın ücretli özelliklerini ücretsiz verir, Bruno'nun doğru modelini (local-first, git-friendly) alır, Postman'ın yapamadığı şeyleri (SSE, büyük response, proxy-first, Scrape.do entegrasyonu) yapar.

Landing, bir ürün satış sayfası değil — bir **manifestodur**. "Biz neden varız ve diğerleri neden yetmez" sorusuna güçlü, kanıtlı ve görsel cevap verir.

---

## Sayfa Haritası (Sitemap)

```
/                        → Ana sayfa (home)
/vs/postman              → Postman ile karşılaştırma
/vs/bruno                → Bruno ile karşılaştırma
/vs/insomnia             → Insomnia ile karşılaştırma
/features                → Tüm özellikler (detaylı)
/changelog               → Release notları (ileride)
```

---

## Tech Stack Önerisi

| Karar | Seçim | Neden |
|-------|-------|-------|
| Framework | **Astro** | Island architecture, zero JS default, MDX desteği, SSG, Tailwind native |
| Stil | **Tailwind CSS v4** | Zaten Scrapeman UI'da kullanılıyor, tutarlılık |
| Animasyon | **Motion (eski Framer Motion)** | React islands için, scroll-triggered animasyonlar |
| Görseller | **Lottie + CSS animasyonlar** | Uygulama mockup'ları için |
| İkon | **Lucide** | Zaten kullanılan set |
| Font | **Inter + Geist Mono** | Inter: UI, Geist Mono: kod bloklarında |
| Hosting | **Vercel / Cloudflare Pages** | Astro ile sıfır config |

---

## Renk & Tasarım Dili

### Tema: Dark-first, accent vurgusu

Scraping = gece, proxy = tünel, anti-bot = gizlilik. Koyu arka plan doğal hissettiriyor.

```
Background:    #0a0a0f  (neredeyse siyah, saf siyah değil)
Surface:       #111118  (kart arka planları)
Border:        #1e1e2e  (ince çizgiler)
Accent:        #6366f1  (indigo — mevcut app primary rengi)
Accent alt:    #a78bfa  (violet — gradient için)
Text primary:  #f8f8ff
Text muted:    #71717a
Green (yes):   #22c55e
Red (no/bug):  #ef4444
```

### Tipografi

- **Display başlıklar:** Inter, 700-800 weight, letter-spacing sıkı (-0.02em)
- **Body:** Inter Regular 16px, line-height 1.7
- **Kod örnekleri:** Geist Mono, accent rengiyle syntax highlight

---

## Ana Sayfa (/)

### Hero Section

**Layout:** Tam ekran, ortalanmış, animasyonlu arka plan

**Başlık (h1):**
```
The HTTP client
built for scraping.
```
Büyük, bold, "scraping" kelimesi accent rengiyle vurgulanmış — ince gradient animasyon.

**Alt başlık:**
```
Local-first. Git-friendly. No account required.
Everything Postman paywalls — free, forever.
```

**CTA butonları:**
- `Download for Mac` (primary, indigo)
- `View on GitHub` (ghost, border)

**Hero görsel:**
App'in actual screenshot'u — dark theme, bir request açık, response görünür. Hafif 3D perspektif (CSS `perspective` + `rotateY`) ile "floating" efekt. Mouse move parallax (hafif, 5-10° maksimum).

**Animasyon:** Hero yüklenirken başlık satır satır slide-up + fade-in (staggered, her satır 80ms gecikme).

---

### Social Proof / Numbers Bar

```
[ 0 cloud accounts needed ]  [ ∞ history, free ]  [ 100% local ]  [ MIT License ]
```
Animasyonlu sayaçlar (count-up on scroll).

---

### Feature Highlights (3-column grid)

Her kart scroll'da slide-up + fade animasyonu (intersection observer, stagger).

**Kart 1 — Proxy-first**
İkon: Network/Globe (Lucide)
```
Built for Scrape.do
One toggle. Residential proxy, JS rendering,
geo targeting — directly from the request builder.
No curl hacks.
```

**Kart 2 — Git-friendly collections**
İkon: GitBranch
```
Human-readable diffs
One .req.yaml per request. Commit, branch, PR.
Your team reviews API changes like code changes.
```

**Kart 3 — No account, no cloud**
İkon: Shield / Lock
```
Your data stays local
Request bodies never leave your machine.
No telemetry. No sync service. No account wall.
```

**Kart 4 — Unlimited history**
İkon: Clock
```
Postman caps at 25. We don't.
Every request you've ever sent, instantly searchable.
Restore any run to a new tab in one click.
```

**Kart 5 — SSE & streaming done right**
İkon: Zap / Activity
```
Bruno gets this wrong. We don't.
SSE events buffered once, shared between UI and scripts.
Large responses don't crash the tab.
```

**Kart 6 — Auth that works**
İkon: Key
```
OAuth2, AWS SigV4, and more — free
Token cache, proactive refresh, concurrent request safety.
Everything Postman puts behind a paywall.
```

---

### "How it's different" — Live Comparison Demo

Animasyonlu tabs: `Postman` / `Bruno` / `Scrapeman`

Her tab'da aynı işlem (örn: Scrape.do proxy açma) nasıl yapılıyor gösterimi.
- Postman: 6 adım, plan gerekli → 😤
- Bruno: "Not supported" → 😤  
- Scrapeman: 1 toggle → 🎉

Bu section'da CSS/JS ile simüle edilmiş UI mockup (actual screenshot değil, styled div'ler).

---

### "Free what Postman paywalls" Section

Karanlık arka plan, parlak tablo. Solda Postman fiyatı, ortada özellik, sağda Scrapeman.

| Feature | Postman | Scrapeman |
|---------|---------|-----------|
| Request history | 25 requests (free) / Unlimited ($14/mo) | **∞ Free** |
| Collection runs | 25/month (free) | **∞ Free** |
| OAuth2 all flows | Paid | **Free** |
| AWS SigV4 | Paid | **Free** |
| Response diff | Not available | **Free (v1.5)** |
| Git-based sharing | Paid workspaces | **Free (it's just git)** |
| Offline mode | Broken | **Always offline** |

Animasyon: Her satır sırayla açılır (stagger), Scrapeman sütunu yeşil highlight ile vurgulanır.

---

### Terminal Animation Section

Siyah terminal, typing animation:

```bash
$ scrapeman import curl "curl -x socks5://proxy:1080 \
  -H 'Authorization: Bearer {{TOKEN}}' \
  https://api.example.com/data"

✓ Imported: GET api.example.com/data
  ↳ Proxy: socks5://proxy:1080 (auto-detected)
  ↳ Auth: Bearer token from {{TOKEN}}
  ↳ Settings tab populated
```

Ardından: app screenshot'u ile aynı request açılmış hali.

---

### Download / CTA Section

```
Ready to ditch Postman?

[Download for macOS]  [Download for Windows]  [Download for Linux]
        ↓ also available on GitHub Releases
```

Animasyon: Butonlar hover'da hafif yukarı kayar (translateY -2px), shadow açılır.

---

## Vs Postman (/vs/postman)

### Hero

**Başlık:** `Postman is great. Until it isn't.`

**Alt başlık:**
```
Account required. Cloud-forced. $14/user/month for features
that should be free. Scrapeman is what Postman was before it
became a platform.
```

### Comparison Table (Detaylı)

Tüm feature karşılaştırması, kategori bazlı:

**Pricing & Access**
- Free history: 25 vs ∞
- Account required: Yes vs No
- Offline mode: Broken vs Always
- Price for OAuth2: $14/mo vs Free

**Privacy & Data**
- Request bodies to cloud: Sometimes vs Never
- Telemetry on requests: Yes vs No
- Local-first: No vs Yes

**Scraping Features**
- Proxy configuration: Basic vs Advanced (SOCKS5, Scrape.do)
- SSE streaming: Basic vs Buffered, crash-proof
- Large response handling: Crashes (>10MB) vs Truncated for UI, full for scripts
- Anti-bot detection: No vs Yes (Cloudflare, CAPTCHA signals)

**Developer Workflow**
- Git-friendly format: JSON (noisy diffs) vs YAML (human-readable)
- One file per request: No (one giant JSON) vs Yes
- Curl import: Yes vs Yes (with proxy detection)

### "The moment we all agreed Postman crossed the line" Section

Timeline animasyonu (vertical scroll-triggered):

```
2019 — Postman removes native app, goes full Electron
2021 — Paid tiers introduced
2022 — History capped at 25 for free users
2023 — Account required to use the app at all
2024 — "Flows" launched instead of fixing offline mode
2025 — Enterprise push continues, free tier gets worse
```

### Migration Guide

```bash
# Export from Postman:
# Postman → File → Export → Collection v2.1

# Import to Scrapeman:
# Sidebar → Import → Postman v2.1 → Select file
# ✓ Auth preserved
# ✓ Variables preserved  
# ✓ Folder structure preserved
```

---

## Vs Bruno (/vs/bruno)

### Hero

**Başlık:** `Bruno gets the model right. The execution needs work.`

**Alt başlık:**
```
Local-first, git-friendly, open source — Bruno was on the right track.
But four long-standing bugs make it unreliable for scraping workflows.
We fixed them all.
```

### Tone önemli

Bruno'yu aşağılamıyoruz — saygılı, teknik, kanıta dayalı.
"They got the philosophy right, we got the implementation right."

### The 4 Bugs Section

Her bug için animasyonlu kart, kanıt linki ile:

**Bug 1 — SSE body is undefined**
```
usebruno/bruno#7083 (open since 2023)

Bruno: sse.body → undefined on some servers
Scrapeman: Events buffered immediately, shared array,
           stream consumed exactly once.

Our test: sse-reader.test.ts — "split chunk arrival"
```

**Bug 2 — Large response crashes the tab**
```
usebruno/bruno#7624 (open since 2024)

Bruno: 10MB response → tab freeze / crash
Scrapeman: >2MB truncated for UI, full body available
           for scripts and save-to-file.

Our test: large-response.test.ts — "3MB body truncated correctly"
```

**Bug 3 — Cookies don't survive restart**
```
usebruno/bruno#6903 (open since 2023)

Bruno: async cookie flush → process exit drops cookies
Scrapeman: fs.writeFileSync on every setCookie. Synchronous.
           Survives restart by design.

Our test: cookie-jar.test.ts — "persists across restart (the Bruno fix)"
```

**Bug 4 — OAuth2 token race condition**
```
usebruno/bruno#7565 (open since 2024)

Bruno: 5 concurrent requests → 5 token fetches
Scrapeman: Single in-flight Promise. Concurrent requests
           share one token fetch, always.

Our test: oauth2.test.ts — "concurrent dedup: 5 parallel → 1 token call"
```

### Feature Comparison

| | Bruno | Scrapeman |
|---|---|---|
| Local-first | ✅ | ✅ |
| Git-friendly YAML | ✅ | ✅ |
| Scrape.do integration | ❌ | ✅ |
| SSE streaming (correct) | ❌ Bug #7083 | ✅ |
| Large response safe | ❌ Bug #7624 | ✅ |
| Cookie persistence | ❌ Bug #6903 | ✅ |
| OAuth2 (concurrent safe) | ❌ Bug #7565 | ✅ |
| Proxy-first UI | Limited | ✅ |
| Anti-bot signals | ❌ | ✅ |
| History panel | ❌ | ✅ |
| Unlimited history | ❌ | ✅ |
| In-app git panel | ❌ | ✅ |

### "We share the same philosophy" callout

```
We believe what Bruno believes:
  — Collections belong in git, not in the cloud
  — One file per request, human-readable diffs
  — No account, no sync service

We just fixed the bugs.
```

---

## Vs Insomnia (/vs/insomnia)

### Hero

**Başlık:** `Insomnia was good. Kong changed that.`

**Alt başlık:**
```
After Kong's acquisition in 2023, Insomnia moved features behind
a cloud account. What was a beloved local tool became another
cloud platform. Scrapeman is what Insomnia used to be — plus
everything it never had for scraping.
```

### Timeline: The Trust Break

```
2019  — Insomnia founded, beloved local HTTP client
2020  — Kong acquires Insomnia
2023  — v8 rewrite: Git sync removed from free tier
        — Local storage moved to cloud storage by default
        — Community backlash, r/webdev threads, HN front page
2023  — Panic.app & others write migration guides
2024  — Scratch storage still not fully restored
        — Enterprise focus deepens
2025  — Free tier remains cloud-required for sync features
```

### Feature Comparison

| | Insomnia | Scrapeman |
|---|---|---|
| Local-first | ❌ Cloud-forced since v8 | ✅ |
| Account required | ✅ Required | ❌ Never |
| Git sync (free) | ❌ Paid | ✅ (it's just git) |
| Offline capable | Partial | ✅ Always |
| OAuth2 (free) | ❌ Paid | ✅ |
| Scraping features | ❌ | ✅ |
| Open source | Partially | Coming |

### Migration CTA

```bash
# Insomnia v4 export:
# Application → Preferences → Data → Export Data

# Import to Scrapeman:
# Sidebar → Import → Insomnia v4
# ✓ Requests, folders, environments preserved
# ✓ Auth types mapped
```

---

## Animasyon Detayları

### Scroll Animations (tüm sayfalarda)

```javascript
// Intersection Observer ile scroll-triggered
const variants = {
  hidden: { opacity: 0, y: 24 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease: 'easeOut' } }
}

// Stagger: liste elemanları sırayla açılır
const containerVariants = {
  visible: { transition: { staggerChildren: 0.08 } }
}
```

### Hero Background

CSS animated gradient mesh:
```css
.hero-bg {
  background: radial-gradient(ellipse at 20% 50%, #6366f120 0%, transparent 50%),
              radial-gradient(ellipse at 80% 20%, #a78bfa15 0%, transparent 50%),
              #0a0a0f;
  animation: mesh-drift 8s ease-in-out infinite alternate;
}

@keyframes mesh-drift {
  from { background-position: 0% 50%; }
  to   { background-position: 100% 50%; }
}
```

### Feature Cards — Hover Effect

```css
.feature-card {
  border: 1px solid #1e1e2e;
  transition: border-color 0.2s, transform 0.2s, box-shadow 0.2s;
}
.feature-card:hover {
  border-color: #6366f140;
  transform: translateY(-4px);
  box-shadow: 0 20px 40px #6366f110;
}
```

### Bug Cards — Reveal Animation

Her bug kartı scroll'da sola veya sağdan slide-in (alternating):
```
Bug 1: ← sol
Bug 2: → sağ
Bug 3: ← sol
Bug 4: → sağ
```

### Comparison Table Rows

Her satır sırayla fade-in + scale (0.95 → 1), Scrapeman sütunu yeşil pulse ile vurgulanır.

### Terminal Typing

`typed.js` veya custom implementation:
- Karakter karakter yazma
- Cursor blink
- `✓` çıktısında yeşil renk

### App Screenshot Mockup

```css
.app-mockup {
  transform: perspective(1200px) rotateY(-8deg) rotateX(2deg);
  transition: transform 0.5s ease;
}
.app-mockup:hover {
  transform: perspective(1200px) rotateY(-2deg) rotateX(0deg);
}
```

Mouse move parallax (max ±5° rotasyon):
```javascript
document.addEventListener('mousemove', (e) => {
  const x = (e.clientX / window.innerWidth - 0.5) * 10;
  const y = (e.clientY / window.innerHeight - 0.5) * -5;
  mockup.style.transform = `perspective(1200px) rotateY(${x}deg) rotateX(${y}deg)`;
});
```

---

## Sayfa Yapısı / Component Listesi

```
landing/
├── src/
│   ├── pages/
│   │   ├── index.astro           ← Ana sayfa
│   │   ├── vs/
│   │   │   ├── postman.astro
│   │   │   ├── bruno.astro
│   │   │   └── insomnia.astro
│   │   └── features.astro
│   ├── components/
│   │   ├── layout/
│   │   │   ├── Header.astro      ← Nav (logo, vs links, download CTA)
│   │   │   └── Footer.astro
│   │   ├── home/
│   │   │   ├── Hero.astro
│   │   │   ├── NumbersBar.astro
│   │   │   ├── FeatureGrid.astro
│   │   │   ├── ComparisonDemo.astro
│   │   │   ├── PricingTable.astro
│   │   │   ├── TerminalDemo.astro
│   │   │   └── DownloadCTA.astro
│   │   ├── vs/
│   │   │   ├── VsHero.astro
│   │   │   ├── ComparisonTable.astro
│   │   │   ├── BugCard.astro     ← Bruno sayfasında
│   │   │   ├── Timeline.astro    ← Postman/Insomnia sayfasında
│   │   │   └── MigrationGuide.astro
│   │   └── shared/
│   │       ├── AnimatedSection.astro   ← scroll-triggered wrapper
│   │       ├── GlowCard.astro
│   │       └── Badge.astro       ← ✅ / ❌ / ⚠️
│   ├── styles/
│   │   └── global.css
│   └── layouts/
│       └── Base.astro
├── public/
│   ├── screenshots/              ← App ekran görüntüleri
│   └── og/                       ← Open Graph görseller
├── astro.config.mjs
├── tailwind.config.mjs
└── package.json
```

---

## İçerik Öncelikleri (Build Order)

1. **Layout + Header + Footer** — nav, logo, renk sistemi
2. **Ana sayfa Hero** — ilk izlenim en kritik
3. **vs/bruno** — en güçlü teknik argument, somut bug kanıtları var
4. **vs/postman** — en geniş kitle
5. **vs/insomnia** — daha küçük kitle
6. **Feature grid + PricingTable** — ana sayfanın geri kalanı
7. **TerminalDemo + animasyonlar** — polish pass
8. **Download CTA + og görseller** — launch hazırlığı

---

## Copywriting Prensipleri

1. **Kanıta dayalı** — her iddianın yanında GitHub issue numarası veya test adı
2. **Saygılı rakip dili** — Bruno/Insomnia'ya saldırmıyoruz, faktleri paylaşıyoruz
3. **Developer-first ton** — pazarlama jargonu yok, teknik detay tercih edilir
4. **Aktif fiiller** — "Scrapeman fixes" değil "We fix" değil "Fixed."
5. **Kısa paragraflar** — max 2-3 cümle, sonra boşluk

---

## SEO & Meta

Her sayfa için:
```html
<!-- Ana sayfa -->
<title>Scrapeman — HTTP Client for Scraping Engineers</title>
<meta name="description" content="Local-first HTTP client with Scrape.do integration, proxy-first design, unlimited history. Free forever. No account required.">

<!-- vs/postman -->
<title>Scrapeman vs Postman — Local-first, Free, No Account</title>

<!-- vs/bruno -->
<title>Scrapeman vs Bruno — Same Philosophy, Fixed Bugs</title>

<!-- vs/insomnia -->
<title>Scrapeman vs Insomnia — Local-first alternative after Kong</title>
```

Open Graph: Uygulama screenshot'lu dark background, 1200×630.

---

## Başlangıç Komutu

```bash
mkdir -p ~/Developer/scrapeman-landing
cd ~/Developer/scrapeman-landing
npm create astro@latest . -- --template minimal --typescript strict --install
npx astro add tailwind
npm install motion
```
