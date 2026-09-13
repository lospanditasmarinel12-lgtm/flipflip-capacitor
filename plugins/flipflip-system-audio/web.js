const { WebPlugin } = require('@capacitor/core');

class FlipSystemAudioWeb extends WebPlugin {
  async startCapture() {
    throw this.unavailable('System audio capture is not available in the browser');
  }
  async stopCapture() {}
  async isAvailable() {
    return { available: false };
  }
  async startBroadcast() {
    throw this.unavailable('Broadcast picker is only available on iOS');
  }
}

module.exports = { FlipSystemAudioWeb };
