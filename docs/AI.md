# How the CPU players work

This is the mechanics of Pixel Pitch's player AI: what each player reads, what it outputs, and
which rule decides where it stands at any moment. The football reasoning behind blocks, pressing,
the 2-3-5 squeeze and so on is in [TACTICS.md](TACTICS.md); this file is about the code. Function
names refer to `js/ai.js` unless another file is given. Numbers are the values in the code at the
time of writing.

Units: metres and seconds. The pitch is 105 x 50 m (`C.W`, `C.H`, narrower than real). Positions
in the AI are mostly **depth** (0 = own goal line, 1 = the goal you attack; 0.1 = 10.5 m) and
**lateral** (0 = top touchline, 1 = bottom). Your side (home) attacks right to left, the CPU left
to right; the AI code never cares, it works in each team's own frame (`team.depth`, `team.toWorld`).

## 1. Overview

- The match steps at a fixed `C.DT = 1/120` s. Every step, `Match.step` (js/match.js) runs the
  user assists (`autoSwitch`, `looseBallAssist`, `handleUser`), then `AI.update`, then lunges,
  body checks, player physics, ball, contacts (first touches, headers, keeper saves) and bounds.
- `AI.update` predicts the loose ball's path (3 s ahead in 0.1 s steps, `m.ballPath`) and calls
  `AI.team(m, team, dt)` for both sides. `AI.team` gives every player **exactly one role per
  step** (section 4) and that role sets his movement target.
- **Your team-mates use the same AI.** The only player the AI skips is the one you control (and
  not even him while "defending assist" has him on auto). In normal play your team never has an
  AI ball carrier: when your side gains the ball, control jumps to the receiver. The differences
  between your mates and CPU sides are listed in section 9.
- **Decision vs movement.** Movement is recomputed every step: each role ends in
  `Player.steer(x, y, sprint, arrive)` (js/player.js), which sets a desired velocity. Ball
  decisions are not: a carrier only re-decides when his `think` timer runs out (0.35-0.6 s for
  CPU sides, 0.15-0.3 s within 22 m of goal, 0.22-0.4 s for your side), and in between he keeps
  following the last plan (a dribble target).
- **Physics** (`Player.physics`): jog speed `2.3 + pace*0.036` m/s (pace 75 = 5.0), sprint x1.3,
  with the ball x0.92 jogging / x0.86 sprinting, scaled by `0.86 + 0.14*energy`. Acceleration
  `7 + acceleration*0.12` m/s^2, cut to `0.55 + agility*0.005` of that when turning more than
  60 degrees. `steer` slows linearly inside the `arrive` radius. Sprinting drains energy at
  `0.05*(1.5 - stamina/100)` per s; anything slower recovers `0.02*(0.5 + stamina/100)` per s.
  Players closer than 0.75 m are pushed apart (`Match.separate`).

## 2. Inputs

An AI player has perfect, instant knowledge of the pitch. It reads:

- **Ball:** position, velocity, height, owner, the predicted path (3 s), and `lastKick` (type
  pass/clear/shot/touch/tackle/parry, who, which team, intended target, when, whether it was a
  back pass, the offside set).
- **Everyone's** position and velocity (runs are detected from velocity), facing (the carrier's
  facing feeds press triggers and runs), down/stunned state, and opponents' top speed (lane and
  race calculations use real pace and energy).
- **Own stats** (positioning, marking, vision, dribbling, firstTouch, tackling, composure,
  heading, longShots, the keeper ones) and formation slot `{role, d, l}` (js/teams.js).
- **Team style:** `team.block` (low/mid/high: the current block, which phase mode may override),
  `team.compact`, `style.aggression` (`AI.aggr`), `style.fwdDefend` (`AI.fwdDefend`).
- **Timers:** `team.lostAt` (when we lost the ball), the carrier's `gotBallAt` / `settleUntil`,
  `ball.protectUntil`, a player's own run/show timers.
- **Match state:** play / restart (kind, taker, wall) / goal; `m.autoplay`; `AI.TUNE`.
- **Your input, a little:** your team-mates start runs when you wind up a pass (`m.charging`).

It does **not** know or use: the score, the clock or stoppage time; anyone's energy (own
fatigue only shows through speed); opponents' skill stats beyond pace; who is on a yellow (except
that a booked player lunges less); your intentions (CPU defenders never read your input); anything
beyond the 3 s ball prediction and linear extrapolation of players. There is no field of view and
no memory beyond the timers above.

## 3. Outputs

- **Movement:** a steer target, a sprint flag and an arrival radius. Facing follows velocity,
  except where a role explicitly faces the ball or carrier (container, support, markers, screen,
  shape players within 1.5 m of their spot, wall).
