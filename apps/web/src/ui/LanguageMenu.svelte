<script lang="ts">
import { i18n } from "../i18n/i18n.svelte";
import { CATALOGUES, LOCALES, type Locale } from "../i18n/locale";

/**
 * The language switcher (decided 2026-11-09: top-right, small). Each language is named in itself.
 * The last item opens a prefilled GitHub issue to suggest a better translation (no backend).
 * A disclosure (button + list), not an ARIA menu. Escape or a click elsewhere closes it; Escape
 * returns focus to the button.
 */
let open = $state(false);
let button: HTMLButtonElement | null = $state(null);
let menu: HTMLElement | null = $state(null);

const short = (l: Locale) => CATALOGUES[l].meta.tag.slice(0, 2).toUpperCase();

function choose(l: Locale): void {
  i18n.choose(l);
  close();
}

function close(): void {
  open = false;
  button?.focus();
}

$effect(() => {
  if (!open) return;
  // First item gets focus, so the keyboard can move straight on.
  menu?.querySelector<HTMLElement>("[aria-current='true']")?.focus();
  const outside = (e: PointerEvent) => {
    if (!menu?.contains(e.target as Node) && !button?.contains(e.target as Node)) open = false;
  };
  const esc = (e: KeyboardEvent) => {
    if (e.key === "Escape") close();
  };
  document.addEventListener("pointerdown", outside);
  document.addEventListener("keydown", esc);
  return () => {
    document.removeEventListener("pointerdown", outside);
    document.removeEventListener("keydown", esc);
  };
});
</script>

<div id="lang">
  <button
    bind:this={button}
    type="button"
    class="current"
    aria-expanded={open}
    aria-controls="lang-menu"
    aria-label="{i18n.t.language.menu}: {i18n.t.meta.name}"
    onclick={() => (open = !open)}
  >
    {short(i18n.locale)} <span aria-hidden="true">▾</span>
  </button>
  {#if open}
    <div id="lang-menu" bind:this={menu} role="group" aria-label={i18n.t.language.menu}>
      {#each LOCALES as l (l)}
        <button
          type="button"
          aria-current={l === i18n.locale ? "true" : undefined}
          lang={CATALOGUES[l].meta.tag}
          data-locale={l}
          onclick={() => choose(l)}>{CATALOGUES[l].meta.name}</button
        >
      {/each}
      <a class="suggest" href={i18n.suggestUrl} target="_blank" rel="noopener">{i18n.t.language.suggest}</a>
    </div>
  {/if}
</div>
