<script lang="ts">
import { MOODS, type MoodId } from "@world-emotion/shared";
import { MOOD_COLORS } from "../engine/palette";
import { i18n } from "../i18n/i18n.svelte";
import { around } from "../i18n/messages";
import CheckIn from "./CheckIn.svelte";
import Counter from "./Counter.svelte";
import Flight from "./Flight.svelte";
import LanguageMenu from "./LanguageMenu.svelte";
import Panel from "./Panel.svelte";
import { type UiActions, view } from "./view.svelte";

let { actions }: { actions: UiActions } = $props();
// Sentences are split where the animated word or the ticking number goes: word order is the
// translation's, not the template's.
const feels = $derived(around(i18n.t.worldFeels, "mood"));
const feeling = $derived(
  around(
    view.worldQuiet
      ? i18n.t.quietCount(view.worldCount, i18n.fmt)
      : i18n.t.feelingNow(view.worldCount, i18n.fmt),
    "count",
  ),
);
</script>

<!-- Where the globe will be, while the map loads (bridge E4). Hidden once it has drawn. -->
<div id="loading-disc" aria-hidden="true" hidden={view.status !== "loading"}></div>

<header data-status={view.status}>
  <div class="kicker">{i18n.t.rightNow}</div>
  <!-- The live region is the sentence, so "The world feels calm" is announced whole. Below the
       privacy floor there is no mood word: the world is quiet (ADR 0003), never a fake mood.
       Before the map has loaded there is no sentence about the world at all. -->
  <h1 aria-live="polite" data-quiet={view.status === "ready" && view.worldQuiet}>
    {#if view.status === "loading"}
      {i18n.t.loading}
    {:else if view.status === "failed"}
      {i18n.t.failed}
    {:else if view.worldQuiet || view.worldMood === null}
      {i18n.t.worldQuiet}
    {:else}
      {feels[0]}
      {#key view.worldSwap}
        <span id="world-mood" class:swap={view.worldSwap > 0} data-mood={MOODS[view.worldMood]}
          >{i18n.t.moods.feels[view.worldMood]}</span
        >
      {/key}{feels[1]}
    {/if}
  </h1>
  <div id="world-count" hidden={view.status !== "ready"}>{feeling[0]}<Counter value={view.worldCount} />{feeling[1]}</div>
</header>

{#if view.status === "failed"}
  <!-- The header is pointer-events: none (it sits over the globe), so the control lives outside it. -->
  <div id="failed">
    <button id="retry" type="button" onclick={() => location.reload()}>{i18n.t.retry}</button>
  </div>
{/if}

<LanguageMenu />

<button id="back" type="button" hidden={!view.zoomed} onclick={() => actions.back()}>{i18n.t.back}</button>
{#if view.hint === "tapCountry"}
  <!-- Once per device, under the back button (bridge U6): countries are tappable, nothing said so. -->
  <div id="hint" role="status">{i18n.t.hints.tapCountry}</div>
{/if}

<Panel {actions} />

<CheckIn {actions} />

{#key view.flight?.id}
  {#if view.flight}<Flight flight={view.flight} {actions} />{/if}
{/key}

<nav id="dev" aria-label="Preview a world mood (prototype only)" hidden={!view.devVisible}>
  {#each MOODS as name, m (name)}
    <button type="button" style:border-color={MOOD_COLORS[m]} onclick={() => actions.previewMood(m as MoodId)}>
      {name}
    </button>
  {/each}
  <button type="button" onclick={() => actions.toggleAuto()}>auto: {view.autoCycle ? "on" : "off"}</button>
</nav>
