const { registerPlugin } = require('@capacitor/core');

const FlipSystemAudio = registerPlugin('FlipSystemAudio', {
  web: () => import('./web').then((m) => new m.FlipSystemAudioWeb()),
});

module.exports = { FlipSystemAudio };
