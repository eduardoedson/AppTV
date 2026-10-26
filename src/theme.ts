export const brandPalette = {
  violet: '#A73DDF',
  royalBlue: '#2B44DA',
  electricBlue: '#2D23DB',
  indigo: '#673EDD',
  primary: '#7728D5',
  purple: '#9E23DE',
  orchid: '#C139D8',
  magenta: '#D72ECE',
  pink: '#DA23AC',
  rose: '#D52E89',
} as const;

export const colors = {
  background: '#0B0712',
  surface: '#171120',
  surfaceRaised: '#251B32',
  primary: brandPalette.primary,
  primaryDark: brandPalette.indigo,
  accent: brandPalette.magenta,
  info: brandPalette.royalBlue,
  text: '#F7F4FB',
  muted: '#B5AABD',
  danger: '#FF6B81',
  focus: '#FFFFFF',
};
