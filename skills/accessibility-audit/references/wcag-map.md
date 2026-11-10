# WCAG 2.2 AA quick map

Common findings, the criterion to cite in the report, and the usual fix. Level A and AA only.

| Finding | Criterion | Level | Usual fix |
|---|---|---|---|
| Image without alt, or alt that does not describe | 1.1.1 Non-text Content | A | Meaningful `alt`; `alt=""` for decorative; `aria-hidden="true"` on decorative SVG |
| Video without captions | 1.2.2 Captions (Prerecorded) | A | Add a captions track |
| Input without label, heading levels skipped, table without headers | 1.3.1 Info and Relationships | A | `<label for>`, real heading order, `<th scope>` |
| Visual order differs from DOM order | 1.3.2 Meaningful Sequence | A | Reorder DOM; avoid `order` and absolute positioning for content order |
| Locked orientation | 1.3.4 Orientation | AA | Remove orientation lock |
| Missing `autocomplete` on personal data fields | 1.3.5 Identify Input Purpose | AA | `autocomplete="email"`, `"name"`, `"tel"`, `"street-address"` |
| Error or state shown by colour only | 1.4.1 Use of Color | A | Add text or an icon with a text alternative |
| Text contrast below 4.5:1 (3:1 for large text) | 1.4.3 Contrast (Minimum) | AA | Darken text or lighten background token |
| Page breaks at 200 percent zoom | 1.4.4 Resize Text | AA | Relative units, no fixed heights on text containers |
| Content needs horizontal scroll at 320 px wide | 1.4.10 Reflow | AA | Fluid layout (see `responsive-audit`) |
| Border, icon or focus ring contrast below 3:1 | 1.4.11 Non-text Contrast | AA | Stronger border or focus colour |
| Text clipped when line height or spacing is increased | 1.4.12 Text Spacing | AA | No fixed heights; allow wrapping |
| Tooltip on hover cannot be dismissed or hovered | 1.4.13 Content on Hover or Focus | AA | Dismiss on Escape; keep open while hovered |
| Control not usable by keyboard | 2.1.1 Keyboard | A | Native `button`/`a`; key handlers for custom widgets |
| Focus cannot leave a widget | 2.1.2 No Keyboard Trap | A | Escape or Tab moves out; dialogs return focus on close |
| Auto-moving or auto-updating content without pause | 2.2.2 Pause, Stop, Hide | A | Pause control; respect `prefers-reduced-motion` |
| No skip link before long navigation | 2.4.1 Bypass Blocks | A | "Skip to content" link targeting `main` |
| Missing or duplicate page title | 2.4.2 Page Titled | A | Unique `<title>` per page |
| Tab order jumps around | 2.4.3 Focus Order | A | Fix DOM order; remove positive `tabindex` |
| Link text "click here", "read more" | 2.4.4 Link Purpose (In Context) | A | Descriptive text or `aria-label` that starts with the visible text |
| Vague headings or labels | 2.4.6 Headings and Labels | AA | Descriptive headings and labels |
| No visible focus indicator | 2.4.7 Focus Visible | AA | `:focus-visible` outline with 3:1 contrast |
| Focused element hidden under sticky header or banner | 2.4.11 Focus Not Obscured (Minimum) | AA | `scroll-padding-top`; do not cover focus |
| Drag-only interaction (sliders, sortable lists) | 2.5.7 Dragging Movements | AA | Add buttons or inputs as an alternative |
| Target smaller than 24 by 24 px without spacing | 2.5.8 Target Size (Minimum) | AA | Padding or spacing to reach 24 px |
| Visible label not in the accessible name | 2.5.3 Label in Name | A | Accessible name must contain the visible text |
| Missing `lang` on `html` | 3.1.1 Language of Page | A | `<html lang="en">` |
| Focus or input change triggers navigation or submit | 3.2.1 On Focus, 3.2.2 On Input | A | Require an explicit action |
| Help link in a different place on each page | 3.2.6 Consistent Help | A | Same location across pages |
| Error not described in text | 3.3.1 Error Identification | A | Text message linked with `aria-describedby` |
| Field without label or instructions | 3.3.2 Labels or Instructions | A | Visible label, format hints |
| User must re-enter the same information | 3.3.7 Redundant Entry | A | Prefill or offer selection |
| Login needs a puzzle or blocks paste and password managers | 3.3.8 Accessible Authentication (Minimum) | AA | Allow paste and autofill; offer alternatives |
| Custom control without role, name or state | 4.1.2 Name, Role, Value | A | Native element, or correct role plus `aria-expanded`, `aria-checked`, `aria-selected` |
| Status message not announced (toast, "saved") | 4.1.3 Status Messages | AA | `role="status"` or `aria-live="polite"` region |
