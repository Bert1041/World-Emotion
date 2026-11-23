# Phase 6.5 design: motion and sound

Status: **approved** (2026-11-23): D1–D4 as recommended (§7): prototype first behind `?look=next`; the music follows the world's mood; the PR waits for a Pixel session (closes issue #13 too); the kept-check-in defect gets its own small PR first. Added by the user on 2026-11-23,
before Phase 7: "improve animations, it's boring currently; add background music, Interstellar-type".
User answers so far: all four moments feel flat (first open, idle globe, the check-in, moving
around); music **generated in the app**; **off by default** behind a sound button; this phase comes
**before Phase 7**. This reverses PLAN.md's "sound: recommend post-launch" (§14 open question,
now decided: in scope).

## 1. What the app does today (recorded 2026-11-23, phone 390×844, demo data)

Screenshots: open at 0.2/0.6/1.2 s, idle 0 and 3 s, check-in at 0.15–2.5 s, a tap to zoom.

| Moment | Today | Why it reads as flat |
|---|---|---|
| First open | Dim disc, then the whole globe appears at once. | No arrival: the world is just *there*. |
| Idle | Slow spin (4°/s after 4 s untouched, not while choosing a country); weather dots a few pixels wide; a constant rim glow; flat dark-blue backdrop. | Nothing around the globe; the weather is too small to read as weather on a phone; nothing changes when new data arrives except colours easing. |
| Check-in | Face pops, shrinks while flying, three 1-px rings, counter +1. | The landing has no impact: your country doesn't react, the rings are thin lines, and the moment is over in ~1 s. README §8.2.5 calls this "the dopamine hit; polish it first". |
| Moving around | Great-circle glide and zoom (1.2 s), card slides in. | Correct but uniform: every move feels the same; the rest of the world doesn't step back. |

## 2. Visual changes

Every item honours `prefers-reduced-motion` (crossfades only, no particles or rotation, as today) and
the adaptive tiers (README §8.4). Every number is a motion token.

| ID | Moment | Change | Cost control |
|---|---|---|---|
| **V1** | Idle | **Space around the Earth:** a star field in three depths that drifts with the globe's rotation (parallax), a faint nebula tinted by the world's theme, a rare shooting star (about one a minute). | Stars rendered **once** into a small tile, shown as CSS layers moved with `transform` (compositor only, no per-frame canvas work). Shooting star: one CSS animation. |
| **V2** | Idle | **A breathing atmosphere** (README §8.2.1, not built): the rim glow swells and fades slowly (~6 s cycle) in the world mood's colour, brighter on the day side (from the existing sun position). | Glow is already drawn; this varies its alpha and gradient stop. Redraw of the base layer avoided: the glow moves to its own layer or CSS. |
| **V3** | Idle | **Weather you can see:** at rest, particles larger and brighter, and each mood more itself: fireflies blink, mist drifts in wisps, sparkle bursts, static jitters, rain streaks, embers rise and flicker. While dragging, today's cheap versions stay. | The Pixel bench gate (§5). The at-rest budget is idle time, where there is headroom; drag numbers must not move. |
| **V4** | Idle | **News you can see:** when a new snapshot changes a country's headline mood, it glints (brightens, then settles) and puffs a few particles of the new mood. A changed world headline: the word rolls and the Earth's theme cross-fades, as today, plus a soft swell in the music (S1). | Only countries whose headline changed; at most once per snapshot (5 min). |
| **V5** | First open | **Arrival, under 2 s:** stars fade in → the Earth rises out of the dim disc and turns, settling on your country with a spring → countries colour in, in a wave from your pin outwards → headline word rolls in → the bar slides up. Any touch or key finishes it at once. Only on a cold start (not after a reload within a few minutes). | Uses the existing fill tween with a per-country delay by distance; no new geometry. |
| **V6** | Check-in | **Landing with impact:** the face pops with squash and stretch, flies on a curved arc keeping its size until it lands; **your country flashes** in your mood's colour and settles back; a **burst of your mood's particles** from the landing point; the rings become soft glowing bands that fade as they spread; the world count rolls with a brief glow; the result line reveals line by line; a haptic tick on Android; a chime in the music's key if sound is on (S2). Total ~2.5 s, never blocking a tap. | Burst reuses the particle pool; bands are the existing ring outlines with a wider, gradient stroke. |
| **V7** | Moving | **A journey, not a cut:** a long glide lifts out (zoom out mid-way, then in) and a short one doesn't; the rest of the world dims and loses colour while a region is open; the stars parallax during the glide (depth); the panel's bars fill one after another; back reverses it. | Dimming is a fill-alpha in the existing draw; stars are V1's layers. |

## 3. Sound

