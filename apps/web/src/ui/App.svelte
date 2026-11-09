<script lang="ts">
import { MOODS, type MoodId } from "@world-emotion/shared";
import { MOOD_COLORS } from "../engine/palette";
import CheckIn from "./CheckIn.svelte";
import Counter from "./Counter.svelte";
import Flight from "./Flight.svelte";
import Panel from "./Panel.svelte";
import { type UiActions, view } from "./view.svelte";

let { actions }: { actions: UiActions } = $props();
</script>

<header>
  <div class="kicker">Right now</div>
  <!-- The live region is the sentence, so "The world feels calm" is announced whole. -->
  <h1 aria-live="polite">
    The world feels
    {#key view.worldSwap}
      <span id="world-mood" class:swap={view.worldSwap > 0}>{view.worldMood}</span>
    {/key}
  </h1>
  <div id="theme-name">{view.themeName}</div>
  <div id="world-count"><Counter value={view.worldCount} /> feeling something right now</div>
</header>

<button id="back" type="button" hidden={!view.zoomed} onclick={() => actions.back()}>← World</button>

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
