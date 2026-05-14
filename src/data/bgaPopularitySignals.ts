export interface BgaPopularitySignal {
  score: number;
  signals: string[];
}

const BGA_POPULARITY_INDEX: Record<string, BgaPopularitySignal> = {
  raceforthegalaxy: {
    score: 0.98,
    signals: ['Award-winning games', 'Recommended in real-time', 'Best for 2', 'Good on mobile'],
  },
  lostcities: {
    score: 0.9,
    signals: ['Award-winning games', 'Recommended in real-time', 'Best for 2'],
  },
  caverna: {
    score: 0.75,
    signals: ['Award-winning games', 'Recommended in real-time'],
  },
  castlecombo: {
    score: 0.6,
    signals: ['BGA Awards Winner'],
  },
  resarcana: {
    score: 0.53,
    signals: ['Award-winning games', 'Good on mobile'],
  },
  cantstop: {
    score: 0.5,
    signals: ['Recommended in real-time', 'Recommended in turn-based'],
  },
  arnak: {
    score: 0.45,
    signals: ['Award-winning games'],
  },
  cartographers: {
    score: 0.45,
    signals: ['Award-winning games'],
  },
  sevenwondersarchitects: {
    score: 0.45,
    signals: ['Award-winning games'],
  },
  cubirds: {
    score: 0.45,
    signals: ['Award-winning games'],
  },
  gaiaproject: {
    score: 0.45,
    signals: ['Award-winning games'],
  },
  greatwesterntrail: {
    score: 0.45,
    signals: ['Award-winning games'],
  },
  clansofcaledonia: {
    score: 0.45,
    signals: ['Award-winning games'],
  },
  seasons: {
    score: 0.45,
    signals: ['Recommended in real-time', 'Best for 2'],
  },
  supermegaluckybox: {
    score: 0.3,
    signals: ['Recommended in real-time'],
  },
  gizmos: {
    score: 0.3,
    signals: ['Recommended in real-time'],
  },
  stoneage: {
    score: 0.3,
    signals: ['Recommended in real-time'],
  },
  toybattle: {
    score: 0.15,
    signals: ['Best for 2'],
  },
  chakra: {
    score: 0.15,
    signals: ['Best for 2'],
  },
};

export function getBgaPopularitySignal(gameId: string): BgaPopularitySignal | undefined {
  return BGA_POPULARITY_INDEX[gameId];
}

