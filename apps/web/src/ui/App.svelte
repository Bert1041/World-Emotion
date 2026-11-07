<script lang="ts">
import { MOODS, type MoodId } from "@world-emotion/shared";
import { MOOD_COLORS } from "../engine/palette";
import BarRow from "./BarRow.svelte";
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
</header>

<button id="back" type="button" hidden={!view.zoomed} onclick={() => actions.back()}>← World</button>

<section id="panel" hidden={view.panel === null} aria-live="polite">
  {#if view.panel}
    <div class="kicker">Right now</div>
    <h2 id="panel-title">{view.panel.title}</h2>
    <div id="panel-mood">
      {#if view.panel.mood}feels <span style:color={view.panel.mood.color}>{view.panel.mood.name}</span>{/if}
    </div>
    <div id="panel-sub">{view.panel.sub}</div>
    <ul id="bars">
      {#each view.panel.bars as bar (bar.name)}
        <BarRow {bar} />
      {/each}
    </ul>
  {/if}
</section>

<nav id="dev" aria-label="Preview a world mood (prototype only)" hidden={!view.devVisible}>
  {#each MOODS as name, m (name)}
    <button type="button" style:border-color={MOOD_COLORS[m]} onclick={() => actions.previewMood(m as MoodId)}>
      {name}
    </button>
  {/each}
  <button type="button" onclick={() => actions.toggleAuto()}>auto: {view.autoCycle ? "on" : "off"}</button>
</nav>
