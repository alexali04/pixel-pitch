# Pixel Pitch

A browser-based, pixel-art 11-vs-11 soccer game. No build step, no dependencies.

## Run

Open `index.html` in a browser, or serve the folder:

```bash
python3 serve.py
```

then visit http://localhost:8765.

**On a phone or tablet:** run `python3 serve.py --lan` and open the address it prints (your
computer's IP, port 8765) in Safari/Chrome on the same Wi-Fi. Play in landscape. While it runs,
anyone on that network can open the game.

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
chip that still arcs over a defender and a full hold is a ~45m ball; a full wind-up on a shot is hard but can fly wide or over. L and C also shoot. From point-blank range (about 13m out, central) a shot you aren't aiming at the goal mouth goes towards goal anyway, away from the keeper.

**Aiming passes:** the pass goes where the aim points, with a light assist: it leans onto a
team-mate's run when one is within ~14° of the line, leans a touch towards goal in the final
third, and turns back into play (or towards the box) rather than going straight out. The aim starts at your direction
when you press J/K and then turns smoothly (~150°/s) towards whatever direction you hold, so
you can stop it at any angle. A dashed line shows where the ball will go, and a ring marks the
teammate who will get there first; they run onto it. Keepers can't handle back-passes.

Keepers holding the ball: **J** rolls it out, **K** / **Space** kicks it.

### Touch (phones and tablets)

Every gesture can start anywhere on the screen.

| Gesture | With the ball | Without it |
|---|---|---|
| Pull back (drag away from the goal you're attacking), let go | slingshot: the ball goes the opposite way. Pull length = power; up to ~60% of a full pull it's a ground pass, longer is lofted (and higher). Once pulling you can swing round to any angle, even to play it backwards. Aimed at the goal in range = shot | |
| Second finger down while pulling | keeps it on the ground at any power | |
| Bring the finger back to the start, let go | cancel | |
| Drag forwards (or square) | dribble that way, like a joystick centred where your finger landed; further = sprint | run that way; a quick swipe = slide tackle |
| Tap | | tackle / header / go for a loose ball; tap a team-mate to switch to him |
| II button (top left) | pause | pause |

A full pull is about a sixth of the screen width. Set pieces, throw-ins, free kicks and
penalties work the same way. The gestures feed the same aim/power logic as the keyboard and
mouse (`js/touch.js`). On phones the view widens to the screen's shape, so you see more of the
pitch side to side. iPhone Safari can't hide its own bars for a web page: for true fullscreen,
use Share → Add to Home Screen and open it from there (or aA → Hide Toolbar in Safari).

## Smoothness controls

**Aim with**: *Free aim* (default) — the keys turn the aim; *Team-mate targeting* — the direction
you hold picks a team-mate and the pass leads his run; *Mouse pointer* — the crosshair under the
cursor is where you aim; *Mouse (locked)* — like a first-person game: click the pitch to grab the
mouse, which is hidden, and moving it pushes a crosshair around the ball (Esc lets go and pauses).
Only real goals count: there are no offscreen goals.

On the title screen or pause menu: **Pass assist** (off / light / strong), **Aim with**, **Key aim
speed**, **Mouse sensitivity** (locked mouse), **Auto-tackle**, **Auto-sprint on defence**. With
mouse aim the keys only move your player. **Left click** is one action: click on the goal mouth to
shoot there, anywhere else to pass there (hold to strike harder); on defence it tackles. **Right
click** is lofted: a chip if you click the goal from close in, otherwise a floated pass.

The ball goes where your body allows: while you wind up, your player turns towards the aim (quick
standing, slow at a sprint) and can only strike ~77° across his body at full speed (~109° standing),
so the preview line can lag the crosshair until he's turned.

Lofted balls carry backspin: they climb, hang, slow in the air and drop steeply, then check up on
the bounce. Chips have the most; keepers' kicks the least.
**Tactics — Forwards on defence**: *drop back and help* (wingers track back, the striker screens;
deeper the nearer the ball is to your goal) or *stay high for the counter*. CPU teams pick by style.
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

## Test arena

**Test arena** on the title screen: practise against exactly the opponent you want. Pick your
club, how they defend (low block / mid block / high press), their shape (narrow / balanced /
wide), their strength (very weak to very strong, or even with you), their formation, full game or
attacking phases, and half length. No crowd, no season; R restarts the same match. Click a row to
change it (shift-click goes back).

## Season

**Start season** on the title screen and pick any of the 20 clubs in the 2026/27 Premier
League (player names are made up). Each club has a rating, a formation and a play style that
drives its AI (low / mid / high block, width, forwards up or back), and a rival: rivalry games
are flagged as derbies. 38 rounds, home and away. The season saves automatically in the browser;
**Start over** deletes it. **Friendly** lets you pick any two clubs.

- **Hub**: next fixture with both teams' star ratings and the opponent's style, the table around
  you, coins, fan and board meters. Table / Fixtures / Squad screens.
- **Squad**: your XI on a pitch map plus a 7-man bench. Click one player and then another to swap
  them. Pick a formation (4-3-3, 4-4-2, 4-1-4-1, 4-3-1-2, 3-4-3, 4-2-3-1); players are re-arranged
  to suit it. Players out of their natural position (shown in brackets, amber / red) lose some
  skill. Tactics: block without the ball, width, and whether the forwards drop back. The map
  shows your shape **without the ball** (it moves as you change tactics) or **with the ball**.
- You play your match; the other nine are simulated from team ratings (attack vs defence,
  midfield control, home advantage).
- **Coins**: 300 / 120 / 50 for a win / draw / defeat, +20 a goal, plus the gate at home games
  (bigger when the fans are happy), and end-of-season prize money by position. Nothing to spend
  them on yet.
- **Fans** like wins and goals and hate defeats (most at home). **Board** judges your points
  against the pre-season prediction from your squad's rating. Both drift back towards neutral.
  An empty board meter, or a poor board and a season far below expectations, gets you sacked.
- Next season keeps your squad, coins and half your moods; the other clubs' squads drift a little.

### Champions League

The current format: a 36-club **league phase** (the Premier League's top four, or in the first
season the four strongest squads, plus 32 continental clubs). Each club plays eight different
opponents, two from each pot, never one from its own country, over eight matchdays between
league rounds. **1st-8th** go straight to the Round of 16; **9th-24th** play two-legged knockout
play-offs for the other eight places; 25th-36th are out. Round of 16, quarter-finals and
semi-finals are two-legged (the better league-phase finisher hosts the second leg; level on
aggregate means penalties), then a one-off final at a neutral ground. You play your own games;
the rest are simulated. The **Europe** screen shows the 36-club table and every tie. European
nights pay more (bigger gates, prize money per round) and lift fans and board.

## Fouls

Tackles can be fouls: likeliest when the tackle misses the ball, comes from behind, or is a
slide, and less likely from good tacklers (and much less likely in a defender's own box). A foul
gives a free kick where it happened, or a **penalty** in the box: everyone else waits outside the
box, the keeper stays on his line and has to guess a side. Reckless challenges (sliding in from
behind above all) get a yellow card; a second yellow is a red and the player is sent off, leaving
his side a man short. Cards are listed at half-time and full time. Free kicks within ~30 m of goal are **direct**: the defenders form
a 3-4 man wall 9.15 m away (shading the near post) and you can't take it until it's set (about
2 s); Space shoots it with dip to get up and over, and the wall can block it. CPU sides have a
go about two times in three.

## Presentation

- **Goal replays**: after each goal the last few seconds replay in slow motion (J / Space /
  click skips).
- **Sound**: the crowd is real: field recordings of 29,546 fans at FC St. Pauli's Millerntor
  Stadium. A calm ambience bed (only the stretches without big reactions in them) runs under the
  match: hushed while you keep the ball unpressed, swelling as you near their box; a goal roar
  when you score, a groan when they do; an "ooh" as a shot is saved, blocked or hits the
  woodwork, and for a shot that's going wide it starts as the shot is struck so the groan lands as
  it passes the post (louder for your shots); outrage when your player is fouled. Reactions start
  at hand-picked cue points in the recordings. The crowd falls silent on pause and half-time. Everything else (kicks, whistles, menu music, clicky buttons) is
  synthesized. M mutes all; the Sound card (title screen and pause menu) has Master, Music, Crowd and Effects sliders and the menu-music toggle, saved between visits.

## Credits

Crowd recordings: "Sound Of Sankt Pauli" pack by itmightgetloud (Philipp Feit) on Freesound,
CC0 (freesound.org/people/itmightgetloud/packs/44412/). Files in `audio/`.

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
| positioning | how quickly a defender tracks shape shifts (poor = lags and drifts); with composure + vision, how well forwards time runs (wait for the passer, bend along the line, check early runs) |
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
- `js/touch.js` – touch gestures (drag to kick, hold to run, taps) turned into the same inputs
- `js/render.js` – pixel renderer (pre-rendered stadium, sprites, radar)
- `js/audio.js` – synthesized sound effects (Web Audio, no asset files)
- `js/main.js` – screens and the fixed-timestep loop
- `js/debug.js` – headless AI-vs-AI sims for tuning: `PP.debug.sim(4)` in the console
