<script lang="ts">
import { DEFAULT_CONFIG, MOODS, type MoodId } from "@world-emotion/shared";
import { tick } from "svelte";
import { MOOD_COLORS } from "../engine/palette";
import { i18n } from "../i18n/i18n.svelte";
import { makeCountryName } from "../i18n/locale";
import { around, fill } from "../i18n/messages";
import { alongsideText } from "./alongside-text";
import Face from "./Face.svelte";
import { type UiActions, view } from "./view.svelte";

/**
 * The check-in bar (README §8.2.5), world view only. Six faces, each named in text, and a pin chip
 * for your country: "move" turns the globe itself into the picker (tap where you are), with a
 * search for countries too small to tap (README §8.6) and for keyboards. Faces, chip and pick
 * mode share one grid cell, so the bar never changes height and never re-fits the globe.
 */
let { actions }: { actions: UiActions } = $props();
let changingMood = $state(false);
let query = $state("");
let search: HTMLInputElement | null = $state(null);

const mode = $derived(
  view.checkin.picking ? "pick" : view.checkin.mine === null || changingMood ? "faces" : "chip",
);
const countryName = $derived(
  view.checkin.country === null ? null : i18n.country(view.checkin.country),
);
/** Your country is below the privacy floor: the card would show its continent (bridge SC). */
const countryQuiet = $derived(
  view.checkin.country !== null && !view.checkin.published.includes(view.checkin.country),
);
const smallCountry = $derived(
  fill(i18n.t.checkin.smallCountry, { n: i18n.fmt.n(DEFAULT_CONFIG.publishMinN) }),
);

/** Accent- and case-insensitive: "cote" finds Côte d'Ivoire. */
const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
const englishName = makeCountryName("en");
/** Names in the active language, sorted in it; English kept for search (people type either). */
const named = $derived(
  view.checkin.countries
    .map((code) => ({
      code,
      name: i18n.country(code),
      key: fold(i18n.country(code)),
      en: fold(englishName(code)),
    }))
    .sort((a, b) => a.name.localeCompare(b.name, i18n.t.meta.tag)),
);
const matches = $derived.by(() => {
  const q = fold(query.trim());
  if (q === "") return [];
  const starts = named.filter((c) => c.key.startsWith(q) || c.en.startsWith(q));
  const within = named.filter(
    (c) => !(c.key.startsWith(q) || c.en.startsWith(q)) && (c.key.includes(q) || c.en.includes(q)),
  );
  return [...starts, ...within].slice(0, 3);
});
/** First run with a guessed country: lead with it. Not while picking, and not with no guess. */
const placeFirst = $derived(
  view.checkin.firstRun && view.checkin.country !== null && mode !== "pick",
);
const youFeel = $derived(around(i18n.t.checkin.youFeel, "mood"));
/** The line under it (bridge R1): real numbers from the snapshot, updated with every one. */
const like = $derived(
  view.checkin.result === null
    ? null
    : alongsideText(view.checkin.result, i18n.t.checkin, i18n.fmt),
);
/** The journal strip toggles a line saying where it is kept, with the way to clear it. */
let journalOpen = $state(false);
const weekLabel = $derived(
  view.checkin.week === null
    ? ""
    : `${i18n.t.journal.label}: ${view.checkin.week
        .map((m) => (m === null ? i18n.t.journal.none : i18n.t.moods.label[m]))
        .join(", ")}`,
);
$effect(() => {
  if (view.checkin.week === null) journalOpen = false;
});
const countryFeels = $derived(around(i18n.t.checkin.countryFeels, "mood"));

function pick(m: MoodId, el: HTMLElement): void {
  const r = el.getBoundingClientRect();
  changingMood = false;
  actions.checkIn(m, { x: r.x + r.width / 2, y: r.y + r.height / 2 });
}

/** From the keyboard (click detail 0), go straight to the search; a tap leaves the globe free. */
async function startPick(byKeyboard: boolean): Promise<void> {
  query = "";
  actions.startPick();
  if (byKeyboard) {
    await tick();
    search?.focus();
  }
}

function choose(code: string): void {
  query = "";
  actions.setCountry(code);
}
</script>

