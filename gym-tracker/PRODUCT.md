# Product

## Register

product

## Users

One person: the owner, training alone in a commercial gym. The phone is in one hand (sometimes sweaty), between sets, with 60 to 120 seconds of rest. Glances are short; typing is minimal. Lighting in the gym is mixed (bright overhead, dim corners), and the app is often opened on the home screen as an installed PWA.

The job: log weight × reps per set for the machine or exercise in front of them, recognise that machine instantly (photos), and see whether they are getting stronger over weeks.

## Product Purpose

A personal, offline-first training log. It records sets per exercise and day, shows progress per exercise (top weight, estimated 1RM, volume) and overall progress relative to each exercise's starting point. Data stays on the device (localStorage plus IndexedDB for machine photos), with JSON backup export/import.

Success: logging a set takes two taps and no thinking; finding today's exercise takes one glance; progress is legible without reading a manual.

## Brand Personality

Powerful, focused, honest. Like a well-built piece of gym equipment: robust, clear, big numbers, nothing that distracts from the set. Confident German copy, short and direct ("+ Satz", not "Neuen Satz hinzufügen?").

## Anti-references

- Overloaded: walls of numbers, many buttons competing, dashboards that need reading.
- Kitschy or playful: comic look, confetti, emoji as decoration, cartoon mascots.
- Cold or clinical: banking-app or hospital-app neutrality, grey-on-grey forms.
- Typical gym-brand cliché: black with neon, aggressive bodybuilder styling.

## Design Principles

1. **Glanceable under load.** The primary number on any screen is readable at arm's length in one second. Hierarchy by size and weight, not by decoration.
2. **Two taps to log.** The fastest path is always the default path: prefilled values, big targets, no confirmation for reversible actions.
3. **Recognition over recall.** Photos, categories and consistent order help the user find the right exercise without reading names.
4. **Progress tells the truth.** Show real numbers and honest trends; celebrate a personal best quietly, never with noise.
5. **Nothing extra.** Every element has to earn its place on a 375px screen.

## Accessibility & Inclusion

WCAG 2.2 AA contrast for all text including placeholders. Touch targets at least 44 × 44 px, primary actions larger. Works one-handed in the lower two thirds of the screen. Respects `prefers-reduced-motion`. Category colors are never the only signal (always paired with a label).
