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
const feeling = $derived(around(i18n.t.feelingNow(view.worldCount, i18n.fmt), "count"));
</script>

<header>
  <div class="kicker">{i18n.t.rightNow}</div>
  <!-- The live region is the sentence, so "The world feels calm" is announced whole. -->
  <h1 aria-live="polite">
    {feels[0]}
    {#key view.worldSwap}
      <span id="world-mood" class:swap={view.worldSwap > 0} data-mood={view.worldMood === null ? "" : MOODS[view.worldMood]}
        >{view.worldMood === null ? "" : i18n.t.moods.feels[view.worldMood]}</span
      >
    {/key}{feels[1]}
  </h1>
  <div id="theme-name">{view.themeId === null ? "" : i18n.t.themes[view.themeId]}</div>
  <div id="world-count">{feeling[0]}<Counter value={view.worldCount} />{feeling[1]}</div>
</header>

<LanguageMenu />

<button id="back" type="button" hidden={!view.zoomed} onclick={() => actions.back()}>{i18n.t.back}</button>

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
