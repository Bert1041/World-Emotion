# How World Emotion works, and why

A walk-through for explaining and defending the design. The README is the full specification; this
is the version you can say out loud. Everything here is true of the code as of 2026-11-22 (Phase 6).

---

## In one minute

People tap how they feel. Every five minutes, a small job counts the last six hours of taps and
writes **one file** describing the world's mood. Everyone, whether ten people or ten million, reads
that same file from Cloudflare's cache. The phone does all the beautiful parts (the globe, the
weather, the colours) by itself. So the cost depends on how many people **tap**, not how many
**look**, and looking is free.

---

## The picture

```
  YOUR PHONE                         CLOUDFLARE
 ┌──────────────┐  tap a mood   ┌────────────────┐  save   ┌──────────┐
 │  the app     │ ────────────► │ API (Worker)   │ ──────► │ database │
 │  (globe,     │               └────────────────┘         │ (D1)     │
 │  weather,    │                                          └────┬─────┘
 │  colours)    │                every 5 minutes                │ count
 │              │               ┌────────────────┐ ◄────────────┘
 │              │  read a file  │ aggregator     │  write one file
 │              │ ◄──────────── │ (same Worker)  │ ──────► snapshot.json
 └──────────────┘   (cached)    └────────────────┘         (R2 + CDN)
```

Two paths, deliberately unequal:

- **The write path** (tapping a mood): tiny. One request, one database row.
- **The read path** (looking at the globe): huge, and free. A cached static file; no code runs, no
  database is touched.

---

## What happens when you tap "calm"

1. **The app** sends `{ mood, country, checkinId, deviceKey }` to `POST /checkin`
   (`apps/web/src/data/polled-source.ts`). The device key is a random ID made once and kept on the
   phone; it means "this phone", not "this person".
