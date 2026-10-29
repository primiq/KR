// The kinds of flower on the island (shared by the items list and the flower field; no imports so anything can use it).
export interface FlowerKind { id: string; name: string; h: number; head: string; mid: string; leaf: string }
export const FLOWERS: FlowerKind[] = [
  { id: 'flower_daisy', name: 'Daisy', h: 0.24, head: '#f7f5ee', mid: '#f2c21b', leaf: '#4f8a2a' },
  { id: 'flower_poppy', name: 'Poppy', h: 0.42, head: '#d8261d', mid: '#1c1410', leaf: '#5a8f2e' },
  { id: 'flower_bluebell', name: 'Bluebell', h: 0.3, head: '#4f63d8', mid: '#3a4bb8', leaf: '#3f7a2a' },
  { id: 'flower_sunflower', name: 'Sunflower', h: 1.7, head: '#f6c21a', mid: '#5a3416', leaf: '#4f8a2a' },
  { id: 'flower_hibiscus', name: 'Hibiscus', h: 0.55, head: '#ec3f86', mid: '#f7e24a', leaf: '#2f6e22' },
  { id: 'flower_lavender', name: 'Lavender', h: 0.45, head: '#9a6bd6', mid: '#7c4fc0', leaf: '#7f9a6a' },
  { id: 'flower_orchid', name: 'Orchid', h: 0.38, head: '#f2d9f0', mid: '#c2368f', leaf: '#3f7a2a' },
  { id: 'flower_paradise', name: 'Bird of Paradise', h: 0.75, head: '#ff8a1a', mid: '#3b62d8', leaf: '#2f6e22' },
];
