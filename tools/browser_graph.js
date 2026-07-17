'use strict';
/**
 * browser_graph.js — peuple le graphe d'objets global de jsdom pour ressembler à Chrome 150.
 *
 * Cible DEUX signaux documentés du fingerprint (recaptcha/README.md) qui trahissent jsdom :
 *   - Champ 22 (/reload) : « Hashed all browser objects keys »  → hash de l'ensemble des clés de window
 *   - Key 291 (VM)       : « Hashed specific Prototypes key of browser objects, like
 *                            SpeechSynthesisEvent, NetworkInformation, HTMLElement… »
 *
 * jsdom n'a que ~443 globals (vs ~900+ Chrome) et il MANQUE des interfaces explicitement hashées
 * (SpeechSynthesisEvent, NetworkInformation, RTCPeerConnection, AudioContext, WebGL*…). On les
 * injecte comme constructeurs natifs-like, avec des clés de prototype réalistes pour les plus
 * sondées. But : rapprocher le hash du graphe de celui d'un vrai Chrome.
 *
 * NB: pour que fn.toString() paraisse natif, on réutilise le registre `native()` de shims.js
 * (passé en argument) — sinon un constructeur injecté révélerait son code source.
 */

// Prototypes détaillés pour les interfaces explicitement nommées / très sondées (Key 291 & co).
const PROTO_KEYS = {
  SpeechSynthesisEvent: ['charIndex', 'charLength', 'elapsedTime', 'name', 'utterance'],
  SpeechSynthesisUtterance: ['lang', 'pitch', 'rate', 'text', 'voice', 'volume', 'onstart', 'onend', 'onerror', 'onpause', 'onresume', 'onmark', 'onboundary'],
  NetworkInformation: ['downlink', 'downlinkMax', 'effectiveType', 'onchange', 'rtt', 'saveData', 'type'],
  RTCPeerConnection: ['localDescription', 'remoteDescription', 'signalingState', 'iceGatheringState', 'iceConnectionState', 'connectionState', 'canTrickleIceCandidates', 'createOffer', 'createAnswer', 'setLocalDescription', 'setRemoteDescription', 'addIceCandidate', 'getConfiguration', 'setConfiguration', 'close', 'createDataChannel', 'addTrack', 'removeTrack', 'getSenders', 'getReceivers', 'getTransceivers', 'addTransceiver', 'getStats'],
  AudioContext: ['baseLatency', 'outputLatency', 'destination', 'currentTime', 'sampleRate', 'listener', 'state', 'onstatechange', 'createGain', 'createOscillator', 'createAnalyser', 'createBuffer', 'createBufferSource', 'createBiquadFilter', 'createDynamicsCompressor', 'decodeAudioData', 'resume', 'suspend', 'close'],
  OfflineAudioContext: ['length', 'oncomplete', 'startRendering', 'suspend', 'resume'],
  WebGLRenderingContext: ['canvas', 'drawingBufferWidth', 'drawingBufferHeight', 'getExtension', 'getParameter', 'getSupportedExtensions', 'createShader', 'shaderSource', 'compileShader', 'createProgram', 'attachShader', 'linkProgram', 'useProgram', 'createBuffer', 'bindBuffer', 'bufferData', 'getAttribLocation', 'getUniformLocation', 'vertexAttribPointer', 'enableVertexAttribArray', 'drawArrays', 'drawElements', 'viewport', 'clearColor', 'clear', 'readPixels', 'getShaderPrecisionFormat'],
  WebGL2RenderingContext: ['canvas', 'drawingBufferWidth', 'drawingBufferHeight', 'getExtension', 'getParameter', 'createVertexArray', 'bindVertexArray', 'texImage3D', 'createQuery', 'beginQuery', 'endQuery'],
  MediaRecorder: ['stream', 'mimeType', 'state', 'videoBitsPerSecond', 'audioBitsPerSecond', 'ondataavailable', 'onerror', 'onpause', 'onresume', 'onstart', 'onstop', 'start', 'stop', 'pause', 'resume', 'requestData'],
  OffscreenCanvas: ['width', 'height', 'getContext', 'convertToBlob', 'transferToImageBitmap'],
  PaymentRequest: ['id', 'shippingAddress', 'shippingOption', 'shippingType', 'onshippingaddresschange', 'onshippingoptionchange', 'onpaymentmethodchange', 'show', 'abort', 'canMakePayment'],
  Notification: ['permission', 'maxActions', 'actions', 'badge', 'body', 'data', 'dir', 'lang', 'tag', 'icon', 'image', 'requireInteraction', 'silent', 'timestamp', 'title', 'vibrate', 'onclick', 'onclose', 'onerror', 'onshow', 'close'],
  BatteryManager: ['charging', 'chargingTime', 'dischargingTime', 'level', 'onchargingchange', 'onchargingtimechange', 'ondischargingtimechange', 'onlevelchange'],
  GPU: ['requestAdapter', 'getPreferredCanvasFormat', 'wgslLanguageFeatures'],
  USB: ['onconnect', 'ondisconnect', 'getDevices', 'requestDevice'],
  Bluetooth: ['getAvailability', 'getDevices', 'requestDevice', 'onavailabilitychanged'],
};

