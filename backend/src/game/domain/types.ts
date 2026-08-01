export type PlayerId = string;

export type TurnPhase = 'draw-or-pick' | 'meld' | 'discard';

export type TableStatus = 'waiting' | 'playing' | 'finished';

export type CardSuit = 'clubs' | 'diamonds' | 'hearts' | 'spades' | 'joker';

export interface GameCard {
  id: string;
  rank: number;
  suit: CardSuit;
  label: string;
  isJoker: boolean;
  isPinella: boolean;
}

export type MeldType = 'set' | 'run';

export interface Meld {
  id: string;
  type: MeldType;
  ownerPlayerId: PlayerId;
  cards: GameCard[];
  wildcardAssignments?: Record<string, CardSuit>;
}

export interface GamePlayer {
  playerId: PlayerId;
  seat: number;
  teammateSeat: number;
  isBot: boolean;
  hand: GameCard[];
  opened: boolean;
}

export interface GameState {
  tableId: string;
  handNumber: number;
  started: boolean;
  finished: boolean;
  winnerPlayerId: PlayerId | null;
  turnPlayerId: PlayerId;
  phase: TurnPhase;
  turnDrawnCardIds: string[];
  turnMustUseDiscardPickCardId: string | null;
  lastMove: GameMove | null;
  stock: GameCard[];
  discardPile: GameCard[];
  melds: Meld[];
  players: GamePlayer[];
}

export interface GameMove {
  playerId: PlayerId;
  kind: 'draw-stock' | 'pick-discard' | 'play-meld' | 'attach-meld' | 'end-meld' | 'discard';
  cardIds: string[];
}

export interface LobbyPlayer {
  playerId: PlayerId;
  displayName: string;
  seat: number;
  isBot: boolean;
}

export interface TableState {
  tableId: string;
  status: TableStatus;
  ownerPlayerId: PlayerId | null;
  targetPlayers: number;
  players: LobbyPlayer[];
  game: GameState | null;
  tableScores: Record<PlayerId, number>;
  completedHands: number;
}

export type GameCommandType =
  | 'draw-from-stock'
  | 'pick-discard-pile'
  | 'play-meld'
  | 'attach-to-meld'
  | 'end-meld'
  | 'discard-card';

export interface GameCommand {
  type: GameCommandType;
  playerId: PlayerId;
  payload?: {
    cardIds?: string[];
    discardCardId?: string;
    discardPickCardId?: string;
    meldId?: string;
  };
}
