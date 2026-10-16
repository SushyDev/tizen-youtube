import { answerSwitch } from '../../framework/index.js';

// Cobalt's own async mic probe reports this device's remote as mic-less even though
// window.SpeechRecognition and getUserMedia both work, so kabuki never renders the search voice
// icon. kabuki carries a purpose-built bypass for exactly this, checked ahead of its own probe:
// forceVoiceEnabled makes it set hasSoftMicSupport/hasHardMicSupport itself, so answering that
// switch is the fix — not guessing at kabuki's internal capability object after the fact.
const start = () => answerSwitch('forceVoiceEnabled', () => true);

export { start };
