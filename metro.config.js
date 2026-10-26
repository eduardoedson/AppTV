const path = require('path');
const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');

// Escapes a filesystem path so it can be used inside a regular expression
const escapeForRegExp = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Large local folders that Metro must never crawl or bundle
const ignoredFolders = ['videos', '.backup-2026-10-25'].map(
  folder => new RegExp(`^${escapeForRegExp(path.join(__dirname, folder))}[\\\\/].*$`),
);

/**
 * Metro configuration
 * https://reactnative.dev/docs/metro
 *
 * @type {import('@react-native/metro-config').MetroConfig}
 */
const config = {
  resolver: {
    blockList: ignoredFolders,
  },
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
