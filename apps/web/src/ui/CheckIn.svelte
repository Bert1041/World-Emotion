<script lang="ts">
import { MOODS, type MoodId } from "@world-emotion/shared";
import { tick } from "svelte";
import { MOOD_COLORS } from "../engine/palette";
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
  view.checkin.countries.find((c) => c.code === view.checkin.country)?.name ?? null,
);

/** Accent- and case-insensitive: "cote" finds Côte d'Ivoire. */
const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
const matches = $derived.by(() => {
  const q = fold(query.trim());
  if (q === "") return [];
  const starts = view.checkin.countries.filter((c) => fold(c.name).startsWith(q));
  const within = view.checkin.countries.filter(
    (c) => !fold(c.name).startsWith(q) && fold(c.name).includes(q),
  );
  return [...starts, ...within].slice(0, 3);
});

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

<section id="checkin" hidden={!view.checkin.visible} aria-label="Check in" data-country={view.checkin.country ?? ""} data-mode={mode}>
  <div class="stack">
    <div class="layer faces-layer" class:off={mode !== "faces"} inert={mode !== "faces"}>
      <div class="prompt" id="checkin-prompt">How do you feel right now?</div>
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
            <span>{name}</span>
          </button>
        {/each}
      </div>
    </div>

    <div class="layer chip" class:off={mode !== "chip"} inert={mode !== "chip"}>
      {#if view.checkin.mine !== null}
        You feel
        <strong style:color={MOOD_COLORS[view.checkin.mine]}>{MOODS[view.checkin.mine]}</strong>
        ·
        <button type="button" class="link" onclick={() => (changingMood = true)}>change</button>
      {/if}
    </div>

    <div class="layer pick" class:off={mode !== "pick"} inert={mode !== "pick"}>
      <div class="prompt">
        <span class="tap-hint">Tap your country on the globe</span>
        · <button type="button" class="link" onclick={() => actions.cancelPick()}>cancel</button>
      </div>
      <label class="search">
        <span>Too small to tap?</span>
        <input
          bind:this={search}
          bind:value={query}
          type="search"
          placeholder="Type it…"
          autocomplete="off"
          aria-describedby="checkin-results"
        />
      </label>
      <div class="results" id="checkin-results" aria-live="polite">
        {#each matches as c (c.code)}
          <button type="button" class="result" data-code={c.code} onclick={() => choose(c.code)}>{c.name}</button>
        {:else}
          {#if query.trim() !== ""}<span class="none">No match</span>{/if}
        {/each}
      </div>
    </div>
  </div>

  <div class="from">
    <span class="place">
      <svg class="pin" width="12" height="16" viewBox="0 0 12 16" aria-hidden="true">
        <path d="M6 15.5C6 15.5 1 9.6 1 6a5 5 0 0 1 10 0c0 3.6-5 9.5-5 9.5z" />
        <circle cx="6" cy="6" r="2" />
      </svg>
      <span class="where">{countryName ?? "Where are you?"}</span>
    </span>
    {#if mode !== "pick"}
      <span class="dot" aria-hidden="true">·</span>
      <button type="button" class="link" id="checkin-move" onclick={(e) => startPick(e.detail === 0)}>
        {countryName === null ? "show me" : "move"}
      </button>
    {/if}
  </div>
</section>