| ID | Piece | Design |
|---|---|---|
| **S1** | Generative score | Original music written as code with the browser's Web Audio: organ-like voices (a few sine harmonics per note, slow attack), a soft repeating four-note figure, a low drone, long reverb (an impulse made in code), all very slow. *In the spirit of* cinematic space scores; **no melody, recording or sample copied from any film**. The world's mood picks the harmony and pace (§7 D2): calm open and suspended, happy major and bright, excited a quicker figure, stressed a restless pulse, sad minor and low, angry a dark drone; a mood change crossfades over ~8 s. Never loops the same way twice (seeded variation in voicing and timing). |
| **S2** | Effects | Only when sound is on: a chime on check-in (in the current key), a soft whoosh on a long glide. Nothing on hover or every tap. |
| **S3** | Control | A speaker button beside the language switch: off by default; the choice is remembered on the device (`we.sound`). Audio starts only from that tap (browsers require a gesture). Fades out when the tab is hidden, back in on return. Low default volume. |
| **S4** | Cost | The audio code is a **lazy chunk** loaded on the first tap of the button (initial JS unchanged but for the button). Native Web Audio nodes run on the browser's audio thread; CPU measured on the Pixel (§5). No files to download. |
| **S5** | Licence | Self-made, recorded in `docs/licenses.md`. |

**Platform notes.** iOS mutes Web Audio when the ringer switch is on silent unless the page asks for
media playback (`navigator.audioSession.type = "playback"`, Safari 17+); we set it, and say "Sound
is on but your phone is on silent" only if we can detect it (we usually can't: accepted). Android
has no such switch.

## 4. Order

1. **Prototype** (D1): V5 arrival, V1 space, V6 check-in and a first S1 sketch, behind `?look=next`
   on the test deployment. You try it on the phone and the laptop; we tune; then finish.
2. Then V2, V3, V4, V7, S2, S3 polish.
3. Bench gates (§5), then the PR.

## 5. Tests and verification

- **Unit:** timelines are pure functions of time (arrival stages, landing flash, burst, band
  alpha, glide lift by distance, star parallax offset by rotation, music scheduler: notes in key,
  crossfade length, no scheduling while hidden). Mutation-checked as before.
- **Browser:** each moment at key times (screenshots asserted by numbers: e.g. the pinned country's
  fill differs from rest at the landing, the rest of the world is dimmer while a region is open);
  reduced motion: no particles, no parallax, no arrival spin; any input ends the arrival at once; the
  sound button starts and stops an `AudioContext` (Playwright Chrome supports it, checked with a
  muted output), its choice is remembered, nothing plays before a tap.
- **Layout:** the existing 11-viewport tests still pass (the bar's height must not change).
- **Performance, desktop:** bench A/B against `main` at 4× CPU: drag p95 within 3 %, idle frame
  cost reported.
- **Performance, Pixel 6 Pro (ADR 0004):** drag p95 within 10 % of `main`, no new long frames at
  start-up, audio on vs off. This overlaps issue #13 (one phone session covers both). **Needs you
  and the phone** (§7 D3).
- **Initial JS:** within 5 KB of 86.4 KB gz (the button and timelines; audio and stars generator
  lazy where possible).
- **Listening:** the music can't be tested by a machine for taste; you approve it in the prototype.

## 6. Not in this phase

- Recorded music or samples (decided: generated).
- 3D/WebGL (ADR 0005: 2D canvas stands; revisit only if a gate fails).
- A shareable video clip (README §8.2.8: later, after the share card in Phase 7).
- Sound effects on every tap.

## 7. Decisions for you

**D1. Prototype first.**
- **A (recommended):** I build the arrival, space backdrop, new check-in and a music sketch behind
  `?look=next`, deploy it for testing, and you judge it on your phone before I finish the rest.
  Taste is the risk here, not code.
- B: build everything, review at the PR.

**D2. Music and the world's mood.**
- **A (recommended):** one score whose harmony and pace follow the world's mood (6 variations).
- B: one fixed score, the same whatever the mood.

**D3. The phone check.** The changes add drawing work; the Pixel bench is the only proof they stay
smooth on a phone (desktop always has headroom).
- **A (recommended):** the PR waits for one phone session with you (about 30 minutes, phone on the
  cable, cool), which also closes issue #13.
- B: merge on the desktop bench; phone check later, risk accepted.

**D4. A defect found while planning Phase 7** (not motion): a check-in that couldn't be sent is
kept without its time, so a phone offline overnight sends yesterday's mood in the morning and it
counts as fresh for another 6 hours, while the app already shows the faces again.
- **A (recommended):** a small fix PR now, before this phase (about an hour with tests).
- B: fix it in Phase 7a as planned.
