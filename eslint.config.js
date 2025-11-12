// eslint.config.js
export default [
  {
    files: ["web/static/js/**/*.js"],
    languageOptions: {
      ecmaVersion: 2021,
      sourceType: "module",
      globals: {
        window: "readonly",
        document: "readonly",
        console: "readonly",
        WebSocket: "readonly",
        Blob: "readonly",
        URL: "readonly",
        Worker: "readonly",
        RTCPeerConnection: "readonly",
        RTCSessionDescription: "readonly",
        RTCIceCandidate: "readonly",
        FileReader: "readonly",
        ArrayBuffer: "readonly",
        Uint8Array: "readonly",
        fetch: "readonly",
        alert: "readonly",
        confirm: "readonly"
      }
    },
    rules: {
      "complexity": ["warn", 15],
      "max-depth": ["warn", 4],
      "max-lines-per-function": ["warn", 100],
      "max-nested-callbacks": ["warn", 3],
      "no-unused-vars": "warn",
      "no-undef": "error"
    }
  }
];
