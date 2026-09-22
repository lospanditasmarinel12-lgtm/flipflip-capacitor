(self["webpackChunkflipflip"] = self["webpackChunkflipflip"] || []).push([["plugins_flipflip-transcoder_web_js"],{

/***/ "./plugins/flipflip-transcoder/web.js"
/*!********************************************!*\
  !*** ./plugins/flipflip-transcoder/web.js ***!
  \********************************************/
(module, __unused_webpack_exports, __webpack_require__) {

const { WebPlugin } = __webpack_require__(/*! @capacitor/core */ "./node_modules/@capacitor/core/dist/index.js");

class FlipTranscoderWeb extends WebPlugin {
  async probe(opts) {
    return {
      kind: 'other', width: 0, height: 0, convert: false,
      pixelCount: 0, estimatedDecodedBytes: 0, fileSize: 0,
      codec: '', fps: 0, duration: 0, bitDepth: 0, pixelFormat: '',
      hdr: false, alpha: false, estimatedOutputBytes: 0,
      decision: {
        profile: 'keep', resize: false, targetWidth: 0, targetHeight: 0,
        targetFPS: 0, targetBitrate: 0, toneMap: false, reencode: false,
      },
    };
  }
  async convert(opts) {
    return { outputPath: opts.path, converted: false };
  }
  async optimizeLibrary(opts) {
    return { mapping: [], canceled: false };
  }
  async resolveMediaUrl(opts) {
    return { url: opts.path };
  }
  async cancel() {}
}

module.exports = { FlipTranscoderWeb };

/***/ }

}]);
//# sourceMappingURL=plugins_flipflip-transcoder_web_js.renderer.bundle.js.map