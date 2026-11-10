import type { Alongside } from "../engine/regions";
import { type Fmt, fill, type Messages } from "../i18n/messages";

/**
 * The words for the line under "You feel …" (bridge R1). Zero others is never printed as a
 * number: you are "the first". An early world gets the exact total.
 */
export function alongsideText(r: Alongside, c: Messages["checkin"], fmt: Fmt): string {
  if (r.scope === "early") return fill(c.early(r.total, fmt), { count: fmt.n(r.total) });
  if (r.others === 0) return r.scope === "country" ? c.firstCountry : c.firstWorld;
  const template = (r.scope === "country" ? c.likeCountry : c.likeWorld)(r.others, fmt);
  return fill(template, { count: fmt.n(r.others) });
}
