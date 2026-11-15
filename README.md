# Pixel Pitch

A browser-based, pixel-art 11-vs-11 soccer game. No build step, no dependencies.

## Run

Open `index.html` in a browser, or serve the folder:

```bash
python3 -m http.server 8765
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
| P / Esc | pause | pause |

Hold J / K / Space to set strength: tap = soft, hold = bullet (a bar shows above your player).

You attack right to left. Control switches automatically to whoever has the ball,
and to the nearest defender when the CPU wins it.

## Layout

- `js/config.js` – pitch dimensions and physics constants (metres, seconds)
- `js/ball.js` – ball physics (rolling resistance, air drag, bounces) and pass-speed helpers
- `js/player.js` – player movement
- `js/teams.js` – formations, team definitions, generated squads and stats
- `js/ai.js` – team shape, pressing, ball-carrier decisions, goalkeepers
- `js/match.js` – match rules, restarts, kicks, tackles, user input handling
- `js/render.js` – pixel renderer (pre-rendered stadium, sprites, radar)
- `js/main.js` – screens and the fixed-timestep loop
- `js/debug.js` – headless AI-vs-AI sims for tuning: `PP.debug.sim(4)` in the console
