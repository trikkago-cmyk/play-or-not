const STT_HALLUCINATION_LINE_PATTERN = /mandarin\s+chinese|transcribe\s+faithfully|do\s+not\s+translate|the\s+audio\s+is|点赞.*订阅|订阅.*点赞|点赞.*打赏|请不吝点赞|谢谢观看|感谢观看|字幕由|仅大陆公司可用/i;

const CJK_TEXT_PATTERN = /[\u3400-\u9fff]/;
const TRAILING_SEPARATOR_PATTERN = /[\s，,。.!！?？、；;：:]$/;
const LEADING_SEPARATOR_PATTERN = /^[\s，,。.!！?？、；;：:]/;

export function sanitizeVoiceInputText(rawText: string): string {
  const lines = rawText
    .replace(/\u200b/g, '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !STT_HALLUCINATION_LINE_PATTERN.test(line));

  const cleaned = lines
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!cleaned) {
    return '';
  }

  const compact = cleaned.replace(/[\s，,。.!！?？、；;：:"'“”‘’]/g, '').toLowerCase();
  if (
    /mandarinchinese|transcribefaithfully|donottranslate|theaudiois/.test(compact)
    || /点赞.*订阅|订阅.*点赞|点赞.*打赏|仅大陆公司可用/.test(compact)
  ) {
    return '';
  }

  return cleaned;
}

export function appendVoiceInputText(baseText: string, transcriptText: string): string {
  const base = baseText.trim();
  const transcript = sanitizeVoiceInputText(transcriptText);

  if (!transcript) {
    return base;
  }

  if (!base) {
    return transcript;
  }

  if (TRAILING_SEPARATOR_PATTERN.test(base) || LEADING_SEPARATOR_PATTERN.test(transcript)) {
    return `${base}${transcript}`;
  }

  const separator = CJK_TEXT_PATTERN.test(base) || CJK_TEXT_PATTERN.test(transcript) ? '，' : ' ';
  return `${base}${separator}${transcript}`;
}