- **Kicks** (through js/match.js): `passTo` (ground or lofted, aimed at a lead point
  `0.5 + vision*0.005` of the way along the receiver's run), `kickTo` (to a spot: balls in behind,
  clearances), `shoot(aimY, power)`, `fkShot`, `throwBall`. The AI never chips a shot and never
  heads deliberately (see headers below).
- **Tackles:** `m.startLunge` (a 0.18-0.24 s standing-tackle wind-up resolved by
  `resolveTackle`). CPU outfielders never slide tackle. Keepers dive (shots), smother (1v1 in the
  box) or lunge (1v1 outside it).
- **Headers** are automatic in `Match.contacts`: any AI-driven player reaching a ball above
  1.1 m heads it clear if it's the opponent's ball inside our 30% (depth < 0.3), or at goal if
  it's our ball beyond depth 0.84 and within 12 m of the centre line; otherwise he tries to
  control it.

**Error after the choice.** The AI picks the ideal target; js/match.js then perturbs it:
- Pass angle error `(0.015 + D*0.0012) * (1.6 - skill) * (1 + pressure*(1.2 - composure/100))`
  x1 for your side, x1.8 for CPU (`CPU_PASS_ERR`; x2.2 `CPU_ERR` with `TUNE.sharp` off). Skill is
  shortPass, longPass, crossing (lofted from wide in the final third) or kicking (keeper).
- Pass distance error: Gaussian `0.05` (you) vs `0.12` (CPU) `* (1.6 - skill)` of the distance.
- Shot angle error `(0.035 + D*0.002 + power^2*0.06 + pressure*0.09*(1.3 - composure/100)) *
  (1.6 - finishing/100)`, x more beyond 20 m for poor long-shooters, x1.7 for CPU
  (`CPU_SHOT_ERR`). CPU direct free kicks x1.3.
- `pressure` everywhere in match.js is `pressureOn(p) = clamp((3 - d)/2.5, 0, 1)` with `d` the
  nearest opponent: 0 beyond 3 m, 1 inside 0.5 m.

## 4. Phase and role assignment each step

**Phase.** At a restart the taking side attacks. In play, the owner's team attacks. With the
ball loose, the team whose **pass** is in flight attacks; after any other loose ball (shot,
clearance, tackle, dribble touch) each team keeps the phase it had.

**Roles, in priority order** (the first that applies wins; the exported state shows this as
`aiRole`):

| # | Role | Who |
|---|---|---|
| 1 | sent off / `wall` | sent off: stands still; wall: holds his wall spot at a free kick |
| 2 | `you` | the player you control (skipped by the AI) |
| 3 | `keeper` | always `AI.keeper` (section 7) |
| 4 | (lunging) | mid-tackle, no new orders |
| 5 | `carrier` | ball owner, `AI.carrier` (section 6) |
| 6 | `receiving` | target of a pass (or handed a loose ball by your assist): sprints to the intercept point; expires after 4 s |
| 7 | `chaser` | one per team on a loose ball: the outfielder with the earliest intercept time. None for 0.22 s after an opponent's pass ("read the pass first"); none on your side if your man is within 0.3 s of the best |
| 8 | `presser` | `AI.press`, see below |
| 9 | `blocker` | converges on a runner (below) |
| 10 | `container` | `AI.contain`: 4.5 m goal-side of the carrier, jogging, facing him |
| 11 | `support` | CPU in possession under pressure: `AI.supportSpots` |
| 12 | `marking X` | man-marks from `AI.manMarks`, `AI.setPieceMarks` or `AI.boxMarks`, run by `AI.manMark` |
| 13 | `screen` | high press: sits 1.3 m from their pivot on the carrier's side |
| 14 | `shape (attack/defend)` | everyone else: `AI.shapeTarget` (section 5) |

**Pressers** (only when the opponent has the ball in play). Candidates are our outfielders by
distance to the carrier (not your controlled man, not anyone down). With `cd` the carrier's depth
in our frame and `B = AI.BLOCKS[team.block]`:

1. `n = B.pressers` if `cd < B.pressZone`, else 0. Press zones: low 0.40, mid 0.52, high 1.01
   (anywhere); pressers low 1, mid 1, high 2.
2. +1 on a **press trigger** (`AI.pressTrigger`) if `cd < pressZone + 0.2`: carrier facing his
   own goal (`fx*dir < -0.35`), within 6 m of a touchline, receiving a back pass in the last 1.5 s,
   or **dawdling**.
3. Counter-press, by time since we lost it: high block within 2.5 s: `n = max(n, 1) + 1`. Others:
   lost in their 40% (`cd > 0.6`) within 1.5 s: exactly 1; lost past our 45% within 3 s: 0 (drop
   off and organise).
