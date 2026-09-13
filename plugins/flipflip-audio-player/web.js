const { WebPlugin } = require('@capacitor/core');

class FlipAudioPlayerWeb extends WebPlugin {
  async load() {
    throw new Error('FlipAudioPlayer is not available in a web build');
  }
  async play() { throw new Error('FlipAudioPlayer is not available in a web build'); }
  async pause() { throw new Error('FlipAudioPlayer is not available in a web build'); }
  async seekTo() { throw new Error('FlipAudioPlayer is not available in a web build'); }
  async setVolume() { throw new Error('FlipAudioPlayer is not available in a web build'); }
  async getState() { return { playing: false, position: 0, duration: 0 }; }
  async dispose() {}
}

module.exports = { FlipAudioPlayerWeb };