import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { patchSpeechRecognition } = require('../scripts/patch-speech-recognition.cjs');
const installed = path.dirname(require.resolve('expo-speech-recognition/package.json'));

test('installed iOS request forces the on-device flag before recognition', () => {
  const source = fs.readFileSync(path.join(installed, 'ios/ExpoSpeechRecognizer.swift'), 'utf8');
  const prepare = source.slice(source.indexOf('private static func prepareRequest'), source.indexOf('private static func setupAudioSession'));
  assert.ok(prepare.includes('request.requiresOnDeviceRecognition = options.requiresOnDeviceRecognition'));
  assert.ok(!prepare.includes('if recognizer.supportsOnDeviceRecognition'));
  const guard = source.indexOf('if options.requiresOnDeviceRecognition && !recognizer.supportsOnDeviceRecognition');
  assert.ok(guard >= 0 && guard < source.indexOf('let request = Self.prepareRequest('));
  assert.ok(source.slice(guard, source.indexOf('let request = Self.prepareRequest(')).includes('return'));
});

test('privacy patch is idempotent and rejects dependency upgrades', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pass-speech-privacy-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'ios'));
  fs.copyFileSync(path.join(installed, 'ios/ExpoSpeechRecognizer.swift'), path.join(root, 'ios/ExpoSpeechRecognizer.swift'));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({version:'57.1.0'}));
  const before = fs.readFileSync(path.join(root, 'ios/ExpoSpeechRecognizer.swift'), 'utf8');
  patchSpeechRecognition(root); patchSpeechRecognition(root);
  assert.equal(fs.readFileSync(path.join(root, 'ios/ExpoSpeechRecognizer.swift'), 'utf8'), before);
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({version:'57.2.0'}));
  assert.throws(() => patchSpeechRecognition(root), /Revalidate/);
});

test('privacy patch rejects unexpected native source without modifying it', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pass-speech-mismatch-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'ios'));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({version:'57.1.0'}));
  const file = path.join(root, 'ios/ExpoSpeechRecognizer.swift');
  fs.writeFileSync(file, '// changed upstream implementation');
  assert.throws(() => patchSpeechRecognition(root), /no longer matches/);
  assert.equal(fs.readFileSync(file, 'utf8'), '// changed upstream implementation');
});
