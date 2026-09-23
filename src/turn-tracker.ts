/**
 * Per-session turn state: the agent name for the active turn, the active turn's
 * per-turn delta accumulator (for the per-turn soft/hard threshold), and a ring
 * buffer of CUMULATIVE context sizes at each completed turn boundary (for the
 * context-growth slope alarm).
 *
 * Turn boundaries arrive via the `chat.message` hook (a new user message); token
 * accumulation arrives via the `event` hook (`message.part.updated`).
 */

const MAX_HISTORY = 50;

interface TurnState {
  agent: string | null;
  /** Per-turn delta accumulator (assistant output tokens for the active turn). */
  currentTurn: number;
  /** CUMULATIVE context size at each completed turn boundary (oldest → newest). */
  history: number[];
  /** Monotonic count of turns begun — never resets with the history cap. */
  turnCount: number;
}

export class TurnTracker {
  private map = new Map<string, TurnState>();

  private state(sessionID: string): TurnState {
    let s = this.map.get(sessionID);
    if (!s) {
      s = { agent: null, currentTurn: 0, history: [], turnCount: 0 };
      this.map.set(sessionID, s);
    }
    return s;
  }

  /** Add tokens to the active turn's per-turn delta. Returns the new delta. */
  addTokens(sessionID: string, tokens: number): number {
    const s = this.state(sessionID);
    s.currentTurn += tokens;
    return s.currentTurn;
  }

  getCurrentTurn(sessionID: string): number {
    return this.state(sessionID).currentTurn;
  }

  /**
   * Turn boundary. Finalizes the previous turn's CUMULATIVE context size into the
   * slope history, then starts a new turn with the given agent (resetting the
   * per-turn delta). Returns the agent of the previous turn (for slope-alarm
   * attribution), or null on the first turn.
   */
  beginTurn(sessionID: string, agent: string | null, cumulative: number): string | null {
    const s = this.state(sessionID);
    const previousAgent = s.agent;

    if (s.turnCount > 0) {
      s.history.push(cumulative);
      if (s.history.length > MAX_HISTORY) {
        s.history.splice(0, s.history.length - MAX_HISTORY);
      }
    }

    s.turnCount++;
    s.agent = agent;
    s.currentTurn = 0;
    return previousAgent;
  }

  getAgent(sessionID: string): string | null {
    return this.state(sessionID).agent;
  }

  /** 1-based number of the active turn (monotonic, unaffected by the history cap). */
  getTurnNumber(sessionID: string): number {
    return Math.max(1, this.state(sessionID).turnCount);
  }

  /** Copy of the cumulative context-size history (oldest → newest). */
  getHistory(sessionID: string): number[] {
    return [...this.state(sessionID).history];
  }
}