// Liste large des globals Chrome 150 souvent absents de jsdom (pour gonfler le champ 22).
// Chaque nom devient un constructeur/objet stub → ajoute la clé à window comme dans un vrai Chrome.
const CHROME_GLOBALS = [
  'SpeechSynthesis', 'SpeechSynthesisVoice', 'webkitSpeechRecognition', 'SpeechRecognition', 'SpeechRecognitionEvent', 'SpeechRecognitionErrorEvent',
  'RTCPeerConnection', 'webkitRTCPeerConnection', 'RTCSessionDescription', 'RTCIceCandidate', 'RTCDataChannel', 'RTCRtpSender', 'RTCRtpReceiver', 'RTCRtpTransceiver', 'RTCDtlsTransport', 'RTCIceTransport', 'RTCTrackEvent', 'RTCDataChannelEvent', 'RTCPeerConnectionIceEvent', 'RTCCertificate', 'MediaStream', 'MediaStreamTrack', 'MediaStreamTrackEvent',
  'AudioContext', 'webkitAudioContext', 'OfflineAudioContext', 'webkitOfflineAudioContext', 'AudioBuffer', 'AudioNode', 'GainNode', 'OscillatorNode', 'AnalyserNode', 'BiquadFilterNode', 'DynamicsCompressorNode', 'AudioBufferSourceNode', 'AudioDestinationNode', 'AudioListener', 'AudioParam', 'AudioWorklet', 'AudioWorkletNode', 'ConvolverNode', 'DelayNode', 'PannerNode', 'StereoPannerNode', 'WaveShaperNode', 'ChannelMergerNode', 'ChannelSplitterNode', 'ConstantSourceNode', 'IIRFilterNode', 'MediaElementAudioSourceNode', 'MediaStreamAudioSourceNode', 'MediaStreamAudioDestinationNode', 'PeriodicWave', 'AudioProcessingEvent', 'OfflineAudioCompletionEvent', 'BaseAudioContext', 'AudioScheduledSourceNode',
  'WebGLRenderingContext', 'WebGL2RenderingContext', 'WebGLBuffer', 'WebGLFramebuffer', 'WebGLProgram', 'WebGLRenderbuffer', 'WebGLShader', 'WebGLTexture', 'WebGLUniformLocation', 'WebGLActiveInfo', 'WebGLShaderPrecisionFormat', 'WebGLContextEvent', 'WebGLVertexArrayObject', 'WebGLQuery', 'WebGLSampler', 'WebGLSync', 'WebGLTransformFeedback',
  'MediaRecorder', 'MediaSource', 'SourceBuffer', 'BlobEvent', 'ImageCapture', 'MediaDevices', 'MediaDeviceInfo', 'MediaEncryptedEvent', 'MediaKeyMessageEvent', 'MediaKeySession', 'MediaKeys', 'MediaKeyStatusMap', 'MediaKeySystemAccess',
  'OffscreenCanvas', 'OffscreenCanvasRenderingContext2D', 'ImageBitmapRenderingContext', 'Path2D', 'CanvasGradient', 'CanvasPattern',
  'PaymentRequest', 'PaymentResponse', 'PaymentAddress', 'PaymentMethodChangeEvent', 'PaymentRequestUpdateEvent',
  'Notification', 'PushManager', 'PushSubscription', 'PushSubscriptionOptions', 'ServiceWorker', 'ServiceWorkerContainer', 'ServiceWorkerRegistration',
  'BatteryManager', 'NetworkInformation', 'Gamepad', 'GamepadButton', 'GamepadEvent', 'GamepadHapticActuator',
  'GPU', 'GPUAdapter', 'GPUDevice', 'GPUBuffer', 'GPUQueue', 'GPUCanvasContext', 'USB', 'USBDevice', 'USBConnectionEvent', 'Bluetooth', 'BluetoothDevice', 'Serial', 'HID', 'HIDDevice',
  'SpeechSynthesisEvent', 'SpeechSynthesisUtterance', 'SpeechSynthesisErrorEvent',
  'IntersectionObserver', 'IntersectionObserverEntry', 'ResizeObserver', 'ResizeObserverEntry', 'ResizeObserverSize', 'ReportingObserver', 'PerformanceObserver', 'PerformanceObserverEntryList', 'PerformanceLongTaskTiming', 'PerformancePaintTiming', 'PerformanceEventTiming', 'PerformanceElementTiming', 'TaskAttributionTiming', 'LargestContentfulPaint', 'LayoutShift', 'LayoutShiftAttribution',
  'PressureObserver', 'NavigationPreloadManager', 'BackgroundFetchManager', 'ContentIndex', 'CookieStore', 'CookieChangeEvent', 'IdleDetector', 'Sanitizer',
  'CSSAnimation', 'CSSTransition', 'CSSKeyframeRule', 'CSSKeyframesRule', 'CSSFontFaceRule', 'CSSPropertyRule', 'CSSLayerBlockRule', 'CSSLayerStatementRule', 'CSSContainerRule', 'CSSScopeRule', 'FontFace', 'FontFaceSet', 'FontFaceSetLoadEvent',
  'TrustedTypePolicy', 'TrustedTypePolicyFactory', 'TrustedHTML', 'TrustedScript', 'TrustedScriptURL',
  'VisualViewport', 'Scheduler', 'Scheduling', 'TaskController', 'TaskSignal', 'TaskPriorityChangeEvent',
  'MIDIAccess', 'MIDIInput', 'MIDIOutput', 'MIDIInputMap', 'MIDIOutputMap', 'MIDIMessageEvent', 'MIDIConnectionEvent', 'MIDIPort',
  'XRSystem', 'XRSession', 'XRFrame', 'XRView', 'Sensor', 'Accelerometer', 'Gyroscope', 'Magnetometer', 'AbsoluteOrientationSensor', 'RelativeOrientationSensor', 'AmbientLightSensor', 'LinearAccelerationSensor', 'GravitySensor',
  'FileSystemHandle', 'FileSystemFileHandle', 'FileSystemDirectoryHandle', 'FileSystemWritableFileStream', 'StorageManager', 'Cache', 'CacheStorage',
  'BarcodeDetector', 'CompressionStream', 'DecompressionStream', 'CustomStateSet', 'DelegatedInkTrailPresenter', 'Ink', 'EyeDropper', 'WakeLock', 'WakeLockSentinel', 'LaunchQueue', 'VirtualKeyboard', 'Highlight', 'HighlightRegistry',
  'AudioData', 'VideoFrame', 'EncodedAudioChunk', 'EncodedVideoChunk', 'AudioDecoder', 'AudioEncoder', 'VideoDecoder', 'VideoEncoder', 'ImageDecoder', 'ImageTrack', 'ImageTrackList',
];

