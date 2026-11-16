# Tactics notes

Research notes on how real teams attack and defend, and how each idea maps onto Pixel Pitch's
AI (`js/ai.js`). Written to guide future tuning; "In the game" sections describe what is
implemented today, "Next" what isn't yet.

## 1. Attacking a deep (low) block

**The problem.** A low block sits 10 outfield players between the ball and its own box, narrow and
compact, and gives away the outside and the space in front of it. If the attacking side keeps its
own defenders deep, it ends up with four or five attackers against ten defenders: exactly the
picture in the screenshot that prompted this note.

**What good teams do** (sources below):

- **Squeeze the pitch.** The whole team moves up so the back line sits around halfway or beyond.
  That compresses the space the defenders can clear the ball into and keeps the attacking players
  close enough together to combine. Distances between the lines stay short.
- **Width from the full-backs.** High, wide full-backs on the touchlines stretch the block and pin
  the opposing wingers back. They need to be higher than the opposing winger before the pass is
  played. Overlaps pull opposition wingers out of position.
- **Occupy the half-spaces.** The channel between the opposing centre-back and full-back is the
  most dangerous zone. Wingers come inside into it (with the full-back now providing the width)
  and No. 8s push up into it, so the defenders have to choose between narrowing and following.
- **Five on the last line.** The typical shape is a 2-3-5 (or 3-2-5): five players occupying the
  opposition back line (two wide, two half-spaces, a centre-forward) so every defender is pinned.
- **Switch play quickly.** Circulating from one side to the other faster than the block can
  shift isolates a full-back 1v1 against a winger.
- **Break your own rules sometimes.** Pure positional play can stall into side-to-side passing in
  front of a deep block. What unlocks it is a pass that turns defenders around or freezes them:
  a third-man run, a through ball, a cut-back from the byline, a shot from the edge.

**Rest defence.** While five attack, the others stay behind the ball to stop the counter. That
usually means two centre-backs plus a holding midfielder (the "2-3" in 2-3-5), positioned so they
can step in on any clearance. Teams that create chances through sustained possession pair it
with **counter-pressing**: when the ball is lost in the opposition half, the nearest players
press it immediately, backed by the rest defence, to win it back before the opponent can
organise a counter.

### In the game (current)

- `AI.squeeze(m, team, ballD)`: with the ball in their half against a deep line, the attacking
  team squeezes, more the deeper the block (0 → 1).
- `AI.squeezeSlot(team, slot, line)` places each role in a 2-3-5:
  - Centre-backs: about 31% of the pitch length (~33m) behind the opponents' last line, split
    wide. With the DM, they are the rest defence.
  - Full-backs (or the wide midfielders when there are three centre-backs): high on the
    touchlines, about 5m off the last line.
  - Wingers / wide midfielders: in the half-spaces on the last line.
  - No. 8s: in the half-spaces about 13m off the last line. No. 10: between the lines.
  - Striker(s): on the last line.
- Players more than about 6m behind their squeezed position sprint up.
- Counter-pressing: high-press sides swarm the ball for 2.5s after losing it. Other sides only
  put the nearest man on it briefly (1.5s) if it was lost in the opposition half; the rest drop
  off into their block.
- Forwards' runs are timed to the passer (see README, "What the stats do").

### Next

- **Circulation and switches.** The AI carrier should value switching play after the block has
  shifted, and recycling to the centre-backs when nothing is on.
- **Third-man runs and cut-backs.** Patterns: lay-off then a run beyond; full-back to the byline,
  cut-back to the edge of the six-yard box or penalty spot.
- **Overlaps on demand.** When the winger receives wide, the full-back overlaps; when he comes
  inside, the full-back holds the width.
- **Pinning varies by the opponent.** Against a high press the opposite applies: build-up shapes
  (a back three with the keeper, a dropping six) to play through or long over it.

## 2. Defending

### Blocks

- **Low block.** Back line on the edge of the box, very compact (short distances between the
  lines and across), conceding the wide areas and crosses. Press only near the box. Wingers drop
  into midfield to make a 4-5 or 5-4.
- **Mid block.** Back line ~30-35m from goal. It does not press high: it waits around halfway
  and presses on triggers in midfield (a bad touch, a pass to the touchline, a back pass),
  cutting passing lanes into the striker.
- **High press.** Pressing in the opponent's half, forwards curving their runs to cut off passing
  lanes (cover shadows), and a high defensive line to keep the team compact, which leaves space
  in behind.

### In the game (current)

- `AI.BLOCKS` sets the back-line depth, the distance between the lines, width, the shift towards the ball,
  the press zone and the number of pressers per block. Press triggers (back to goal, on the
  touchline, a back pass) add a presser. The mid block presses only from about halfway
  (`pressZone` 0.52). Block widths are wider than on a real pitch because ours is narrower
  (50 m), so there's room between the lines and for the striker.
- High press: while the opponent builds from the back, a midfielder screens their holding
  midfielder (touch-tight, in the passing lane), so the easy pass into him is taken away.
- Forwards drop back to help or stay high for the counter (a tactic).
- Counter-press after losing it (high-press teams always, everyone when it's lost high up).
- Recovery: players behind the ball sprint back; the line retreats after a turnover in your half.

### Next

- **Block shapes per formation** (4-4-2 block, 5-4-1 with wing-backs dropping).
- **Pressing traps**: let the ball go to the touchline, then press with three.
- **Pinned in their box** (TODO.md): very deep teams protecting a lead.

## 3. Transitions

- **Attack → defence.** Counter-press (first 3-5 seconds) or retreat into the block; rest defence
  delays the counter. Fouls to stop counters ("tactical fouls") are common in reality; the game
  has fouls, but the AI doesn't choose them deliberately yet.
- **Defence → attack.** After winning the ball, the first pass forward into space (the counter),
  or keeping it if the counter isn't on. Runners go before the ball is won when the team expects
  to win it.

## Sources

- [How to Break Down a "Park the Bus" Low Block: 3 Tactical Patterns (iCoachFootball)](https://www.icoachfootball.net/how-to-break-down-a-park-the-bus-low-block-3-tactical-patterns/)
- [How to Break a Low (5-4-1) Block with (Guardiola's) Positional Play (Spielverlagerung)](https://spielverlagerung.com/2018/08/10/how-to-break-a-low-5-4-1-block-with-guardiolas-positional-play/)
- [Breaking Down a Low-Block: Core Principles and Tactical Solutions (The Football Analyst)](https://the-footballanalyst.com/?p=11290)
- [How to beat a low-block like Antonio Conte's Spurs (The Mastermind)](https://themastermindsite.com/2022/01/02/how-to-beat-a-low-block-like-antonio-contes-spurs/)
- [Low block football: what it is, why it works and how to break it (PFSA)](https://thepfsa.co.uk/low-block-football-what-it-is-why-it-works-and-how-to-break-it/)
- [Rest Defence: The Hidden Structure Behind Modern Attacking Football (Sportplan)](https://www.sportplan.net/drills/Football/trends/rest-defence-structure-attacking-2025-05.jsp)
- [Rest defence explained (Coaches' Voice)](https://learning.coachesvoice.com/?p=71763)
- [Counter-pressing and the gegenpress: football tactics explained (Premier League)](https://www.premierleague.com/news/4244321)
- [Adapting rest defence (Elite Soccer Coaching)](https://elitesoccercoaching.net/in-possession/counter-attacking/adapting-rest-defence)