4. Dawdling (`AI.dawdling`): the carrier has had it longer than `2.4 - 1.8*aggr` s (aggression of
   the pressing side) and moves under 1.5 m/s. Then at least one goes, if
   `cd < pressZone + 0.15 + 0.35*aggr`.
5. Cap `n <= 2` (`maxEngaged`). The first `n` candidates press if within
   `range = B.range + 6 (trigger) + 6*aggr` (range low 10, mid 12, high 17 m); the nearest always
   presses when `n >= 1`.
6. No presser: the nearest becomes the **container**.
7. **Blockers:** if the carrier is running at our goal faster than 4 m/s, candidates within 7 m
   who are goal-side of him also converge (`AI.press` with a 1.6 m stand-off), up to 2 engaged
   players in total.
8. Your side: if you are no more than 2 m further from the carrier than the nearest mate, or the
   nearest mate is over 10 m away, your mates don't press; the nearest (if within 14 m) covers as
   container.

**Screen** (high block, carrier beyond our 55%): the nearest free AM/CM/DM/ST to their most
central, deepest DM/CM. Dropped whenever man-marks are active.

**Man-marking** is one of three sources (an empty result falls through to shape):
- `AI.manMarks` (open play): only a **high** block with `TUNE.manMark`, opponent in possession,
  ball at our depth 0.38 or more. Every free outfielder takes an opponent by greedy nearest
  pairing. Spare men: our deepest stay out as cover. Short of men: their players furthest from
  our goal go free. Pairs hold for at least 1.2 s; after that a pair is kept while the marker is
  within 10 m of his man, and only stretched pairs are re-matched.
- `AI.boxMarks` (crosses, when nothing above applies): `AI.crossDanger` is true when they have it
  within depth 0.34 of our goal (~36 m) or their lofted ball will land in our box +5 m. Each
  attacker within 6 m of our box, nearest our goal first, gets the closest free defender
  (pressers, container, chaser excluded). Pairs persist while valid.
- `AI.setPieceMarks` (restarts): corners use `boxMarks`; free kicks within depth 0.4 of our goal
  mark attackers inside depth 0.42 with players not in the wall.

`AI.manMark` stands goal-side plus ball-side of his man, plus 0.3 s of his velocity: in our box
0.8 m off / 0.45 m ball-side; within 30 m of the ball 1.3 / 0.8; otherwise 2.6 / 1.5. Sprints if
more than 3 m out or the man is moving faster than 4.5 m/s. At a free kick he keeps 9.3 m from
the ball.

**`AI.press` in detail.** Target = carrier + `dist` towards our goal (1.1 m, 0.7 m near our goal),
bent 40% towards the carrier's best forward outlet (cover shadow) unless inside our 35%, plus
0.25 s of the carrier's velocity. Sprints if over 13 m away, in danger, or (aggression >= 0.6)
over 2.5 m away. **Jockey** (stays 2.1 m off, no sprint) when `TUNE.jockey`, block not high,
aggression < 0.7, carrier beyond our 35% and below our 75%, settled, no trigger, no counter-press.
Tackle attempt when within 1.6 m (CPU; 2.2 m while the carrier is still settling; your mates
2.0 m), cooldown done, and the carrier either settling or past `protectUntil`:
- lunge chance: settling 0.85, jockeying `0.15 + 0.3*aggr`, otherwise `0.35 + 0.4*aggr`; x0.7 on
  a yellow.
- cooldown before the next try: settling 0.4-0.7 s, jockeying 1.6-2.6 s, else
  `1.0-1.8 * (1.3 - 0.5*aggr)` s.

**Tackle resolution** (`Match.resolveTackle`). A lunge that ends more than 1.9 m from the carrier
(CPU; 2.1 your mates, 2.3 you) is a MISS. Otherwise win chance = base + 0.12 x head-on-ness +
`0.007*(tackling - hold)`, `hold = (dribbling + strength)/2` (+8 for CPU forwards with
`TUNE.sharp`). Base: CPU 0.42, your mates 0.55, you 0.78, any slide 0.62. From behind / shielded
x0.45 (CPU) or x0.55 (you). Ball not yet settled +0.25 (+0.12 your mates); just settled (protect
window) x0.25. Clamped 0.06-0.85. CPU forwards x0.85 again. A won standing tackle keeps the ball
55% of the time, otherwise it squirts loose. Foul chances rise for misses, from behind and slides,
fall for good tacklers, booked players (x0.6) and in your own box (x0.3).

## 5. Position without the ball

`AI.shapeTarget` returns a raw target, which `AI.team` then smooths and adjusts:

