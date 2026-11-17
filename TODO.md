# TODO — bigger ideas for later

Things that need design work before they can be built well.

## Versions
- **alpha v0.1** (tag `v0.1`): 11v11 full court, season mode with EPL clubs and the Champions
  League, mouse/keyboard and touch controls.
- **alpha v0.2** (in progress), goal: much smoother, more interesting gameplay. Started with play
  through the middle: a link midfielder shows in the pocket between their lines, the striker
  sometimes comes short, and midfield pressers jockey instead of diving in (`PP.debug.hold()`
  measures it).
- Player stats: done (Stats screen in the season hub). Later: a transfer market (below).
- v0.2 candidates: far too many fouls (~11 free kicks per 3-minute half in AI-vs-AI sims, same in
  v0.1).

## Hard (big, worth doing properly)

- **Dribbling.** Cuts with defender momentum (a sharp change of direction leaves a committed
  defender going the wrong way), push past / knock-on (kick it beyond the man and race him),
  shielding with your back to him, close control at walking pace.
- **Target man against a low block.** Low-block sides often leave one striker high on the last
  line: he holds the ball up (back to goal, wins it from the clearance, lays off to the runners
  arriving) or spins the centre-back for a ball in behind. Needs: who stays up (the low block's
  ST), hold-up with the back to goal, the lay-off, and the CBs having to decide whether to follow.
- **Playable penalty shootouts** (knockout ties level after extra time are simulated today).

## Player stats (done: season totals, top scorers / assists, the Stats screen)
Next: keepers' saves, match ratings / player of the match, past seasons' records, and form
feeding the transfer market's values.

## Transfer market
Buy and sell players with coins: valuations from rating, age and season stats; AI clubs
buying and selling; squad size limits.

## Pinned low block / "break them down" phases
A phase of play to aim for: the opponent is pinned deep in a very low, compact block and the
challenge becomes breaking them down (patient circulation, switching play, third-man runs,
cut-backs, shots from the edge when they won't come out).

Open questions:
- How it should arise naturally rather than being forced: e.g. a team that's protecting a lead,
  is much weaker, or whose style is "park the bus" drops deeper the longer you keep the ball
  near their box; tiredness/fatigue pulling the block deeper late in matches.
- AI needs: the defending block holds a line on the edge of the box, compresses centrally and
  only steps out to block shots; attackers need patterns to probe it (overlaps, rotations,
  recycling to the back and switching).
- A dedicated half-court scenario for it (start with the opposition already pinned).

## Off-ball runs when attacking
Runs that create passing options: runs in behind when the carrier can play forward, blindside
runs off the last defender's shoulder, overlaps/underlaps from full-backs, third-man runs after a
lay-off, checking short to receive, and timing runs so the runner stays onside at the pass. Needs
the AI to read the carrier's situation (facing forward, time on the ball) and the defensive line.

## Coherent team movement
Teams should move as units through phases (attacking structure, rest defence, counter-press,
recovery runs). Today it's per-player targets from a shared shape; a more explicit team-level
plan (e.g. phase-of-play states with roles per state) would make movement more coherent.

## Stage 4: season (league, table, coins, fans, board done)
Done: league, table, coins, fans, board, squad screen with formations/bench/tactics, Champions
League. Still to do: something to spend coins on (transfers, player upgrades/training), economy
tuning once there are costs, in-match substitutions, playable penalty shootouts.

## Narratives
A storylines layer that reads the season and generates small arcs with choices between rounds:
rivalries that remember past results, board season objectives, "manager under pressure" and
"title charge" arcs, player arcs (contract demands, a youngster breaking through, a veteran's last
season). Choices nudge fans, board, morale and coins.
