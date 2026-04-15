# Scrapeman brand design — session log

## Context snapshot

Scrapeman is a Postman-grade, local-first API client (Electron + React + TS) built by scrape-do, positioned as a Bruno alternative with first-class scrape-do proxy integration. Direction is locked post-Turn-1: share scrape-do's `#FF6C37` orange, technical/mono character, fishing-hook metaphor (intentionally *unusual* — hook as code/arrow/bracket hybrid), no human/mascot cue, JetBrains Mono discipline (already bundled). Mark-dominant identity because "Scrapeman" is too long to carry a wordmark-only brand at 16px tab/dock/favicon sizes and the product is tool-first, not marketing-first. Issue #39 is the scope contract: wordmark + compact mark + lockup + full icon set + CSS accent palette.

## Open questions

_None — V1 locked in Turn 5._

## Decisions locked in

- **Color:** `#FF6C37` shared with scrape-do. No independent accent. (Turn 2)
- **Character:** Technical, sharp, monospace-disciplined. No rounding, no playfulness. (Turn 2)
- **Typography:** JetBrains Mono for wordmark + in-mark letterforms; Inter reserved for product UI body. (Turn 2)
- **No mascot / no anthropomorphism:** "man" is just the name suffix; no figure, helmet, or face. (Turn 2)
- **Hierarchy:** Mark-dominant. Wordmark appears only in README/docs lockups, never in-app chrome. (Turn 2)
- **Metaphor:** Unusual hook — must hybridise with a code/request/bracket/caret cue, not a generic fishing hook. (Turn 2)
- **Tagline bağı:** Hook sadece "catch" değil; "AI-native API payload catch" okunmalı. Mark + tagline birlikte görüldüğünde "anladım" momenti üretmeli. (Turn 3)
- **Tagline metni:** "The AI-native API Platform" — scrape-do platformundan miras, lockup'ın parçası. (Turn 3)
- **Asimetri:** V4/V6 ailesinde kapanış `}` yok — tek `{` + hook "açılıyor/yakalıyor" metaforunu güçlendiriyor. (Turn 4)
- **Lockup hiyerarşisi:** Compact tagline lockup — 8px gap + 12px turuncu accent beat. Nefes varyantı yok. Hierarchy: 112px mark + 54px wordmark + 16px tagline. (Turn 4)
- **V5 killed:** Lowercase `m` üç tümsek + descender + barb kombinasyonu V1 tek-stroke bar'ını karşılayamıyor. Wordmark-entegrasyonu Turn 5'e parked; alternatif: son `n`'ye hook descender. (Turn 4)
- **Aesthetic bar:** V1'in tek-path/tek-gesture/minimum-geometry seviyesi minimum kabul. Hiçbir varyant bu bar'ın altında ship olmaz. (Turn 4)
- **FINAL: V1 Hookline wins.** User picked V1 in Turn 5 after seeing V4′ and V6. Tagline AI-native bağı tamamen "The AI-native API Platform" metnine devredildi; mark'ın kendisi salt "request + catch" diyor ve bu kabul edildi. Canonical path: `assets/logos/scrapeman-mark.svg`. V4′/V5/V6 all archived. (Turn 5)

## Proposals under discussion

### V1) Hookline — request arrow with a barb (carried from Turn 2)
Single unbroken stroke: horizontal request shaft, 90° bend, curl into hook bowl, barb tick back at shaft. Minimum-stroke, terminal-aesthetic. AI-native tagline bağı zayıf — salt "request catches" okuması; tagline ile görünce "the catch" metaforu ancak kelimeye dayanıyor.

### V4′) Brace-Hook redrawn (Turn 4)
Tek `<path>`, tek gesture. Sağ-üstten başlıyor, sola/aşağıya brace waist pinch'ine iniyor, oradan hook bowl'a sallanıyor, barb tick ile bitiyor. Eski V4'teki iki ayrı yay + üçüncü barb stroke yok — tek nefes. Brace cue = waist pinch (JSON/API), hook cue = bowl + barb (catch). V1 aesthetic bar'ına uyuyor, conceptual tie korunuyor.

### V6) Bracket-Catch (Turn 4, NEW)
Tek `<path>`: yatay üst bar, sola dik iniş, sağa dönüp tabanı gezen alt bar, oradan yukarı hook bowl + barb. Silüet: "yakalamış bracket". V1'in tek-nefes DNA'sı + V4'ün bracket/catch anlamı. Asimetri locked: kapanış yok. Risk: `{` spesifikliği azaldı, daha jenerik `[` okuması.

### SVG sketches (64×64, #FF6C37)

**V1) Hookline**
```svg
<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
  <path d="M8 20 L40 20 Q52 20 52 34 Q52 46 40 46 Q30 46 30 36 L36 40" stroke="#FF6C37" stroke-width="5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
</svg>
```

