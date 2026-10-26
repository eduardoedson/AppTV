module.exports = {
  preset: 'react-native',
  cacheDirectory: '<rootDir>/.jest-cache',
  // Keep large or duplicated local folders out of the test crawler
  modulePathIgnorePatterns: ['<rootDir>/videos/', '<rootDir>/.backup-2026-10-25/'],
  testPathIgnorePatterns: ['/node_modules/', '<rootDir>/videos/', '<rootDir>/.backup-2026-10-25/'],
};
