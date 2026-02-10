---
name: Neo-Brutalist Arcade UI Design System
description: Implement the neo-brutalist arcade mobile UI with thick black outlines, flat sticker shadows, vibrant gradient backgrounds, chunky cards, bold typography, and game-like interactions. Applies when designing, building, styling, or reviewing any UI component or screen.
---

# Neo-Brutalist Arcade UI Design System

## When This Skill Applies

- Building or styling any UI component (HUD, cards, buttons, docks)
- Implementing backgrounds for screens or pages
- Choosing fonts, colors, or spacing values
- Implementing button states, screen transitions, or animations
- Reviewing UI for acceptance before merge

## Scope

| Area | Files / Paths |
|------|--------------|
| Components | `apps/web/src/components/` |
| Global styles | `apps/web/src/app/globals.css` |
| Pages/routes | `apps/web/src/app/` |

## Guidelines

### Design Tokens (All Values From Here — No Freehand)

**Colors (CSS variables in `:root` or Tailwind theme):**

| Token | Value | Usage |
|-------|-------|-------|
| `--ink` | `#1A1A21` | Outlines, shadows |
| `--paper` | `#F5F7F7` | Card surfaces |
| `--purpleA` | `#413DE1` | Primary bg |
| `--purpleB` | `#8164ED` | Secondary bg |
| `--cyanA` | `#4CEAFD` | Accent |
| `--cyanB` | `#3BC4FB` | Accent alt |
| `--green` | `#29F724` | Correct answer |
| `--red` | `#FE3F3B` | Incorrect answer |
| `--yellow` | `#DEFD4E` | Highlight |

**Gradients:**
- Background: `linear-gradient(180deg, #413DE1 0%, #8164ED 100%)`
- Accent: `linear-gradient(135deg, #4CEAFD 0%, #3BC4FB 100%)`
- Warm (alt): `linear-gradient(180deg, #FE686F 0%, #F3A43E 100%)`

**Shape tokens:**
- Card radius: `24px` · Button radius: `18px` (or `999px` for pills)
- Border width: `4px` default, `3px` for smaller elements
- Card shadow: `8px 8px 0 var(--ink)` · Button shadow: `6px 6px 0 var(--ink)`

**Spacing (mobile):**
- Gutter: `16px` · Stack gap: `12px` · HUD height: `44–56px` · Tap height: `56px` min

**Custom Tailwind utilities (in `globals.css`):**
- `.shadow-sticker`: `box-shadow: 8px 8px 0 var(--ink)`
- `.shadow-sticker-sm`: `box-shadow: 6px 6px 0 var(--ink)`
- `.border-ink` / `.bg-paper` / `.bg-arcade`

### Style Brief (Non-Negotiable Visual Rules)

- **Every interactive element** has a thick black outline (3–4px `var(--ink)`).
- **Shadows** are flat, offset, ink-colored — never soft blurred gray.
- **Backgrounds** are never plain/solid — always gradient + halftone + burst.
- **Cards** are chunky: paper surface, 4px border, 24px radius, 8px sticker shadow.
- **Buttons** are tall pill slabs: 56px+ height, white fill, black border.
- **Selected state**: solid bright fill (green) while keeping black border.
- **Icons**: thick and toy-like (2.5–3px stroke), never thin/delicate.
- **Color feedback**: green correct, red wrong — always with black border maintained.

### Backgrounds (3-Layer Recipe)

Never use a flat solid background. Always implement as 3 layers:

1. **Base**: `.bg-arcade` gradient `linear-gradient(180deg, #413DE1 0%, #8164ED 100%)`
2. **Halftone dots** (`::before`): `radial-gradient(rgba(255,255,255,0.18) 1.2px, transparent 1.2px)`, size `10px 10px`, opacity `0.55`, blend `soft-light`
3. **Radial burst** (`::after`): `repeating-conic-gradient(...)`, inset `-40%`, mask to center, opacity `0.45`

Both overlays use `pointer-events: none`.

### Component Anatomy

**App Shell:** Centered column, max-width `~420px` for mobile web.

**HUD (top bar):**
- Left: progress/lives · Center: category pill · Right: score/time pill
- Small capsules: `3px solid ink` border, paper bg, `4px 4px 0 ink` shadow
- Icons: thick stroke (2.5–3px) · Height: `44–56px`