**V4′) Brace-Hook redrawn**
```svg
<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
  <path d="M44 12 Q26 12 26 26 Q26 32 18 32 Q26 32 26 42 Q26 56 42 52 Q52 49 48 38 L42 42" stroke="#FF6C37" stroke-width="5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
</svg>
```
Reads as: tek path, sağ-üstten başlayıp sola brace waist pinch'ine, oradan hook bowl'a ve barb tick'e.

**V6) Bracket-Catch**
```svg
<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
  <path d="M46 14 L16 14 L16 50 L34 50 Q48 50 48 36 Q48 28 38 28 L44 34" stroke="#FF6C37" stroke-width="5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
</svg>
```
Reads as: `[` bracket'ın sağ-alt köşesi hook bowl + barb'a dönüşüyor; tek nefes.

### Main lockups — A/B (Turn 4)

**Lockup A — V1 Hookline** (`lockup-main-v1.svg`)
```svg
<svg viewBox="0 0 600 160" xmlns="http://www.w3.org/2000/svg">
  <g transform="translate(16, 24) scale(1.75)">
    <path d="M8 20 L40 20 Q52 20 52 34 Q52 46 40 46 Q30 46 30 36 L36 40" stroke="#FF6C37" stroke-width="5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
  </g>
  <text x="148" y="86" font-family="JetBrains Mono, ui-monospace, monospace" font-size="54" font-weight="700" fill="#F0F0F5" letter-spacing="-1">Scrapeman</text>
  <text x="150" y="116" font-family="JetBrains Mono, ui-monospace, monospace" font-size="16" font-weight="400" fill="#9EA1A8" letter-spacing="0.5">The AI-native API Platform</text>
  <rect x="148" y="124" width="12" height="2" fill="#FF6C37"/>
</svg>
```

**Lockup B — V6 Bracket-Catch** (`lockup-main-v6.svg`)
```svg
<svg viewBox="0 0 600 160" xmlns="http://www.w3.org/2000/svg">
  <g transform="translate(16, 24) scale(1.75)">
    <path d="M46 14 L16 14 L16 50 L34 50 Q48 50 48 36 Q48 28 38 28 L44 34" stroke="#FF6C37" stroke-width="5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
  </g>
  <text x="148" y="86" font-family="JetBrains Mono, ui-monospace, monospace" font-size="54" font-weight="700" fill="#F0F0F5" letter-spacing="-1">Scrapeman</text>
  <text x="150" y="116" font-family="JetBrains Mono, ui-monospace, monospace" font-size="16" font-weight="400" fill="#9EA1A8" letter-spacing="0.5">The AI-native API Platform</text>
  <rect x="148" y="124" width="12" height="2" fill="#FF6C37"/>
</svg>
```

Hierarchy locked: 112px mark + 54px wordmark + 16px tagline + 12px orange accent beat (8px gap). V4′ lockup üretilmedi — finale iki aday A/B: V1 (pure elegance, zayıf conceptual tie) vs V6 (tek-stroke elegance + bracket/catch tie). V4′ survives as compact-mark candidate.

## Dropped directions

### V5) Hook-m — killed Turn 4
Lowercase `m` üç tümsek + descender + barb = çok fazla primitif. V1 tek-stroke bar'ına taşınamadı, font render bug gibi duruyordu. Wordmark-entegrasyonu isteği Turn 5'e parked: son `n`'ye hook descender daha temiz bir alternatif.

### V3) Caret Hook — rejected Turn 3
Kullanıcı: "çok çirkin". Shell `>` + kanca hibriti görsel olarak çalışmadı. Kill hard, salvage yok.

