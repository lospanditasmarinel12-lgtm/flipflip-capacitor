const { WebPlugin } = require('@capacitor/core');

class FlipTranscoderWeb extends WebPlugin {
  async probe(opts) {
    return { kind: 'other', width: 0, height: 0, convert: false };
  }
  async convert(opts) {
    return { outputPath: opts.path, converted: false };
  }
  async cancel() {}
}

module.exports = { FlipTranscoderWeb };