**Question Card:**
- Background: `paper` · Border: `4px solid ink` · Radius: `24px` · Shadow: `8px 8px 0 ink`
- Padding: `16–20px` · Text: left-aligned, bold 800, comfortable line-height

**Answer Buttons:**
- Default: white fill, `4px solid ink`, `18px` radius, `6px 6px 0 ink` shadow, `56–64px` height
- Selected: green fill, ink text, border and shadow unchanged
- Correctness: show Correct/Incorrect badge — **do not recolor wrong answers to reveal the right one**

**Bottom Dock:** Row of square buttons (`48–56px`), solid bright fill, thick border + shadow, toy-like icons

### Typography

**Fonts (loaded via Google Fonts):**
- Headings/labels: **Bungee** or **Luckiest Guy** (sparingly)
- Body/questions/buttons: **Rubik** or **Nunito** (bold 700–800)

| Element | Weight | Size | Align |
|---------|--------|------|-------|
| Question text | 800 | 20–24px | Left |
| Answer text | 800 | 16–18px | Center |
| Category pills | 700–800 | 12px, uppercase, `0.08em` spacing | — |
| HUD labels | 700–800 | — | Uppercase |

### Interactions & Motion

**Button press (`:active`):**
- `transform: translate(2px, 2px)` + shadow reduces by 2px
- Duration: `100–150ms`, `ease-out`

**Hover (`:hover`, desktop):**
- `transform: translate(-1px, -1px)` (slight raise)
- Shadow unchanged
- Duration: `150ms`, `ease-out`

**Screen transitions:** `180–240ms`, `ease-out`, subtle slide/fade.

**Progress bars:** CSS `transition: width`, smooth, `ease-out` or `linear`.

**Constraints:** No animations > 500ms. No bouncy/elastic easing. Keep it snappy.

### Accessibility

- **Touch targets**: 44px minimum (buttons are 56px+, exceeding requirement).
- **Non-color feedback**: Always include icon (✓/✗) or text alongside color changes.
- **Focus states**: 2–3px thick outline in accent color (cyan/yellow), game-like, not browser default.
- **Screen readers**: Semantic HTML, `aria-label` for icon-only buttons, `aria-live` for correctness.
- **Reduced motion**: Respect `prefers-reduced-motion` — disable animations, maintain functionality.
- **Contrast**: WCAG AA ratios for text on colored backgrounds. Ink outline ensures high contrast.

### Acceptance Checklist (Before Merge)

Every UI change must satisfy:
- [ ] Thick black outlines on interactive elements (3–4px)
- [ ] Flat sticker shadows (no blur)
- [ ] Background with gradient + halftone + burst
- [ ] Paper card with proper border/radius/shadow
- [ ] Answer buttons 56px+ with selected states
- [ ] Bold 800 typography with proper sizing
- [ ] Non-color correctness feedback (icon/text)
- [ ] Focus states visible and game-like
- [ ] `prefers-reduced-motion` respected
- [ ] Looks good at 390×844 and scales to desktop centered

## Anti-Patterns

- Thin 1px borders or subtle gray borders
- Soft blurred shadows (`0 4px 12px rgba(0,0,0,0.15)`)
- Flat solid background without texture
- Small buttons (40px height)
- Normal weight (400) typography
- System default fonts without explicit choice
- Color-only feedback (no icon/text indicator)
- Long bouncy animations (> 500ms, elastic easing)
- Hardcoded colors instead of CSS variables
- Inline styles mixed with utility classes

## Examples

**Valid card:**
```tsx
<div className="bg-paper border-4 border-ink rounded-[24px] shadow-sticker p-5">
  <p className="font-bold text-[22px] text-left leading-relaxed">
    {questionText}
  </p>
</div>
```

**Valid answer button:**
```tsx
<button
  className={`h-14 w-full border-4 border-ink rounded-[18px] shadow-sticker-sm font-bold text-lg ${
    isSelected ? 'bg-green text-ink' : 'bg-white'
  }`}
  aria-label={`Answer option: ${answerText}`}
  aria-pressed={isSelected}
>
  {answerText}
</button>
```

**Valid press interaction:**
```css
.answer-button {
  transition: transform 120ms ease-out, box-shadow 120ms ease-out;
}
.answer-button:active {
  transform: translate(2px, 2px);
  box-shadow: 4px 4px 0 var(--ink);
}
```
