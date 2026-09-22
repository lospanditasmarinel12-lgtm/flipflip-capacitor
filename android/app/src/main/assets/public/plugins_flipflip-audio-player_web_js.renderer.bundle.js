(self["webpackChunkflipflip"] = self["webpackChunkflipflip"] || []).push([["plugins_flipflip-audio-player_web_js"],{

/***/ "./plugins/flipflip-audio-player/web.js"
/*!**********************************************!*\
  !*** ./plugins/flipflip-audio-player/web.js ***!
  \**********************************************/
(module, __unused_webpack_exports, __webpack_require__) {

const { WebPlugin } = __webpack_require__(/*! @capacitor/core */ "./node_modules/@capacitor/core/dist/index.js");

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

/***/ }

}]);
//# sourceMappingURL=plugins_flipflip-audio-player_web_js.renderer.bundle.js.map