const fs = require('node:fs');
const path = require('node:path');

// 57.1.0 drops requiresOnDeviceRecognition when the requested locale is unsupported.
// Check the actual recognizer locale before capturing audio, and preserve the flag.
function patchSpeechRecognition(packageRoot) {
  const version = JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8')).version;
  if (version !== '57.1.0') throw new Error('Revalidate the speech privacy patch before upgrading expo-speech-recognition.');
  const file = path.join(packageRoot, 'ios/ExpoSpeechRecognizer.swift');
  const original = `    if recognizer.supportsOnDeviceRecognition {
      request.requiresOnDeviceRecognition = options.requiresOnDeviceRecognition
    }`;
  const replacement = `    // PASS: never fall back to server recognition when on-device mode was requested.
    request.requiresOnDeviceRecognition = options.requiresOnDeviceRecognition`;
  const source = fs.readFileSync(file, 'utf8');
  const startOriginal = `    do {
      let request = Self.prepareRequest(`;
  const startReplacement = `    // PASS: validate the actual requested locale before audio capture or recognition.
    if options.requiresOnDeviceRecognition && !recognizer.supportsOnDeviceRecognition {
      errorHandler(RecognizerError.recognizerIsUnavailable)
      reset(andEmitEnd: true)
      return
    }

    do {
      let request = Self.prepareRequest(`;
  if (source.includes(replacement) && source.includes(startReplacement)) return;
  const requestMatches = source.includes(replacement) || source.split(original).length === 2;
  if (!requestMatches || source.split(startOriginal).length !== 2) throw new Error('Speech privacy patch no longer matches native source.');
  fs.writeFileSync(file, source.replace(original, replacement).replace(startOriginal, startReplacement));
}
if (require.main === module) {
  patchSpeechRecognition(path.dirname(require.resolve('expo-speech-recognition/package.json')));
  console.log('Applied iOS on-device speech privacy patch.');
}
module.exports = { patchSpeechRecognition };
