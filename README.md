# Pixel Pitch

A browser-based, pixel-art 11-vs-11 soccer game. No build step, no dependencies.

## Run

Open `index.html` in a browser, or serve the folder:

```bash
python3 serve.py
```

then visit http://localhost:8765.

## Controls

| | Attacking | Defending |
|---|---|---|
| WASD / Arrows | move (aims passes and shots) | move |
| Shift | sprint | sprint |
| J | ground pass | switch player |
| K | lofted pass | slide tackle |
| Space | shoot | standing tackle |
| J / Space with the ball in the air near you | header pass / header at goal | header clearance (Space) |
| Space with the ball loose on the floor | sprint to collect it | sprint to intercept it |
| P / Esc | pause | pause |
| R | restart the match | restart the match |
| M | mute / unmute sound | mute / unmute sound |

Hold J / K / Space to set strength, like how far you swing your leg: a tap on J is a firm
~15m pass and a full hold is a ~40m ball (capped, so it won't fly out of play); keepers
play it firmer, and back-passes to the keeper always reach him; a tap on K is a short
chip that still arcs over a defender and a full hold is a ~45m ball; a full wind-up on a shot is hard but can fly wide or over. L and C also shoot.

**Aiming passes:** the pass goes exactly where the aim points. The aim starts at your direction
when you press J/K and then turns smoothly (~150°/s) towards whatever direction you hold, so
you can stop it at any angle. A dashed line shows where the ball will go, and a ring marks the
teammate who will get there first; they run onto it. Keepers can't handle back-passes.

## Modes

Toggle on the title screen (button or **F**):

- **Full court OFF** (default): you only play your attacking phases, each starting from a
  scenario: *build-up* from your keeper against a high press, or *break them down* against a
  settled mid/low block. A phase ends when you score, it goes out to them, the attack fizzles
  (45s), or you lose the ball in your own half. Lose it in their half and you can win it back:
  the phase only ends if they get it into your half (or keep it 12s). The CPU's attacks happen offscreen: the chance they score depends
  on where you lost it (own third is dangerous) and their attack/midfield stars vs your
  defence/midfield stars. The clock jumps between phases (7 per half).
- **Full court ON**: continuous 11v11, you defend too. Control switches to the best goal-side
  defender, who also pokes at the ball automatically when close.

## Layout

- `js/config.js` – pitch dimensions and physics constants (metres, seconds)
- `js/ball.js` – ball physics (rolling resistance, air drag, bounces) and pass-speed helpers
- `js/player.js` – player movement
- `js/teams.js` – formations, team definitions, generated squads and stats
- `js/ai.js` – team shape, pressing, ball-carrier decisions, goalkeepers
- `js/match.js` – match rules, restarts, kicks, tackles, user input handling
- `js/render.js` – pixel renderer (pre-rendered stadium, sprites, radar)
- `js/audio.js` – synthesized sound effects (Web Audio, no asset files)
- `js/main.js` – screens and the fixed-timestep loop
- `js/debug.js` – headless AI-vs-AI sims for tuning: `PP.debug.sim(4)` in the console