- **Lag:** the stored target moves towards the raw one at rate `1.5 + 6*positioning/100` per s
  (12 if the raw target is a sprint, `5 + 4*pos` when dropping deeper on defence). Poor
  positional players lag.
- **Drift:** a slow sinusoidal wobble of up to `(1 - positioning/100) * 2.2` m.
- **Marking nudge** (`AI.mark`, defending only): pulled `marking/100 * 0.35` of the way towards a
  point 1.6 m goal-side of the nearest attacker within 8 m of the target.
- **Sprint** if more than 9 m from target, the raw target says so, recovering (more than 2.6 m
  behind the target for CB/FB/DM, 5.3 m for others, when defending), or upfield of the ball and 3 m
  out. Forwards of a `fwdDefend: 'high'` side don't recover. Arrival radius 2.5 m.

### Attacking shape (phase = attack)

1. **Slot to pitch.** The back line sits `TUNE.backGap` (0.19, ~20 m) behind the ball, clamped
   0.07-0.62 (`backMax`). Depth `d = back + (slot.d - 0.17)*0.92`, lateral
   `l = 0.5 + (slot.l - 0.5)*1.1 + (ball lateral - 0.5)*0.22`.
2. **Full-backs** (`TUNE.fbPush`) +0.04, and +0.08 more on the ball's side once the ball is past
   our 45%.
3. **Squeeze** (`AI.squeeze`, 0..1): `clamp((ballD - 0.45)/0.15) * clamp((theirLine - 0.6)/0.14)`
   with `theirLine` their second-last player in our frame. At 1 everyone moves to the 2-3-5 of
   `AI.squeezeSlot` (TACTICS.md section 1); centre-backs and DM only ever move up. Players more
   than 6 m short of a squeezed spot (sq > 0.4) sprint.
4. **Link man** (`AI.linkPlayer`, `TUNE.link`): with the ball between depth 0.22 and 0.75, one AM
   (else the nearest CM) stands in the pocket between their midfield and back lines
   (`AI.pocketDepth`), narrowed to 30% of the ball's lateral offset. Sticky.
5. **Striker shows short** (`AI.showShort`): ball between 0.28 and 0.7, a 0.4/s chance per
   striker to drop off the line into the pocket (at least 13 m ahead of the ball) for 1.4-2.3 s,
   one at a time, 2.5 s between, never mid-run.
