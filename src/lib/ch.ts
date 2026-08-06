// Width of one character, in px, in `el`'s font. Pane widths are stored in ch, so a
// pointer drag (which arrives in px) has to be converted through it. Measured with a
// throwaway probe rather than by dividing a pane's box by its ch width, because a pane
// squeezed by a narrow window would give the wrong answer.
export function chPx(el: HTMLElement): number {
  const probe = document.createElement("div");
  probe.style.cssText = "position:absolute;visibility:hidden;width:100ch";
  el.appendChild(probe);
  const px = probe.getBoundingClientRect().width / 100;
  probe.remove();
  return px;
}
