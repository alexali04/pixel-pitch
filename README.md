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
| J | ground pass (to the team-mate you're pointing at) | switch player |
| K | lofted pass; aimed at goal from within ~26m (not from wide) it's a chip shot | slide tackle |
| L / Space | shoot | tackle (or go for a loose ball) |
| J / Space with the ball in the air near you | header pass / header at goal | header clearance (Space) |
| Space with the ball loose on the floor | sprint to collect it | sprint to intercept it |
| P / Esc | pause | pause |
| R | restart the match | restart the match |
| M | mute / unmute sound | mute / unmute sound |

Receiving takes a moment: a hard or dropping ball must be brought under control before you can
play it (better first touch = quicker); a pass released early goes as soon as it's controlled.

Hold J / K / Space to set strength, like how far you swing your leg: a tap on J is a firm
~15m pass and a full hold is a ~40m ball (capped, so it won't fly out of play); keepers
play it firmer, and back-passes to the keeper always reach him; a tap on K is a short
chip that still arcs over a defender and a full hold is a ~45m ball; a full wind-up on a shot is hard but can fly wide or over. L and C also shoot.

**Aiming passes:** the pass goes where the aim points, with a light assist: it leans onto a
team-mate's run when one is within ~14° of the line, leans a touch towards goal in the final
third, and turns back into play (or towards the box) rather than going straight out. The aim starts at your direction
when you press J/K and then turns smoothly (~150°/s) towards whatever direction you hold, so
you can stop it at any angle. A dashed line shows where the ball will go, and a ring marks the
teammate who will get there first; they run onto it. Keepers can't handle back-passes.

Keepers holding the ball: **J** rolls it out, **K** / **Space** kicks it.

## Smoothness controls

**Aim with**: *Team-mate targeting* (default) — the direction you hold picks a team-mate and the
pass leads his run, so no fine angle steering is needed; *Free aim* — the keys turn the aim;
*Mouse* — the mouse aims. Only real goals count: there are no offscreen goals.

On the title screen or pause menu: **Pass assist** (off / light / strong), **Aim with** (direction
keys / mouse), **Key aim speed**, **Auto-tackle**, **Auto-sprint on defence**. With mouse aim the
keys only move your player; point to aim passes and shots, left click = Space, right click = K.
**Defending assist** (when idle / always / off): your controlled defender takes up his AI role —
press, cover, mark, or go to where a lofted ball will land — whenever you're not steering (or
always, with your keys nudging him).

When you press a pass button the aim is exactly the direction you're holding — except when you're
right by a touchline holding straight at it, where it starts on a team-mate along the line instead. With the keys,
a fresh press far from the current aim flicks it there instantly; holding a key
glides it for fine adjustment. Soft passes prefer the nearer of two team-mates on a similar
line; firm ones can find the far man (the near one lets it run).

## Modes

Toggle on the title screen (button or **F**):

- **Full court OFF** (default): you only play your attacking phases, each starting from a
  scenario: *build-up* from your keeper against a high press, or *break them down* against a
  settled mid/low block. If you lose the ball you defend it live: the phase ends when they
  shoot, it goes out, or they keep it 15s (the rest of their attack then happens offscreen);
  win it back and your attack carries on. It also ends when you score or your attack fizzles (45s). The CPU's attacks happen offscreen: the chance they score depends
  on where you lost it (own third is dangerous) and their attack/midfield stars vs your
  defence/midfield stars. The clock jumps between phases (7 per half).
- **Full court ON**: continuous 11v11, you defend too. Control switches to the best goal-side
  defender, who also pokes at the ball automatically when close.

## Tactics

Each team has a style (shown on the title screen): a defensive block and how compact it is.

- **Low block**: back line ~18m from goal, very compact, presses only in its own third.
- **Mid block**: back line ~33m, presses from around halfway.
- **High press**: back line ~45m, two pressers anywhere; vulnerable in behind.

Blocks slide towards the ball, move up and down with it as connected lines, and drop off with
runners. An extra player presses on triggers (receiver facing his own goal, pinned on the
touchline, a back pass), pressers curve their run to block the carrier's best pass (cover
shadow), and defenders goal-side of a sprinting runner converge on him. Offside is enforced.
Sprinting with the ball means bigger touches that defenders can nick.

## What the stats do

| Stat | Effect |
|---|---|
| pace / acceleration | top speed and how fast you get there |
| agility | how much speed a sharp turn costs |
| stamina | how fast sprinting drains energy (tired = slower) |
| short / long passing, crossing, kicking (GK) | pass accuracy (crossing for wide balls in the final third) |
| vision | AI pass choice: sees longer passes, picks better ones, leads runners more |
| finishing / shot power / long shots | shot accuracy, speed, and accuracy from 20m+ |
| composure | how much pressure hurts passes and shots |
| dribbling / strength | size of sprint touches; resisting tackles and shielding |
| first touch | how quickly a pass is brought under control |
| tackling | tackle success |
| positioning | how quickly a defender tracks shape shifts (poor = lags and drifts) |
| marking | how tightly a defender picks up the nearest attacker |
| heading | header accuracy and power |
| reflexes / diving / handling / GK positioning | saves, dive reach and speed, catching vs parrying, smothering 1v1s |

The pause screen (P) shows your XI's attributes, foot and traits.

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