6. **Runs in behind** (ST/LW/RW/AM only). `AI.runIQ = clamp((0.45*positioning + 0.3*composure +
   0.25*vision - 45)/45, 0, 1)`. "Ready" = a team-mate carrier within 40 m facing forward
   (`fx*dir > 0.4`), settled, `pressureOn < 0.5`, or you winding up a pass. A run starts with
   probability per second `0.5 + 1.5*iq` when ready (`2.5 + 1.5*iq` when you're winding up),
   `0.15 + 0.6*(1 - iq)` when not, at most every 1.2 s after the last. It lasts 1.2-2.0 s: first
   it holds just onside (0.8 m inside the line) bending sideways for `0.15 + 0.4*iq` s (as long
   as you're winding up, if iq > 0.5), then bursts to 6.3 m beyond the line. A good runner
   (iq > 0.4) aborts a run that's no longer on at 6*iq per second.
7. **Offside discipline:** when not running, depth is capped 1 m inside the offside line
   (`AI.offsideLine`, never shallower than halfway). Forwards stranded offside sprint back if
   `runIQ > 0.5`.
8. **Get open** (all but CBs, not sprinting): every 0.5 s try 8 small offsets (up to 4 m) and keep
   the one maximising `open + 0.6*lane - 0.15*offset` (distance to the nearest opponent and
   clearance of the passing lane, each capped at 8 m).
9. **Don't crowd the carrier:** a target within 7 m of him is pushed out to 7 m.
10. **Support spots** (CPU only, `TUNE.playOut`): an opponent within 6 m of the carrier, carrier
    below our 70%: the 2 nearest team-mates within 24 m go to one of 12 spots 8-12 m around him,
    scored by space, lane, forwardness, being away from the presser, and not doubling up.

### Defending shape (phase = defend)

1. **Line depth:** `B.line + (ballD - 0.5) * k` (k = 0.06 low block, 0.18 otherwise). Lines:
   low 0.17, mid 0.31, high 0.44.
2. **Retreat after losing it:** minus up to 0.1, fading over 4 s (not for a high block in its
   first 2.5 s, it counter-presses instead).
3. **Caps:** at least 0.07 goal-side of the ball; 0.01 goal-side of the deepest onside runner
   sprinting at our goal (`AI.runnerDepth`); never below 0.055.
4. **Tier:** `d = line + tier * B.len * (1.2 - 0.4*compact)` with tier CB/FB 0, DM 0.3,
   CM/LM/RM 0.55, LW/RW 0.72, AM 0.75, ST 1 (len low 0.24, mid 0.28, high 0.32).
   `fwdDefend: 'help'`: wingers 0.52 (0.45 in a low block), ST 0.8, AM 0.6, each dropping by up to
   0.3/0.2/0.2 as the ball goes from halfway to our 20%. `'high'`: wingers and ST +0.35.
5. **Width and shift:** `l = 0.5 + (slot.l - 0.5) * B.width * (1.18 - 0.36*compact) +
   (ball lateral - 0.5) * B.shift` (width low 0.72, mid 0.78, high 0.82; shift 0.38/0.34/0.30).
6. Then the lag, drift, marking nudge and sprint rules above.

### Worked example: a CPU left-back (4-4-2 slot d 0.20, l 0.13), compact-mid style

Mid block, compact 0.6, positioning and marking 75. Lateral 0 is the top touchline.

- **Your ball at halfway, on the far (bottom) side, lateral 0.8.** Line = 0.31. Tier 0, so depth
  0.31 = **33 m from his goal**. Lateral = `0.5 - 0.37 * 0.78 * 0.964 + 0.3 * 0.34 = 0.32`, i.e.
  **16 m from the top touchline**, tucked in. If one of your players is within 8 m of that spot
  he is pulled ~26% of the way to 1.6 m goal-side of him, and he wobbles up to 0.55 m.
- **Your ball 31 m from his goal (depth 0.30) on his side, lateral 0.2.** Line =
  `0.31 - 0.2*0.18 = 0.274`, capped at ball - 0.07 = **0.23 (24 m)**; lateral
  `0.5 - 0.278 - 0.102 = 0.12` (**6 m in**). Being inside depth 0.34, `crossDanger` is on, so if
  an attacker is near the box and he's the closest free defender he becomes a box marker instead.
  If he's the nearest to the carrier and the carrier is inside the press zone (0.52), he presses.
- **CPU ball at halfway, central.** Back line 0.31; his depth `0.31 + 0.03*0.92 + 0.04 + 0.08`
  (ball-side push, ball past 0.45) = **0.46 (48 m)**, lateral `0.5 - 0.37*1.1 = 0.09` (**4.7 m
  from the touchline**), then the get-open nudge.
- **CPU camped in your half** (ball 0.65, your line 0.78): squeeze = 1, so he goes to
  `line - 0.05 = 0.73` (77 m) on the touchline (lateral ~0.05): the 2-3-5 full-back.

## 6. With the ball

**Gaining it** (`Match.gainPossession`): settle time `(0.06 + 0.035*max(0, speed - 7) +
(height > 0.4 ? 0.25 + 0.2*height : 0)) * (1.5 - firstTouch/100)`, x1.2 for CPU (x1.35 without
`sharp`), capped 1.1 s. During `settleUntil` the ball bobbles ahead of him and tackles get the
settling bonus. Then comes the protect window, up to `protectUntil` = settle + 0.5 s (you) /
0.3 s (CPU): AI pressers don't try a tackle in it, and any tackle that lands in it is x0.25.
`think` starts at
`max(0.3-0.6, settle + 0.1)`. Special cases:
- **CPU one-touch lay-off:** a CPU player taking a low team-mate pass with an opponent within 3 m
  plays it first time with probability `0.35 + firstTouch/200` (settle 0.05 s, think 0.06 s).
- **CPU forward near goal** (`sharp`, within 20 m): think = settle + 0.05-0.15 s.
- Winning a tackle adds a scrappy settle of `0.55-0.6 * (1.5 - firstTouch/100)` (x1.35 CPU).

**First touch** (`Match.contacts`): a pass is controlled for sure below a speed threshold
`(meant for him ? 11 CPU / 12 you : 9) + firstTouch/100 * (7 CPU / 8 you / 6 not meant)` m/s,
then falls 1/16 per m/s above it (min 0.15). Balls above 1.2 m: x0.75 CPU, x0.93 you. Team-mates
let a firm pass meant for someone else run (dummy). Aerial duels: `heading/100 + 0.4*strength/100
- 1.1*distance + 0.18 (own box) + noise(0.22)`.

**The carrier loop** (`AI.carrier`): while `think > 0` with no plan he drifts 3 m forward at a
jog. CPU only (`playOut`): once settled, if an opponent is within 2.4 m, or within 6 m closing at
over 1 m/s and under 0.8 s away, he decides now (think cut to 0.03-0.1 s). When think hits 0,
`AI.decide` returns a plan; shots, passes, balls in behind and clearances execute at once; a
dribble plan is followed until the next think. Sprinting faster than 1.05x jog speed knocks the
ball ahead every `0.4 + dribbling*0.002` s, loose and stealable (`Match.knockOn`).

**`AI.decide` order** (outfield; `pressure` here is the distance in metres to the nearest
opponent, not `pressureOn`):

1. **Shoot?** If within 28 m of goal and the angle is open (`|dy| < 0.9*|dx| + 3`). Probability:
   under 13 m 0.85, under 19 m 0.4, else `0.1 * longShots/70`. CPU: x1.05 for ST/LW/RW/AM, x0.85
   for others (x0.8 for all without `sharp`). x0.4 if any outfielder is within 1.2 m of the line
   to goal. Aim: the side away from the keeper, 65-105% of the way to the post; power
   `0.4 + dist/40 + (-0.1..0.15)`, clamped 0.35-0.95.
2. **Clear** (50%) if in our 20% with an opponent within 2.5 m: lofted to depth 0.55, random lateral.
3. Score pass options (`AI.passOptions`, below).
4. **Pressure play-out** (CPU, `playOut`): opponent within 3.2 m below our 75%, or just
   one-touched. Take the best-scoring "safe" option (ground, lane > 0.4, score > -1.5) if
   one-touch, or if he's within 2.3 m, or if it's also the best option. Else, in our 55% with an
   opponent within 2.3 m: a lofted option (lane > 0.3, score > -2), else in our 35% a clearance to
   depth 0.68 towards our most advanced player.
5. **Pass vs dribble.** Dribble score `0.9*space/12 + (dribbling - 60)/100 - 0.3 - 0.8 (opponent
   within 2.2 m) + 0.6 (had it under 1.2 s and none within 2.5 m) + 0.4 (space > 7 and none within
   3 m)`, where space is the distance to the nearest opponent in a forward cone (max 12). Pass if
   the best option beats it, or if an opponent is within 1.8 m and the best option scores > -0.6.
6. **Shield** (CPU, `playOut`): opponent within 2.2 m below our 75%: dribble 4 m straight away
   from him at a jog.
7. **Dribble:** at goal centre if within 25 m, else 10 m forward and 20% towards the middle,
   veering 6 m away from an opponent within 5 m. Sprint if space > 6 m.

**Pass option scoring** (`AI.passOptions`, max 45 m). Skipped: downed players, the keeper once
we're past our 30%, anyone under 5 m away, anyone who'd be offside. For each team-mate:
`gain*5 + 0.8*clamp(lane/2.5, -1, 1) + 0.5*free - d/50 - 0.4 - back - square + noise`, where
- `gain` = depth gained (fraction of the pitch: 10 m forward = +0.48),
- `lane` = the worst margin over opponents between 2% and 90% of the way along: their distance
  from the line minus how far they can reach (0.9 m plus 85% sprint speed over the time the ball
  takes to get there, less 0.3 s reaction); below 0 is an interception (-2 more),
- `free` = nearest opponent to the receiver, up to 8 m, over 8,
- `back` 0.4 for returning it to whoever just passed to you (within 3 s), `square` 0.25 if it
  gains under 2 m,
- `noise` uniform +-`0.18*(1.5 - vision/100)`; -0.6 beyond `18 + 0.3*vision` m ("beyond what he
  sees").
Over 14 m a lofted version is also scored: `gain*5 + 0.9*clamp(landing/3, -1, 1) - 0.6 - d/70 -
back + noise`, landing = how far the nearest opponent will still be from the receiver when it
drops (-2 if negative). CPU sides also add **balls in behind** (`AI.behindOptions`): for each
onside ST/LW/RW/AM/LM/RM not behind the passer, a spot 7 m past their line (lofted if over 22 m,
12-50 m away) that he reaches at least 0.05 s before any opponent (defenders facing the ball lose
0.4 s turning); score `4*(depth gain) + 0.9*min(margin, 1.5) - 0.9 + (vision/100 - 0.7) +-0.2`.

## 7. Keepers (`AI.keeper`)

In priority order:
1. **Penalty against:** on his line.
2. **Shot coming:** opponent's ball moving at goal over 7 m/s, on target, arriving within 2.5 s,
   and going to reach the line. 0.14 s reaction (stands still), then shuffles across; dives at the
   last moment that gets him there (standing reach 0.7 m, dive speed up to
   `5.5 + 0.04*diving` m/s). Save chance (`Match.keeperContact`): `0.95 - 0.02*(speed - 22) -
   0.25*(distance/reach) + 0.006*(reflexes - 70)`, -0.15 above 2 m, +0.12 for free kicks, less for
   a dropping chip, clamped 0.2-0.97; catch vs parry by speed and handling.
3. **Loose ball in his box** he reaches first: goes and gets it.
4. **Sweeper-keeper** (`AI.sweeper = 0.5*clamp((gkPositioning - 55)/35) + 0.5 high / 0.25 mid`):
   a loose ball behind our last defender within `14 + 24*sw` m that he reaches
   `0.55 - 0.3*sw` s before any opponent: comes for it.
5. **Carrier running at goal:** no team-mate goal-side within 4 m of the line to goal and within
   24 m: rushes him; within 2.4 m he smothers (in the box) or lunges (outside). Covered but in the
   box within 16 m: narrows to `dist - 2.5` m (1-8 m) off his line and claims it at 1.3 m with
   chance `0.45 + 0.01*(gkPositioning - 70)`.
6. **Default:** on the line from goal centre to ball, `1 + 0.06*dist` m out (max 4.5). A sweeper
   (unless they have it in our half) moves out to `0.45*sw` of the way to his back line (max
   `6 + 12*sw` m), phased in as the ball goes from 30 to 55 m away.

**Distribution** (`AI.decide`, keeper branch): outside his box with an opponent within 9 m, clear
to depth 0.62. Otherwise the best pass option up to 55 m if it scores > -1 or nobody is within
6 m; else a long clearance to depth 0.6. Ball in hands (restart `gk`, after 1.4 s): roll out
(70%) to a ground option within 28 m with lane > 1, else the best option.

## 8. Set pieces and restarts

- **Delays before a CPU taker plays it** (`AI.carrier`): keeper in hands 1.4 s, kick-off 0.8 s,
  throw 1.6 s (then waits up to 4 s for someone free), penalty 2.2 s, direct free kick 2.4 s,
  everything else (goal kick, indirect free kick, corner) 1.1 s. If you don't take yours, the AI
  does it for you after 7 s (10 s from your keeper's hands).
- **Takers:** throws: nearest outfielder; corners: nearest to the corner (`cornerTaker`);
  penalties: best finishing + composure; free kicks: the fouled player (offside: the nearest
  defender); goal kicks: the keeper.
- **Kick-off:** 70% to the partner beside the ball, else the best ground option back in our half.
- **Throw-ins** (`AI.throwIn`): to a team-mate's feet or 2.5 m ahead of him, 4-22 m away, only if
  he arrives at least 0.25 s before any opponent; scored by margin and forward gain. Nobody free:
  6-10 m back, 6-9 m infield. When we have a throw, our two nearest come short (one 7 m down the
  line, one 3 m back and 10 m infield).
- **Corners:** attackers take `CORNER_ATT` spots by heading rank (best header at the near-post
  edge of the six-yard box); defenders take `CORNER_DEF` zones by heading rank (two on the posts),
  then `AI.boxMarks` puts a man on each attacker in the box. The CPU taker crosses to a random
  team-mate beyond depth 0.82, else plays the best pass.
- **Direct free kicks** (within 31 m of goal, within 20 m of centre, more than 10 m from the goal
  line): a 3-man wall (4 under 22 m) 9.15 m away shading the near post (`Match.setWall`);
  everyone else keeps 9.2 m (3 m at throws, 14 m at a phase start). The CPU shoots 65% of the
  time, at the far side of the wall, power 0.5-0.85; otherwise passes.
- **Penalties:** 15% down the middle, else a random side at 45-95% of the way to the post; the
  keeper stays (30%) or guesses a side; save chance x0.8 if right, 0.06 if wrong.

## 9. Your team-mates vs CPU sides (the `isUser` asymmetries)

| Mechanic | Your side | CPU side |
|---|---|---|
| Carrier think time | 0.22-0.4 s | 0.35-0.6 s; 0.15-0.3 s within 22 m of goal (`sharp`) |
| Settle time multiplier | x1 | x1.2 (x1.35 without `sharp`) |
| Protect window after settling | +0.5 s | +0.3 s (+0.2) |
| Scrappy settle after a tackle | x1 | x1.35 |
| First-touch threshold (pass meant for him) | 12 + 8*touch | 11 + 7*touch |
| High balls controlled | x0.93 | x0.75 |
| Pass angle error | x1 | x1.8 (`CPU_PASS_ERR`; 2.2 `CPU_ERR`) |
| Pass weight error | 5% | 12% |
| Shot angle error | x1 | x1.7 (`CPU_SHOT_ERR`; 2.2) |
| Direct free kick error | x1 | x1.3 |
| Tackle base (standing) | you 0.78, mates 0.55 | 0.42 |
| From behind / shielded | x0.55 | x0.45 |
| Settling bonus | you +0.25, mates +0.12 | +0.25 |
| Lunge reach (MISS beyond) | you 2.3 m, mates 2.1 m | 1.9 m |
| Press tackle trigger distance | you-on-auto 2.4 m, mates 2.0 m | 1.6 m (2.2 m settling) |
| Auto body-check (CPU carrier runs into you) | yes, 0.82 base (mates x0.75) | never |
| Forwards' hold-up | - | +8 hold, tackles on them x0.85 |
| Mates press | not when you're as close or nearest is over 10 m | always by block |
| Support spots, early decision, play-out, shield, one-touch, balls in behind | no | yes (`playOut`) |

Only the ball-carrier rows for your side matter in autoplay or at an abandoned restart, since you
always control your carrier. Your side also gets user assists the CPU doesn't need: auto-switch
to the best defender (`Match.defendCost`), the loose-ball assist, and defending assist (`idle`:
your man runs his AI role while you're not steering; `always`: your stick nudges it).

## 10. Tuning knobs

`AI.TUNE` (all on by default):

| Flag | What it does |
|---|---|
| `backGap` 0.19, `backMax` 0.62 | attacking back line distance behind the ball, and its highest depth |
| `fbPush` | full-backs push up in possession |
| `recover` | instant drop-back and recovery sprints when defending |
| `link` | link man in the pocket and striker showing short |
| `jockey` | non-high, low-aggression pressers jockey in midfield |
| `manMark` | high-press man-to-man |
| `playOut` | CPU support spots, early decisions under pressure, play-out/shield branches, one-touch lay-offs, balls in behind |
| `sharp` | CPU sharpness: think times, error multipliers 1.8/1.7 vs 2.2, settle/protect, shot choice by role, forwards' hold-up |
| `mates` | your mates tackle less well than you (0.55 base etc.); off = like you |

Styles: `AI.BLOCKS` (above), and per club in js/league.js `STYLES` + `clubDef`: block, compact,
fwdDefend and aggression (style base +-0.15 by a fixed club offset, clamped 0.1-1). Without an
explicit aggression `AI.aggr` falls back to low 0.3 / mid 0.5 / high 0.8. In attacking-phases mode
(`fullCourt` off) `Match.startPhase` overrides `team.block` per phase: build-up phases (chance
0.65 high, 0.45 mid, 0.25 low style) face a high press (mid if the club is a low block),
break-down phases face the club's block (mid for a high press); the test arena (`fixedBlock`)
keeps it. `Match` constants: `CPU_ERR` 2.2, `CPU_SHOT_ERR` 1.7, `CPU_PASS_ERR` 1.8,
`OFFSCREEN_GOALS` false, `PHASES_PER_HALF` 7.

Console helpers (js/debug.js), all headless AI vs AI with home as the "user" side:
- `PP.debug.sim(n, homeDef, awayDef)`: n halves; pass/lob completion, tackles, restarts,
  possession, time in each third.
- `PP.debug.ab(n, 'ars', 'eve', {playOut: false}, hStyle)`: n halves with `AI.TUNE` overrides
  (restored after); goals, shots, away pass %, away possession, entries into your half, free
  kicks, cards.
- `PP.debug.hold(n)`: carriers receiving in central midfield hold it 3 s; reports how often it's
  lost and the forward options/openness/pressure at 0.5/1.5/2.5 s.

## 11. Giving feedback

The pause menu has an **Export for feedback** button: it saves a 3x screenshot plus the match
state (every player's position, velocity, facing, `aiRole`, plan, think timer, stats; ball and
last kick; teams' block and style; `AI.TUNE`; your note) into `feedback/` (download fallback if
the save server isn't running). Naming the role and rule you think is wrong makes it precise:

- **Role** (`aiRole`): `carrier`, `receiving`, `chaser`, `presser`, `blocker`, `container`,
  `support`, `marking <name>`, `screen`, `wall`, `keeper`, `shape (attack)` / `shape (defend)`.
- **Presser:** goes to the ball and may tackle. **Container:** nearest man when nobody presses,
  4.5 m goal-side, never tackles. **Blocker:** converges on a runner from goal-side.
- **Block:** low/mid/high, the defending shape's depth, length, width, shift and press settings.
- **Press zone:** how far up the pitch (from our goal) the carrier must come before pressers go.
- **Trigger:** back to goal, touchline, back pass, dawdling: +1 presser, longer range, no jockey.
- **Jockey:** a presser holding 2.1 m off instead of diving in.
- **Settle:** the moment after receiving when the ball isn't under control; tackles are easy.
- **Protect:** the short window after settling when tackles rarely win (x0.25).
- **Lane:** a pass's safety margin against the opponent who can get nearest its path.
- **Think:** the carrier's decision timer; he follows his last plan until it runs out.
- **Squeeze / link man / show short / run / check:** the attacking-shape rules in section 5.
- **Line:** for defenders, the block's back-line depth; for attackers, the offside line.
