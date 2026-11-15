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
| P / Esc | pause | pause |
| R | restart the match | restart the match |

Hold J / K / Space to set strength: tap = soft, hold = bullet (a bar shows above your player).

While a pass button is held, a dashed line shows where the pass will go (an X in space,
a ring under the teammate it's aimed at).

You attack right to left. Control switches automatically to whoever has the ball, and
when defending to the best-placed defender between the ball and your goal. Get close to
the carrier and your defender pokes at the ball on their own; Space/K still tackle manually.

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