2. **The API** (`apps/api/src/app.ts`) checks, in order: the website is allowed, the body is small
   and valid, the country is real. Then it works out where the vote counts:
   - Cloudflare tells it which country the connection is in. If that matches your pick, the vote
     counts for your country, continent and world. If not (a traveller, a VPN, someone abroad trying
     to set another country's mood), it counts for **the world only**.
3. **The database** stores one row per phone: a scrambled (hashed) device key, the country (or
   empty for world-only), the mood and the time. Tapping again replaces your row; you never have two
   votes. Replaying the same tap (a flaky network) writes nothing.
4. **The app** hears back where the vote counted and says so if it was world-only. Your face flies
   onto your country; that is animation on your phone, not a server round trip.

## What happens every five minutes

The aggregator (`apps/api/src/aggregate.ts`) runs on a timer inside the same Worker:

1. Count the last six hours of votes, grouped by country and mood.
2. Load its private memory from the last run (`aggregator-state.json`).
3. Run the maths, all in one pure function in `packages/core`, tested without any network:
   - **Pool:** countries add up to continents, continents to the world.
   - **Shrink:** a country with 3 votes leans towards its continent's mood instead of swinging
     wildly (15 "virtual votes" from the level above).
   - **Smooth:** numbers drift rather than jump (half-life 3 minutes).
   - **Hysteresis:** the headline word only changes when a new mood leads by 3 points or for two
     runs in a row, so it doesn't flicker between two close moods.
   - **Privacy floor:** a place with fewer than 5 votes is left out of the public file.
4. Save the private memory **first**, then the public `snapshot.json`. If the second write fails,
   the next run rebuilds it.
5. Once an hour: keep a copy of that public file (for a future "compared to usual"), and delete
   votes older than six hours.

## What happens when you look

The app fetches `snapshot.json` every 45 seconds, give or take 15 (the jitter stops a million
phones asking at the same instant). If the file is newer, the globe's colours ease into the new
numbers over a second and a half. If anything is wrong (no network, a broken file, a newer version
the app doesn't understand), it keeps showing the last good numbers. A tab in the background stops
asking. If the numbers are more than 15 minutes old, the header says "Updated 23 min ago".

---

## Five ideas that hold it together

1. **One answer for everyone.** The server computes the mood once; every phone shows the same file.
   No phone redoes the maths, so no two people see different worlds.
2. **The important logic is pure.** All the maths is one function with no network or database in
   it, tested by itself. The server code around it only moves data in and out.
3. **Privacy by construction, not by promise.** No accounts, no names, no GPS. IP addresses are
   never stored; device keys are stored only scrambled. Small places are hidden so one person's
   mood can't be read back. What's archived is only what was already public.
4. **The phone does the beauty.** Globe, weather and colour transitions all run on the device, so
   they cost the server nothing and stay smooth even when the data only changes every five minutes.
5. **Degrade, don't die** (ADR 0006). If the server stops, the globe keeps working on old numbers
   and says how old they are. A viral day should look like a slightly late globe, not a broken app.

---

## Numbers worth knowing

| | |
|---|---|
| Vote lifetime | 6 hours, then it fades |
| Snapshot refresh | every 5 minutes |
| App checks for a new one | every 45 s ± 15 s |
| Privacy floor | 5 votes before a country or continent is shown |
| Database writes per new phone | 2 to vote, 0 for a repeat, 1 to delete later (measured on the real database) |
| Free-plan write limit | 100,000 a day, so about 33,000 new phones a day |
| Free-plan read limit | 5 million rows a day; reached at about 15,000 votes in the window (then Stage 2, README §7) |
| App download before the globe appears | about 83 KB (compressed) |
| Running cost today | $0; a domain will be about $10 a year |

---

## Hard questions, short answers

**"Why not live updates with WebSockets?"**
A live connection per person costs money per person. A cached file costs nothing however many read
it. Moods don't change by the second, and the colour easing makes 5-minute updates feel continuous.

**"Why not a normal server and database?"**
A server must be kept running, patched and paid for, and it falls over at exactly the moment you
go viral. Here there is nothing to keep alive, and the read path, 99% of the traffic, never reaches
any code.

**"Isn't that Cloudflare lock-in?"**
Partly, on purpose: one vendor keeps a solo project simple. The valuable parts (the maths, the
motion, the app) are plain TypeScript with no Cloudflare in them; only the thin server shell would
need rewriting elsewhere.

**"What do you store about me?"**
For six hours: a scrambled code for your phone, your mood, your country if it matches your
connection, and the time. No name, no account, no IP address, no location. After six hours the row
is deleted. The only history kept is the public hourly totals everyone could already see.

**"Can someone fake votes or troll a country?"**
They can't vote for a country they aren't connecting from: it counts for the world only. One phone
holds one vote. Small countries lean towards their continent, so a handful of trolls barely moves
them, and the headline resists flickering. The weak spot is scripts creating many fake phones; on
the real account Cloudflare's built-in limiter was measured to stop nothing, so launch waits for
an edge rate limit and an invisible bot check (Turnstile) on a phone's first vote (ADR 0008).

**"What if it goes viral?"**
Looking costs nothing. Voting costs 2 database writes per new phone, so the free plan carries about
33,000 new phones a day. Past that the app keeps the vote on the phone, says "will count shortly",
and keeps showing the globe. The read limit has a planned fix (time-bucketed counters) that makes
the cost depend on the number of countries rather than votes.

**"Why does my country say it's quiet?"**
Fewer than 5 people there have checked in in the last six hours. Showing it anyway could reveal how
individuals feel, so it shows its continent instead and says why.

**"Aren't you manipulating the numbers by smoothing them?"**
Smoothing changes how fast the numbers move, not where they end up. Without it, three people
tapping at once could swing a country from calm to angry and back in a minute. The counts (`n`) are
always the raw numbers.

**"Why not 3D or WebGL?"**
It was measured, not assumed (ADR 0005): a 2D canvas globe reached the frame-rate target on the
reference phone, a Pixel 6 Pro (ADR 0004), and keeps the download small for slow connections.

**"How do you know it works?"**
About 530 automatic tests, plus about 380 in real browsers at 11 screen sizes, including one that
runs the real server and database end to end. Each test was checked by breaking the code on
purpose and watching the test fail ("mutation checking"). Performance is measured on a real phone.
All of this runs on every push.

---

## Not done yet

- **A domain**, then: the CDN in front of the snapshot, the app hosted, the edge rate limit.
- **Turnstile** on a phone's first check-in (Phase 8, launch gate).
- **Offline queue and install** (Phase 7): today a failed check-in is kept and sent on next start,
  but there is no full offline mode.
- **The Pixel drag check** for the final weather drawing (issue #13).

## Read more

- `README.md`: the full specification (§3 architecture, §5 the maths, §7 the free-plan budget).
- `docs/decisions/`: why each big choice was made. 0003 privacy floor, 0005 2D canvas,
  0006 what this is and who pays, 0007 hourly archive, 0008 rate limiting.
- `docs/design/phase-6-live-data.md`: how the live-data part was designed and checked.