### V2) Bracket Barb — rejected Turn 3
Kullanıcı: "espirisini anlamadım". Angular hook içinde `{ }` konsepti ikinci okuma gerektiriyordu, ama ilk bakışta "kanca yakalanmış" okuması üretmedi — braces ve hook ayrı iki şey gibi duruyordu. V4 Brace-Hook bu konsepti tek şekle indirgeyerek (brace'in alt bacağı = hook) yerini alıyor; iki eleman birbirinden ayrılamaz olunca espri anında çalışıyor.

### A) Hook & Bracket — superseded by V2 Bracket Barb (Turn 2)
Original spec was on the right track but the hook was too generic-curvy. V2 inherits the brace idea with an angular, machined hook.

### B) Signal S — dropped (Turn 2)
No hook element. User locked hook as the metaphor; a pure letterform-as-signal stops being Scrapeman and becomes a generic dev-tool S.

### C) Grid Hook — superseded by V1 Hookline (Turn 2)
Grid added complexity that fails at 16px. V1 keeps the hook-as-request idea without the dot matrix.

### D) Terminal Caret Man — partially absorbed into V3 Caret Hook (Turn 2)
Dropped as a standalone direction (no hook), but the mono caret + terminal read survives inside V3 where the caret and the hook are fused into one glyph.

### A) Hook & Bracket (Turn 1, archived)
A monospace wordmark with a stylized hook replacing the "S", curling up from a pair of curly braces `{ }` that frame the mark. The hook is the act of scraping; the braces are the data output. Ties to scrape-do via shared orange tonal value but uses a distinct glyph. Dev-tool tropes: curly-brace API convention, fishing/scraping hook. 64×64 sketch below.

### B) Signal S
A geometric "S" built from two offset horizontal bars connected by a vertical stem that pulses like a network waveform — reads as both the letter S and a request/response signal. Wordmark in Inter SemiBold, mark stands alone at 16px. Callback to scrape-do: same arrow/flow motif scrape-do uses (directional arrows, per their homepage). Tropes: signal, request round-trip, letterform.

### C) Grid Hook
A 3×3 dotted grid (data cells) with a single hook shape threading through it diagonally, pulling one cell out of alignment. Wordmark optional, mark carries the identity. The grid is the "structured output"; the hook is the act. Callback to scrape-do: tonal only (color). Tropes: grid/data, hook, disruption/extraction.

### D) Terminal Caret Man
A JetBrains Mono wordmark with a blinking caret `▌` fused into the "a" of "man", giving a subtle human/terminal-operator read without drawing a literal figure. Compact mark = just the caret + a single lowercase "s" in mono. Most terminal-forward of the four. Callback to scrape-do: spiritual only (same weight discipline). Tropes: terminal, caret, monospace dev-tool.

### SVG sketches (64×64, rough, single color)

**A) Hook & Bracket**
```svg
<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
  <path d="M14 12 L10 12 L10 52 L14 52" stroke="#FF6C37" stroke-width="4" fill="none" stroke-linecap="round"/>
  <path d="M50 12 L54 12 L54 52 L50 52" stroke="#FF6C37" stroke-width="4" fill="none" stroke-linecap="round"/>
  <path d="M32 18 Q42 18 42 30 Q42 42 32 42 Q24 42 24 36" stroke="#FF6C37" stroke-width="5" fill="none" stroke-linecap="round"/>
  <circle cx="24" cy="36" r="2.5" fill="#FF6C37"/>
</svg>
```
Reads as: `{ hook }` — curly braces flanking an S-like hook with a barb.

**B) Signal S**
```svg
<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
  <path d="M12 18 L40 18" stroke="#FF6C37" stroke-width="5" stroke-linecap="round"/>
  <path d="M40 18 L40 32 L24 32 L24 46 L52 46" stroke="#FF6C37" stroke-width="5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="52" cy="46" r="3" fill="#FF6C37"/>
  <circle cx="12" cy="18" r="3" fill="#FF6C37"/>
</svg>
```
Reads as: a blocky S traced as a request path from node to node.

**C) Grid Hook**
```svg
<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
  <g fill="#FF6C37">
    <circle cx="18" cy="18" r="3"/><circle cx="32" cy="18" r="3"/><circle cx="46" cy="18" r="3"/>
    <circle cx="18" cy="32" r="3"/><circle cx="32" cy="32" r="3"/><circle cx="46" cy="32" r="3"/>
    <circle cx="18" cy="46" r="3"/><circle cx="32" cy="46" r="3"/><circle cx="50" cy="50" r="3"/>
  </g>
  <path d="M14 14 Q54 14 50 50" stroke="#FF6C37" stroke-width="4" fill="none" stroke-linecap="round"/>
</svg>
```
Reads as: 3×3 dot grid with a curved hook sweeping from top-left, yanking the bottom-right cell out of line.

**D) Terminal Caret Man**
```svg
<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
  <text x="8" y="44" font-family="JetBrains Mono, monospace" font-size="36" font-weight="600" fill="#FF6C37">s</text>
  <rect x="36" y="18" width="6" height="30" fill="#FF6C37"/>
</svg>
```
Reads as: a mono lowercase `s` next to a solid blinking-caret bar.

## Turn log

### Turn 5 — 2026-04-15 — V1 locked, integration landed
User verdict: "V1 — Hookline hala favorim, şimdilik bu şekilde app icon ve içerde gerekli yerlerde kullanacak şekilde ayarlayalım." V4′/V5/V6 all dropped. Canonical mark written to `assets/logos/scrapeman-mark.svg`. Lockup (mark + wordmark + "The AI-native API Platform" tagline + accent beat) at `assets/logos/scrapeman-lockup.svg`. App header in `apps/desktop/src/renderer/src/App.tsx` now renders the mark as inline SVG (replaced the one-letter `<div>S</div>` placeholder). README header shows the mark + wordmark + tagline, scrape-do credit moved to a sub-line. Full icon set generated from the SVG via `scripts/build-icons.sh` using `pnpm dlx @resvg/resvg-js-cli` (rasterizer) and `iconutil` (macOS .icns builder); wrote `apps/desktop/build-resources/icon.icns` + `icon.png` for electron-builder auto-pickup (Windows `.ico` deferred — falls back to PNG). Typecheck + desktop build green.

