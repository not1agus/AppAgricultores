const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// Force CJS resolution — prevents ESM packages that use import.meta from
// being picked up in the Metro web bundle (import.meta is ESM-only syntax
// and causes a SyntaxError when Metro bundles everything into one script).
config.resolver.unstable_enablePackageExports = false;

module.exports = config;
