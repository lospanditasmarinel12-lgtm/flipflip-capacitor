const { registerPlugin } = require('@capacitor/core');

const FlipTranscoder = registerPlugin('FlipTranscoder', {
  web: () => import('./web').then((m) => new m.FlipTranscoderWeb()),
});

module.exports = { FlipTranscoder };