{#snippet place()}
  <div class="from" class:first={placeFirst}>
    {#if placeFirst}<span class="label">{i18n.t.checkin.yourCountry}</span>{/if}
    <span class="place">
      <svg class="pin" width="12" height="16" viewBox="0 0 12 16" aria-hidden="true">
        <path d="M6 15.5C6 15.5 1 9.6 1 6a5 5 0 0 1 10 0c0 3.6-5 9.5-5 9.5z" />
        <circle cx="6" cy="6" r="2" />
      </svg>
      <span class="where">{countryName ?? i18n.t.checkin.whereAreYou}</span>
    </span>
    {#if mode !== "pick"}
      <span class="dot" aria-hidden="true">·</span>
      <button type="button" class="link" id="checkin-move" onclick={(e) => startPick(e.detail === 0)}>
        {countryName === null ? i18n.t.checkin.showMe : placeFirst ? i18n.t.checkin.notYou : i18n.t.checkin.move}
      </button>
    {/if}
  </div>
{/snippet}

<section id="checkin" hidden={!view.checkin.visible} aria-label={i18n.t.checkin.label} data-country={view.checkin.country ?? ""} data-mode={mode} data-first={placeFirst}>
  <!-- First run on this device (bridge J2): the place comes first, so a wrong guess is seen before the tap. -->
  {#if placeFirst}{@render place()}{/if}
  <div class="stack">
    <div class="layer faces-layer" class:off={mode !== "faces"} inert={mode !== "faces"}>
      <div class="prompt" id="checkin-prompt">{i18n.t.checkin.ask}</div>
      <div class="faces" role="group" aria-labelledby="checkin-prompt">
        {#each MOODS as name, m (name)}
          <button
            type="button"
            class="face"
            data-mood={name}
            disabled={view.checkin.country === null}
            onclick={(e) => pick(m as MoodId, e.currentTarget)}
          >
            <Face mood={m} size={36} />
            <span>{i18n.t.moods.label[m]}</span>
          </button>
        {/each}
      </div>
    </div>

    <div class="layer chip" class:off={mode !== "chip"} inert={mode !== "chip"}>
      {#if view.checkin.mine !== null}
        <!-- Your face beside the words (bridge M2); decorative, the mood is named in text. -->
        <span class="chip-face" data-mood={MOODS[view.checkin.mine]}><Face mood={view.checkin.mine} size={18} /></span
        >{youFeel[0]}<strong style:color={MOOD_COLORS[view.checkin.mine]}>{i18n.t.moods.feels[view.checkin.mine]}</strong>{youFeel[1]}
        ·
        <button type="button" class="link" onclick={() => (changingMood = true)}>{i18n.t.checkin.change}</button>
        {#if journalOpen && view.checkin.week !== null}
          <div class="alongside" id="journal-info">
            <span class="like">{i18n.t.journal.onDevice}</span><span class="sep" aria-hidden="true"> · </span><button
              type="button"
              class="link"
              id="journal-clear"
              onclick={() => actions.clearJournal()}>{i18n.t.journal.clear}</button
            >
          </div>
        {:else if like !== null && view.checkin.result !== null}
          {@const r = view.checkin.result}
          <div class="alongside" id="checkin-result" data-scope={r.scope} data-others={r.scope === "early" ? r.total : r.others}>
            <span class="like">{like}</span>{#if r.scope !== "early" && r.feels !== null}<span class="sep" aria-hidden="true"> · </span><span class="feels"
                >{countryFeels[0]}<strong style:color={MOOD_COLORS[r.feels]}>{i18n.t.moods.feels[r.feels]}</strong>{countryFeels[1]}</span
              >{/if}
          </div>
        {/if}
        {#if view.checkin.week !== null}
          <!-- Your last seven days, today last; kept on this device only (bridge R2). -->
          <button type="button" class="week" id="journal" aria-label={weekLabel} aria-expanded={journalOpen} onclick={() => (journalOpen = !journalOpen)}>
            {#each view.checkin.week as m, i (i)}
              <span class="day" class:today={i === view.checkin.week.length - 1} data-mood={m === null ? "" : MOODS[m]}>
                {#if m !== null}<Face mood={m} size={16} />{:else}<span class="empty"></span>{/if}
              </span>
            {/each}
          </button>
        {/if}
      {/if}
    </div>

    <div class="layer pick" class:off={mode !== "pick"} inert={mode !== "pick"}>
      <div class="prompt">
        <span class="tap-hint">{i18n.t.checkin.tapYourCountry}</span>
        · <button type="button" class="link" onclick={() => actions.cancelPick()}>{i18n.t.checkin.cancel}</button>
      </div>
      <label class="search">
        <span>{i18n.t.checkin.tooSmall}</span>
        <input
          bind:this={search}
          bind:value={query}
          type="search"
          placeholder={i18n.t.checkin.typeIt}
          autocomplete="off"
          aria-describedby="checkin-results"
        />
      </label>
      <div class="results" id="checkin-results" aria-live="polite">
        {#each matches as c (c.code)}
          <button type="button" class="result" data-code={c.code} onclick={() => choose(c.code)}>{c.name}</button>
        {:else}
          {#if query.trim() !== ""}<span class="none">{i18n.t.checkin.noMatch}</span>{/if}
        {/each}
      </div>
    </div>
  </div>

  {#if !placeFirst}{@render place()}{/if}
  {#if countryQuiet && view.status === "ready"}
    <div class="small-country">{smallCountry}</div>
  {/if}
</section>
