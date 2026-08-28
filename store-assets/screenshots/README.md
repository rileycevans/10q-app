# Store screenshots

Captured from the iPhone 17 Pro Max simulator at 1320x2868, which Apple
accepts for the 6.9" display slot (as does 1290x2796).

Status bar overridden to Apple's canonical marketing values before capture:

    xcrun simctl status_bar <udid> override --time "9:41" \
      --batteryState charged --batteryLevel 100 \
      --cellularMode active --cellularBars 4 --wifiBars 3

## Usable now

| File | Shows |
|---|---|
| `01-home.png` | Logo, tagline, the three primary actions, the dock |
| `02-quiz.png` | A live question with the 12s timer mid-countdown — the tension |
| `03-result.png` | Score, correct count, total time, the shareable grid |
| `04-breakdown.png` | Per-question review with the correct answer and points |

Apple requires at least 3; these four satisfy that.

## Not captured, and why

**Leaderboard** and **Leagues** were reached but are not presentable from this
account: the leaderboard held two players with truncated handles, and Leagues
showed its empty state. Both need an account with real data behind it —
capture them from a device signed in to an account that has leagues and
several days of play.

Both are also affected by the AuthButton bug noted in the repo (see the
commit that added this file): the floating Sign In control overlaps the
status bar on these two screens.