### Turn 4 — 2026-04-14 — aesthetic bar recalibration: V1 level or nothing
User verdict on Turn 3 visuals: "tasarımlar çok güzel olmamış, V1 Hookline kadar etkilemedi". Concept kabul edildi ama execution zayıftı — V4 iki ayrı yay + ayrı barb olarak okunuyordu, V5 `m` glyph'i font render bug gibiydi. Locked: V5 risk reddedildi ve compact tagline lockup + V4 asimetrisi (kapanış yok) kabul edildi. V5 killed. V4 yeniden çizildi → V4′: tek `<path>`, tek gesture, brace waist pinch + hook bowl + barb. V6 new: V1 DNA + V4 concept — tek stroke bracket + hook bowl. Finale A/B: lockup-main-v1.svg (pure V1 elegance) vs lockup-main-v6.svg (tek-stroke + conceptual tie). Preview güncellendi: V5 silindi, V4′ redrawn, V6 eklendi, iki lockup hero. Aesthetic bar locked: V1 seviyesi minimum. Turn 5'te A/B finali + icon set.

### Turn 3 — 2026-04-14 — kill V2+V3, tie mark to tagline, new V4/V5 + main lockup
User verdict: V1 yaşıyor, V2 espri okunmadı, V3 çirkin, hook metaforu sevildi ve yeni kısıt geldi — mark "The AI-native API Platform" tagline'ına bağlansın, lockup buna göre kurulsun. V3 öldürüldü (preview dosyası silindi). V2 öldürüldü (redraw yerine konsepti tek-şekle indirgeyen V4 Brace-Hook ile değiştirildi: iki eleman birbirinden ayrılamayınca espri anında çalışıyor). Yeni compositions: V4 Brace-Hook (`{` glyph'inin alt bacağı olta kancası + diken; JSON payload + catch tek şekilde) ve V5 Hook-m (mono lowercase `m`'in sol bacağı kancaya dönüşüyor; Scrapeman'in son harfi, entegre wordmark olasılığı). Ana lockup çizildi: V4 mark (~112px) + "Scrapeman" JetBrains Mono 54px 700 + "The AI-native API Platform" JetBrains Mono 16px 400 muted + 12px turuncu accent underscore. V4 ana aday, V5 entegre wordmark için alternatif. 3 dar soru: V5'in 16px compact mark riski, tagline'ın locked-up mı ayrı beat mi olacağı, V4'te kapanış `}` yokluğunun hissi. Preview dosyaları güncellendi: v3 silindi, v2 silindi, v4-brace-hook.svg + v5-hook-m.svg + lockup-main.svg eklendi, index.html Turn 3'e yeniden yazıldı (hero lockup en üstte).

### Turn 2 — 2026-04-14 — narrow to hook, 3 compositions
User answered Turn 1: keep scrape-do orange, delegate wordmark-vs-mark call to me, hook can be unusual, spiritual callback only, technical character, mono typography, no human/mascot. Locked 6 decisions (color, character, typo, no-mascot, mark-dominant hierarchy, unusual-hook metaphor). Justified mark-dominant choice: "Scrapeman" is too long as a wordmark-only brand at 16px, and the product is tool-first. Dropped B (Signal S) and D (Terminal Caret Man) per no-hook rule; absorbed D's caret idea into V3. Produced 3 hook compositions: V1 Hookline (single-stroke request arrow with barb, minimum-stroke terminal-aesthetic), V2 Bracket Barb (angular machined hook inside compressed `{ }`), V3 Caret Hook (shell `>` caret whose tip curls into a hook — hybrid typographic read). Asked 4 trade-off questions covering 16px legibility of V1, V3's double-read cost, lockup typography pairing, and brace height in V2.

### Turn 1 — 2026-04-14 — discovery
User opened issue #39 asking for logo + icon set + brand system, with direction: connect to scrape-do brand (colors/products/logo OK) but keep something distinct to the Scrapeman name. Read full product context (vision, research, README, memory, styles.css, existing single legacy PNG). Proposed 4 direction concepts (Hook & Bracket / Signal S / Grid Hook / Terminal Caret Man) as a spread across the design space — brace+hook, network signal, grid+disruption, terminal wordmark. Each got a rough 64×64 single-color SVG sketch. Asked 7 narrow trade-off questions covering color ownership, wordmark-vs-mark, icon metaphor, scrape-do callback intensity, character, typography, and the "man" suffix question. Awaiting user picks before Turn 2 narrows to 3 variants within the chosen direction.
