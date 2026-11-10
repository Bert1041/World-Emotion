# Competitor failure analysis and pre-mortem (2026-11-10)

Scope: products that let many anonymous people register a feeling, a tap or a vote and show the
aggregate live; products that track mood; products that rose on novelty and fell. Evidence was gathered
by web search and page fetches on 2026-11-10. Each case marks **documented** (sourced) against
**analysis** (mine). Where a search failed or a source was weak, it says so rather than filling the gap.

Read with `docs/audit-2026-11-10.md` (the product audit) and `docs/design/phase-5.5-bridge.md`.

---

## 0. The finding that changes the plan

**This product already exists, many times, and almost all of them are empty.** A single search for
"world mood map anonymous check-in" returned seven live sites with the same core design as ours: one
anonymous tap, a map coloured by country, a global number. Fetched on 2026-11-10:

| Site | State on fetch (documented) |
|---|---|
| moodmap.world | 8 moods, "Anonymous by design", live area shows **"Waiting for moods..."**; pivoting to Slack/remote-team landing pages |
| mood2know.com | one-click mood 1–10; live stats all dashes (**"— moods from — countries"**); page states a **goal of 10,000 participants**, not reached |
| moodymap.com | 9 moods, daily recap page, moderated message wall; active, copyright 2026, no counts on the about page |
| globalemotionsindex.com | **"Your domain is expired"** |
| feelhood.app | 12 feelings, "nothing appears until five people share it"; **waitlist only, not open** |
| globalfeels.com | 6 moods (Turkish UI), **private beta behind an access code** |
| theworldmood.com | reachable; policy page returned only a title |

