export type Suit = 'clubs' | 'diamonds' | 'hearts' | 'spades';

export type Rank =
  | 'A'
  | 'K'
  | 'Q'
  | 'J'
  | '10'
  | '9'
  | '8'
  | '7'
  | '6'
  | '5'
  | '4'
  | '3'
  | '2';

export type SpecialCardKind = 'joker' | 'pinella';

export interface Card {
  id: string;
  rank: Rank;
  suit: Suit;
  special?: SpecialCardKind;
}

export interface PlayerState {
  playerId: string;
  handCount: number;
  opened: boolean;
}

export type TurnPhase = 'draw-or-pick' | 'meld' | 'discard';

export interface GameStateView {
  tableId: string;
  handNumber: number;
  turnPlayerId: string;
  phase: TurnPhase;
  discardTop: Card | null;
  stockCount: number;
  players: PlayerState[];
}