/**
 * installBrowserGraph(window, native) — injecte les interfaces Chrome manquantes.
 * `native(fn, name)` : marque la fonction pour que toString() dise "[native code]" (registre shims.js).
 */
function installBrowserGraph(window, native) {
  native = native || ((f) => f);
  let added = 0;
  const makeCtor = (name) => {
    // constructeur "natif-like" : lève comme une vraie interface si appelé sans new, prototype dédié
    const ctor = function () { throw new window.TypeError(`Failed to construct '${name}': Illegal constructor`); };
    try { Object.defineProperty(ctor, 'name', { value: name, configurable: true }); } catch (_) {}
    const proto = {};
    const keys = PROTO_KEYS[name] || [];
    for (const k of keys) {
      // méthodes → fonctions natives-like ; propriétés → getters
      if (/^on[a-z]/.test(k) || /^[a-z]/.test(k) && k === k.toLowerCase() && !/[A-Z]/.test(k) && keys.indexOf(k) < 0) {
        try { Object.defineProperty(proto, k, { value: undefined, configurable: true, enumerable: true }); } catch (_) {}
      } else {
        const fn = native(function () {}, k);
        try { Object.defineProperty(proto, k, { value: fn, configurable: true, writable: true, enumerable: false }); } catch (_) {}
      }
    }
    try { Object.defineProperty(proto, 'constructor', { value: ctor, configurable: true, writable: true }); } catch (_) {}
    try { Object.defineProperty(ctor, 'prototype', { value: proto, writable: false }); } catch (_) {}
    native(ctor, name);
    return ctor;
  };
  for (const name of CHROME_GLOBALS) {
    if (typeof window[name] !== 'undefined') continue;   // déjà présent (jsdom en a certains)
    try {
      Object.defineProperty(window, name, { value: makeCtor(name), configurable: true, writable: true, enumerable: false });
      added++;
    } catch (_) {}
  }

  // navigator.connection (NetworkInformation instance) — lu par plusieurs collecteurs
  try {
    if (!window.navigator.connection) {
      const conn = { downlink: 10, effectiveType: '4g', rtt: 50, saveData: false, type: 'wifi', onchange: null, addEventListener() {}, removeEventListener() {} };
      Object.defineProperty(window.navigator, 'connection', { get: () => conn, configurable: true });
    }
  } catch (_) {}
  return added;
}

module.exports = { installBrowserGraph, CHROME_GLOBALS, PROTO_KEYS };
