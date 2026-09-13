const { registerPlugin } = require('@capacitor/core');

const FlipAudioPlayer = registerPlugin('FlipAudioPlayer', {
  web: () => import('./web').then((m) => new m.FlipAudioPlayerWeb()),
});

module.exports = { FlipAudioPlayer };