Sources: [Mood2Know](https://www.mood2know.com/), [moodmap.world](https://www.moodmap.world/),
[MoodyMap](https://www.moodymap.com/about-moody-map/), [Feelhood](https://www.feelhood.app/),
[GlobalFeels](https://globalfeels.com/), [Global Emotions Index](https://globalemotionsindex.com/),
[The World Mood](https://theworldmood.com/privacy-policy).

**Analysis.** The idea is cheap to build (a weekend for a map and a button), so it gets built, and then
it meets the same wall: a collective display is worthless below critical mass, and nothing on these
sites gives a visitor a reason to be the first. Several have already noticed the private half is where
the value is (Feelhood's "five people" floor, MoodyMap's daily recap, moodmap.world's pivot to teams).
None of them has a product-level answer; they are relying on being found. **Our globe, animation and
engineering do not change this.** They change how good the product is once people are there; they do
not get people there, and they do not keep them. That is the whole lesson of this document.

---

## 1. Market landscape

Four groups, by what they do with a feeling:

1. **Collective-sentiment displays** (our group): We Feel Fine (2005–15), Facebook Gross National
   Happiness (2009), Pulse of the Nation (2010), Hedonometer (2013–), the seven clones above.
2. **Private mood trackers**: Moodscope (UK, 2007/09–), Daylio (2015–), How We Feel (2022–), Apple
   Health "State of Mind" (iOS 17, 2023). They own "how do *I* feel over time".
3. **One-action / anonymous / novelty social apps**: Yo (2014), Emojli (2014–15), Secret (2014–15),
   Yik Yak (2013–17, relaunched 2021), Peach (2016), Clubhouse (2020–), BeReal (2020–), Draw
   Something (2012). They show how a single simple action rises and decays.
4. **Time-boxed collective events**: Reddit's The Button (2015) and r/place (2017, 2022, 2023). They show
   that scarcity and an end date can do what a permanent product cannot.
5. **Adjacent failures that set the regulatory and privacy floor**: Woebot (shut 2025), BetterHelp (FTC
   2023), Flo Health (FTC 2021), Koko (2023 consent controversy).

Long-running comparables that survived: earth.nullschool.net (2013–), Daylio, Hedonometer, Moodscope.

---

## 2. Case studies: failed, struggling, or faded

### 2.1 We Feel Fine (2005–2015)
- **Documented:** scraped blog sentences starting "I feel" every ten minutes, 14M+ expressions by 2009,
  published as a book, in MoMA's collection; MoMA lists it as **active until 2015**; a later post says the
  site needs Java to run. ([Wikipedia](https://en.wikipedia.org/wiki/We_Feel_Fine),
  [MoMA](https://www.moma.org/collection/works/196071), [Kamvar paper](http://www.wefeelfine.org/wefeelfine.pdf),
  [Medium: "Are we still feeling fine?"](https://medium.com/paper-posts/are-we-still-feeling-fine-21d3274cb7e6))
- **Analysis:** it never needed users to participate (it scraped), so it never faced cold start; it died
  with its runtime (Java applets) and its data source (blogs). It was an artwork, not a product. Lesson:
  a sentiment display tied to someone else's platform or to a browser technology has a shelf life set by
  them. Our dependency is Cloudflare's free tier and Canvas 2D; both are safer than Java and blog
  scraping, neither is permanent.

### 2.2 Facebook Gross National Happiness (2009)
- **Documented:** a daily index from positive/negative words in US status updates (CHI 2010, Adam
  Kramer). A later validation study (Wang & Kosinski) concluded it is **"a valid measure for neither mood
  nor well-being."** ([Kramer 2010](https://pdodds.w3.uvm.edu/files/papers/others/2010/kramer2010a.pdf),
  [validation](https://www.semanticscholar.org/paper/Can-Well-Being-be-Measured-Using-Facebook-Status-of-Wang-Kosinski/58bac9ec9e80dda70cf0636451ef87ba03b9f6f8))
  The index itself is no longer published; I did not find a dated shutdown notice.
- **Analysis:** the risk for us is not that our number is wrong, it is that we *claim* more than a count
  of taps. "The world feels calm" is a sentence about 6,000 self-selected people. The README already
  says "pure pool, stated openly"; the UI does not yet state it anywhere. A journalist with the
  Kosinski paper in hand can make the headline look foolish in one paragraph.

### 2.3 Pulse of the Nation (2010)
- **Documented:** 300M tweets 2006–09 scored with ANEW; maps drawn as **cartograms because sparse states
  produced noisy, misleading moods**. One-off research. ([mislove.org](https://mislove.org/twittermood/),
  [ACM](https://cacmb4.acm.org/news/96451-twitter-mood-maps-reveal-emotional-states-of-america))
- **Analysis:** the sparse-region problem is exactly what our shrinkage and privacy floor address. They
  solved it visually (area ∝ sample) and we solve it statistically. Worth stealing their honesty cue:
  make low-sample regions *look* low-sample, which README §8.2.3 ("quiet regions are faint") already
  intends and the audit found the particles do not communicate.

### 2.4 Hedonometer (2013–)
- **Documented:** UVM/MITRE, daily happiness from a Twitter sample; the site still says "Time series of
  Happiness: Twitter" and "runs on Storywrangler". Twitter ended free and academic API access in 2023;
  I could **not** confirm Hedonometer's current data freshness from the fetched page (no latest-data
  date was readable). ([hedonometer.org/about](https://hedonometer.org/about.html),
  [SiliconANGLE on the API](https://siliconangle.com/2023/02/02/twitter-closing-free-access-api-starting-february-9/),
  [Blakey 2024 on research access](https://journals.sagepub.com/doi/10.1177/15365042241252125))
- **Analysis:** institutional funding kept it alive for a decade, something we do not have. Its exposure
  to one platform's API policy is the clearest modern example of platform dependency killing a
  sentiment product's data. Ours is first-party data, which is the right choice; the dependency moves to
  the hosting vendor.

### 2.5 Yo (2014–2016, on autopilot since)
- **Documented:** built in eight hours; ~$1–1.5M raised in 2014 at a $5–10M valuation; **company shut
  in 2016**, app "on autopilot", founder opened a Patreon in 2018 to keep it running.
  ([Wikipedia](https://en.wikipedia.org/wiki/Yo_(app)), [Phys.org 2014](https://phys.org/news/2014-07-single-message-app-yo-investors.html),
  [TechCrunch 2014](https://techcrunch.com/2014/06/18/yo-yo/))
- **Analysis:** the purest one-tap product ever shipped. It proved that a single action can spread in
  days and that a single action with no second act decays in months. We have the same action count.
  The difference must be what the tap *returns*.

### 2.6 Emojli (2014–2015)
- **Documented:** emoji-only social network by Matt Gray and Tom Scott, built after seeing Yo; **60,000
  downloads, "very few actually used them"**; closed 30 July 2015 because running it would cost the
  founders' own money "which wasn't worth it for a joke"; all data deleted under UK data law.
  ([emoj.li](https://emoj.li/), [Wikipedia](https://en.wikipedia.org/wiki/Emojli))
- **Analysis:** downloads ≠ use; hosting cost > perceived value = shutdown. Our near-zero cost
  architecture is a direct defence, but only up to the free tier. Above it, the same equation applies
  and we have no revenue line (see §6, business model).

### 2.7 Secret (2014–2015)
- **Documented:** ~$35M raised; shut April 2015; founder said usage did not match the vision (malicious
  rumours), rejected a pivot; critics cited moderation and misreading the user base.
  ([Wikipedia](https://en.wikipedia.org/wiki/Secret_(app)), [Engadget](https://www.engadget.com/2015-04-30-secret-is-out.html),
  [Fortune](https://fortune.com/2015/05/05/this-is-the-biggest-lesson-from-secrets-demise/))
- **Analysis:** anonymity plus free text equals moderation. Our "no free text, fixed enum" non-goal is
  the correct lesson already applied. Keep it absolute: no message wall (MoodyMap added one and now
  moderates it).

### 2.8 Yik Yak (2013–2017; 2021 relaunch; sold 2023)
- **Documented:** anonymous local posts; downloads fell ~76% vs 2015; school threats and lockdowns;
  users moved to Snapchat; shut May 2017, assets sold to Square for ~$1M; relaunched 2021, bought by
  Sidechat in 2023 per Wikipedia (sources conflict on 2023).
  ([Wikipedia](https://en.wikipedia.org/wiki/Yik_Yak), [TechCrunch 2021](https://techcrunch.com/2021/08/16/yik-yak-is-back/))
- **Analysis:** location-scoped anonymity attracted the worst behaviour precisely where the audience was
  densest. Our country scope and fixed moods remove the content vector; the remaining vector is
  *numbers* (brigading a country's mood), which is why Turnstile and the floor are launch gates.

### 2.9 Peach (2016)
- **Documented:** App Store rank fell from 85 to 129 within two days of the hype peak; critics cited no
  distinct purpose and a confusing design; last update October 2017; domain expired 2023.
  ([BGR](https://www.bgr.com/2016/01/11/peach-messaging-app-iphone-collapse/),
  [Contently](https://contently.com/2016/01/20/did-brands-kill-peach/))
- **Analysis:** a press spike is not a launch. The audience that arrives from tech press leaves in 48 h
  unless the product has a daily reason. Plan the soft launch for a community that has the reason
  (see §8), not for coverage.

### 2.10 Clubhouse (2020–)
- **Documented:** ~10M actives March 2021 to ~3.5M by September (secondary source); founders cited
  usage falling as lockdowns lifted and the difficulty of fitting long sessions into daily life; Twitter
  Spaces copied the format; >50% staff cut April 2023 with ~$300M raised.
  ([CNBC](https://www.cnbc.com/2023/04/27/clubhouse-layoffs-app-reached-4-billion-valuation-during-pandemic.html),
  [Fortune](https://fortune.com/2023/04/27/clubhouse-chat-app-layoffs-elon-musk-oprah/))
- **Analysis:** two lessons. A context-dependent habit (lockdown) does not survive the context. A format
  that a platform can clone in a quarter has no moat; our format is clonable in a weekend.

### 2.11 BeReal (2020–; sold 2024)
- **Documented:** the buzziest app of 2022; daily use **fell 61% between October 2022 and March 2023**
  (NYT/Sensor Tower); monthly users 15M → 6M in the same window (Platformer); downloads 31.5M (2023) →
  12.7M (2024); sold to Voodoo for €500M in June 2024; ads rolled out in 2025.
  ([Engadget](https://www.engadget.com/bereal-the-buzziest-app-of-2022-has-been-bought-by-a-mobile-game-publisher-175016152.html),
  [TechCrunch 2025](https://techcrunch.com/2025/04/10/bereal-which-says-it-has-40m-monthly-users-is-rolling-out-ads-in-the-u-s),
  [Tubefilter](https://www.tubefilter.com/2024/06/12/game-company-voodoo-acquires-bereal-500-million/amp/))
- **Analysis:** the closest modern analogue to a daily one-action ritual. It had an external trigger
  (the notification), a social graph, and still lost two thirds of its daily users in five months once
  the novelty of the ritual wore off. The notification became the product; when people muted it, the
  product was gone. For us: do not make the trigger the product; make the *answer* the product.

### 2.12 Draw Something (2012)
- **Documented:** ~15M DAU at the April 2012 peak, ~10M a month later (AppData), weeks after Zynga's
  ~$180–200M purchase of OMGPOP. ([MCV](https://mcvuk.com/business-news/mobile/draw-something-popularity-in-steep-decline/),
  [TechCrunch](https://techcrunch.com/2012/05/09/was-zyngas-deal-to-buy-omgpop-that-disastrous-heres-some-perspective/))
- **Analysis:** the canonical "spike then slide" curve. The curve is the default for anything simple and
  delightful. Retention mechanics do not prevent the slide; they decide the floor it lands on. Our job
  is the floor.

### 2.13 Woebot (2017–2025)
- **Documented:** consumer app retired 30 June 2025; founder attributed it largely to the cost and
  difficulty of FDA marketing authorisation. ([STAT](https://www.statnews.com/2025/07/02/woebot-mental-health-chatbot-shuts-down-founder-says-ai-moving-faster-than-regulators/))
- **Analysis:** the moment a feelings product implies help, it becomes a health product. Our copy must
  never cross that line ("you're not alone" is fine; "feeling better?" is not). No advice, no coping
  content, no "resources" panel that implies clinical intent.

### 2.14 Koko (2023 controversy), BetterHelp (FTC 2023), Flo Health (FTC 2021)
- **Documented:** Koko drafted peer-support replies with GPT-3 for ~4,000 people and faced a consent
  backlash ([Gizmodo](https://gizmodo.com/mental-health-therapy-app-ai-koko-chatgpt-rob-morris-1849965534)).
  BetterHelp: $7.8M FTC settlement for sharing health questionnaire answers with ad platforms despite
  privacy promises ([HealthITSecurity](https://healthitsecurity.com/news/ftc-proposes-7.8m-settlement-with-betterhelp-over-improper-health-data-sharing)).
  Flo: FTC order for passing period data to Facebook/Google analytics; no fine, mandated review and
  data destruction ([TechCrunch](https://techcrunch.com/2021/01/13/flo-gets-ftc-slap-for-sharing-user-data-when-it-promised-privacy/)).
- **Analysis:** the pattern is a privacy *promise* broken by an SDK. We have no third-party SDKs and no
  trackers; keep it that way, and write the promise so it can be audited ("no IPs stored" is already a
  testable claim). Any A/B test on users' feelings needs the Koko lesson: tell them.

---

## 3. Case studies: survivors

### 3.1 Daylio (2015–)
- **Documented:** no accounts, data stored locally with optional iCloud/Drive backup; free tier
  genuinely usable; premium subscription; ~62K App Store reviews at 4.8; Tracxn lists it as unfunded;
  third-party revenue estimates ~$50K–100K/month (inconsistent, unverified).
  ([Daylio FAQ](https://daylio.net/faq/author/samuel-bednar/page/2), [Wikipedia](https://en.wikipedia.org/wiki/Daylio),
  [Tracxn](https://tracxn.com/d/companies/daylio/__jFCGqAqpAcGB3BxowYI9kgZW8iUq4b81M5dJipsMnoM))
- **Transferable:** local-first, no account, privacy as a feature, a free tier that is the whole product.
  Our planned on-device journal is this pattern. **Not transferable:** their value is private history;
  ours must add the collective on top, not replace it.

### 3.2 How We Feel (2022–)
- **Documented:** free, nonprofit, Yale Center for Emotional Intelligence (Brackett) with Pinterest
  co-founder Silbermann leading product; ~30K ratings at 4.9. ([Yale](https://medicine.yale.edu/news-article/the-how-we-feel-app-helping-emotions-work-for-us-not-against-us/),
  [App Store](https://apps.apple.com/us/app/how-we-feel/id1562706384))
- **Transferable:** a precise vocabulary of feelings is itself the content; craft over features.
  **Not transferable:** donor funding and a world-class product team.

### 3.3 earth.nullschool.net (2013–)
- **Documented:** a solo developer's learning project; funded by prints, then a one-person company, then
  an optional app subscription in 2026; source on GitHub. ([Buttondown](https://news.nullschool.net/p/new-years-message-nullschool-app-is-here),
  [GitHub](https://github.com/cambecc/earth))
- **Transferable, and the closest to us:** a beautiful live globe, data that genuinely changes every few
  hours (weather), no accounts, shared by screenshot for a decade, monetised late and lightly. The
  difference: his data changes whether or not anyone visits. Ours changes only if people act. That is
  the entire gap between a visualisation and a participation product.

### 3.4 Moodscope (2007/09–)
- **Documented:** founder tracked his own mood; sharing scores with a friend ("buddy") was the
  retention mechanic; NHS endorsed; unfunded; KCL study found the buddy system drew mixed reactions.
  ([Time](https://time.com/archive/7135803/apps-for-mastering-your-mood/), [Rock Health Q&A](https://rockhealth.com/qa-mood-tracking-expert-jon-cousins/))
- **Transferable:** one trusted human seeing your score beats any streak. A privacy-safe version for us
  is a *share of today's line*, not an account link.

### 3.5 Reddit's The Button (2015) and r/place (2017/22/23)
- **Documented:** The Button: one click per account, 1,008,316 clicks, ran 1 April–5 June 2015, ended
  when no one pressed for 60 s ([Wikipedia](https://en.wikipedia.org/wiki/The_Button_(Reddit)),
  [Reddit blog](https://redditblog.blogspot.com/2015/06/the-button-has-ended.html)). r/place: 1M+
  participants in 2017, per-pixel cooldown of 5–20 minutes, 3.3M–10M+ in 2022 (sources conflict), the
  2023 run ended in a protest and the subreddit closed ([Daily Dot](https://dailydot.com/r-place-reddit-history),
  [Hypebeast](https://hypebeast.com/2022/4/reddit-r-place-april-fools-day-social-experiment-info)).
- **Transferable:** a cooldown (one action, then wait) and a **finite window** created urgency that a
  permanent product cannot. Our 6-hour expiry is a cooldown; nothing in the UI uses it. "Your check-in
  fades in 5 h 12 m" is a free trigger. A monthly or event-day "world check-in hour" is the r/place
  pattern without the infrastructure.

### 3.6 Wordle (2021–)
- No reliable source was retrieved this session (results were SEO filler); treat as general knowledge:
  one puzzle per day, a spoiler-free share grid, sold to the NYT in early 2022. **Analysis:** the share
  grid is the best-known example of a share artefact that is *personal* (your attempt) and
  *comparable* (everyone had the same puzzle). Our equivalent is "I'm one of N feeling X in {country}",
  not the generic world card.

---

## 4. Recurring failure patterns, ranked by danger to us

| # | Pattern | Seen in | Danger to us | Why |
|---|---|---|---|---|
| 1 | **Collective display with no critical mass** | the seven clones, Emojli (60K downloads, few users) | **Critical** | Our group's defining failure. Nothing built so far addresses it. |
| 2 | **One action, no second act** | Yo, Peach, Draw Something, BeReal | **Critical** | Confirmed in our audit: the check-in ends in a status line. |
| 3 | **Press spike mistaken for launch** | Peach, Clubhouse, BeReal | High | Our README calls viral spikes "the success case". They are the *cost* case; the success case is day 30. |
| 4 | **The trigger becomes the product** | BeReal | High | If we add push later, this is the trap. |
| 5 | **Anonymity attracts abuse** | Secret, Yik Yak | Medium (content), High (numbers) | Content vector closed by design; numeric brigading open until Turnstile. |
| 6 | **Claiming more than the data supports** | Facebook GNH, Pulse of the Nation | Medium | "The world feels" + 0 votes, or + 400 self-selected votes, invites debunking. |
| 7 | **Platform/tech dependency** | We Feel Fine, Hedonometer | Medium | Cloudflare free tier, Canvas 2D. Mitigated by pure core; not eliminated. |
| 8 | **Running cost exceeds the joke** | Emojli, Yo | Medium | Fine within free tier; undefined above it. |
| 9 | **Solo maintainer fade-out** | Peach (last update 2017), Yo (autopilot) | Medium | One developer, 45 commits in 6 days: sustainable sprint, unsustainable pace. |
| 10 | **Privacy promise broken by tooling** | BetterHelp, Flo | Low today | No SDKs. Stays low only if that is a rule, not a current state. |
| 11 | **Drifting into health territory** | Woebot | Low | Copy discipline. |
| 12 | **Format clonable by a platform** | Clubhouse → Spaces | Low–Medium | Apple's State of Mind could add "how others feel" any year; our defence is being the live public artefact, which Apple will not ship. |

---

## 5. User complaints and behavioural insights (what the evidence supports)

- The clones' own pages reveal the complaint before any user makes it: dashes, "Waiting for moods...",
  "goal: 10,000 participants". The first-visit experience of a collective product is *emptiness*.
- Peach's decline was blamed on "no central feed" and "nothing new": a first-time user needs to know
  in seconds what to do and why to return ([BGR](https://www.bgr.com/2016/01/11/peach-messaging-app-iphone-collapse/)).
- Clubhouse's founders: people could not "fit long conversations into their daily lives". Ten seconds
  is the right length; we have it.
- Moodscope's KCL study: users disliked the specific mood adjectives and layout even while finding it
  easy. Vocabulary is content; our six words will be argued with ("tired" and "anxious" are absent and
  are probably the two most common real answers; MoodyMap and moodmap.world both ship "tired",
  "anxious"/"worried", "bored").
- Yik Yak and Secret: anonymous + local + text = harm. We removed text; keep location at country.
- Emojli: a shutdown done well deletes everything and tells users. Our retention (6 h + purge) makes
  that nearly automatic; write it down as policy.
- A targeted search for "streak guilt" complaints in mood trackers returned only marketing copy; no
  first-hand evidence retrieved. Treat "avoid guilt streaks" as a design principle, not a finding.

---

## 6. Our vulnerability assessment

Inspected against the codebase and docs (see the audit for file-level evidence).

| Potential failure | Evidence from our project | Risk | Consequence | Prevention |
|---|---|---|---|---|
| **Cold start: an empty globe** | `publishMinN = 5`; world headline shows `h` at `n=0` (defect); no launch plan beyond "small group" in Phase 9 | **Critical** | Day-one visitors see "quiet" everywhere (or a fabricated "happy") and never return; the seven clones' fate | Fix the quiet state (bridge P0). Pick one launch community sized to light up 10+ countries in an hour. Make the **world count** the hero until regions pass the floor. Consider a time-boxed opening ("the first 24 hours") in the r/place pattern. |
| **No second act** | Chip "You feel X · change"; no result, no comparison, no share (audit R1) | **Critical** | Yo/BeReal decay | Result line and journal (bridge PR B); share card (Phase 7) that shares *your* line. |
| **Novelty curve mistaken for traction** | README: "viral spikes are the success case" | High | Over-investing in spike capacity (already measured) while D7 return is unmeasured | Define success as **D7 return rate and repeat check-ins per device**, measured from the first week (§8). |
| **Numeric brigading** | Device key client-minted; 10/min/IP; Turnstile "on spikes" | High (at launch) | "Country X's mood hijacked" becomes the launch story | Turnstile unconditional on first check-in per device (PLAN Phase 8, now a gate). Cap per-country swing per snapshot in the aggregator (analysis: a cheap rate limiter on *change*, not volume). |
| **Overclaiming** | "The world feels calm" with no sample context; no methodology link | Medium | A debunk piece; loss of trust with the exact audience that would share it | Show `n` next to every headline (already in the count line); a one-screen "how this works" page (Phase 8 privacy page can carry it). |
| **Vocabulary mismatch** | Six moods fixed at ADR 0001; no "tired/anxious" | Medium | People do not find their feeling; they pick nothing or pick wrong | Validate during MVP: log the distribution; if two moods take >60% or "none fits" feedback appears, revisit before the enum is expensive to change (it is a migration; cheaper now than after launch). |
| **Solo maintainer fade** | One developer; all commits by one account; no runbook | Medium | Peach/Yo endgame | A `docs/RUNBOOK.md` (deploy, rotate secrets, purge, roll back) before launch; a defined "autopilot mode" that is safe (static snapshot keeps serving). |
| **Cost above the free tier with no revenue** | README budget stops at "paid plan is the escape hatch"; no model | Medium | Emojli's equation on a good day | Decide now: hobby (cap and degrade), donations (nullschool pattern), or a later optional paid journal/insights tier (Daylio pattern). Degrade-not-die is already designed; the decision is who pays past the cap. |
| **Platform dependency** | Cloudflare everything | Medium | Free-tier terms change | Pure `core`/`motion` (done); keep SQL and snapshot format vendor-neutral; export a daily snapshot archive to a second bucket. |
| **Privacy incident by differencing** | ADR 0003 residual risk accepted | Low–Medium | A blog post showing one person's mood recovered from two snapshots in a quiet country | State it plainly on the privacy page (planned). Consider noise (ADR option B) only if traffic stays low for long. |
| **Health-territory drift** | Copy today is clean | Low | Woebot-class regulatory exposure | A copy rule in the i18n doc: no advice, no coping, no "better". |
| **Theme invisible** | World mood rarely changes (audit T1) | Medium | Signature feature unseen | Decided: theme follows the viewed region. |
| **Tone incident** | "Ruined Earth" on a bad day | Medium | Reputational | Decided: renamed. |

**Things to stop doing now:** treating spike capacity as the success metric; adding visual polish before
the quiet state and the result line exist; assuming the globe is the moat.
**Features we may be building unnecessarily:** nothing clearly wasted; the six-theme system is at risk
of being unseen, now addressed by B1. Sound (open question) should stay out.
**Unvalidated assumptions:** that anyone checks in twice; that anyone shares; that six moods fit; that
"you're not alone" is the feeling people want, versus "I want to see how my country feels" (the clones'
daily recaps suggest the latter is also real).

---

## 7. Pre-mortem: twelve ways this is gone within 24 months

| # | What went wrong | Why | Warning sign ignored | Earlier detection | Prevent now |
|---|---|---|---|---|---|
| 1 | **Nobody was first.** Launched to the public; globe stayed quiet; visitors left in 20 s | Collective value needs mass; we relied on being found | Clones with dashes on their home pages | Count countries over the floor in the first hour of the soft launch | Launch to one community that can fill 10 countries; world count as hero; opening-window event |
| 2 | **One great week.** Tech press, 200k visits, 3% back on day 7 | One action, no second act | Peach, BeReal, Draw Something curves | D1/D7 return and check-ins-per-device from day one | Result line, journal, share-your-line before any press |
| 3 | **A country got hijacked** on day two and the screenshot was the story | Client-minted device keys, 14k/day/IP | Audit E7 | Simulator already shows it; add a per-country swing alarm | Turnstile on first check-in; change-rate cap per country per snapshot |
| 4 | **The debunk.** "World mood app says the world is calm based on 412 people" | Overclaiming headline, no methodology | GNH validation study | Media mentions with "based on" | `n` beside every headline; methodology page; never show a mood below the floor |
| 5 | **Tone incident.** A disaster, the world turned angry, "Ruined Earth" trended | Parody names | Audit U7 | None needed; it is a design choice | Renamed (done); a quiet review of other copy on a bad-day lens |
| 6 | **The free tier changed.** Rate-limit binding withdrawn from Free, or D1 limits cut | Single vendor | Hedonometer's API loss | Vendor changelog watch; usage alerts at 70% | D1 counter fallback designed (done); keep core vendor-free; archive snapshots |
| 7 | **The good day cost money and nobody paid.** 60k check-ins, paid plan, no income, maintainer turned it off | No model past the cap | Emojli, Yo | Budget alerts | Decide hobby/donation/tier now; degrade mode (queue + stale snapshot) is designed; define the "turn down" state as a feature, not a failure |
| 8 | **Maintainer fade.** Six-month sprint, then silence; a browser change broke the globe; no one noticed for weeks | Solo; no runbook; no health check | Peach's 2017 last update | A dead-man alert on snapshot age | Runbook; uptime check on `snapshot.json` age; autopilot-safe design |
| 9 | **Privacy story.** A blog post recovered one person's mood in Iceland from two snapshots | Accepted residual risk, not disclosed loudly enough | ADR 0003 | Monitor snapshot-to-snapshot deltas in sub-floor regions | Privacy page states it; raise the floor for tiny populations or add noise if traffic stays low |
| 10 | **Vocabulary rejection.** "There's no 'tired'", people stop | Six moods fixed early | Moodscope's adjective complaints; clones ship tired/anxious | Mood distribution skew; feedback | Validate in MVP; budget one migration before launch |
| 11 | **A platform shipped it.** Apple added "how others feel" to State of Mind, or a social app added a mood map | Clonable format | Clubhouse → Spaces | Watch WWDC/feature news | Be the public live artefact and the share card; platforms will not ship a world globe people link to |
| 12 | **The trigger became the product.** Push added in year two; muted; usage went with it | BeReal | BeReal | Push opt-out rate | Prefer the fading-vote timer and the daily artefact over push; if push, weekly at most and only with news |

---

## 8. Prevention and validation strategy

### Must prevent before launch (measurable)
- Quiet state exists and is tested at `n = 0` and `n = 4` (bridge P0).
- Result line shows a comparison after every check-in; e2e asserts numbers match the card.
- Turnstile on the first check-in per device; simulator shows a 1k-device burst from 3 IPs is rejected.
- Error and loading states exist; a forced import failure shows a message (audit E4).
- Keyboard/screen-reader list view exists (Phase 7).
- Privacy page states: what is stored, for how long, the differencing risk, no SDKs, no IPs.
- Runbook and a dead-man check on snapshot age (alert if older than 15 min).
- Decision recorded on the cost model past the free tier.

### Must validate during the MVP (soft launch to one community)
| Assumption | Indicator | Threshold to proceed | Experiment without new features |
|---|---|---|---|
| People check in at all | check-ins ÷ unique visitors | ≥ 30% on first visit | Watch the first 48 h of the soft launch |
| People come back | D1 and D7 return (device key seen again) | D1 ≥ 25%, D7 ≥ 10% | Same cohort; no prompts, no push |
| The ritual repeats | check-ins per returning device per week | ≥ 3 | Same |
| The result line is the payoff | time on page after check-in; taps on "change" vs leaving | median ≥ 8 s after landing | Flip the line on/off by URL param for two cohorts (tell them in the privacy page: "we test copy") |
| Sharing intent exists | **fake-door share button**: taps on a "Share this" that shows "coming soon" | ≥ 5% of check-ins | Costs a button; build the card only if the threshold is met |
| Six moods fit | mood distribution; a 7th "none of these" option during MVP only | no mood > 50%; "none" < 10% | One extra button, removed after |
| The country guess is good enough | server logs: `counted: "world"` share on first check-in | < 15% | Already in the response; count it |
| Regions light up | hours until 10 countries pass the floor | < 24 h | Launch community size test |

### Must monitor after launch
- D7/D30 return, repeat check-ins per device, share taps per check-in, `counted: "world"` ratio.
- Countries over the floor (daily), snapshot age, aggregator rows read vs cap, D1 writes vs cap.
- 429/503 rates; Turnstile pass rate; per-country swing alarms.
- Cost: Cloudflare usage at 70% alerts (planned); time spent per week by the maintainer.
- Satisfaction: the only free-text channel is the GitHub issue link; read it weekly.

---

## 9. A failure-resistant strategy

**Build:** the quiet state, the result line, the journal, the share-your-line card, the list view, the
daily artefact. All already in the bridge and Phases 6–7. Add one new thing from this research: **make
the 6-hour expiry visible** ("fades in 4 h 12 m") as the native, honest trigger.

**Simplify:** the header (label dropped); the launch metric (D7, not peak RPS); copy that never implies
help.

**Postpone:** push notifications, sound, any history beyond the device, Stage 2 counters (until the
trigger in README §7 fires), the share *video*.

**Avoid completely:** free text and message walls; country leaderboards; streaks with loss; third-party
SDKs; health-adjacent copy; a public API for the snapshot before the privacy floor is proven in the
wild (the clones publish open datasets; that is a differencing gift).

**Validate before investing further:** the MVP table above, before Phase 7 polish and before any press.

**Pursue as advantages:** craft (the globe really is better than every clone), honesty (floor, `n`,
methodology), privacy as a visible feature (no accounts, local journal, 6-hour retention), and
**distribution through artefacts** (the personal share line, the daily post), which the clones lack.

**What would make it hard to replace:** the journal (switching cost held by the user, not us), the
habit of a daily glance at a live artefact people link to (nullschool's moat), and being the place
where "the world feels" numbers come from, with the methodology to back them.

---

## 10. Prioritised action plan

1. **Now (docs only):** cost model decided 2026-11-10: a thing that exists, donations if popular, no
   ads or tiers (`docs/decisions/0006-what-this-is-and-who-pays.md`). Still to record: the launch
   community (before Phase 9). Add the "no health copy" rule to the i18n doc.
2. **Bridge PR A/B (as planned)** plus two additions from this research: the fading-vote timer in the
   chip state; the MVP-only "none of these" seventh option behind a flag.
3. **Phase 6:** log the `counted: "world"` ratio and mood distribution as counters (no PII); add a
   per-country swing alarm in the aggregator.
4. **Phase 7:** fake-door share first; build the card only if ≥ 5% tap it. List view as a gate.
5. **Phase 8:** Turnstile on first check-in; privacy page with methodology; runbook; dead-man check.
6. **Phase 9:** soft launch to one named community with the MVP table as the go/no-go for any press.

### Is the direction fundamentally flawed?
As "a world mood map app that people will discover": **yes, that version has failed at least seven
times and is failing right now.** As "a beautiful, honest, live public artefact with a private journal,
seeded through a community and spread by personal share lines": no evidence says it must fail, and
nullschool, Daylio and Wordle each prove one of its three legs. The bridge plan builds the legs. The
soft-launch thresholds decide whether to keep going. Do not skip them for polish.

---

### What this research did and did not do
Did: ~40 web searches and 8 page fetches on 2026-11-10; every case above cites at least one retrieved
source except Wordle (marked). Did not: read app-store review corpora at scale (one targeted search
returned only marketing); interview anyone; verify Hedonometer's current data freshness or Mappiness's
app status (unknown); obtain primary financials for Daylio (estimates only). Seven searches were
rate-limited on the first pass and re-run; all re-runs returned sources.
