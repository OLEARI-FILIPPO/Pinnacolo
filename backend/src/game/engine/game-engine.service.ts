import { randomInt, randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { GameCard, GameCommand, GameState, Meld, PlayerId } from '../domain/types';

@Injectable()
export class GameEngineService {
  createInitialState(
    tableId: string,
    players: Array<PlayerId | { playerId: PlayerId; isBot: boolean }>,
    options?: { startingPlayerId?: PlayerId },
  ): GameState {
    if (players.length < 2 || players.length > 4) {
      throw new Error('A table needs between 2 and 4 players to start');
    }

    const normalizedPlayers = players.map((entry, index) =>
      typeof entry === 'string'
        ? {
            playerId: entry,
            isBot: false,
          }
        : entry,
    );
    const playersCount = normalizedPlayers.length;
    const selectedStarter = options?.startingPlayerId;
    const hasSelectedStarter = Boolean(selectedStarter && normalizedPlayers.some((entry) => entry.playerId === selectedStarter));

    const stock = this.createShuffledDeck();
    const dealtHands: GameCard[][] = Array.from({ length: playersCount }, () => []);

    const cardsToDeal = stock.splice(0, 19 * playersCount);
    for (let i = 0; i < cardsToDeal.length; i += 1) {
      dealtHands[i % playersCount]?.push(cardsToDeal[i]);
    }

    const firstDiscard = stock.shift();
    if (!firstDiscard) {
      throw new Error('Deck setup failed');
    }

    return {
      tableId,
      handNumber: 1,
      started: true,
      finished: false,
      winnerPlayerId: null,
      turnPlayerId: hasSelectedStarter ? selectedStarter! : (normalizedPlayers[0]?.playerId ?? 'player-1'),
      phase: 'draw-or-pick',
      turnDrawnCardIds: [],
      turnMustUseDiscardPickCardId: null,
      lastMove: null,
      stock,
      discardPile: [firstDiscard],
      melds: [],
      players: normalizedPlayers.map((player, seat) => ({
        playerId: player.playerId,
        seat,
        teammateSeat: (seat + Math.floor(playersCount / 2)) % playersCount,
        isBot: player.isBot,
        hand: dealtHands[seat] ?? [],
        opened: false,
      })),
    };
  }

  applyCommand(state: GameState, command: GameCommand): GameState {
    if (state.finished) {
      throw new Error('Hand is already finished');
    }

    if (state.turnPlayerId !== command.playerId) {
      throw new Error('Not your turn');
    }

    if (command.type === 'draw-from-stock') {
      return this.drawFromStock(state, command.playerId);
    }

    if (command.type === 'pick-discard-pile') {
      return this.pickDiscardPile(state, command.playerId, command.payload?.discardPickCardId);
    }

    if (command.type === 'play-meld' || command.type === 'attach-to-meld') {
      if (state.phase !== 'meld') {
        throw new Error('You can play or attach only during meld phase');
      }

      if (command.type === 'play-meld') {
        return this.playMeld(state, command.playerId, command.payload?.cardIds ?? []);
      }

      return this.attachToMeld(state, command.playerId, command.payload?.meldId, command.payload?.cardIds ?? []);
    }

    if (command.type === 'end-meld') {
      if (state.phase !== 'meld') {
        throw new Error('Cannot end meld outside meld phase');
      }

      return {
        ...state,
        phase: 'discard',
        lastMove: {
          playerId: command.playerId,
          kind: 'end-meld',
          cardIds: [],
        },
      };
    }

    if (command.type === 'discard-card') {
      return this.discardCard(state, command.playerId, command.payload?.discardCardId);
    }

    throw new Error('Unsupported command');
  }

  private drawFromStock(state: GameState, playerId: PlayerId): GameState {
    if (state.phase !== 'draw-or-pick') {
      throw new Error('Cannot draw in this phase');
    }

    if (state.stock.length <= 0) {
      throw new Error('Stock is empty');
    }

    const drawn = state.stock[0];
    const restStock = state.stock.slice(1);

    return {
      ...state,
      turnDrawnCardIds: [drawn.id],
      turnMustUseDiscardPickCardId: null,
      lastMove: {
        playerId,
        kind: 'draw-stock',
        cardIds: [drawn.id],
      },
      stock: restStock,
      players: state.players.map((player) =>
        player.playerId === playerId
          ? {
              ...player,
              hand: [...player.hand, drawn],
            }
          : player,
      ),
      phase: 'meld',
    };
  }

  private pickDiscardPile(state: GameState, playerId: PlayerId, discardPickCardId?: string): GameState {
    if (state.phase !== 'draw-or-pick') {
      throw new Error('Cannot pick discard pile in this phase');
    }

    if (state.discardPile.length <= 0) {
      throw new Error('Discard pile is empty');
    }

    const selectedIndex = discardPickCardId
      ? state.discardPile.findIndex((card) => card.id === discardPickCardId)
      : state.discardPile.length - 1;

    if (selectedIndex < 0) {
      throw new Error('Selected discard card is not available');
    }

    const player = state.players.find((entry) => entry.playerId === playerId);
    if (!player) {
      throw new Error('Player not found');
    }

    const pickedCards = state.discardPile.slice(selectedIndex);
    if (player.hand.length === 1 && pickedCards.length < 2) {
      throw new Error('Con una sola carta in mano devi prendere almeno 2 carte dal pozzo');
    }

    const selectedCard = pickedCards[0];
    const handAfterPick = [...player.hand, ...pickedCards];
    if (
      !player.isBot &&
      selectedCard &&
      !this.canUseCardInAnyCombination(state, playerId, handAfterPick, selectedCard)
    ) {
      throw new Error('Non puoi prendere questa carta dal pozzo: non hai combinazioni valide che la usano');
    }

    const remainingDiscardPile = state.discardPile.slice(0, selectedIndex);

    return {
      ...state,
      turnDrawnCardIds: pickedCards.map((card) => card.id),
      turnMustUseDiscardPickCardId: selectedCard?.id ?? null,
      lastMove: {
        playerId,
        kind: 'pick-discard',
        cardIds: pickedCards.map((card) => card.id),
      },
      discardPile: remainingDiscardPile,
      players: state.players.map((player) =>
        player.playerId === playerId
          ? {
              ...player,
              hand: [...player.hand, ...pickedCards],
            }
          : player,
      ),
      phase: 'meld',
    };
  }

  private playMeld(state: GameState, playerId: PlayerId, cardIds: string[]): GameState {
    if (cardIds.length < 3) {
      throw new Error('A meld needs at least 3 cards');
    }

    const player = state.players.find((entry) => entry.playerId === playerId);
    if (!player) {
      throw new Error('Player not found');
    }

    this.ensureDiscardPickCardIsUsedInAction(state, player, cardIds);

    const selectedCards = this.getCardsById(player.hand, cardIds);
    const resolvedMeld = this.resolveMeld(selectedCards);
    if (!resolvedMeld) {
      throw new Error('Combinazione non valida: crea un tris/poker o una scala. Pinella/Jolly possono coprire carte mancanti.');
    }

    const selectedSet = new Set(selectedCards.map((card) => card.id));
    const nextHand = player.hand.filter((card) => !selectedSet.has(card.id));
    const nextMeld: Meld = {
      id: `meld-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      type: resolvedMeld.type,
      ownerPlayerId: playerId,
      cards: resolvedMeld.orderedCards,
      wildcardAssignments: resolvedMeld.wildcardAssignments,
    };

    return {
      ...state,
      turnMustUseDiscardPickCardId: cardIds.includes(state.turnMustUseDiscardPickCardId ?? '')
        ? null
        : state.turnMustUseDiscardPickCardId,
      lastMove: {
        playerId,
        kind: 'play-meld',
        cardIds: selectedCards.map((card) => card.id),
      },
      melds: [...state.melds, nextMeld],
      players: state.players.map((entry) =>
        entry.playerId === playerId
          ? {
              ...entry,
              hand: nextHand,
              opened: true,
            }
          : entry,
      ),
    };
  }

  private attachToMeld(state: GameState, playerId: PlayerId, meldId: string | undefined, cardIds: string[]): GameState {
    if (!meldId) {
      throw new Error('Seleziona una combinazione a terra a cui aggiungere le carte');
    }

    if (cardIds.length < 1) {
      throw new Error('Seleziona almeno una carta da aggiungere');
    }

    const player = state.players.find((entry) => entry.playerId === playerId);
    if (!player) {
      throw new Error('Player not found');
    }

    this.ensureDiscardPickCardIsUsedInAction(state, player, cardIds);

    const meld = state.melds.find((entry) => entry.id === meldId);
    if (!meld) {
      throw new Error('Combinazione target non trovata');
    }

    const selectedCards = this.getCardsById(player.hand, cardIds);
    const wildcardsTaken: GameCard[] = [];
    let nextMeldCards = [...meld.cards];
    let nextWildcardAssignments = meld.wildcardAssignments;
    let remainingToAttach = [...selectedCards];

    if (meld.ownerPlayerId !== playerId) {
      if (selectedCards.length !== 1) {
        throw new Error('Sulle combinazioni avversarie puoi sostituire solo una matta/pinella alla volta');
      }

      const replacement = selectedCards[0];
      if (replacement.isJoker || replacement.isPinella) {
        throw new Error('Non puoi sostituire una matta/pinella con un altra matta/pinella');
      }

      const replaceIndex = this.findReplaceableWildcardIndex(meld.type, nextMeldCards, replacement, nextWildcardAssignments);
      if (replaceIndex < 0) {
        throw new Error('Puoi intervenire sugli avversari solo sostituendo una matta/pinella presente');
      }

      const [removedWildcard] = nextMeldCards.splice(replaceIndex, 1, replacement);
      if (!removedWildcard) {
        throw new Error('Sostituzione matta/pinella non valida');
      }

      if (nextWildcardAssignments?.[removedWildcard.id]) {
        const copy = { ...nextWildcardAssignments };
        delete copy[removedWildcard.id];
        nextWildcardAssignments = Object.keys(copy).length > 0 ? copy : undefined;
      }

      const validated = this.resolveMeld(nextMeldCards);
      if (!validated) {
        throw new Error('Non puoi sostituire la matta/pinella con questa carta');
      }

      nextMeldCards = validated.orderedCards;
      nextWildcardAssignments = validated.wildcardAssignments;

      const nextHand = [...player.hand.filter((card) => card.id !== replacement.id), removedWildcard];
      return {
        ...state,
        turnMustUseDiscardPickCardId: cardIds.includes(state.turnMustUseDiscardPickCardId ?? '')
          ? null
          : state.turnMustUseDiscardPickCardId,
        lastMove: {
          playerId,
          kind: 'attach-meld',
          cardIds: [replacement.id, removedWildcard.id],
        },
        melds: state.melds.map((entry) =>
          entry.id === meld.id
            ? {
                ...entry,
                cards: nextMeldCards,
                wildcardAssignments: nextWildcardAssignments,
              }
            : entry,
        ),
        players: state.players.map((entry) =>
          entry.playerId === playerId
            ? {
                ...entry,
                hand: nextHand,
              }
            : entry,
        ),
      };
    }

    for (const card of selectedCards) {
      if (card.isJoker || card.isPinella) {
        continue;
      }

      const replaceIndex = this.findReplaceableWildcardIndex(meld.type, nextMeldCards, card, nextWildcardAssignments);
      if (replaceIndex < 0) {
        continue;
      }

      const [removedWildcard] = nextMeldCards.splice(replaceIndex, 1, card);
      if (removedWildcard) {
        wildcardsTaken.push(removedWildcard);
        if (nextWildcardAssignments?.[removedWildcard.id]) {
          const copy = { ...nextWildcardAssignments };
          delete copy[removedWildcard.id];
          nextWildcardAssignments = Object.keys(copy).length > 0 ? copy : undefined;
        }
      }

      remainingToAttach = remainingToAttach.filter((entry) => entry.id !== card.id);
    }

    if (remainingToAttach.length > 0) {
      const resolvedWithAttachments = this.resolveMeld([...nextMeldCards, ...remainingToAttach]);
      if (!resolvedWithAttachments) {
        throw new Error('Non puoi aggiungere queste carte alla combinazione selezionata');
      }

      nextMeldCards = resolvedWithAttachments.orderedCards;
      nextWildcardAssignments = resolvedWithAttachments.wildcardAssignments;
    } else {
      const validated = this.resolveMeld(nextMeldCards);
      if (!validated) {
        throw new Error('Non puoi sostituire il Jolly/Pinella con questa carta');
      }

      nextMeldCards = validated.orderedCards;
      nextWildcardAssignments = validated.wildcardAssignments;
    }

    const selectedSet = new Set(selectedCards.map((card) => card.id));
    const nextHand = [...player.hand.filter((card) => !selectedSet.has(card.id)), ...wildcardsTaken];

    return {
      ...state,
      turnMustUseDiscardPickCardId: cardIds.includes(state.turnMustUseDiscardPickCardId ?? '')
        ? null
        : state.turnMustUseDiscardPickCardId,
      lastMove: {
        playerId,
        kind: 'attach-meld',
        cardIds: [...selectedCards.map((card) => card.id), ...wildcardsTaken.map((card) => card.id)],
      },
      melds: state.melds.map((entry) =>
        entry.id === meld.id
          ? {
              ...entry,
              cards: nextMeldCards,
              wildcardAssignments: nextWildcardAssignments,
            }
          : entry,
      ),
      players: state.players.map((entry) =>
        entry.playerId === playerId
          ? {
              ...entry,
              hand: nextHand,
            }
          : entry,
      ),
    };
  }

  private discardCard(state: GameState, playerId: PlayerId, discardCardId?: string): GameState {
    if (state.phase !== 'meld' && state.phase !== 'discard') {
      throw new Error('Discard is allowed only after draw/pick');
    }

    const currentPlayer = state.players.find((player) => player.playerId === playerId);
    if (!currentPlayer) {
      throw new Error('Player not found');
    }

    const requiredDiscardPickCardId = state.turnMustUseDiscardPickCardId;
    if (requiredDiscardPickCardId && currentPlayer.hand.some((card) => card.id === requiredDiscardPickCardId)) {
      throw new Error('Devi usare la carta scelta dal pozzo prima di scartare');
    }

    if (currentPlayer.hand.length <= 0) {
      throw new Error('No cards to discard');
    }

    const cardToDiscard = discardCardId
      ? currentPlayer.hand.find((card) => card.id === discardCardId)
      : this.chooseDiscardCard(currentPlayer.hand);

    if (!cardToDiscard) {
      throw new Error('Discard card is not in hand');
    }

    if (cardToDiscard.isJoker || cardToDiscard.isPinella) {
      throw new Error('You cannot discard Joker or Pinella');
    }

    const nextPlayers = state.players.map((player) =>
      player.playerId === playerId
        ? {
            ...player,
            hand: player.hand.filter((card) => card.id !== cardToDiscard.id),
          }
        : player,
    );

    const updatedPlayer = nextPlayers.find((player) => player.playerId === playerId);
    const hasClosedHand = (updatedPlayer?.hand.length ?? 1) === 0;

    if (hasClosedHand) {
      return {
        ...state,
        turnDrawnCardIds: [],
        turnMustUseDiscardPickCardId: null,
        lastMove: {
          playerId,
          kind: 'discard',
          cardIds: [cardToDiscard.id],
        },
        players: nextPlayers,
        discardPile: [...state.discardPile, cardToDiscard],
        finished: true,
        winnerPlayerId: playerId,
      };
    }

    const currentSeat = currentPlayer.seat;
    const nextSeat = (currentSeat + 1) % state.players.length;
    const nextPlayer = nextPlayers.find((player) => player.seat === nextSeat);

    if (!nextPlayer) {
      throw new Error('Next player not found');
    }

    return {
      ...state,
      turnDrawnCardIds: [],
      turnMustUseDiscardPickCardId: null,
      lastMove: {
        playerId,
        kind: 'discard',
        cardIds: [cardToDiscard.id],
      },
      players: nextPlayers,
      discardPile: [...state.discardPile, cardToDiscard],
      turnPlayerId: nextPlayer.playerId,
      phase: 'draw-or-pick',
    };
  }

  private canUseCardInAnyCombination(state: GameState, playerId: PlayerId, hand: GameCard[], requiredCard: GameCard) {
    const others = hand.filter((card) => card.id !== requiredCard.id);

    for (let i = 0; i < others.length; i += 1) {
      for (let j = i + 1; j < others.length; j += 1) {
        const candidate = [requiredCard, others[i], others[j]];
        if (this.resolveMeld(candidate)) {
          return true;
        }
      }
    }

    for (const meld of state.melds) {
      if (this.canAttachCardsToMeld(meld, [requiredCard])) {
        return true;
      }

      for (let i = 0; i < others.length; i += 1) {
        if (this.canAttachCardsToMeld(meld, [requiredCard, others[i]])) {
          return true;
        }
      }
    }

    return false;
  }

  private canAttachCardsToMeld(meld: Meld, cardsToAttach: GameCard[]) {
    let nextMeldCards = [...meld.cards];
    let nextWildcardAssignments = meld.wildcardAssignments;

    for (const card of cardsToAttach) {
      const replaceIndex = this.findReplaceableWildcardIndex(meld.type, nextMeldCards, card, nextWildcardAssignments);
      if (replaceIndex >= 0) {
        const removedWildcard = nextMeldCards[replaceIndex];
        nextMeldCards = [
          ...nextMeldCards.slice(0, replaceIndex),
          card,
          ...nextMeldCards.slice(replaceIndex + 1),
        ];

        if (removedWildcard && nextWildcardAssignments?.[removedWildcard.id]) {
          const copy = { ...nextWildcardAssignments };
          delete copy[removedWildcard.id];
          nextWildcardAssignments = Object.keys(copy).length > 0 ? copy : undefined;
        }
      } else {
        nextMeldCards = [...nextMeldCards, card];
      }
    }

    if (meld.type === 'set') {
      return Boolean(this.resolveSet(nextMeldCards));
    }

    const resolved = this.resolveMeld(nextMeldCards);
    return Boolean(resolved && resolved.type === meld.type);
  }

  private ensureDiscardPickCardIsUsedInAction(state: GameState, player: { hand: GameCard[] }, cardIds: string[]) {
    const requiredDiscardPickCardId = state.turnMustUseDiscardPickCardId;
    if (!requiredDiscardPickCardId) {
      return;
    }

    const requiredIsInHand = player.hand.some((card) => card.id === requiredDiscardPickCardId);
    if (!requiredIsInHand) {
      return;
    }

    if (!cardIds.includes(requiredDiscardPickCardId)) {
      throw new Error('Devi usare la carta scelta dal pozzo nella combinazione prima di poter usare altre carte');
    }
  }

  applyBotTurn(state: GameState): GameState {
    const activePlayer = state.players.find((player) => player.playerId === state.turnPlayerId);
    if (!activePlayer || !activePlayer.isBot || state.finished) {
      return state;
    }

    let nextState: GameState;
    if (state.stock.length > 0) {
      nextState = this.drawFromStock(state, activePlayer.playerId);
    } else if (state.discardPile.length > 0) {
      const discardPickCardId =
        activePlayer.hand.length === 1 && state.discardPile.length >= 2
          ? state.discardPile[state.discardPile.length - 2]?.id
          : undefined;
      nextState = this.pickDiscardPile(state, activePlayer.playerId, discardPickCardId);
    } else {
      return {
        ...state,
        finished: true,
        winnerPlayerId: activePlayer.playerId,
      };
    }
    for (let i = 0; i < 2; i += 1) {
      const botPlayer = nextState.players.find((player) => player.playerId === activePlayer.playerId);
      if (!botPlayer) {
        break;
      }

      const meldCardIds = this.findFirstMeld(botPlayer.hand);
      if (!meldCardIds) {
        break;
      }

      nextState = this.playMeld(nextState, activePlayer.playerId, meldCardIds);
    }

    nextState = {
      ...nextState,
      phase: 'discard',
    };

    return this.discardCard(nextState, activePlayer.playerId);
  }

  private chooseDiscardCard(hand: GameCard[]): GameCard | undefined {
    const candidate = hand.find((card) => !card.isJoker && !card.isPinella);
    return candidate ?? hand[hand.length - 1];
  }

  private getCardsById(hand: GameCard[], cardIds: string[]): GameCard[] {
    const handById = new Map(hand.map((card) => [card.id, card]));
    const selected = cardIds.map((id) => handById.get(id)).filter((card): card is GameCard => Boolean(card));

    if (selected.length !== cardIds.length) {
      throw new Error('One or more cards are not in hand');
    }

    return selected;
  }

  private resolveMeld(cards: GameCard[]): {
    type: 'set' | 'run';
    orderedCards: GameCard[];
    wildcardAssignments?: Record<string, GameCard['suit']>;
  } | null {
    const asSet = this.resolveSet(cards);
    if (asSet) {
      return asSet;
    }

    const asRun = this.resolveRun(cards);
    if (asRun) {
      return asRun;
    }

    return null;
  }

  private resolveSet(cards: GameCard[]): {
    type: 'set';
    orderedCards: GameCard[];
    wildcardAssignments?: Record<string, GameCard['suit']>;
  } | null {
    if (cards.length < 3 || cards.length > 4) {
      return null;
    }

    const wildcards = cards.filter((card) => card.isPinella || card.isJoker);
    const naturals = cards.filter((card) => !card.isPinella && !card.isJoker);
    if (naturals.length === 0) {
      return null;
    }

    const firstRank = naturals[0].rank;
    if (!naturals.every((card) => card.rank === firstRank)) {
      return null;
    }

    const uniqueSuits = new Set(naturals.map((card) => card.suit));
    if (uniqueSuits.size !== naturals.length) {
      return null;
    }

    return {
      type: 'set',
      orderedCards: [...cards],
      wildcardAssignments: this.resolveSetWildcardAssignments(cards),
    };
  }

  private resolveRun(cards: GameCard[]): { type: 'run'; orderedCards: GameCard[] } | null {
    if (cards.length < 3) {
      return null;
    }

    const wildcards = cards.filter((card) => card.isPinella || card.isJoker);
    const naturals = cards.filter((card) => !card.isPinella && !card.isJoker);
    if (naturals.length === 0) {
      return null;
    }

    const sameSuit = naturals.every((card) => card.suit === naturals[0].suit);
    if (!sameSuit) {
      return null;
    }

    const naturalsByRank = new Map<number, GameCard[]>();
    for (const card of naturals) {
      const current = naturalsByRank.get(card.rank) ?? [];
      current.push(card);
      naturalsByRank.set(card.rank, current);

      if (card.rank !== 1 && current.length > 1) {
        return null;
      }
      if (card.rank === 1 && current.length > 2) {
        return null;
      }
    }

    const totalCards = cards.length;
    const wildcardCount = wildcards.length;
    const cycle = this.getRunCycleForSuit(naturals[0].suit);
    const windows = this.buildRunWindows(cycle, totalCards);
    const preferredOrder = cards.map((card) => card.id);
    let bestCandidate: GameCard[] | null = null;
    let bestScore = -1;

    for (const window of windows) {
      const requiredByRank = new Map<number, number>();
      for (const rank of window) {
        requiredByRank.set(rank, (requiredByRank.get(rank) ?? 0) + 1);
      }

      let missing = 0;
      let impossible = false;
      for (const [rank, requiredCount] of requiredByRank) {
        const naturalCount = naturalsByRank.get(rank)?.length ?? 0;
        if (naturalCount > requiredCount) {
          impossible = true;
          break;
        }

        const rankMissing = requiredCount - naturalCount;
        missing += rankMissing;
      }

      if (impossible || missing !== wildcardCount) {
        continue;
      }

      const naturalsQueue = new Map<number, GameCard[]>();
      for (const [rank, items] of naturalsByRank) {
        naturalsQueue.set(rank, [...items]);
      }

      const wildQueue = [...wildcards];
      const ascending: GameCard[] = [];

      for (const rank of window) {
        const queue = naturalsQueue.get(rank);
        if (queue && queue.length > 0) {
          const nextNatural = queue.shift();
          if (nextNatural) {
            ascending.push(nextNatural);
            continue;
          }
        }

        const wildcard = wildQueue.shift();
        if (!wildcard) {
          impossible = true;
          break;
        }

        ascending.push(wildcard);
      }

      if (impossible) {
        continue;
      }

      const orderedCards = ascending.reverse();
      const score = this.scorePreferredOrder(preferredOrder, orderedCards);
      if (score > bestScore) {
        bestScore = score;
        bestCandidate = orderedCards;
      }
    }

    if (bestCandidate) {
      return {
        type: 'run',
        orderedCards: bestCandidate,
      };
    }

    return null;
  }

  private getRunCycleForSuit(suit: GameCard['suit']) {
    if (suit === 'clubs' || suit === 'spades') {
      return [1, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13];
    }

    return [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13];
  }

  private buildRunWindows(cycle: number[], totalCards: number) {
    const windows: number[][] = [];
    if (totalCards < 3 || totalCards > cycle.length + 1) {
      return windows;
    }

    if (totalCards <= cycle.length) {
      for (let start = 0; start < cycle.length; start += 1) {
        const window: number[] = [];
        for (let i = 0; i < totalCards; i += 1) {
          window.push(cycle[(start + i) % cycle.length]!);
        }
        windows.push(window);
      }
    }

    if (totalCards === cycle.length + 1) {
      windows.push([...cycle, cycle[0]!]);
    }

    return windows;
  }

  private scorePreferredOrder(preferredOrder: string[], orderedCards: GameCard[]) {
    const orderedIds = orderedCards.map((card) => card.id);
    let score = 0;

    for (let i = 0; i < Math.min(preferredOrder.length, orderedIds.length); i += 1) {
      if (preferredOrder[i] === orderedIds[i]) {
        score += 3;
      }
    }

    for (let i = 0; i < preferredOrder.length - 1; i += 1) {
      const firstIndex = orderedIds.indexOf(preferredOrder[i]);
      const secondIndex = orderedIds.indexOf(preferredOrder[i + 1]);
      if (firstIndex >= 0 && secondIndex >= 0 && secondIndex === firstIndex + 1) {
        score += 1;
      }
    }

    return score;
  }

  private findReplaceableWildcardIndex(
    type: Meld['type'],
    meldCards: GameCard[],
    replacementCard: GameCard,
    wildcardAssignments?: Record<string, GameCard['suit']>,
  ) {
    for (let i = 0; i < meldCards.length; i += 1) {
      const wildcard = meldCards[i];
      if (!wildcard || (!wildcard.isJoker && !wildcard.isPinella)) {
        continue;
      }

      if (type === 'set') {
        if (this.canReplaceSetWildcard(meldCards, i, replacementCard, wildcardAssignments?.[wildcard.id])) {
          return i;
        }
        continue;
      }

      if (type === 'run') {
        if (this.canReplaceRunWildcard(meldCards, i, replacementCard)) {
          return i;
        }
      }
    }

    return -1;
  }

  private canReplaceSetWildcard(
    meldCards: GameCard[],
    wildcardIndex: number,
    replacementCard: GameCard,
    assignedSuit?: GameCard['suit'],
  ) {
    if (replacementCard.isJoker || replacementCard.isPinella) {
      return false;
    }

    const naturals = meldCards.filter((card) => !card.isJoker && !card.isPinella);
    if (naturals.length === 0) {
      return false;
    }

    const targetRank = naturals[0].rank;
    if (replacementCard.rank !== targetRank) {
      return false;
    }

    const expectedSuit = assignedSuit ?? this.inferSetWildcardSuit(meldCards, wildcardIndex);
    if (!expectedSuit) {
      return false;
    }

    return replacementCard.suit === expectedSuit;
  }

  private canReplaceRunWildcard(meldCards: GameCard[], wildcardIndex: number, replacementCard: GameCard) {
    if (replacementCard.isJoker || replacementCard.isPinella) {
      return false;
    }

    const naturals = meldCards.filter((card) => !card.isJoker && !card.isPinella);
    if (naturals.length === 0) {
      return false;
    }

    if (!naturals.every((card) => card.suit === replacementCard.suit)) {
      return false;
    }

    if (naturals.some((card) => card.rank === replacementCard.rank && card.suit === replacementCard.suit)) {
      return false;
    }

    const candidate = meldCards.map((card, index) => (index === wildcardIndex ? replacementCard : card));
    return this.resolveRun(candidate) !== null;
  }

  private inferSetWildcardSuit(meldCards: GameCard[], wildcardIndex: number): GameCard['suit'] | null {
    const allSuits: Array<GameCard['suit']> = ['clubs', 'diamonds', 'hearts', 'spades'];
    const naturals = meldCards.filter((card) => !card.isJoker && !card.isPinella);
    const usedSuits = new Set(naturals.map((card) => card.suit));
    const missing = allSuits.filter((suit) => !usedSuits.has(suit));

    if (missing.length === 0) {
      return null;
    }

    if (missing.length === 1) {
      return missing[0];
    }

    const prevNatural = this.findNeighborNaturalCard(meldCards, wildcardIndex, -1);
    if (prevNatural) {
      const preferred = this.pickPreferredMissingSuit(prevNatural.suit, missing);
      if (preferred) {
        return preferred;
      }
    }

    const nextNatural = this.findNeighborNaturalCard(meldCards, wildcardIndex, 1);
    if (nextNatural) {
      const preferred = this.pickPreferredMissingSuit(nextNatural.suit, missing);
      if (preferred) {
        return preferred;
      }
    }

    const wildcard = meldCards[wildcardIndex];
    if (wildcard) {
      const preferred = this.pickPreferredMissingSuit(wildcard.suit, missing);
      if (preferred) {
        return preferred;
      }

      if (missing.includes(wildcard.suit)) {
        return wildcard.suit;
      }
    }

    return missing[0] ?? null;
  }

  private findNeighborNaturalCard(meldCards: GameCard[], startIndex: number, step: -1 | 1) {
    let i = startIndex + step;
    while (i >= 0 && i < meldCards.length) {
      const card = meldCards[i];
      if (card && !card.isJoker && !card.isPinella) {
        return card;
      }

      i += step;
    }

    return null;
  }

  private pickPreferredMissingSuit(suit: GameCard['suit'], missing: Array<GameCard['suit']>) {
    const preferences: Record<GameCard['suit'], Array<GameCard['suit']>> = {
      clubs: ['spades', 'diamonds', 'hearts'],
      spades: ['clubs', 'hearts', 'diamonds'],
      diamonds: ['hearts', 'clubs', 'spades'],
      hearts: ['diamonds', 'spades', 'clubs'],
      joker: ['spades', 'hearts', 'diamonds', 'clubs'],
    };

    return preferences[suit].find((candidate) => missing.includes(candidate)) ?? null;
  }

  private resolveSetWildcardAssignments(cards: GameCard[]) {
    const assignments: Record<string, GameCard['suit']> = {};

    cards.forEach((card, index) => {
      if (!card.isJoker && !card.isPinella) {
        return;
      }

      const suit = this.inferSetWildcardSuit(cards, index);
      if (suit) {
        assignments[card.id] = suit;
      }
    });

    return Object.keys(assignments).length > 0 ? assignments : undefined;
  }

  private findFirstMeld(hand: GameCard[]): string[] | null {
    const naturals = hand.filter((card) => !card.isJoker && !card.isPinella);

    const byRank = new Map<number, GameCard[]>();
    for (const card of naturals) {
      const current = byRank.get(card.rank) ?? [];
      current.push(card);
      byRank.set(card.rank, current);
    }

    for (const cards of byRank.values()) {
      const uniqueSuit = new Map(cards.map((card) => [card.suit, card]));
      if (uniqueSuit.size >= 3) {
        return [...uniqueSuit.values()].slice(0, 3).map((card) => card.id);
      }
    }

    const bySuit = new Map<string, GameCard[]>();
    for (const card of naturals) {
      const current = bySuit.get(card.suit) ?? [];
      current.push(card);
      bySuit.set(card.suit, current);
    }

    for (const cards of bySuit.values()) {
      const uniqueByRank = new Map<number, GameCard>();
      for (const card of cards) {
        if (!uniqueByRank.has(card.rank)) {
          uniqueByRank.set(card.rank, card);
        }
      }

      const sorted = [...uniqueByRank.values()].sort((a, b) => a.rank - b.rank);
      let runStart = 0;

      for (let i = 1; i <= sorted.length; i += 1) {
        const isBreak = i === sorted.length || sorted[i].rank !== sorted[i - 1].rank + 1;
        if (isBreak) {
          const len = i - runStart;
          if (len >= 3) {
            return sorted.slice(runStart, i).map((card) => card.id);
          }
          runStart = i;
        }
      }
    }

    return null;
  }

  private createShuffledDeck(): GameCard[] {
    const suits: Array<'clubs' | 'diamonds' | 'hearts' | 'spades'> = ['clubs', 'diamonds', 'hearts', 'spades'];
    const labels = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
    const deck: GameCard[] = [];

    for (let deckIndex = 0; deckIndex < 2; deckIndex += 1) {
      for (const suit of suits) {
        for (let rank = 1; rank <= 13; rank += 1) {
          const isPinella = rank === 2 && (suit === 'clubs' || suit === 'spades');
          deck.push({
            id: `${deckIndex}-${suit}-${rank}-${randomUUID()}`,
            rank,
            suit,
            label: labels[rank - 1],
            isJoker: false,
            isPinella,
          });
        }
      }

      for (let jokerIndex = 0; jokerIndex < 2; jokerIndex += 1) {
        deck.push({
          id: `${deckIndex}-joker-${jokerIndex}-${randomUUID()}`,
          rank: 0,
          suit: 'joker',
          label: 'JOKER',
          isJoker: true,
          isPinella: false,
        });
      }
    }

    for (let i = deck.length - 1; i > 0; i -= 1) {
      const j = randomInt(i + 1);
      const tmp = deck[i];
      deck[i] = deck[j];
      deck[j] = tmp;
    }

    return deck;
  }
}
