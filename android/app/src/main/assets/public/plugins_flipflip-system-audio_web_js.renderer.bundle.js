(self["webpackChunkflipflip"] = self["webpackChunkflipflip"] || []).push([["plugins_flipflip-system-audio_web_js"],{

/***/ "./plugins/flipflip-system-audio/web.js"
/*!**********************************************!*\
  !*** ./plugins/flipflip-system-audio/web.js ***!
  \**********************************************/
(module, __unused_webpack_exports, __webpack_require__) {

const { WebPlugin } = __webpack_require__(/*! @capacitor/core */ "./node_modules/@capacitor/core/dist/index.js");

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


/***/ }

}]);
//# sourceMappingURL=plugins_flipflip-system-audio_web_js.renderer.bundle.js.map