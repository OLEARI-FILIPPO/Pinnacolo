import { GameEngineService } from './game-engine.service';

describe('GameEngineService', () => {
  it('uses the provided starting player when creating a hand', () => {
    const engine = new GameEngineService();
    const state = engine.createInitialState('table-test', ['p1', 'p2'], {
      startingPlayerId: 'p2',
    });

    expect(state.turnPlayerId).toBe('p2');
  });

  it('allows A-jolly-3 as a valid run in red suits', () => {
    const engine = new GameEngineService();
    const state = engine.createInitialState('table-test', ['p1', 'bot-1', 'bot-2', 'bot-3']);

    const aceDiamonds = {
      id: 'ace-diamonds',
      rank: 1,
      suit: 'diamonds' as const,
      label: 'A',
      isJoker: false,
      isPinella: false,
    };
    const threeDiamonds = {
      id: 'three-diamonds',
      rank: 3,
      suit: 'diamonds' as const,
      label: '3',
      isJoker: false,
      isPinella: false,
    };
    const joker = {
      id: 'joker-any',
      rank: 0,
      suit: 'joker' as const,
      label: 'Joker',
      isJoker: true,
      isPinella: false,
    };

    state.phase = 'meld';
    state.turnPlayerId = 'p1';
    state.players[0] = {
      ...state.players[0],
      hand: [aceDiamonds, joker, threeDiamonds],
    };

    const nextState = engine.applyCommand(state, {
      type: 'play-meld',
      playerId: 'p1',
      payload: {
        cardIds: ['ace-diamonds', 'joker-any', 'three-diamonds'],
      },
    });

    expect(nextState.melds.length).toBe(1);
    expect(nextState.melds[0]?.type).toBe('run');
  });

  it('does not allow picking only the top discard card when player has one card in hand', () => {
    const engine = new GameEngineService();
    const state = engine.createInitialState('table-test', ['p1', 'bot-1', 'bot-2', 'bot-3']);

    const sevenHearts = {
      id: 'seven-hearts',
      rank: 7,
      suit: 'hearts' as const,
      label: '7',
      isJoker: false,
      isPinella: false,
    };
    const sevenClubs = {
      id: 'seven-clubs',
      rank: 7,
      suit: 'clubs' as const,
      label: '7',
      isJoker: false,
      isPinella: false,
    };
    const sevenDiamonds = {
      id: 'seven-diamonds',
      rank: 7,
      suit: 'diamonds' as const,
      label: '7',
      isJoker: false,
      isPinella: false,
    };

    state.phase = 'draw-or-pick';
    state.turnPlayerId = 'p1';
    state.players[0] = {
      ...state.players[0],
      hand: [sevenHearts],
    };
    state.discardPile = [sevenClubs, sevenDiamonds];

    expect(() =>
      engine.applyCommand(state, {
        type: 'pick-discard-pile',
        playerId: 'p1',
        payload: {
          discardPickCardId: 'seven-diamonds',
        },
      }),
    ).toThrow('Con una sola carta in mano devi prendere almeno 2 carte dal pozzo');
  });

  it('allows picking two discard cards when player has one card in hand', () => {
    const engine = new GameEngineService();
    const state = engine.createInitialState('table-test', ['p1', 'bot-1', 'bot-2', 'bot-3']);

    const sevenHearts = {
      id: 'seven-hearts',
      rank: 7,
      suit: 'hearts' as const,
      label: '7',
      isJoker: false,
      isPinella: false,
    };
    const sevenClubs = {
      id: 'seven-clubs',
      rank: 7,
      suit: 'clubs' as const,
      label: '7',
      isJoker: false,
      isPinella: false,
    };
    const sevenDiamonds = {
      id: 'seven-diamonds',
      rank: 7,
      suit: 'diamonds' as const,
      label: '7',
      isJoker: false,
      isPinella: false,
    };

    state.phase = 'draw-or-pick';
    state.turnPlayerId = 'p1';
    state.players[0] = {
      ...state.players[0],
      hand: [sevenHearts],
    };
    state.discardPile = [sevenClubs, sevenDiamonds];

    const nextState = engine.applyCommand(state, {
      type: 'pick-discard-pile',
      playerId: 'p1',
      payload: {
        discardPickCardId: 'seven-clubs',
      },
    });

    expect(nextState.turnDrawnCardIds).toEqual(['seven-clubs', 'seven-diamonds']);
  });

  it('blocks picking from discard pile when selected card cannot be used in any valid combination', () => {
    const engine = new GameEngineService();
    const state = engine.createInitialState('table-test', ['p1', 'bot-1', 'bot-2', 'bot-3']);

    const sevenHearts = {
      id: 'seven-hearts',
      rank: 7,
      suit: 'hearts' as const,
      label: '7',
      isJoker: false,
      isPinella: false,
    };
    const nineClubs = {
      id: 'nine-clubs',
      rank: 9,
      suit: 'clubs' as const,
      label: '9',
      isJoker: false,
      isPinella: false,
    };
    const kingDiamonds = {
      id: 'king-diamonds',
      rank: 13,
      suit: 'diamonds' as const,
      label: 'K',
      isJoker: false,
      isPinella: false,
    };
    const fourSpades = {
      id: 'four-spades',
      rank: 4,
      suit: 'spades' as const,
      label: '4',
      isJoker: false,
      isPinella: false,
    };

    state.phase = 'draw-or-pick';
    state.turnPlayerId = 'p1';
    state.melds = [];
    state.players[0] = {
      ...state.players[0],
      hand: [sevenHearts, nineClubs, kingDiamonds],
    };
    state.discardPile = [fourSpades];

    expect(() =>
      engine.applyCommand(state, {
        type: 'pick-discard-pile',
        playerId: 'p1',
        payload: {
          discardPickCardId: 'four-spades',
        },
      }),
    ).toThrow('Non puoi prendere questa carta dal pozzo: non hai combinazioni valide che la usano');
  });

  it('allows picking from discard pile when selected card can be attached to your meld', () => {
    const engine = new GameEngineService();
    const state = engine.createInitialState('table-test', ['p1', 'bot-1', 'bot-2', 'bot-3']);

    const threeClubs = {
      id: 'three-clubs',
      rank: 3,
      suit: 'clubs' as const,
      label: '3',
      isJoker: false,
      isPinella: false,
    };
    const fourClubs = {
      id: 'four-clubs',
      rank: 4,
      suit: 'clubs' as const,
      label: '4',
      isJoker: false,
      isPinella: false,
    };
    const fiveClubs = {
      id: 'five-clubs',
      rank: 5,
      suit: 'clubs' as const,
      label: '5',
      isJoker: false,
      isPinella: false,
    };
    const sixClubs = {
      id: 'six-clubs',
      rank: 6,
      suit: 'clubs' as const,
      label: '6',
      isJoker: false,
      isPinella: false,
    };

    state.phase = 'draw-or-pick';
    state.turnPlayerId = 'p1';
    state.players[0] = {
      ...state.players[0],
      hand: [],
    };
    state.melds = [
      {
        id: 'meld-p1-1',
        type: 'run',
        ownerPlayerId: 'p1',
        cards: [fiveClubs, fourClubs, threeClubs],
      },
    ];
    state.discardPile = [sixClubs];

    const nextState = engine.applyCommand(state, {
      type: 'pick-discard-pile',
      playerId: 'p1',
      payload: {
        discardPickCardId: 'six-clubs',
      },
    });

    expect(nextState.turnDrawnCardIds).toEqual(['six-clubs']);
    expect(nextState.players[0]?.hand.map((card) => card.id)).toEqual(['six-clubs']);
    expect(nextState.phase).toBe('meld');
  });

  it('does not allow discarding if the selected discard-pile card is still in hand', () => {
    const engine = new GameEngineService();
    const state = engine.createInitialState('table-test', ['p1', 'bot-1', 'bot-2', 'bot-3']);

    const selectedFromDiscard = {
      id: 'selected-from-discard',
      rank: 6,
      suit: 'hearts' as const,
      label: '6',
      isJoker: false,
      isPinella: false,
    };
    const discardCandidate = {
      id: 'discard-candidate',
      rank: 8,
      suit: 'clubs' as const,
      label: '8',
      isJoker: false,
      isPinella: false,
    };

    state.phase = 'meld';
    state.turnPlayerId = 'p1';
    state.turnDrawnCardIds = ['selected-from-discard'];
    state.turnMustUseDiscardPickCardId = 'selected-from-discard';
    state.lastMove = {
      playerId: 'p1',
      kind: 'pick-discard',
      cardIds: ['selected-from-discard'],
    };
    state.players[0] = {
      ...state.players[0],
      hand: [selectedFromDiscard, discardCandidate],
    };

    expect(() =>
      engine.applyCommand(state, {
        type: 'discard-card',
        playerId: 'p1',
        payload: {
          discardCardId: 'discard-candidate',
        },
      }),
    ).toThrow('Devi usare la carta scelta dal pozzo prima di scartare');
  });

  it('keeps the discard-pick usage obligation after an intermediate move in meld phase', () => {
    const engine = new GameEngineService();
    const state = engine.createInitialState('table-test', ['p1', 'bot-1', 'bot-2', 'bot-3']);

    const selectedFromDiscard = {
      id: 'selected-from-discard',
      rank: 2,
      suit: 'diamonds' as const,
      label: '2',
      isJoker: false,
      isPinella: false,
    };
    const discardCandidate = {
      id: 'discard-candidate',
      rank: 8,
      suit: 'clubs' as const,
      label: '8',
      isJoker: false,
      isPinella: false,
    };

    state.phase = 'meld';
    state.turnPlayerId = 'p1';
    state.turnDrawnCardIds = ['selected-from-discard'];
    state.turnMustUseDiscardPickCardId = 'selected-from-discard';
    state.lastMove = {
      playerId: 'p1',
      kind: 'play-meld',
      cardIds: ['some-other-card-a', 'some-other-card-b', 'some-other-card-c'],
    };
    state.players[0] = {
      ...state.players[0],
      hand: [selectedFromDiscard, discardCandidate],
    };

    expect(() =>
      engine.applyCommand(state, {
        type: 'discard-card',
        playerId: 'p1',
        payload: {
          discardCardId: 'discard-candidate',
        },
      }),
    ).toThrow('Devi usare la carta scelta dal pozzo prima di scartare');
  });

  it('blocks playing a meld that does not include the mandatory discard-pick card', () => {
    const engine = new GameEngineService();
    const state = engine.createInitialState('table-test', ['p1', 'bot-1', 'bot-2', 'bot-3']);

    const requiredFromDiscard = {
      id: 'required-from-discard',
      rank: 4,
      suit: 'diamonds' as const,
      label: '4',
      isJoker: false,
      isPinella: false,
    };
    const runCard1 = {
      id: 'run-card-1',
      rank: 10,
      suit: 'hearts' as const,
      label: '10',
      isJoker: false,
      isPinella: false,
    };
    const runCard2 = {
      id: 'run-card-2',
      rank: 11,
      suit: 'hearts' as const,
      label: 'J',
      isJoker: false,
      isPinella: false,
    };
    const runCard3 = {
      id: 'run-card-3',
      rank: 12,
      suit: 'hearts' as const,
      label: 'Q',
      isJoker: false,
      isPinella: false,
    };

    state.phase = 'meld';
    state.turnPlayerId = 'p1';
    state.turnDrawnCardIds = ['required-from-discard'];
    state.turnMustUseDiscardPickCardId = 'required-from-discard';
    state.lastMove = {
      playerId: 'p1',
      kind: 'pick-discard',
      cardIds: ['required-from-discard'],
    };
    state.players[0] = {
      ...state.players[0],
      hand: [requiredFromDiscard, runCard1, runCard2, runCard3],
    };

    expect(() =>
      engine.applyCommand(state, {
        type: 'play-meld',
        playerId: 'p1',
        payload: {
          cardIds: ['run-card-1', 'run-card-2', 'run-card-3'],
        },
      }),
    ).toThrow('Devi usare la carta scelta dal pozzo nella combinazione prima di poter usare altre carte');
  });

  it('requires explicit wildcard selection and does not auto-add it to complete a run', () => {
    const engine = new GameEngineService();
    const state = engine.createInitialState('table-test', ['p1', 'bot-1', 'bot-2', 'bot-3']);

    const threeClubs = {
      id: 'three-clubs',
      rank: 3,
      suit: 'clubs' as const,
      label: '3',
      isJoker: false,
      isPinella: false,
    };
    const fiveClubs = {
      id: 'five-clubs',
      rank: 5,
      suit: 'clubs' as const,
      label: '5',
      isJoker: false,
      isPinella: false,
    };
    const sixClubs = {
      id: 'six-clubs',
      rank: 6,
      suit: 'clubs' as const,
      label: '6',
      isJoker: false,
      isPinella: false,
    };
    const pinellaSpades = {
      id: 'pinella-spades',
      rank: 2,
      suit: 'spades' as const,
      label: '2',
      isJoker: false,
      isPinella: true,
    };

    state.phase = 'meld';
    state.players[0] = {
      ...state.players[0],
      hand: [threeClubs, fiveClubs, sixClubs, pinellaSpades],
    };

    expect(() =>
      engine.applyCommand(state, {
        type: 'play-meld',
        playerId: 'p1',
        payload: {
          cardIds: ['three-clubs', 'five-clubs', 'six-clubs'],
        },
      }),
    ).toThrow('Combinazione non valida');
  });

  it('allows discarding another card even if the stock-drawn card is still in hand', () => {
    const engine = new GameEngineService();
    const state = engine.createInitialState('table-test', ['p1', 'bot-1', 'bot-2', 'bot-3']);

    const drawn = {
      id: 'drawn-card',
      rank: 9,
      suit: 'hearts' as const,
      label: '9',
      isJoker: false,
      isPinella: false,
    };
    const discardCandidate = {
      id: 'discard-candidate',
      rank: 7,
      suit: 'clubs' as const,
      label: '7',
      isJoker: false,
      isPinella: false,
    };

    state.phase = 'meld';
    state.turnPlayerId = 'p1';
    state.turnDrawnCardIds = ['drawn-card'];
    state.lastMove = {
      playerId: 'p1',
      kind: 'draw-stock',
      cardIds: ['drawn-card'],
    };
    state.players[0] = {
      ...state.players[0],
      hand: [drawn, discardCandidate],
    };

    const nextState = engine.applyCommand(state, {
      type: 'discard-card',
      playerId: 'p1',
      payload: {
        discardCardId: 'discard-candidate',
      },
    });

    expect(nextState.discardPile.at(-1)?.id).toBe('discard-candidate');
    expect(nextState.players[0]?.hand.map((card) => card.id)).toContain('drawn-card');
  });

  it('does not replace wildcard with diamonds when adjacency battezzo resolves to hearts', () => {
    const engine = new GameEngineService();
    const state = engine.createInitialState('table-test', ['p1', 'bot-1', 'bot-2', 'bot-3']);

    const aceSpades = {
      id: 'ace-spades',
      rank: 1,
      suit: 'spades' as const,
      label: 'A',
      isJoker: false,
      isPinella: false,
    };
    const pinellaClubs = {
      id: 'pinella-clubs',
      rank: 2,
      suit: 'clubs' as const,
      label: '2',
      isJoker: false,
      isPinella: true,
    };
    const aceClubs = {
      id: 'ace-clubs',
      rank: 1,
      suit: 'clubs' as const,
      label: 'A',
      isJoker: false,
      isPinella: false,
    };
    const aceDiamonds = {
      id: 'ace-diamonds',
      rank: 1,
      suit: 'diamonds' as const,
      label: 'A',
      isJoker: false,
      isPinella: false,
    };

    state.phase = 'meld';
    state.players[0] = {
      ...state.players[0],
      hand: [aceSpades, pinellaClubs, aceClubs],
    };

    const afterPlay = engine.applyCommand(state, {
      type: 'play-meld',
      playerId: 'p1',
      payload: {
        cardIds: ['ace-spades', 'pinella-clubs', 'ace-clubs'],
      },
    });

    const meldId = afterPlay.melds[0]?.id;
    expect(meldId).toBeTruthy();

    afterPlay.players[0] = {
      ...afterPlay.players[0],
      hand: [aceDiamonds],
    };

    const afterAttach = engine.applyCommand(afterPlay, {
      type: 'attach-to-meld',
      playerId: 'p1',
      payload: {
        meldId,
        cardIds: ['ace-diamonds'],
      },
    });

    expect(afterAttach.melds[0]?.cards.map((card) => card.id)).toEqual([
      'ace-spades',
      'pinella-clubs',
      'ace-clubs',
      'ace-diamonds',
    ]);
    expect(afterAttach.players[0]?.hand).toHaveLength(0);
  });

  it('keeps a wildcard in the selected position for a set so its target suit stays clear', () => {
    const engine = new GameEngineService();
    const state = engine.createInitialState('table-test', ['p1', 'bot-1', 'bot-2', 'bot-3']);

    const jackDiamonds = {
      id: 'jack-diamonds',
      rank: 11,
      suit: 'diamonds' as const,
      label: 'J',
      isJoker: false,
      isPinella: false,
    };
    const pinellaSpades = {
      id: 'pinella-spades',
      rank: 2,
      suit: 'spades' as const,
      label: '2',
      isJoker: false,
      isPinella: true,
    };
    const jackHearts = {
      id: 'jack-hearts',
      rank: 11,
      suit: 'hearts' as const,
      label: 'J',
      isJoker: false,
      isPinella: false,
    };

    state.phase = 'meld';
    state.players[0] = {
      ...state.players[0],
      hand: [jackDiamonds, pinellaSpades, jackHearts],
    };

    const nextState = engine.applyCommand(state, {
      type: 'play-meld',
      playerId: 'p1',
      payload: {
        cardIds: ['jack-diamonds', 'pinella-spades', 'jack-hearts'],
      },
    });

    expect(nextState.melds[0]?.type).toBe('set');
    expect(nextState.melds[0]?.cards.map((card) => card.id)).toEqual(['jack-diamonds', 'pinella-spades', 'jack-hearts']);
  });

  it('uses the selected order to place a wildcard in an ambiguous black run', () => {
    const engine = new GameEngineService();
    const state = engine.createInitialState('table-test', ['p1', 'bot-1', 'bot-2', 'bot-3']);

    const threeSpades = {
      id: 'three-spades',
      rank: 3,
      suit: 'spades' as const,
      label: '3',
      isJoker: false,
      isPinella: false,
    };
    const fourSpades = {
      id: 'four-spades',
      rank: 4,
      suit: 'spades' as const,
      label: '4',
      isJoker: false,
      isPinella: false,
    };
    const fiveSpades = {
      id: 'five-spades',
      rank: 5,
      suit: 'spades' as const,
      label: '5',
      isJoker: false,
      isPinella: false,
    };
    const pinellaClubs = {
      id: 'pinella-clubs',
      rank: 2,
      suit: 'clubs' as const,
      label: '2',
      isJoker: false,
      isPinella: true,
    };

    state.phase = 'meld';
    state.players[0] = {
      ...state.players[0],
      hand: [fiveSpades, fourSpades, threeSpades, pinellaClubs],
    };

    const nextState = engine.applyCommand(state, {
      type: 'play-meld',
      playerId: 'p1',
      payload: {
        cardIds: ['five-spades', 'four-spades', 'three-spades', 'pinella-clubs'],
      },
    });

    expect(nextState.melds[0]?.cards.map((card) => card.id)).toEqual([
      'five-spades',
      'four-spades',
      'three-spades',
      'pinella-clubs',
    ]);
  });

  it('allows a black run A-3-4 without using a pinella as 2', () => {
    const engine = new GameEngineService();
    const state = engine.createInitialState('table-test', ['p1', 'bot-1', 'bot-2', 'bot-3']);

    const aceSpades = {
      id: 'ace-spades',
      rank: 1,
      suit: 'spades' as const,
      label: 'A',
      isJoker: false,
      isPinella: false,
    };
    const threeSpades = {
      id: 'three-spades',
      rank: 3,
      suit: 'spades' as const,
      label: '3',
      isJoker: false,
      isPinella: false,
    };
    const fourSpades = {
      id: 'four-spades',
      rank: 4,
      suit: 'spades' as const,
      label: '4',
      isJoker: false,
      isPinella: false,
    };

    state.phase = 'meld';
    state.players[0] = {
      ...state.players[0],
      hand: [aceSpades, threeSpades, fourSpades],
    };

    const nextState = engine.applyCommand(state, {
      type: 'play-meld',
      playerId: 'p1',
      payload: {
        cardIds: ['ace-spades', 'three-spades', 'four-spades'],
      },
    });

    expect(nextState.melds[0]?.cards.map((card) => card.id)).toEqual(['four-spades', 'three-spades', 'ace-spades']);
  });

  it('lets an ace replace a wildcard in a high run so the 2 is not used', () => {
    const engine = new GameEngineService();
    const state = engine.createInitialState('table-test', ['p1', 'bot-1', 'bot-2', 'bot-3']);

    const jackSpades = {
      id: 'jack-spades',
      rank: 11,
      suit: 'spades' as const,
      label: 'J',
      isJoker: false,
      isPinella: false,
    };
    const queenSpades = {
      id: 'queen-spades',
      rank: 12,
      suit: 'spades' as const,
      label: 'Q',
      isJoker: false,
      isPinella: false,
    };
    const kingSpades = {
      id: 'king-spades',
      rank: 13,
      suit: 'spades' as const,
      label: 'K',
      isJoker: false,
      isPinella: false,
    };
    const pinellaClubs = {
      id: 'pinella-clubs',
      rank: 2,
      suit: 'clubs' as const,
      label: '2',
      isJoker: false,
      isPinella: true,
    };
    const aceSpades = {
      id: 'ace-spades',
      rank: 1,
      suit: 'spades' as const,
      label: 'A',
      isJoker: false,
      isPinella: false,
    };

    state.phase = 'meld';
    state.melds = [
      {
        id: 'meld-1',
        type: 'run',
        ownerPlayerId: 'bot-1',
        cards: [pinellaClubs, kingSpades, queenSpades, jackSpades],
      },
    ];
    state.players[0] = {
      ...state.players[0],
      hand: [aceSpades],
    };

    const nextState = engine.applyCommand(state, {
      type: 'attach-to-meld',
      playerId: 'p1',
      payload: {
        meldId: 'meld-1',
        cardIds: ['ace-spades'],
      },
    });

    expect(nextState.melds[0]?.cards.map((card) => card.id)).toEqual([
      'ace-spades',
      'king-spades',
      'queen-spades',
      'jack-spades',
    ]);
    expect(nextState.players[0]?.hand.map((card) => card.id)).toEqual(['pinella-clubs']);
  });

  it('blocks attaching cards to opponent melds when no wildcard is present', () => {
    const engine = new GameEngineService();
    const state = engine.createInitialState('table-test', ['p1', 'bot-1', 'bot-2', 'bot-3']);

    const sevenHearts = {
      id: 'seven-hearts',
      rank: 7,
      suit: 'hearts' as const,
      label: '7',
      isJoker: false,
      isPinella: false,
    };
    const eightHearts = {
      id: 'eight-hearts',
      rank: 8,
      suit: 'hearts' as const,
      label: '8',
      isJoker: false,
      isPinella: false,
    };
    const nineHearts = {
      id: 'nine-hearts',
      rank: 9,
      suit: 'hearts' as const,
      label: '9',
      isJoker: false,
      isPinella: false,
    };
    const tenHearts = {
      id: 'ten-hearts',
      rank: 10,
      suit: 'hearts' as const,
      label: '10',
      isJoker: false,
      isPinella: false,
    };

    state.phase = 'meld';
    state.melds = [
      {
        id: 'opp-meld-no-wildcard',
        type: 'run',
        ownerPlayerId: 'bot-1',
        cards: [nineHearts, eightHearts, sevenHearts],
      },
    ];
    state.players[0] = {
      ...state.players[0],
      hand: [tenHearts],
    };

    expect(() =>
      engine.applyCommand(state, {
        type: 'attach-to-meld',
        playerId: 'p1',
        payload: {
          meldId: 'opp-meld-no-wildcard',
          cardIds: ['ten-hearts'],
        },
      }),
    ).toThrow('Puoi intervenire sugli avversari solo sostituendo una matta/pinella presente');
  });

  it('blocks adding multiple cards on opponent melds even when wildcard exists', () => {
    const engine = new GameEngineService();
    const state = engine.createInitialState('table-test', ['p1', 'bot-1', 'bot-2', 'bot-3']);

    const jackSpades = {
      id: 'jack-spades',
      rank: 11,
      suit: 'spades' as const,
      label: 'J',
      isJoker: false,
      isPinella: false,
    };
    const queenSpades = {
      id: 'queen-spades',
      rank: 12,
      suit: 'spades' as const,
      label: 'Q',
      isJoker: false,
      isPinella: false,
    };
    const kingSpades = {
      id: 'king-spades',
      rank: 13,
      suit: 'spades' as const,
      label: 'K',
      isJoker: false,
      isPinella: false,
    };
    const pinellaClubs = {
      id: 'pinella-clubs',
      rank: 2,
      suit: 'clubs' as const,
      label: '2',
      isJoker: false,
      isPinella: true,
    };
    const aceSpades = {
      id: 'ace-spades',
      rank: 1,
      suit: 'spades' as const,
      label: 'A',
      isJoker: false,
      isPinella: false,
    };
    const tenSpades = {
      id: 'ten-spades',
      rank: 10,
      suit: 'spades' as const,
      label: '10',
      isJoker: false,
      isPinella: false,
    };

    state.phase = 'meld';
    state.melds = [
      {
        id: 'opp-meld-with-wildcard',
        type: 'run',
        ownerPlayerId: 'bot-1',
        cards: [pinellaClubs, kingSpades, queenSpades, jackSpades],
      },
    ];
    state.players[0] = {
      ...state.players[0],
      hand: [aceSpades, tenSpades],
    };

    expect(() =>
      engine.applyCommand(state, {
        type: 'attach-to-meld',
        playerId: 'p1',
        payload: {
          meldId: 'opp-meld-with-wildcard',
          cardIds: ['ace-spades', 'ten-spades'],
        },
      }),
    ).toThrow('Sulle combinazioni avversarie puoi sostituire solo una matta/pinella alla volta');
  });

  it('infers set wildcard suit from adjacent natural card in selection order', () => {
    const engine = new GameEngineService();
    const state = engine.createInitialState('table-test', ['p1', 'bot-1', 'bot-2', 'bot-3']);

    const sixClubs = {
      id: 'six-clubs',
      rank: 6,
      suit: 'clubs' as const,
      label: '6',
      isJoker: false,
      isPinella: false,
    };
    const sixDiamonds = {
      id: 'six-diamonds',
      rank: 6,
      suit: 'diamonds' as const,
      label: '6',
      isJoker: false,
      isPinella: false,
    };
    const pinellaClubs = {
      id: 'pinella-clubs',
      rank: 2,
      suit: 'clubs' as const,
      label: '2',
      isJoker: false,
      isPinella: true,
    };

    state.phase = 'meld';
    state.players[0] = {
      ...state.players[0],
      hand: [sixClubs, pinellaClubs, sixDiamonds],
    };

    const nextState = engine.applyCommand(state, {
      type: 'play-meld',
      playerId: 'p1',
      payload: {
        cardIds: ['six-clubs', 'pinella-clubs', 'six-diamonds'],
      },
    });

    const wildcardId = 'pinella-clubs';
    expect(nextState.melds[0]?.wildcardAssignments?.[wildcardId]).toBe('spades');
  });

  it('when naturals are hearts and diamonds, wildcard near diamonds is battezzata clubs', () => {
    const engine = new GameEngineService();
    const state = engine.createInitialState('table-test', ['p1', 'bot-1', 'bot-2', 'bot-3']);

    const sixHearts = {
      id: 'six-hearts',
      rank: 6,
      suit: 'hearts' as const,
      label: '6',
      isJoker: false,
      isPinella: false,
    };
    const sixDiamonds = {
      id: 'six-diamonds-bis',
      rank: 6,
      suit: 'diamonds' as const,
      label: '6',
      isJoker: false,
      isPinella: false,
    };
    const pinellaClubs = {
      id: 'pinella-clubs-red-case-1',
      rank: 2,
      suit: 'clubs' as const,
      label: '2',
      isJoker: false,
      isPinella: true,
    };

    state.phase = 'meld';
    state.players[0] = {
      ...state.players[0],
      hand: [sixHearts, sixDiamonds, pinellaClubs],
    };

    const nextState = engine.applyCommand(state, {
      type: 'play-meld',
      playerId: 'p1',
      payload: {
        cardIds: ['six-hearts', 'six-diamonds-bis', 'pinella-clubs-red-case-1'],
      },
    });

    expect(nextState.melds[0]?.wildcardAssignments?.['pinella-clubs-red-case-1']).toBe('clubs');
  });

  it('when naturals are hearts and diamonds, wildcard near hearts is battezzata spades', () => {
    const engine = new GameEngineService();
    const state = engine.createInitialState('table-test', ['p1', 'bot-1', 'bot-2', 'bot-3']);

    const sixHearts = {
      id: 'six-hearts-bis',
      rank: 6,
      suit: 'hearts' as const,
      label: '6',
      isJoker: false,
      isPinella: false,
    };
    const sixDiamonds = {
      id: 'six-diamonds-ter',
      rank: 6,
      suit: 'diamonds' as const,
      label: '6',
      isJoker: false,
      isPinella: false,
    };
    const pinellaClubs = {
      id: 'pinella-clubs-red-case-2',
      rank: 2,
      suit: 'clubs' as const,
      label: '2',
      isJoker: false,
      isPinella: true,
    };

    state.phase = 'meld';
    state.players[0] = {
      ...state.players[0],
      hand: [sixDiamonds, sixHearts, pinellaClubs],
    };

    const nextState = engine.applyCommand(state, {
      type: 'play-meld',
      playerId: 'p1',
      payload: {
        cardIds: ['six-diamonds-ter', 'six-hearts-bis', 'pinella-clubs-red-case-2'],
      },
    });

    expect(nextState.melds[0]?.wildcardAssignments?.['pinella-clubs-red-case-2']).toBe('spades');
  });

  it('does not auto-use a black two pinella as the 2 in a red A-3-4 run', () => {
    const engine = new GameEngineService();
    const state = engine.createInitialState('table-test', ['p1', 'bot-1', 'bot-2', 'bot-3']);

    const aceHearts = {
      id: 'ace-hearts',
      rank: 1,
      suit: 'hearts' as const,
      label: 'A',
      isJoker: false,
      isPinella: false,
    };
    const threeHearts = {
      id: 'three-hearts',
      rank: 3,
      suit: 'hearts' as const,
      label: '3',
      isJoker: false,
      isPinella: false,
    };
    const fourHearts = {
      id: 'four-hearts',
      rank: 4,
      suit: 'hearts' as const,
      label: '4',
      isJoker: false,
      isPinella: false,
    };
    const pinellaClubs = {
      id: 'pinella-clubs',
      rank: 2,
      suit: 'clubs' as const,
      label: '2',
      isJoker: false,
      isPinella: true,
    };

    state.phase = 'meld';
    state.players[0] = {
      ...state.players[0],
      hand: [aceHearts, threeHearts, fourHearts, pinellaClubs],
    };

    expect(() =>
      engine.applyCommand(state, {
        type: 'play-meld',
        playerId: 'p1',
        payload: {
          cardIds: ['ace-hearts', 'three-hearts', 'four-hearts'],
        },
      }),
    ).toThrow('Combinazione non valida');
  });

  it('allows a red run A-2-3 with the natural red 2', () => {
    const engine = new GameEngineService();
    const state = engine.createInitialState('table-test', ['p1', 'bot-1', 'bot-2', 'bot-3']);

    const aceHearts = {
      id: 'ace-hearts',
      rank: 1,
      suit: 'hearts' as const,
      label: 'A',
      isJoker: false,
      isPinella: false,
    };
    const twoHearts = {
      id: 'two-hearts',
      rank: 2,
      suit: 'hearts' as const,
      label: '2',
      isJoker: false,
      isPinella: false,
    };
    const threeHearts = {
      id: 'three-hearts',
      rank: 3,
      suit: 'hearts' as const,
      label: '3',
      isJoker: false,
      isPinella: false,
    };

    state.phase = 'meld';
    state.players[0] = {
      ...state.players[0],
      hand: [aceHearts, twoHearts, threeHearts],
    };

    const nextState = engine.applyCommand(state, {
      type: 'play-meld',
      playerId: 'p1',
      payload: {
        cardIds: ['ace-hearts', 'two-hearts', 'three-hearts'],
      },
    });

    expect(nextState.melds).toHaveLength(1);
    expect(nextState.melds[0]?.type).toBe('run');
    expect(nextState.melds[0]?.cards.map((card) => card.id)).toEqual(['three-hearts', 'two-hearts', 'ace-hearts']);
  });
});