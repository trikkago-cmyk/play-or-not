const HARD_SENTENCE_BOUNDARY = /[。！？!?]/;
const SOFT_SENTENCE_BOUNDARY = /[；;：:]/;
const ELLIPSIS_BOUNDARY = /…/;
const CLAUSE_BOUNDARY = /[，,、]/;
const CLAUSE_BOUNDARY_MIN_CHARS = 48;
const MIN_NATURAL_SEGMENT_CHARS = 18;
const MAX_NATURAL_SEGMENT_CHARS = 110;
const STRONG_CONTINUATION_SUFFIX = /[：:；;（(“‘「『【]/;
const STRONG_CONTINUATION_PREFIX = /^[”’」』）】》、，,.!?！？:：;；]/;
const WEAK_CONTINUATION_PREFIX = /^(?:的|地|得|了|着|过|呢|吗|呀|啊|啦|嘛|吧)/;
const LATIN_OR_DIGIT_END = /[A-Za-z0-9)]$/;
const LATIN_OR_DIGIT_START = /^[A-Za-z0-9(]/;

export function getLongestCommonPrefixLength(previousText: string, nextText: string) {
  const maxLength = Math.min(previousText.length, nextText.length);
  let index = 0;

  while (index < maxLength && previousText[index] === nextText[index]) {
    index += 1;
  }

  return index;
}

export function collectCompletedSpeechSegments(text: string, consumedLength: number) {
  const segments: string[] = [];
  let nextConsumedLength = consumedLength;
  let segmentStart = consumedLength;

  for (let index = consumedLength; index < text.length; index += 1) {
    const character = text[index];
    const currentSegmentLength = index - segmentStart + 1;
    const isHardBoundary = HARD_SENTENCE_BOUNDARY.test(character);
    const isSoftBoundary = SOFT_SENTENCE_BOUNDARY.test(character);
    const isClauseBoundary = CLAUSE_BOUNDARY.test(character) && currentSegmentLength >= CLAUSE_BOUNDARY_MIN_CHARS;
    const isEllipsisBoundary = ELLIPSIS_BOUNDARY.test(character) && text[index + 1] !== character;
    const isLineBreakBoundary = character === '\n' && segmentStart < index;

    if (!isHardBoundary && !isSoftBoundary && !isClauseBoundary && !isEllipsisBoundary && !isLineBreakBoundary) {
      continue;
    }

    const segment = text.slice(segmentStart, isLineBreakBoundary ? index : index + 1).trim();
    if (segment) {
      segments.push(segment);
    }

    segmentStart = index + 1;
    nextConsumedLength = segmentStart;
  }

  return {
    segments,
    nextConsumedLength,
  };
}

function shouldMergeSegments(current: string, next: string) {
  const normalizedCurrent = current.trim();
  const normalizedNext = next.trim();
  if (!normalizedCurrent || !normalizedNext) {
    return false;
  }

  const combinedLength = normalizedCurrent.length + normalizedNext.length;
  if (combinedLength > MAX_NATURAL_SEGMENT_CHARS) {
    return false;
  }

  if (normalizedCurrent.length < MIN_NATURAL_SEGMENT_CHARS || normalizedNext.length < 14) {
    return true;
  }

  if (STRONG_CONTINUATION_SUFFIX.test(normalizedCurrent)) {
    return true;
  }

  if (STRONG_CONTINUATION_PREFIX.test(normalizedNext) || WEAK_CONTINUATION_PREFIX.test(normalizedNext)) {
    return true;
  }

  return false;
}

export function mergeSpeechSegments(
  segments: string[],
  carrySegment = '',
  options: {
    final?: boolean;
  } = {},
) {
  const final = options.final ?? false;
  const mergedSegments: string[] = [];
  let buffer = carrySegment.trim();

  const flushBuffer = () => {
    if (!buffer) {
      return;
    }
    mergedSegments.push(buffer);
    buffer = '';
  };

  for (const rawSegment of segments) {
    const segment = rawSegment.trim();
    if (!segment) {
      continue;
    }

    if (!buffer) {
      buffer = segment;
      continue;
    }

    if (shouldMergeSegments(buffer, segment)) {
      buffer += segment;
      continue;
    }

    if (buffer.length >= MIN_NATURAL_SEGMENT_CHARS || final) {
      flushBuffer();
      buffer = segment;
      continue;
    }

    buffer += segment;
  }

  if (final) {
    flushBuffer();
  } else if (buffer.length >= MIN_NATURAL_SEGMENT_CHARS) {
    flushBuffer();
  }

  return {
    segments: mergedSegments,
    carrySegment: buffer,
  };
}

export function appendSpeechText(existingText: string, nextText: string) {
  const left = existingText.trim();
  const right = nextText.trim();

  if (!left) {
    return right;
  }

  if (!right) {
    return left;
  }

  const needsSpace = LATIN_OR_DIGIT_END.test(left) && LATIN_OR_DIGIT_START.test(right);
  return `${left}${needsSpace ? ' ' : ''}${right}`;
}

export function collectStablePreviewSpeechSegments(
  currentPreviewText: string,
  previousPreviewText: string,
  consumedLength: number,
) {
  const stablePrefixLength = getLongestCommonPrefixLength(previousPreviewText, currentPreviewText);
  const safeConsumedLength = consumedLength > stablePrefixLength ? 0 : consumedLength;
  const stableText = currentPreviewText.slice(0, stablePrefixLength);
  const { segments, nextConsumedLength } = collectCompletedSpeechSegments(stableText, safeConsumedLength);

  return {
    didResetConsumedLength: safeConsumedLength !== consumedLength,
    segments,
    nextConsumedLength,
  };
}

export function collectFinalSpeechSegments(
  finalText: string,
  previousPreviewText: string,
  consumedLength: number,
) {
  const stablePrefixLength = getLongestCommonPrefixLength(previousPreviewText, finalText);
  const safeConsumedLength = consumedLength > stablePrefixLength ? 0 : consumedLength;
  const { segments, nextConsumedLength } = collectCompletedSpeechSegments(finalText, safeConsumedLength);

  return {
    didResetConsumedLength: safeConsumedLength !== consumedLength,
    segments,
    remainingText: finalText.slice(nextConsumedLength).trim(),
  };
}
